import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const { loadEnvConfig } = nextEnv;
const outputRoot = resolve(root, "tmp", "manuscript-bold-removal");
const proseTags = new Set(["p", "li", "blockquote", "td", "th", "dd", "dt", "figcaption"]);
const voidTags = new Set(["br", "hr", "img", "meta", "link", "input", "source", "wbr"]);
const backMatterPattern = /^(acknowledg(e)?ments?|about( the)? author|copyright( disclaimer)?|back matter)$/;
const standardBodyTitlePattern = /^(chapter\b|part\b|book\b|section\b|introduction\b|prologue\b|interlude\b|epilogue\b|conclusion\b|afterword\b|appendix\b)/;

const command = process.argv[2] || "help";
const batchArg = argValue("--batch");
const confirmSha256 = argValue("--confirm-sha256");

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "backup") {
    await createSealedBackupAndDryRun();
  } else if (command === "verify") {
    if (!batchArg) fail("verify requires --batch=<batch-id>");
    await verifySealedBatch(resolveBatch(batchArg));
  } else if (command === "preflight") {
    requireLiveCommandArguments("preflight");
    const state = argValue("--state") || "apply";
    if (state !== "apply" && state !== "rollback") fail("preflight --state must be apply or rollback");
    const context = await loadApplyContext(resolveBatch(batchArg), confirmSha256, state);
    console.log(JSON.stringify(summarizePreflight(context), null, 2));
  } else if (command === "apply") {
    requireLiveCommandArguments("apply");
    await applySealedBatch(resolveBatch(batchArg), confirmSha256);
  } else if (command === "rollback") {
    requireLiveCommandArguments("rollback");
    await rollbackSealedBatch(resolveBatch(batchArg), confirmSha256);
  } else {
    fail(`Unknown command: ${command}`);
  }
}

function printHelp() {
  console.log(`JJ University manuscript bold cleanup\n\nCommands:\n  backup                                                   Read live Supabase and local fallback, create a sealed backup, and run the prose-only dry run.\n  verify --batch=<id>                                      Verify every sealed file hash and rerun dry-run validation from the backup.\n  preflight --state=apply|rollback --batch=<id> --confirm-sha256=<h>\n                                                           Recheck the seal, guarded live state, and local fallback without writing.\n  apply --batch=<id> --confirm-sha256=<hash>               Archive and apply one explicitly approved sealed batch with optimistic guards.\n  rollback --batch=<id> --confirm-sha256=<h>               Append-only guarded rollback to the sealed original content.\n\nApply and rollback require the exact sealed SHA-256 digest. They create immutable execution reports and never expose credentials.`);
}

function requireLiveCommandArguments(name) {
  if (!batchArg) fail(`${name} requires --batch=<batch-id>`);
  if (!/^[a-f0-9]{64}$/i.test(confirmSha256)) {
    fail(`${name} requires the exact --confirm-sha256=<64-character seal digest>`);
  }
}

async function loadApplyContext(batchDir, expectedSealDigest, expectedState) {
  await verifySealedBatch(batchDir, { quiet: true });
  const sealDigest = (await readFile(join(batchDir, "SHA256SUMS.sha256"), "utf8")).trim().split(/\s+/)[0];
  if (sealDigest !== expectedSealDigest.toLowerCase()) {
    fail(`Seal confirmation mismatch. Expected ${sealDigest}; received ${expectedSealDigest}.`);
  }

  loadEnvConfig(root);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) fail("Supabase admin configuration is unavailable.");
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const batch = JSON.parse(await readFile(join(batchDir, "batch.json"), "utf8"));
  const sealedReport = JSON.parse(await readFile(join(batchDir, "dry-run", "report.json"), "utf8"));
  const originalRows = await readJsonDirectory(join(batchDir, "backup", "live-current"));
  const candidateRows = await readJsonDirectory(join(batchDir, "dry-run", "transformed-live-current"));
  const originalById = new Map(originalRows.map(row => [String(row.book_id), row]));
  const candidateById = new Map(candidateRows.map(row => [String(row.book_id), row]));
  if (originalById.size !== 287 || candidateById.size !== 287) {
    fail(`Sealed batch row count mismatch: ${originalById.size} original and ${candidateById.size} candidate rows.`);
  }

  const changed = [];
  for (const [bookId, original] of originalById) {
    const candidate = candidateById.get(bookId);
    if (!candidate) fail(`${bookId}: transformed candidate is missing.`);
    if (stableJson(withoutContent(original)) !== stableJson(withoutContent(candidate))) {
      fail(`${bookId}: transformed candidate changed row metadata.`);
    }
    const beforeHash = sha256(stableJson(original.content));
    const afterHash = sha256(stableJson(candidate.content));
    if (beforeHash !== afterHash) changed.push({ bookId, original, candidate, beforeHash, afterHash });
  }
  if (changed.length !== sealedReport.dryRun.changedBooks || changed.length !== 257) {
    fail(`Sealed changed-row count mismatch: expected 257; received ${changed.length}.`);
  }

  const local = await buildLocalCandidateSet(batchDir, originalById, candidateById);
  const liveRows = await fetchAllRows(supabase, "book_content_live", "book_id");
  const liveById = new Map(liveRows.map(row => [String(row.book_id), row]));
  const liveMismatches = [];

  if (expectedState === "apply") {
    for (const [bookId, original] of originalById) {
      const current = liveById.get(bookId);
      if (!current || stableJson(current) !== stableJson(original)) liveMismatches.push(bookId);
    }
    const fingerprint = computeSourceFingerprint(liveRows);
    if (fingerprint !== sealedReport.source.sourceFingerprintSha256) {
      liveMismatches.push(`source-fingerprint:${fingerprint}`);
    }
  } else if (expectedState === "rollback") {
    for (const [bookId, original] of originalById) {
      const current = liveById.get(bookId);
      const candidate = candidateById.get(bookId);
      const isChanged = sha256(stableJson(original.content)) !== sha256(stableJson(candidate.content));
      if (!current) {
        liveMismatches.push(bookId);
        continue;
      }
      if (isChanged) {
        if (
          Number(current.version_number) !== Number(original.version_number) + 1
          || sha256(stableJson(current.content)) !== sha256(stableJson(candidate.content))
        ) liveMismatches.push(bookId);
      } else if (stableJson(current) !== stableJson(original)) {
        liveMismatches.push(bookId);
      }
    }
  }

  if (liveRows.length !== originalRows.length || liveMismatches.length) {
    fail(`Live source preflight failed for ${liveMismatches.slice(0, 10).join(", ") || "row count"}.`);
  }

  const localMismatches = expectedState === "apply"
    ? await verifyLocalBytes(local, "before")
    : await verifyLocalBytes(local, "after");
  if (localMismatches.length) {
    fail(`Local fallback preflight failed for ${localMismatches.slice(0, 10).join(", ")}.`);
  }

  return {
    batchDir,
    batch,
    sealedReport,
    sealDigest,
    supabase,
    projectRef: projectRefFromUrl(url),
    originalRows,
    candidateRows,
    originalById,
    candidateById,
    changed,
    local,
    preflightLiveRows: liveRows,
    preflightLiveById: liveById,
    expectedState,
  };
}

