import Link from "next/link";
import LibraryPreview from "@/components/LibraryPreview";
import AtlasHomeLink from "@/components/AtlasHomeLink";
import { jsonLd, organizationJsonLd, websiteJsonLd } from "@/lib/seo";

export default function HomePage() {
  const jsonLdItems = [organizationJsonLd(), websiteJsonLd()];

  return (
    <main className="page homePage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }}
      />

      <section className="hero">
        <div className="heroArchiveStamp" aria-hidden="true">
          <span>Field Library</span>
          <strong>4,800+ pages</strong>
        </div>
        <p className="kicker">JJ University</p>
        <h1>JJ University</h1>

        <div className="heroCopy">
          <p>I spent the last year trying to figure out how everything works.</p>
          <p className="gold">This is the result.</p>
          <p>Hundreds of short books on science, history, religion, psychology, power, money, and everything in between.</p>
          <p>All free.</p>
        </div>

        <div className="heroLedger" aria-label="JJ University catalog status">
          <span>Library</span>
          <span>Reader</span>
          <span>Atlas</span>
          <span>Arena</span>
          <span>Print bench</span>
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
