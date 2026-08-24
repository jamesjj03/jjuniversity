import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AudioEditionPlayer from "@/components/audio/AudioEditionPlayer";
import audioStyles from "@/components/audio/AudioEditionPlayer.module.css";
import SiteV2Cover from "@/components/site-v2/SiteV2Cover";
import { getPublishedAudioEditionForBook } from "@/lib/audioCatalog";
import { coverFallbackSrc } from "@/lib/cover";
import { getBookBySlugLive } from "@/lib/publishing";
import { siteV2CoverSrc } from "@/lib/siteV2";
import { pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) return {};
  const edition = await getPublishedAudioEditionForBook(book.id);
  if (!edition) return {};
  return pageMetadata({
    title: `Listen to ${book.title}`,
    description: `Listen to ${book.title}, narrated by ${edition.narratorName}.`,
    path: `/listen/${book.slug}`,
    image: siteV2CoverSrc(book),
    imageAlt: `${book.title} cover`,
    noIndex: true,
  });
}
export default async function SiteV2ListenPage({ params }: Props) {
  const { slug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) notFound();

  const edition = await getPublishedAudioEditionForBook(book.id);
  if (!edition) notFound();
  const description = edition.description.trim();
  const narratorLine = `Narrated by ${edition.narratorName}`.trim().toLowerCase();
  const showDescription = description.replace(/[.!?]+$/, "").trim().toLowerCase() !== narratorLine;

  return (
    <article className={audioStyles.page}>
      <Link className={audioStyles.backLink} href={`/books/${book.slug}`}>← Back to {book.title}</Link>

      <section className={audioStyles.hero}>
        <div className={audioStyles.cover}>
          <SiteV2Cover
            src={siteV2CoverSrc(book)}
            fallbackSrc={coverFallbackSrc(book)}
            alt={`${book.title} cover`}
            priority
            sizes="(max-width: 760px) 76vw, 280px"
          />
        </div>

        <div className={audioStyles.copy}>
          <p className={audioStyles.eyebrow}>Audiobook</p>
          <h1>{book.title}</h1>
          <p className={audioStyles.narrator}>Narrated by {edition.narratorName}</p>
          {description && showDescription && <p className={audioStyles.description}>{description}</p>}
          <AudioEditionPlayer edition={edition} bookSlug={book.slug} />
        </div>
      </section>
    </article>
  );
}
