"use client";

/**
 * Progress — game-after-game improvement analysis.
 *
 * Finished games queue their raw move lists (see lib/gameAnalysis.ts). This
 * view analyzes queued games on demand with a shallow minimax reference,
 * files accuracy summaries, and draws SVG trend sparklines: accuracy per
 * game, blunders per game, plus an improvement verdict comparing recent
 * games against the block before them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  analyzeQueuedGame,
  buildPgn,
  GAME_HISTORY_LIMIT,
  improvementVerdict,
  loadGameHistory,
  loadUnanalyzedGames,
  type GameSummary,
  type UnanalyzedGame,
} from "@/lib/gameAnalysis";
import type { PuzzleProgress } from "@/lib/puzzleProgress";

export default function ProgressView({
  progress,
  onAnalyzed,
  onExit,
}: {
  progress: PuzzleProgress;
  onAnalyzed: () => void;
  onExit: () => void;
}) {
  const [history, setHistory] = useState<GameSummary[]>([]);
  const [queue, setQueue] = useState<UnanalyzedGame[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyPgn = useCallback((game: GameSummary) => {
    const pgn = buildPgn(game);
    if (!pgn) return;
    void navigator.clipboard
      ?.writeText(pgn)
      .then(() => {
        setCopiedId(game.id);
        window.setTimeout(
          () => setCopiedId((id) => (id === game.id ? null : id)),
          1_500,
        );
      })
      .catch(() => {
        // Clipboard unavailable (permissions/insecure context) — no-op.
      });
  }, []);

  const refresh = useCallback(() => {
    setHistory(loadGameHistory());
    setQueue(loadUnanalyzedGames());
  }, []);

  useEffect(() => {
    const t = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  const runAnalysis = (game: UnanalyzedGame) => {
    setBusyId(game.id);
    // Yield so the button paints its busy state before the search runs.
    window.setTimeout(() => {
      try {
        analyzeQueuedGame(game);
        onAnalyzed();
      } finally {
        setBusyId(null);
        refresh();
      }
    }, 30);
  };

  const verdict = useMemo(() => improvementVerdict(history), [history]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onExit}
          className="rounded-md border border-zinc-700/60 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 light:border-slate-300 light:text-slate-600"
        >
          ← Back
        </button>
        <h2 className="font-mono text-lg font-bold train-accent-text">
          📈 Your Progress
        </h2>
        <span className="font-mono text-xs text-zinc-500">
          {progress.gamesAnalyzed} analyzed
        </span>
      </div>

      {/* Unanalyzed games */}
      {queue.length > 0 && (
        <div className="train-panel rounded-xl p-4">
          <h3 className="font-mono text-sm font-bold">Awaiting analysis</h3>
          <div className="mt-3 flex flex-col gap-2">
            {queue.map((game) => (
              <div
                key={game.id}
                className="flex items-center justify-between rounded-lg bg-zinc-900/60 px-3 py-2 light:bg-slate-200/60"
              >
                <div className="text-xs">
                  <span className="font-semibold capitalize">
                    {game.outcome}
                  </span>
                  <span className="ml-2 text-zinc-500 light:text-slate-500">
                    {game.movesSan.length} plies ·{" "}
                    {new Date(game.finishedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyId === game.id}
                  onClick={() => runAnalysis(game)}
                  className="rounded-md bg-violet-500/20 px-3 py-1 text-xs font-semibold text-violet-300 hover:bg-violet-500/30 disabled:opacity-50"
                >
                  {busyId === game.id ? "Analyzing…" : "Analyze"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {verdict && (
        <div
          role="status"
          className="train-panel rounded-xl border-l-4 border-l-violet-400 p-4 text-sm"
        >
          <span className="font-bold train-accent-text">Verdict:</span>{" "}
          {verdict.accuracyDelta >= 0 ? "+" : ""}
          {verdict.accuracyDelta}% accuracy,{" "}
          {verdict.blundersPerGameDelta <= 0 ? "" : "+"}
          {verdict.blundersPerGameDelta} blunders/game vs the previous block{" "}
          {verdict.accuracyDelta >= 0 && verdict.blundersPerGameDelta <= 0
            ? "📈"
            : "📉"}
        </div>
      )}

      {/* Trend charts */}
      {history.length >= 2 && (
        <div className="grid gap-3 md:grid-cols-2">
          <TrendCard
            title="Accuracy %"
            values={history.slice().reverse().map((g) => g.accuracy)}
          />
          <TrendCard
            title="Blunders per game"
            values={history
              .slice()
              .reverse()
              .map((g) => g.counts.blunder)}
            invert
          />
        </div>
      )}

      {/* History table */}
      <div className="train-panel rounded-xl p-4">
        <h3 className="font-mono text-sm font-bold">Recent games</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500 light:text-slate-500">
            Finish a game, then analyze it here to start tracking improvement.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Result</th>
                <th className="pb-2">Accuracy</th>
                <th className="pb-2">Blunders</th>
                <th className="pb-2">Avg loss</th>
                <th className="pb-2">
                  <span className="sr-only">Export</span>
                </th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {history.slice(0, 12).map((g) => (
                <tr
                  key={g.id}
                  className="border-t border-zinc-800/60 light:border-slate-300"
                >
                  <td className="py-1.5">
                    {new Date(g.finishedAt).toLocaleDateString()}
                  </td>
                  <td className="py-1.5 capitalize">{g.outcome}</td>
                  <td className="py-1.5 font-bold text-cyan-300">
                    {g.accuracy}%
                  </td>
                  <td className="py-1.5 text-red-300">{g.counts.blunder}</td>
                  <td className="py-1.5 text-zinc-400">
                    {g.averageCentipawnLoss}
                  </td>
                  <td className="py-1.5 text-right">
                    {buildPgn(g) && (
                      <button
                        type="button"
                        onClick={() => copyPgn(g)}
                        aria-label={`Copy game from ${new Date(g.finishedAt).toLocaleDateString()} as PGN`}
                        className="rounded border border-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-violet-500/50 hover:text-violet-300 light:border-slate-300 light:text-slate-600"
                      >
                        {copiedId === g.id ? "Copied!" : "⧉ PGN"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {history.length >= GAME_HISTORY_LIMIT && (
          <p className="mt-2 text-[10px] text-zinc-500 light:text-slate-500">
            Showing the most recent {GAME_HISTORY_LIMIT} games — older results
            are archived out to keep storage lean.
          </p>
        )}
      </div>
    </div>
  );
}

/** Minimal SVG line chart matching the mono aesthetic. */
function TrendCard({
  title,
  values,
  invert,
}: {
  title: string;
  values: number[];
  invert?: boolean;
}) {
  const width = 260;
  const height = 70;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const points = values.map((v, i) => {
    const x =
      values.length > 1 ? (i / (values.length - 1)) * width : width / 2;
    const y = height - ((v - min) / span) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const improving = invert
    ? values[values.length - 1] <= values[0]
    : values[values.length - 1] >= values[0];
  const stroke = improving ? "#34d399" : "#f87171";

  return (
    <div className="train-panel rounded-xl p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-xs font-semibold">{title}</span>
        <span className="font-mono text-xs" style={{ color: stroke }}>
          {improving ? "▲" : "▼"} {values[values.length - 1]}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
