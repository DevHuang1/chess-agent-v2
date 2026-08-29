"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface GameOverOverlayProps {
  resultText: string;
  onPlayAgain: () => void;
}

export default function GameOverOverlay({ resultText, onPlayAgain }: GameOverOverlayProps) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-md light:bg-slate-900/60">
      <Card className="border-zinc-700 bg-zinc-900/90 p-8 text-center shadow-2xl max-w-sm w-full mx-4 light:border-slate-300 light:bg-white">
        <p className="text-3xl font-extrabold text-amber-400 mb-2 light:text-amber-700">
          {resultText}
        </p>
        <p className="text-xs text-zinc-400 mb-6 light:text-slate-600">
          Game finished. Would you like to play another round?
        </p>
        <Button
          variant="default"
          onClick={onPlayAgain}
          className="w-full"
        >
          Play Again
        </Button>
      </Card>
    </div>
  );
}
