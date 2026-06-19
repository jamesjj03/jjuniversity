"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  { id: "anatomy", title: "Anatomy", label: "Body diagrams", count: "1 ready", description: "Brain, organs, systems, and structures." },
  { id: "world", title: "World", label: "Maps", count: "queued", description: "Countries, regions, rivers, and terrain." },
  { id: "history", title: "History", label: "Timelines", count: "queued", description: "Empires, wars, routes, and eras." },
  { id: "science", title: "Science", label: "Systems", count: "queued", description: "Cells, cycles, chemistry, and physics." },
  { id: "math", title: "Math", label: "Structures", count: "queued", description: "Graphs, geometry, formulas, and tools." },
  { id: "language", title: "Language", label: "Scripts", count: "queued", description: "Writing systems, grammar, and sound maps." },
];

function stableScore(id: string) {
  return id.split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 7), 0);
}

function shuffleIds(ids: string[], salt = Date.now()) {
  return [...ids]
    .map(id => ({ id, score: stableScore(`${id}:${salt}:${Math.random()}`) }))
    .sort((a, b) => a.score - b.score)
    .map(item => item.id);
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
    return fact.charAt(0).toUpperCase() + fact.slice(1);
  }

  return target.label;
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
    "aria-label": `Choose ${target.label}`,
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

export default function RecallArenaClient({ pack }: { pack: RecallPack }) {
  const [phase, setPhase] = useState<Phase>("hub");
  const [selectedCategory, setSelectedCategory] = useState<ArenaCategoryId>("anatomy");
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

  const selectedCategoryData = ARENA_CATEGORIES.find(category => category.id === selectedCategory) || ARENA_CATEGORIES[0];
  const targetMap = useMemo(() => new Map(pack.targets.map(target => [target.id, target])), [pack.targets]);
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

  function startGame(nextMode: RecallMode) {
    cancelPendingAdvance();
    window.scrollTo({ top: 0, behavior: "instant" });
    setMode(nextMode);
    setQueue(makeQueue(pack, nextMode, misses));
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
    startGame(mode);
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
    <main className={`page aboutPage recallPage recallPhase-${phase}`}>
      {phase === "hub" && (
        <section className="recallLibraryShell">
          <header className="recallLibraryTop">
            <div>
              <h1>Arena</h1>
            </div>
            <div className="recallLibraryActions" aria-label="Arena actions">
              <span>1 ready / 10 categories</span>
              <Link className="btn secondary" href="/admin/arena" prefetch={false}>Factory</Link>
            </div>
          </header>

          <div className="recallLibraryLayout">
            <aside className="recallCategoryRail" aria-label="Arena categories">
              {ARENA_CATEGORIES.map(category => (
                <button
                  className={selectedCategory === category.id ? "active" : ""}
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <strong>{category.title}</strong>
                  <span>{category.label}</span>
                  <em>{category.count}</em>
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
                  <article className="recallPackRow">
                    <div className="recallPackRowMain">
                      <span className="recallPackThumb" aria-hidden="true">01</span>
                      <div>
                        <p className="kicker">{pack.domain}</p>
                        <h3>{pack.title}</h3>
                        <p>{pack.targets.length} targets / Chaos, Function, Review</p>
                      </div>
                    </div>
                    <div className="recallPackRowMeta">
                      <span>prototype</span>
                      <span>{pack.targets.length} targets</span>
                    </div>
                    <button className="btn primary" type="button" onClick={() => startGame("find")}>Start</button>
                  </article>
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

                <article className="recallPackRow draft">
                  <div className="recallPackRowMain">
                    <span className="recallPackThumb" aria-hidden="true">DF</span>
                    <div>
                      <p className="kicker">Factory</p>
                      <h3>Brain Sagittal Source</h3>
                      <p>Real sourced SVG imported; targets proposed; blocked for review.</p>
                    </div>
                  </div>
                  <div className="recallPackRowMeta">
                    <span>draft</span>
                    <span>4 proposed</span>
                  </div>
                  <Link className="btn secondary" href="/admin/arena" prefetch={false}>Factory</Link>
                </article>
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
              <h2>{accuracy}% accuracy.</h2>
              <p>{formatElapsed(elapsedSeconds)}. {missTotal ? `${missTotal} misses are waiting in Review.` : "Clean run."}</p>
              <div className="buttonRow recallDoneActions">
                <button className="btn primary" type="button" onClick={() => startGame("find")}>Run Chaos Again</button>
                <button className="btn secondary" type="button" onClick={() => startGame("review")}>Review Misses</button>
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
            <div className="recallPromptBar">
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
            {pack.modes.map(item => (
              <button className={mode === item ? "active" : ""} key={item} type="button" onClick={() => startGame(item)}>
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
                {pack.targets.map(target => renderTargetShape(target, target.shape, targetClass(target), pickTarget))}
              </g>
            </svg>
          </div>

          <footer className={`recallGameBottom ${result.kind}`}>
            <div>
              <strong>
                {result.kind === "correct" && "Correct"}
                {result.kind === "wrong" && `Still looking for ${activeTarget.label}`}
                {result.kind === "idle" && `${remaining} left`}
              </strong>
              <span>
                {result.kind === "correct" && activeTarget.functions.slice(0, 2).join(" / ")}
                {result.kind === "wrong" && "The answer is highlighted. Try that spot."}
                {result.kind === "idle" && MODE_DESCRIPTIONS[mode]}
              </span>
            </div>
            <div className="recallProgressTrack" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
            <button type="button" onClick={restartCurrentMode}>Restart</button>
          </footer>
        </section>
      )}

    </main>
  );
}
