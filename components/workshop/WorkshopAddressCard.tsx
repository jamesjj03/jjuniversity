"use client";

import { useState } from "react";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import styles from "./WorkshopHome.module.css";

const WORKSHOP_URL = "https://www.jjuniversity.com/admin";

const PERMANENT_DOORS = [
  { href: "/admin/print", label: "Print Design Lab", path: "/admin/print" },
  { href: "/admin/audio", label: "Audio QA", path: "/admin/audio" },
  { href: "/admin/narrators", label: "Narrator Room", path: "/admin/narrators" },
] as const;

export default function WorkshopAddressCard() {
  const [notice, setNotice] = useState("");

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(WORKSHOP_URL);
      setNotice("Workshop address copied.");
    } catch {
      setNotice("Press and hold the address to copy it.");
    }
  }

  async function shareAddress() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "JJU Workshop",
          text: "The permanent door to JJ University publishing tools.",
          url: WORKSHOP_URL,
        });
        setNotice("Workshop address shared.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyAddress();
  }

  return (
    <section className={styles.addressCard} aria-labelledby="workshop-address-heading">
      <div className={styles.addressCopy}>
        <span className={styles.eyebrow}>The one address to remember</span>
        <h2 id="workshop-address-heading">jjuniversity.com/admin</h2>
        <p>Save this door. Every permanent Workshop tool lives underneath it.</p>
      </div>
      <div className={styles.addressActions}>
        <button type="button" onClick={copyAddress}>Copy address</button>
        <button type="button" onClick={shareAddress}>Share or save</button>
      </div>
      <nav className={styles.permanentDoors} aria-label="Permanent Workshop doors">
        {PERMANENT_DOORS.map(door => (
          <GuardedAdminLink href={door.href} key={door.href}>
            <span>{door.label}</span>
            <code>{door.path}</code>
          </GuardedAdminLink>
        ))}
      </nav>
      <p className={styles.addressNotice} aria-live="polite">{notice}</p>
    </section>
  );
}
