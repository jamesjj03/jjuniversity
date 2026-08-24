"use client";

import CoverImage from "@/components/CoverImage";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import { workshopBookPublicState, workshopBookStatusLabel, type WorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";

type Props = {
  book: WorkshopBook;
  active: "overview" | "manuscript";
  returnHref: string;
};

function withReturn(href: string, returnHref: string) {
  return `${href}?from=${encodeURIComponent(returnHref)}`;
}

export default function BookWorkspaceHeader({ book, active, returnHref }: Props) {
  const publicHref = `/books/${encodeURIComponent(book.slug || book.id)}`;

  return (
    <>
      <header className={styles.bookHeader}>
        <div className={styles.bookIdentity}>
          <div className={styles.bookHeaderCover}>
            <CoverImage
              alt=""
              fallbackSrc={coverFallbackSrc(book)}
              height={123}
              sizes="82px"
              src={coverWebpSrc(book)}
              width={82}
            />
          </div>
          <div>
            <p className={styles.eyebrow}>{book.id}</p>
            <h1>{book.title}</h1>
            <div className={styles.bookMetaLine}>
              <span>{workshopBookStatusLabel(book.status)}</span>
              <span>·</span>
              <span>{workshopBookPublicState(book)}</span>
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <GuardedAdminLink className={styles.secondaryButton} href={returnHref}>Back to Books</GuardedAdminLink>
          <GuardedAdminLink className={styles.quietButton} href={publicHref}>View public book</GuardedAdminLink>
        </div>
      </header>

      <nav className={styles.bookTabs} aria-label={`${book.title} workspace`}>
        <GuardedAdminLink
          className={active === "overview" ? styles.activeBookTab : styles.bookTab}
          href={withReturn(`/admin/books/${encodeURIComponent(book.id)}`, returnHref)}
          aria-current={active === "overview" ? "page" : undefined}
        >
          Overview
        </GuardedAdminLink>
        <GuardedAdminLink
          className={active === "manuscript" ? styles.activeBookTab : styles.bookTab}
          href={withReturn(`/admin/books/${encodeURIComponent(book.id)}/manuscript`, returnHref)}
          aria-current={active === "manuscript" ? "page" : undefined}
        >
          Manuscript
        </GuardedAdminLink>
      </nav>
    </>
  );
}
