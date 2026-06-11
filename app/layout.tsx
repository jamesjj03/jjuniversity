import "./globals.css";
import Link from "next/link";
import PreferencesProvider from "@/components/PreferencesProvider";
import AccountMenu from "@/components/AccountMenu";
import SiteSocialLink from "@/components/SiteSocialLink";
import ContinueReadingLink from "@/components/ContinueReadingLink";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "JJ University",
  description: "A free digital library by James Johnson.",
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
    <html lang="en">
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
