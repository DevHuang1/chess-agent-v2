"use client";

/**
 * Learn — ready-made training positions.
 *
 * Browse curated lessons by category, step through the moves on a board
 * with narration, then either finish (XP once per lesson) or jump into a
 * live game from any position via "Play it out vs Sentio" — which reuses
 * the emotion-adaptive engine on the Board view.
 */

import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { ChessboardOptions } from "react-chessboard";
import dynamic from "next/dynamic";
import {
  LESSON_CATEGORIES,
  fenAfterSteps,
  groupByCategory,
  type Lesson,
} from "@/lib/lessons";
import type { PuzzleProgress } from "@/lib/puzzleProgress";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false },
);

export default function LearnPositions({
  progress,
  onCompleteLesson,
  onPlayFromPosition,
  onExit,
}: {
  progress: PuzzleProgress;
  onCompleteLesson: (lessonId: string) => void;
  onPlayFromPosition: (fen: string) => void;
  onExit: () => void;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [category, setCategory] =
    useState<(typeof LESSON_CATEGORIES)[number]["key"]>("openings");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(false);

  useEffect(() => {
    import("@/lib/lessons")
      .then((mod) => mod.loadLessons())
      .then(setLessons)
      .catch((err) => console.error("Failed to load lessons:", err));
  }, []);

  const grouped = useMemo(
    () => (lessons ? groupByCategory(lessons) : {}),
    [lessons],
  );
  const lesson = useMemo(
    () => grouped[category]?.find((l) => l.id === selectedId) ?? null,
    [grouped, category, selectedId],
  );

  // Auto-play stepping (no-op once the line is exhausted).
  useEffect(() => {
    if (!autoPlaying || !lesson || stepIndex >= lesson.steps.length) return;
    const id = window.setTimeout(() => setStepIndex((s) => s + 1), 900);
    return () => window.clearTimeout(id);
  }, [autoPlaying, stepIndex, lesson]);

  const fen = lesson ? fenAfterSteps(lesson, stepIndex) : "";
  const atEnd = lesson !== null && stepIndex >= lesson.steps.length;

  const boardOptions: ChessboardOptions = useMemo(
    () => ({
      position: fen,
      boardOrientation: fen.split(" ")[1] === "b" ? "black" : "white",
      allowDragging: false,
      showNotation: true,
      darkSquareStyle: { backgroundColor: "var(--sentio-board-dark)" },
      lightSquareStyle: { backgroundColor: "var(--sentio-board-light)" },
      boardStyle: { touchAction: "none" },
    }),
    [fen],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onExit}
          className="rounded-md border border-zinc-700/60 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 light:border-slate-300 light:text-slate-600"
        >
          ← Back
        </button>
        <h2 className="font-mono text-lg font-bold train-accent-text">
          📖 Learn Positions
        </h2>
        <div className="flex gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-1 light:border-slate-300 light:bg-slate-100">
          {LESSON_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setCategory(c.key);
                setSelectedId(null);
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${category === c.key ? "bg-violet-500/20 text-violet-300 light:bg-violet-100 light:text-violet-700" : "text-zinc-500 hover:text-zinc-300 light:text-slate-500"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {!lesson ? (
        /* Lesson list */
        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pt-2 sm:grid-cols-2 xl:grid-cols-3">
          {(grouped[category] ?? []).map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setSelectedId(l.id);
                setStepIndex(0);
                setAutoPlaying(false);
              }}
              className="train-panel train-accent-ring rounded-xl p-4 text-left transition-transform hover:scale-[1.01]"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold">{l.title}</span>
                {progress.lessonsCompleted.includes(l.id) && (
                  <span className="text-emerald-400">✓</span>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-zinc-400 light:text-slate-600">
                {l.intro}
              </p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {l.steps.length} steps
              </p>
            </button>
          ))}
        </div>
      ) : (
        <StepperView
          lesson={lesson}
          stepIndex={stepIndex}
          fen={fen}
          atEnd={atEnd}
          completed={progress.lessonsCompleted.includes(lesson.id)}
          boardOptions={boardOptions}
          onStep={(next) => {
            setAutoPlaying(false);
            setStepIndex(next);
          }}
          onReplay={() => {
            setStepIndex(0);
            setAutoPlaying(true);
          }}
          onComplete={() => {
            onCompleteLesson(lesson.id);
            setStepIndex(lesson.steps.length);
          }}
          onPlayFromPosition={onPlayFromPosition}
          onBackToList={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function StepperView({
  lesson,
  stepIndex,
  fen,
  atEnd,
  completed,
  boardOptions,
  onStep,
  onReplay,
  onComplete,
  onPlayFromPosition,
  onBackToList,
}: {
  lesson: Lesson;
  stepIndex: number;
  fen: string;
  atEnd: boolean;
  completed: boolean;
  boardOptions: ChessboardOptions;
  onStep: (next: number) => void;
  onReplay: () => void;
  onComplete: () => void;
  onPlayFromPosition: (fen: string) => void;
  onBackToList: () => void;
}) {
  const terminal = fen ? new Chess(fen).isGameOver() : true;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-center lg:overflow-hidden">
      <div className="mx-auto w-full max-w-[480px] shrink-0">
        <Chessboard options={boardOptions} />
      </div>
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
        <div className="train-panel rounded-xl p-4">
          <h3 className="font-mono text-sm font-bold">{lesson.title}</h3>
          <p className="mt-2 max-h-28 overflow-y-auto text-xs leading-relaxed text-zinc-400 light:text-slate-600">
            {stepIndex === 0
              ? lesson.intro
              : lesson.steps[stepIndex - 1].narration}
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {lesson.steps.map((s, i) => (
              <span
                key={`${s.san}-${i}`}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${i < stepIndex ? "bg-violet-500/25 text-violet-200" : "bg-zinc-800/70 text-zinc-500"}`}
              >
                {s.san}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onStep(Math.max(0, stepIndex - 1))}
            disabled={stepIndex === 0}
            className="flex-1 rounded-md border border-zinc-700/60 px-2 py-1.5 text-xs text-zinc-300 disabled:opacity-40 light:border-slate-300 light:text-slate-700"
          >
            ◀ Prev
          </button>
          <button
            type="button"
            onClick={onReplay}
            className="rounded-md border border-zinc-700/60 px-2 py-1.5 text-xs text-zinc-300 light:border-slate-300 light:text-slate-700"
          >
            ▶ Replay
          </button>
          <button
            type="button"
            onClick={() => onStep(Math.min(lesson.steps.length, stepIndex + 1))}
            disabled={atEnd}
            className="flex-1 rounded-md border border-zinc-700/60 px-2 py-1.5 text-xs text-zinc-300 disabled:opacity-40 light:border-slate-300 light:text-slate-700"
          >
            Next ▶
          </button>
        </div>

        <button
          type="button"
          onClick={onComplete}
          className={`w-full rounded-lg px-3 py-2 text-xs font-semibold ${completed ? "border border-emerald-500/40 text-emerald-400" : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"}`}
        >
          {completed ? "✓ Completed" : "Mark complete (+40 XP)"}
        </button>

        {!terminal && (
          <button
            type="button"
            onClick={() => onPlayFromPosition(fen)}
            className="w-full rounded-lg bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 px-3 py-2 text-xs font-semibold text-violet-200 hover:from-violet-500/45"
          >
            ♟ Play it out vs Sentio
          </button>
        )}

        <button
          type="button"
          onClick={onBackToList}
          className="text-center text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          ← All lessons
        </button>
      </div>
    </div>
  );
}
