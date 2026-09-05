import rawLeadershipAuthority from "../data/leadership-context.json";
import rawPortraitPilot from "../data/portrait-pilot.json";
import type {
  AtlasLeadershipAuthority,
  AtlasLeadershipFactLike,
  AtlasLeadershipFreshnessState,
  AtlasLeadershipOccupancyState,
  AtlasLeadershipOfficeIdentity,
  AtlasLeadershipRole,
  AtlasPortraitPilotAuthority,
  AtlasResolvedLeadershipState,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROLES = new Set<AtlasLeadershipRole>(["headOfState", "headOfGovernment"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const OCCUPANCY = new Set<AtlasLeadershipOccupancyState>(["occupied", "vacant", "collective", "uncertain"]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Atlas leadership authority: ${message}`);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validateSources(sources: readonly { publisher: string; title: string; url: string; publishedAt: string | null }[], context: string) {
  invariant(Array.isArray(sources), `${context} sources must be an array`);
  invariant(sources.length > 0, `${context} needs at least one evidence source`);
  const urls = new Set<string>();
  for (const source of sources) {
    invariant(Boolean(source.publisher && source.title), `${context} has incomplete source attribution`);
    invariant(typeof source.url === "string" && source.url.startsWith("https://"), `${context} source must use HTTPS`);
    invariant(!urls.has(source.url), `${context} repeats source ${source.url}`);
    urls.add(source.url);
    invariant(source.publishedAt === null || isIsoDate(source.publishedAt), `${context} has invalid source date`);
  }
}

export function atlasLeadershipOfficeId(entityId: string, role: AtlasLeadershipRole): `office:${string}` {
  return `office:${entityId}:${role === "headOfState" ? "head-of-state" : "head-of-government"}`;
}

/** Validates both shape and the person → office → polity relationships used at runtime. */
export function validateAtlasLeadershipAuthority(value: unknown): AtlasLeadershipAuthority {
  invariant(Boolean(value) && typeof value === "object" && !Array.isArray(value), "root must be an object");
  const authority = value as AtlasLeadershipAuthority;
  invariant(authority.schemaVersion === "2.0.0", `unsupported schema ${String(authority.schemaVersion)}`);
  invariant(authority.authorityId === "jju-atlas-leadership", "unexpected authority ID");
  invariant(Boolean(authority.revision), "revision is required");
  invariant(isIsoDate(authority.reviewedAt), "reviewedAt must be a real ISO date");
  invariant(authority.policy?.automaticPublication === false, "leadership must not publish automatically");
  invariant(authority.policy.freshnessDoesNotAssertCurrentOffice === true, "freshness must not become a current-office claim");
  invariant(authority.policy.separatePersonOfficeAndPolityIdentity === true, "person, office, and polity identities must stay separate");
  invariant(authority.policy.unreviewedPortraitBehavior === "no_portrait", "unreviewed identities must fail closed without a portrait");
  invariant(Number.isInteger(authority.reviewPolicy?.reviewAfterDays) && authority.reviewPolicy.reviewAfterDays > 0, "review interval must be positive");
  invariant(Array.isArray(authority.people) && Array.isArray(authority.offices), "people and offices are required");
  invariant(Array.isArray(authority.contexts) && Array.isArray(authority.officeUpdates), "contexts and office updates are required");

  const people = new Map<string, AtlasLeadershipAuthority["people"][number]>();
  for (const person of authority.people) {
    invariant(person.id.startsWith("person:") && !people.has(person.id), `duplicate or invalid person ${person.id}`);
    invariant(Boolean(person.canonicalName), `${person.id} needs a canonical name`);
    invariant(Array.isArray(person.aliases), `${person.id} aliases must be an array`);
    invariant(CONFIDENCE.has(person.identityConfidence), `${person.id} needs reviewed identity confidence`);
    invariant(isIsoDate(person.reviewedAt), `${person.id} needs a review date`);
    people.set(person.id, person);
  }

  const offices = new Map<string, AtlasLeadershipOfficeIdentity>();
  for (const office of authority.offices) {
    invariant(office.id.startsWith("office:") && !offices.has(office.id), `duplicate or invalid office ${office.id}`);
    invariant(office.polityEntityId.startsWith("country:"), `${office.id} needs a polity entity`);
    invariant(ROLES.has(office.role), `${office.id} has an unsupported role`);
    invariant(office.id === atlasLeadershipOfficeId(office.polityEntityId, office.role), `${office.id} is not the stable ID for its polity and role`);
    invariant(Boolean(office.label), `${office.id} needs a label`);
    invariant(["individual", "collective", "variable", "unspecified"].includes(office.holderModel), `${office.id} has an invalid holder model`);
    offices.set(office.id, office);
  }

  for (const context of authority.contexts) {
    invariant(people.has(context.personId), `context references unknown person ${context.personId}`);
    invariant(context.entityId.startsWith("country:"), `context for ${context.personId} needs a polity`);
    invariant(context.roles.length > 0 && context.roles.length === context.officeIds.length, `context for ${context.personId} has mismatched roles and offices`);
    invariant(isIsoDate(context.archivedObservedAt), `context for ${context.personId} needs an archived observation date`);
    invariant(Boolean(context.sourceId && context.exactSourceName && context.summary), `context for ${context.personId} is incomplete`);
    context.roles.forEach((role, index) => {
      invariant(ROLES.has(role), `context for ${context.personId} has an unsupported role`);
      const office = offices.get(context.officeIds[index]);
      invariant(Boolean(office), `context for ${context.personId} references unknown office ${context.officeIds[index]}`);
      invariant(office?.polityEntityId === context.entityId && office.role === role, `context for ${context.personId} crosses its office/polity relationship`);
    });
    validateSources(context.sources, `context for ${context.personId}`);
  }

  const activeOfficeUpdates = new Set<string>();
  for (const update of authority.officeUpdates) {
    invariant(update.id.startsWith("office-observation:"), `invalid update ID ${update.id}`);
    invariant(!activeOfficeUpdates.has(update.officeId), `ambiguous active update for ${update.officeId}`);
    activeOfficeUpdates.add(update.officeId);
    const office = offices.get(update.officeId);
    invariant(Boolean(office), `${update.id} references unknown office ${update.officeId}`);
    invariant(office?.polityEntityId === update.entityId && office.role === update.role, `${update.id} crosses its office/polity relationship`);
    invariant(people.has(update.personId), `${update.id} references unknown person ${update.personId}`);
    invariant(people.get(update.personId)?.canonicalName === update.personName, `${update.id} name differs from its person identity`);
    invariant(update.status === "reviewed_source_observation", `${update.id} is not reviewed`);
    invariant(CONFIDENCE.has(update.confidence), `${update.id} needs explicit confidence`);
    invariant(OCCUPANCY.has(update.occupancyStatus), `${update.id} needs explicit occupancy status`);
    invariant(isIsoDate(update.termStartedAt) && isIsoDate(update.observedAt) && isIsoDate(update.reviewAfter), `${update.id} has invalid dates`);
    invariant(update.termStartedAt <= update.observedAt && update.observedAt < update.reviewAfter, `${update.id} has inconsistent term, observation, or review dates`);
    invariant(isIsoDate(update.supersedes.observedAt) && isIsoDate(update.supersedes.termEndedAt), `${update.id} predecessor dates are invalid`);
    invariant(update.supersedes.observedAt <= update.supersedes.termEndedAt, `${update.id} predecessor ends before its observation`);
    invariant(Boolean(update.supersedes.personId && update.supersedes.sourceId && update.supersedes.exactSourceName), `${update.id} predecessor is incomplete`);
    invariant(people.has(update.supersedes.personId), `${update.id} predecessor references unknown person ${update.supersedes.personId}`);
    validateSources(update.sources, update.id);
  }
  return authority;
}

export function validateAtlasPortraitPilotAuthority(
  value: unknown,
  leadership: AtlasLeadershipAuthority,
): AtlasPortraitPilotAuthority {
  invariant(Boolean(value) && typeof value === "object" && !Array.isArray(value), "portrait root must be an object");
  const pilot = value as AtlasPortraitPilotAuthority;
  invariant(pilot.schemaVersion === "1.2.0", `unsupported portrait schema ${String(pilot.schemaVersion)}`);
  invariant(isIsoDate(pilot.reviewedAt), "portrait pilot needs a review date");
  invariant(/not a current officeholder service/i.test(pilot.purpose), "portrait pilot must retain its currency caveat");
  invariant(Array.isArray(pilot.people) && Array.isArray(pilot.media) && Array.isArray(pilot.bindings), "portrait people, media, and bindings are required");
  const authorityPeople = new Map(leadership.people.map((person) => [person.id, person]));
  const people = new Map<string, AtlasPortraitPilotAuthority["people"][number]>();
  for (const person of pilot.people) {
    invariant(!people.has(person.id) && authorityPeople.has(person.id), `portrait references unknown or duplicate person ${person.id}`);
    invariant(authorityPeople.get(person.id)?.canonicalName === person.name, `portrait name differs from identity authority for ${person.id}`);
    people.set(person.id, person);
  }
  const media = new Map<string, AtlasPortraitPilotAuthority["media"][number]>();
  for (const asset of pilot.media) {
    invariant(!media.has(asset.id) && people.has(asset.personId), `invalid media identity ${asset.id}`);
    invariant(typeof asset.href === "string" && asset.href.startsWith("/atlas/portraits/") && asset.href.endsWith(".webp"), `${asset.id} is not a local prepared portrait`);
    invariant(typeof asset.sourceUrl === "string" && asset.sourceUrl.startsWith("https://") && typeof asset.licenseUrl === "string" && asset.licenseUrl.startsWith("https://"), `${asset.id} lacks source or license provenance`);
    invariant(isIsoDate(asset.photoDate) && isIsoDate(asset.reviewedAt), `${asset.id} has invalid photo/review dates`);
    invariant(asset.photoDate <= asset.reviewedAt, `${asset.id} claims review before the photograph date`);
    invariant(Boolean(asset.author && asset.licenseName && asset.changes), `${asset.id} has incomplete attribution`);
    invariant(/^[a-f0-9]{64}$/.test(asset.sourceSha256) && /^[a-f0-9]{64}$/.test(asset.outputSha256), `${asset.id} has invalid checksums`);
    media.set(asset.id, asset);
  }
  const bindings = new Set<string>();
  for (const binding of pilot.bindings) {
    const key = `${binding.officeId}:${binding.personId}:${binding.observedAt}`;
    invariant(!bindings.has(key), `duplicate portrait binding ${key}`);
    bindings.add(key);
    const office = leadership.offices.find((candidate) => candidate.id === binding.officeId);
    invariant(Boolean(office), `portrait binding references unknown office ${binding.officeId}`);
    invariant(office?.polityEntityId === binding.entityId && office.role === binding.role, `portrait binding crosses its office/polity relationship`);
    invariant(people.has(binding.personId), `portrait binding references unknown person ${binding.personId}`);
    invariant(CONFIDENCE.has(binding.identityConfidence), `portrait binding needs identity confidence`);
    invariant(isIsoDate(binding.observedAt) && isIsoDate(binding.reviewedAt), `portrait binding has invalid dates`);
    invariant(binding.observedAt <= binding.reviewedAt, `portrait binding claims identity review before its office observation`);
    invariant(Boolean(binding.exactSourceName && binding.sourceId && binding.title), `portrait binding is incomplete`);
  }
  for (const person of pilot.people) {
    const asset = media.get(person.portraitMediaId);
    invariant(asset?.personId === person.id, `${person.id} does not own its declared portrait media`);
  }
  return pilot;
}

export const ATLAS_LEADERSHIP_AUTHORITY = validateAtlasLeadershipAuthority(rawLeadershipAuthority);
export const ATLAS_PORTRAIT_PILOT = validateAtlasPortraitPilotAuthority(rawPortraitPilot, ATLAS_LEADERSHIP_AUTHORITY);

const peopleById = new Map(ATLAS_LEADERSHIP_AUTHORITY.people.map((person) => [person.id, person]));
const officesById = new Map(ATLAS_LEADERSHIP_AUTHORITY.offices.map((office) => [office.id, office]));

export function getAtlasLeadershipPerson(personId: string) {
  return peopleById.get(personId as `person:${string}`) ?? null;
}

export function getAtlasLeadershipOffice(entityId: string, role: AtlasLeadershipRole): AtlasLeadershipOfficeIdentity {
  const id = atlasLeadershipOfficeId(entityId, role);
  return officesById.get(id) ?? {
    id,
    polityEntityId: entityId as `country:${string}`,
    role,
    label: role === "headOfState" ? "Head of state" : "Head of government",
    holderModel: "unspecified",
  };
}

export function findAtlasLeadershipAuthorityUpdate(entityId: string, role: AtlasLeadershipRole, fact: AtlasLeadershipFactLike) {
  return ATLAS_LEADERSHIP_AUTHORITY.officeUpdates.find((update) =>
    update.officeId === atlasLeadershipOfficeId(entityId, role)
    && update.entityId === entityId
    && update.role === role
    && update.supersedes.sourceId === fact.sourceId
    && update.supersedes.observedAt === fact.observedAt
    && !fact.value.isVacant
    && fact.value.officeholders.some((holder) => holder.nameAndTitle === update.supersedes.exactSourceName),
  ) ?? null;
}

export function findAtlasLeadershipAuthorityContext(entityId: string, role: AtlasLeadershipRole, fact: AtlasLeadershipFactLike, exactSourceName: string) {
  const officeId = atlasLeadershipOfficeId(entityId, role);
  return ATLAS_LEADERSHIP_AUTHORITY.contexts.find((context) => {
    const roleIndex = context.roles.indexOf(role);
    return context.entityId === entityId && roleIndex >= 0 && context.officeIds[roleIndex] === officeId
      && context.sourceId === fact.sourceId && context.archivedObservedAt === fact.observedAt
      && context.exactSourceName === exactSourceName;
  }) ?? null;
}

export function deriveAtlasLeadershipOccupancy(value: AtlasLeadershipFactLike["value"]): AtlasLeadershipOccupancyState {
  if (value.isVacant) return "vacant";
  if (value.officeholders.length === 0) return "uncertain";
  const principals = value.officeholders.filter((holder) => holder.relationship === "principal").length;
  const members = value.officeholders.filter((holder) => holder.relationship === "member").length;
  return principals > 1 || members > 1 ? "collective" : "occupied";
}

export function atlasLeadershipFreshness(
  observedAt: string | null,
  asOf = new Date().toISOString().slice(0, 10),
  reviewAfter: string | null = null,
): AtlasLeadershipFreshnessState {
  if (!observedAt || !isIsoDate(observedAt) || !isIsoDate(asOf)) return "undated";
  if (observedAt > asOf) return "future_dated";
  if (reviewAfter) return !isIsoDate(reviewAfter) || asOf >= reviewAfter ? "review_due" : "recent_observation";
  const age = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${observedAt}T00:00:00Z`);
  return age >= ATLAS_LEADERSHIP_AUTHORITY.reviewPolicy.reviewAfterDays * 86_400_000
    ? "review_due"
    : "recent_observation";
}

export function resolveAtlasLeadershipState(
  entityId: string,
  role: AtlasLeadershipRole,
  fact: AtlasLeadershipFactLike,
  asOf = new Date().toISOString().slice(0, 10),
): AtlasResolvedLeadershipState {
  const office = getAtlasLeadershipOffice(entityId, role);
  const update = findAtlasLeadershipAuthorityUpdate(entityId, role, fact);
  if (update) return {
    office,
    recordKind: "reviewed_update",
    personId: update.personId,
    personName: update.personName,
    title: update.title,
    termStartedAt: update.termStartedAt,
    observedAt: update.observedAt,
    occupancy: update.occupancyStatus,
    freshness: atlasLeadershipFreshness(update.observedAt, asOf, update.reviewAfter),
    confidence: update.confidence,
    currentOfficeClaim: update.occupancyStatus === "occupied" ? "occupied_on_observation_date" : "not_asserted",
  };

  const singleHolder = fact.value.officeholders.length === 1 ? fact.value.officeholders[0] : null;
  const context = singleHolder ? findAtlasLeadershipAuthorityContext(entityId, role, fact, singleHolder.nameAndTitle) : null;
  return {
    office,
    recordKind: "archived_snapshot",
    personId: context?.personId ?? null,
    personName: context ? peopleById.get(context.personId)?.canonicalName ?? null : null,
    title: null,
    termStartedAt: singleHolder?.termStartedAt ?? null,
    observedAt: fact.observedAt,
    occupancy: deriveAtlasLeadershipOccupancy(fact.value),
    freshness: atlasLeadershipFreshness(fact.observedAt, asOf),
    confidence: context ? peopleById.get(context.personId)?.identityConfidence ?? "unassessed" : "unassessed",
    currentOfficeClaim: "not_asserted",
  };
}
