import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const projectRoot = process.cwd();
const intakeRoot = join(
  projectRoot,
  "workshop",
  "audio-intake",
  "everything-i-touch-turns-to-tacos",
);
const intakeManifestPath = join(intakeRoot, "intake-manifest.json");
const envPath = join(projectRoot, ".env.local");

const BOOK_ID = "tacos";
const BOOK_SLUG = "everything-i-touch-turns-to-tacos";
const EDITION_KEY = "standard";
const AUDIO_BUCKET = "audiobooks";
const NARRATOR_NAME = "James Johnson";
const EXPECTED_LIVE_CONTENT_VERSION = 1;
const EXPECTED_LIVE_CONTENT_SHA256 = "6603471a78d74ff63cae6b527b4bd10365724d67bf40c597a28614f67ea6923c";
const EXPECTED_ORDERED_MANIFEST_SHA256 = "b6db4f1ab150bb63f801bf3fca0e8f62558fd5428163e0c2944f37c062ccb4be";
const EXPECTED_LOCAL_SOURCE_SHA256 = "6a6495d8bb7690e2e7c2afc7ff46a944a760d9b3f19c95378812f254d662d76c";
const EXPECTED_TOTAL_BYTES = 49_834_256;
const EXPECTED_TOTAL_SECONDS = 1246.875408;
const EXPECTED_REPLACEMENTS = new Map([
  [14, "7901a1061488af6ef74321bc0806ece9ea62de0aa5073522d8e3cd846394fd6f"],
  [15, "5da4628032f08ac964fe9f774968fc190be74f22de5697b6b93173cd06e7966e"],
]);

const EDITION_SELECT = [
  "id",
  "book_id",
  "source_content_version",
  "source_content_sha256",
  "edition_key",
  "narrator_name",
  "language_code",
  "status",
  "access_model",
  "description",
  "total_seconds",
  "published_at",
].join(",");
const TRACK_SELECT = [
  "id",
  "edition_id",
  "position",
  "title",
  "section_key",
  "required_for_submission",
  "storage_bucket",
  "storage_path",
  "mime_type",
  "file_size_bytes",
  "duration_seconds",
  "sha256",
  "status",
  "published_at",
].join(",");

