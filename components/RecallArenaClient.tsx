"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { RecallMode, RecallPack, RecallShape, RecallTarget } from "@/lib/recall";

type Phase = "hub" | "playing" | "complete";
type ArenaCategoryId = "anatomy" | "world" | "history" | "science" | "math" | "language";

type PickResult =
  | {
      kind: "idle";
    }
  | {
      kind: "correct";
      targetId: string;
    }
  | {
      kind: "wrong";
      targetId: string;
      pickedId: string;
    };

type CursorPrompt = {
  visible: boolean;
  x: number;
  y: number;
};

type RecallArenaClientProps = {
  packs: RecallPack[];
  variant?: "default" | "site-v2";
  factoryHref?: string | null;
};

const MODE_LABELS: Record<RecallMode, string> = {
  find: "Chaos",
  function: "Function",
  review: "Review",
};

const MODE_DESCRIPTIONS: Record<RecallMode, string> = {
  find: "Click the named target.",
  function: "Click the structure doing this job.",
  review: "Retry missed targets.",
};

const ARENA_CATEGORIES: Array<{
  id: ArenaCategoryId;
  title: string;
  label: string;
  count: string;
  description: string;
}> = [
  { id: "anatomy", title: "Anatomy", label: "Body diagrams", count: "2 ready", description: "Brain, organs, systems, and structures." },
  { id: "world", title: "World", label: "Maps", count: "queued", description: "Countries, regions, rivers, and terrain." },
  { id: "history", title: "History", label: "Timelines", count: "queued", description: "Empires, wars, routes, and eras." },
  { id: "science", title: "Science", label: "Systems", count: "queued", description: "Cells, cycles, chemistry, and physics." },
  { id: "math", title: "Math", label: "Structures", count: "queued", description: "Graphs, geometry, formulas, and tools." },
  { id: "language", title: "Language", label: "Scripts", count: "queued", description: "Writing systems, grammar, and sound maps." },
];

const TITLE_CASE_SMALL_WORDS = new Set(["and", "or", "of", "the", "to", "in", "on", "for", "with"]);

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && TITLE_CASE_SMALL_WORDS.has(lower)) return lower;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function displayLabel(target: RecallTarget) {
  return titleCase(target.label);
}

function shuffleIds(ids: string[]) {
  const next = [...ids];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function makeQueue(pack: RecallPack, mode: RecallMode, misses: Record<string, number>) {
  const modeTargets = mode === "function" ? pack.targets.filter(target => target.functions.length) : pack.targets;
  const ids = modeTargets.map(target => target.id);

  if (mode === "review") {
    const missedIds = Object.entries(misses)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id]) => id)
      .filter(id => ids.includes(id));

    return shuffleIds(missedIds.length ? missedIds : ids);
  }

  return shuffleIds(ids);
}

function promptFor(target: RecallTarget, mode: RecallMode, roundIndex: number) {
  if (mode === "function") {
    const fact = target.functions[(roundIndex + target.id.length) % target.functions.length] || target.functions[0] || target.label;
    return sentenceCase(fact);
  }

  return displayLabel(target);
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function renderTargetShape(
  target: RecallTarget,
  shape: RecallShape,
  className: string,
  onPick: (id: string) => void,
) {
  const shared = {
    className,
    tabIndex: 0,
    role: "button",
    "aria-label": `Choose ${displayLabel(target)}`,
    onClick: () => onPick(target.id),
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPick(target.id);
      }
    },
  };

  if (shape.type === "path") return <path key={target.id} d={shape.d} {...shared} />;
  if (shape.type === "circle") return <circle key={target.id} cx={shape.cx} cy={shape.cy} r={shape.r} {...shared} />;
  return <ellipse key={target.id} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...shared} />;
}