async function buildLocalCandidateSet(batchDir, originalById, candidateById) {
  const fallbackDir = join(batchDir, "backup", "fallback");
  const names = (await readdir(fallbackDir)).filter(name => name.endsWith(".json") && name !== "manifest.json").sort();
  const entries = [];
  const byFileName = new Map();
  const originalByFileName = new Map();
  for (const original of originalById.values()) {
    originalByFileName.set(String(original.content_file || "").toLowerCase(), original);
  }

  for (const fileName of names) {
    const backupPath = join(fallbackDir, fileName);
    const beforeBytes = await readFile(backupPath);
    const beforeContent = JSON.parse(beforeBytes.toString("utf8"));
    const original = originalByFileName.get(fileName.toLowerCase());
    if (!original) fail(`${fileName}: no sealed live row maps to this fallback file.`);
    const candidate = candidateById.get(String(original.book_id));
    if (!candidate) fail(`${fileName}: transformed live candidate is missing.`);

    const afterContent = structuredClone(beforeContent);
    const candidateSections = new Map((candidate.content?.sections || []).map(section => [String(section.id), section]));
    for (const section of afterContent.sections || []) {
      const candidateSection = candidateSections.get(String(section.id));
      if (!candidateSection) fail(`${fileName}:${section.id}: transformed section is missing.`);
      section.html = String(candidateSection.html || "");
    }
    const beforeProjection = (beforeContent.sections || []).map(formattingSectionProjection);
    const originalProjection = (original.content?.sections || []).map(formattingSectionProjection);
    const afterProjection = (afterContent.sections || []).map(formattingSectionProjection);
    const candidateProjection = (candidate.content?.sections || []).map(formattingSectionProjection);
    if (stableJson(beforeProjection) !== stableJson(originalProjection)) fail(`${fileName}: sealed fallback/live formatting mismatch.`);
    if (stableJson(afterProjection) !== stableJson(candidateProjection)) fail(`${fileName}: generated fallback candidate differs from sealed transformed HTML.`);

    const afterBytes = Buffer.from(JSON.stringify(afterContent, null, 2), "utf8");
    const entry = {
      fileName,
      contentPath: join(root, "private", "book-content", fileName),
      backupPath,
      bookId: String(original.book_id),
      changed: !beforeBytes.equals(afterBytes),
      beforeBytes,
      afterBytes,
      beforeSha256: sha256(beforeBytes),
      afterSha256: sha256(afterBytes),
      beforeContent,
      afterContent,
    };
    entries.push(entry);
    byFileName.set(fileName.toLowerCase(), { fileName, bookId: entry.bookId, content: afterContent });
  }

  const transformedAudit = auditAndTransform(entries.map(entry => ({
    book_id: entry.bookId,
    content_file: entry.fileName,
    content: entry.afterContent,
  })));
  if (
    transformedAudit.failures.length
    || transformedAudit.summary.changedBooks !== 0
    || transformedAudit.summary.bodyProseBoldRunsBefore !== 0
    || transformedAudit.summary.bodyHeadingBoldRunsBefore !== 220
  ) {
    fail(`Generated local candidates failed validation: ${transformedAudit.failures.slice(0, 5).join("; ") || "unexpected bold inventory"}.`);
  }
  return { entries, byFileName, transformedAudit };
}

async function verifyLocalBytes(local, state) {
  const mismatches = [];
  for (const entry of local.entries) {
    let actual;
    try {
      actual = await readFile(entry.contentPath);
    } catch {
      mismatches.push(entry.fileName);
      continue;
    }
    const expected = state === "after" ? entry.afterBytes : entry.beforeBytes;
    if (!actual.equals(expected)) mismatches.push(entry.fileName);
  }
  return mismatches;
}

function summarizePreflight(context) {
  return {
    status: "PREFLIGHT_PASSED",
    operation: context.expectedState,
    batchId: context.batch.batchId,
    sealSha256: context.sealDigest,
    projectRef: context.projectRef,
    liveRows: context.preflightLiveRows.length,
    fallbackBooks: context.local.entries.length,
    changedRows: context.changed.length,
    sourceFingerprintSha256: computeSourceFingerprint(context.preflightLiveRows),
    bodyProseBoldRunsBefore: context.sealedReport.dryRun.bodyProseBoldRunsBefore,
    bodyProseBoldRunsAfter: context.sealedReport.dryRun.bodyProseBoldRunsAfter,
    bodyHeadingBoldRunsPreserved: context.sealedReport.dryRun.bodyHeadingBoldRunsAfter,
    validationFailures: 0,
    writesPerformed: false,
  };
}

async function applySealedBatch(batchDir, expectedSealDigest) {
  const context = await loadApplyContext(batchDir, expectedSealDigest, "apply");
  const run = await createExecutionRun(context, "apply");
  const applied = [];
  let inFlight = null;
  await appendJournal(run, "preflight_passed", summarizePreflight(context));

  try {
    for (const [index, item] of context.changed.entries()) {
      inFlight = item;
      const record = await mutateLiveRow({
        supabase: context.supabase,
        expectedRow: item.original,
        targetContent: item.candidate.content,
        message: `Removed manuscript body-prose bold formatting (${context.batch.batchId})`,
      });
      applied.push(record);
      inFlight = null;
      await appendJournal(run, "row_applied", summarizeMutation(record));
      if ((index + 1) % 20 === 0 || index + 1 === context.changed.length) {
        console.log(`Applied ${index + 1}/${context.changed.length} guarded live rows.`);
      }
    }

    const liveVerification = await verifyLiveState(context, "after");
    await appendJournal(run, "live_apply_verified", liveVerification.summary);

    await writeLocalState(context.local, "after");
    await appendJournal(run, "fallback_written", { changedFiles: context.local.entries.filter(entry => entry.changed).length });

    const finalVerification = await verifyCompleteState(context, "after");
    await appendJournal(run, "complete_state_verified", finalVerification.summary);

    const report = makeExecutionReport(context, run, {
      status: "APPLIED",
      applied,
      compensation: [],
      liveVerification,
      finalVerification,
      error: null,
    });
    const sealed = await sealExecutionRun(run, report);
    console.log(JSON.stringify({
      status: "MANUSCRIPT_BOLD_CLEANUP_APPLIED",
      batchId: context.batch.batchId,
      executionId: run.executionId,
      executionDirectory: run.directory,
      executionReportSha256: sealed.reportSha256,
      executionSealSha256: sealed.sealSha256,
      appliedRows: applied.length,
      unchangedRows: context.originalRows.length - applied.length,
      fallbackFilesUpdated: context.local.entries.filter(entry => entry.changed).length,
      liveRows: finalVerification.summary.liveRows,
      historyRowsForBatch: finalVerification.summary.historyRowsForBatch,
      bodyProseBoldRunsAfter: finalVerification.summary.bodyProseBoldRuns,
      bodyHeadingBoldRunsAfter: finalVerification.summary.bodyHeadingBoldRuns,
      validationFailures: 0,
    }, null, 2));
  } catch (error) {
    const originalError = error instanceof Error ? error : new Error(String(error));
    if (inFlight) {
      try {
        const uncertain = await discoverCompletedMutation(context.supabase, inFlight.original, inFlight.candidate.content);
        if (uncertain && !applied.some(record => record.bookId === uncertain.bookId)) applied.push(uncertain);
      } catch (discoveryError) {
        await appendJournal(run, "uncertain_row_discovery_failed", { error: errorMessage(discoveryError) });
      }
    }

    try {
      await writeLocalState(context.local, "before");
    } catch (restoreError) {
      await appendJournal(run, "fallback_restore_failed", { error: errorMessage(restoreError) });
    }

    const compensation = await compensateMutations(context, applied, "apply-failure");
    await appendJournal(run, "automatic_compensation_finished", {
      attempted: applied.length,
      compensated: compensation.records.length,
      failures: compensation.failures,
    });
    const report = makeExecutionReport(context, run, {
      status: compensation.failures.length ? "APPLY_FAILED_COMPENSATION_INCOMPLETE" : "APPLY_FAILED_COMPENSATED",
      applied,
      compensation: compensation.records,
      liveVerification: null,
      finalVerification: null,
      error: originalError.message,
      compensationFailures: compensation.failures,
    });
    const sealed = await sealExecutionRun(run, report);
    throw new Error(`Apply failed: ${originalError.message}. Automatic compensation restored ${compensation.records.length}/${applied.length} applied rows. Report: ${sealed.reportPath}`);
  }
}