await main().catch(error => {
  console.error(`Tacos audio pilot failed: ${safeMessage(error)}`);
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    printHelp();
    return;
  }
  const unknownArgs = [...args].filter(arg => arg !== "--apply");
  assert(!unknownArgs.length, `Unknown argument(s): ${unknownArgs.join(", ")}`);
  const apply = args.has("--apply");

  loadLocalEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  assert(supabaseUrl && serviceRoleKey, "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");

  const localPlan = buildLocalPlan();
  printLocalSummary(localPlan, apply);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  await validateLiveBook(supabase, localPlan);
  await validatePrivateBucket(supabase, localPlan);

  const initialDatabase = await readDatabaseState(supabase, localPlan);
  validateDatabaseState(initialDatabase, localPlan, { allowMissing: true });

  const initialObjects = await inspectStorageObjects(supabase, localPlan);
  const missingObjects = initialObjects.filter(item => !item.present);
  if (initialDatabase.edition?.status === "published" && missingObjects.length) {
    fail("The existing edition is published but one or more private objects are missing. Move it back to QA before any repair.");
  }

  console.log(`Live checks passed: Reader version ${EXPECTED_LIVE_CONTENT_VERSION}, 16 canonical tracks, private bucket.`);
  console.log(`Storage: ${initialObjects.length - missingObjects.length} exact object(s) present; ${missingObjects.length} upload(s) needed.`);
  if (localPlan.releaseBlockers.length) {
    console.log(`Release gate: BLOCKED (${localPlan.releaseBlockers.length} unresolved intake check(s)).`);
    localPlan.releaseBlockers.forEach(blocker => console.log(`- ${blocker}`));
  } else {
    console.log("Release gate: ready for publication.");
  }

  if (!apply) {
    console.log("Dry run complete. No database row, Storage object, feature flag, or deployment was changed.");
    if (localPlan.releaseBlockers.length) {
      console.log("Apply remains disabled until the ignored intake manifest records resolved version and mastering approval.");
    } else {
      console.log("Apply only this sealed pilot with: npm run audio:ingest:tacos -- --apply");
    }
    return;
  }

  assert(!localPlan.releaseBlockers.length, `Publication blocked: ${localPlan.releaseBlockers.join("; ")}`);

  await uploadMissingObjects(supabase, localPlan, missingObjects);
  const verifiedObjects = await inspectStorageObjects(supabase, localPlan);
  assert(verifiedObjects.every(item => item.present), "Not every private audio object was verified after upload.");
  console.log("All 16 private Storage objects match their local byte counts and SHA-256 hashes.");

  const edition = await ensureEdition(supabase, localPlan, initialDatabase.edition);
  await ensureTracks(supabase, localPlan, edition);

  const stagedDatabase = await readDatabaseState(supabase, localPlan);
  validateDatabaseState(stagedDatabase, localPlan, { allowMissing: false });
  assert(stagedDatabase.edition?.id === edition.id, "The staged edition identity changed unexpectedly.");

  if (stagedDatabase.edition.status !== "published") {
    await publishTracks(supabase, stagedDatabase, localPlan);
    await publishEdition(supabase, stagedDatabase.edition);
  }

  const finalDatabase = await readDatabaseState(supabase, localPlan);
  validateDatabaseState(finalDatabase, localPlan, { allowMissing: false, requirePublished: true });
  await assertOnlyTacosIsPublished(supabase, finalDatabase.edition.id);

  const finalObjects = await inspectStorageObjects(supabase, localPlan);
  assert(finalObjects.every(item => item.present), "A private audio object failed final verification.");

  console.log(`Published one free Tacos edition with ${localPlan.tracks.length} tracks (${formatDuration(localPlan.totalSeconds)}).`);
  console.log(`Edition ID: ${finalDatabase.edition.id}`);
  console.log("Narrator portal data, JJU_NARRATOR_PORTAL_ENABLED, Vercel environment variables, and deployments were not touched.");
}

