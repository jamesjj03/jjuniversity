import type { Metadata } from "next";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import { readNarratorAdminSnapshot } from "@/lib/narratorAdmin";
import NarratorControlRoom from "./NarratorControlRoom";
import styles from "./NarratorControlRoom.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Narrator Control Room | JJU Workshop",
  robots: { index: false, follow: false, nocache: true },
};

export default async function NarratorControlRoomPage() {
  let snapshot;
  let failure = "";
  try {
    snapshot = await readNarratorAdminSnapshot();
  } catch (error) {
    failure = error instanceof Error ? error.message : "The narrator control room is unavailable.";
  }

  if (!snapshot) {
    return (
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Workshop · Narrator control room</p>
            <h1>Narrator data is locked.</h1>
            <p className={styles.intro}>The Workshop could not verify the complete control-room snapshot, so it is showing no accounts, profiles, assignments, or recordings.</p>
          </div>
          <GuardedAdminLink className={styles.backLink} href="/admin">Back to Workshop</GuardedAdminLink>
        </header>
        <section className={styles.errorPanel} role="alert">
          <strong>No partial data shown</strong>
          <p>{failure}</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workshop · Narrator control room</p>
          <h1>Set up the work. Keep release separate.</h1>
          <p className={styles.intro}>Activate an existing account, pin an audiobook plan to the exact Reader manuscript, listen to private submissions, and send track-level notes.</p>
        </div>
        <GuardedAdminLink className={styles.backLink} href="/admin">Back to Workshop</GuardedAdminLink>
      </header>
      <NarratorControlRoom snapshot={snapshot} />
    </main>
  );
}
