import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/data/leadership-context.json'), 'utf8'));
const portraitPilot = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/data/portrait-pilot.json'), 'utf8'));
const leadershipSchema = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/leadership/schema/leadership-authority.v2.schema.json'), 'utf8'));
const portraitSchema = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/leadership/schema/portrait-pilot.v1.schema.json'), 'utf8'));
const countries = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/data/countries.v1.json'), 'utf8')).countries;
const asOf = process.argv.find((arg) => arg.startsWith('--as-of='))?.split('=')[1] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))) throw new Error('Use --as-of=YYYY-MM-DD.');
const due = (observedAt) => !observedAt || !/^\d{4}-\d{2}-\d{2}$/.test(observedAt)
  || Date.parse(observedAt) > Date.parse(asOf)
  || Date.parse(asOf) - Date.parse(observedAt) >= registry.reviewPolicy.reviewAfterDays * 86400000;
const roles = ['headOfState', 'headOfGovernment'];
const confidence = new Set(['high', 'medium', 'low']);
const occupancy = new Set(['occupied', 'vacant', 'collective', 'uncertain']);
const officeId = (entityId, role) => `office:${entityId}:${role === 'headOfState' ? 'head-of-state' : 'head-of-government'}`;
if (registry.schemaVersion !== '2.0.0' || registry.authorityId !== 'jju-atlas-leadership') throw new Error('Unsupported leadership authority.');
if (leadershipSchema.properties.schemaVersion.const !== registry.schemaVersion || leadershipSchema.properties.authorityId.const !== registry.authorityId) throw new Error('Leadership schema and authority differ.');
if (portraitSchema.properties.schemaVersion.const !== portraitPilot.schemaVersion) throw new Error('Portrait schema and authority differ.');
if (registry.policy.automaticPublication !== false || registry.policy.freshnessDoesNotAssertCurrentOffice !== true || registry.policy.separatePersonOfficeAndPolityIdentity !== true || registry.policy.unreviewedPortraitBehavior !== 'no_portrait') throw new Error('Leadership safety policy changed.');
const people = new Map();
for (const person of registry.people) {
  if (people.has(person.id) || !person.id.startsWith('person:') || !person.canonicalName || !confidence.has(person.identityConfidence) || !/^\d{4}-\d{2}-\d{2}$/.test(person.reviewedAt)) throw new Error(`Invalid person identity: ${person.id}`);
  people.set(person.id, person);
}
const offices = new Map();
for (const office of registry.offices) {
  if (offices.has(office.id) || !roles.includes(office.role) || office.id !== officeId(office.polityEntityId, office.role)) throw new Error(`Invalid office identity: ${office.id}`);
  offices.set(office.id, office);
}
const matches = (fact, observation, exactName, sourceId) => fact?.temporal.observedAt === observation
  && fact?.sourceId === sourceId && !fact.value.isVacant
  && fact.value.officeholders.some((holder) => holder.nameAndTitle === exactName);
