import "./globals.css";
import "./late-fixes.css";
import Link from "next/link";
import Script from "next/script";
import PreferencesProvider from "@/components/PreferencesProvider";
import AccountMenu from "@/components/AccountMenu";
import SiteSocialLink from "@/components/SiteSocialLink";
import ContinueReadingLink from "@/components/ContinueReadingLink";
import SiteFooter from "@/components/SiteFooter";
import type { Metadata } from "next";
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";
import { absoluteUrl, SITE_URL } from "@/lib/publishing";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "James Johnson" }],
  creator: "James Johnson",
  publisher: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/branding/jju-logo.png",
    shortcut: "/branding/jju-logo.png",
    apple: "/branding/jju-logo.png",
  },
  openGraph: {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    url: absoluteUrl("/"),
    siteName: SITE_NAME,
    type: "website",
    images: [{ url: absoluteUrl(DEFAULT_OG_IMAGE), alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: [absoluteUrl(DEFAULT_OG_IMAGE)],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeScript = `
    try {
      var prefs = JSON.parse(localStorage.getItem("jju.preferences") || "{}");
      var theme = prefs.siteTheme || "dark";
      if (theme === "light" || theme === "sepia") theme = "manuscript";
      if (theme === "forest") theme = "carbon";
      document.documentElement.dataset.siteTheme = theme;
      document.documentElement.dataset.siteScheme = theme === "manuscript" ? "light" : "dark";
      document.documentElement.dataset.siteAccent = prefs.siteAccent || "gold";
      document.documentElement.dataset.siteIntensity = prefs.siteIntensity || "standard";
      document.documentElement.dataset.siteBackground = prefs.siteBackground || "grid";
    } catch {}
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="jju-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <PreferencesProvider />
        <header className="siteHeader">
          <Link href="/" className="brand brandWithMark">
            <img className="brandLogo" src="/branding/jju-logo.png" alt="JJ University" />
            <span className="brandText">JJ University</span>
          </Link>

          <ContinueReadingLink />
          <SiteSocialLink />
          <AccountMenu />
        </header>

        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
