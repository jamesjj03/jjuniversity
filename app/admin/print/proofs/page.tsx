import type { Metadata } from "next";
import Image from "next/image";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import {
  getPrintProofPreviewHref,
  PRINT_PROOF_PREVIEW_GROUPS,
  type PrintProofPreviewAsset,
} from "@/lib/printProofGallery";
import coreStyles from "@/app/admin/WorkshopCore.module.css";
import styles from "./PrintProofGallery.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Print Proof Gallery | JJU Workshop",
  robots: { index: false, follow: false, nocache: true },
};

function shortHash(value: string) {
  return `${value.slice(0, 12)}...`;
}

function ProofFigure({ asset, priority = false }: { asset: PrintProofPreviewAsset; priority?: boolean }) {
  const href = getPrintProofPreviewHref(asset.id);
  return (
    <figure className={styles.proofFigure} data-shape={asset.width > asset.height ? "landscape" : "portrait"}>
      <a
        className={styles.proofImageLink}
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${asset.label} at full size`}
        style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
      >
        <Image
          alt={`${asset.label}. ${asset.note}`}
          className={styles.proofImage}
          height={asset.height}
          loading={priority ? "eager" : "lazy"}
          priority={priority}
          sizes={asset.width > asset.height ? "(max-width: 720px) 100vw, 1100px" : "(max-width: 720px) 100vw, 520px"}
          src={href}
          unoptimized
          width={asset.width}
        />
        <span>Open full size</span>
      </a>
      <figcaption>
        <div>
          <strong>{asset.label}</strong>
          <span>{asset.note}</span>
        </div>
        <details>
          <summary>Exact source</summary>
          <dl>
            <div><dt>PDF</dt><dd>{asset.sourceLabel}</dd></div>
            <div><dt>Source page</dt><dd>{asset.sourcePage}</dd></div>
            <div><dt>PDF hash</dt><dd><code title={asset.sourceSha256}>{shortHash(asset.sourceSha256)}</code></dd></div>
          </dl>
        </details>
      </figcaption>
    </figure>
  );
}

export default function PrintProofGalleryPage() {
  const proofCount = PRINT_PROOF_PREVIEW_GROUPS.reduce((sum, group) => sum + group.assets.length, 0);
  return (
    <main className={`${coreStyles.page} ${styles.page}`}>
      <section className={styles.reviewBanner} role="note" aria-labelledby="proof-gallery-review-title">
        <div>
          <p>Protected print workspace</p>
          <div className={styles.reviewTitle} id="proof-gallery-review-title">Cover and interior review</div>
          <span>Compare the evidence here. Ordering and publishing remain separate.</span>
        </div>
      </section>

      <header className={coreStyles.pageHeader}>
        <div>
          <p className={coreStyles.eyebrow}>JJU Workshop - Print proofs</p>
          <h1>Look at the actual pages.</h1>
          <p className={coreStyles.intro}>
            {proofCount} protected raster views derived from the exact local proof sources: all three cover directions, four real wraps, and the pages most useful for judging each interior on a phone or desktop.
          </p>
        </div>
        <div className={coreStyles.headerActions}>
          <GuardedAdminLink className={coreStyles.secondaryButton} href="/admin/print">Back to Print decisions</GuardedAdminLink>
        </div>
      </header>

      <aside className={styles.honestyNote}>
        <strong>What this proves</strong>
        <p>
          These images let you judge the current design and selected problem pages. They are not the source PDFs, a page-by-page approval of all 668 interior pages, a physical proof, factual clearance, rights clearance, or permission to publish.
        </p>
      </aside>

      <nav className={styles.jumpNav} aria-label="Jump to a print proof group">
        {PRINT_PROOF_PREVIEW_GROUPS.map(group => <a href={`#${group.id}`} key={group.id}>{group.title}</a>)}
      </nav>

      {PRINT_PROOF_PREVIEW_GROUPS.map(group => (
        <section className={styles.proofSection} id={group.id} key={group.id} aria-labelledby={`${group.id}-title`}>
          <header>
            <p className={coreStyles.eyebrow}>{group.assets.length} protected views</p>
            <h2 id={`${group.id}-title`}>{group.title}</h2>
            <p>{group.summary}</p>
          </header>
          <div className={styles.proofGrid} data-group={group.id}>
            {group.assets.map((asset, assetIndex) => (
              <ProofFigure asset={asset} priority={assetIndex === 0} key={asset.id} />
            ))}
          </div>
        </section>
      ))}

      <section className={styles.noActionPanel}>
        <strong>This gallery cannot move a book toward sale.</strong>
        <p>Use the Print decision desk to record local notes. Ordering remains a separate, explicit, later approval.</p>
        <GuardedAdminLink className={coreStyles.primaryButton} href="/admin/print">Return to Print decisions</GuardedAdminLink>
      </section>
    </main>
  );
}
