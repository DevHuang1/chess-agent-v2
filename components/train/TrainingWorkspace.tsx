"use client";

/**
 * TrainingWorkspace — the Train tab's entry hub and screen switcher.
 *
 * Owns lazy puzzle loading and routes the hub into rush, quizzes, the position
 * library, mistake review, and progress.
 * Progress state itself lives in page.tsx so the header badge stays live.
 */

import { useEffect, useState } from "react";
import type { Puzzle } from "@/lib/puzzles";
import {
  levelFromXp,
  maxRatingForLevel,
  progressLevel,
  recordAnalyzedGame,
  recordLessonAttempt,
  tierForLevel,
  xpForLevel,
  type PuzzleProgress,
} from "@/lib/puzzleProgress";
import { EMOTION_EMOJI } from "@/lib/emotionClassifier";
import type { EmotionLabel } from "@/lib/engineProfiles";
import PuzzleRush from "./PuzzleRush";
import PositionTraining from "./PositionTraining";
import ProgressView from "./ProgressView";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type View = "hub" | "rush" | "learn" | "quiz" | "review" | "progress";

export default function TrainingWorkspace({
  progress,
  emotion,
  onProgressUpdate,
  onPlayFromPosition,
}: {
  progress: PuzzleProgress;
  emotion: EmotionLabel;
  onProgressUpdate: (next: PuzzleProgress) => void;
  onPlayFromPosition: (fen: string) => void;
}) {
  const [view, setView] = useState<View>("hub");
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [puzzleLoadError, setPuzzleLoadError] = useState<string | null>(null);

  // Load the puzzle set lazily — only when Rush is first opened.
  useEffect(() => {
    if (view === "rush" && !puzzles) {
      import("@/lib/puzzles")
        .then((mod) => mod.loadPuzzles())
        .then((loaded) => {
          setPuzzleLoadError(null);
          setPuzzles(loaded);
        })
        .catch((error: unknown) =>
          setPuzzleLoadError(
            error instanceof Error ? error.message : "Unable to load puzzles.",
          ),
        );
    }
  }, [view, puzzles]);

  const curveLevel = levelFromXp(progress.xp);
  const level = progressLevel(progress);
  const tier = tierForLevel(level);
  const xpIntoLevel = progress.xp - xpForLevel(curveLevel);
  const xpForNext = Math.max(
    1,
    xpForLevel(curveLevel + 1) - xpForLevel(curveLevel),
  );

  if (view === "rush") {
    return puzzleLoadError ? (
      <CenteredMessage>
        <div className="text-center">
          <p className="text-red-300">Puzzle set could not be loaded.</p>
          <p className="mt-1 max-w-sm text-xs">{puzzleLoadError}</p>
          <Button variant="outline" className="mt-3" onClick={() => setView("hub")}>
            Back to training
          </Button>
        </div>
      </CenteredMessage>
    ) : puzzles ? (
      <PuzzleRush
        puzzles={puzzles}
        progress={progress}
        emotion={emotion}
        onProgressUpdate={onProgressUpdate}
        onExit={() => setView("hub")}
      />
    ) : (
      <CenteredMessage>Loading puzzle set…</CenteredMessage>
    );
  }

  if (view === "learn" || view === "quiz" || view === "review") {
    return (
      <PositionTraining
        progress={progress}
        initialMode={view === "learn" ? "study" : "practice"}
        reviewOnly={view === "review"}
        onPracticeResult={(result) =>
          onProgressUpdate(recordLessonAttempt(progress, result).progress)
        }
        onPlayFromPosition={onPlayFromPosition}
        onExit={() => setView("hub")}
      />
    );
  }

  if (view === "progress") {
    return (
      <ProgressView
        progress={progress}
        onAnalyzed={() =>
          onProgressUpdate(recordAnalyzedGame(progress).progress)
        }
        onExit={() => setView("hub")}
      />
    );
  }

  // Hub
  const ringCircumference = 2 * Math.PI * 42;
  const ringProgress = Math.min(1, xpIntoLevel / xpForNext);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6">
      <div className="mb-5 self-start">
        <h2 className="font-mono text-xl font-bold train-accent-text">
          🧩 Training Arena
        </h2>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Profile card */}
        <Card className="col-span-1 flex items-center gap-4 p-5 sm:col-span-2">
          <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke="var(--panel-border)"
              strokeWidth="8"
            />
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke={tier.color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${ringProgress * ringCircumference} ${ringCircumference}`}
              transform="rotate(-90 48 48)"
            />
            <text
              x="48"
              y="54"
              textAnchor="middle"
              className="font-mono"
              fontSize="20"
              fontWeight="bold"
              fill="currentColor"
            >
              {level}
            </text>
          </svg>
          <div>
            <div className="flex items-center gap-2">
              <div className="font-mono text-lg font-bold" style={{ color: tier.color }}>
                {tier.name} · Level {level}
              </div>
              <Badge variant="muted">Lvl {level}</Badge>
            </div>
            <div className="mt-1 text-xs text-zinc-400 light:text-slate-600">
              {xpIntoLevel} / {xpForNext} XP to level {level + 1}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Puzzle ceiling: ~{maxRatingForLevel(level)} rating · Best streak 🔥
              {progress.bestStreak}
            </div>
          </div>
        </Card>

        <Card className="col-span-1 border-l-4 border-l-violet-400 p-5 sm:col-span-2">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-0">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                Today&apos;s training
              </div>
              <div className="mt-1 font-mono text-base font-bold">
                One focused position, then a short puzzle run
              </div>
              <p className="mt-1 text-xs text-zinc-400 light:text-slate-600">
                About 7 minutes · {progress.reviewLessonIds.length} position{progress.reviewLessonIds.length === 1 ? "" : "s"} waiting for review
              </p>
            </div>
            <Button
              variant="default"
              onClick={() =>
                setView(progress.reviewLessonIds.length > 0 ? "review" : "quiz")
              }
            >
              Start workout →
            </Button>
          </CardContent>
        </Card>

        <HubCard
          emoji="◇"
          title="Quiz Arena"
          description={`${progress.quizTotals.solved}/${progress.quizTotals.attempted} quizzes solved. Play the moves yourself with progressive hints.`}
          onClick={() => setView("quiz")}
        />
        <HubCard
          emoji="□"
          title="Position Library"
          description={`${progress.lessonsCompleted.length} mastered. Filter openings, endgames, attacks, and ready mating nets.`}
          onClick={() => setView("learn")}
        />
        <HubCard
          emoji="↻"
          title="Mistake Review"
          description={`${progress.reviewLessonIds.length} position${progress.reviewLessonIds.length === 1 ? "" : "s"} queued from misses and hints.`}
          onClick={() => setView("review")}
        />
        <HubCard
          emoji="⚡"
          title="Puzzle Rush"
          description={`Timed and survival modes. Bests: ${progress.bestScores.rush} / ${progress.bestScores.survival}`}
          onClick={() => {
            setPuzzleLoadError(null);
            setView("rush");
          }}
        />
        <HubCard
          emoji="↗"
          title="Progress & Analysis"
          description={`${historyCountLabel(progress)} Track quiz mastery and game accuracy.`}
          onClick={() => setView("progress")}
          wide
        />

        {/* Mood strip — Sentio twist */}
        <Card className="col-span-1 flex items-center justify-between px-5 py-4 sm:col-span-2">
          <span className="text-xs text-zinc-400 light:text-slate-600">
            Live mood (adapts puzzle difficulty when you&apos;re tense):
          </span>
          <span className="font-mono text-sm">
            {EMOTION_EMOJI[emotion]} {emotion}
          </span>
        </Card>
      </div>
    </div>
  );
}

function historyCountLabel(progress: PuzzleProgress): string {
  return progress.gamesAnalyzed > 0
    ? `${progress.gamesAnalyzed} games analyzed.`
    : "No analyses yet.";
}

function HubCard({
  emoji,
  title,
  description,
  onClick,
  wide,
}: {
  emoji: string;
  title: string;
  description: string;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer transition-transform hover:scale-[1.02] ${wide ? "sm:col-span-2" : ""}`}
    >
      <Card className="train-accent-ring h-full">
        <CardContent className="p-5">
          <div className="text-2xl">{emoji}</div>
          <div className="mt-2 font-mono text-sm font-bold">{title}</div>
          <p className="mt-1 text-xs text-zinc-400 light:text-slate-600">
            {description}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-400">
      {children}
    </div>
  );
}
