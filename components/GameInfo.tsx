"use client";

import { Chess } from "chess.js";
import { useMemo } from "react";

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

function formatMoveList(moves: string[]): string {
  const pairs: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const w = moves[i];
    const b = moves[i + 1] ?? "";
    pairs.push(`${num}.${w}${b ? ` ${b}` : ""}`);
  }
  return pairs.join("  ");
}

export default function GameInfo({ fen }: { fen: string }) {
  const info = useMemo(() => {
    const c = new Chess(fen);
    const verbose = c.history({ verbose: true });

    const whiteCaptures: string[] = [];
    const blackCaptures: string[] = [];

    for (const move of verbose) {
      if (move.captured) {
        if (move.color === "w") {
          whiteCaptures.push(move.captured);
        } else {
          blackCaptures.push(move.captured);
        }
      }
    }

    const whiteMat = whiteCaptures.reduce((s, p) => s + (PIECE_VALUES[p] ?? 0), 0);
    const blackMat = blackCaptures.reduce((s, p) => s + (PIECE_VALUES[p] ?? 0), 0);
    const advantage = whiteMat - blackMat;

    return {
      moves: c.history(),
      whiteCaptures,
      blackCaptures,
      advantage,
    };
  }, [fen]);

  const { moves, whiteCaptures, blackCaptures, advantage } = info;

  const whiteLostStr = blackCaptures.map((t) => PIECE_SYMBOLS.w[t]).join("");
  const blackLostStr = whiteCaptures.map((t) => PIECE_SYMBOLS.b[t]).join("");

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/80 p-3 text-xs">
      <div className="max-h-10 overflow-y-auto text-zinc-400 font-mono leading-relaxed">
        {moves.length > 0 ? (
          formatMoveList(moves)
        ) : (
          <span className="text-zinc-600 italic">No moves yet</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-zinc-500">
        {blackLostStr && (
          <span title="Black pieces captured by White">
            <span className="text-zinc-600">Took </span>
            <span className="text-zinc-300">{blackLostStr}</span>
          </span>
        )}
        {advantage !== 0 && (
          <span
            className={`font-semibold ${
              advantage > 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {advantage > 0 ? "+" : ""}
            {advantage}
          </span>
        )}
        {whiteLostStr && (
          <span title="White pieces captured by Black">
            <span className="text-zinc-600">Lost </span>
            <span className="text-zinc-300">{whiteLostStr}</span>
          </span>
        )}
        {!blackLostStr && !whiteLostStr && (
          <span className="text-zinc-600 italic">No captures yet</span>
        )}
      </div>
    </div>
  );
}
