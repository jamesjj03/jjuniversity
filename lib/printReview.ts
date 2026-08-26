import "server-only";

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import disclaimerProfiles from "@/config/book-disclaimer-profiles.json";
import ethicsBook from "@/private/book-content/Ethics.json";
import printProducts from "@/public/print-products.json";
import type {
  PrintArtifactSnapshot,
  PrintProductReview,
  PrintReleaseSource,
  PrintReviewQueue,
  PrintReviewSurface,
} from "@/lib/printReviewTypes";

const CONTRACT_VERSION = "print-review-contract-v2";
const repoRoot = process.cwd();

type RawPrintProduct = {
  slug?: string;
  title?: string;
  kicker?: string;
  kind?: string;
  targetPriceCents?: number | null;
  printStatus?: string;
  salesStatus?: string;
  actualInteriorPages?: number | null;
  generatedAt?: string;
  publicInteriorUrl?: string;
  publicCoverUrl?: string;
  bookIds?: string[];
  componentProductSlugs?: string[];
  format?: {
    trimSize?: string;
    binding?: string;
    interiorColor?: string;
    paperType?: string;
    coverFinish?: string;
  };
  publicationReview?: {
    status?: string;
    requiredChecks?: string[];
  };
};

type ProofManifest = {
  generatedAtUtc?: string;
  status?: string;
  inputs?: Array<{ path?: string; sha256?: string }>;
  outputs?: Array<{ path?: string; sha256?: string }>;
  volumes?: Array<{
    productSlug?: string;
    pageCount?: number;
    bookDisclaimerReviews?: Array<{ id?: string; reviewStatus?: string }>;
    paginationAudit?: {
      sparseNarrativePages?: Array<{ page?: number }>;
    };
    interior?: { path?: string; sha256?: string };
    covers?: Array<{ binding?: string; path?: string; sha256?: string }>;
  }>;
};

type LuluValidation = {
  createdAtUtc?: string;
  environment?: string;
  paidPrintJobCreated?: boolean;
  printJobEndpointCalled?: boolean;
  proofDigest?: string;
  validations?: Array<{
    productSlug?: string;
    binding?: string;
    kind?: string;
    sourceSha256?: string;
    status?: string;
    pageCount?: number | null;
    validationId?: string | number;
  }>;
  quotes?: Array<{
    productSlug?: string;
    binding?: string;
    pageCount?: number;
    response?: {
      currency?: string;
      total_cost_incl_tax?: string;
      line_item_costs?: Array<{ total_cost_excl_tax?: string }>;
    };
  }>;
};

type BookDisclaimerConfig = {
  books?: Record<string, { reviewStatus?: string }>;
};

const fileCache = new Map<string, { buffer: Buffer; sha256: string; modifiedAt: string }>();

function safeRepoPath(relativePath: string) {
  // The review reads only exact, server-side evidence paths after the boundary
  // check below. Do not make Next trace the entire repository into this route.
  const absolute = resolve(/* turbopackIgnore: true */ repoRoot, relativePath);
  const rootPrefix = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;
  if (absolute !== repoRoot && !absolute.startsWith(rootPrefix)) {
    throw new Error(`Print review path escaped the repository: ${relativePath}`);
  }
  return absolute;
}

function readJson<T>(relativePath: string): T | null {
  try {
    return JSON.parse(readFileSync(safeRepoPath(relativePath), "utf8")) as T;
  } catch {
    return null;
  }
}

function readFileSnapshot(relativePath: string) {
  const cached = fileCache.get(relativePath);
  if (cached) return cached;
  const absolute = safeRepoPath(relativePath);
  if (!existsSync(absolute)) return null;
  const buffer = readFileSync(absolute);
  const snapshot = {
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    modifiedAt: statSync(absolute).mtime.toISOString(),
  };
  fileCache.set(relativePath, snapshot);
  return snapshot;
}

