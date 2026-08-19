"use client";

import { useState, type FormEvent } from "react";
import styles from "./SiteV2.module.css";

type SubmitState = "idle" | "sending" | "sent" | "error";

export default function SiteV2ContactForm() {
  const [submitState, setSubmitState] = useState<SubmitState>("idle");

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitState("sending");

    try {
      const response = await fetch("https://formsubmit.co/ajax/jamesjj0381@gmail.com", {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Message failed");
      form.reset();
      setSubmitState("sent");
    } catch {
      setSubmitState("error");
    }
  }

  return (
    <form className={styles.contactForm} onSubmit={submitMessage}>
      <input type="hidden" name="_subject" value="New JJ University contact message" />
      <input type="hidden" name="_captcha" value="false" />
      <label>
        <span>Name</span>
        <input type="text" name="name" autoComplete="name" placeholder="Your name" required />
      </label>
      <label>
        <span>Email</span>
        <input type="email" name="email" autoComplete="email" placeholder="your@email.com" required />
      </label>
      <label>
        <span>Subject</span>
        <select name="subject" defaultValue="General message" required>
          <option>General message</option>
          <option>Book issue</option>
          <option>Correction</option>
          <option>Audiobook question</option>
          <option>Other</option>
        </select>
      </label>
      <label>
        <span>Message</span>
        <textarea name="message" rows={7} placeholder="What&apos;s up?" required />
      </label>
      <div className={styles.contactSubmitRow}>
        <button className={styles.primaryButton} type="submit" disabled={submitState === "sending"}>
          {submitState === "sending" ? "Sending..." : "Send message"}
        </button>
        <p className={styles.contactStatus} aria-live="polite">
          {submitState === "sent" && "Message sent. Thanks for letting me know."}
          {submitState === "error" && "That didn't go through. Please try again."}
        </p>
      </div>
    </form>
  );
}
