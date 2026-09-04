import Link from "next/link";
import type { ReactNode } from "react";
import SiteV2ContinueLink from "./SiteV2ContinueLink";
import SiteV2Disclosure from "./SiteV2Disclosure";
import SiteV2Logo from "./SiteV2Logo";
import styles from "./SiteV2.module.css";

type SiteV2ShellProps = {
  children: ReactNode;
  immersive?: boolean;
};

export default function SiteV2Shell({ children, immersive = false }: SiteV2ShellProps) {
  return (
    <div className={`${styles.siteV2Route} ${immersive ? styles.immersiveRoute : ""} jjuSiteV2Route`}>
      <a className={styles.skipLink} href="#site-v2-main">Skip to content</a>

      <header className={styles.siteHeader}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="JJ University home">
            <SiteV2Logo />
            <span className={styles.brandWords}>
              <strong>JJ University</strong>
              <span>Free books by James Johnson</span>
            </span>
          </Link>

          <nav className={styles.desktopNav} aria-label="Main navigation">
            <Link href="/books">Books</Link>
            <Link href="/atlas">Atlas</Link>
            <Link href="/print">Print</Link>
            <Link href="/saved">Saved</Link>
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/settings">Settings</Link>
          </nav>

          <div className={styles.headerActions}>
            <SiteV2ContinueLink compact />
            <Link className={styles.accountLink} href="/account">Account</Link>
          </div>

          <SiteV2Disclosure className={styles.mobileMenu} label="Menu" labelAria="Open navigation">
            <nav aria-label="Mobile navigation">
              <Link href="/books">Books</Link>
              <Link href="/atlas">Atlas</Link>
              <Link href="/print">Print</Link>
              <Link href="/saved">Saved</Link>
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/account">Account</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </SiteV2Disclosure>
        </div>
      </header>

      <main
        id="site-v2-main"
        className={`${styles.siteMain} ${immersive ? styles.immersiveMain : ""}`}
      >
        {children}
      </main>

      {!immersive && (
        <footer className={styles.siteFooter}>
          <div>
            <Link className={styles.footerBrand} href="/">
              <SiteV2Logo />
              <span>
                <strong>JJ University</strong>
                <small>An independent educational project</small>
              </span>
            </Link>
            <nav aria-label="Footer navigation">
              <Link href="/books">Books</Link>
              <Link href="/books/index">Book index</Link>
              <Link href="/print">Print</Link>
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </div>
        </footer>
      )}
    </div>
  );
}
