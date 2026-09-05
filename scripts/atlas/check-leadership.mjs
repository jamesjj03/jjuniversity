import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/data/leadership-context.json'), 'utf8'));
const countries = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/data/countries.v1.json'), 'utf8')).countries;
const asOf = process.argv.find((arg) => arg.startsWith('--as-of='))?.split('=')[1] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))) throw new Error('Use --as-of=YYYY-MM-DD.');
const due = (observedAt) => !observedAt || !/^\d{4}-\d{2}-\d{2}$/.test(observedAt)
  || Date.parse(observedAt) > Date.parse(asOf)
  || Date.parse(asOf) - Date.parse(observedAt) >= registry.reviewPolicy.reviewAfterDays * 86400000;
const roles = ['headOfState', 'headOfGovernment'];
const matches = (fact, observation, exactName, sourceId) => fact?.temporal.observedAt === observation
  && fact?.sourceId === sourceId && !fact.value.isVacant
  && fact.value.officeholders.some((holder) => holder.nameAndTitle === exactName);
const assertSources = (record) => {
  if (!record.sources.length || record.sources.some((source) => !source.publisher || !source.title || !/^https:\/\//.test(source.url))) throw new Error(`Missing evidence: ${record.entityId}`);
};
for (const context of registry.contexts) {
  assertSources(context);
  for (const role of context.roles) {
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
  if (!matches(fact, update.supersedes.observedAt, update.supersedes.exactSourceName, update.supersedes.sourceId)) throw new Error(`Office update no longer matches its archived predecessor: ${key}`);
  if (update.status !== 'reviewed_source_observation' || !update.personId || !update.personName || !roles.includes(update.role)) throw new Error(`Unreviewed or incomplete office update: ${key}`);
  if (update.observedAt < update.termStartedAt || update.reviewAfter <= update.observedAt) throw new Error(`Invalid office dates: ${key}`);
}
const records = countries.flatMap((country) => roles.flatMap((role) => {
  const fact = country.facts[role];
  if (!fact) return [];
  const update = registry.officeUpdates.find((item) => item.entityId === country.id && item.role === role);
  const observedAt = update?.observedAt ?? fact.temporal.observedAt;
  return [{ entityId: country.id, role, name: update?.personName ?? fact.value.raw, observedAt, reviewDue: due(observedAt), separateReviewedUpdate: Boolean(update) }];
}));
console.log(`Leadership review (${asOf}): ${records.length} office records; ${records.filter((item) => item.reviewDue).length} due or undated; ${registry.officeUpdates.length} separately reviewed updates. No data changed.`);
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
