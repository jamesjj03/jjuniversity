import Link from "next/link";
import LibraryPreview from "@/components/LibraryPreview";
import AtlasHomeLink from "@/components/AtlasHomeLink";

export default function HomePage() {
  return (
    <main className="page homePage">
      <section className="hero">
        <p className="kicker">JJ University</p>
        <h1>JJ University</h1>

        <div className="heroCopy">
          <p>I spent the last year trying to figure out how everything works.</p>
          <p className="gold">This is the result.</p>
          <p>Hundreds of short books on science, history, religion, psychology, power, money, and everything in between.</p>
          <p>All free.</p>
        </div>

        <div className="buttonRow">
          <Link className="btn primary" href="/library">Browse the Library</Link>
          <AtlasHomeLink />
          <Link className="btn secondary" href="/what-this-is">What This Is</Link>
        </div>

        <LibraryPreview />
      </section>
    </main>
  );
}
