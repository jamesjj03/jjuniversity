import Link from "next/link";
import type { Metadata } from "next";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";
import { absoluteUrl, bookUrl, getPublicBooksLive } from "@/lib/publishing";
import { jsonLd, pageMetadata } from "@/lib/seo";
import styles from "./BookIndex.module.css";

export const revalidate = 600;

export const metadata: Metadata = pageMetadata({
  title: "Complete Book Index",
  description: "An A-Z index of every public JJ University book, with direct links to each book and its readable sections.",
  path: "/books/index",
});

function indexLetter(title: string) {
  const first = title.normalize("NFKD").match(/[A-Za-z0-9]/)?.[0] || "#";
  return /[A-Za-z]/.test(first) ? first.toUpperCase() : "#";
}

export default async function CompleteBookIndexPage() {
  const books = [...await getPublicBooksLive()].sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }));
  const groups = new Map<string, typeof books>();

  for (const book of books) {
    const letter = indexLetter(book.title);
    groups.set(letter, [...(groups.get(letter) || []), book]);
  }

  const entries = [...groups.entries()].sort(([a], [b]) => (
    a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b)
  ));
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "JJ University complete book index",
    numberOfItems: books.length,
    itemListElement: books.map((book, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: book.title,
      url: absoluteUrl(bookUrl(book)),
    })),
  };

  return (
    <SiteV2Shell>
      <div className={styles.page}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList) }} />

        <header className={styles.hero}>
          <p className={styles.kicker}>Library index</p>
          <h1>Every public book, A-Z.</h1>
          <p>
            {books.length.toLocaleString()} books in one plain, complete directory. Open a title for its description,
            collections, topics, and linked reading sections.
          </p>
          <Link className={styles.browseLink} href="/books">Browse the visual library</Link>
        </header>

        <nav className={styles.letterNav} aria-label="Jump to a letter">
          {entries.map(([letter]) => (
            <a href={`#letter-${letter === "#" ? "number" : letter.toLowerCase()}`} key={letter}>{letter}</a>
          ))}
        </nav>

        <div className={styles.groups}>
          {entries.map(([letter, letterBooks]) => (
            <section
              className={styles.group}
              id={`letter-${letter === "#" ? "number" : letter.toLowerCase()}`}
              key={letter}
            >
              <div className={styles.groupHeading}>
                <h2>{letter}</h2>
                <span>{letterBooks.length} {letterBooks.length === 1 ? "book" : "books"}</span>
              </div>
              <ul>
                {letterBooks.map(book => (
                  <li key={book.id}>
                    <Link href={bookUrl(book)}>
                      <strong>{book.title}</strong>
                      {book.subtitle && <span>{book.subtitle}</span>}
                    </Link>
                    <div className={styles.bookFacts}>
                      {book.wordCount > 0 && <span>{book.wordCount.toLocaleString()} words</span>}
                      {book.status === "coming-soon" && <span>Coming soon</span>}
                      {book.visibility === "archive" && <span>Archive</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </SiteV2Shell>
  );
}
