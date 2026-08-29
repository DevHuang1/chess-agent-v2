"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface PromotionPickerProps {
  onChoose: (piece: "q" | "r" | "b" | "n") => void;
}

export default function PromotionPicker({ onChoose }: PromotionPickerProps) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="border-amber-500/40 bg-zinc-900 p-4 shadow-2xl light:border-amber-300 light:bg-white">
        <p className="mb-2 text-xs font-semibold text-zinc-200 light:text-slate-800">
          Choose promotion piece
        </p>
        <div className="flex gap-2">
          {(
            [
              ["q", "♛"],
              ["r", "♜"],
              ["b", "♝"],
              ["n", "♞"],
            ] as const
          ).map(([piece, glyph]) => (
            <Button
              key={piece}
              variant="outline"
              size="icon"
              onClick={() => onChoose(piece)}
              className="h-12 w-12 text-3xl leading-none text-amber-300 hover:border-amber-400 hover:bg-zinc-700 light:text-slate-800 light:hover:bg-slate-200"
            >
              {glyph}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
