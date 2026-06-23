"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import CoverImage from "@/components/CoverImage";

type Book = {
  id: string;
  title?: string;
  coverFile?: string;
  cover?: string;
  tags?: string[];
  series?: string;
  status?: string;
};

const DEFAULT_START = [
  { id: "science", displayTitle: "Science 101", why: "A clean entry point for how humans figured things out." },
  { id: "humans", displayTitle: "humanity.exe", why: "People, systems, and the operating code underneath us." },
  { id: "caesar", displayTitle: "CAESAR", why: "Power, ambition, collapse, and one of history's most useful warnings." },
  { id: "bible", displayTitle: "What the Bible Actually Says", why: "A direct route into Scripture and the roots of Western imagination." },
  { id: "edison", displayTitle: "EDISON", why: "Invention, myth, business, genius, and the machine age waking up." },
];

function coverFor(book: Book | undefined, fallbackId: string) {
  return coverWebpSrc(book, fallbackId);
}

function legacyCoverFor(book: Book | undefined, fallbackId: string) {
  return coverFallbackSrc(book, fallbackId);
}

function normalizeStartCards(items: typeof DEFAULT_START) {
  return items.map(item => {
    if (item.id === "caesar") return { ...item, displayTitle: "CAESAR" };
    if (item.id === "edison") return { ...item, displayTitle: "EDISON" };
    return item;
  });
}

export default function LibraryPreview() {
  const [books, setBooks] = useState<Book[]>([]);
  const [startCards, setStartCards] = useState(DEFAULT_START);

  useEffect(() => {
    fetch("/api/books")
      .then(r => r.json())
      .then(data => setBooks(Array.isArray(data) ? data : data.books || []))
      .catch(() => setBooks([]));

    fetch("/site.json")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data?.homeCards) && data.homeCards.length) setStartCards(normalizeStartCards(data.homeCards));
      })
      .catch(() => setStartCards(DEFAULT_START));
  }, []);

  return (
    <section className="homeStartSection">
      <div className="homeStartHeader">
        <h2>Start Here</h2>
        <p>Five good rabbit holes: science, humanity, power, scripture, and invention.</p>
      </div>

      <div className="homeStartGrid">
        {startCards.map(item => {
          const book = books.find(b => b.id === item.id);
          return (
            <article className={`bookCard homeStartCard homeStartCard-${item.id}`} key={item.id}>
              <Link href={`/reader?book=${item.id}`}>
                <CoverImage className="cover" src={coverFor(book, item.id)} fallbackSrc={legacyCoverFor(book, item.id)} alt={item.displayTitle} palette />
                <div className="bookInfo">
                  <h3 className="bookTitle">{item.displayTitle}</h3>
                  <p className="homeStartDescription">{item.why}</p>
                </div>
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
