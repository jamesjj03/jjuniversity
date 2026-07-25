"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AtlasLabUrlState,
  AtlasLens,
  AtlasNode,
  AtlasSnapshot,
} from "@/lib/atlas-lab/types";
import { AtlasLensSwitcher } from "./AtlasLensSwitcher";
import { AtlasSearchPalette } from "./AtlasSearchPalette";
import { AtlasStageNavigator } from "./AtlasStageNavigator";
import { AtlasStageScene } from "./AtlasStageScene";
import styles from "./AtlasLab.module.css";

interface AtlasLabExperienceProps {
  initialState: AtlasLabUrlState;
  snapshot: AtlasSnapshot;
}

interface LiveViewState {
  activeStageId: string;
  focusedNodeId?: string;
  lens: AtlasLens;
}

const VALID_LENSES = new Set<AtlasLens>([
  "formation",
  "structure",
  "discovery",
  "evidence",
]);

const LENS_COPY: Record<AtlasLens, string> = {
  formation: "Prerequisites become transitions; transitions make new capacities possible.",
  structure: "Open the nested parts, systems, and scales inside each stage.",
  discovery: "Follow the experiments, people, and ideas through which the stage became knowable.",
  evidence: "Inspect observation types and source-ready records without invented citations.",
};

function isAtlasLens(value: string | null): value is AtlasLens {
  return Boolean(value && VALID_LENSES.has(value as AtlasLens));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function getPreferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function writeAtlasUrl(state: LiveViewState, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  url.searchParams.set("stage", state.activeStageId);
  url.searchParams.set("lens", state.lens);

  if (state.focusedNodeId) {
    url.searchParams.set("node", state.focusedNodeId);
  } else {
    url.searchParams.delete("node");
  }

  const nextUrl = `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
  if (mode === "push") {
    window.history.pushState(null, "", nextUrl);
  } else {
    window.history.replaceState(null, "", nextUrl);
  }
}

export function AtlasLabExperience({ initialState, snapshot }: AtlasLabExperienceProps) {
  const [activeStageId, setActiveStageId] = useState(initialState.stageId);
  const [focusedNodeId, setFocusedNodeId] = useState<string | undefined>(
    initialState.nodeId,
  );
  const [lens, setLens] = useState<AtlasLens>(initialState.lens);
  const [searchOpen, setSearchOpen] = useState(false);
  const [railDocked, setRailDocked] = useState(false);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const programmaticStageRef = useRef<string | null>(null);
  const pendingNodeFocusRef = useRef<string | null>(null);
  const programmaticCleanupRef = useRef<(() => void) | null>(null);
  const intersectionRatiosRef = useRef(new Map<string, number>());

  const stageById = useMemo(
    () => new Map(snapshot.stages.map((stage) => [stage.id, stage])),
    [snapshot.stages],
  );
  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes],
  );
  const nodesByStage = useMemo(() => {
    const grouped = new Map<string, AtlasNode[]>();
    snapshot.stages.forEach((stage) => grouped.set(stage.id, []));
    snapshot.nodes.forEach((node) => grouped.get(node.stageId)?.push(node));
    return grouped;
  }, [snapshot.nodes, snapshot.stages]);

  const liveStateRef = useRef<LiveViewState>({
    activeStageId,
    focusedNodeId,
    lens,
  });

  const focusNodeControl = useCallback((nodeId: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`atlas-node-${nodeId}`)?.focus({ preventScroll: true });
    });
  }, []);

  const completeProgrammaticNavigation = useCallback((stageId: string) => {
    if (programmaticStageRef.current !== stageId) return;
    programmaticCleanupRef.current?.();
    programmaticCleanupRef.current = null;
    programmaticStageRef.current = null;

    const pendingNodeId = pendingNodeFocusRef.current;
    pendingNodeFocusRef.current = null;
    if (pendingNodeId) focusNodeControl(pendingNodeId);
  }, [focusNodeControl]);

  const scrollToStage = useCallback(
    (
      stageId: string,
      nodeId?: string,
      behavior: ScrollBehavior = getPreferredScrollBehavior(),
    ) => {
      programmaticCleanupRef.current?.();
      programmaticCleanupRef.current = null;
      programmaticStageRef.current = stageId;
      pendingNodeFocusRef.current = nodeId ?? null;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (programmaticStageRef.current !== stageId) return;

          document
            .getElementById(`atlas-stage-${stageId}`)
            ?.scrollIntoView({ behavior, block: "start" });

          if (behavior === "auto") {
            window.requestAnimationFrame(() => completeProgrammaticNavigation(stageId));
            return;
          }

          const finishNavigation = () => completeProgrammaticNavigation(stageId);
          const timeoutId = window.setTimeout(finishNavigation, 1600);
          window.addEventListener("scrollend", finishNavigation, { once: true });
          programmaticCleanupRef.current = () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener("scrollend", finishNavigation);
          };

          const target = document.getElementById(`atlas-stage-${stageId}`);
          if (target) {
            const bounds = target.getBoundingClientRect();
            const focusLine = window.innerHeight * 0.36;
            if (bounds.top <= focusLine && bounds.bottom >= focusLine) {
              window.requestAnimationFrame(finishNavigation);
            }
          }
        });
      });
    },
    [completeProgrammaticNavigation],
  );

  function selectStage(stageId: string) {
    if (!stageById.has(stageId)) return;

    const nextState: LiveViewState = { activeStageId: stageId, lens };
    liveStateRef.current = nextState;
    setActiveStageId(stageId);
    setFocusedNodeId(undefined);
    writeAtlasUrl(nextState, "push");
    scrollToStage(stageId);
  }

  function selectNode(nodeId: string) {
    const node = nodeById.get(nodeId);
    if (!node) return;

    const nextState: LiveViewState = {
      activeStageId: node.stageId,
      focusedNodeId: node.id,
      lens,
    };
    const stageChanged = activeStageId !== node.stageId;

    liveStateRef.current = nextState;
    setActiveStageId(node.stageId);
    setFocusedNodeId(node.id);
    writeAtlasUrl(nextState, "push");

    if (stageChanged) {
      scrollToStage(node.stageId, node.id);
    } else {
      focusNodeControl(node.id);
    }
  }

  function changeLens(nextLens: AtlasLens) {
    if (nextLens === lens) return;

    const nextState: LiveViewState = {
      activeStageId,
      focusedNodeId,
      lens: nextLens,
    };
    liveStateRef.current = nextState;
    setLens(nextLens);
    writeAtlasUrl(nextState, "push");
  }

  function closeNodeFocus() {
    const nodeToRestore = focusedNodeId;
    const nextState: LiveViewState = { activeStageId, lens };

    liveStateRef.current = nextState;
    setFocusedNodeId(undefined);
    writeAtlasUrl(nextState, "push");
    if (nodeToRestore) focusNodeControl(nodeToRestore);
  }

  function openSearch() {
    searchReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpen(true);
  }

  function closeSearch(restoreFocus: boolean) {
    setSearchOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => searchReturnFocusRef.current?.focus());
    }
  }

  function selectSearchResult(nodeId: string) {
    closeSearch(false);
    selectNode(nodeId);
  }

  useEffect(() => {
    const siteHeader = document.querySelector<HTMLElement>("header.siteHeader");
    if (!siteHeader) return;

    const observer = new IntersectionObserver(
      ([entry]) => setRailDocked(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(siteHeader);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      programmaticCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    const stageElements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-atlas-stage]"),
    );
    const ratios = intersectionRatiosRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const stageId = (entry.target as HTMLElement).dataset.atlasStage;
          if (stageId) ratios.set(stageId, entry.isIntersecting ? entry.intersectionRatio : 0);
        });

        const programmaticTarget = programmaticStageRef.current;
        if (programmaticTarget) {
          const targetRatio = ratios.get(programmaticTarget) ?? 0;
          if (targetRatio > 0.16) {
            if (liveStateRef.current.activeStageId !== programmaticTarget) {
              liveStateRef.current = {
                ...liveStateRef.current,
                activeStageId: programmaticTarget,
              };
              setActiveStageId(programmaticTarget);
            }
            completeProgrammaticNavigation(programmaticTarget);
          }
          return;
        }

        const visibleStage = [...ratios.entries()]
          .filter(([, ratio]) => ratio > 0)
          .sort((left, right) => right[1] - left[1])[0]?.[0];

        if (!visibleStage || visibleStage === liveStateRef.current.activeStageId) return;

        const current = liveStateRef.current;
        const focusedStage = current.focusedNodeId
          ? nodeById.get(current.focusedNodeId)?.stageId
          : undefined;
        const nextFocusedNodeId =
          focusedStage && focusedStage !== visibleStage ? undefined : current.focusedNodeId;
        const nextState: LiveViewState = {
          activeStageId: visibleStage,
          focusedNodeId: nextFocusedNodeId,
          lens: current.lens,
        };

        liveStateRef.current = nextState;
        setActiveStageId(visibleStage);
        if (nextFocusedNodeId !== current.focusedNodeId) setFocusedNodeId(undefined);
        writeAtlasUrl(nextState, "replace");
      },
      {
        rootMargin: "-20% 0px -38% 0px",
        threshold: [0, 0.12, 0.25, 0.4, 0.58, 0.75],
      },
    );

    stageElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [completeProgrammaticNavigation, nodeById]);

  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const requestedNode = params.get("node");
      const node = requestedNode ? nodeById.get(requestedNode) : undefined;
      const requestedStage = params.get("stage");
      const stageId =
        node?.stageId ??
        (requestedStage && stageById.has(requestedStage)
          ? requestedStage
          : snapshot.stages[0].id);
      const requestedLens = params.get("lens");
      const nextLens = isAtlasLens(requestedLens) ? requestedLens : "formation";
      const nextState: LiveViewState = {
        activeStageId: stageId,
        focusedNodeId: node?.id,
        lens: nextLens,
      };

      liveStateRef.current = nextState;
      setActiveStageId(stageId);
      setFocusedNodeId(node?.id);
      setLens(nextLens);
      scrollToStage(stageId, node?.id);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [nodeById, scrollToStage, snapshot.stages, stageById]);

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      const commandSearch = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slashSearch =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableTarget(event.target);

      if (commandSearch || slashSearch) {
        event.preventDefault();
        if (!searchOpen) openSearch();
        return;
      }

      if (event.key !== "Escape") return;

      if (searchOpen) {
        event.preventDefault();
        closeSearch(true);
      } else if (focusedNodeId) {
        event.preventDefault();
        closeNodeFocus();
      }
    }

    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentNode = params.get("node") ?? undefined;
    const currentStage = params.get("stage") ?? snapshot.stages[0].id;
    const currentLens = isAtlasLens(params.get("lens")) ? params.get("lens") : "formation";
    const canonicalMismatch =
      currentStage !== initialState.stageId ||
      currentNode !== initialState.nodeId ||
      currentLens !== initialState.lens;

    if (canonicalMismatch) {
      writeAtlasUrl(
        {
          activeStageId: initialState.stageId,
          focusedNodeId: initialState.nodeId,
          lens: initialState.lens,
        },
        "replace",
      );
    }

    if (initialState.stageId !== snapshot.stages[0].id || initialState.nodeId) {
      scrollToStage(initialState.stageId, initialState.nodeId, "auto");
    }
  }, [initialState, scrollToStage, snapshot.stages]);

  const activeStage =
    stageById.get(activeStageId) ?? snapshot.stages[0];

  return (
    <main
      className={styles.root}
      data-lens={lens}
      data-rail-docked={railDocked ? "true" : "false"}
    >
      <a className={styles.skipLink} href={`#atlas-stage-${snapshot.stages[0].id}`}>
        Skip to the developmental map
      </a>

      <div className={styles.interfaceRail}>
        <div className={styles.interfaceIdentity}>
          <span className={styles.interfaceMark} aria-hidden="true" />
          <span>
            <strong>Atlas V2</strong>
            <small>Formation map · local prototype</small>
          </span>
        </div>

        <AtlasLensSwitcher lens={lens} onChange={changeLens} />

        <button className={styles.searchTrigger} type="button" onClick={openSearch}>
          <span>Search</span>
          <kbd>/</kbd>
        </button>
      </div>

      <AtlasStageNavigator
        activeStageId={activeStageId}
        stages={snapshot.stages}
        onSelect={selectStage}
      />

      <section className={styles.prologue} aria-labelledby="atlas-lab-title">
        <div className={styles.prologueField} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className={styles.prologueKicker}>A developmental map of reality</p>
        <h1 id="atlas-lab-title">
          What had to exist
          <span>before this could?</span>
        </h1>
        <div className={styles.prologueCopy}>
          <p>
            The Atlas follows how simpler structures, processes, and conditions opened the way
            for new forms of organization—from the hot early universe to the present.
          </p>
          <p>
            It is a tree for reading and a graph underneath: one clear display parent, with
            secondary prerequisites and cross-links left intact.
          </p>
        </div>
        <div className={styles.prologueNotes}>
          <p>
            <span>Time</span>
            Labels are approximate. Visual distance is narratively compressed, not literal.
          </p>
          <p>
            <span>Root</span>
            The hot early universe begins this represented history; the map does not claim the
            known laws of physics emerged from it.
          </p>
        </div>
        <a className={styles.beginJourney} href={`#atlas-stage-${snapshot.stages[0].id}`}>
          Enter formation <span aria-hidden="true">↓</span>
        </a>
      </section>

      <section className={styles.lensNarration} aria-live="polite">
        <span>{lens}</span>
        <p>{LENS_COPY[lens]}</p>
      </section>

      <div className={styles.journey}>
        <div className={styles.developmentalSpine} aria-hidden="true">
          <span />
        </div>

        {snapshot.stages.map((stage, index) => (
          <AtlasStageScene
            active={stage.id === activeStageId}
            edges={snapshot.edges}
            focusedNodeId={focusedNodeId}
            key={stage.id}
            lens={lens}
            nextStageTitle={snapshot.stages[index + 1]?.title}
            nodes={nodesByStage.get(stage.id) ?? []}
            nodesById={nodeById}
            stage={stage}
            onCloseFocus={closeNodeFocus}
            onSelectNode={selectNode}
          />
        ))}
      </div>

      <section className={styles.epilogue} aria-labelledby="atlas-open-title">
        <p className={styles.prologueKicker}>Present is not completion</p>
        <h2 id="atlas-open-title">The developmental graph stays open.</h2>
        <p>
          New evidence can revise an edge. A better explanation can change a transition. The
          central spine is orientation—not a claim that history had only one possible path.
        </p>
        <button type="button" onClick={() => selectStage(snapshot.stages[0].id)}>
          Return to the early universe <span aria-hidden="true">↑</span>
        </button>
        <small>
          Snapshot {snapshot.schemaVersion} · {snapshot.nodes.length} nodes · local fixture · no
          live Atlas data
        </small>
      </section>

      <div className={styles.stageAnnouncement} aria-live="polite">
        Stage {activeStage.order}: {activeStage.title}
      </div>

      {searchOpen && (
        <AtlasSearchPalette
          nodes={snapshot.nodes}
          stages={snapshot.stages}
          onClose={closeSearch}
          onSelect={selectSearchResult}
        />
      )}
    </main>
  );
}
