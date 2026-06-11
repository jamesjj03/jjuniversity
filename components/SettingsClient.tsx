"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "jju.preferences";
const PROGRESS_KEY = "jju.readerProgress";
const READ_KEY = "jju.readBooks";

type Preferences = {
  siteTheme: "dark" | "warm" | "crimson" | "manuscript" | "navy" | "forest" | "carbon" | "royal" | "terminal" | "aurora";
  siteAccent: "gold" | "blue" | "green" | "crimson" | "copper" | "violet";
  siteIntensity: "subtle" | "standard" | "loud";
  siteBackground: "grid" | "blueprint" | "paper" | "circuit" | "clean";
  readerTheme: "dark" | "paper" | "light" | "night" | "sepia";
  readerSize: "small" | "medium" | "large" | "xlarge";
  readerWidth: "narrow" | "focused" | "wide" | "full";
  readerFont: "dyslexic" | "serif" | "book" | "journal" | "classic";
  readerSpacing: "tight" | "normal" | "loose";
  saveProgress: boolean;
};

const DEFAULTS: Preferences = {
  siteTheme: "dark",
  siteAccent: "gold",
  siteIntensity: "standard",
  siteBackground: "grid",
  readerTheme: "paper",
  readerSize: "large",
  readerWidth: "full",
  readerFont: "book",
  readerSpacing: "normal",
  saveProgress: true,
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

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved.siteTheme === "light") saved.siteTheme = "manuscript";
    if (saved.siteTheme === "sepia") saved.siteTheme = "manuscript";
    if (saved.siteTheme === "forest") saved.siteTheme = "carbon";
    if (saved.readerFont === "sans" || saved.readerFont === "mono") saved.readerFont = "dyslexic";
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

function savePreferences(preferences: Preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new Event("jju-preferences"));
}

export default function SettingsClient() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [readCount, setReadCount] = useState(0);
  const [progressCount, setProgressCount] = useState(0);

  useEffect(() => {
    setPreferences(readPreferences());

    try {
      setReadCount(JSON.parse(localStorage.getItem(READ_KEY) || "[]").length);
      setProgressCount(Object.keys(JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}")).length);
    } catch {
      setReadCount(0);
      setProgressCount(0);
    }
  }, []);

  const themeOptions = useMemo(() => [
    { value: "dark", label: "Classic" },
    { value: "carbon", label: "Slate" },
    { value: "navy", label: "Navy" },
    { value: "royal", label: "Royal" },
    { value: "terminal", label: "Terminal" },
    { value: "crimson", label: "Crimson" },
    { value: "warm", label: "Ember" },
    { value: "aurora", label: "Frost" },
    { value: "manuscript", label: "Paper" },
  ], []);
  const accentOptions = useMemo(() => [
    { value: "gold", label: "Gold" },
    { value: "blue", label: "Blue" },
    { value: "green", label: "Green" },
    { value: "crimson", label: "Red" },
    { value: "copper", label: "Pink" },
    { value: "violet", label: "Purple" },
  ], []);
  const intensityOptions = useMemo(() => [
    { value: "subtle", label: "Subtle" },
    { value: "standard", label: "Standard" },
    { value: "loud", label: "Loud" },
  ], []);
  const backgroundOptions = useMemo(() => [
    { value: "grid", label: "Grid" },
    { value: "blueprint", label: "Blueprint" },
    { value: "paper", label: "Paper" },
    { value: "circuit", label: "Circuit" },
    { value: "clean", label: "Clean" },
  ], []);

  function patch(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    savePreferences(next);
  }

  function clearReadingData() {
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(READ_KEY);
    setReadCount(0);
    setProgressCount(0);
  }

  return (
    <main className="page settingsPage">
      <section className="settingsHero">
        <h1>Settings</h1>
      </section>

      <section className="settingsGrid">
        <div className="settingsPanel">
          <h2>Site</h2>
          <label>
            <span>Theme</span>
          </label>
          <div className="segmentedControl" aria-label="Site theme">
            {themeOptions.map(option => (
              <button
                className={preferences.siteTheme === option.value ? "active" : ""}
                data-theme-choice={option.value}
                key={option.value}
                onClick={() => {
                  const siteTheme = option.value as Preferences["siteTheme"];
                  patch({ siteTheme, siteAccent: DEFAULT_THEME_ACCENTS[siteTheme] });
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label>
            <span>Accent</span>
          </label>
          <div className="segmentedControl colorControl" aria-label="Site accent">
            {accentOptions.map(option => (
              <button
                className={preferences.siteAccent === option.value ? "active" : ""}
                data-accent-choice={option.value}
                key={option.value}
                onClick={() => patch({ siteAccent: option.value as Preferences["siteAccent"] })}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label>
            <span>Intensity</span>
            <select className="select" value={preferences.siteIntensity} onChange={event => patch({ siteIntensity: event.target.value as Preferences["siteIntensity"] })}>
              {intensityOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label>
            <span>Background</span>
            <select className="select" value={preferences.siteBackground} onChange={event => patch({ siteBackground: event.target.value as Preferences["siteBackground"] })}>
              {backgroundOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="settingsPanel">
          <h2>Reader</h2>
          <label>
            <span>Theme</span>
            <select className="select" value={preferences.readerTheme} onChange={event => patch({ readerTheme: event.target.value as Preferences["readerTheme"] })}>
              <option value="paper">Paper</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="night">Night</option>
              <option value="sepia">Sepia</option>
            </select>
          </label>

          <label>
            <span>Font</span>
            <select className="select" value={preferences.readerFont} onChange={event => patch({ readerFont: event.target.value as Preferences["readerFont"] })}>
              <option value="book">Book</option>
              <option value="serif">Serif</option>
              <option value="classic">Classic</option>
              <option value="journal">Journal</option>
              <option value="dyslexic">Readable</option>
            </select>
          </label>

          <label>
            <span>Text size</span>
            <select className="select" value={preferences.readerSize} onChange={event => patch({ readerSize: event.target.value as Preferences["readerSize"] })}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="xlarge">Extra Large</option>
            </select>
          </label>

          <label>
            <span>Line spacing</span>
            <select className="select" value={preferences.readerSpacing} onChange={event => patch({ readerSpacing: event.target.value as Preferences["readerSpacing"] })}>
              <option value="tight">Tight</option>
              <option value="normal">Normal</option>
              <option value="loose">Loose</option>
            </select>
          </label>

          <label>
            <span>Page width</span>
            <select className="select" value={preferences.readerWidth} onChange={event => patch({ readerWidth: event.target.value as Preferences["readerWidth"] })}>
              <option value="narrow">Narrow</option>
              <option value="focused">Focused</option>
              <option value="wide">Wide</option>
              <option value="full">Full</option>
            </select>
          </label>

          <label className="toggleLine">
            <input type="checkbox" checked={preferences.saveProgress} onChange={event => patch({ saveProgress: event.target.checked })} />
            Save reading progress on this device
          </label>
        </div>

        <div className="settingsPanel">
          <h2>Reading Data</h2>
          <div className="settingsStats">
            <div><strong>{progressCount}</strong><span>saved books</span></div>
            <div><strong>{readCount}</strong><span>read books</span></div>
          </div>
          <button className="resetBtn" onClick={clearReadingData}>Clear Reading Data</button>
        </div>
      </section>
    </main>
  );
}
