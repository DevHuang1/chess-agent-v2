"use client";

import { Button } from "@/components/ui/button";

export interface GameOverOverlayProps {
  resultText: string;
  xpGained?: number | null;
  onPlayAgain: () => void;
  onDismiss?: () => void;
}

export default function GameOverOverlay({
  resultText,
  xpGained,
  onPlayAgain,
  onDismiss,
}: GameOverOverlayProps) {
  const isWin = resultText === "You Win!";

  return (
    <div className="fixed top-4 left-1/2 z-60 -translate-x-1/2 animate-in slide-in-from-top-4 fade-in duration-300">
      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md ${
          isWin
            ? "border-amber-500/30 bg-amber-950/80 light:border-amber-300 light:bg-amber-50"
            : "border-zinc-700/40 bg-zinc-900/80 light:border-slate-300 light:bg-white"
        }`}
      >
        <div className="flex flex-col items-center gap-0.5">
          <p
            className={`text-lg font-extrabold ${
              isWin
                ? "text-amber-400 light:text-amber-700"
                : "text-zinc-300 light:text-slate-700"
            }`}
          >
            {resultText}
          </p>
          {xpGained != null && xpGained > 0 && (
            <p className="font-mono text-xs font-bold text-emerald-400 light:text-emerald-600">
              +{xpGained} XP
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="default"
            size="sm"
            onClick={onPlayAgain}
            className="h-8 px-3 text-xs"
          >
            Play Again
          </Button>
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400"
              onClick={onDismiss}
            >
              ✕
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