function buildLocalPlan() {
  assert(existsSync(intakeManifestPath), `Missing ignored intake manifest: ${intakeManifestPath}`);
  const manifest = parseJsonFile(intakeManifestPath, "intake manifest");
  assert(Number(manifest.schemaVersion) === 1, "Unsupported intake manifest schema.");
  assert(manifest.book?.id === BOOK_ID, `Expected manifest book id "${BOOK_ID}".`);
  assert(manifest.book?.slug === BOOK_SLUG, `Expected manifest slug "${BOOK_SLUG}".`);
  assert(normalizeHash(manifest.book?.sourceSha256) === EXPECTED_LOCAL_SOURCE_SHA256, "The intake source hash changed.");

  const releaseBlockers = [];
  if (String(manifest.status || "") !== "approved-for-publication") {
    releaseBlockers.push(`manifest status is "${String(manifest.status || "missing")}", not "approved-for-publication"`);
  }
  if (String(manifest.technical?.waveformMasteringQa || "") !== "pass") {
    releaseBlockers.push(`waveform/mastering QA is "${String(manifest.technical?.waveformMasteringQa || "missing")}", not "pass"`);
  }
  const unresolvedVersions = (Array.isArray(manifest.emailVersionEvidence) ? manifest.emailVersionEvidence : [])
    .filter(item => /confirm|pending|unresolved/i.test(String(item?.status || "")))
    .map(item => Number(item?.position))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  if (unresolvedVersions.length) {
    releaseBlockers.push(`approved email/archive version is unresolved for track(s) ${unresolvedVersions.join(", ")}`);
  }

  const sourcePath = join(projectRoot, ...String(manifest.book.sourceFile || "").split("/"));
  assert(existsSync(sourcePath), `Missing local Reader source: ${sourcePath}`);
  const sourceBytes = readFileSync(sourcePath);
  assert(sha256(sourceBytes) === EXPECTED_LOCAL_SOURCE_SHA256, "The local Tacos Reader source no longer matches the sealed intake.");
  const localContent = parseJson(sourceBytes.toString("utf8"), "local Tacos Reader source");
  const orderedSections = buildOrderedSectionManifest(localContent);
  assert(orderedSections.length === 16, `Expected 16 non-TOC Reader sections; found ${orderedSections.length}.`);
  assert(stableSha256(orderedSections) === EXPECTED_ORDERED_MANIFEST_SHA256, "The local ordered Reader manifest changed.");

  const originalTracks = Array.isArray(manifest.tracks) ? [...manifest.tracks] : [];
  assert(originalTracks.length === 16, `Expected 16 intake tracks; found ${originalTracks.length}.`);
  originalTracks.sort((a, b) => Number(a.position) - Number(b.position));
  assertPositions(originalTracks, "intake tracks");

  const replacementList = Array.isArray(manifest.replacementCandidates) ? manifest.replacementCandidates : [];
  assert(replacementList.length === 2, `Expected exactly two corrected email replacements; found ${replacementList.length}.`);
  const replacements = new Map(replacementList.map(item => [Number(item.position), item]));
  assert([...replacements.keys()].sort((a, b) => a - b).join(",") === "14,15", "Only positions 14 and 15 may use email replacements.");

  const tracks = originalTracks.map((original, index) => {
    const position = index + 1;
    const canonical = orderedSections[index];
    assert(Number(original.position) === position, `Intake position ${position} is missing or out of order.`);
    assert(String(original.sectionKey || "") === canonical.sectionKey, `Position ${position} section key does not match the Reader.`);
    assert(String(original.canonicalTitle || "") === canonical.title, `Position ${position} title does not match the Reader.`);

    const replacement = replacements.get(position);
    const candidate = replacement || original;
    if (replacement) {
      assert(normalizeHash(replacement.sha256) === EXPECTED_REPLACEMENTS.get(position), `Corrected email track ${position} hash changed.`);
      assert(/canonical-content-aligned/i.test(String(replacement.mappingStatus || "")), `Corrected email track ${position} is not marked content-aligned.`);
      assert(/reject/i.test(String(original.mappingStatus || "")), `The bad ZIP track ${position} is not sealed as rejected.`);
    } else {
      assert(!/reject|wrong-content/i.test(String(original.mappingStatus || "")), `Position ${position} is marked as rejected or wrong content.`);
    }

    const relativePath = String(candidate.relativePath || `extracted-tracks/${candidate.fileName || ""}`);
    assert(relativePath && !relativePath.includes(".."), `Unsafe local path for position ${position}.`);
    const localPath = join(intakeRoot, ...relativePath.split("/"));
    assert(existsSync(localPath), `Missing candidate file for position ${position}: ${relativePath}`);
    const bytes = readFileSync(localPath);
    const observedBytes = statSync(localPath).size;
    const expectedBytes = Number(candidate.bytes || 0);
    const expectedHash = normalizeHash(candidate.sha256);
    assert(observedBytes === expectedBytes, `Position ${position} byte count changed (${observedBytes} != ${expectedBytes}).`);
    assert(sha256(bytes) === expectedHash, `Position ${position} SHA-256 changed.`);
    assert(expectedBytes > 0 && expectedBytes <= 52_428_800, `Position ${position} is outside the 50 MB Storage limit.`);

    const publicTitle = position === 16 ? "Closing Credits & Copyright" : canonical.title;
    const storagePath = `${BOOK_SLUG}/${EDITION_KEY}/${String(position).padStart(2, "0")}-${expectedHash.slice(0, 16)}.mp3`;
    return {
      position,
      canonicalTitle: canonical.title,
      title: publicTitle,
      sectionKey: canonical.sectionKey,
      localPath,
      relativePath,
      fileName: String(candidate.fileName || ""),
      bytes: expectedBytes,
      sha256: expectedHash,
      durationSecondsExact: Number(candidate.durationSeconds || 0),
      durationSeconds: Math.round(Number(candidate.durationSeconds || 0)),
      storagePath,
    };
  });

  assert(new Set(tracks.map(track => track.sha256)).size === tracks.length, "The candidate publication set contains duplicate audio content hashes.");
  const totalBytes = tracks.reduce((sum, track) => sum + track.bytes, 0);
  const totalSeconds = tracks.reduce((sum, track) => sum + track.durationSecondsExact, 0);
  assert(totalBytes === EXPECTED_TOTAL_BYTES, `Candidate byte total changed (${totalBytes} != ${EXPECTED_TOTAL_BYTES}).`);
  assert(Math.abs(totalSeconds - EXPECTED_TOTAL_SECONDS) < 0.000_001, `Candidate duration changed (${totalSeconds} != ${EXPECTED_TOTAL_SECONDS}).`);

  return {
    tracks,
    totalBytes,
    totalSeconds,
    totalSecondsRounded: Math.round(totalSeconds),
    localContent,
    orderedSections,
    releaseBlockers,
  };
}

