import "./globals.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource-variable/bitter/wght.css";
import "@fontsource-variable/lexend/wght.css";
import "@fontsource-variable/literata/wght.css";
import { Analytics } from "@vercel/analytics/next";
import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
import PreferencesProvider from "@/components/PreferencesProvider";
import AccountMenu from "@/components/AccountMenu";
import SiteSocialLink from "@/components/SiteSocialLink";
import ContinueReadingLink from "@/components/ContinueReadingLink";
import SiteFooter from "@/components/SiteFooter";
import type { Metadata } from "next";
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";
import { absoluteUrl, SITE_URL } from "@/lib/publishing";
import { PREFERENCES_PREPAINT_SCRIPT } from "@/lib/preferencesV2";

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
  icons: {
    icon: {
      url: "/branding/jju/app-icons/jju-app-icon-192.png",
      type: "image/png",
      sizes: "192x192",
    },
    shortcut: "/branding/jju/jju-favicon.ico",
    apple: {
      url: "/branding/jju/app-icons/jju-apple-touch-icon-180.png",
      type: "image/png",
      sizes: "180x180",
    },
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
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="jju-theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: PREFERENCES_PREPAINT_SCRIPT }}
        />
      </head>
      <body>
        <PreferencesProvider />
        <header className="siteHeader">
          <Link href="/" className="brand brandWithMark">
            <Image className="brandLogo" src="/branding/jju-logo.png" alt="JJ University" width={56} height={56} />
            <span className="brandText">JJ University</span>
          </Link>

          <ContinueReadingLink />
          <SiteSocialLink />
          <AccountMenu />
        </header>

        {children}
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
