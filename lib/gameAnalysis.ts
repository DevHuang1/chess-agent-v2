/**
 * Game-after-game improvement analysis.
 *
 * Replays a finished game with chess.js and classifies every PLAYER move by
 * its centipawn loss against a shallow minimax reference (reusing
 * buildMinimaxTrace from lib/minimax.ts, depth 3). Classification
 * thresholds follow chess.com conventions:
 *
 *   blunder    ≥ 200 cp lost
 *   mistake    ≥ 100 cp lost
 *   inaccuracy ≥   50 cp lost
 *   best       ≤    5 cp lost (matches the reference line)
 *   good       everything in between
 *
 * Accuracy maps each move's noise-floored centipawn loss onto a Gaussian
 * falloff, so one early blunder leaves a visible scar instead of hiding
 * among forty quiet moves the way it does with naive linear averaging.
 *
 * Pure and synchronous per position; the UI drives it chunk-by-chunk so a
 * long game never blocks rendering.
 */

import { Chess } from "chess.js";
import { buildMinimaxTrace } from "./minimax";

export type MoveClassification =
  | "best"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export type AnalyzedMove = {
  ply: number;
  san: string;
  color: "w" | "b";
  classification: MoveClassification;
  centipawnLoss: number;
};

export type GameAnalysis = {
  playerColor: "w" | "b";
  moves: AnalyzedMove[];
  accuracy: number;
  averageCentipawnLoss: number;
  counts: Record<MoveClassification, number>;
};

const ANALYSIS_DEPTH = 3;

/** Win probability (%) for a centipawn eval — Lichess's logistic curve. */
export function winProbability(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Per-move accuracy (%) from a raw win%-drop pair. Gaussian decay.
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  return dropAccuracy(winBefore - winAfter);
}

export function dropAccuracy(dropPct: number): number {
  const drop = Math.max(0, dropPct);
  return Math.min(100, 100 * Math.exp(-((drop / ACCURACY_SPREAD_PCT) ** 2)));
}

export const ACCURACY_SPREAD_PCT = 22;

/**
 * The depth-3 reference has no quiescence search: even sound opening moves
 * routinely measure 150-350cp "losses" from capture-noise at the horizon.
 * Losses under this floor are treated as measurement noise and earn full
 * credit; classification thresholds stay sharp regardless (see classifyLoss).
 */
export const NOISE_FLOOR_CP = 300;

/** Spread constant for the Gaussian falloff over noise-floored loss. */
export const ACCURACY_SPREAD_CP = 250;

/**
 * Per-move accuracy (%) from the raw centipawn loss vs the best line.
 * Noise-floored, then Gaussian-decayed so small slips barely register while
 * position-throwing losses collapse toward zero.
 */
export function moveAccuracyFromLoss(centipawnLoss: number): number {
  const effective = Math.max(0, centipawnLoss - NOISE_FLOOR_CP);
  return Math.min(
    100,
    100 * Math.exp(-((effective / ACCURACY_SPREAD_CP) ** 2)),
  );
}

export function classifyLoss(centipawnLoss: number): MoveClassification {
  if (centipawnLoss >= 200) return "blunder";
  if (centipawnLoss >= 100) return "mistake";
  if (centipawnLoss >= 50) return "inaccuracy";
  if (centipawnLoss <= 5) return "best";
  return "good";
}

/**
 * Best score (from `color`'s perspective, centipawns) for a position via a
 * shallow search. Terminal positions score ±10_000 / 0 directly.
 */
function shallowScore(fen: string, color: "w" | "b"): number {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    return chess.turn() === color ? -10_000 : 10_000;
  }
  if (chess.isDraw() || chess.isStalemate()) return 0;
  const trace = buildMinimaxTrace(fen, {
    depth: ANALYSIS_DEPTH,
    aiColor: chess.turn(),
  });
  // Trace scores are from the side-to-move's perspective.
  const raw = trace.selectedMove?.score ?? 0;
  return chess.turn() === color ? raw : -raw;
}