async function validateLiveBook(supabase, localPlan) {
  const catalogResult = await supabase
    .from("book_catalog")
    .select("id,slug,title,status,visibility")
    .eq("id", BOOK_ID)
    .maybeSingle();
  throwIfError(catalogResult.error, "Could not read the live Tacos catalog row");
  const catalog = catalogResult.data;
  assert(catalog?.id === BOOK_ID, "The live Tacos catalog row is missing.");
  assert(catalog.slug === BOOK_SLUG, "The live Tacos slug changed.");
  assert(catalog.status === "ready", "The live Tacos catalog row is not ready.");
  assert(["main", "archive"].includes(String(catalog.visibility || "")), "The live Tacos catalog row is not publicly readable.");

  const contentResult = await supabase
    .from("book_content_live")
    .select("book_id,version_number,content")
    .eq("book_id", BOOK_ID)
    .maybeSingle();
  throwIfError(contentResult.error, "Could not read the live Tacos manuscript");
  const live = contentResult.data;
  assert(live?.book_id === BOOK_ID && live.content, "The live Tacos manuscript is missing.");
  assert(Number(live.version_number) === EXPECTED_LIVE_CONTENT_VERSION, `Live Tacos content version changed (${live.version_number}).`);
  assert(stableSha256(live.content) === EXPECTED_LIVE_CONTENT_SHA256, "Live Tacos content SHA-256 changed.");

  const liveSections = buildOrderedSectionManifest(live.content);
  assert(stableSha256(liveSections) === EXPECTED_ORDERED_MANIFEST_SHA256, "Live Tacos track ordering changed.");
  assert(stableJson(liveSections) === stableJson(localPlan.orderedSections), "Live and local Reader section manifests differ.");

  const liveReadableSections = readableSections(live.content);
  const localReadableSections = readableSections(localPlan.localContent);
  assert(liveReadableSections.length === localReadableSections.length, "Live and local Reader section counts differ.");
  liveReadableSections.forEach((section, index) => {
    const local = localReadableSections[index];
    assert(String(section.text || "") === String(local.text || ""), `Live Reader text differs at audio position ${index + 1}.`);
    assert(String(section.html || "") === String(local.html || ""), `Live Reader HTML differs at audio position ${index + 1}.`);
  });
}

