import type { Metadata } from "next";
import path from "node:path";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import WorkshopHubCard from "@/components/workshop/WorkshopHubCard";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import { readGithubJson, readLocalJson } from "@/lib/adminVersionedJson";
import { LEGACY_BOOK_ID_ALIASES } from "@/lib/bookAliases";
import {
  collectionAssignments,
  diagnoseOrganizerPaths,
  isOrganizerPathsFile,
  organizerCollections,
  ORGANIZER_NEEDS_YOU_QUEUES,
  preparePathsForSave,
} from "@/lib/collectionsOrganizer";
import { getCaseReviewAvailability } from "@/lib/manuscriptCaseReview";
import { readTacosAudioReview } from "@/lib/audioReview";
import { readPrintReviewSurface } from "@/lib/printReview";
import core from "@/app/admin/WorkshopCore.module.css";
import styles from "./NeedsYou.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review | JJU Workshop",
  robots: { index: false, follow: false },
};

async function readOrganizerPaths() {
  const github = await readGithubJson("public/paths.json");
  const value = github
    ? github.value
    : (await readLocalJson(path.join(process.cwd(), "public", "paths.json"))).value;
  if (!isOrganizerPathsFile(value)) throw new Error("The Collections document is invalid.");
  return preparePathsForSave(value);
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

async function readHumanReviewSnapshot() {
  const [catalogResult, caseResult, pathsResult, audioResult] = await Promise.allSettled([
    readAdminBookCatalog(),
    getCaseReviewAvailability(),
    readOrganizerPaths(),
    readTacosAudioReview(),
  ]);
  const books = catalogResult.status === "fulfilled" ? catalogResult.value.books : [];
  const print = readPrintReviewSurface();
  const paths = pathsResult.status === "fulfilled" ? pathsResult.value : null;
  const validBookIds = new Set(books.map(book => String(book.id || "").trim().toLowerCase()).filter(Boolean));
  const organizerDiagnostics = paths ? diagnoseOrganizerPaths(paths, validBookIds) : [];
  const organizerAvailable = Boolean(paths)
    && catalogResult.status === "fulfilled"
    && !organizerDiagnostics.some(item => item.blocking && !item.passed);
  const assignments = paths ? collectionAssignments(paths) : new Map<string, string[]>();
  const audio = audioResult.status === "fulfilled" && audioResult.value.status === "available"
    ? audioResult.value
    : null;
  return {
    bookReviewCount: books.filter(book => String(book.status || "").toLowerCase() === "needs-review").length,
    catalogAvailable: catalogResult.status === "fulfilled",
    caseReviewAvailable: caseResult.status === "fulfilled" && caseResult.value.available,
    printDecisionCount: print.queues.length,
    printDisclaimerApproved: print.products
      .filter(product => product.kind === "collection")
      .reduce((sum, product) => sum + product.disclaimerReviews.approved, 0),
    printDisclaimerTotal: print.products
      .filter(product => product.kind === "collection")
      .reduce((sum, product) => sum + product.includedBooks, 0),
    organizerAvailable,
    organizerCollectionCount: organizerAvailable && paths ? organizerCollections(paths).length : 0,
    organizerUncollectedCount: organizerAvailable ? books.filter(book => {
      const id = String(book.id || "").trim().toLowerCase();
      return id
        && !Object.hasOwn(LEGACY_BOOK_ID_ALIASES, id)
        && String(book.status || "").trim().toLowerCase() === "ready"
        && String(book.visibility || "").trim().toLowerCase() === "main"
        && !(assignments.get(id)?.length);
    }).length : 0,
    audioAvailable: Boolean(audio),
    audioTrackCount: audio?.tracks.length || 0,
    audioTechnicalPassCount: audio?.technicalPassCount || 0,
    audioTotalSeconds: audio?.totalSeconds || 0,
    audioPreviewAvailable: audio?.previewAvailable || false,
    audioHumanApproved: audio?.humanListenApproved || false,
  };
}

export default async function ReviewsPage() {
  const snapshot = await readHumanReviewSnapshot();
  const organizerCount = ORGANIZER_NEEDS_YOU_QUEUES.reduce((sum, queue) => sum + queue.issues.length, 0);
  const deployed = process.env.VERCEL === "1";

  return (
    <main className={`${core.page} ${styles.page}`}>
      <header className={core.pageHeader}>
        <div>
          <p className={core.eyebrow}>Review</p>
          <h1>The calls that require your eyes.</h1>
          <p className={core.intro}>The Workshop can surface evidence, preserve drafts, and block unsafe release states. These are the judgment calls it cannot honestly make for you.</p>
        </div>
      </header>

      <section className={styles.priorityGrid} aria-label="Priority human review queues">
        <GuardedAdminLink className={styles.priorityCard} href="/admin/audio" prefetch={false}>
          <div className={styles.cardTop}><span className={styles.priority}>Start here</span><strong>1</strong></div>
          <p className={styles.kicker}>Audio · Exact QA record</p>
          <h2>{snapshot.audioAvailable ? snapshot.audioHumanApproved ? "Tacos listening approved" : "Listen to Tacos" : "Audio review is safely locked"}</h2>
          <p>{snapshot.audioAvailable
            ? snapshot.audioHumanApproved
              ? `All ${snapshot.audioTechnicalPassCount} sealed MP3s passed the objective screen and James approved the complete listening proof. Publication remains a separate decision.`
              : `All ${snapshot.audioTechnicalPassCount} sealed MP3s passed the objective screen. Publication remains blocked until you hear the full edition and check the targeted openings, tails, and room tone.`
            : "The exact private QA package could not be verified, so the Workshop refuses to claim a technical pass or invent a track count."}</p>
          <div className={styles.facts}>
            {snapshot.audioAvailable ? <><span>{snapshot.audioTrackCount} tracks</span><span>{formatDuration(snapshot.audioTotalSeconds)}</span><span>{snapshot.audioHumanApproved ? "Human listen approved" : "Human approval pending"}</span></> : <span>No partial audio shown</span>}
          </div>
          <strong className={styles.action}>{snapshot.audioAvailable && snapshot.audioPreviewAvailable ? "Open the listening review →" : "Open the locked audio desk →"}</strong>
        </GuardedAdminLink>

        <GuardedAdminLink className={styles.priorityCard} href="/admin/print" prefetch={false}>
          <div className={styles.cardTop}><span className={styles.priority}>Before any proof order</span><strong>2</strong></div>
          <p className={styles.kicker}>Print · Not for sale</p>
          <h2>Lock the physical-book direction</h2>
          <p>Four release stories conflict. Work through the cover, format, legal page, facts and rights, interior, identifiers, pricing, and physical-proof gates.</p>
          <div className={styles.facts}>
            <span>{snapshot.printDecisionCount} decisions</span>
            <span>{snapshot.printDisclaimerApproved}/{snapshot.printDisclaimerTotal} disclaimer reviews approved</span>
          </div>
          <strong className={styles.action}>Open the print editor →</strong>
        </GuardedAdminLink>

        <GuardedAdminLink className={styles.priorityCard} href="/admin/organize" prefetch={false}>
          <div className={styles.cardTop}><span className={styles.priority}>Editorial structure</span><strong>3</strong></div>
          <p className={styles.kicker}>Library organization</p>
          <h2>Make the Collection and taxonomy calls</h2>
          <p>The finite queue separates editable Collection decisions from Shelf policy, Topic boundaries, duplicate records, and cover problems.</p>
          <div className={styles.facts}>
            <span>{organizerCount} known calls</span>
            {snapshot.organizerAvailable ? <><span>{snapshot.organizerCollectionCount} Collections</span><span>{snapshot.organizerUncollectedCount} optional uncollected books</span></> : <span>Current counts safely locked</span>}
          </div>
          <strong className={styles.action}>{snapshot.organizerAvailable ? "Open the organizer →" : "Open the locked organizer →"}</strong>
        </GuardedAdminLink>

        <GuardedAdminLink className={styles.priorityCard} href="/admin/books?status=needs-review" prefetch={false}>
          <div className={styles.cardTop}><span className={styles.priority}>Book-level queue</span><strong>4</strong></div>
          <p className={styles.kicker}>Editorial status</p>
          <h2>Review flagged books</h2>
          <p>{snapshot.catalogAvailable
            ? `${snapshot.bookReviewCount} catalog book${snapshot.bookReviewCount === 1 ? " is" : "s are"} explicitly marked needs review. This status is not a factual-accuracy guarantee.`
            : "The authoritative catalog is unavailable, so the Workshop refuses to invent a count."}</p>
          <strong className={styles.action}>{snapshot.catalogAvailable ? "Open the filtered library →" : "Catalog safely locked"}</strong>
        </GuardedAdminLink>
      </section>

      <section className={styles.boundary} aria-labelledby="handled-title">
        <div>
          <p className={styles.kicker}>Not dumped in your lap</p>
          <h2 id="handled-title">Database security, private files, and version locks are engineering work.</h2>
        </div>
        <p>You should see release and editorial choices here—not raw Supabase policies, service credentials, or migration plumbing.</p>
      </section>

      <section className={styles.secondarySection} aria-labelledby="ongoing-title">
        <header>
          <p className={styles.kicker}>Ongoing review rooms</p>
          <h2 id="ongoing-title">Useful, but not today&apos;s first release gates</h2>
        </header>
        <div className={core.hubGrid}>
          <WorkshopHubCard
            title="Capitalization cases"
            description={snapshot.caseReviewAvailable
              ? "Continue the reviewed case batches locally. Decisions remain separate from manuscript application."
              : "The large audit artifact and writable decisions remain local-only; the deployed Workshop explains that boundary."}
            status={snapshot.caseReviewAvailable ? "Local review ready" : "Local only"}
            action={snapshot.caseReviewAvailable ? "Open case review" : "See availability"}
            href="/admin/manuscript-case"
          />
          <WorkshopHubCard
            title="Editorial records"
            description="Review existing editorial records. Audit coverage is progress, not proof that a claim is correct."
            status="Protected review index"
            action="Open editorial reviews"
            href="/admin/editorial"
          />
          <WorkshopHubCard
            title="Atlas explanations and links"
            description="Review the four source-backed map explanations and ten proposed JJU-to-place associations. Nothing AI-proposed is treated as human-approved."
            status="Two evidence queues"
            action="Open Atlas review"
            href="/admin/atlas"
          />
          <WorkshopHubCard
            title="Arena source review"
            description={deployed
              ? "Arena writes local review files, so it remains unavailable in the deployed Workshop."
              : "Review local source candidates and diagram packs without publishing them."}
            status={deployed ? "Local only" : "Local file workspace"}
            action={deployed ? "Use local Workshop" : "Open Arena"}
            href={deployed ? undefined : "/admin/arena"}
          />
        </div>
      </section>
    </main>
  );
}