const assertSources = (record) => {
  if (!record.sources.length || record.sources.some((source) => !source.publisher || !source.title || !/^https:\/\//.test(source.url))) throw new Error(`Missing evidence: ${record.entityId}`);
};
for (const context of registry.contexts) {
  assertSources(context);
  if (!people.has(context.personId) || context.roles.length !== context.officeIds.length) throw new Error(`Context has invalid person/office identity: ${context.personId}`);
  for (const [index, role] of context.roles.entries()) {
    const office = offices.get(context.officeIds[index]);
    if (!office || office.polityEntityId !== context.entityId || office.role !== role) throw new Error(`Context crosses office/polity identity: ${context.entityId} / ${role}`);
    const fact = countries.find((country) => country.id === context.entityId)?.facts[role];
    if (!matches(fact, context.archivedObservedAt, context.exactSourceName, context.sourceId)) throw new Error(`Context is detached from its source observation: ${context.entityId} / ${role}`);
  }
}
const updateIds = new Set();
for (const update of registry.officeUpdates) {
  assertSources(update);
  const key = `${update.entityId}:${update.role}`;
  if (updateIds.has(key)) throw new Error(`Ambiguous active office updates: ${key}`);
  updateIds.add(key);
  const fact = countries.find((country) => country.id === update.entityId)?.facts[update.role];
  const office = offices.get(update.officeId);
  if (!office || office.polityEntityId !== update.entityId || office.role !== update.role) throw new Error(`Office update crosses office/polity identity: ${key}`);
  if (!matches(fact, update.supersedes.observedAt, update.supersedes.exactSourceName, update.supersedes.sourceId)) throw new Error(`Office update no longer matches its archived predecessor: ${key}`);
  if (update.status !== 'reviewed_source_observation' || people.get(update.personId)?.canonicalName !== update.personName || !people.has(update.supersedes.personId) || !roles.includes(update.role) || !confidence.has(update.confidence) || !occupancy.has(update.occupancyStatus)) throw new Error(`Unreviewed or incomplete office update: ${key}`);
  if (update.observedAt < update.termStartedAt || update.reviewAfter <= update.observedAt) throw new Error(`Invalid office dates: ${key}`);
}
if (portraitPilot.schemaVersion !== '1.2.0' || !/not a current officeholder service/i.test(portraitPilot.purpose)) throw new Error('Portrait pilot lost its bounded-purpose caveat.');
const portraitPeople = new Map(portraitPilot.people.map((person) => [person.id, person]));
for (const person of portraitPilot.people) {
  if (people.get(person.id)?.canonicalName !== person.name) throw new Error(`Portrait identity differs from leadership authority: ${person.id}`);
}
for (const media of portraitPilot.media) {
  if (portraitPeople.get(media.personId)?.portraitMediaId !== media.id || !media.sourceUrl.startsWith('https://') || !media.licenseUrl.startsWith('https://') || !/^\d{4}-\d{2}-\d{2}$/.test(media.photoDate) || !/^\d{4}-\d{2}-\d{2}$/.test(media.reviewedAt) || media.photoDate > media.reviewedAt) throw new Error(`Incomplete portrait provenance: ${media.id}`);
}
for (const binding of portraitPilot.bindings) {
  const office = offices.get(binding.officeId);
  if (!office || office.polityEntityId !== binding.entityId || office.role !== binding.role || !portraitPeople.has(binding.personId) || !confidence.has(binding.identityConfidence) || !/^\d{4}-\d{2}-\d{2}$/.test(binding.reviewedAt) || binding.observedAt > binding.reviewedAt) throw new Error(`Invalid portrait office binding: ${binding.entityId} / ${binding.role}`);
  const fact = countries.find((country) => country.id === binding.entityId)?.facts[binding.role];
  if (!matches(fact, binding.observedAt, binding.exactSourceName, binding.sourceId)) throw new Error(`Portrait binding no longer matches its archived observation: ${binding.entityId} / ${binding.role}`);
}
const records = countries.flatMap((country) => roles.flatMap((role) => {
  const fact = country.facts[role];
  if (!fact) return [];
  const update = registry.officeUpdates.find((item) => item.entityId === country.id && item.role === role);
  const observedAt = update?.observedAt ?? fact.temporal.observedAt;
  const reviewDue = update ? asOf >= update.reviewAfter : due(observedAt);
  const principalCount = fact.value.officeholders.filter((holder) => holder.relationship === 'principal').length;
  const memberCount = fact.value.officeholders.filter((holder) => holder.relationship === 'member').length;
  const occupancyStatus = update?.occupancyStatus ?? (fact.value.isVacant ? 'vacant' : !fact.value.officeholders.length ? 'uncertain' : principalCount > 1 || memberCount > 1 ? 'collective' : 'occupied');
  return [{ entityId: country.id, officeId: officeId(country.id, role), role, name: update?.personName ?? fact.value.raw, observedAt, reviewDue, occupancyStatus, confidence: update?.confidence ?? 'unassessed', separateReviewedUpdate: Boolean(update) }];
}));
console.log(`Leadership review (${asOf}): ${records.length} office records; ${records.filter((item) => item.reviewDue).length} due or undated; ${registry.officeUpdates.length} separately reviewed updates. No data changed.`);
console.log(`Authority contracts verified: ${registry.people.length} reviewed people, ${registry.offices.length} explicit offices, ${portraitPilot.media.length} licensed media assets, ${portraitPilot.bindings.length} dated portrait bindings.`);
const pilotIds = new Set(registry.contexts.map((item) => item.entityId));
console.log(JSON.stringify(records.filter((item) => pilotIds.has(item.entityId)), null, 2));
if (process.argv.includes('--report-all')) console.log(JSON.stringify(records.filter((item) => item.reviewDue), null, 2));
if (process.argv.includes('--live')) {
  // This is an alerting check, never publication or authority to advance an observation date.
  for (const update of registry.officeUpdates) {
    const source = update.sources[0];
    const response = await fetch(source.url, { headers: { 'User-Agent': 'JJUniversityAtlas/2 (read-only leadership source check)' } });
    if (!response.ok) throw new Error(`Source unavailable; manual review needed: ${source.url} (${response.status})`);
    const body = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    if (!body.includes(update.personName)) throw new Error(`Office source no longer names ${update.personName}; inspect it before updating Atlas.`);
    console.log(`Source still contains ${update.personName}: ${source.url}. This is a text-presence check, not a new current-officeholder attestation.`);
  }
}
