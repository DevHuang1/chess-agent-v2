"use client";

/**
 * TrainingWorkspace — the Train tab's entry hub and screen switcher.
 *
 * Owns lazy puzzle loading and renders one of four screens: the hub (level
 * profile + entry cards), Puzzle Rush, Learn positions, or Progress.
 * Progress state itself lives in page.tsx so the header badge stays live.
 */

import { useEffect, useState } from "react";
import type { Puzzle } from "@/lib/puzzles";
import {
  completeLesson,
  levelFromXp,
  maxRatingForLevel,
  recordAnalyzedGame,
  tierForLevel,
  xpForLevel,
  type PuzzleProgress,
} from "@/lib/puzzleProgress";
import { EMOTION_EMOJI } from "@/lib/emotionClassifier";
import type { EmotionLabel } from "@/lib/engineProfiles";
import PuzzleRush from "./PuzzleRush";
import LearnPositions from "./LearnPositions";
import ProgressView from "./ProgressView";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type View = "hub" | "rush" | "learn" | "progress";

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

  // Load the puzzle set lazily — only when Rush is first opened.
  useEffect(() => {
    if (view === "rush" && !puzzles) {
      import("@/lib/puzzles")
        .then((mod) => mod.loadPuzzles())
        .then(setPuzzles)
        .catch((err) => console.error("Failed to load puzzles:", err));
    }
  }, [view, puzzles]);

  const level = levelFromXp(progress.xp);
  const tier = tierForLevel(level);
  const xpIntoLevel = progress.xp - xpForLevel(level);
  const xpForNext = Math.max(1, xpForLevel(level + 1) - xpForLevel(level));

  if (view === "rush") {
    return puzzles ? (
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

  if (view === "learn") {
    return (
      <LearnPositions
        progress={progress}
        onCompleteLesson={(id) =>
          onProgressUpdate(completeLesson(progress, id).progress)
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

        <HubCard
          emoji="⚡"
          title="Puzzle Rush"
          description={`Rush the clock or survive the grind. Bests: ${progress.bestScores.rush} / ${progress.bestScores.survival}`}
          onClick={() => setView("rush")}
        />
        <HubCard
          emoji="📈"
          title="Progress & Analysis"
          description={`${historyCountLabel(progress)} Analyze games, watch your accuracy trend.`}
          onClick={() => setView("progress")}
        />
        <HubCard
          emoji="📖"
          title="Learn Positions"
          description={`${progress.lessonsCompleted.length} lessons completed. Openings, endgames, classic attacks.`}
          onClick={() => setView("learn")}
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
