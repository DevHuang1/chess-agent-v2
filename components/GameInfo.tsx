"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const QUALITY_VARIANT: Record<string, "success" | "info" | "warning" | "destructive"> = {
  Excellent: "success",
  Good: "info",
  Mistake: "warning",
  Blunder: "destructive",
};

export type GameInfoMove = {
  san: string;
  color: "w" | "b";
  captured?: string;
};

export default function GameInfo({
  moves,
  moveQualities = {},
  openingName,
}: {
  moves: GameInfoMove[];
  moveQualities?: Record<number, string>;
  openingName?: string | null;
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
    return (
      <Badge
        variant={QUALITY_VARIANT[quality] ?? "muted"}
        className="ml-1 text-[9px] uppercase"
        title={`Move quality: ${quality}`}
      >
        {quality}
      </Badge>
    );
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/80 light:border-slate-200 light:bg-white/80">
      <CardContent className="p-3 text-xs">
        {openingName ? (
          <div className="mb-2 flex items-center gap-2 border-b border-zinc-800 pb-2 light:border-slate-200">
            <Badge variant="accent" className="text-[9px] uppercase">
              OPENING
            </Badge>
            <span
              className="font-semibold text-zinc-200 light:text-slate-800"
              title={openingName}
            >
              {openingName}
            </span>
          </div>
        ) : null}
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-zinc-300 light:text-slate-700">
            Moves
          </span>
          <span className="text-zinc-600 light:text-slate-500">
            {rows.length} {rows.length === 1 ? "move pair" : "move pairs"}
          </span>
        </div>
        <div className="max-h-44 overflow-y-auto rounded bg-zinc-950/60 p-2.5 font-mono text-zinc-300 leading-relaxed light:bg-slate-100 light:text-slate-700">
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
        <Separator className="my-2" />
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
      </CardContent>
    </Card>
  );
}
