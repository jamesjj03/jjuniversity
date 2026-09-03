import type { Metadata } from "next";
import Link from "next/link";
import { narratorAccessRequestsEnabled } from "@/lib/narratorAccessRequests";
import NarratorAccessRequestForm from "./NarratorAccessRequestForm";
import styles from "./NarratorAccessRequest.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Narrator access",
  description: "Request access to the private JJ University narrator portal.",
  robots: { index: false, follow: false, nocache: true },
};

export default function NarratorAccessRequestPage() {
  const requestsOpen = narratorAccessRequestsEnabled();

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="request-title">
        <h1 id="request-title">Narrator access</h1>
        <p className={styles.intro}>Enter your name and email. James will review your request and send you a sign-in link if it&apos;s approved.</p>
        <NarratorAccessRequestForm requestsOpen={requestsOpen} />
        <p className={styles.signInNote}>Already approved? <Link href="/account?next=/narrator/welcome">Sign in</Link></p>
      </section>
    </main>
  );
}
