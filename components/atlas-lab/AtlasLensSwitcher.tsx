import type { AtlasLens } from "@/lib/atlas-lab/types";
import styles from "./AtlasLab.module.css";

const LENSES: Array<{ id: AtlasLens; label: string; shortLabel: string }> = [
  { id: "formation", label: "Formation", shortLabel: "Forms" },
  { id: "structure", label: "Structure", shortLabel: "Parts" },
  { id: "discovery", label: "Discovery", shortLabel: "Found" },
  { id: "evidence", label: "Evidence", shortLabel: "Proof" },
];

interface AtlasLensSwitcherProps {
  lens: AtlasLens;
  onChange: (lens: AtlasLens) => void;
}

export function AtlasLensSwitcher({ lens, onChange }: AtlasLensSwitcherProps) {
  return (
    <div className={styles.lensSwitcher} aria-label="Atlas lens">
      <span className={styles.lensLabel}>Lens</span>
      <div className={styles.lensOptions}>
        {LENSES.map((option) => (
          <button
            className={styles.lensButton}
            data-selected={lens === option.id}
            key={option.id}
            type="button"
            aria-pressed={lens === option.id}
            onClick={() => onChange(option.id)}
          >
            <span className={styles.lensLongLabel}>{option.label}</span>
            <span className={styles.lensShortLabel}>{option.shortLabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
