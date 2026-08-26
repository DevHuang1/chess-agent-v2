"use client";

/**
 * Puzzle Rush — chess.com-style timed puzzle solving.
 *
 * Modes:
 *   - Rush:     3:00 clock, solve as many as possible
 *   - Survival: no clock, 3 strikes, difficulty ramps with your streak
 *
 * The opponent's setup move is applied automatically; the solver must play
 * the exact solution line. Wrong moves snap back with a shake and cost a
 * strike (Survival) or 5 seconds (Rush). Hints reveal the theme and halve
 * XP. When the webcam detects frustration, an "easier puzzles" toast offers
 * to lower difficulty — extending Sentio's emotion adaptivity into
 * training.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { ChessboardOptions } from "react-chessboard";
import dynamic from "next/dynamic";
import type { Puzzle } from "@/lib/puzzles";
import { pickNextPuzzle } from "@/lib/puzzles";
import {
  applySolveResult,
  markPuzzleSolved,
  maxRatingForLevel,
  recordRunScore,
  levelFromXp,
  type PuzzleProgress,
} from "@/lib/puzzleProgress";
import { EMOTION_EMOJI } from "@/lib/emotionClassifier";
import type { EmotionLabel } from "@/lib/engineProfiles";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false },
);

type Mode = "rush" | "survival";

const RUSH_DURATION_MS = 180_000;
const WRONG_MOVE_PENALTY_MS = 5_000;
const MAX_STRIKES = 3;
/** Frustration must persist this long before the ease-up toast appears. */
const FRUSTRATION_HOLD_MS = 1_500;

/**
 * Smooths a jittery classification signal: a new value is only adopted after
 * it has held steady for `holdMs`, so single-frame spikes never reach the UI.
 */
function useStableEmotion(
  emotion: EmotionLabel,
  holdMs: number,
): EmotionLabel {
  const [stable, setStable] = useState<EmotionLabel>(emotion);
  useEffect(() => {
    if (emotion === stable) return;
    const t = window.setTimeout(() => setStable(emotion), holdMs);
    // Emotion flipped back before the hold elapsed — cancel the adoption.
    return () => window.clearTimeout(t);
  }, [emotion, stable, holdMs]);
  return stable;
}

function uciToMove(uci: string): {
  from: string;
  to: string;
  promotion?: string;
} {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length === 5 ? uci[4] : undefined,
  };
}

export default function PuzzleRush({
  puzzles,
  progress,
  emotion,
  onProgressUpdate,
  onExit,
}: {
  puzzles: Puzzle[];
  progress: PuzzleProgress;
  emotion: EmotionLabel;
  onProgressUpdate: (next: PuzzleProgress) => void;
  onExit: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [runKey, setRunKey] = useState(0);

  if (!mode) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <button
          type="button"
          onClick={onExit}
          className="self-start rounded-md border border-zinc-700/60 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 light:border-slate-300 light:text-slate-600"
        >
          ← Back
        </button>
        <h2 className="font-mono text-xl font-bold train-accent-text">
          Puzzle Rush
        </h2>
        <div className="flex gap-4">
          <ModeCard
            title="⏱ Rush"
            description="3 minutes. Solve as many as you can."
            best={progress.bestScores.rush}
            onSelect={() => setMode("rush")}
          />
          <ModeCard
            title="♥ Survival"
            description={`${MAX_STRIKES} strikes. Difficulty ramps up.`}
            best={progress.bestScores.survival}
            onSelect={() => setMode("survival")}
          />
        </div>
      </div>
    );
  }

  return (
    <PuzzleRushRun
      key={runKey}
      mode={mode}
      puzzles={puzzles}
      progress={progress}
      emotion={emotion}
      onProgressUpdate={onProgressUpdate}
      onQuit={() => {
        setMode(null);
        setRunKey((k) => k + 1);
      }}
    />
  );
}

function ModeCard({
  title,
  description,
  best,
  onSelect,
}: {
  title: string;
  description: string;
  best: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="train-panel train-accent-ring w-56 rounded-xl p-5 text-left transition-transform hover:scale-[1.02]"
    >
      <div className="font-mono text-lg font-bold">{title}</div>
      <p className="mt-1 text-xs text-zinc-400 light:text-slate-600">
        {description}
      </p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500 light:text-slate-500">
        Best: {best}
      </p>
    </button>
  );
}