/** Analyze every move played by `playerColor` across the game's SAN list. */
export function analyzeGame(
  movesSan: string[],
  playerColor: "w" | "b",
): GameAnalysis {
  const before = new Chess();
  let pendingPlayerFen: string | null = null;
  let pendingPly = 0;

  const moves: AnalyzedMove[] = [];

  for (let i = 0; i < movesSan.length; i++) {
    const san = movesSan[i];
    const turn = before.turn();

    if (turn === playerColor) {
      pendingPlayerFen = before.fen();
      pendingPly = i;
    }

    try {
      before.move(san);
    } catch {
      break; // Corrupt history — analyze what we have so far.
    }
    const afterFen = before.fen();

    if (turn === playerColor && pendingPlayerFen !== null) {
      const bestBefore = shallowScore(pendingPlayerFen, playerColor);
      // shallowScore already returns values from the player's perspective.
      const actualAfter = shallowScore(afterFen, playerColor);
      const loss = Math.max(0, bestBefore - actualAfter);
      moves.push({
        ply: pendingPly,
        san,
        color: playerColor,
        classification: classifyLoss(loss),
        centipawnLoss: Math.round(loss),
      });
      pendingPlayerFen = null;
    }
  }

  const totalLoss = moves.reduce((sum, m) => sum + m.centipawnLoss, 0);
  const averageCentipawnLoss =
    moves.length > 0 ? Math.round(totalLoss / moves.length) : 0;

  const counts: Record<MoveClassification, number> = {
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  for (const m of moves) counts[m.classification] += 1;

  return {
    playerColor,
    moves,
    accuracy: accuracyFromMoves(moves),
    averageCentipawnLoss,
    counts,
  };
}

/**
 * Win-probability accuracy: each move's score decays with the winning
 * chances its centipawn loss squandered (see moveAccuracyFromLoss); the
 * game score is the mean over the player's moves.
 */
function accuracyFromMoves(moves: AnalyzedMove[]): number {
  if (moves.length === 0) return 0;
  const sum = moves.reduce(
    (acc, m) => acc + moveAccuracyFromLoss(m.centipawnLoss),
    0,
  );
  return Math.max(0, Math.round(sum / moves.length));
}

/** Stored summary for one finished game (sentio-game-history-v1). */
export type GameSummary = {
  id: string;
  finishedAt: number;
  outcome: string;
  playerColor: "w" | "b";
  openingName?: string;
  moveCount: number;
  accuracy: number;
  averageCentipawnLoss: number;
  counts: Record<MoveClassification, number>;
  /** Kept from v2 on so analyzed games can be exported as PGN. */
  movesSan?: string[];
};

export const GAME_HISTORY_STORAGE_KEY = "sentio-game-history-v1";
export const GAME_HISTORY_LIMIT = 60;

const CLASSIFICATIONS: readonly MoveClassification[] = [
  "best",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
];

/**
 * Defensive loader / forward migration point: anything that doesn't match
 * the current schema is dropped instead of crashing or poisoning state, so
 * a future schema bump only needs a new key version + a translate step here.
 */
function parseGameSummary(value: unknown): GameSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const g = value as Record<string, unknown>;
  if (typeof g.id !== "string" || typeof g.finishedAt !== "number") return null;
  if (typeof g.accuracy !== "number" || typeof g.moveCount !== "number") {
    return null;
  }
  if (!g.counts || typeof g.counts !== "object") return null;
  const counts = {} as Record<MoveClassification, number>;
  for (const key of CLASSIFICATIONS) {
    const n = (g.counts as Record<string, unknown>)[key];
    if (typeof n !== "number") return null;
    counts[key] = n;
  }
  return {
    id: g.id,
    finishedAt: g.finishedAt,
    outcome: typeof g.outcome === "string" ? g.outcome : "unknown",
    playerColor: g.playerColor === "b" ? "b" : "w",
    openingName:
      typeof g.openingName === "string" ? g.openingName : undefined,
    moveCount: g.moveCount,
    accuracy: g.accuracy,
    averageCentipawnLoss:
      typeof g.averageCentipawnLoss === "number"
        ? g.averageCentipawnLoss
        : 0,
    counts,
    movesSan: Array.isArray(g.movesSan)
      ? g.movesSan.filter((s): s is string => typeof s === "string")
      : undefined,
  };
}

