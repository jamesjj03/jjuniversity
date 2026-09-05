import pilot from './data/portrait-pilot.json';
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
