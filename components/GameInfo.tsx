"use client";

import { useMemo } from "react";
import type { Move } from "chess.js";

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const MOVE_QUALITY_COLORS: Record<string, string> = {
  Excellent: "text-emerald-400",
  Good: "text-blue-400",
  Mistake: "text-amber-400",
  Blunder: "text-rose-400",
};

export default function GameInfo({
  moves,
  moveQualities = {},
}: {
  moves: Move[];
  moveQualities?: Record<number, string>;
}) {
  const info = useMemo(() => {
    const whiteCaptures: string[] = [];
    const blackCaptures: string[] = [];

    for (const move of moves) {
      if (move.captured) {
        if (move.color === "w") {
          whiteCaptures.push(move.captured);
        } else {
          blackCaptures.push(move.captured);
        }
      }
    }

    const whiteMat = whiteCaptures.reduce(
      (s, p) => s + (PIECE_VALUES[p] ?? 0),
      0,
    );
    const blackMat = blackCaptures.reduce(
      (s, p) => s + (PIECE_VALUES[p] ?? 0),
      0,
    );
    const advantage = whiteMat - blackMat;

    const rows: {
      num: number;
      white: string;
      black: string;
      whiteQuality?: string;
      blackQuality?: string;
    }[] = [];
    for (let i = 0; i < moves.length; i += 2) {
      rows.push({
        num: Math.floor(i / 2) + 1,
        white: moves[i]?.san ?? "",
        black: moves[i + 1]?.san ?? "",
        whiteQuality: moveQualities[i],
        blackQuality: moveQualities[i + 1],
      });
    }

    return { rows, whiteCaptures, blackCaptures, advantage };
  }, [moves, moveQualities]);

  const { rows, whiteCaptures, blackCaptures, advantage } = info;
  const whiteTookStr = whiteCaptures.map((t) => PIECE_SYMBOLS.b[t]).join(" ");
  const blackTookStr = blackCaptures.map((t) => PIECE_SYMBOLS.w[t]).join(" ");

  const getQualityBadge = (quality?: string) => {
    if (!quality) return null;
    const colorClass = MOVE_QUALITY_COLORS[quality] ?? "text-zinc-500";
    return (
      <span
        className={`ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${colorClass} bg-zinc-800/50`}
        title={`Move quality: ${quality}`}
      >
        {quality}
      </span>
    );
  };

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/80 p-3 text-xs light:border-slate-200 light:bg-white/80">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-zinc-300 light:text-slate-700">
          Moves
        </span>
        <span className="text-zinc-600 light:text-slate-500">
          {rows.length} {rows.length === 1 ? "move pair" : "move pairs"}
        </span>
      </div>
      <div className="max-h-24 overflow-y-auto rounded bg-zinc-950/60 p-2 font-mono text-zinc-300 leading-relaxed light:bg-slate-100 light:text-slate-700">
        {rows.length > 0 ? (
          <table className="w-full">
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.num}
                  className="border-b border-zinc-900 last:border-0 light:border-slate-200"
                >
                  <td className="pr-2 align-top text-zinc-600 light:text-slate-500">
                    {r.num}.
                  </td>
                  <td className="pr-2 align-top">
                    {r.white}
                    {getQualityBadge(r.whiteQuality)}
                  </td>
                  <td className="align-top">
                    {r.black}
                    {getQualityBadge(r.blackQuality)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span className="italic text-zinc-600 light:text-slate-500">
            No moves yet
          </span>
        )}
      </div>
      <div className="mt-2 border-t border-zinc-800 pt-2 light:border-slate-200">
        <span className="font-semibold text-zinc-300 light:text-slate-700">
          Captures
        </span>
        <div className="mt-1 flex flex-col gap-0.5 text-zinc-400 light:text-slate-600">
          <div>
            <span className="text-zinc-600 light:text-slate-500">
              You took:{" "}
            </span>
            {whiteCaptures.length > 0 ? (
              <span className="text-lg text-zinc-200 light:text-slate-800">
                {whiteTookStr}
              </span>
            ) : (
              <span className="italic text-zinc-600 light:text-slate-500">
                none
              </span>
            )}
          </div>
          <div>
            <span className="text-zinc-600 light:text-slate-500">
              Bot took:{" "}
            </span>
            {blackCaptures.length > 0 ? (
              <span className="text-lg text-zinc-200 light:text-slate-800">
                {blackTookStr}
              </span>
            ) : (
              <span className="italic text-zinc-600 light:text-slate-500">
                none
              </span>
            )}
          </div>
          {advantage !== 0 && (
            <div
              className={advantage > 0 ? "text-emerald-400" : "text-rose-400"}
            >
              Material {advantage > 0 ? "+" : ""}
              {advantage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