async function rollbackSealedBatch(batchDir, expectedSealDigest) {
  const context = await loadApplyContext(batchDir, expectedSealDigest, "rollback");
  const run = await createExecutionRun(context, "rollback");
  const rolledBack = [];
  let inFlight = null;
  await appendJournal(run, "preflight_passed", summarizePreflight(context));

  try {
    for (const [index, item] of context.changed.entries()) {
      const expectedApplied = context.preflightLiveById.get(item.bookId);
      inFlight = { ...item, expectedApplied };
      const record = await mutateLiveRow({
        supabase: context.supabase,
        expectedRow: expectedApplied,
        targetContent: item.original.content,
        message: `Append-only rollback of manuscript bold cleanup (${context.batch.batchId})`,
      });
      rolledBack.push(record);
      inFlight = null;
      await appendJournal(run, "row_rolled_back", summarizeMutation(record));
      if ((index + 1) % 20 === 0 || index + 1 === context.changed.length) {
        console.log(`Rolled back ${index + 1}/${context.changed.length} guarded live rows.`);
      }
    }

    await writeLocalState(context.local, "before");
    const finalVerification = await verifyCompleteState(context, "before");
    const report = makeExecutionReport(context, run, {
      status: "ROLLED_BACK",
      applied: rolledBack,
      compensation: [],
      liveVerification: finalVerification,
      finalVerification,
      error: null,
    });
    const sealed = await sealExecutionRun(run, report);
    console.log(JSON.stringify({
      status: "MANUSCRIPT_BOLD_CLEANUP_ROLLED_BACK",
      batchId: context.batch.batchId,
      executionId: run.executionId,
      executionDirectory: run.directory,
      executionReportSha256: sealed.reportSha256,
      executionSealSha256: sealed.sealSha256,
      rolledBackRows: rolledBack.length,
      fallbackFilesRestored: context.local.entries.filter(entry => entry.changed).length,
      validationFailures: 0,
    }, null, 2));
  } catch (error) {
    const originalError = error instanceof Error ? error : new Error(String(error));
    if (inFlight) {
      try {
        const uncertain = await discoverCompletedMutation(context.supabase, inFlight.expectedApplied, inFlight.original.content);
        if (uncertain && !rolledBack.some(record => record.bookId === uncertain.bookId)) rolledBack.push(uncertain);
      } catch (discoveryError) {
        await appendJournal(run, "uncertain_row_discovery_failed", { error: errorMessage(discoveryError) });
      }
    }
    try {
      await writeLocalState(context.local, "after");
    } catch (restoreError) {
      await appendJournal(run, "fallback_restore_failed", { error: errorMessage(restoreError) });
    }
    const compensation = await compensateMutations(context, rolledBack, "rollback-failure");
    const report = makeExecutionReport(context, run, {
      status: compensation.failures.length ? "ROLLBACK_FAILED_COMPENSATION_INCOMPLETE" : "ROLLBACK_FAILED_COMPENSATED",
      applied: rolledBack,
      compensation: compensation.records,
      liveVerification: null,
      finalVerification: null,
      error: originalError.message,
      compensationFailures: compensation.failures,
    });
    const sealed = await sealExecutionRun(run, report);
    throw new Error(`Rollback failed: ${originalError.message}. Automatic compensation restored ${compensation.records.length}/${rolledBack.length} rolled-back rows. Report: ${sealed.reportPath}`);
  }
}

async function mutateLiveRow({ supabase, expectedRow, targetContent, message }) {
  const bookId = String(expectedRow.book_id);
  const current = await fetchCurrentLiveRow(supabase, bookId);
  if (!current || stableJson(current) !== stableJson(expectedRow)) {
    throw new Error(`${bookId}: optimistic pre-update source guard failed.`);
  }
  const history = await ensureHistoryArchive(supabase, current);
  const nextVersion = Number(current.version_number) + 1;
  const result = await supabase
    .from("book_content_live")
    .update({
      version_number: nextVersion,
      content: targetContent,
      edit_message: message,
    })
    .eq("book_id", bookId)
    .eq("version_number", Number(current.version_number))
    .eq("updated_at", String(current.updated_at))
    .select("*");
  if (result.error) throw new Error(`${bookId}: guarded live update failed: ${result.error.message}`);
  if ((result.data || []).length !== 1) throw new Error(`${bookId}: guarded live update matched ${(result.data || []).length} rows.`);
  const after = result.data[0];
  validateMutationResult(current, after, targetContent);
  return {
    bookId,
    before: current,
    after,
    history,
    beforeContentSha256: sha256(stableJson(current.content)),
    afterContentSha256: sha256(stableJson(after.content)),
  };
}

async function discoverCompletedMutation(supabase, expectedRow, targetContent) {
  const current = await fetchCurrentLiveRow(supabase, String(expectedRow.book_id));
  if (!current) throw new Error(`${expectedRow.book_id}: live row disappeared during mutation.`);
  if (stableJson(current) === stableJson(expectedRow)) return null;
  if (
    Number(current.version_number) === Number(expectedRow.version_number) + 1
    && sha256(stableJson(current.content)) === sha256(stableJson(targetContent))
  ) {
    return {
      bookId: String(expectedRow.book_id),
      before: expectedRow,
      after: current,
      history: null,
      beforeContentSha256: sha256(stableJson(expectedRow.content)),
      afterContentSha256: sha256(stableJson(current.content)),
      discoveredAfterUncertainResponse: true,
    };
  }
  throw new Error(`${expectedRow.book_id}: live state is neither guarded source nor expected target.`);
}

async function compensateMutations(context, mutations, reason) {
  const records = [];
  const failures = [];
  for (const mutation of [...mutations].reverse()) {
    try {
      const current = await fetchCurrentLiveRow(context.supabase, mutation.bookId);
      if (!current || stableJson(current) !== stableJson(mutation.after)) {
        throw new Error("current row no longer matches the mutation result");
      }
      const record = await mutateLiveRow({
        supabase: context.supabase,
        expectedRow: current,
        targetContent: mutation.before.content,
        message: `Automatic append-only compensation after ${reason} (${context.batch.batchId})`,
      });
      records.push(record);
    } catch (error) {
      failures.push({ bookId: mutation.bookId, error: errorMessage(error) });
    }
  }
  return { records, failures };
}

async function fetchCurrentLiveRow(supabase, bookId) {
  const result = await supabase.from("book_content_live").select("*").eq("book_id", bookId).maybeSingle();
  if (result.error) throw new Error(`${bookId}: live row fetch failed: ${result.error.message}`);
  return result.data || null;
}

async function ensureHistoryArchive(supabase, row) {
  const payload = historyPayload(row);
  const existingResult = await supabase
    .from("book_content_versions")
    .select("*")
    .eq("book_id", String(row.book_id))
    .eq("version_number", Number(row.version_number))
    .maybeSingle();
  if (existingResult.error) throw new Error(`${row.book_id}: history guard failed: ${existingResult.error.message}`);
  if (existingResult.data) {
    if (stableJson(historyProjection(existingResult.data)) !== stableJson(payload)) {
      throw new Error(`${row.book_id}: existing history version ${row.version_number} differs from the row being archived.`);
    }
    return { reused: true, id: existingResult.data.id, versionNumber: Number(row.version_number) };
  }
  const insertResult = await supabase.from("book_content_versions").insert(payload).select("*").single();
  if (insertResult.error) throw new Error(`${row.book_id}: archive-before-update failed: ${insertResult.error.message}`);
  if (stableJson(historyProjection(insertResult.data)) !== stableJson(payload)) {
    throw new Error(`${row.book_id}: archived history row failed verification.`);
  }
  return { reused: false, id: insertResult.data.id, versionNumber: Number(row.version_number) };
}

function historyPayload(row) {
  return {
    book_id: String(row.book_id),
    version_number: Number(row.version_number),
    title: String(row.title || ""),
    content_file: String(row.content_file || ""),
    content_path: String(row.content_path || ""),
    section_count: Number(row.section_count || 0),
    word_count: Number(row.word_count || 0),
    content: row.content,
    edit_message: String(row.edit_message || ""),
    edited_by: row.edited_by || null,
  };
}

function historyProjection(row) {
  const payload = historyPayload(row);
  return payload;
}

function validateMutationResult(before, after, targetContent) {
  const bookId = String(before.book_id);
  if (Number(after.version_number) !== Number(before.version_number) + 1) throw new Error(`${bookId}: version did not increment exactly once.`);
  if (sha256(stableJson(after.content)) !== sha256(stableJson(targetContent))) throw new Error(`${bookId}: saved content hash differs from the target.`);
  if (stableJson(immutableLiveProjection(after)) !== stableJson(immutableLiveProjection(before))) {
    throw new Error(`${bookId}: immutable live row metadata changed.`);
  }
}

function immutableLiveProjection(row) {
  const copy = { ...row };
  delete copy.content;
  delete copy.version_number;
  delete copy.edit_message;
  delete copy.updated_at;
  return copy;
}

function summarizeMutation(record) {
  return {
    bookId: record.bookId,
    beforeVersion: Number(record.before.version_number),
    afterVersion: Number(record.after.version_number),
    beforeUpdatedAt: record.before.updated_at,
    afterUpdatedAt: record.after.updated_at,
    beforeContentSha256: record.beforeContentSha256,
    afterContentSha256: record.afterContentSha256,
    archivedVersion: record.history?.versionNumber ?? Number(record.before.version_number),
    historyRowId: record.history?.id ?? null,
  };
}

