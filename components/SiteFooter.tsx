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
        <Link href="/library">Library</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/account">Account</Link>
        {instagramUrl && <a href={instagramUrl} target="_blank" rel="noreferrer">Instagram</a>}
      </nav>
    </footer>
  );
}
