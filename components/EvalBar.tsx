"use client";

/**
 * Vertical evaluation bar rendered beside the chessboard.
 *
 * `evaluation` is in centipawns from White's perspective. The white fill
 * height is derived from a win-probability sigmoid so the bar responds
 * smoothly and never fully saturates on ordinary advantages.
 */

function winProbability(evaluation: number): number {
  // Clamp to ±15 pawns before the sigmoid so extreme evals still leave a sliver.
  const clamped = Math.max(-1500, Math.min(1500, evaluation));
  return 1 / (1 + Math.pow(10, -clamped / 400));
}

export default function EvalBar({ evaluation }: { evaluation: number | null }) {
  // Neutral (50/50) while no evaluation is available.
  const whiteShare = evaluation === null ? 0.5 : winProbability(evaluation);
  const label =
    evaluation === null
      ? "–"
      : `${evaluation > 0 ? "+" : evaluation < 0 ? "−" : ""}${Math.abs(evaluation / 100).toFixed(1)}`;

  return (
    <div className="flex h-full w-8 shrink-0 flex-col items-center gap-1">
      <span
        className="font-mono text-[10px] font-bold text-zinc-300 light:text-slate-700"
        title="Engine evaluation (White's perspective)"
      >
        {label}
      </span>
      <div
        className="relative w-4 flex-1 overflow-hidden rounded-full border border-zinc-700/60 bg-zinc-950 light:border-slate-300 light:bg-slate-800"
        role="img"
        aria-label={`Evaluation: ${label}`}
      >
        {/* Black share (top) */}
        <div
          className="absolute inset-x-0 top-0 transition-[height] duration-500 ease-out"
          style={{
            height: `${(1 - whiteShare) * 100}%`,
            backgroundColor: "var(--sentio-board-dark, #312e2b)",
          }}
        />
        {/* White share (bottom) */}
        <div
          className="absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-out"
          style={{
            height: `${whiteShare * 100}%`,
            backgroundColor: "var(--sentio-board-light, #ebecd0)",
          }}
        />
        {/* Midline marker */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-amber-500/50" />
      </div>
    </div>
  );
}