async function verifyLiveState(context, state) {
  const liveRows = await fetchAllRows(context.supabase, "book_content_live", "book_id");
  const liveById = new Map(liveRows.map(row => [String(row.book_id), row]));
  const mismatches = [];
  const expectedHistoryVersions = new Map();

  for (const [bookId, original] of context.originalById) {
    const candidate = context.candidateById.get(bookId);
    const current = liveById.get(bookId);
    const changed = sha256(stableJson(original.content)) !== sha256(stableJson(candidate.content));
    if (!current) {
      mismatches.push(`${bookId}:missing-live-row`);
      continue;
    }

    if (state === "after" && changed) {
      if (
        Number(current.version_number) !== Number(original.version_number) + 1
        || sha256(stableJson(current.content)) !== sha256(stableJson(candidate.content))
      ) mismatches.push(`${bookId}:applied-state`);
      expectedHistoryVersions.set(bookId, new Set([Number(original.version_number)]));
    } else if (state === "before" && changed) {
      if (
        Number(current.version_number) < Number(original.version_number) + 2
        || sha256(stableJson(current.content)) !== sha256(stableJson(original.content))
      ) mismatches.push(`${bookId}:rollback-state`);
      expectedHistoryVersions.set(bookId, new Set([Number(original.version_number), Number(original.version_number) + 1]));
    } else if (stableJson(current) !== stableJson(original)) {
      mismatches.push(`${bookId}:unchanged-state`);
    }
  }

  const historyRows = await fetchAllRows(context.supabase, "book_content_versions", "book_id");
  const batchHistory = historyRows.filter(row => expectedHistoryVersions.has(String(row.book_id)));
  for (const [bookId, versions] of expectedHistoryVersions) {
    const rows = batchHistory.filter(row => String(row.book_id) === bookId);
    for (const version of versions) {
      const archived = rows.find(row => Number(row.version_number) === version);
      if (!archived) {
        mismatches.push(`${bookId}:missing-history-v${version}`);
        continue;
      }
      const expectedContent = version === Number(context.originalById.get(bookId).version_number)
        ? context.originalById.get(bookId).content
        : context.candidateById.get(bookId).content;
      if (sha256(stableJson(archived.content)) !== sha256(stableJson(expectedContent))) {
        mismatches.push(`${bookId}:history-content-v${version}`);
      }
    }
  }

  const audit = auditAndTransform(liveRows);
  if (audit.failures.length) mismatches.push(...audit.failures.slice(0, 20));
  const expectedProseBold = state === "after" ? 0 : context.sealedReport.dryRun.bodyProseBoldRunsBefore;
  if (audit.summary.bodyProseBoldRunsBefore !== expectedProseBold) mismatches.push("body-prose-bold-inventory");
  if (audit.summary.bodyHeadingBoldRunsBefore !== 220) mismatches.push("body-heading-bold-inventory");
  if (audit.summary.bodyFontWeight3200Before !== 659) mismatches.push("font-weight-3200-inventory");
  if (audit.summary.bodyEmDashesBefore !== 9401 || audit.summary.bodyEnDashesBefore !== 919) mismatches.push("body-dash-inventory");
  if (state === "after" && audit.summary.changedBooks !== 0) mismatches.push("post-apply-transform-not-idempotent");
  if (mismatches.length) throw new Error(`Live ${state} verification failed: ${mismatches.slice(0, 20).join(", ")}`);

  return {
    rows: liveRows,
    byId: liveById,
    historyRows,
    audit,
    summary: {
      liveRows: liveRows.length,
      historyRowsTotal: historyRows.length,
      historyRowsForBatch: batchHistory.length,
      bodyProseBoldRuns: audit.summary.bodyProseBoldRunsBefore,
      bodyHeadingBoldRuns: audit.summary.bodyHeadingBoldRunsBefore,
      bodyFontWeight3200: audit.summary.bodyFontWeight3200Before,
      bodyEmDashes: audit.summary.bodyEmDashesBefore,
      bodyEnDashes: audit.summary.bodyEnDashesBefore,
      idempotenceFailureCount: audit.summary.idempotenceFailureCount,
      validationFailureCount: 0,
    },
  };
}

async function verifyCompleteState(context, state) {
  const live = await verifyLiveState(context, state);
  const localMismatches = await verifyLocalBytes(context.local, state);
  if (localMismatches.length) throw new Error(`Local ${state} verification failed: ${localMismatches.slice(0, 20).join(", ")}`);
  const currentLocal = await readCurrentLocalFallback(context.local);
  const parity = compareFormattingParity(live.rows, currentLocal.byFileName);
  if (parity.mismatches.length) throw new Error(`Live/local parity failed: ${parity.mismatches.slice(0, 20).join(", ")}`);
  const localAudit = auditAndTransform(currentLocal.rows);
  if (localAudit.failures.length) throw new Error(`Local audit failed: ${localAudit.failures.slice(0, 20).join(", ")}`);
  if (localAudit.summary.bodyProseBoldRunsBefore !== live.audit.summary.bodyProseBoldRunsBefore) {
    throw new Error("Live/local body-prose bold inventory differs.");
  }
  if (localAudit.summary.bodyHeadingBoldRunsBefore !== live.audit.summary.bodyHeadingBoldRunsBefore) {
    throw new Error("Live/local body-heading bold inventory differs.");
  }
  return {
    ...live,
    localAudit,
    summary: {
      ...live.summary,
      fallbackBooks: currentLocal.rows.length,
      liveLocalFormattingParity: true,
      localFilesMatchingExpectedBytes: context.local.entries.length,
    },
  };
}

async function readCurrentLocalFallback(local) {
  const rows = [];
  const byFileName = new Map();
  for (const entry of local.entries) {
    const content = JSON.parse(await readFile(entry.contentPath, "utf8"));
    rows.push({ book_id: entry.bookId, content_file: entry.fileName, content });
    byFileName.set(entry.fileName.toLowerCase(), { fileName: entry.fileName, bookId: entry.bookId, content });
  }
  return { rows, byFileName };
}

async function writeLocalState(local, state) {
  const targetKey = state === "after" ? "afterBytes" : "beforeBytes";
  for (const entry of local.entries.filter(item => item.changed)) {
    await writeFile(entry.contentPath, entry[targetKey]);
    const saved = await readFile(entry.contentPath);
    if (!saved.equals(entry[targetKey])) throw new Error(`${entry.fileName}: fallback ${state} write failed verification.`);
  }
  const mismatches = await verifyLocalBytes(local, state);
  if (mismatches.length) throw new Error(`Fallback ${state} state differs for ${mismatches.slice(0, 20).join(", ")}.`);
}

async function createExecutionRun(context, operation) {
  const executionId = `${timestampId()}-${operation}-${context.batch.batchId}`;
  const executionsDirectory = join(outputRoot, "executions");
  const directory = join(executionsDirectory, executionId);
  await mkdir(executionsDirectory, { recursive: true });
  await mkdir(directory, { recursive: false });
  const run = {
    executionId,
    operation,
    directory,
    journalPath: join(directory, "journal.ndjson"),
    startedAt: new Date().toISOString(),
    scriptSha256: sha256(await readFile(join(root, "scripts", "manuscript-bold-cleanup.mjs"))),
  };
  await writeOnce(join(directory, "execution.json"), stableJson({
    schemaVersion: 1,
    executionId,
    operation,
    startedAt: run.startedAt,
    batchId: context.batch.batchId,
    batchSealSha256: context.sealDigest,
    sourceProjectRef: context.projectRef,
    scriptSha256: run.scriptSha256,
  }));
  return run;
}

async function appendJournal(run, event, details) {
  await appendFile(run.journalPath, `${JSON.stringify({ at: new Date().toISOString(), event, details })}\n`, "utf8");
}

function makeExecutionReport(context, run, result) {
  return {
    schemaVersion: 1,
    executionId: run.executionId,
    operation: run.operation,
    status: result.status,
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    batchId: context.batch.batchId,
    batchSealSha256: context.sealDigest,
    sourceProjectRef: context.projectRef,
    scriptSha256: run.scriptSha256,
    error: result.error,
    source: {
      liveRows: context.originalRows.length,
      changedRows: context.changed.length,
      unchangedRows: context.originalRows.length - context.changed.length,
      sealedSourceFingerprintSha256: context.sealedReport.source.sourceFingerprintSha256,
    },
    safety: {
      archiveBeforeUpdate: true,
      perRowVersionAndTimestampGuards: true,
      exactContentPreflight: true,
      appendOnlyRollback: true,
      frontBackAndHeadingsUntouched: true,
    },
    mutations: result.applied.map(summarizeMutation),
    automaticCompensation: result.compensation.map(summarizeMutation),
    compensationFailures: result.compensationFailures || [],
    liveVerification: result.liveVerification?.summary || null,
    finalVerification: result.finalVerification?.summary || null,
    localFiles: context.local.entries.map(entry => ({
      bookId: entry.bookId,
      fileName: entry.fileName,
      changed: entry.changed,
      beforeSha256: entry.beforeSha256,
      afterSha256: entry.afterSha256,
    })),
  };
}

