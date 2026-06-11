import siteConfig from "@/public/site.json";

export default function SiteSocialLink() {
  const instagramUrl = typeof siteConfig.social?.instagramUrl === "string" ? siteConfig.social.instagramUrl : "";

  if (!instagramUrl) return null;

  return (
    <a className="siteSocialLink" href={instagramUrl} target="_blank" rel="noreferrer" aria-label="Instagram">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.4" cy="6.6" r="1" />
      </svg>
    </a>
  );
}
