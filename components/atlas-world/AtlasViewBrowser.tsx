"use client";

import { useRef, useSyncExternalStore } from "react";
import { ATLAS_VIEW_PRESETS } from "@/lib/atlas-world/layers";
import styles from "./AtlasViewBrowser.module.css";

const views = [
  { id: "political", group: "Places", text: "Countries, territories and borders", icon: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5zm6-2v16m6-14v16" },
  { id: "where-people-live", group: "People", text: "Settlement, cities and the land around them", icon: "M2 19l5-7 4 4 4-11 7 14M2 22h20M6 7h.01M10 4h.01M20 9h.01" },
  { id: "religion", group: "People", text: "Religious traditions and their composition", icon: "M12 2v5m-3-2h6M3 22V12l9-5 9 5v10M8 22v-7h8v7M3 22h18" },
  { id: "government", group: "Institutions", text: "How national governments are organized", icon: "M2 8l10-6 10 6H2zm3 3v8m7-8v8m7-8v8M2 22h20" },
  { id: "population", group: "People", text: "The number of people in each country", icon: "M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7 0a3 3 0 0 0 0-6M2 21v-5a7 7 0 0 1 14 0v5m4 0v-5a7 7 0 0 0-2-5" },
  { id: "urbanization", group: "How people live", text: "The share living in nationally defined urban areas", icon: "M3 21V9l6-4v16m0-10 6-4v14m0-9 6-3v12M6 12h.01M6 16h.01m6-2h.01m0 4h.01m6-3h.01m0 3h.01" },
  { id: "population-growth", group: "How people live", text: "Annual population growth and decline", icon: "M4 18 10 12l4 4 6-9M15 7h5v5" },
  { id: "children-share", group: "How people live", text: "The population share aged 0–14", icon: "M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 22a8 8 0 0 1 16 0" },
  { id: "older-population", group: "How people live", text: "The population share aged 65 and over", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 22a7 7 0 0 1 14 0M17 3l2 2 3-3" },
  { id: "fertility", group: "How people live", text: "Period fertility rates, measured in births per woman", icon: "M12 3v5m-2.5-2.5h5M7 14a5 5 0 1 0 10 0 5 5 0 0 0-10 0z" },
  { id: "life-expectancy", group: "How people live", text: "Expected years of life at birth", icon: "M3 12h4l2-5 4 10 2-5h6M4 20h16" },
  { id: "gdp-per-capita", group: "Economy", text: "Economic output per person", icon: "M3 21h19M5 17v-5h3v5m4 0V7h3v10m4 0V2h3v15" },
];
const subscribeToHydration = () => () => {};

export default function AtlasViewBrowser({ activeViewId, onChoose }: { activeViewId: string; onChoose: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const active = ATLAS_VIEW_PRESETS.find((view) => view.id === activeViewId)!;
  const close = () => { dialog.current?.close(); trigger.current?.focus(); };
  return <div className={styles.browser}>
    <button ref={trigger} type="button" className={styles.trigger} aria-haspopup="dialog" disabled={!ready}
      aria-label={`Choose view: ${active.name}`} onClick={() => dialog.current?.showModal()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-5 9 5-9 5-9-5zm0 5 9 5 9-5M3 17l9 5 9-5" /></svg>
      <span>{active.name}</span>
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="atlas-view-heading"
      onCancel={() => trigger.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.surface}>
        <header><h2 id="atlas-view-heading">Explore the map</h2><button type="button" onClick={close} aria-label="Close map views">×</button></header>
        <div className={styles.choices}>
          {views.map((item) => {
            const view = ATLAS_VIEW_PRESETS.find((candidate) => candidate.id === item.id)!;
            return <button key={item.id} type="button" aria-label={view.name} aria-pressed={activeViewId === item.id}
              onClick={() => { onChoose(item.id); close(); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg>
              <span><small>{item.group}</small><strong>{view.name}</strong><p>{item.text}</p></span>
              {item.id === activeViewId && <span className={styles.current} aria-hidden="true">✓</span>}
            </button>;
          })}
        </div>
      </div>
    </dialog>
  </div>;
}