async function validatePrivateBucket(supabase, localPlan) {
  const result = await supabase.storage.getBucket(AUDIO_BUCKET);
  throwIfError(result.error, `Private bucket "${AUDIO_BUCKET}" is unavailable; apply the reviewed audio migration first`);
  const bucket = result.data;
  assert(bucket, `Private bucket "${AUDIO_BUCKET}" is missing.`);
  assert(bucket.public === false, `Bucket "${AUDIO_BUCKET}" must remain private.`);

  const fileSizeLimit = Number(bucket.file_size_limit ?? bucket.fileSizeLimit ?? 0);
  const largestTrack = Math.max(...localPlan.tracks.map(track => track.bytes));
  if (fileSizeLimit > 0) {
    assert(fileSizeLimit >= largestTrack, `Bucket "${AUDIO_BUCKET}" has a file limit below the largest pilot track.`);
  }
  const allowedMimeTypes = bucket.allowed_mime_types ?? bucket.allowedMimeTypes;
  if (Array.isArray(allowedMimeTypes) && allowedMimeTypes.length) {
    assert(allowedMimeTypes.includes("audio/mpeg"), `Bucket "${AUDIO_BUCKET}" does not allow audio/mpeg.`);
  }
}

async function readDatabaseState(supabase, localPlan) {
  const publishedResult = await supabase
    .from("audio_editions")
    .select("id,book_id,edition_key,status")
    .eq("status", "published");
  throwIfError(publishedResult.error, "Audio tables are unavailable; apply the reviewed audio migration first");
  const foreignPublished = (publishedResult.data || []).filter(row => row.book_id !== BOOK_ID || row.edition_key !== EDITION_KEY);
  assert(!foreignPublished.length, "Another audiobook edition is already published; this sealed script only activates the Tacos pilot.");

  const editionResult = await supabase
    .from("audio_editions")
    .select(EDITION_SELECT)
    .eq("book_id", BOOK_ID)
    .eq("edition_key", EDITION_KEY)
    .maybeSingle();
  throwIfError(editionResult.error, "Could not inspect the standard Tacos audio edition");
  const edition = editionResult.data || null;

  let tracks = [];
  if (edition) {
    const trackResult = await supabase
      .from("audio_tracks")
      .select(TRACK_SELECT)
      .eq("edition_id", edition.id)
      .order("position", { ascending: true });
    throwIfError(trackResult.error, "Could not inspect Tacos audio tracks");
    tracks = trackResult.data || [];
  }
  return { edition, tracks, totalExpectedTracks: localPlan.tracks.length };
}

function validateDatabaseState(state, localPlan, { allowMissing, requirePublished = false }) {
  if (!state.edition) {
    assert(allowMissing, "The standard Tacos edition is missing after staging.");
    assert(!state.tracks.length, "Track rows exist without their expected edition.");
    return;
  }

  const expectedEdition = editionCore(localPlan);
  for (const [key, value] of Object.entries(expectedEdition)) {
    assert(compareValue(state.edition[key], value), `Existing edition field "${key}" does not match the sealed Tacos plan.`);
  }
  assert(["qa", "published"].includes(state.edition.status), `Existing edition has unsupported status "${state.edition.status}".`);
  if (requirePublished) {
    assert(state.edition.status === "published" && state.edition.published_at, "The Tacos edition was not published atomically last.");
  }

  const expectedByPosition = new Map(localPlan.tracks.map(track => [track.position, track]));
  const observedPositions = new Set();
  for (const row of state.tracks) {
    const position = Number(row.position);
    const expected = expectedByPosition.get(position);
    assert(expected, `Unexpected track position ${position} exists in the standard Tacos edition.`);
    assert(!observedPositions.has(position), `Duplicate database track position ${position}.`);
    observedPositions.add(position);
    validateTrackRow(row, state.edition.id, expected, requirePublished);
  }

  if (!allowMissing) {
    assert(state.tracks.length === localPlan.tracks.length, `Expected 16 database tracks; found ${state.tracks.length}.`);
    assert(observedPositions.size === localPlan.tracks.length, "One or more canonical database tracks are missing.");
  }
}