export function loadGameHistory(): GameSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GAME_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseGameSummary)
      .filter((g): g is GameSummary => g !== null)
      .slice(0, GAME_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveGameSummary(summary: GameSummary): void {
  if (typeof window === "undefined") return;
  try {
    const history = [
      summary,
      ...loadGameHistory().filter((g) => g.id !== summary.id),
    ].slice(0, GAME_HISTORY_LIMIT);
    window.localStorage.setItem(
      GAME_HISTORY_STORAGE_KEY,
      JSON.stringify(history),
    );
  } catch {
    // Storage unavailable — history stays ephemeral.
  }
}

/** Compare the last N games with the N before them. */
export function improvementVerdict(
  history: GameSummary[],
  n = 5,
): { accuracyDelta: number; blundersPerGameDelta: number } | null {
  if (history.length < n + 1) return null;
  const recent = history.slice(0, n);
  const prior = history.slice(n, n * 2);
  const avg = (games: GameSummary[], pick: (g: GameSummary) => number) =>
    games.length > 0
      ? games.reduce((s, g) => s + pick(g), 0) / games.length
      : 0;
  return {
    accuracyDelta: Math.round(
      avg(recent, (g) => g.accuracy) - avg(prior, (g) => g.accuracy),
    ),
    blundersPerGameDelta:
      Math.round(
        (avg(recent, (g) => g.counts.blunder) -
          avg(prior, (g) => g.counts.blunder)) *
          10,
      ) / 10,
  };
}

/**
 * Export a summarized game as a PGN string (headers + numbered moves).
 * Returns null when the stored summary predates move retention.
 */
export function buildPgn(summary: GameSummary): string | null {
  if (!summary.movesSan || summary.movesSan.length === 0) return null;
  const date = new Date(summary.finishedAt)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, ".");
  // Outcome strings come from updateGameOutcome: "white wins" |
  // "black wins" | "stalemate" | "draw".
  let result = "*";
  const whiteWins = summary.outcome === "white wins";
  const blackWins = summary.outcome === "black wins";
  if (summary.outcome === "draw" || summary.outcome === "stalemate") {
    result = "1/2-1/2";
  } else if (whiteWins || blackWins) {
    result =
      (whiteWins && summary.playerColor === "w") ||
      (blackWins && summary.playerColor === "b")
        ? "1-0"
        : "0-1";
  }
  const body = summary.movesSan
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
    .join(" ");
  return [
    '[Event "Sentio training game"]',
    '[Site "Sentio Training Arena"]',
    `[Date "${date}"]`,
    `[White "${summary.playerColor === "w" ? "You" : "Sentio"}"]`,
    `[Black "${summary.playerColor === "b" ? "You" : "Sentio"}"]`,
    `[Result "${result}"]`,
    "",
    `${body} ${result}`,
  ].join("\n");
}

/* ---------------------------------------------------------------------------
 * Unanalyzed-game queue: finished games park their raw SAN list here so the
 * Progress view can run (re-run) analysis on demand without blocking play.
 * ------------------------------------------------------------------------- */

const UNANALYZED_STORAGE_KEY = "sentio-unanalyzed-games-v1";
const UNANALYZED_LIMIT = 20;

export type UnanalyzedGame = {
  id: string;
  finishedAt: number;
  outcome: string;
  playerColor: "w" | "b";
  openingName?: string;
  movesSan: string[];
};

export function loadUnanalyzedGames(): UnanalyzedGame[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(UNANALYZED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UnanalyzedGame[]) : [];
  } catch {
    return [];
  }
}

export function queueUnanalyzedGame(game: UnanalyzedGame): void {
  if (typeof window === "undefined") return;
  try {
    const queue = [
      game,
      ...loadUnanalyzedGames().filter((g) => g.id !== game.id),
    ].slice(0, UNANALYZED_LIMIT);
    window.localStorage.setItem(
      UNANALYZED_STORAGE_KEY,
      JSON.stringify(queue),
    );
  } catch {
    // Storage unavailable — skip queueing.
  }
}

/** Analyze a queued game, file its summary, and remove it from the queue. */
export function analyzeQueuedGame(game: UnanalyzedGame): {
  summary: GameSummary;
  analysis: GameAnalysis;
} {
  const analysis = analyzeGame(game.movesSan, game.playerColor);
  const summary: GameSummary = {
    id: game.id,
    finishedAt: game.finishedAt,
    outcome: game.outcome,
    playerColor: game.playerColor,
    openingName: game.openingName,
    moveCount: game.movesSan.length,
    accuracy: analysis.accuracy,
    averageCentipawnLoss: analysis.averageCentipawnLoss,
    counts: analysis.counts,
    movesSan: game.movesSan,
  };
  saveGameSummary(summary);
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        UNANALYZED_STORAGE_KEY,
        JSON.stringify(
          loadUnanalyzedGames().filter((g) => g.id !== game.id),
        ),
      );
    }
  } catch {
    // Ignore storage failures.
  }
  return { summary, analysis };
}


