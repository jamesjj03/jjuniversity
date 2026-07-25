"use client";

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AtlasLabUrlState,
  AtlasLens,
  AtlasNode,
  AtlasSnapshot,
} from "@/lib/atlas-lab/types";
import { AtlasLensSwitcher } from "./AtlasLensSwitcher";
import { AtlasSearchPalette } from "./AtlasSearchPalette";
import {
  ATLAS_BRANCH_OFFSETS,
  ATLAS_MAP_HEIGHT,
  ATLAS_MAP_STAGE_PLACEMENTS,
  ATLAS_MAP_WIDTH,
  ATLAS_PRIMARY_ROUTE,
} from "./atlasMapLayout";
import styles from "./AtlasLab.module.css";

interface AtlasLabExperienceProps {
  initialState: AtlasLabUrlState;
  snapshot: AtlasSnapshot;
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface LiveViewState {
  activeStageId: string;
  focusedNodeId?: string;
  lens: AtlasLens;
}

type StageStyle = CSSProperties & {
  "--stage-accent": string;
  "--stage-x": `${number}px`;
  "--stage-y": `${number}px`;
  "--label-x": `${number}px`;
  "--label-y": `${number}px`;
};

type BranchStyle = CSSProperties & {
  "--node-accent": string;
  "--node-x": `${number}px`;
  "--node-y": `${number}px`;
};

const VALID_LENSES = new Set<AtlasLens>([
  "formation",
  "structure",
  "discovery",
  "evidence",
]);

const LENS_SYMBOL: Record<AtlasLens, string> = {
  formation: "↗",
  structure: "⌘",
  discovery: "✦",
  evidence: "◆",
};

const CAMERA_MARGIN = 28;

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

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  window.history[mode === "push" ? "pushState" : "replaceState"](
    null,
    "",
    nextUrl,
  );
}

function getFitScale(viewport: ViewportSize) {
  return Math.min(
    viewport.width / ATLAS_MAP_WIDTH,
    viewport.height / ATLAS_MAP_HEIGHT,
  );
}

function getFitCamera(viewport: ViewportSize): Camera {
  const scale = getFitScale(viewport);
  return {
    x: (viewport.width - ATLAS_MAP_WIDTH * scale) / 2,
    y: (viewport.height - ATLAS_MAP_HEIGHT * scale) / 2,
    scale,
  };
}

function getInitialCamera(viewport: ViewportSize): Camera {
  if (viewport.width >= 640) return getFitCamera(viewport);

  const scale = Math.max(
    viewport.width / ATLAS_MAP_WIDTH,
    (viewport.height / ATLAS_MAP_HEIGHT) * 0.78,
  );
  return clampCamera(
    {
      x: 12,
      y: (viewport.height - ATLAS_MAP_HEIGHT * scale) / 2,
      scale,
    },
    viewport,
  );
}

function clampCamera(camera: Camera, viewport: ViewportSize): Camera {
  const fitScale = getFitScale(viewport);
  const scale = Math.min(Math.max(camera.scale, fitScale), Math.max(2.2, fitScale * 3.2));
  const width = ATLAS_MAP_WIDTH * scale;
  const height = ATLAS_MAP_HEIGHT * scale;

  const x =
    width <= viewport.width
      ? (viewport.width - width) / 2
      : Math.min(CAMERA_MARGIN, Math.max(viewport.width - width - CAMERA_MARGIN, camera.x));
  const y =
    height <= viewport.height
      ? (viewport.height - height) / 2
      : Math.min(CAMERA_MARGIN, Math.max(viewport.height - height - CAMERA_MARGIN, camera.y));

  return { x, y, scale };
}

function cameraForStage(stageId: string, viewport: ViewportSize, close = false) {
  const placement =
    ATLAS_MAP_STAGE_PLACEMENTS[stageId] ??
    ATLAS_MAP_STAGE_PLACEMENTS["early-universe"];
  const fitScale = getFitScale(viewport);
  const scale = Math.min(Math.max(fitScale * (close ? 2.45 : 1.72), close ? 1.28 : 0.88), 1.8);

  return clampCamera(
    {
      x: viewport.width / 2 - placement.x * scale,
      y: viewport.height / 2 - placement.y * scale,
      scale,
    },
    viewport,
  );
}

