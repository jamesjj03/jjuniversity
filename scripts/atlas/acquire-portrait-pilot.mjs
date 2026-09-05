import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'lib/atlas-world/data/portrait-pilot.json');
const publicRoot = path.join(root, 'public/atlas/portraits');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const seeds = [
  { id: 'brice-oligui-nguema', personId: 'person:brice-oligui-nguema', name: 'Brice Oligui Nguema', title: 'President', entityId: 'country:GAB', exactSourceName: 'President Brice OLIGUI Nguema', file: 'Brice Oligui Nguema on November 26, 2024 (cropped).jpg', author: 'Lukasz Kobus / European Communities, 2024 / EC Audiovisual Service', licenseName: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', photoDate: '2024-11-26', changes: 'Commons portrait crop by Sashi Suseshi; resized and converted to WebP for Atlas. No generated detail or retouching.', attributionStatement: '© European Union, 2026. Photograph by Lukasz Kobus, taken 26 November 2024.', reviewedSourceSha256: 'eb253b6f90c0fda6e03f23f1038dbed6963c063074474e67c63ee4b1dc96316a', replacesSourceSha256: '1dd9be33ec5ae2ffb562fe9ff55e607fdf372b466439b443c28ffa8f77acbd3c' },
  { id: 'charles-iii', personId: 'person:charles-iii', name: 'Charles III', title: 'King', entityId: 'country:GBR', exactSourceName: 'King CHARLES III', file: 'King Charles III (July 2023).jpg', author: 'The White House', licenseName: 'Public domain', licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/', photoDate: '2023-07-10', changes: 'Commons portrait crop by TDKR Chicago 101, tonal adjustment by WikiPedant; resized and converted to WebP for Atlas.' },
  { id: 'keir-starmer', personId: 'person:keir-starmer', name: 'Keir Starmer', title: 'Prime Minister', entityId: 'country:GBR', exactSourceName: 'Prime Minister Keir STARMER', file: 'Keir Starmer official portrait (2x3 cropped).jpg', author: 'Simon Dawson / No 10 Downing Street', licenseName: 'OGL v3', licenseUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', photoDate: '2024-07-05', changes: 'Commons portrait crop; resized and converted to WebP for Atlas.', attributionStatement: 'Contains public sector information licensed under the Open Government Licence v3.0.' },
  { id: 'cyril-ramaphosa', personId: 'person:cyril-ramaphosa', name: 'Cyril Ramaphosa', title: 'President', entityId: 'country:ZAF', exactSourceName: 'President Matamela Cyril RAMAPHOSA', file: 'Cyril Ramaphosa 2024.jpg', author: 'Ricardo Stuckert / Presidency of Brazil', licenseName: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', photoDate: '2024-09-25', changes: 'Commons portrait crop by Segagustin; resized and converted to WebP for Atlas. The Atlas image derivative is also licensed CC BY-SA 2.0.' },
];

const countries = JSON.parse(await readFile(path.join(root, 'lib/atlas-world/data/countries.v1.json'), 'utf8')).countries;
let prior = null;
try { prior = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function verifyBindings(manifest) {
  for (const binding of manifest.bindings) {
    const expectedOfficeId = `office:${binding.entityId}:${binding.role === 'headOfState' ? 'head-of-state' : 'head-of-government'}`;
    if (binding.officeId !== expectedOfficeId || !['high', 'medium', 'low'].includes(binding.identityConfidence) || !/^\d{4}-\d{2}-\d{2}$/.test(binding.reviewedAt)) throw new Error(`Incomplete office identity review for ${binding.entityId}`);
    const fact = countries.find((country) => country.id === binding.entityId)?.facts[binding.role];
    if (fact?.sourceId !== binding.sourceId || fact?.temporal.observedAt !== binding.observedAt || !fact.value.officeholders.some((holder) => holder.nameAndTitle === binding.exactSourceName)) throw new Error(`Leadership snapshot changed; review portrait binding for ${binding.entityId}`);
  }
}
// Re-acquisition is reproduction, not permission to approve a new officeholder observation.
if (prior) verifyBindings(prior);

if (process.argv.includes('--acquire')) {
  await mkdir(publicRoot, { recursive: true });
  const manifest = { schemaVersion: '1.2.0', reviewedAt: '2026-09-05', purpose: 'Bounded visual identity pilot, not a current officeholder service.', people: [], media: [], bindings: [] };
  for (const seed of seeds) {
    const api = new URL('https://commons.wikimedia.org/w/api.php');
    api.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata|size', titles: `File:${seed.file}` });
    const response = await fetch(api, { headers: { 'User-Agent': 'JJUniversityAtlas/2.5 (licensed portrait pilot)' } });
    if (!response.ok) throw new Error(`Commons metadata returned ${response.status}`);
    const data = await response.json();
    const info = Object.values(data.query.pages)[0].imageinfo?.[0];
    if (!info) throw new Error(`No source for ${seed.id}`);
    const actualLicense = info.extmetadata.LicenseShortName?.value;
    if (actualLicense !== seed.licenseName && !(seed.licenseName === 'OGL v3' && actualLicense === 'OGL 3')) throw new Error(`Review license change for ${seed.id}: ${actualLicense}`);
    const inputUrl = info.url.split('?')[0];
    const assetResponse = await fetch(inputUrl);
    if (!assetResponse.ok) throw new Error(`Portrait returned ${assetResponse.status}`);
    const input = Buffer.from(await assetResponse.arrayBuffer());
    const sourceSha256 = hash(input);
    const priorMedia = prior?.media.find((media) => media.id === `media:${seed.id}`);
    if (seed.reviewedSourceSha256 && seed.reviewedSourceSha256 !== sourceSha256) throw new Error(`Reviewed source image changed for ${seed.id}.`);
    const reviewedReplacement = seed.reviewedSourceSha256 === sourceSha256 && seed.replacesSourceSha256 === priorMedia?.sourceSha256;
    if (priorMedia && priorMedia.sourceSha256 !== sourceSha256 && !reviewedReplacement) throw new Error(`Source image changed for ${seed.id}; review before updating its lock.`);
    const inputDimensions = await sharp(input).metadata();
    const output = await sharp(input).rotate().resize({ width: 560, withoutEnlargement: true }).webp({ quality: 92, effort: 6 }).toBuffer();
    const dimensions = await sharp(output).metadata();
    const href = `/atlas/portraits/${seed.id}.webp`;
    await writeFile(path.join(root, 'public', href), output);
    manifest.people.push({ id: seed.personId, name: seed.name, portraitMediaId: `media:${seed.id}` });
    manifest.media.push({ id: `media:${seed.id}`, personId: seed.personId, href, width: dimensions.width, height: dimensions.height, sourceWidth: inputDimensions.width, sourceHeight: inputDimensions.height, derivation: '560px maximum width, no enlargement, WebP quality 92', author: seed.author, licenseName: seed.licenseName, licenseUrl: seed.licenseUrl, attributionStatement: seed.attributionStatement ?? null, changes: seed.changes, photoDate: seed.photoDate, sourceUrl: info.descriptionurl, sourceCreditHtml: info.extmetadata.Credit?.value ?? null, inputUrl, sourceSha256, outputSha256: hash(output), bytes: output.length, reviewedAt: '2026-09-05' });
    const country = countries.find((candidate) => candidate.id === seed.entityId);
    for (const role of ['headOfState', 'headOfGovernment']) {
      const fact = country.facts[role];
      if (fact?.value.officeholders.some((holder) => holder.nameAndTitle === seed.exactSourceName)) {
        manifest.bindings.push({ officeId: `office:${country.id}:${role === 'headOfState' ? 'head-of-state' : 'head-of-government'}`, entityId: country.id, role, personId: seed.personId, title: seed.title, exactSourceName: seed.exactSourceName, sourceId: fact.sourceId, observedAt: fact.temporal.observedAt, identityConfidence: 'high', reviewedAt: '2026-09-05' });
      }
    }
    console.log(`${seed.name}: ${output.length} bytes, ${actualLicense}`);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  prior = manifest;
}

if (!prior) throw new Error('Run with --acquire first.');
for (const media of prior.media) {
  const bytes = await readFile(path.join(root, 'public', media.href));
  if (hash(bytes) !== media.outputSha256) throw new Error(`Asset checksum mismatch: ${media.id}`);
  if (!media.sourceSha256 || !media.licenseUrl || !media.author) throw new Error(`Incomplete provenance: ${media.id}`);
  const dimensions = await sharp(bytes).metadata();
  if (dimensions.width !== media.width || dimensions.height !== media.height) throw new Error(`Asset dimension mismatch: ${media.id}`);
  if (dimensions.width < 448 || media.sourceWidth < dimensions.width || media.bytes > 190_000) throw new Error(`Portrait density or payload budget failed: ${media.id}`);
}
verifyBindings(prior);
console.log(`Portrait pilot verified: ${prior.people.length} people, ${new Set(prior.bindings.map((binding) => binding.entityId)).size} countries; identity, source dates, licensing and asset checksums intact.`);
