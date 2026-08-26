import Link from "next/link";
import siteConfig from "@/public/site.json";

export default function SiteFooter() {
  const instagramUrl = typeof siteConfig.social?.instagramUrl === "string" ? siteConfig.social.instagramUrl : "";

  return (
    <footer className="siteFooter">
      <div>
        <strong>JJ University</strong>
      </div>
      <nav aria-label="Footer navigation">
        <Link href="/books">Books</Link>
        <Link href="/books/index">Book index</Link>
        <Link href="/print">Print</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        {instagramUrl && <a href={instagramUrl} target="_blank" rel="noreferrer">Instagram</a>}
      </nav>
    </footer>
  );
}
