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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  const quizAccuracy =
    progress.quizTotals.attempted > 0
      ? Math.round(
          (progress.quizTotals.solved / progress.quizTotals.attempted) * 100,
        )
      : 0;
  const firstTryRate =
    progress.quizTotals.solved > 0
      ? Math.round(
          (progress.quizTotals.firstTrySolved / progress.quizTotals.solved) *
            100,
        )
      : 0;
  const themeRows = Object.entries(progress.themeStats)
    .map(([theme, stats]) => ({
      theme,
      attempts: stats.solved + stats.failed,
      accuracy:
        stats.solved + stats.failed > 0
          ? Math.round((stats.solved / (stats.solved + stats.failed)) * 100)
          : 0,
    }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 6);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onExit}>
          ← Back
        </Button>
        <h2 className="font-mono text-lg font-bold train-accent-text">
          📈 Your Progress
        </h2>
        <Badge variant="muted">
          {progress.gamesAnalyzed} analyzed
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Quiz accuracy" value={`${quizAccuracy}%`} detail={`${progress.quizTotals.solved}/${progress.quizTotals.attempted} solved`} />
        <MetricCard label="First-try recall" value={`${firstTryRate}%`} detail={`${progress.quizTotals.hintsUsed} hints used`} />
        <MetricCard label="Positions mastered" value={String(progress.lessonsCompleted.length)} detail={`${Object.keys(progress.lessonMastery).length} attempted`} />
        <MetricCard label="Review queue" value={String(progress.reviewLessonIds.length)} detail="Missed or hinted" />
      </div>

      {themeRows.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm font-bold">Tactical theme accuracy</h3>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Puzzle attempts</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {themeRows.map((row) => (
                <div key={row.theme}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize">{humanizeTheme(row.theme)}</span>
                    <span className="font-mono text-zinc-400">{row.accuracy}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800 light:bg-slate-200">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${row.accuracy}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unanalyzed games */}
      {queue.length > 0 && (
        <Card>
          <CardContent className="p-4">
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
                  <Button
                    variant="default"
                    size="sm"
                    disabled={busyId === game.id}
                    onClick={() => runAnalysis(game)}
                  >
                    {busyId === game.id ? "Analyzing…" : "Analyze"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {verdict && (
        <Card className="border-l-4 border-l-violet-400">
          <CardContent className="p-4 text-sm">
            <span className="font-bold train-accent-text">Verdict:</span>{" "}
            {verdict.accuracyDelta >= 0 ? "+" : ""}
            {verdict.accuracyDelta}% accuracy,{" "}
            {verdict.blundersPerGameDelta <= 0 ? "" : "+"}
            {verdict.blundersPerGameDelta} blunders/game vs the previous block{" "}
            {verdict.accuracyDelta >= 0 && verdict.blundersPerGameDelta <= 0
              ? "📈"
              : "📉"}
          </CardContent>
        </Card>
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
      <Card>
        <CardContent className="p-4">
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyPgn(g)}
                          aria-label={`Copy game from ${new Date(g.finishedAt).toLocaleDateString()} as PGN`}
                        >
                          {copiedId === g.id ? "Copied!" : "⧉ PGN"}
                        </Button>
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
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
        <div className="mt-1 font-mono text-2xl font-bold train-accent-text">{value}</div>
        <div className="mt-1 text-[10px] text-zinc-500">{detail}</div>
      </CardContent>
    </Card>
  );
}

function humanizeTheme(theme: string): string {
  return theme.replace(/([a-z])([A-Z])/g, "$1 $2");
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
    <Card>
      <CardContent className="p-4">
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
      </CardContent>
    </Card>
  );
}