function validateTrackRow(row, editionId, expected, requirePublished) {
  const fields = {
    edition_id: editionId,
    position: expected.position,
    title: expected.title,
    section_key: expected.sectionKey,
    required_for_submission: true,
    storage_bucket: AUDIO_BUCKET,
    storage_path: expected.storagePath,
    mime_type: "audio/mpeg",
    file_size_bytes: expected.bytes,
    duration_seconds: expected.durationSeconds,
    sha256: expected.sha256,
  };
  for (const [key, value] of Object.entries(fields)) {
    const observed = key === "sha256" ? normalizeHash(row[key]) : row[key];
    assert(compareValue(observed, value), `Existing database track ${expected.position} field "${key}" does not match the sealed plan.`);
  }
  assert(["qa", "published"].includes(row.status), `Track ${expected.position} has unsupported status "${row.status}".`);
  if (requirePublished) {
    assert(row.status === "published" && row.published_at, `Track ${expected.position} is not published.`);
  }
}

async function inspectStorageObjects(supabase, localPlan) {
  const states = [];
  for (const track of localPlan.tracks) {
    states.push(await inspectStorageObject(supabase, track));
  }
  return states;
}

async function inspectStorageObject(supabase, track) {
  const slashIndex = track.storagePath.lastIndexOf("/");
  const folder = track.storagePath.slice(0, slashIndex);
  const fileName = track.storagePath.slice(slashIndex + 1);
  const listResult = await supabase.storage
    .from(AUDIO_BUCKET)
    .list(folder, { limit: 100, offset: 0, search: fileName });
  throwIfError(listResult.error, `Could not inspect private object ${track.position}`);
  const item = (listResult.data || []).find(candidate => candidate.name === fileName);
  if (!item) return { track, present: false };

  const metadataSize = Number(item.metadata?.size ?? item.metadata?.contentLength ?? 0);
  if (metadataSize > 0) {
    assert(metadataSize === track.bytes, `Private object ${track.position} has a mismatched metadata size.`);
  }

  const downloadResult = await supabase.storage.from(AUDIO_BUCKET).download(track.storagePath);
  throwIfError(downloadResult.error, `Could not download private object ${track.position} for verification`);
  const remoteBytes = Buffer.from(await downloadResult.data.arrayBuffer());
  assert(remoteBytes.byteLength === track.bytes, `Private object ${track.position} byte count does not match.`);
  assert(sha256(remoteBytes) === track.sha256, `Private object ${track.position} SHA-256 does not match; it will not be overwritten.`);
  return { track, present: true };
}

async function uploadMissingObjects(supabase, localPlan, missingObjects) {
  const missingPaths = new Set(missingObjects.map(item => item.track.storagePath));
  for (const track of localPlan.tracks) {
    if (!missingPaths.has(track.storagePath)) continue;
    const body = readFileSync(track.localPath);
    const uploadResult = await supabase.storage.from(AUDIO_BUCKET).upload(track.storagePath, body, {
      cacheControl: "3600",
      contentType: "audio/mpeg",
      upsert: false,
    });
    if (uploadResult.error && !/already exists|duplicate/i.test(uploadResult.error.message || "")) {
      throw new Error(`Could not upload private track ${track.position}: ${uploadResult.error.message}`);
    }
    const verified = await inspectStorageObject(supabase, track);
    assert(verified.present, `Private track ${track.position} was not visible after upload.`);
    console.log(`Verified private upload ${track.position}/16 (${formatBytes(track.bytes)}).`);
  }
}

