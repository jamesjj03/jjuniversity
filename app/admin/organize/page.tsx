import type { Metadata } from "next";
import CollectionsWall from "@/components/workshop/CollectionsWall";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import { LEGACY_BOOK_ID_ALIASES } from "@/lib/bookAliases";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Collections | JJU Workshop",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function loadOrganizerBooks() {
  try {
    const catalog = await readAdminBookCatalog();
    const books = catalog.books.map(value => {
      const book = normalizeWorkshopBook(value);
      return {
        id: book.id,
        title: book.title,
        subtitle: book.subtitle,
        status: book.status,
        visibility: book.visibility,
        coverSrc: coverWebpSrc(book, book.id),
        fallbackCoverSrc: coverFallbackSrc(book, book.id),
        legacyAlias: Object.hasOwn(LEGACY_BOOK_ID_ALIASES, book.id),
      };
    }).filter(book => book.id);
    return { books, error: "" };
  } catch (error) {
    return {
      books: [],
      error: error instanceof Error ? error.message : "The authoritative catalog could not be loaded.",
    };
  }
}

export default async function OrganizePage({ searchParams }: { searchParams: SearchParams }) {
  const [query, data] = await Promise.all([searchParams, loadOrganizerBooks()]);
  const selectedBook = Array.isArray(query.book) ? query.book[0] || "" : query.book || "";

  if (data.error) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel} role="alert">
          <p className={styles.eyebrow}>Collections Organizer</p>
          <h1>Editing is safely locked</h1>
          <p>{data.error}</p>
          <p>No bundled or partial catalog was substituted.</p>
        </section>
      </main>
    );
  }

  return <CollectionsWall books={data.books} initialBookId={selectedBook.trim().toLowerCase()} />;
}
