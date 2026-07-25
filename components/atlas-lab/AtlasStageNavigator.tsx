import type { AtlasStage } from "@/lib/atlas-lab/types";
import styles from "./AtlasLab.module.css";

interface AtlasStageNavigatorProps {
  activeStageId: string;
  stages: AtlasStage[];
  onSelect: (stageId: string) => void;
}

export function AtlasStageNavigator({
  activeStageId,
  stages,
  onSelect,
}: AtlasStageNavigatorProps) {
  const activeStage = stages.find((stage) => stage.id === activeStageId) ?? stages[0];

  return (
    <>
      <nav className={styles.stageNavigator} aria-label="Developmental stages">
        <div className={styles.stageNavigatorTrack} aria-hidden="true" />
        <ol>
          {stages.map((stage) => {
            const active = stage.id === activeStageId;
            return (
              <li key={stage.id}>
                <button
                  className={styles.stageNavigatorButton}
                  data-active={active}
                  type="button"
                  aria-current={active ? "step" : undefined}
                  aria-label={`Go to stage ${stage.order}: ${stage.title}`}
                  onClick={() => onSelect(stage.id)}
                >
                  <span className={styles.stageNavigatorTitle}>{stage.title}</span>
                  <span className={styles.stageNavigatorNumber}>
                    {String(stage.order).padStart(2, "0")}
                  </span>
                  <span className={styles.stageNavigatorDot} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <label className={styles.mobileStageSelector}>
        <span>
          Stage {String(activeStage.order).padStart(2, "0")} of {stages.length}
        </span>
        <select
          aria-label="Choose developmental stage"
          value={activeStageId}
          onChange={(event) => onSelect(event.target.value)}
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {String(stage.order).padStart(2, "0")} — {stage.title}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
