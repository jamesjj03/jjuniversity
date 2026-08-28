"use client";

import { useState, type KeyboardEvent } from "react";
import type { PrintReviewSurface } from "@/lib/printReviewTypes";
import PrintDesignLab from "./PrintDesignLab";
import PrintReviewEditor from "./PrintReviewEditor";
import styles from "./PrintReviewEditorWorkspace.module.css";

type PrintWorkspaceView = "design" | "evidence";

export default function PrintReviewEditorWorkspace({ surface }: { surface: PrintReviewSurface }) {
  const [view, setView] = useState<PrintWorkspaceView>("design");

  function moveBetweenTabs(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const nextView = event.key === "ArrowLeft" || event.key === "Home" ? "design" : "evidence";
    setView(nextView);
    window.requestAnimationFrame(() => document.getElementById(`print-${nextView === "design" ? "design" : "evidence"}-tab`)?.focus());
    event.preventDefault();
  }

  return (
    <div className={styles.workspace}>
      <nav className={styles.switcher} aria-label="Print Workshop views">
        <div>
          <strong>Print Workshop</strong>
          <span>Permanent address: /admin/print</span>
        </div>
        <div role="tablist" aria-label="Choose a print workspace">
          <button
            id="print-design-tab"
            role="tab"
            type="button"
            aria-selected={view === "design"}
            aria-controls="print-design-panel"
            tabIndex={view === "design" ? 0 : -1}
            onClick={() => setView("design")}
            onKeyDown={moveBetweenTabs}
          >
            <span>Design Lab</span>
            <small>Build and test the cover system</small>
          </button>
          <button
            id="print-evidence-tab"
            role="tab"
            type="button"
            aria-selected={view === "evidence"}
            aria-controls="print-evidence-panel"
            tabIndex={view === "evidence" ? 0 : -1}
            onClick={() => setView("evidence")}
            onKeyDown={moveBetweenTabs}
          >
            <span>Evidence + decisions</span>
            <small>Proof facts, blockers, and review queue</small>
          </button>
        </div>
      </nav>

      <section id="print-design-panel" role="tabpanel" aria-labelledby="print-design-tab" hidden={view !== "design"}>
        <PrintDesignLab />
      </section>
      <section id="print-evidence-panel" role="tabpanel" aria-labelledby="print-evidence-tab" hidden={view !== "evidence"}>
        <PrintReviewEditor surface={surface} />
      </section>
    </div>
  );
}