async function ensureEdition(supabase, localPlan, existing) {
  if (existing) return existing;
  const row = {
    id: randomUUID(),
    ...editionCore(localPlan),
    status: "qa",
    published_at: null,
  };
  const insertResult = await supabase.from("audio_editions").insert(row).select(EDITION_SELECT).single();
  if (!insertResult.error && insertResult.data) return insertResult.data;
  if (insertResult.error?.code !== "23505") {
    throwIfError(insertResult.error, "Could not create the standard Tacos audio edition");
  }

  const concurrentResult = await supabase
    .from("audio_editions")
    .select(EDITION_SELECT)
    .eq("book_id", BOOK_ID)
    .eq("edition_key", EDITION_KEY)
    .maybeSingle();
  throwIfError(concurrentResult.error, "Could not inspect the concurrently created Tacos edition");
  const state = { edition: concurrentResult.data, tracks: [] };
  validateDatabaseState(state, localPlan, { allowMissing: true });
  return concurrentResult.data;
}

async function ensureTracks(supabase, localPlan, edition) {
  const existingResult = await supabase
    .from("audio_tracks")
    .select(TRACK_SELECT)
    .eq("edition_id", edition.id)
    .order("position", { ascending: true });
  throwIfError(existingResult.error, "Could not read staged Tacos tracks");
  const existingByPosition = new Map((existingResult.data || []).map(row => [Number(row.position), row]));

  for (const track of localPlan.tracks) {
    const existing = existingByPosition.get(track.position);
    if (existing) {
      validateTrackRow(existing, edition.id, track, false);
      continue;
    }
    const row = {
      id: randomUUID(),
      edition_id: edition.id,
      position: track.position,
      title: track.title,
      section_key: track.sectionKey,
      required_for_submission: true,
      storage_bucket: AUDIO_BUCKET,
      storage_path: track.storagePath,
      mime_type: "audio/mpeg",
      file_size_bytes: track.bytes,
      duration_seconds: track.durationSeconds,
      sha256: track.sha256,
      status: "qa",
      published_at: null,
    };
    const insertResult = await supabase.from("audio_tracks").insert(row).select(TRACK_SELECT).single();
    if (insertResult.error?.code === "23505") {
      const concurrentResult = await supabase
        .from("audio_tracks")
        .select(TRACK_SELECT)
        .eq("edition_id", edition.id)
        .eq("position", track.position)
        .maybeSingle();
      throwIfError(concurrentResult.error, `Could not inspect concurrently created track ${track.position}`);
      assert(concurrentResult.data, `Track ${track.position} conflicted but could not be read.`);
      validateTrackRow(concurrentResult.data, edition.id, track, false);
      continue;
    }
    throwIfError(insertResult.error, `Could not create track ${track.position}`);
    validateTrackRow(insertResult.data, edition.id, track, false);
  }
}

async function publishTracks(supabase, database, localPlan) {
  const expectedByPosition = new Map(localPlan.tracks.map(track => [track.position, track]));
  for (const row of database.tracks) {
    const expected = expectedByPosition.get(Number(row.position));
    assert(expected, `Unexpected staged track ${row.position}.`);
    if (row.status === "published") continue;
    assert(row.status === "qa", `Track ${row.position} is not in QA.`);
    const publishedAt = new Date().toISOString();
    const updateResult = await supabase
      .from("audio_tracks")
      .update({ status: "published", published_at: publishedAt })
      .eq("id", row.id)
      .eq("edition_id", database.edition.id)
      .eq("status", "qa")
      .select(TRACK_SELECT)
      .maybeSingle();
    throwIfError(updateResult.error, `Could not publish track ${row.position}`);
    assert(updateResult.data, `Track ${row.position} changed state before publication.`);
    validateTrackRow(updateResult.data, database.edition.id, expected, true);
  }
}

async function publishEdition(supabase, edition) {
  assert(edition.status === "qa", `Edition is not in QA (found "${edition.status}").`);
  const publishedAt = new Date().toISOString();
  const updateResult = await supabase
    .from("audio_editions")
    .update({ status: "published", published_at: publishedAt })
    .eq("id", edition.id)
    .eq("status", "qa")
    .select(EDITION_SELECT)
    .maybeSingle();
  throwIfError(updateResult.error, "Could not publish the Tacos edition");
  assert(updateResult.data?.status === "published", "The Tacos edition changed state before publication.");
}