function PuzzleRushRun({
  mode,
  puzzles,
  progress,
  emotion,
  onProgressUpdate,
  onQuit,
}: {
  mode: Mode;
  puzzles: Puzzle[];
  progress: PuzzleProgress;
  emotion: EmotionLabel;
  onProgressUpdate: (next: PuzzleProgress) => void;
  onQuit: () => void;
}) {
  const [timeLeftMs, setTimeLeftMs] = useState(RUSH_DURATION_MS);
  // Wall-clock anchor for the Rush countdown (immune to interval throttling).
  // 0 = not yet anchored; set once in the clock effect, never during render.
  const deadlineRef = useRef(0);
  const [strikes, setStrikes] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [xpThisRun, setXpThisRun] = useState(0);
  const [shake, setShake] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [hintRevealed, setHintRevealed] = useState(false);
  const [usedHintThisPuzzle, setUsedHintThisPuzzle] = useState(false);
  const [xpPop, setXpPop] = useState<number | null>(null);
  const [leveledUpNow, setLeveledUpNow] = useState(false);
  const [easeMode, setEaseMode] = useState(false);

  // Run-local mirror of progress so summary + streaks stay consistent even
  // while the parent re-renders.
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const solvedIdsRef = useRef<Set<string>>(
    new Set(progress.solvedIds), // Persisted dedup: no instant re-seen puzzles.
  );
  const stepRef = useRef(0); // index into playerMovesUci
  const boardChessRef = useRef(new Chess());
  const [boardFen, setBoardFen] = useState("");
  const [current, setCurrent] = useState<Puzzle | null>(null);
  const [finished, setFinished] = useState<{ newBest: boolean } | null>(null);

  const level = levelFromXp(progress.xp);
  const maxRating = useMemo(
    () => (easeMode ? Math.max(800, maxRatingForLevel(level) - 350) : maxRatingForLevel(level)),
    [level, easeMode],
  );

  /**
   * Load a fresh puzzle: apply the opponent setup move, orient the board.
   * Corrupt dataset rows are blacklisted and skipped (bounded retries).
   */
  const loadNext = useCallback(() => {
    const tryLoad = (attempts: number): void => {
      if (attempts > 5) {
        setFinished({ newBest: false });
        return;
      }
      const next = pickNextPuzzle({
        puzzles,
        maxRating,
        themeStats: progressRef.current.themeStats,
        excludeIds: solvedIdsRef.current,
      });
      if (!next) {
        setFinished({ newBest: false });
        return;
      }
      try {
        const chess = new Chess(next.fen);
        chess.move(uciToMove(next.opponentMoveUci));
        boardChessRef.current = chess;
        stepRef.current = 0;
        setCurrent(next);
        setBoardFen(chess.fen());
        setHintRevealed(false);
        setUsedHintThisPuzzle(false);
      } catch {
        solvedIdsRef.current.add(next.id);
        tryLoad(attempts + 1);
      }
    };
    tryLoad(0);
  }, [puzzles, maxRating]);

  // Initial load (deferred so state updates don't cascade inside the effect).
  useEffect(() => {
    const t = window.setTimeout(loadNext, 0);
    return () => window.clearTimeout(t);
  }, [loadNext]);

  // Clock (Rush only). Anchored to a wall-clock deadline so throttled
  // background tabs can't stretch or pause the run.
  useEffect(() => {
    if (mode !== "rush" || finished) return;
    if (deadlineRef.current === 0) {
      deadlineRef.current = Date.now() + RUSH_DURATION_MS;
    }
    const id = window.setInterval(() => {
      setTimeLeftMs(Math.max(0, deadlineRef.current - Date.now()));
      if (deadlineRef.current - Date.now() <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [mode, finished]);

  const finishRun = useCallback(() => {
    const recorded = recordRunScore(progressRef.current, mode, solvedCount);
    progressRef.current = recorded.progress;
    onProgressUpdate(recorded.progress);
    setFinished({ newBest: recorded.newBest });
  }, [mode, solvedCount, onProgressUpdate]);

  // End conditions.
  useEffect(() => {
    if (finished) return;
    if (mode === "survival" && strikes >= MAX_STRIKES) finishRun();
  }, [mode, strikes, finished, finishRun]);
  useEffect(() => {
    if (mode === "rush" && timeLeftMs === 0 && !finished) finishRun();
  }, [mode, timeLeftMs, finished, finishRun]);

  // Frustration → offer easier puzzles. The raw signal is debounced so a
  // single jittery frame can't pop the toast; dismissed stays dismissed for
  // the rest of the run. Derived state — no effect needed.
  const [easeDismissed, setEaseDismissed] = useState(false);
  const stableEmotion = useStableEmotion(emotion, FRUSTRATION_HOLD_MS);
  const easeOffered =
    stableEmotion === "frustrated" && !easeMode && !easeDismissed;

  const handleSolved = useCallback(() => {
    if (!current) return;
    const outcome = applySolveResult(progressRef.current, {
      rating: current.rating,
      solved: true,
      usedHint: usedHintThisPuzzle,
      theme: current.primaryTheme,
    });
    progressRef.current = markPuzzleSolved(outcome.progress, current.id);
    onProgressUpdate(progressRef.current);
    solvedIdsRef.current.add(current.id);
    setSolvedCount((n) => n + 1);
    setXpThisRun((xp) => xp + outcome.xpGained);
    setXpPop(outcome.xpGained);
    setPulse(true);
    window.setTimeout(() => setPulse(false), 650);
    window.setTimeout(() => setXpPop(null), 1100);
    if (outcome.leveledUp) setLeveledUpNow(true);
    window.setTimeout(() => setLeveledUpNow(false), 2600);
    window.setTimeout(loadNext, 850);
  }, [current, usedHintThisPuzzle, onProgressUpdate, loadNext]);

  const handleWrong = useCallback(() => {
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
    // Only the FIRST wrong move counts the attempt as failed for stats.
    if (current && stepRef.current === 0) {
      const outcome = applySolveResult(progressRef.current, {
        rating: current.rating,
        solved: false,
        usedHint: usedHintThisPuzzle,
        theme: current.primaryTheme,
      });
      progressRef.current = outcome.progress;
      onProgressUpdate(outcome.progress);
    }
    if (mode === "survival") {
      setStrikes((s) => s + 1);
    } else {
      // Pull the wall-clock deadline in; state catches up on the next tick.
      deadlineRef.current -= WRONG_MOVE_PENALTY_MS;
      setTimeLeftMs(Math.max(0, deadlineRef.current - Date.now()));
    }
  }, [current, mode, onProgressUpdate, usedHintThisPuzzle]);

  const onDrop = useCallback(
    (sourceSquare: string, targetSquare: string): boolean => {
      if (!current || finished) return false;
      const expectedUci = current.playerMovesUci[stepRef.current];
      const chess = boardChessRef.current;

      let applied;
      try {
        applied = chess.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q",
        });
      } catch {
        return false; // Illegal — react-chessboard snaps back.
      }

      const playedUci = `${applied.from}${applied.to}${applied.promotion ?? ""}`;
      if (playedUci === expectedUci || expectedUci.startsWith(playedUci)) {
        setBoardFen(chess.fen());
        stepRef.current += 1;
        if (stepRef.current >= current.playerMovesUci.length) {
          handleSolved();
        } else {
          // Auto-play the opponent's reply along the solution line.
          const replyUci = current.playerMovesUci[stepRef.current];
          window.setTimeout(() => {
            try {
              const reply = chess.move(uciToMove(replyUci));
              void reply;
              stepRef.current += 1;
              setBoardFen(chess.fen());
            } catch {
              handleSolved(); // Defensive: trust the validated line.
            }
          }, 380);
        }
        return true;
      }

      // Wrong move — undo locally so the position stays on the puzzle.
      chess.undo();
      handleWrong();
      return false;
    },
    [current, finished, handleSolved, handleWrong],
  );

  const boardOptions: ChessboardOptions = useMemo(
    () => ({
      position: boardFen,
      boardOrientation:
        current?.solverColor === "b" ? "black" : "white",
      onPieceDrop: ({ sourceSquare, targetSquare }) => {
        if (!sourceSquare || !targetSquare) return false;
        return onDrop(sourceSquare, targetSquare);
      },
      allowDragging: !finished,
      animationDurationInMs: 180,
      showNotation: true,
      darkSquareStyle: { backgroundColor: "var(--sentio-board-dark)" },
      lightSquareStyle: { backgroundColor: "var(--sentio-board-light)" },
      boardStyle: { touchAction: "none" },
    }),
    [boardFen, current, onDrop, finished],
  );

  // Keyboard shortcuts: H hint · Enter skip.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (finished) return;
      if (e.key.toLowerCase() === "h") {
        setHintRevealed(true);
        setUsedHintThisPuzzle(true);
      }
      if (e.key === "Enter") loadNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [finished, loadNext]);

  if (finished) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <h2 className="font-mono text-2xl font-bold">Run complete</h2>
        <div className="train-panel-raised rounded-xl px-8 py-6 text-center">
          <div className="font-mono text-5xl font-bold text-emerald-400">
            {solvedCount}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500 light:text-slate-500">
            puzzles solved · +{xpThisRun} XP
          </div>
          {finished.newBest && (
            <div className="mt-2 text-sm font-bold text-amber-400">
              ★ New personal best!
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onQuit}
          className="rounded-lg bg-violet-500/20 px-6 py-2 text-sm font-semibold text-violet-300 hover:bg-violet-500/30 light:bg-violet-100 light:text-violet-700"
        >
          Back to modes
        </button>
      </div>
    );
  }

  const minutes = Math.floor(timeLeftMs / 60_000);
  const seconds = Math.floor((timeLeftMs % 60_000) / 1000);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row lg:items-start lg:justify-center lg:overflow-hidden">
      {/* Left rail: quit + clock/strikes + score */}
      <div className="flex shrink-0 items-center justify-between gap-3 lg:w-48 lg:flex-col lg:items-stretch">
        <button
          type="button"
          onClick={onQuit}
          className="rounded-md border border-zinc-700/60 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 light:border-slate-300 light:text-slate-600"
        >
          ← Quit
        </button>
        {mode === "rush" ? (
          <div className="train-panel rounded-xl px-4 py-3 text-center lg:py-5">
            <div
              className={`font-mono text-3xl font-bold ${timeLeftMs < 30_000 ? "text-red-400" : ""}`}
            >
              {minutes}:{String(seconds).padStart(2, "0")}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              time left
            </div>
          </div>
        ) : (
          <div className="train-panel rounded-xl px-4 py-3 text-center lg:py-5">
            <div className="text-xl tracking-widest">
              {"♥".repeat(Math.max(0, MAX_STRIKES - strikes))}
              <span className="opacity-25">{"♥".repeat(strikes)}</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              strikes
            </div>
          </div>
        )}
        <div className="train-panel rounded-xl px-4 py-3 text-center lg:py-5">
          <div className="font-mono text-3xl font-bold text-violet-300 light:text-violet-700">
            {solvedCount}
          </div>
          <div className="whitespace-nowrap text-[10px] uppercase tracking-wider text-zinc-500">
            solved · 🔥{progress.currentStreak}
          </div>
        </div>
      </div>

      {/* Board */}
      <div
        aria-label="Puzzle board. Find the best move."
        role="group"
        className={`relative mx-auto w-full max-w-[520px] shrink-0 overflow-hidden rounded-xl ${shake ? "train-shake" : ""} ${pulse ? "train-solve-pulse" : ""}`}
      >
        <Chessboard options={boardOptions} />
        {xpPop !== null && (
          <div
            role="status"
            aria-live="polite"
            className="train-xp-pop pointer-events-none absolute right-3 top-3 rounded-lg bg-emerald-500/25 px-3 py-1 font-mono text-lg font-bold text-emerald-300"
          >
            +{xpPop} XP
          </div>
        )}
      </div>

      {/* Right rail: puzzle meta, hint/skip, emotion toast, level-up */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-56">
        <div className="train-panel rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Find the best move for{" "}
            {current?.solverColor === "b" ? "Black" : "White"}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
              rating ~{current?.rating ?? "?"}
            </span>
            <span className="text-xs">
              {EMOTION_EMOJI[emotion]} {emotion}
            </span>
          </div>
          <div className="mt-2 min-h-5 text-xs text-sky-300">
            {hintRevealed ? `Theme: ${current?.primaryTheme}` : ""}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setHintRevealed(true);
                setUsedHintThisPuzzle(true);
              }}
              className="flex-1 rounded-md border border-zinc-700/60 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500/50 light:border-slate-300 light:text-slate-700"
              title="Reveal the theme (H)"
            >
              💡 Hint
            </button>
            <button
              type="button"
              onClick={loadNext}
              className="flex-1 rounded-md border border-zinc-700/60 px-2 py-1 text-xs text-zinc-300 hover:border-violet-500/50 light:border-slate-300 light:text-slate-700"
              title="Skip this puzzle (Enter)"
            >
              Skip
            </button>
          </div>
        </div>

        {easeOffered && (
          <div
            role="alert"
            className="train-panel rounded-xl border-l-4 border-l-orange-400 p-3 text-xs"
          >
            <p className="text-zinc-300">
              Looking a bit tense — want easier puzzles?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEaseMode(true);
                  setEaseDismissed(true);
                }}
                className="rounded bg-orange-400/20 px-2 py-1 font-semibold text-orange-300"
              >
                Ease up
              </button>
              <button
                type="button"
                onClick={() => setEaseDismissed(true)}
                className="rounded px-2 py-1 text-zinc-400 hover:text-zinc-200"
              >
                No thanks
              </button>
            </div>
          </div>
        )}

        {leveledUpNow && (
          <div
            role="status"
            className="train-level-up-badge rounded-xl bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 p-4 text-center"
          >
            <div className="text-2xl">🏆</div>
            <div className="font-mono text-sm font-bold text-violet-200">
              Level up!
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