async function sealExecutionRun(run, report) {
  const reportText = stableJson(report);
  const reportPath = join(run.directory, "report.json");
  await writeOnce(reportPath, reportText);
  const reportSha256 = sha256(reportText);
  const entries = await buildHashManifest(run.directory);
  const sumsText = stableJson({ schemaVersion: 1, executionId: run.executionId, algorithm: "SHA-256", entries });
  await writeOnce(join(run.directory, "SHA256SUMS.json"), sumsText);
  const sealSha256 = sha256(sumsText);
  await writeOnce(join(run.directory, "SHA256SUMS.sha256"), `${sealSha256}  SHA256SUMS.json\n`);
  await writeOnce(join(run.directory, "SEALED"), `${run.executionId}\n${sealSha256}\n`);
  await makeFilesReadOnly(run.directory);
  return { reportPath, reportSha256, sealSha256 };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function createSealedBackupAndDryRun() {
  loadEnvConfig(root);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) fail("Supabase admin configuration is unavailable.");

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const liveRows = await fetchAllRows(supabase, "book_content_live", "book_id");
  const historyRows = await fetchAllRows(supabase, "book_content_versions", "book_id");
  if (!liveRows.length) fail("No rows were returned from book_content_live.");

  const liveIds = new Set(liveRows.map(row => String(row.book_id)));
  const relevantHistory = historyRows.filter(row => liveIds.has(String(row.book_id)));
  const sourceFingerprint = computeSourceFingerprint(liveRows);
  const batchId = `${timestampId()}-${sourceFingerprint.slice(0, 12)}`;
  const batchDir = join(outputRoot, batchId);

  await mkdir(outputRoot, { recursive: true });
  await mkdir(batchDir, { recursive: false });

  const liveDir = join(batchDir, "backup", "live-current");
  const historyDir = join(batchDir, "backup", "live-history");
  const fallbackDir = join(batchDir, "backup", "fallback");
  const transformedDir = join(batchDir, "dry-run", "transformed-live-current");
  const diffsDir = join(batchDir, "dry-run", "review-diffs");
  const toolingDir = join(batchDir, "tooling");
  await Promise.all([
    mkdir(liveDir, { recursive: true }),
    mkdir(historyDir, { recursive: true }),
    mkdir(fallbackDir, { recursive: true }),
    mkdir(transformedDir, { recursive: true }),
    mkdir(diffsDir, { recursive: true }),
    mkdir(toolingDir, { recursive: true }),
  ]);

  await copyFileExclusive(
    join(root, "scripts", "manuscript-bold-cleanup.mjs"),
    join(toolingDir, "manuscript-bold-cleanup.mjs"),
  );

  for (const row of liveRows) {
    await writeOnce(join(liveDir, `${safeName(row.book_id)}.json`), stableJson(row));
  }
  for (const row of relevantHistory) {
    const fileName = `${safeName(row.book_id)}--v${Number(row.version_number || 0)}--row-${Number(row.id || 0)}.json`;
    await writeOnce(join(historyDir, fileName), stableJson(row));
  }

  const fallback = await copyFallbackSnapshot(fallbackDir);
  const liveAudit = auditAndTransform(liveRows);
  const fallbackRows = fallback.books.map(item => ({
    book_id: item.bookId,
    version_number: null,
    updated_at: null,
    content_file: item.fileName,
    content: item.content,
  }));
  const fallbackAudit = auditAndTransform(fallbackRows);
  const parity = compareFormattingParity(liveRows, fallback.byFileName);

  if (liveAudit.failures.length) {
    fail(`Live validation failed before sealing: ${liveAudit.failures.slice(0, 5).join("; ")}`);
  }
  if (fallbackAudit.failures.length) {
    fail(`Fallback validation failed before sealing: ${fallbackAudit.failures.slice(0, 5).join("; ")}`);
  }
  if (parity.mismatches.length) {
    fail(`Live and fallback formatting differ: ${parity.mismatches.slice(0, 5).join("; ")}`);
  }

  for (const transformed of liveAudit.transformedRows) {
    await writeOnce(
      join(transformedDir, `${safeName(transformed.row.book_id)}.json`),
      stableJson(transformed.row),
    );
    if (transformed.changedSections.length) {
      await writeOnce(
        join(diffsDir, `${safeName(transformed.row.book_id)}.html`),
        makeReviewDiff(transformed.row.book_id, transformed.changedSections),
      );
    }
  }

  const report = {
    schemaVersion: 1,
    operation: "remove-bold-from-manuscript-body-prose",
    safety: {
      liveWritesPerformed: false,
      applyCommandEnabled: false,
      frontMatterChanged: false,
      backMatterChanged: false,
      chapterAndSectionHeadingMarkupChanged: false,
      textChanged: false,
      dashesChanged: false,
    },
    source: {
      projectRef: projectRefFromUrl(url),
      liveRows: liveRows.length,
      historyRows: relevantHistory.length,
      latestLiveUpdatedAt: liveRows.map(row => String(row.updated_at || "")).sort().at(-1) || null,
      sourceFingerprintSha256: sourceFingerprint,
      fallbackBooks: fallback.books.length,
      liveFallbackFormattingParity: parity.mismatches.length === 0,
    },
    classification: liveAudit.classification,
    dryRun: liveAudit.summary,
    reviewFlags: {
      nonstandardBodySectionCount: liveAudit.nonstandardSections.length,
      nonstandardBodySections: liveAudit.nonstandardSections,
    },
    fallbackDryRun: fallbackAudit.summary,
  };

  const batchMetadata = {
    schemaVersion: 1,
    batchId,
    createdAt: new Date().toISOString(),
    operation: report.operation,
    sourceProjectRef: report.source.projectRef,
    sourceFingerprintSha256: sourceFingerprint,
    reportPath: "dry-run/report.json",
    restoreInputs: {
      currentRows: "backup/live-current",
      versionHistoryRows: "backup/live-history",
      fallbackFiles: "backup/fallback",
    },
    warning: "Sealed read-only backup and dry-run only. This batch has not been applied to Supabase.",
  };

  await writeOnce(join(batchDir, "batch.json"), stableJson(batchMetadata));
  await writeOnce(join(batchDir, "dry-run", "report.json"), stableJson(report));
  await writeOnce(
    join(batchDir, "README.txt"),
    `JJ University manuscript bold cleanup\r\n\r\nBatch: ${batchId}\r\nStatus: sealed backup plus dry run; no Supabase write performed.\r\n\r\nThe backup/live-current directory contains every current live row.\r\nThe backup/live-history directory contains all relevant version-history rows.\r\nThe backup/fallback directory contains the checked-in fallback files exactly as read.\r\nThe dry-run directory contains transformed candidates, a complete report, and one reviewable before/after HTML file per changed book.\r\n\r\nRun: node scripts/manuscript-bold-cleanup.mjs verify --batch=${batchId}\r\n`,
  );

  const hashManifest = await buildHashManifest(batchDir);
  const hashManifestText = stableJson({
    schemaVersion: 1,
    batchId,
    algorithm: "SHA-256",
    entries: hashManifest,
  });
  await writeOnce(join(batchDir, "SHA256SUMS.json"), hashManifestText);
  const manifestDigest = sha256(hashManifestText);
  await writeOnce(join(batchDir, "SHA256SUMS.sha256"), `${manifestDigest}  SHA256SUMS.json\n`);
  await writeOnce(join(batchDir, "SEALED"), `${batchId}\n${manifestDigest}\n`);

  await verifySealedBatch(batchDir, { quiet: true });
  await makeFilesReadOnly(batchDir);

  console.log(JSON.stringify({
    status: "SEALED_DRY_RUN_CREATED",
    batchId,
    batchDirectory: batchDir,
    hashManifestSha256: manifestDigest,
    liveRows: liveRows.length,
    historyRows: relevantHistory.length,
    fallbackBooks: fallback.books.length,
    changedBooks: liveAudit.summary.changedBooks,
    unchangedBooks: liveAudit.summary.unchangedBooks,
    changedBodySections: liveAudit.summary.changedBodySections,
    nonstandardBodySectionsFlagged: liveAudit.nonstandardSections.length,
    removedStrongElements: liveAudit.summary.removedStrongElements,
    removedFontWeight5600Declarations: liveAudit.summary.removedFontWeight5600Declarations,
    validationFailures: liveAudit.failures.length,
    liveWritesPerformed: false,
  }, null, 2));
}

