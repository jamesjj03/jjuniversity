"use client";

import { useEffect } from "react";

const STORAGE_KEY = "jju.preferences";

type Preferences = {
  siteTheme?: "dark" | "warm" | "crimson" | "manuscript" | "navy" | "forest" | "carbon" | "royal" | "terminal" | "aurora";
  siteAccent?: "gold" | "blue" | "green" | "crimson" | "copper" | "violet";
  siteIntensity?: "subtle" | "standard" | "loud";
  siteBackground?: "grid" | "blueprint" | "paper" | "circuit" | "clean";
  readerTheme?: "dark" | "paper" | "light" | "night" | "sepia";
  readerSize?: "small" | "medium" | "large" | "xlarge";
  readerWidth?: "narrow" | "focused" | "wide" | "full";
  readerFont?: "dyslexic" | "serif" | "book" | "journal" | "classic";
  readerSpacing?: "tight" | "normal" | "loose";
};

function readPreferences(): Preferences {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function applyPreferences() {
  const preferences = readPreferences();
  const siteTheme = (preferences.siteTheme as string) === "light"
    ? "manuscript"
    : (preferences.siteTheme as string) === "forest"
      ? "carbon"
      : (preferences.siteTheme as string) === "sepia"
        ? "manuscript"
      : preferences.siteTheme || "dark";
  const siteScheme = siteTheme === "manuscript" ? "light" : "dark";
  delete document.documentElement.dataset.siteMode;
  document.documentElement.dataset.siteScheme = siteScheme;
  document.documentElement.dataset.siteTheme = siteTheme;
  document.documentElement.dataset.siteAccent = preferences.siteAccent || "gold";
  document.documentElement.dataset.siteIntensity = preferences.siteIntensity || "standard";
  document.documentElement.dataset.siteBackground = preferences.siteBackground || "grid";
}

export default function PreferencesProvider() {
  useEffect(() => {
    applyPreferences();
    window.addEventListener("jju-preferences", applyPreferences);
    window.addEventListener("storage", applyPreferences);

    return () => {
      window.removeEventListener("jju-preferences", applyPreferences);
      window.removeEventListener("storage", applyPreferences);
    };
  }, []);

  return null;
}
