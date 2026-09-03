"use client";

import { useState } from "react";
import styles from "./NarratorAccessRequest.module.css";

type Notice = { tone: "success" | "error"; message: string } | null;

export default function NarratorAccessRequestForm({ requestsOpen }: { requestsOpen: boolean }) {
  const [displayName, setDisplayName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/narrator/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, contactEmail, note, website }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Your request could not be saved yet.");
      setDisplayName("");
      setContactEmail("");
      setNote("");
      setNotice({
        tone: "success",
        message: "Your request was received. If it is approved, a sign-in link will be sent to this email.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Your request could not be saved yet.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.formArea}>
      <form aria-labelledby="request-title" className={styles.form} onSubmit={submit}>
        <label>
          <span>Name</span>
          <input
            autoComplete="name"
            disabled={!requestsOpen || busy}
            maxLength={80}
            onChange={event => setDisplayName(event.target.value)}
            placeholder="Your name"
            required
            value={displayName}
          />
        </label>
        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            disabled={!requestsOpen || busy}
            inputMode="email"
            maxLength={254}
            onChange={event => setContactEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={contactEmail}
          />
        </label>
        <label>
          <span>Note <small>(optional)</small></span>
          <textarea
            disabled={!requestsOpen || busy}
            maxLength={600}
            onChange={event => setNote(event.target.value)}
            placeholder="Book or project you worked on"
            value={note}
          />
        </label>
        <label className={styles.honeypot} aria-hidden="true">
          <span>Website</span>
          <input autoComplete="off" tabIndex={-1} value={website} onChange={event => setWebsite(event.target.value)} />
        </label>
        <button disabled={!requestsOpen || busy || !displayName.trim() || !contactEmail.trim()} type="submit">
          {busy ? "Sending…" : "Request access"}
        </button>
      </form>

      {!requestsOpen ? <p className={styles.closedNotice}>Access requests are closed right now.</p> : null}
      {notice ? <p className={notice.tone === "success" ? styles.successNotice : styles.errorNotice} role="status">{notice.message}</p> : null}
    </div>
  );
}
