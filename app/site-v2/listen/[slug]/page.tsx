import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AudioEditionPlayer from "@/components/audio/AudioEditionPlayer";
import audioStyles from "@/components/audio/AudioEditionPlayer.module.css";
import SiteV2Cover from "@/components/site-v2/SiteV2Cover";
import {
  applyAudioCandidatePreview,
  getAudioCandidatePreviewKey,
  getPublishedAudioEditionForBook,
} from "@/lib/audioCatalog";
import { coverFallbackSrc } from "@/lib/cover";
import { getBookBySlugLive } from "@/lib/publishing";
import { siteV2CoverSrc } from "@/lib/siteV2";
import { pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ slug: string }>;
};

function formatEditionLength(seconds: number) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${totalMinutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

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
  const candidatePreviewKey = getAudioCandidatePreviewKey(book.id, edition.id);
  const playerEdition = applyAudioCandidatePreview(edition, candidatePreviewKey);
  const description = edition.description.trim();
  const narratorLine = `Narrated by ${edition.narratorName}`.trim().toLowerCase();
  const showDescription = description.replace(/[.!?]+$/, "").trim().toLowerCase() !== narratorLine;
  const totalDuration = edition.tracks.reduce((sum, track) => sum + Math.max(0, track.durationSeconds), 0);

  return (
    <article className={audioStyles.page}>
      <Link className={audioStyles.backLink} href={`/books/${book.slug}`}>← Back to {book.title}</Link>

      <div className={audioStyles.listenStage}>
        <section className={audioStyles.hero} aria-labelledby="audiobook-title">
          <div className={audioStyles.artworkColumn}>
            <div className={audioStyles.cover}>
              <SiteV2Cover
                src={siteV2CoverSrc(book)}
                fallbackSrc={coverFallbackSrc(book)}
                alt={`${book.title} cover`}
                priority
                sizes="(max-width: 680px) 58vw, 250px"
              />
            </div>
          </div>

          <div className={audioStyles.copy}>
            <p className={audioStyles.eyebrow}>Audiobook</p>
            <h1 id="audiobook-title">{book.title}</h1>
            <p className={audioStyles.narrator}><span>Read by</span>{edition.narratorName}</p>
            {description && showDescription && <p className={audioStyles.description}>{description}</p>}
            <div className={audioStyles.editionFacts} aria-label="Audiobook details">
              <span>{edition.tracks.length} chapter{edition.tracks.length === 1 ? "" : "s"}</span>
              <span>{formatEditionLength(totalDuration)}</span>
            </div>
          </div>
        </section>
        <AudioEditionPlayer
          edition={playerEdition}
          bookSlug={book.slug}
          candidatePreviewKey={candidatePreviewKey}
        />
      </div>
    </article>
  );
}