export default function RecallArenaClient({
  packs,
  variant = "default",
  factoryHref = "/admin/arena",
}: RecallArenaClientProps) {
  const PageRoot = variant === "site-v2" ? "div" : "main";
  const [phase, setPhase] = useState<Phase>("hub");
  const [selectedCategory, setSelectedCategory] = useState<ArenaCategoryId>("anatomy");
  const [activePackId, setActivePackId] = useState(packs[0]?.id || "");
  const [mode, setMode] = useState<RecallMode>("find");
  const [queue, setQueue] = useState<string[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [misses, setMisses] = useState<Record<string, number>>({});
  const [solved, setSolved] = useState<Record<string, number>>({});
  const [roundWrongPicks, setRoundWrongPicks] = useState<string[]>([]);
  const [result, setResult] = useState<PickResult>({ kind: "idle" });
  const [cursorPrompt, setCursorPrompt] = useState<CursorPrompt>({ visible: false, x: 0, y: 0 });
  const hubHeadingRef = useRef<HTMLHeadingElement>(null);
  const promptFocusRef = useRef<HTMLDivElement>(null);
  const completeHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousPhaseRef = useRef<Phase>(phase);

  const selectedCategoryData = ARENA_CATEGORIES.find(category => category.id === selectedCategory) || ARENA_CATEGORIES[0];
  const anatomyPacks = useMemo(
    () => packs.filter(item => item.category === "anatomy" || item.domain === "neuroscience"),
    [packs],
  );
  const activePack = useMemo(
    () => {
      const found = packs.find(item => item.id === activePackId) || packs[0];
      if (!found) throw new Error("RecallArenaClient requires at least one pack.");
      return found;
    },
    [activePackId, packs],
  );
  const targetMap = useMemo(() => new Map(activePack.targets.map(target => [target.id, target])), [activePack.targets]);
  const activeId = queue[roundIndex] || "";
  const activeTarget = targetMap.get(activeId);
  const prompt = activeTarget ? promptFor(activeTarget, mode, roundIndex) : "";
  const missTotal = Object.values(misses).reduce((sum, count) => sum + count, 0);
  const solvedCount = Object.keys(solved).length;
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  const remaining = Math.max(queue.length - solvedCount, 0);
  const progress = queue.length ? Math.round((solvedCount / queue.length) * 100) : 0;

  useEffect(() => {
    if (phase !== "playing") return;

    const timer = window.setInterval(() => {
      setElapsedSeconds(current => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previousPhase === phase) return;

    const frame = window.requestAnimationFrame(() => {
      if (phase === "playing") promptFocusRef.current?.focus();
      else if (phase === "complete") completeHeadingRef.current?.focus();
      else hubHeadingRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing" || result.kind !== "correct") return;

    const timer = setTimeout(() => {
      setRoundIndex(current => {
        const next = current + 1;
        if (next >= queue.length) setPhase("complete");
        return next;
      });
      setRoundWrongPicks([]);
      setResult({ kind: "idle" });
    }, 620);

    return () => clearTimeout(timer);
  }, [phase, queue.length, result]);

  function cancelPendingAdvance() {
    if (result.kind === "correct") {
      setResult({ kind: "idle" });
    }
  }

  function startGame(nextMode: RecallMode, nextPackId = activePack.id) {
    cancelPendingAdvance();
    const nextPack = packs.find(item => item.id === nextPackId) || activePack;
    window.scrollTo({ top: 0, behavior: "instant" });
    setActivePackId(nextPack.id);
    setMode(nextMode);
    setQueue(makeQueue(nextPack, nextMode, misses));
    setRoundIndex(0);
    setAttempts(0);
    setCorrect(0);
    setElapsedSeconds(0);
    setSolved({});
    setRoundWrongPicks([]);
    setResult({ kind: "idle" });
    setPhase("playing");
  }

  function restartCurrentMode() {
    startGame(mode, activePack.id);
  }

  function advanceAfterCorrect(targetId: string) {
    setResult({ kind: "correct", targetId });
  }

  function pickTarget(id: string) {
    if (!activeTarget || phase !== "playing" || result.kind === "correct") return;

    cancelPendingAdvance();
    setAttempts(value => value + 1);

    if (id === activeTarget.id) {
      setCorrect(value => value + 1);
      setSolved(current => ({ ...current, [activeTarget.id]: (current[activeTarget.id] || 0) + 1 }));
      if (mode === "review") {
        setMisses(current => {
          if (!current[activeTarget.id]) return current;
          const next = { ...current };
          delete next[activeTarget.id];
          return next;
        });
      }
      advanceAfterCorrect(activeTarget.id);
      return;
    }

    setMisses(current => ({ ...current, [activeTarget.id]: (current[activeTarget.id] || 0) + 1 }));
    setRoundWrongPicks(current => current.includes(id) ? current : [...current, id]);
    setResult({ kind: "wrong", targetId: activeTarget.id, pickedId: id });
  }

  function handleStageMove(event: MouseEvent<HTMLElement>) {
    setCursorPrompt({
      visible: phase === "playing",
      x: event.clientX,
      y: event.clientY,
    });
  }

  function targetClass(target: RecallTarget) {
    const isSolved = Boolean(solved[target.id]);
    const isCorrectFlash = result.kind === "correct" && result.targetId === target.id;
    const isWrongPick = roundWrongPicks.includes(target.id) || (result.kind === "wrong" && result.pickedId === target.id);
    const isWrongReveal = result.kind === "wrong" && result.targetId === target.id;

    return [
      "recallTargetShape",
      target.kind === "dot" ? "dotTarget" : "",
      isSolved ? "solved" : "",
      isCorrectFlash ? "correctFlash" : "",
      isWrongPick ? "wrongPick" : "",
      isWrongReveal ? "wrongReveal" : "",
    ].filter(Boolean).join(" ");
  }

  return (
    <PageRoot className={`page aboutPage recallPage recallPhase-${phase}${variant === "site-v2" ? " siteV2LabsPage" : ""}`}>
      {phase === "hub" && (
        <section className="recallLibraryShell">
          <header className="recallLibraryTop">
            <div>
              <h1 ref={hubHeadingRef} tabIndex={-1}>{variant === "site-v2" ? "Labs" : "Arena"}</h1>
              {variant === "site-v2" && <p>Short visual drills for recognition and recall.</p>}
            </div>
            <div className="recallLibraryActions" aria-label="Arena actions">
              <span>{anatomyPacks.length} ready / {ARENA_CATEGORIES.length} categories</span>
              {factoryHref && <Link className="btn secondary" href={factoryHref} prefetch={false}>Factory</Link>}
            </div>
          </header>

          <div className="recallLibraryLayout">
            <aside className="recallCategoryRail" aria-label="Arena categories">
              {ARENA_CATEGORIES.map(category => (
                <button
                  aria-pressed={selectedCategory === category.id}
                  className={selectedCategory === category.id ? "active" : ""}
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <strong>{category.title}</strong>
                  <span>{category.label}</span>
                  <em>{category.id === "anatomy" ? `${anatomyPacks.length} ready` : category.count}</em>
                </button>
              ))}
            </aside>

            <section className="recallPackPanel" aria-label="Arena packs">
              <header className="recallPackPanelTop">
                <div>
                  <p className="kicker">{selectedCategoryData.label}</p>
                  <h2>{selectedCategoryData.title}</h2>
                </div>
                <p>{selectedCategoryData.description}</p>
              </header>

              <div className="recallPackRows">
                {selectedCategory === "anatomy" ? (
                  anatomyPacks.map((item, index) => (
                    <article className="recallPackRow" key={item.id}>
                      <div className="recallPackRowMain">
                        <span className="recallPackThumb" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <p className="kicker">{item.domain}</p>
                          <h3>{item.title}</h3>
                          <p>{item.targets.length} targets / {item.diagram ? "sourced diagram" : "manual seed"}</p>
                        </div>
                      </div>
                      <div className="recallPackRowMeta">
                        <span>{item.status}</span>
                        <span>{item.targets.length} targets</span>
                      </div>
                      <button className="btn primary" type="button" onClick={() => startGame("find", item.id)}>Start</button>
                    </article>
                  ))
                ) : (
                  <article className="recallPackRow locked">
                    <div className="recallPackRowMain">
                      <span className="recallPackThumb" aria-hidden="true">--</span>
                      <div>
                        <p className="kicker">{selectedCategoryData.label}</p>
                        <h3>{selectedCategoryData.title}</h3>
                        <p>No packs published yet.</p>
                      </div>
                    </div>
                    <div className="recallPackRowMeta">
                      <span>queued</span>
                    </div>
                  </article>
                )}
              </div>
            </section>
          </div>
        </section>
      )}

      {phase === "complete" && (
        <section className="aboutPlain recallDone">
          <article className="aboutStory aboutEssay">
            <section className="aboutIntroBlock">
              <p className="kicker">Run Complete</p>
              <h2 ref={completeHeadingRef} tabIndex={-1}>{accuracy}% accuracy.</h2>
              <p>{formatElapsed(elapsedSeconds)}. {missTotal ? `${missTotal} misses are waiting in Review.` : "Clean run."}</p>
              <div className="buttonRow recallDoneActions">
                <button className="btn primary" type="button" onClick={() => startGame("find", activePack.id)}>Run Chaos Again</button>
                <button className="btn secondary" type="button" onClick={() => startGame("review", activePack.id)}>Review Misses</button>
                <button className="btn secondary" type="button" onClick={() => setPhase("hub")}>Back To Packs</button>
              </div>
            </section>
          </article>
        </section>
      )}

      {phase === "playing" && activeTarget && (
        <section className="recallGameShell" onMouseMove={handleStageMove} onMouseLeave={() => setCursorPrompt(current => ({ ...current, visible: false }))}>
          <header className="recallGameTop">
            <button className="recallExitBtn" type="button" onClick={() => {
              cancelPendingAdvance();
              setPhase("hub");
              setResult({ kind: "idle" });
            }}>
              Packs
            </button>
            <div ref={promptFocusRef} className="recallPromptBar" role="status" aria-live="polite" aria-atomic="true" tabIndex={-1}>
              <span>{MODE_LABELS[mode]}</span>
              <strong>{mode === "function" ? prompt : `Click ${prompt}`}</strong>
            </div>
            <div className="recallRunMiniStats" aria-label="Run progress">
              <span>{solvedCount}/{queue.length}</span>
              <span>{accuracy}%</span>
              <span>{formatElapsed(elapsedSeconds)}</span>
            </div>
          </header>

          <div className="recallModeRail" aria-label="Modes">
            {activePack.modes.map(item => (
              <button aria-pressed={mode === item} className={mode === item ? "active" : ""} key={item} type="button" onClick={() => startGame(item, activePack.id)}>
                <strong>{MODE_LABELS[item]}</strong>
                <span>{MODE_DESCRIPTIONS[item]}</span>
              </button>
            ))}
          </div>

          <div className="recallStage">
            {cursorPrompt.visible && (
              <div className="recallCursorPrompt" style={{ "--cursor-x": `${cursorPrompt.x}px`, "--cursor-y": `${cursorPrompt.y}px` } as CSSProperties}>
                {mode === "function" ? prompt : prompt}
              </div>
            )}

            {activePack.diagram ? (
              <svg
                className="recallDiagramSvg"
                viewBox={`0 0 ${activePack.diagram.width} ${activePack.diagram.height}`}
                aria-label={`Clickable ${activePack.title} source diagram`}
              >
                <rect className="recallDiagramMat" x="0" y="0" width={activePack.diagram.width} height={activePack.diagram.height} rx="10" />
                <image
                  className="recallDiagramSource"
                  href={activePack.diagram.imageSrc}
                  x="0"
                  y="0"
                  width={activePack.diagram.width}
                  height={activePack.diagram.height}
                  preserveAspectRatio="xMidYMid meet"
                />
                <g className="recallTargetLayer">
                  {activePack.targets.map(target => renderTargetShape(target, target.shape, targetClass(target), pickTarget))}
                </g>
              </svg>
            ) : (
              <svg className="recallBrainSvg" viewBox="80 70 680 440" aria-label="Clickable brain schematic">
                <defs>
                  <pattern id="recallFineGrid" width="22" height="22" patternUnits="userSpaceOnUse">
                    <path d="M22 0H0V22" />
                  </pattern>
                </defs>
                <rect className="recallSvgGrid" x="28" y="28" width="804" height="504" rx="18" />
                <rect className="recallSvgGridLines" x="28" y="28" width="804" height="504" rx="18" />
                <path
                  className="recallBrainBase"
                  d="M119 204 C139 100 248 51 365 86 C470 36 620 82 684 186 C741 277 713 394 616 445 C524 503 389 480 332 413 C234 434 137 376 110 295 C98 259 101 228 119 204 Z"
                />
                <path
                  className="recallBrainRidge"
                  d="M158 190 C222 152 274 156 326 190 M344 119 C392 137 423 164 443 210 M488 113 C524 146 544 183 552 229 M164 302 C226 283 282 290 337 333 M545 360 C590 348 629 357 661 392"
                />
                <g className="recallTargetLayer">
                  {activePack.targets.map(target => renderTargetShape(target, target.shape, targetClass(target), pickTarget))}
                </g>
              </svg>
            )}
          </div>

          <footer className={`recallGameBottom ${result.kind}`} role="status" aria-live="polite" aria-atomic="true">
            <div>
              <strong>
                {result.kind === "correct" && "Correct"}
                {result.kind === "wrong" && `Still looking for ${displayLabel(activeTarget)}`}
                {result.kind === "idle" && `${remaining} left`}
              </strong>
              <span>
                {result.kind === "correct" && activeTarget.functions.slice(0, 2).map(sentenceCase).join(" / ")}
                {result.kind === "wrong" && "The answer is highlighted. Try that spot."}
                {result.kind === "idle" && MODE_DESCRIPTIONS[mode]}
              </span>
            </div>
            <div className="recallProgressTrack" role="progressbar" aria-label="Drill progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
            <button type="button" onClick={restartCurrentMode}>Restart</button>
          </footer>
        </section>
      )}

    </PageRoot>
  );
}
