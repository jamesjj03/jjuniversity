import pilot from './data/portrait-pilot.json';
import leadershipContext from './data/leadership-context.json';
import type { AtlasRuntimeCountry } from './runtime';
import type { AtlasLeadershipOfficeholder } from './types';

/** A person/media identity is not an office and is deliberately not owned by a country. */
export type AtlasPortraitMedia = (typeof pilot.media)[number];
export type AtlasPortraitPerson = (typeof pilot.people)[number];
export type AtlasPortraitMatch = {
  person: AtlasPortraitPerson;
  media: AtlasPortraitMedia;
  title: string;
};
type LeadershipFact = NonNullable<AtlasRuntimeCountry['facts']['headOfState']>;

/** Updates are explicitly reviewed observations, not mutation of the archived import. */
export function findAtlasOfficeUpdate(countryId: string, role: string, fact: LeadershipFact) {
  return leadershipContext.officeUpdates.find((update) =>
    update.entityId === countryId && update.role === role
    && update.supersedes.sourceId === fact.sourceId
    && update.supersedes.observedAt === fact.observedAt
    && !fact.value.isVacant
    && fact.value.officeholders.some((holder) => holder.nameAndTitle === update.supersedes.exactSourceName),
  ) ?? null;
}

export function findAtlasLeadershipContext(countryId: string, role: string, fact: LeadershipFact, holder: AtlasLeadershipOfficeholder) {
  return leadershipContext.contexts.find((context) =>
    context.entityId === countryId && context.roles.includes(role)
    && context.sourceId === fact.sourceId && context.archivedObservedAt === fact.observedAt
    && context.exactSourceName === holder.nameAndTitle,
  ) ?? null;
}

/** Pure date check also used by the review report. Unknown and future dates fail closed. */
export function atlasLeadershipReviewDue(observedAt: string | null, asOf = new Date().toISOString().slice(0, 10)): boolean {
  if (!observedAt || !/^\d{4}-\d{2}-\d{2}$/.test(observedAt)) return true;
  const observed = Date.parse(observedAt);
  const current = Date.parse(asOf);
  return !Number.isFinite(observed) || !Number.isFinite(current) || observed > current
    || current - observed >= leadershipContext.reviewPolicy.reviewAfterDays * 86400000;
}

/**
 * This is an exact, reviewed-in-code match against a dated source observation.
 * A new leader, name, or source date cannot silently inherit somebody else's face.
 * No result is an ordinary supported state; do not manufacture a placeholder.
 */
export function findAtlasPortrait(
  countryId: string,
  role: 'headOfState' | 'headOfGovernment',
  fact: NonNullable<AtlasRuntimeCountry['facts']['headOfState']>,
  officeholder: AtlasLeadershipOfficeholder,
): AtlasPortraitMatch | null {
  if (fact.value.isVacant) return null;
  // Known superseded officeholders cannot remain the current country's portrait.
  if (findAtlasOfficeUpdate(countryId, role, fact)) return null;
  const binding = pilot.bindings.find((candidate) =>
    candidate.entityId === countryId
    && candidate.role === role
    && candidate.exactSourceName === officeholder.nameAndTitle
    && candidate.sourceId === fact.sourceId
    && candidate.observedAt === fact.observedAt,
  );
  if (!binding) return null;
  const person = pilot.people.find((candidate) => candidate.id === binding.personId);
  const media = pilot.media.find((candidate) => candidate.id === person?.portraitMediaId && candidate.personId === person?.id);
  return person && media ? { person, media, title: binding.title } : null;
}