function inspectPdf(relativePath: string, label: string): PrintArtifactSnapshot {
  const snapshot = readFileSnapshot(relativePath);
  if (!snapshot) {
    return {
      available: false,
      pageCount: null,
      sha256: "",
      bytes: null,
      modifiedAt: "",
      label,
    };
  }

  const pageCount = (snapshot.buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  return {
    available: true,
    pageCount: pageCount || null,
    sha256: snapshot.sha256,
    bytes: snapshot.buffer.byteLength,
    modifiedAt: snapshot.modifiedAt,
    label,
  };
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 12)}…` : "not recorded";
}

function formatPrice(cents: number | null | undefined) {
  if (!Number.isFinite(Number(cents))) return "No target price";
  return `$${(Number(cents) / 100).toFixed(2)} target`;
}

function formatProductFormat(product: RawPrintProduct) {
  const values = [
    cleanString(product.format?.trimSize),
    cleanString(product.format?.binding),
    cleanString(product.format?.interiorColor),
    cleanString(product.format?.paperType),
    cleanString(product.format?.coverFinish),
  ].filter(Boolean);
  return values.join(" · ") || "Format not recorded";
}

function findManifestVolume(manifest: ProofManifest | null, productSlug: string) {
  return manifest?.volumes?.find(volume => volume.productSlug === productSlug) || null;
}

function findCoverHash(volume: NonNullable<ProofManifest["volumes"]>[number] | null, binding: string) {
  return cleanString(volume?.covers?.find(cover => cover.binding === binding)?.sha256);
}

function findValidationInterior(validation: LuluValidation | null, productSlug: string) {
  const rows = (validation?.validations || []).filter(row => row.productSlug === productSlug && row.kind === "interior");
  const hashes = [...new Set(rows.map(row => cleanString(row.sourceSha256)).filter(Boolean))];
  const statuses = [...new Set(rows.map(row => cleanString(row.status).toUpperCase()).filter(Boolean))];
  return {
    pageCount: cleanNumber(rows.find(row => cleanNumber(row.pageCount))?.pageCount),
    sha256: hashes.length === 1 ? hashes[0] : hashes.join(","),
    status: statuses.join(" / "),
    validationIds: rows.map(row => String(row.validationId || "")).filter(Boolean),
  };
}

function compareRecordedFiles(records: Array<{ path?: string; sha256?: string }> | undefined) {
  const mismatches: string[] = [];
  for (const record of records || []) {
    const path = cleanString(record.path);
    const recordedHash = cleanString(record.sha256).toLowerCase();
    if (!path || !recordedHash) continue;
    let snapshot: ReturnType<typeof readFileSnapshot>;
    try {
      snapshot = readFileSnapshot(path);
    } catch {
      mismatches.push("A recorded artifact path is outside the reviewable repository boundary");
      continue;
    }
    if (!snapshot) {
      mismatches.push(`${path}: unavailable in this checkout or deployment`);
      continue;
    }
    if (snapshot.sha256 !== recordedHash) {
      mismatches.push(`${path}: current bytes do not match the recorded hash`);
    }
  }
  return mismatches;
}

function getQuoteSummary(validation: LuluValidation | null) {
  const quotes = validation?.quotes || [];
  if (!quotes.length) return "The previous sandbox quote record is unavailable here.";
  const rows = quotes.map(quote => {
    const volume = quote.productSlug === "101-volume-1" ? "Volume I" : quote.productSlug === "101-volume-2" ? "Volume II" : cleanString(quote.productSlug);
    const binding = quote.binding === "casewrap" ? "casewrap" : "paperback";
    const manufacturing = cleanString(quote.response?.line_item_costs?.[0]?.total_cost_excl_tax);
    const delivered = cleanString(quote.response?.total_cost_incl_tax);
    return `${volume} ${binding}: $${manufacturing || "?"} manufacturing, $${delivered || "?"} test-destination total`;
  });
  return rows.join("; ");
}

export function readPrintReviewSurface(): PrintReviewSurface {
  fileCache.clear();

  const products = printProducts as RawPrintProduct[];
  const manifest = readJson<ProofManifest>("output/pdf/JJ-University-101-proof-manifest.json");
  const validation = readJson<LuluValidation>("output/pdf/JJ-University-101-lulu-sandbox-validation.json");
  const disclaimerConfig = disclaimerProfiles as BookDisclaimerConfig;
  const ethicsSource = JSON.stringify(ethicsBook);

  const genericOneInterior = inspectPdf("generated/paperbacks/101-volume-1/interior.pdf", "Generic Volume I interior");
  const genericOneCover = inspectPdf("generated/paperbacks/101-volume-1/cover-wrap.pdf", "Generic Volume I paperback cover");
  const genericTwoInterior = inspectPdf("generated/paperbacks/101-volume-2/interior.pdf", "Generic Volume II interior");
  const genericTwoCover = inspectPdf("generated/paperbacks/101-volume-2/cover-wrap.pdf", "Generic Volume II paperback cover");

  const proofOneInterior = inspectPdf("output/pdf/JJ-University-101-Volume-I-the-natural-world-interior-proof.pdf", "Deterministic Volume I interior proof");
  const proofOnePaperback = inspectPdf("output/pdf/JJ-University-101-Volume-I-paperback-cover-direction-system-proof.pdf", "Deterministic Volume I paperback cover metadata");
  const proofOneCasewrap = inspectPdf("output/pdf/JJ-University-101-Volume-I-casewrap-cover-direction-system-proof.pdf", "Deterministic Volume I casewrap cover metadata");
  const proofTwoInterior = inspectPdf("output/pdf/JJ-University-101-Volume-II-the-human-world-interior-proof.pdf", "Deterministic Volume II interior proof");
  const proofTwoPaperback = inspectPdf("output/pdf/JJ-University-101-Volume-II-paperback-cover-direction-system-proof.pdf", "Deterministic Volume II paperback cover metadata");
  const proofTwoCasewrap = inspectPdf("output/pdf/JJ-University-101-Volume-II-casewrap-cover-direction-system-proof.pdf", "Deterministic Volume II casewrap cover metadata");

  const manifestInputMismatches = manifest ? compareRecordedFiles(manifest.inputs) : [];
  const manifestOutputMismatches = manifest ? compareRecordedFiles(manifest.outputs) : [];
  const validatedOne = findValidationInterior(validation, "101-volume-1");
  const validatedTwo = findValidationInterior(validation, "101-volume-2");
  const manifestOne = findManifestVolume(manifest, "101-volume-1");
  const manifestTwo = findManifestVolume(manifest, "101-volume-2");

  const genericCoverIsStale = [
    genericOneInterior.available && genericOneCover.available && genericOneCover.modifiedAt < genericOneInterior.modifiedAt,
    genericTwoInterior.available && genericTwoCover.available && genericTwoCover.modifiedAt < genericTwoInterior.modifiedAt,
  ].some(Boolean);

  const releaseSources: PrintReleaseSource[] = [
    {
      id: "public",
      title: "Bundled public-site snapshot",
      status: products.length ? "stale" : "missing",
      summary: products.length
        ? "The bundled public-site plan still names the June files. It stores page counts and URLs, but no immutable release digest."
        : "The bundled print-product plan is unavailable in this deployment, so its file pointers and page claims cannot be reviewed here.",
      volumeOnePages: cleanNumber(products.find(product => product.slug === "101-volume-1")?.actualInteriorPages),
      volumeTwoPages: cleanNumber(products.find(product => product.slug === "101-volume-2")?.actualInteriorPages),
      volumeOneHash: "",
      volumeTwoHash: "",
      observedAt: cleanString(products.find(product => product.slug === "101-volume-1")?.generatedAt),
      details: [
        "Bundled plan generation date: 2026-06-15.",
        "The editor does not re-download or expose the public PDF URLs.",
        "These pointers must not be treated as the newest proof package.",
      ],
    },
    {
      id: "generic",
      title: "Generic upload candidates",
      status: genericOneInterior.available && genericTwoInterior.available ? "stale" : "missing",
      summary: genericOneInterior.available && genericTwoInterior.available
        ? "These are the files the existing upload command would select. Their covers predate their interiors."
        : "The generic candidates are not present in this checkout or deployment.",
      volumeOnePages: genericOneInterior.pageCount,
      volumeTwoPages: genericTwoInterior.pageCount,
      volumeOneHash: genericOneInterior.sha256,
      volumeTwoHash: genericTwoInterior.sha256,
      observedAt: [genericOneInterior.modifiedAt, genericTwoInterior.modifiedAt].filter(Boolean).sort().at(-1) || "",
      details: [
        genericCoverIsStale ? "At least one generic cover is older than its matching interior." : "Cover/interior freshness could not be established here.",
        "This path has no immutable release manifest or Lulu validation binding.",
        "No upload action is available from this editor.",
      ],
    },
    {
      id: "deterministic",
      title: "Newest deterministic proofs",
      status: proofOneInterior.available && proofTwoInterior.available
        ? manifestInputMismatches.length || manifestOutputMismatches.length ? "stale" : "candidate"
        : manifest ? "stale" : "missing",
      summary: manifest
        ? "This is the strongest local proof candidate, but its recorded manifest and current files are not a sealed release."
        : "No deterministic proof manifest is available in this deployment.",
      volumeOnePages: proofOneInterior.pageCount || cleanNumber(manifestOne?.pageCount),
      volumeTwoPages: proofTwoInterior.pageCount || cleanNumber(manifestTwo?.pageCount),
      volumeOneHash: proofOneInterior.sha256 || cleanString(manifestOne?.interior?.sha256),
      volumeTwoHash: proofTwoInterior.sha256 || cleanString(manifestTwo?.interior?.sha256),
      observedAt: cleanString(manifest?.generatedAtUtc),
      details: [
        `${manifestInputMismatches.length} recorded input mismatch${manifestInputMismatches.length === 1 ? "" : "es"}.`,
        `${manifestOutputMismatches.length} recorded output mismatch${manifestOutputMismatches.length === 1 ? "" : "es"}.`,
        "Metadata is visible here; full local proof PDFs are deliberately not linked.",
      ],
    },
    {
      id: "lulu",
      title: "Last Lulu sandbox normalization",
      status: validation ? "stale" : "missing",
      summary: validation
        ? "Lulu normalized an older pair of 354/314-page interiors. Those interior hashes are not the newest proof hashes."
        : "No Lulu sandbox validation record is available in this deployment.",
      volumeOnePages: validatedOne.pageCount,
      volumeTwoPages: validatedTwo.pageCount,
      volumeOneHash: validatedOne.sha256,
      volumeTwoHash: validatedTwo.sha256,
      observedAt: cleanString(validation?.createdAtUtc),
      details: [
        `Volume I interior status: ${validatedOne.status || "not recorded"}${validatedOne.validationIds.length ? ` (${validatedOne.validationIds.join(", ")})` : ""}.`,
        `Volume II interior status: ${validatedTwo.status || "not recorded"}${validatedTwo.validationIds.length ? ` (${validatedTwo.validationIds.join(", ")})` : ""}.`,
        validation?.paidPrintJobCreated === false && validation?.printJobEndpointCalled === false
          ? "The recorded sandbox run created no paid print job and did not call the print-job endpoint."
          : "The available record does not prove that no print job was created.",
      ],
    },
  ];

  const proofArtifacts = {
    "101-volume-1": {
      interior: proofOneInterior,
      paperback: proofOnePaperback,
      casewrap: proofOneCasewrap,
      manifest: manifestOne,
      validation: validatedOne,
    },
    "101-volume-2": {
      interior: proofTwoInterior,
      paperback: proofTwoPaperback,
      casewrap: proofTwoCasewrap,
      manifest: manifestTwo,
      validation: validatedTwo,
    },
  };

  const productReviews: PrintProductReview[] = products.map(product => {
    const slug = cleanString(product.slug);
    const productBookIds = Array.isArray(product.bookIds) ? product.bookIds.map(cleanString).filter(Boolean) : [];
    const approvedReviews = productBookIds.filter(bookId => disclaimerConfig?.books?.[bookId]?.reviewStatus === "approved").length;
    const profiledReviews = productBookIds.filter(bookId => cleanString(disclaimerConfig?.books?.[bookId]?.reviewStatus)).length;
    const targetPrice = formatPrice(product.targetPriceCents);

    if (slug === "101-set") {
      const newestPages = [proofOneInterior.pageCount || cleanNumber(manifestOne?.pageCount), proofTwoInterior.pageCount || cleanNumber(manifestTwo?.pageCount)];
      const validatedPages = [validatedOne.pageCount, validatedTwo.pageCount];
      return {
        slug,
        title: cleanString(product.title),
        kicker: cleanString(product.kicker),
        kind: "bundle",
        publicPages: cleanNumber(product.actualInteriorPages),
        newestProofPages: newestPages.every(page => page != null) ? newestPages.reduce<number>((sum, page) => sum + Number(page), 0) : null,
        newestProofHash: "",
        newestPaperbackCoverHash: "",
        newestCasewrapCoverHash: "",
        lastValidatedPages: validatedPages.every(page => page != null) ? validatedPages.reduce<number>((sum, page) => sum + Number(page), 0) : null,
        lastValidatedHash: "",
        printStatus: cleanString(product.printStatus) || "not recorded",
        salesStatus: cleanString(product.salesStatus) || "not recorded",
        generatedAt: cleanString(product.generatedAt),
        format: formatProductFormat(product),
        targetPrice,
        includedBooks: productBookIds.length,
        disclaimerReviews: { profiled: profiledReviews, approved: approvedReviews },
        blockers: [
          "The public component total and newest proof component total disagree.",
          "The set is not an independently sealed release; it inherits both volume blockers.",
          "No component volume has physical-proof or sale approval.",
        ],
        proofMetadataAvailable: Boolean(manifestOne && manifestTwo),
      };
    }

    const artifact = proofArtifacts[slug as keyof typeof proofArtifacts];
    const manifestVolume = artifact?.manifest || null;
    const actualInterior = artifact?.interior;
    const paperback = artifact?.paperback;
    const casewrap = artifact?.casewrap;
    const validated = artifact?.validation || { pageCount: null, sha256: "", status: "", validationIds: [] };
    const blockers = [
      "The public file pointer is not the newest deterministic proof.",
      "The newest interior hash is not the interior hash in the last Lulu normalization.",
      `${approvedReviews}/${productBookIds.length} included books have an approved print disclaimer review.`,
      "No physical proof has been received or approved.",
    ];
    if (slug === "101-volume-2" && /all citations fall under fair use/i.test(ethicsSource)) {
      blockers.splice(3, 0, "Ethics contains a blanket fair-use claim that requires source and rights review.");
    }

    return {
      slug,
      title: cleanString(product.title),
      kicker: cleanString(product.kicker),
      kind: "collection",
      publicPages: cleanNumber(product.actualInteriorPages),
      newestProofPages: actualInterior?.pageCount || cleanNumber(manifestVolume?.pageCount),
      newestProofHash: actualInterior?.sha256 || cleanString(manifestVolume?.interior?.sha256),
      newestPaperbackCoverHash: paperback?.sha256 || findCoverHash(manifestVolume, "paperback"),
      newestCasewrapCoverHash: casewrap?.sha256 || findCoverHash(manifestVolume, "casewrap"),
      lastValidatedPages: validated.pageCount,
      lastValidatedHash: validated.sha256,
      printStatus: cleanString(product.printStatus) || "not recorded",
      salesStatus: cleanString(product.salesStatus) || "not recorded",
      generatedAt: cleanString(product.generatedAt),
      format: formatProductFormat(product),
      targetPrice,
      includedBooks: productBookIds.length,
      disclaimerReviews: { profiled: profiledReviews, approved: approvedReviews },
      blockers,
      proofMetadataAvailable: Boolean(manifestVolume || actualInterior?.available),
    };
  });

  const sparsePages = (manifestOne?.paginationAudit?.sparseNarrativePages || [])
    .map(item => cleanNumber(item.page))
    .filter((page): page is number => page != null);
  const quoteSummary = getQuoteSummary(validation);
  const allProfiled = productReviews.filter(product => product.kind === "collection").reduce((sum, product) => sum + product.disclaimerReviews.profiled, 0);
  const allApproved = productReviews.filter(product => product.kind === "collection").reduce((sum, product) => sum + product.disclaimerReviews.approved, 0);

  const queues: PrintReviewQueue[] = [
    {
      id: "release",
      number: 1,
      title: "Choose the next working release",
      eyebrow: "Release conflict",
      summary: "Four asset stories disagree. Nothing should move to Lulu or the public pointer until one regenerated package becomes canonical.",
      why: "Page counts, hashes, covers, validator records, and public metadata must travel together as one release.",
      recommended: "Rebuild from the newest approved manuscript revisions, write a fresh manifest, then validate that exact digest.",
      evidence: releaseSources.map(source => `${source.title}: ${source.volumeOnePages ?? "?"}/${source.volumeTwoPages ?? "?"} pages; ${shortHash(source.volumeOneHash)} / ${shortHash(source.volumeTwoHash)}`),
      options: [
        { id: "rebuild-and-revalidate", label: "Rebuild and revalidate", help: "Use the newest deterministic direction only as the starting point for a fresh sealed candidate." },
        { id: "review-newest-first", label: "Review newest proofs first", help: "Inspect the 354/314-page candidate before authorizing another render." },
        { id: "defer", label: "Defer this decision", help: "Keep every release, upload, order, and sale gate locked." },
      ],
    },
    {
      id: "cover",
      number: 2,
      title: "Pick a cover direction",
      eyebrow: "Cover",
      summary: "Archive, Library, and Field Index replace the incorrectly branded first board. The older System wraps remain construction references only.",
      why: "Cover direction must be chosen before final wrap generation, barcode placement, validation, and a physical proof.",
      recommended: "Compare Archive and Library first: Archive is more distinctive; Library is the strongest repeatable shelf system. Pick neither unless one actually feels right.",
      evidence: [
        "Archive: subject-specific reference plates beneath exact deterministic typography.",
        "Library: clothbound encyclopedia styling with a repeatable title label and spine logic.",
        "Field Index: a modern catalog system descended from the strongest part of the previous Index direction.",
        "All three use 101 as the line, How We Figured It Out as supporting language, and the actual volume title as the primary title.",
        "No cover direction is recorded as approved.",
      ],
      options: [
        { id: "archive", label: "Archive", help: "Develop the illustrated reference-plate system into exact paperback and casewrap proofs." },
        { id: "library", label: "Library", help: "Develop the clothbound encyclopedia system around shelf consistency and future volumes." },
        { id: "field-index", label: "Field Index", help: "Develop the corrected academic index system into exact package wraps." },
        { id: "defer", label: "I need to see better proofs", help: "Do not infer a cover choice from the existing concept metadata." },
      ],
    },
    {
      id: "format",
      number: 3,
      title: "Confirm trim and binding",
      eyebrow: "Format",
      summary: "The baseline is 6×9, black-and-white, cream paper, matte finish. Paperback and casewrap are separate products.",
      why: "Each binding needs its own package ID, wrap dimensions, validation, pricing, and physical proof.",
      recommended: "Prove one paperback of each volume first. Consider casewrap only after the paperback system passes in hand.",
      evidence: [
        "Paperback wrap metadata: Volume I 13.107×9.25 in; Volume II 13.017×9.25 in.",
        "Casewrap metadata: Volume I 14.813×10.75 in; Volume II 14.75×10.75 in.",
        "The current public JSON calls the edition perfect-bound paperback, cream paper, matte finish.",
      ],
      options: [
        { id: "paperback-first", label: "Paperback first", help: "Keep casewrap out of the first physical-proof sequence." },
        { id: "paperback-then-casewrap", label: "Paperback, then casewrap", help: "Retain casewrap as a later, separately proofed premium edition." },
        { id: "revise-format", label: "Revise the format", help: "Revisit trim, paper, color, binding, or finish before rebuilding." },
        { id: "defer", label: "Defer", help: "Keep package selection unresolved." },
      ],
    },
    {
      id: "legal",
      number: 4,
      title: "Review the legal and identity page",
      eyebrow: "Legal page",
      summary: "The one-page proofs are labeled not for sale, but publication identity and final legal decisions remain open.",
      why: "A clean copyright page does not establish factual accuracy, fair use, ownership, or permission.",
      recommended: "Review the author/copyright identity, AI-process paragraph, edition language, and a stable corrections destination before final layout.",
      evidence: [
        `Manifest status: ${cleanString(manifest?.status) || "not available"}.`,
        "The current proof copy omits final ISBN, printer, edition-specific corrections URL, and included-title identity.",
        "Volume II is the denser one-page layout and deserves a phone and print readability check.",
      ],
      options: [
        { id: "direction-looks-right", label: "Wording direction looks right", help: "A local review note only—not legal, publication, or sale approval." },
        { id: "revise", label: "Revise the page", help: "Record copy, identity, density, or disclosure changes in the note." },
        { id: "qualified-review", label: "Get qualified review", help: "Hold publication while higher-risk language or subject matter is reviewed." },
        { id: "defer", label: "Defer", help: "Leave the legal-page decision open." },
      ],
    },
    {
      id: "facts-rights",
      number: 5,
      title: "Run factual, source, and rights review",
      eyebrow: "Facts and rights",
      summary: `${allProfiled}/16 included-book profiles exist; ${allApproved}/16 are approved. Profiles are triage, not clearance.`,
      why: "The current release gate requires full manuscript factual review plus source, quotation, and rights review.",
      recommended: "Review each included title with evidence. Surface Ethics first because its source notice makes a blanket fair-use claim.",
      evidence: [
        /all citations fall under fair use/i.test(ethicsSource)
          ? "Ethics currently states that all citations fall under fair use."
          : "The Ethics source notice could not be inspected in this deployment.",
        "A disclaimer cannot substitute for correcting unsupported or dangerous material.",
        "No one-click or blanket approval is offered here.",
      ],
      options: [
        { id: "start-title-review", label: "Start title-by-title review", help: "Create evidence-backed decisions for each of the sixteen included books." },
        { id: "qualified-review", label: "Route higher-risk work for review", help: "Identify titles needing legal, medical, financial, or other qualified review." },
        { id: "defer", label: "Defer", help: "Keep factual and rights gates explicitly unresolved." },
      ],
    },
    {
      id: "interior",
      number: 6,
      title: "Inspect the interior",
      eyebrow: "Interior",
      summary: "Check title pages, contents, recto starts, folios, dividers, intentional blanks, and endings before a physical proof.",
      why: "Automated page-count and density checks do not establish that the book feels right page by page.",
      recommended: "Review the flagged Volume I endings first, then sample every divider and the beginning/end of every included book.",
      evidence: [
        sparsePages.length ? `Volume I sparse rhetorical endings: pages ${sparsePages.join(", ")}.` : "Sparse-page metadata is unavailable in this deployment.",
        "Decide whether grayscale original covers should replace or accompany text dividers.",
        "The protected gallery exposes selected raster views; it does not replace a complete source-PDF review.",
      ],
      options: [
        { id: "layout-direction", label: "Layout direction looks right", help: "Continue reviewing; this does not approve a physical or sale release." },
        { id: "revise", label: "Revise the interior", help: "Record specific page, divider, folio, margin, or pacing issues." },
        { id: "need-protected-proof", label: "I need the protected full proof", help: "Hold the decision until exact hash-pinned pages can be viewed safely." },
        { id: "defer", label: "Defer", help: "Leave interior review open." },
      ],
    },
    {
      id: "isbn",
      number: 7,
      title: "Decide ISBN, barcode, and distribution",
      eyebrow: "ISBN and barcode",
      summary: "The current System wraps reserve a blank barcode area, but no final identifier or distribution model is recorded.",
      why: "ISBN ownership and distribution choices affect metadata, barcode contents, pricing, and where the edition can be sold.",
      recommended: "Keep proof copies identifier-neutral until the distribution path is deliberate and metadata matches exactly.",
      evidence: [
        "No ISBN is recorded in the public print-product plan.",
        "Direct API fulfillment and retail/global distribution are different commercial paths.",
        "Barcode placement must be regenerated on the exact final wrap, not pasted onto a stale cover.",
      ],
      options: [
        { id: "proof-without-final-isbn", label: "Proof without final ISBN", help: "Keep identifiers unresolved during the first physical layout proof." },
        { id: "owned-isbn", label: "Use an owned ISBN", help: "Record the exact identifier and matching publisher metadata later." },
        { id: "research-distribution", label: "Research distribution first", help: "Decide sales channels before assigning identifiers." },
        { id: "defer", label: "Defer", help: "Keep ISBN and barcode unresolved." },
      ],
    },
    {
      id: "price",
      number: 8,
      title: "Set price from a fresh quote",
      eyebrow: "Pricing",
      summary: "The public plan shows $34.99 per volume and $64.99 for the set, but those are target placeholders.",
      why: "Manufacturing, shipping, tax, payment cost, refunds, and distribution terms depend on the exact release and destination.",
      recommended: "Requote the approved paperback release immediately before setting a public price.",
      evidence: [
        quoteSummary,
        "The previous quote used a public institutional test destination, not James's delivery address.",
        "No price choice here enables checkout.",
      ],
      options: [
        { id: "requote-approved-release", label: "Requote the approved release", help: "Use exact final pages, binding, destination, shipping, and taxes." },
        { id: "keep-target-placeholder", label: "Keep targets as placeholders", help: "Continue displaying draft targets internally without treating them as approved prices." },
        { id: "revise-targets", label: "Revise target prices", help: "Record the intended contribution or affordability goal in the note." },
        { id: "defer", label: "Defer", help: "Leave pricing unresolved." },
      ],
    },
    {
      id: "physical-proof",
      number: 9,
      title: "Keep the physical-proof gate explicit",
      eyebrow: "Physical proof",
      summary: "No order control exists here. The available sandbox record says no paid job was created and the print-job endpoint was not called.",
      why: "A real proof requires exact files, delivery address, price, charge authorization, idempotency, and in-hand inspection.",
      recommended: "Keep ordering locked. Prepare a separate final review only after every earlier gate is tied to one release digest.",
      evidence: [
        `Sandbox record: paidPrintJobCreated=${String(validation?.paidPrintJobCreated ?? "unknown")}; printJobEndpointCalled=${String(validation?.printJobEndpointCalled ?? "unknown")}.`,
        "No upload, order, charge, checkout, or sale function is imported by this editor.",
        "Receiving a proof does not approve it; in-hand issues must be recorded against the same release.",
      ],
      options: [
        { id: "keep-locked", label: "Keep ordering locked", help: "Recommended until one exact release has passed every prior gate." },
        { id: "prepare-final-review", label: "Prepare a later order review", help: "Gather address and cost only after the release is sealed; do not order from this screen." },
        { id: "defer", label: "Defer", help: "Leave the physical-proof step untouched." },
      ],
    },
  ];

  const evidence = {
    contractVersion: CONTRACT_VERSION,
    releaseBlocked: true as const,
    releaseSources,
    products: productReviews,
    queues,
    manifest: {
      available: Boolean(manifest),
      generatedAt: cleanString(manifest?.generatedAtUtc),
      status: cleanString(manifest?.status),
      inputMismatches: manifestInputMismatches,
      outputMismatches: manifestOutputMismatches,
    },
    validation: {
      available: Boolean(validation),
      createdAt: cleanString(validation?.createdAtUtc),
      environment: cleanString(validation?.environment),
      paidPrintJobCreated: typeof validation?.paidPrintJobCreated === "boolean" ? validation.paidPrintJobCreated : null,
      printJobEndpointCalled: typeof validation?.printJobEndpointCalled === "boolean" ? validation.printJobEndpointCalled : null,
      proofDigest: cleanString(validation?.proofDigest),
    },
    publicProofDeliveryConfigured: false as const,
  };
  const baseDigest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");

  return {
    ...evidence,
    baseDigest,
    loadedAt: new Date().toISOString(),
  };
}