function nearestStageId(camera: Camera, viewport: ViewportSize) {
  const centerX = (viewport.width / 2 - camera.x) / camera.scale;
  const centerY = (viewport.height / 2 - camera.y) / camera.scale;

  return Object.entries(ATLAS_MAP_STAGE_PLACEMENTS).sort(([, left], [, right]) => {
    const leftDistance = Math.hypot(centerX - left.x, centerY - left.y);
    const rightDistance = Math.hypot(centerX - right.x, centerY - right.y);
    return leftDistance - rightDistance;
  })[0]?.[0];
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function firstItems(items: string[] | undefined, amount = 2) {
  return items?.slice(0, amount) ?? [];
}

function nodePosition(stageId: string, branchIndex: number) {
  const stage = ATLAS_MAP_STAGE_PLACEMENTS[stageId];
  const offset = ATLAS_BRANCH_OFFSETS[branchIndex % ATLAS_BRANCH_OFFSETS.length];
  const orbit = Math.floor(branchIndex / ATLAS_BRANCH_OFFSETS.length) + 1;

  return {
    x: stage.x + offset.x * orbit,
    y: stage.y + offset.y * orbit,
  };
}

export function AtlasLabExperience({ initialState, snapshot }: AtlasLabExperienceProps) {
  const [activeStageId, setActiveStageId] = useState(initialState.stageId);
  const [focusedNodeId, setFocusedNodeId] = useState<string | undefined>(
    initialState.nodeId,
  );
  const [lens, setLens] = useState<AtlasLens>(initialState.lens);
  const [searchOpen, setSearchOpen] = useState(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [viewport, setViewport] = useState<ViewportSize>({ width: 1, height: 1 });
  const [cameraReady, setCameraReady] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showGuide, setShowGuide] = useState(true);

  const viewportRef = useRef<HTMLDivElement>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const cameraRef = useRef(camera);
  const viewportSizeRef = useRef(viewport);
  const pendingCameraRef = useRef<Camera | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const moveEndRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    camera: Camera;
  } | null>(null);

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
    grouped.forEach((nodes) => nodes.sort((left, right) => left.displayOrder - right.displayOrder));
    return grouped;
  }, [snapshot.nodes, snapshot.stages]);
  const focusedNode = focusedNodeId ? nodeById.get(focusedNodeId) : undefined;
  const activeStage = stageById.get(activeStageId) ?? snapshot.stages[0];
  const zoomLevel =
    camera.scale < 0.82 ? "overview" : camera.scale < 1.45 ? "regional" : "detail";

  const liveStateRef = useRef<LiveViewState>({
    activeStageId,
    focusedNodeId,
    lens,
  });

  const commitCamera = useCallback((nextCamera: Camera) => {
    const next = clampCamera(nextCamera, viewportSizeRef.current);
    cameraRef.current = next;
    setCamera(next);
  }, []);

  const scheduleCamera = useCallback(
    (nextCamera: Camera) => {
      pendingCameraRef.current = nextCamera;
      if (cameraFrameRef.current !== null) return;

      cameraFrameRef.current = window.requestAnimationFrame(() => {
        cameraFrameRef.current = null;
        const pending = pendingCameraRef.current;
        pendingCameraRef.current = null;
        if (pending) commitCamera(pending);
      });
    },
    [commitCamera],
  );

  const updateStageFromCamera = useCallback(
    (mode: "push" | "replace" = "replace") => {
      const nextStageId = nearestStageId(cameraRef.current, viewportSizeRef.current);
      if (!nextStageId || nextStageId === liveStateRef.current.activeStageId) return;

      const nextState: LiveViewState = {
        activeStageId: nextStageId,
        lens: liveStateRef.current.lens,
      };
      liveStateRef.current = nextState;
      setActiveStageId(nextStageId);
      setFocusedNodeId(undefined);
      writeAtlasUrl(nextState, mode);
    },
    [],
  );

  const animateCamera = useCallback(
    (target: Camera) => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      const start = cameraRef.current;
      const duration = prefersReducedMotion() ? 0 : 650;
      const startAt = performance.now();
      setMoving(true);

      function frame(now: number) {
        const progress = duration === 0 ? 1 : Math.min(1, (now - startAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 4);
        commitCamera({
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased,
          scale: start.scale + (target.scale - start.scale) * eased,
        });

        if (progress < 1) {
          animationFrameRef.current = window.requestAnimationFrame(frame);
        } else {
          animationFrameRef.current = null;
          setMoving(false);
        }
      }

      animationFrameRef.current = window.requestAnimationFrame(frame);
    },
    [commitCamera],
  );

  const focusStageCamera = useCallback(
    (stageId: string, close = false) => {
      animateCamera(cameraForStage(stageId, viewportSizeRef.current, close));
    },
    [animateCamera],
  );

  const selectStage = useCallback(
    (stageId: string) => {
      if (!stageById.has(stageId)) return;
      const nextState: LiveViewState = { activeStageId: stageId, lens };
      liveStateRef.current = nextState;
      setActiveStageId(stageId);
      setFocusedNodeId(undefined);
      writeAtlasUrl(nextState, "push");
      focusStageCamera(stageId);
    },
    [focusStageCamera, lens, stageById],
  );

  const selectNode = useCallback(
    (nodeId: string) => {
      const node = nodeById.get(nodeId);
      if (!node) return;

      const nextState: LiveViewState = {
        activeStageId: node.stageId,
        focusedNodeId: node.id,
        lens,
      };
      liveStateRef.current = nextState;
      setActiveStageId(node.stageId);
      setFocusedNodeId(node.id);
      writeAtlasUrl(nextState, "push");
      focusStageCamera(node.stageId, node.kind !== "stage");

      window.requestAnimationFrame(() => {
        document.getElementById(`atlas-map-node-${node.id}`)?.focus({ preventScroll: true });
      });
    },
    [focusStageCamera, lens, nodeById],
  );

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
    const previousNodeId = focusedNodeId;
    const nextState: LiveViewState = { activeStageId, lens };
    liveStateRef.current = nextState;
    setFocusedNodeId(undefined);
    writeAtlasUrl(nextState, "push");
    if (previousNodeId) {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`atlas-map-node-${previousNodeId}`)
          ?.focus({ preventScroll: true });
      });
    }
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

  function zoomAt(nextScale: number, screenX: number, screenY: number) {
    const current = cameraRef.current;
    const mapX = (screenX - current.x) / current.scale;
    const mapY = (screenY - current.y) / current.scale;
    const next = clampCamera(
      {
        scale: nextScale,
        x: screenX - mapX * nextScale,
        y: screenY - mapY * nextScale,
      },
      viewportSizeRef.current,
    );
    animateCamera(next);
  }

  function zoomBy(factor: number) {
    const size = viewportSizeRef.current;
    zoomAt(cameraRef.current.scale * factor, size.width / 2, size.height / 2);
  }

  function fitMap() {
    const nextState: LiveViewState = {
      activeStageId: snapshot.stages[0].id,
      lens,
    };
    liveStateRef.current = nextState;
    setActiveStageId(nextState.activeStageId);
    setFocusedNodeId(undefined);
    writeAtlasUrl(nextState, "push");
    animateCamera(getFitCamera(viewportSizeRef.current));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, select")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera: cameraRef.current,
    };
    setMoving(true);
    setShowGuide(false);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    scheduleCamera({
      ...drag.camera,
      x: drag.camera.x + event.clientX - drag.x,
      y: drag.camera.y + event.clientY - drag.y,
    });
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (pendingCameraRef.current) {
      if (cameraFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraFrameRef.current);
        cameraFrameRef.current = null;
      }
      const pending = pendingCameraRef.current;
      pendingCameraRef.current = null;
      commitCamera(pending);
    }
    setMoving(false);
    updateStageFromCamera();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setShowGuide(false);
    const bounds = event.currentTarget.getBoundingClientRect();

    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.003);
      const current = cameraRef.current;
      const screenX = event.clientX - bounds.left;
      const screenY = event.clientY - bounds.top;
      const mapX = (screenX - current.x) / current.scale;
      const mapY = (screenY - current.y) / current.scale;
      scheduleCamera({
        scale: current.scale * factor,
        x: screenX - mapX * current.scale * factor,
        y: screenY - mapY * current.scale * factor,
      });
    } else {
      const current = cameraRef.current;
      scheduleCamera({
        ...current,
        x: current.x - event.deltaX - event.deltaY * 0.72,
        y: current.y - event.deltaY * 0.12,
      });
    }

    if (moveEndRef.current) window.clearTimeout(moveEndRef.current);
    moveEndRef.current = window.setTimeout(() => updateStageFromCamera(), 140);
  }

  function handleMinimapPointer(event: ReactMouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const mapX = ((event.clientX - bounds.left) / bounds.width) * ATLAS_MAP_WIDTH;
    const mapY = ((event.clientY - bounds.top) / bounds.height) * ATLAS_MAP_HEIGHT;
    const current = cameraRef.current;
    animateCamera(
      clampCamera(
        {
          ...current,
          x: viewportSizeRef.current.width / 2 - mapX * current.scale,
          y: viewportSizeRef.current.height / 2 - mapY * current.scale,
        },
        viewportSizeRef.current,
      ),
    );
    window.setTimeout(() => updateStageFromCamera(), prefersReducedMotion() ? 30 : 690);
  }

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const nextViewport = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      viewportSizeRef.current = nextViewport;
      setViewport(nextViewport);

      if (!cameraReady) {
        const initialCamera = initialState.nodeId
          ? cameraForStage(initialState.stageId, nextViewport, true)
          : getInitialCamera(nextViewport);
        cameraRef.current = initialCamera;
        setCamera(initialCamera);
        setCameraReady(true);
      } else {
        commitCamera(cameraRef.current);
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [cameraReady, commitCamera, initialState.nodeId, initialState.stageId]);

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
      const nextLens: AtlasLens = isAtlasLens(requestedLens)
        ? requestedLens
        : "formation";
      const nextState: LiveViewState = {
        activeStageId: stageId,
        focusedNodeId: node?.id,
        lens: nextLens,
      };
      liveStateRef.current = nextState;
      setActiveStageId(stageId);
      setFocusedNodeId(node?.id);
      setLens(nextLens);
      focusStageCamera(stageId, Boolean(node));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [focusStageCamera, nodeById, snapshot.stages, stageById]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
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

      if (event.key === "Escape") {
        if (searchOpen) {
          event.preventDefault();
          closeSearch(true);
        } else if (focusedNodeId) {
          event.preventDefault();
          closeNodeFocus();
        }
        return;
      }

      if (isEditableTarget(event.target) || searchOpen) return;

      const panAmount = event.shiftKey ? 180 : 72;
      const current = cameraRef.current;
      const movement: Partial<Camera> =
        event.key === "ArrowLeft"
          ? { x: current.x + panAmount }
          : event.key === "ArrowRight"
            ? { x: current.x - panAmount }
            : event.key === "ArrowUp"
              ? { y: current.y + panAmount }
              : event.key === "ArrowDown"
                ? { y: current.y - panAmount }
                : {};

      if (Object.keys(movement).length) {
        event.preventDefault();
        animateCamera({ ...current, ...movement });
        window.setTimeout(() => updateStageFromCamera(), prefersReducedMotion() ? 30 : 690);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1.24);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomBy(0.8);
      } else if (event.key === "0") {
        event.preventDefault();
        fitMap();
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  useEffect(
    () => () => {
      if (cameraFrameRef.current !== null) window.cancelAnimationFrame(cameraFrameRef.current);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (moveEndRef.current) window.clearTimeout(moveEndRef.current);
    },
    [],
  );

  const mapStyle: CSSProperties = {
    width: ATLAS_MAP_WIDTH,
    height: ATLAS_MAP_HEIGHT,
    transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`,
  };

  const visibleMapWidth = viewport.width / camera.scale;
  const visibleMapHeight = viewport.height / camera.scale;
  const minimapViewportStyle: CSSProperties = {
    left: `${Math.max(0, (-camera.x / camera.scale / ATLAS_MAP_WIDTH) * 100)}%`,
    top: `${Math.max(0, (-camera.y / camera.scale / ATLAS_MAP_HEIGHT) * 100)}%`,
    width: `${Math.min(100, (visibleMapWidth / ATLAS_MAP_WIDTH) * 100)}%`,
    height: `${Math.min(100, (visibleMapHeight / ATLAS_MAP_HEIGHT) * 100)}%`,
  };

  return (
    <main
      className={styles.root}
      data-lens={lens}
      data-moving={moving ? "true" : "false"}
      data-zoom={zoomLevel}
    >
      <h1 className={styles.visuallyHidden}>Atlas: a visual map of formation</h1>

      <div className={styles.topographicChrome}>
        <div className={styles.atlasIdentity} aria-label="Atlas V2 visual laboratory">
          <span className={styles.atlasCompass} aria-hidden="true">
            ✦
          </span>
          <span>
            <strong>ATLAS</strong>
            <small>visual lab</small>
          </span>
        </div>

        <AtlasLensSwitcher lens={lens} onChange={changeLens} />

        <button className={styles.searchTrigger} type="button" onClick={openSearch}>
          <span className={styles.searchIcon} aria-hidden="true" />
          <span>Find</span>
          <kbd>/</kbd>
        </button>
      </div>

      <section
        ref={viewportRef}
        className={styles.mapViewport}
        aria-label="Pan and zoom through the developmental map of reality"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
      >
        <div className={styles.mapWorld} style={mapStyle} aria-busy={!cameraReady}>
          <div className={styles.illustratedTerrain} aria-hidden="true" />
          <div className={styles.mapAtmosphere} aria-hidden="true" />

          <svg
            className={styles.graphLayer}
            viewBox={`0 0 ${ATLAS_MAP_WIDTH} ${ATLAS_MAP_HEIGHT}`}
            aria-hidden="true"
          >
            <defs>
              <filter id="atlas-route-softness" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
              <linearGradient id="atlas-route-color" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#a79cff" />
                <stop offset=".32" stopColor="#f3cf83" />
                <stop offset=".58" stopColor="#67d5a1" />
                <stop offset="1" stopColor="#f0bd79" />
              </linearGradient>
            </defs>
            <path
              className={styles.routeAura}
              d={ATLAS_PRIMARY_ROUTE}
              filter="url(#atlas-route-softness)"
            />
            <path className={styles.primaryRoute} d={ATLAS_PRIMARY_ROUTE} pathLength="1" />

            {snapshot.stages.map((stage) => {
              const placement = ATLAS_MAP_STAGE_PLACEMENTS[stage.id];
              const stageNodes = nodesByStage.get(stage.id) ?? [];
              return stageNodes.slice(1).map((node, index) => {
                const position = nodePosition(stage.id, index);
                const nodeHasLensData =
                  lens === "structure"
                    ? Boolean(node.structure?.parts?.length || node.structure?.systems?.length)
                    : lens === "discovery"
                      ? Boolean(node.discovery?.length)
                      : lens === "evidence"
                        ? Boolean(node.evidence?.length)
                        : true;

                return (
                  <line
                    className={styles.branchEdge}
                    data-active={
                      (stage.id === activeStageId && nodeHasLensData) || node.id === focusedNodeId
                    }
                    key={`edge-${node.id}`}
                    x1={placement.x}
                    y1={placement.y}
                    x2={position.x}
                    y2={position.y}
                  />
                );
              });
            })}
          </svg>

          {snapshot.stages.map((stage) => {
            const placement = ATLAS_MAP_STAGE_PLACEMENTS[stage.id];
            const stageNodes = nodesByStage.get(stage.id) ?? [];
            const active = stage.id === activeStageId;
            const primaryNode = nodeById.get(stage.primaryNodeId);
            const discoveryCount = stageNodes.reduce(
              (count, node) => count + (node.discovery?.length ?? 0),
              0,
            );
            const evidenceCount = stageNodes.reduce(
              (count, node) => count + (node.evidence?.length ?? 0),
              0,
            );
            const style: StageStyle = {
              "--stage-accent": stage.accent,
              "--stage-x": `${placement.x}px`,
              "--stage-y": `${placement.y}px`,
              "--label-x": `${placement.labelX}px`,
              "--label-y": `${placement.labelY}px`,
            };

            return (
              <div
                className={styles.stageLandmark}
                data-active={active}
                data-align={placement.labelAlign ?? "left"}
                key={stage.id}
                style={style}
              >
                <button
                  className={styles.stageTarget}
                  id={`atlas-map-node-${stage.primaryNodeId}`}
                  type="button"
                  aria-current={active ? "step" : undefined}
                  aria-label={`Stage ${stage.order}: ${stage.title}. ${stage.timeLabel}`}
                  aria-describedby={
                    focusedNodeId === stage.primaryNodeId
                      ? `atlas-map-detail-${stage.primaryNodeId}`
                      : undefined
                  }
                  onClick={() => selectNode(stage.primaryNodeId)}
                >
                  <span className={styles.stagePulse} aria-hidden="true" />
                  <span className={styles.stageCore}>
                    {String(stage.order).padStart(2, "0")}
                  </span>
                </button>

                <button
                  className={styles.stageLabel}
                  type="button"
                  tabIndex={-1}
                  aria-label={`Go to stage ${stage.order}: ${stage.title}`}
                  onClick={() => selectStage(stage.id)}
                >
                  <span>{String(stage.order).padStart(2, "0")}</span>
                  <strong>{stage.title}</strong>
                  <small>{stage.timeLabel}</small>
                </button>

                {lens === "discovery" && discoveryCount > 0 && (
                  <span className={styles.lensBeacon} title={`${discoveryCount} discovery milestones`}>
                    ✦ {discoveryCount}
                  </span>
                )}
                {lens === "evidence" && evidenceCount > 0 && (
                  <span className={styles.lensBeacon} title={`${evidenceCount} evidence records`}>
                    ◆ {evidenceCount}
                  </span>
                )}

                {stageNodes.slice(1).map((node, index) => {
                  const position = nodePosition(stage.id, index);
                  const branchStyle: BranchStyle = {
                    "--node-accent": stage.accent,
                    "--node-x": `${position.x}px`,
                    "--node-y": `${position.y}px`,
                  };
                  const lensAvailable =
                    lens === "formation" ||
                    (lens === "structure" &&
                      Boolean(node.structure?.parts?.length || node.structure?.systems?.length)) ||
                    (lens === "discovery" && Boolean(node.discovery?.length)) ||
                    (lens === "evidence" && Boolean(node.evidence?.length));

                  return (
                    <button
                      className={styles.branchNode}
                      data-active={node.id === focusedNodeId}
                      data-available={lensAvailable}
                      id={`atlas-map-node-${node.id}`}
                      key={node.id}
                      style={branchStyle}
                      type="button"
                      aria-label={`${node.title}, ${humanize(node.kind)}, stage ${stage.order}`}
                      aria-describedby={
                        focusedNodeId === node.id ? `atlas-map-detail-${node.id}` : undefined
                      }
                      onClick={() => selectNode(node.id)}
                    >
                      <span className={styles.branchGlyph} aria-hidden="true">
                        {LENS_SYMBOL[lens]}
                      </span>
                      <strong>{node.title}</strong>
                    </button>
                  );
                })}

                {primaryNode && focusedNodeId === primaryNode.id && (
                  <span className={styles.stageFocusRing} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>

        {showGuide && (
          <div className={styles.gestureGuide}>
            <span aria-hidden="true">↔</span>
            Drag to travel <b>·</b> zoom to reveal
          </div>
        )}

        <div className={styles.zoomControls} aria-label="Map zoom controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
            −
          </button>
          <button type="button" aria-label="Fit entire Atlas map" onClick={fitMap}>
            Fit
          </button>
        </div>

        <label className={styles.mobileStageSelector}>
          <span>{String(activeStage.order).padStart(2, "0")}</span>
          <select
            aria-label="Choose developmental stage"
            value={activeStageId}
            onChange={(event) => selectStage(event.target.value)}
          >
            {snapshot.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {String(stage.order).padStart(2, "0")} — {stage.title}
              </option>
            ))}
          </select>
        </label>

        <aside className={styles.mapIndex} aria-label="Atlas overview and stage index">
          <button
            className={styles.minimap}
            type="button"
            aria-label="Move to a point on the overview map"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleMinimapPointer}
          >
            <span className={styles.minimapImage} aria-hidden="true" />
            <span className={styles.minimapViewport} style={minimapViewportStyle} aria-hidden="true" />
            {snapshot.stages.map((stage) => {
              const placement = ATLAS_MAP_STAGE_PLACEMENTS[stage.id];
              const dotStyle = {
                left: `${(placement.x / ATLAS_MAP_WIDTH) * 100}%`,
                top: `${(placement.y / ATLAS_MAP_HEIGHT) * 100}%`,
              };
              return (
                <span
                  className={styles.minimapDot}
                  data-active={stage.id === activeStageId}
                  key={stage.id}
                  style={dotStyle}
                  aria-hidden="true"
                />
              );
            })}
          </button>

          <ol className={styles.stageIndex}>
            {snapshot.stages.map((stage) => (
              <li key={stage.id}>
                <button
                  type="button"
                  data-active={stage.id === activeStageId}
                  aria-current={stage.id === activeStageId ? "step" : undefined}
                  onClick={() => selectStage(stage.id)}
                >
                  <span>{String(stage.order).padStart(2, "0")}</span>
                  <strong>{stage.title}</strong>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      {focusedNode && (
        <aside
          className={styles.detailPlate}
          id={`atlas-map-detail-${focusedNode.id}`}
          aria-labelledby={`atlas-map-detail-title-${focusedNode.id}`}
        >
          <button
            className={styles.detailClose}
            type="button"
            aria-label="Close node detail"
            onClick={closeNodeFocus}
          >
            ×
          </button>
          <div className={styles.detailHeader}>
            <span>
              {String(activeStage.order).padStart(2, "0")} / {humanize(focusedNode.kind)}
            </span>
            <h2 id={`atlas-map-detail-title-${focusedNode.id}`}>{focusedNode.title}</h2>
            <time>{focusedNode.time?.label ?? activeStage.timeLabel}</time>
          </div>
          <p className={styles.detailSummary}>{focusedNode.summary}</p>

          {lens === "formation" && (
            <div className={styles.formationStrip}>
              <section>
                <small>BEFORE</small>
                {firstItems(focusedNode.formation.prerequisites).map((item) => (
                  <span key={item}>{item}</span>
                ))}
                {!focusedNode.formation.prerequisites.length && <span>represented root</span>}
              </section>
              <b aria-hidden="true">→</b>
              <section>
                <small>CHANGE</small>
                <span>{focusedNode.formation.transition}</span>
              </section>
              <b aria-hidden="true">→</b>
              <section>
                <small>NEW</small>
                {firstItems(focusedNode.formation.newlyPossible).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </section>
            </div>
          )}

          {lens === "structure" && (
            <div className={styles.structureStrip}>
              <section>
                <small>COMPOSED OF</small>
                {firstItems(focusedNode.structure?.parts, 3).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </section>
              <section>
                <small>ORGANIZED AS</small>
                {firstItems(focusedNode.structure?.systems, 3).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </section>
            </div>
          )}

          {lens === "discovery" && (
            <div className={styles.milestoneStrip}>
              {focusedNode.discovery?.slice(0, 3).map((milestone) => (
                <section key={milestone.id}>
                  <small>{milestone.dateLabel ?? "Discovery"}</small>
                  <strong>{milestone.label}</strong>
                  {milestone.people?.length && <span>{milestone.people.join(" · ")}</span>}
                </section>
              ))}
              {!focusedNode.discovery?.length && <span>No discovery marker in this snapshot.</span>}
            </div>
          )}

          {lens === "evidence" && (
            <div className={styles.milestoneStrip}>
              {focusedNode.evidence?.slice(0, 3).map((item) => (
                <section key={item.id}>
                  <small>EVIDENCE</small>
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noreferrer">
                      {item.label}
                    </a>
                  ) : (
                    <strong>{item.label}</strong>
                  )}
                  {item.sourceId && <span>{item.sourceId}</span>}
                </section>
              ))}
              {!focusedNode.evidence?.length && <span>No evidence record in this snapshot.</span>}
            </div>
          )}
        </aside>
      )}

      <div className={styles.stageAnnouncement} aria-live="polite">
        Stage {activeStage.order}: {activeStage.title}
      </div>

      {searchOpen && (
        <AtlasSearchPalette
          nodes={snapshot.nodes}
          stages={snapshot.stages}
          onClose={closeSearch}
          onSelect={(nodeId) => {
            closeSearch(false);
            selectNode(nodeId);
          }}
        />
      )}
    </main>
  );
}
