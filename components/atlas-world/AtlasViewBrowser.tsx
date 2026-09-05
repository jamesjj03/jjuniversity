"use client";

import { useEffect, useRef, useState } from "react";
import { ATLAS_VIEW_PRESETS } from "@/lib/atlas-world/layers";
import styles from "./AtlasWorld.module.css";

const groups = [
  { name: "World", ids: ["political"] },
  { name: "People", ids: ["where-people-live", "population", "religion"] },
  { name: "Institutions", ids: ["government"] },
  { name: "Economy", ids: ["gdp-per-capita"] },
];
const descriptions: Record<string, string> = {
  political: "Countries, territories & boundaries",
  "where-people-live": "The geography of human settlement",
  population: "How many people, country by country",
  religion: "Traditions, majorities & mixed societies",
  government: "How national governments are organized",
  "gdp-per-capita": "Economic output per person",
};

export default function AtlasViewBrowser({ activeViewId, onChoose }: { activeViewId: string; onChoose: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = ATLAS_VIEW_PRESETS.find((view) => view.id === activeViewId)!;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className={styles.viewBrowser} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className={styles.viewTrigger} aria-expanded={open} aria-controls="atlas-view-browser"
      aria-label={`Choose view: ${active.name}`} onClick={() => setOpen(!open)}>
      <span><small>EXPLORE</small><strong>{active.name}</strong></span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className={styles.viewMenu} id="atlas-view-browser" role="group" aria-label="Atlas view">
      <div className={styles.viewMenuHeading}>One world. Different ways of seeing.</div>
      {groups.map((group) => <section key={group.name}><h2>{group.name}</h2>
        {group.ids.map((id) => {
          const view = ATLAS_VIEW_PRESETS.find((candidate) => candidate.id === id)!;
          return <button key={id} type="button" aria-pressed={id === activeViewId} onClick={() => { onChoose(id); setOpen(false); trigger.current?.focus(); }}>
            <span className={`${styles.viewSwatch} ${styles[`swatch_${id.replace(/-/g, "_")}`]}`} aria-hidden="true" />
            <span><strong>{view.name}</strong><small>{descriptions[id]}</small></span><span aria-hidden="true">{id === activeViewId ? "✓" : "→"}</span>
          </button>;
        })}
      </section>)}
    </div>}
  </div>;
}
