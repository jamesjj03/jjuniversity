export type PrintArtifactSnapshot = {
  available: boolean;
  pageCount: number | null;
  sha256: string;
  bytes: number | null;
  modifiedAt: string;
  label: string;
};

export type PrintReleaseSource = {
  id: "public" | "generic" | "deterministic" | "lulu";
  title: string;
  status: "blocked" | "stale" | "candidate" | "missing";
  summary: string;
  volumeOnePages: number | null;
  volumeTwoPages: number | null;
  volumeOneHash: string;
  volumeTwoHash: string;
  observedAt: string;
  details: string[];
};

export type PrintProductReview = {
  slug: string;
  title: string;
  kicker: string;
  kind: "collection" | "bundle";
  publicPages: number | null;
  newestProofPages: number | null;
  newestProofHash: string;
  newestPaperbackCoverHash: string;
  newestCasewrapCoverHash: string;
  lastValidatedPages: number | null;
  lastValidatedHash: string;
  printStatus: string;
  salesStatus: string;
  generatedAt: string;
  format: string;
  targetPrice: string;
  includedBooks: number;
  disclaimerReviews: {
    profiled: number;
    approved: number;
  };
  blockers: string[];
  proofMetadataAvailable: boolean;
};

export type PrintDecisionOption = {
  id: string;
  label: string;
  help: string;
};

export type PrintReviewQueue = {
  id: string;
  number: number;
  title: string;
  eyebrow: string;
  summary: string;
  why: string;
  recommended: string;
  evidence: string[];
  options: PrintDecisionOption[];
};

export type PrintReviewSurface = {
  contractVersion: string;
  baseDigest: string;
  loadedAt: string;
  releaseBlocked: true;
  releaseSources: PrintReleaseSource[];
  products: PrintProductReview[];
  queues: PrintReviewQueue[];
  manifest: {
    available: boolean;
    generatedAt: string;
    status: string;
    inputMismatches: string[];
    outputMismatches: string[];
  };
  validation: {
    available: boolean;
    createdAt: string;
    environment: string;
    paidPrintJobCreated: boolean | null;
    printJobEndpointCalled: boolean | null;
    proofDigest: string;
  };
  publicProofDeliveryConfigured: false;
};

export type PrintReviewDecision = {
  optionId: string;
  note: string;
};

export type PrintReviewDraftEnvelope = {
  schemaVersion: 1;
  contractVersion: string;
  baseDigest: string;
  revision: number;
  revisionLabel: string;
  savedAt: string;
  decisions: Record<string, PrintReviewDecision>;
};
