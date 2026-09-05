import type { AtlasRuntimeCountry } from './runtime';
import type { AtlasLeadershipOfficeholder } from './types';
import {
  ATLAS_LEADERSHIP_AUTHORITY,
  ATLAS_PORTRAIT_PILOT,
  atlasLeadershipFreshness,
  findAtlasLeadershipAuthorityContext,
  findAtlasLeadershipAuthorityUpdate,
  getAtlasLeadershipOffice,
} from './leadership/authority';
import type { AtlasLeadershipRole } from './leadership/types';

/** A person/media identity is not an office and is deliberately not owned by a country. */
export type AtlasPortraitMedia = (typeof ATLAS_PORTRAIT_PILOT.media)[number];
export type AtlasPortraitPerson = (typeof ATLAS_PORTRAIT_PILOT.people)[number];
export type AtlasPortraitMatch = {
  person: AtlasPortraitPerson;
  media: AtlasPortraitMedia;
  title: string;
  officeId: `office:${string}`;
  identityConfidence: "high" | "medium" | "low";
  identityReviewedAt: string;
};
type LeadershipFact = NonNullable<AtlasRuntimeCountry['facts']['headOfState']>;
const isLeadershipRole = (role: string): role is AtlasLeadershipRole => role === 'headOfState' || role === 'headOfGovernment';

/** Updates are explicitly reviewed observations, not mutation of the archived import. */
export function findAtlasOfficeUpdate(countryId: string, role: string, fact: LeadershipFact) {
  return isLeadershipRole(role) ? findAtlasLeadershipAuthorityUpdate(countryId, role, fact) : null;
}

export function findAtlasLeadershipContext(countryId: string, role: string, fact: LeadershipFact, holder: AtlasLeadershipOfficeholder) {
  return isLeadershipRole(role)
    ? findAtlasLeadershipAuthorityContext(countryId, role, fact, holder.nameAndTitle)
    : null;
}

/** Pure date check also used by the review report. Unknown and future dates fail closed. */
export function atlasLeadershipReviewDue(observedAt: string | null, asOf = new Date().toISOString().slice(0, 10)): boolean {
  return atlasLeadershipFreshness(observedAt, asOf) !== 'recent_observation';
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
  const binding = ATLAS_PORTRAIT_PILOT.bindings.find((candidate) =>
    candidate.entityId === countryId
    && candidate.officeId === getAtlasLeadershipOffice(countryId, role).id
    && candidate.role === role
    && candidate.exactSourceName === officeholder.nameAndTitle
    && candidate.sourceId === fact.sourceId
    && candidate.observedAt === fact.observedAt,
  );
  if (!binding) return null;
  const person = ATLAS_PORTRAIT_PILOT.people.find((candidate) => candidate.id === binding.personId);
  const media = ATLAS_PORTRAIT_PILOT.media.find((candidate) => candidate.id === person?.portraitMediaId && candidate.personId === person?.id);
  return person && media ? {
    person,
    media,
    title: binding.title,
    officeId: binding.officeId,
    identityConfidence: binding.identityConfidence,
    identityReviewedAt: binding.reviewedAt,
  } : null;
}

export { ATLAS_LEADERSHIP_AUTHORITY, ATLAS_PORTRAIT_PILOT };