async function assertOnlyTacosIsPublished(supabase, editionId) {
  const result = await supabase
    .from("audio_editions")
    .select("id,book_id,edition_key,status")
    .eq("status", "published");
  throwIfError(result.error, "Could not verify the final published-edition scope");
  assert(result.data?.length === 1, `Expected exactly one published audiobook; found ${result.data?.length || 0}.`);
  const row = result.data[0];
  assert(row.id === editionId && row.book_id === BOOK_ID && row.edition_key === EDITION_KEY, "A non-Tacos audiobook is published.");
}

function editionCore(localPlan) {
  return {
    book_id: BOOK_ID,
    source_content_version: EXPECTED_LIVE_CONTENT_VERSION,
    source_content_sha256: EXPECTED_LIVE_CONTENT_SHA256,
    edition_key: EDITION_KEY,
    narrator_name: NARRATOR_NAME,
    language_code: "en",
    access_model: "free",
    description: "Narrated by James Johnson.",
    total_seconds: localPlan.totalSecondsRounded,
  };
}

function buildOrderedSectionManifest(content) {
  return readableSections(content).map((section, index) => ({
    position: index + 1,
    sectionKey: String(section.id || ""),
    index: Number(section.index),
    title: String(section.title || ""),
    kind: String(section.kind || ""),
  }));
}

function readableSections(content) {
  const sections = Array.isArray(content?.sections) ? [...content.sections] : [];
  return sections
    .filter(section => String(section.kind || "").toLowerCase() !== "toc" && !/^contents$/i.test(String(section.title || "").trim()))
    .sort((a, b) => Number(a.index) - Number(b.index));
}

function assertPositions(items, label) {
  items.forEach((item, index) => {
    assert(Number(item.position) === index + 1, `${label} must contain contiguous positions 1-${items.length}.`);
  });
}

function loadLocalEnv() {
  assert(existsSync(envPath), `Missing local environment file: ${envPath}`);
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function parseJsonFile(filePath, label) {
  return parseJson(readFileSync(filePath, "utf8"), label);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Could not parse ${label}.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableSha256(value) {
  return sha256(stableJson(value));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  );
}

function normalizeHash(value) {
  return String(value || "").trim().toLowerCase();
}

function compareValue(observed, expected) {
  if (typeof expected === "number") return Number(observed) === expected;
  if (typeof expected === "boolean") return Boolean(observed) === expected;
  return String(observed ?? "") === String(expected ?? "");
}

function throwIfError(error, message) {
  if (!error) return;
  throw new Error(`${message}: ${safeMessage(error)}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  throw new Error(message);
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error?.message || error || "Unknown error");
  return message
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/(service_role|apikey|authorization)=?[^\s,;]+/gi, "$1=[redacted]");
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function printLocalSummary(localPlan, apply) {
  console.log(`${apply ? "Apply" : "Dry run"}: sealed Tacos-only audio pilot.`);
  console.log(`Local candidate: ${localPlan.tracks.length} tracks, ${formatBytes(localPlan.totalBytes)}, ${formatDuration(localPlan.totalSeconds)}.`);
  console.log("Corrections: email track 14 = Acknowledgements; email track 15 = About the Author.");
  console.log("Track 16 public title: Closing Credits & Copyright.");
}

function printHelp() {
  console.log("JJ University Tacos audio pilot ingestion");
  console.log("");
  console.log("Dry-run local, live Reader, database, bucket, and existing-object checks:");
  console.log("  npm run audio:ingest:tacos");
  console.log("");
  console.log("Upload and publish only after the intake manifest passes every release gate:");
  console.log("  npm run audio:ingest:tacos -- --apply");
  console.log("");
  console.log("This script never changes Vercel flags, deployments, or narrator portal data.");
}