async function verifySealedBatch(batchDir, options = {}) {
  const sumFile = join(batchDir, "SHA256SUMS.json");
  const sumText = await readFile(sumFile, "utf8");
  const sums = JSON.parse(sumText);
  const digestLine = (await readFile(join(batchDir, "SHA256SUMS.sha256"), "utf8")).trim();
  const expectedDigest = digestLine.split(/\s+/)[0];
  const actualDigest = sha256(sumText);
  if (actualDigest !== expectedDigest) fail("SHA256SUMS.json digest does not match SHA256SUMS.sha256.");

  const mismatches = [];
  for (const entry of sums.entries || []) {
    const filePath = join(batchDir, ...String(entry.path).split("/"));
    const bytes = await readFile(filePath);
    const actual = sha256(bytes);
    if (actual !== entry.sha256 || bytes.length !== entry.bytes) {
      mismatches.push(entry.path);
    }
  }
  if (mismatches.length) fail(`Sealed backup hash mismatch: ${mismatches.slice(0, 10).join(", ")}`);

  const liveDir = join(batchDir, "backup", "live-current");
  const liveRows = await readJsonDirectory(liveDir);
  const rerun = auditAndTransform(liveRows);
  const report = JSON.parse(await readFile(join(batchDir, "dry-run", "report.json"), "utf8"));
  if (rerun.failures.length) fail(`Dry-run revalidation failed: ${rerun.failures.slice(0, 5).join("; ")}`);
  if (stableJson(rerun.summary) !== stableJson(report.dryRun)) {
    fail("Dry-run summary no longer matches the sealed report.");
  }

  if (!options.quiet) {
    console.log(JSON.stringify({
      status: "SEALED_BATCH_VERIFIED",
      batchId: sums.batchId,
      filesVerified: sums.entries.length,
      hashManifestSha256: actualDigest,
      dryRunValidationFailures: 0,
      liveWritesPerformed: false,
    }, null, 2));
  }
}

