"use client";

import { useSyncExternalStore } from "react";
import { SITE_V2_SAVED_KEY } from "@/lib/siteV2";

const EMPTY_SAVED_IDS = new Set<string>();
const subscribers = new Set<() => void>();

let listening = false;
let cachedRaw: string | null | undefined;
let cachedSavedIds = EMPTY_SAVED_IDS;

function readSavedIds() {
  if (typeof window === "undefined") return EMPTY_SAVED_IDS;

  try {
    const raw = window.localStorage.getItem(SITE_V2_SAVED_KEY);
    if (raw === cachedRaw) return cachedSavedIds;

    cachedRaw = raw;
    const value = JSON.parse(raw || "[]") as unknown;
    cachedSavedIds = new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    cachedRaw = undefined;
    cachedSavedIds = EMPTY_SAVED_IDS;
  }
  return cachedSavedIds;
}

function notifySubscribers() {
  cachedRaw = undefined;
  subscribers.forEach(notify => notify());
}

function startListening() {
  if (listening) return;
  window.addEventListener("storage", notifySubscribers);
  window.addEventListener("jju-saved-books", notifySubscribers);
  listening = true;
}

function stopListening() {
  if (!listening) return;
  window.removeEventListener("storage", notifySubscribers);
  window.removeEventListener("jju-saved-books", notifySubscribers);
  listening = false;
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  startListening();

  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) stopListening();
  };
}

export function useSiteV2SavedBookIds() {
  return useSyncExternalStore(subscribe, readSavedIds, () => EMPTY_SAVED_IDS);
}

export function toggleSiteV2SavedBook(bookId: string) {
  const next = new Set(readSavedIds());
  if (next.has(bookId)) next.delete(bookId);
  else next.add(bookId);

  try {
    window.localStorage.setItem(SITE_V2_SAVED_KEY, JSON.stringify([...next]));
    window.dispatchEvent(new Event("jju-saved-books"));
  } catch {
    // Reading remains available when storage is disabled or full.
  }
}
