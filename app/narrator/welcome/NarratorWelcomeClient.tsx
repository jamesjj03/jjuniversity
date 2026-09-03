"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import styles from "./NarratorWelcome.module.css";

export default function NarratorWelcomeClient({ displayName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Use at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setMessage("Those passwords do not match.");
      return;
    }

    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message || "Your password could not be saved. Try again.");
      setBusy(false);
      return;
    }
    router.replace("/narrator");
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Private narrator desk</p>
        <h1>Welcome, {displayName}.</h1>
        <p className={styles.intro}>Choose your password, then you’ll land in the workspace James prepared for you.</p>
        {email ? <p className={styles.email}>{email}</p> : null}
        <form className={styles.form} onSubmit={finish}>
          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
          </label>
          <label>
            <span>Type it again</span>
            <input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={8} autoComplete="new-password" required />
          </label>
          <button type="submit" disabled={busy}>{busy ? "Opening your desk…" : "Set password and open desk"}</button>
        </form>
        {message ? <p className={styles.message} role="alert">{message}</p> : null}
        <p className={styles.privacy}>Your recordings stay private. Nothing is published from the narrator desk.</p>
      </section>
    </main>
  );
}
