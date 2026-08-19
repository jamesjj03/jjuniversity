import type { Metadata } from "next";
import SiteV2ContactForm from "@/components/site-v2/SiteV2ContactForm";
import styles from "@/components/site-v2/SiteV2.module.css";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Contact",
    description: "Send JJ University questions, corrections, and book issues.",
    path: "/contact",
  }),
  robots: { index: false, follow: true },
};

export default function SiteV2ContactPage() {
  return (
    <article className={`${styles.aboutPage} siteV2ContactPage`}>
      <header className={styles.pageHeaderCentered}>
        <h1>Contact</h1>
        <p>Questions, errors, book issues, narrator stuff, weird ideas, or general Yo WTF messages go here.</p>
      </header>

      <div className={styles.aboutSections}>
        <section>
          <h2>Send a message</h2>
          <SiteV2ContactForm />
        </section>

        <section>
          <h2>Helpful details</h2>
          <p>If something is broken, include the book title, page or link, and the device or browser you were using.</p>
          <p>Be specific. “This line is wrong because...” is way more useful than “this book is cooked.”</p>
        </section>
      </div>
    </article>
  );
}