async function fetchAllRows(supabase, table, orderColumn) {
  const pageSize = 1000;
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const result = await supabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .range(start, start + pageSize - 1);
    if (result.error) fail(`Read-only ${table} export failed: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) break;
  }
  return rows;
}

async function copyFallbackSnapshot(destination) {
  const sourceDir = join(root, "private", "book-content");
  const manifestPath = join(sourceDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const books = [];
  const byFileName = new Map();
  const seen = new Set();

  await copyFileExclusive(manifestPath, join(destination, "manifest.json"));
  for (const entry of manifest.books || []) {
    const fileName = basename(String(entry.path || ""));
    if (!fileName || seen.has(fileName.toLowerCase())) fail(`Invalid or duplicate fallback manifest path: ${fileName}`);
    seen.add(fileName.toLowerCase());
    const sourcePath = join(sourceDir, fileName);
    const destinationPath = join(destination, fileName);
    const raw = await readFile(sourcePath);
    const content = JSON.parse(raw.toString("utf8"));
    await writeOnce(destinationPath, raw);
    const item = {
      bookId: String(content.id || entry.id || fileName.replace(/\.json$/i, "")),
      fileName,
      content,
    };
    books.push(item);
    byFileName.set(fileName.toLowerCase(), item);
  }
  return { books, byFileName };
}

function auditAndTransform(rows) {
  const totals = {
    front: makeTotals(),
    body: makeTotals(),
    back: makeTotals(),
  };
  const afterBody = makeTotals();
  const failures = [];
  const changedBooks = new Set();
  const changedSections = new Set();
  const transformedRows = [];
  const nonstandardSections = [];
  let removedStrongElements = 0;
  let removedFontWeight5600Declarations = 0;

  for (const sourceRow of rows) {
    const row = structuredClone(sourceRow);
    const beforeBook = normalizeContentObject(sourceRow.content, sourceRow.book_id);
    const afterBook = structuredClone(beforeBook);
    const classifications = classifySections(beforeBook);
    const changedForBook = [];

    if (!classifications.some(item => item.category === "back")) {
      failures.push(`${sourceRow.book_id}: missing exact back-matter anchor`);
    }

    for (const item of classifications) {
      const beforeSection = item.section;
      const afterSection = afterBook.sections[item.arrayIndex];
      const beforeHtml = String(beforeSection.html || "");
      const beforeAnalysis = analyzeHtml(beforeHtml);
      addAnalysis(totals[item.category], sourceRow.book_id, beforeAnalysis);

      if (item.category !== "body") continue;

      if (!standardBodyTitlePattern.test(normalizeTitle(beforeSection.title))) {
        nonstandardSections.push({
          bookId: String(sourceRow.book_id),
          sectionId: String(beforeSection.id || ""),
          index: Number(beforeSection.index),
          title: String(beforeSection.title || ""),
          kind: String(beforeSection.kind || ""),
        });
      }

      const transformed = scrubBodyProseBold(beforeHtml);
      const secondPass = scrubBodyProseBold(transformed.html);
      afterSection.html = transformed.html;
      const afterAnalysis = analyzeHtml(transformed.html);
      addAnalysis(afterBody, sourceRow.book_id, afterAnalysis);

      const sectionKey = `${sourceRow.book_id}:${beforeSection.id}`;
      if (transformed.html !== beforeHtml) {
        changedBooks.add(String(sourceRow.book_id));
        changedSections.add(sectionKey);
        changedForBook.push({
          sectionId: String(beforeSection.id || ""),
          index: Number(beforeSection.index),
          title: String(beforeSection.title || ""),
          kind: String(beforeSection.kind || ""),
          beforeHtml,
          afterHtml: transformed.html,
          removedStrongElements: transformed.removedStrong,
          removedFontWeight5600Declarations: transformed.removedInline,
        });
      }
      removedStrongElements += transformed.removedStrong;
      removedFontWeight5600Declarations += transformed.removedInline;

      if (rawTextNodes(beforeHtml) !== rawTextNodes(transformed.html)) failures.push(`${sectionKey}: raw text-node bytes changed`);
      if (decodedText(beforeHtml) !== decodedText(transformed.html)) failures.push(`${sectionKey}: rendered text changed`);
      if (countWords(decodedText(beforeHtml)) !== countWords(decodedText(transformed.html))) failures.push(`${sectionKey}: derived word count changed`);
      if (dashInventory(beforeHtml).key !== dashInventory(transformed.html).key) failures.push(`${sectionKey}: dash inventory changed`);
      if (extractHeadingMarkup(beforeHtml) !== extractHeadingMarkup(transformed.html)) failures.push(`${sectionKey}: heading markup changed`);
      if (beforeAnalysis.fontWeight3200 !== afterAnalysis.fontWeight3200) failures.push(`${sectionKey}: font-weight 3200 changed`);
      if (beforeAnalysis.otherFontWeight !== afterAnalysis.otherFontWeight) failures.push(`${sectionKey}: non-target font weight changed`);
      if (secondPass.html !== transformed.html || secondPass.removedStrong || secondPass.removedInline) failures.push(`${sectionKey}: transform is not idempotent`);
      if (afterAnalysis.targetStrongInProse || afterAnalysis.targetInlineInProse) failures.push(`${sectionKey}: target prose bold remains`);
      if (stableJson(withoutHtml(beforeSection)) !== stableJson(withoutHtml(afterSection))) failures.push(`${sectionKey}: section metadata changed`);
    }

    row.content = afterBook;
    if (stableJson(classifiedSections(beforeBook, classifications, "front")) !== stableJson(classifiedSections(afterBook, classifications, "front"))) {
      failures.push(`${sourceRow.book_id}: front matter changed`);
    }
    if (stableJson(classifiedSections(beforeBook, classifications, "back")) !== stableJson(classifiedSections(afterBook, classifications, "back"))) {
      failures.push(`${sourceRow.book_id}: back matter changed`);
    }
    if (stableJson(withoutContent(sourceRow)) !== stableJson(withoutContent(row))) failures.push(`${sourceRow.book_id}: row metadata changed`);

    transformedRows.push({
      row,
      changedSections: changedForBook,
      beforeContentSha256: sha256(stableJson(beforeBook)),
      afterContentSha256: sha256(stableJson(afterBook)),
    });
  }

  nonstandardSections.sort((a, b) => a.bookId.localeCompare(b.bookId) || a.index - b.index);
  const classification = Object.fromEntries(Object.entries(totals).map(([name, target]) => [name, summarizeTotals(target)]));
  const beforeBody = classification.body;
  const afterBodySummary = summarizeTotals(afterBody);
  const summary = {
    totalBooks: rows.length,
    totalSections: Object.values(classification).reduce((sum, value) => sum + value.sections, 0),
    changedBooks: changedBooks.size,
    unchangedBooks: rows.length - changedBooks.size,
    changedBodySections: changedSections.size,
    removedStrongElements,
    removedFontWeight5600Declarations,
    bodyProseBoldRunsBefore: beforeBody.proseBoldRuns,
    bodyProseBoldRunsAfter: afterBodySummary.proseBoldRuns,
    bodyHeadingBoldRunsBefore: beforeBody.headingBoldRuns,
    bodyHeadingBoldRunsAfter: afterBodySummary.headingBoldRuns,
    bodyFontWeight3200Before: beforeBody.fontWeight3200,
    bodyFontWeight3200After: afterBodySummary.fontWeight3200,
    bodyEmDashesBefore: beforeBody.emDashes,
    bodyEmDashesAfter: afterBodySummary.emDashes,
    bodyEnDashesBefore: beforeBody.enDashes,
    bodyEnDashesAfter: afterBodySummary.enDashes,
    rawTextMismatchCount: failures.filter(item => item.includes("raw text-node")).length,
    renderedTextMismatchCount: failures.filter(item => item.includes("rendered text")).length,
    dashMismatchCount: failures.filter(item => item.includes("dash inventory")).length,
    headingMarkupMismatchCount: failures.filter(item => item.includes("heading markup")).length,
    idempotenceFailureCount: failures.filter(item => item.includes("idempotent")).length,
    validationFailureCount: failures.length,
    transformedBookHashes: transformedRows.map(item => ({
      bookId: String(item.row.book_id),
      beforeContentSha256: item.beforeContentSha256,
      afterContentSha256: item.afterContentSha256,
      changedSections: item.changedSections.length,
    })),
  };

  return { classification, summary, failures, transformedRows, nonstandardSections };
}

function classifySections(book) {
  const sorted = (book.sections || [])
    .map((section, arrayIndex) => ({ section, arrayIndex }))
    .sort((a, b) => Number(a.section.index) - Number(b.section.index) || a.arrayIndex - b.arrayIndex);
  let backPosition = sorted.findIndex((item, position) => (
    position >= Math.max(0, sorted.length - 8) && backMatterPattern.test(normalizeTitle(item.section.title))
  ));
  if (backPosition < 0) backPosition = sorted.length;

  return sorted.map((item, position) => ({
    ...item,
    category: position >= backPosition
      ? "back"
      : isFrontMatter(item.section, position)
        ? "front"
        : "body",
  }));
}

function isFrontMatter(section, position) {
  const title = normalizeTitle(section.title);
  if (position === 0 && /^(contents|table of contents)$/.test(title)) return true;
  if (position === 1 && Number(section.wordCount || 0) <= 30 && /\bps1\b/i.test(String(section.html || ""))) return true;
  if (position < 5 && /^dedication$/.test(title)) return true;
  if (position < 5 && /^(foreword|preface)$/.test(title)) return true;
  return false;
}

function scrubBodyProseBold(htmlValue) {
  const tokens = tokenizeHtml(htmlValue);
  const stack = [];
  const output = [];
  let removedStrong = 0;
  let removedInline = 0;

  const context = () => ({
    inHeading: stack.some(item => /^h[1-6]$/.test(item.name)),
    inProse: stack.some(item => proseTags.has(item.name)),
  });

  for (const token of tokens) {
    if (!token.startsWith("<") || /^<!--|^<!/i.test(token)) {
      output.push(token);
      continue;
    }

    const closing = token.match(/^<\s*\/\s*([a-z0-9:-]+)/i);
    if (closing) {
      const name = closing[1].toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index -= 1;
      if (index < 0) {
        output.push(token);
        continue;
      }
      const matched = stack[index];
      stack.splice(index);
      if (!matched.removeTag) output.push(token);
      continue;
    }

    const opening = token.match(/^<\s*([a-z0-9:-]+)([\s\S]*?)\/?\s*>$/i);
    if (!opening) {
      output.push(token);
      continue;
    }
    const name = opening[1].toLowerCase();
    const current = context();
    const inHeading = current.inHeading || /^h[1-6]$/.test(name);
    const inProse = current.inProse || proseTags.has(name);
    const semanticBold = name === "strong" || name === "b";
    const removeTag = semanticBold && inProse && !inHeading;
    const selfClosing = /\/\s*>$/.test(token) || voidTags.has(name);
    const cleaned = inProse && !inHeading
      ? scrubFontWeight5600(token, count => { removedInline += count; })
      : token;

    if (removeTag) removedStrong += 1;
    else output.push(cleaned);
    if (!selfClosing) stack.push({ name, removeTag });
  }

  return { html: output.join(""), removedStrong, removedInline };
}

function scrubFontWeight5600(token, onRemove) {
  return token.replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (whole, doubleQuoted, singleQuoted, bare) => {
    const style = doubleQuoted ?? singleQuoted ?? bare ?? "";
    const segments = style.match(/[^;]*(?:;|$)/g)?.filter(Boolean) || [];
    let removed = 0;
    const kept = segments.filter(segment => {
      const target = /^\s*font-weight\s*:\s*5600\s*;?\s*$/i.test(segment);
      if (target) removed += 1;
      return !target;
    });
    if (!removed) return whole;
    onRemove(removed);
    const next = kept.join("");
    if (!next.trim()) return "";
    if (doubleQuoted !== undefined) return ` style="${next}"`;
    if (singleQuoted !== undefined) return ` style='${next}'`;
    return ` style=${next}`;
  });
}

function analyzeHtml(htmlValue) {
  const html = String(htmlValue || "");
  const stack = [];
  let boldDepth = 0;
  let run = null;
  const runs = [];
  let targetStrongInProse = 0;
  let targetInlineInProse = 0;

  const context = () => ({
    inHeading: stack.some(item => /^h[1-6]$/.test(item.name)),
    inProse: stack.some(item => proseTags.has(item.name)),
  });
  const finishRun = () => {
    if (run && `${run.prose}${run.heading}${run.other}`.trim()) runs.push(run);
    run = null;
  };

  for (const token of tokenizeHtml(html)) {
    if (!token.startsWith("<")) {
      const current = context();
      if (boldDepth > 0 && run) {
        if (current.inHeading) run.heading += token;
        else if (current.inProse) run.prose += token;
        else run.other += token;
      }
      continue;
    }
    if (/^<!--|^<!/i.test(token)) continue;

    const closing = token.match(/^<\s*\/\s*([a-z0-9:-]+)/i);
    if (closing) {
      const name = closing[1].toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index -= 1;
      if (index < 0) continue;
      for (let cursor = stack.length - 1; cursor >= index; cursor -= 1) {
        const item = stack.pop();
        if (item.bold) {
          boldDepth -= 1;
          if (boldDepth === 0) finishRun();
        }
      }
      continue;
    }

    const opening = token.match(/^<\s*([a-z0-9:-]+)([\s\S]*?)\/?\s*>$/i);
    if (!opening) continue;
    const name = opening[1].toLowerCase();
    const attributes = opening[2] || "";
    const current = context();
    const inlineBold = hasFontWeight5600(attributes);
    const semanticBold = name === "strong" || name === "b";
    const bold = semanticBold || inlineBold;
    if (semanticBold && current.inProse && !current.inHeading) targetStrongInProse += 1;
    if (inlineBold && current.inProse && !current.inHeading) targetInlineInProse += 1;
    if (bold && boldDepth === 0) run = { prose: "", heading: "", other: "" };
    if (bold) boldDepth += 1;
    stack.push({ name, bold });
    if (/\/\s*>$/.test(token) || voidTags.has(name)) {
      const item = stack.pop();
      if (item.bold) {
        boldDepth -= 1;
        if (boldDepth === 0) finishRun();
      }
    }
  }
  while (stack.length) {
    const item = stack.pop();
    if (item.bold) {
      boldDepth -= 1;
      if (boldDepth === 0) finishRun();
    }
  }
  finishRun();

  return {
    runs,
    rawStrong: (html.match(/<strong\b/gi) || []).length,
    rawB: (html.match(/<b\b/gi) || []).length,
    fontWeight5600: (html.match(/font-weight\s*:\s*5600\b/gi) || []).length,
    fontWeight3200: (html.match(/font-weight\s*:\s*3200\b/gi) || []).length,
    otherFontWeight: (html.match(/font-weight\s*:\s*(?!(?:5600|3200)\b)[^;"']+/gi) || []).length,
    targetStrongInProse,
    targetInlineInProse,
    ...dashInventory(html),
  };
}

function makeTotals() {
  return {
    sections: 0,
    books: new Set(),
    boldBooks: new Set(),
    boldSections: 0,
    semanticBoldRuns: 0,
    proseBoldRuns: 0,
    headingBoldRuns: 0,
    otherBoldRuns: 0,
    rawStrong: 0,
    rawB: 0,
    fontWeight5600: 0,
    fontWeight3200: 0,
    otherFontWeight: 0,
    targetStrongInProse: 0,
    targetInlineInProse: 0,
    emDashes: 0,
    enDashes: 0,
  };
}

function addAnalysis(target, bookId, analysis) {
  target.sections += 1;
  target.books.add(String(bookId));
  if (analysis.runs.length) {
    target.boldBooks.add(String(bookId));
    target.boldSections += 1;
  }
  target.semanticBoldRuns += analysis.runs.length;
  target.proseBoldRuns += analysis.runs.filter(run => run.prose.trim()).length;
  target.headingBoldRuns += analysis.runs.filter(run => run.heading.trim()).length;
  target.otherBoldRuns += analysis.runs.filter(run => run.other.trim()).length;
  for (const key of ["rawStrong", "rawB", "fontWeight5600", "fontWeight3200", "otherFontWeight", "targetStrongInProse", "targetInlineInProse", "emDashes", "enDashes"]) {
    target[key] += analysis[key];
  }
}

function summarizeTotals(target) {
  return {
    books: target.books.size,
    sections: target.sections,
    boldBooks: target.boldBooks.size,
    boldSections: target.boldSections,
    semanticBoldRuns: target.semanticBoldRuns,
    proseBoldRuns: target.proseBoldRuns,
    headingBoldRuns: target.headingBoldRuns,
    otherBoldRuns: target.otherBoldRuns,
    rawStrong: target.rawStrong,
    rawB: target.rawB,
    fontWeight5600: target.fontWeight5600,
    fontWeight3200: target.fontWeight3200,
    otherFontWeight: target.otherFontWeight,
    targetStrongInProse: target.targetStrongInProse,
    targetInlineInProse: target.targetInlineInProse,
    emDashes: target.emDashes,
    enDashes: target.enDashes,
  };
}

function compareFormattingParity(liveRows, fallbackByFileName) {
  const mismatches = [];
  for (const row of liveRows) {
    const fileName = String(row.content_file || row.content?.sourceFile || "").replace(/\.epub$/i, ".json");
    const fallback = fallbackByFileName.get(fileName.toLowerCase());
    if (!fallback) {
      mismatches.push(`${row.book_id}: fallback file ${fileName || "(missing name)"} not found`);
      continue;
    }
    const liveSections = normalizeContentObject(row.content, row.book_id).sections.map(formattingSectionProjection);
    const fallbackSections = normalizeContentObject(fallback.content, fallback.bookId).sections.map(formattingSectionProjection);
    if (stableJson(liveSections) !== stableJson(fallbackSections)) {
      mismatches.push(`${row.book_id}: section formatting differs from ${fallback.fileName}`);
    }
  }
  return { mismatches };
}

function formattingSectionProjection(section) {
  return {
    id: section.id,
    index: section.index,
    title: section.title,
    kind: section.kind,
    html: section.html,
    text: section.text,
    wordCount: section.wordCount,
  };
}

function normalizeContentObject(value, fallbackId) {
  const content = typeof value === "string" ? JSON.parse(value) : structuredClone(value || {});
  content.id ||= fallbackId;
  content.sections = Array.isArray(content.sections) ? content.sections : [];
  return content;
}

function classifiedSections(book, classifications, category) {
  return classifications
    .filter(item => item.category === category)
    .map(item => book.sections[item.arrayIndex]);
}

function withoutHtml(section) {
  const copy = { ...section };
  delete copy.html;
  return copy;
}

function withoutContent(row) {
  const copy = { ...row };
  delete copy.content;
  return copy;
}

function tokenizeHtml(value) {
  return String(value || "").match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || [];
}

function rawTextNodes(value) {
  return tokenizeHtml(value).filter(token => !token.startsWith("<")).join("");
}

function decodedText(value) {
  return rawTextNodes(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–");
}

function dashInventory(value) {
  const text = decodedText(value);
  const emDashes = (text.match(/—/g) || []).length;
  const enDashes = (text.match(/–/g) || []).length;
  return { emDashes, enDashes, key: `${emDashes}:${enDashes}` };
}

function extractHeadingMarkup(value) {
  return (String(value || "").match(/<h[1-6]\b[\s\S]*?<\/h[1-6]\s*>/gi) || []).join("\n");
}

function hasFontWeight5600(attributes) {
  return /(?:^|;)\s*font-weight\s*:\s*5600\s*(?:;|$)/i.test(styleValue(attributes));
}

function styleValue(attributes) {
  const match = String(attributes || "").match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function countWords(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function makeReviewDiff(bookId, changedSections) {
  const sections = changedSections.map(section => `
    <section>
      <h2>${escapeHtml(`${section.index}. ${section.title}`)}</h2>
      <p class="meta">${escapeHtml(section.sectionId)} · removed ${section.removedStrongElements} strong element(s) and ${section.removedFontWeight5600Declarations} font-weight declaration(s)</p>
      <div class="columns">
        <article><h3>Before</h3><div class="rendered">${section.beforeHtml}</div><details><summary>HTML source</summary><pre>${escapeHtml(section.beforeHtml)}</pre></details></article>
        <article><h3>After</h3><div class="rendered">${section.afterHtml}</div><details><summary>HTML source</summary><pre>${escapeHtml(section.afterHtml)}</pre></details></article>
      </div>
    </section>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bookId)} bold cleanup review</title><style>body{font:16px/1.55 system-ui,sans-serif;margin:0;background:#eee;color:#171717}main{max-width:1500px;margin:auto;padding:28px}section{background:white;border:1px solid #ccc;border-radius:12px;padding:20px;margin:0 0 24px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.rendered{border:1px solid #ddd;padding:18px;max-height:500px;overflow:auto}.meta{color:#555}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#111;color:#eee;padding:14px}strong,b{color:#9b1919}@media(max-width:800px){.columns{grid-template-columns:1fr}}</style></head><body><main><h1>${escapeHtml(bookId)}</h1><p>Dry-run comparison. No live write was performed.</p>${sections}</main></body></html>\n`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

async function buildHashManifest(batchDir) {
  const paths = await listFiles(batchDir);
  const excluded = new Set(["SHA256SUMS.json", "SHA256SUMS.sha256", "SEALED"]);
  const entries = [];
  for (const filePath of paths) {
    const relativePath = relative(batchDir, filePath).replace(/\\/g, "/");
    if (excluded.has(relativePath)) continue;
    const bytes = await readFile(filePath);
    entries.push({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function listFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function readJsonDirectory(directory) {
  const names = (await readdir(directory)).filter(name => name.endsWith(".json")).sort();
  return Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), "utf8"))));
}

async function makeFilesReadOnly(directory) {
  for (const filePath of await listFiles(directory)) {
    try {
      await chmod(filePath, 0o444);
    } catch {
      // Hash verification is the authority on platforms that ignore POSIX mode bits.
    }
  }
}

async function writeOnce(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { flag: "wx" });
}

async function copyFileExclusive(source, destination) {
  try {
    await stat(destination);
    fail(`Refusing to overwrite existing backup file: ${destination}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await copyFile(source, destination);
}

function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function computeSourceFingerprint(rows) {
  return sha256(stableJson(rows.map(row => ({
    book_id: row.book_id,
    version_number: row.version_number,
    updated_at: row.updated_at,
    content_sha256: sha256(stableJson(row.content)),
  }))));
}

function safeName(value) {
  return String(value || "unknown").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function projectRefFromUrl(value) {
  try {
    return new URL(value).hostname.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

function resolveBatch(value) {
  const candidate = resolve(outputRoot, value);
  if (!candidate.startsWith(`${outputRoot}\\`) && candidate !== outputRoot) fail("Invalid batch path.");
  return candidate;
}

function argValue(name) {
  const prefix = `${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

function fail(message) {
  throw new Error(message);
}
