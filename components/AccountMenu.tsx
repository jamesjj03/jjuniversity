"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const ACCOUNT_KEY = "jju.account";
const STORAGE_KEY = "jju.preferences";

type Account = {
  name?: string;
};

type Preferences = {
  siteTheme: "dark" | "warm" | "crimson" | "manuscript" | "navy" | "forest" | "carbon" | "royal" | "terminal" | "aurora";
  siteAccent: "gold" | "blue" | "green" | "crimson" | "copper" | "violet";
  siteIntensity: "subtle" | "standard" | "loud";
  siteBackground: "grid" | "blueprint" | "paper" | "circuit" | "clean";
  readerTheme: "dark" | "paper" | "light" | "night" | "sepia";
  readerSize: "small" | "medium" | "large" | "xlarge";
  readerFont: "dyslexic" | "serif" | "book" | "journal" | "classic";
};

const DEFAULTS: Preferences = {
  siteTheme: "dark",
  siteAccent: "gold",
  siteIntensity: "standard",
  siteBackground: "grid",
  readerTheme: "paper",
  readerSize: "large",
  readerFont: "book",
};

const DEFAULT_THEME_ACCENTS: Record<Preferences["siteTheme"], Preferences["siteAccent"]> = {
  dark: "gold",
  warm: "gold",
  crimson: "crimson",
  manuscript: "gold",
  navy: "blue",
  forest: "green",
  carbon: "blue",
  royal: "violet",
  terminal: "green",
  aurora: "blue",
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    if (saved.siteTheme === "light") saved.siteTheme = "manuscript";
    if (saved.siteTheme === "sepia") saved.siteTheme = "manuscript";
    if (saved.siteTheme === "forest") saved.siteTheme = "carbon";
    if (saved.readerFont === "sans" || saved.readerFont === "mono") saved.readerFont = "dyslexic";
    return { ...fallback, ...saved };
  } catch {
    return fallback;
  }
}

function readAccount() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null") as Account | null;
  } catch {
    return null;
  }
}

export default function AccountMenu() {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const pathname = usePathname();
  const [account, setAccount] = useState<Account | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [atlasVisible, setAtlasVisible] = useState(false);
  const [fiberVisible, setFiberVisible] = useState(false);

  const siteThemes = useMemo(() => [
    { value: "dark", label: "Classic" },
    { value: "carbon", label: "Slate" },
    { value: "navy", label: "Navy" },
    { value: "royal", label: "Royal" },
    { value: "terminal", label: "Terminal" },
    { value: "crimson", label: "Crimson" },
    { value: "warm", label: "Ember" },
    { value: "aurora", label: "Frost" },
    { value: "manuscript", label: "Paper" },
  ] as const, []);
  const siteAccents = useMemo(() => [
    { value: "gold", label: "Gold" },
    { value: "blue", label: "Blue" },
    { value: "green", label: "Green" },
    { value: "crimson", label: "Red" },
    { value: "copper", label: "Pink" },
    { value: "violet", label: "Purple" },
  ] as const, []);
  const navItems = useMemo(() => [
    { href: "/", label: "Home" },
    { href: "/library", label: "Library" },
    ...(atlasVisible ? [{ href: "/atlas", label: "Atlas" }] : []),
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
    { href: "/account", label: "Account" },
    ...(fiberVisible ? [{ href: "/fiber", label: "Fiber" }] : []),
  ], [atlasVisible, fiberVisible]);

  useEffect(() => {
    fetch("/site.json", { cache: "no-store" })
      .then(response => response.json())
      .then(data => {
        setAtlasVisible(Boolean(data?.atlas?.visible));
      })
      .catch(() => {
        setAtlasVisible(false);
      });

    const refresh = () => {
      setAccount(readAccount());
      setPreferences(readJson(STORAGE_KEY, DEFAULTS));
    };
    const refreshFiber = () => {
      try {
        setFiberVisible(window.localStorage.getItem("jjuFiberVisited") === "true");
      } catch {
        setFiberVisible(false);
      }
    };
    const closeOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };

    refresh();
    refreshFiber();
    window.addEventListener("jju-account", refresh);
    window.addEventListener("jju-preferences", refresh);
    window.addEventListener("jju-fiber-visited", refreshFiber);
    window.addEventListener("storage", refresh);
    document.addEventListener("click", closeOutside);
    return () => {
      window.removeEventListener("jju-account", refresh);
      window.removeEventListener("jju-preferences", refresh);
      window.removeEventListener("jju-fiber-visited", refreshFiber);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("click", closeOutside);
    };
  }, []);

  function patch(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("jju-preferences"));
  }

  function closeMenu() {
    if (ref.current) ref.current.open = false;
  }

  return (
    <details className="accountMenu" ref={ref}>
      <summary aria-label="Open account and reader menu">
        <span className="menuBars" aria-hidden="true"><i /><i /><i /></span>
      </summary>
      <div className="accountMenuPanel" aria-label="Account, reader, and theme controls">
        <div className="accountMenuTop">
          <Link className="menuSettingsButton" href="/settings" onClick={closeMenu} aria-label="Settings" title="Settings">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.25" /><path d="M19.4 15a8.1 8.1 0 0 0 .06-5.9l2.04-1.6-2-3.46-2.55 1a8.2 8.2 0 0 0-2.55-1.48L14 1h-4l-.4 2.56a8.2 8.2 0 0 0-2.55 1.48l-2.55-1-2 3.46 2.04 1.6a8.1 8.1 0 0 0 .06 5.9L2.5 16.5l2 3.46 2.55-1a8.2 8.2 0 0 0 2.55 1.48L10 23h4l.4-2.56a8.2 8.2 0 0 0 2.55-1.48l2.55 1 2-3.46L19.4 15Z" /></svg>
          </Link>
          {account?.name ? <span>{account.name}</span> : <span className="accountMenuSpacer" aria-hidden="true" />}
          <button type="button" onClick={closeMenu}>Close</button>
        </div>

        <section className="accountNavSection" aria-label="Site navigation">
          <strong>Navigate</strong>
          <div className="accountNavGrid">
            {navItems.map(item => (
              <Link
                className={pathname === item.href ? "active" : ""}
                href={item.href}
                key={item.href}
                onClick={closeMenu}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>

        <section>
          <strong>Theme</strong>
          <div className="menuThemeGrid">
            {siteThemes.map(option => (
              <button
                className={preferences.siteTheme === option.value ? "active" : ""}
                data-theme-choice={option.value}
                key={option.value}
                type="button"
                onClick={() => patch({ siteTheme: option.value, siteAccent: DEFAULT_THEME_ACCENTS[option.value] })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <strong>Accent</strong>
          <div className="menuThemeGrid menuAccentGrid">
            {siteAccents.map(option => (
              <button
                className={preferences.siteAccent === option.value ? "active" : ""}
                data-accent-choice={option.value}
                key={option.value}
                type="button"
                onClick={() => patch({ siteAccent: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}
