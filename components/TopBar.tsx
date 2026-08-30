"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { PIECE_DESIGNS, type PieceDesignKey } from "@/components/pieces";
import type { EngineProfile } from "@/lib/gameTypes";
import type { EmotionLabel } from "@/lib/engineProfiles";
import type { PuzzleProgress } from "@/lib/puzzleProgress";
import { levelFromXp, tierForLevel } from "@/lib/puzzleProgress";

export interface TopBarProps {
  workspaceTab: "board" | "train";
  setWorkspaceTab: (tab: "board" | "train") => void;
  emotionMode: "auto" | "manual";
  setEmotionMode: (mode: "auto" | "manual") => void;
  emotion: EmotionLabel;
  setEmotion: (e: EmotionLabel) => void;
  engineProfile: EngineProfile;
  pieceDesign: PieceDesignKey;
  setPieceDesign: (d: PieceDesignKey) => void;
  soundMuted: boolean;
  setSoundMuted: (muted: boolean) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  isBotThinking: boolean;
  trainProgress: PuzzleProgress;
  progressLoaded: boolean;
}

export default function TopBar({
  workspaceTab,
  setWorkspaceTab,
  emotionMode,
  setEmotionMode,
  emotion,
  setEmotion,
  engineProfile,
  pieceDesign,
  setPieceDesign,
  soundMuted,
  setSoundMuted,
  theme,
  setTheme,
  isBotThinking,
  trainProgress,
  progressLoaded,
}: TopBarProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-800/80 bg-zinc-950/80 px-3 py-2 shadow-sm backdrop-blur-md lg:flex-nowrap lg:px-5 dark:bg-zinc-950/80 light:bg-white/90 light:border-slate-200">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)] animate-pulse" />
        <span className="font-mono text-base font-bold tracking-tight text-amber-500 dark:text-amber-400">
          Sentio
        </span>
      </div>

      <nav
        className="workspace-nav z-50 flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-1 light:border-slate-300 light:bg-slate-100"
        aria-label="Workspace navigation"
      >
        <Button
          variant={workspaceTab === "board" ? "accent" : "ghost"}
          size="sm"
          aria-current={workspaceTab === "board" ? "page" : undefined}
                    onClick={() => setWorkspaceTab("board")}
        >
          Board
        </Button>
        <Button
          variant={workspaceTab === "train" ? "accent" : "ghost"}
          size="sm"
          aria-current={workspaceTab === "train" ? "page" : undefined}
          onClick={() => setWorkspaceTab("train")}
          className="train-accent-ring"
        >
          🧩 Train
        </Button>
      </nav>

      <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

      <div className="flex items-center gap-2 text-xs">
        <span className="hidden font-medium text-zinc-500 md:inline dark:text-zinc-400 light:text-slate-600">
          Emotion:
        </span>
        <Select
          value={emotionMode}
          onValueChange={(v) => setEmotionMode(v as "auto" | "manual")}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs border-zinc-800 bg-zinc-900/90 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 light:bg-slate-100 light:border-slate-300 light:text-slate-800">
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (Webcam)</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={emotion}
          onValueChange={(v) => setEmotion(v as EmotionLabel)}
        >
          <SelectTrigger
            className="w-[120px] h-8 text-xs border-zinc-800 bg-zinc-900/90 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 light:bg-slate-100 light:border-slate-300 light:text-slate-800 disabled:opacity-40"
            disabled={emotionMode === "auto"}
          >
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="calm">Calm</SelectItem>
            <SelectItem value="focused">Focused</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="frustrated">Frustrated</SelectItem>
            <SelectItem value="stressed">Stressed</SelectItem>
            <SelectItem value="confident">Confident</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

      <div className="flex items-center gap-2 text-xs">
        <span className="hidden font-medium text-zinc-500 md:inline dark:text-zinc-400 light:text-slate-600">
          Bot Profile:
        </span>
        <Badge variant="accent" className="capitalize">
          {engineProfile.emotion}
        </Badge>
        {progressLoaded && (
          <Badge
            variant="outline"
            className="font-mono text-[10px]"
            style={{ color: tierForLevel(levelFromXp(trainProgress.xp)).color }}
            title={`Training level ${levelFromXp(trainProgress.xp)} · ${trainProgress.xp} XP`}
          >
            🏅 Lv {levelFromXp(trainProgress.xp)}
          </Badge>
        )}
        <Badge variant="muted" className="font-mono font-semibold">
          {engineProfile.elo} ELO
        </Badge>
        <span className="hidden text-zinc-500 lg:inline dark:text-zinc-400 light:text-slate-500">
          d:{engineProfile.depth}
        </span>
        {isBotThinking && (
          <span className="text-amber-500 dark:text-amber-400 animate-pulse font-medium">
            Thinking...
          </span>
        )}
      </div>

      <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

      <div className="flex items-center gap-2 text-xs">
        <span className="hidden font-medium text-zinc-500 md:inline dark:text-zinc-400 light:text-slate-600">
          Pieces:
        </span>
        <Select
          value={pieceDesign}
          onValueChange={(v) => setPieceDesign(v as PieceDesignKey)}
        >
          <SelectTrigger
            aria-label="Piece design"
            className="w-auto h-8 text-xs border-zinc-800 bg-zinc-900/90 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 light:bg-slate-100 light:border-slate-300 light:text-slate-800"
          >
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PIECE_DESIGNS).map(([key, d]) => (
              <SelectItem key={key} value={key}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            const nextMuted = !soundMuted;
            setSoundMuted(nextMuted);
          }}
          title={
            soundMuted
              ? "Sound muted — click to enable"
              : "Sound on — click to mute"
          }
          aria-label={soundMuted ? "Enable sound" : "Mute sound"}
          aria-pressed={!soundMuted}
        >
          <span
            className={`text-base leading-none ${soundMuted ? "text-rose-400" : "text-emerald-400"}`}
          >
            {soundMuted ? "🔇" : "🔊"}
          </span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={
            theme === "dark"
              ? "Switch to light mode"
              : "Switch to dark mode"
          }
          aria-label="Toggle light / dark mode"
        >
          <span className="text-base leading-none">
            {theme === "dark" ? "☀️" : "🌙"}
          </span>
        </Button>
      </div>
    </header>
  );
}
