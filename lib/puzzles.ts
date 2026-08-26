/**
 * Puzzle data access + selection helpers for the Training Arena.
 *
 * Puzzles come from scripts/import-puzzles.mjs (Lichess open database,
 * CC0) and live in data/puzzles.json. The JSON is dynamically imported so
 * it never lands in the main page bundle.
 */

export type Puzzle = {
  id: string;
  /** Position before the opponent's setup move (Lichess semantics). */
  fen: string;
  /** First solution move, played automatically by the opponent. */
  opponentMoveUci: string;
  /** Remaining solution moves, alternating solver / opponent. */
  playerMovesUci: string[];
  /** SAN of the whole line (opponent move first). */
  movesSan: string[];
  themes: string[];
  primaryTheme: string;
  rating: number;
  popularity: number;
  /** Color the SOLVER plays. */
  solverColor: "w" | "b";
  openingTags: string;
  gameUrl: string;
};

/** Per-theme performance used to weight selection toward weak spots. */
export type ThemeStats = Record<string, { solved: number; failed: number }>;

let cache: Puzzle[] | null = null;

/** Lazily import and validate the bundled puzzle set. */
export async function loadPuzzles(): Promise<Puzzle[]> {
  if (cache) return cache;
  const mod = await import("../data/puzzles.json");
  const raw = (mod.default ?? mod) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("data/puzzles.json must contain an array");
  }
  const puzzles = raw as Puzzle[];
  const seen = new Set<string>();
  for (const p of puzzles) {
    if (
      typeof p.id !== "string" ||
      typeof p.fen !== "string" ||
      typeof p.opponentMoveUci !== "string" ||
      !Array.isArray(p.playerMovesUci) ||
      p.playerMovesUci.length === 0 ||
      p.solverColor !== (p.fen.split(" ")[1] === "b" ? "w" : "b")
    ) {
      throw new Error(`Malformed puzzle entry: ${JSON.stringify(p.id)}`);
    }
    if (seen.has(p.id)) throw new Error(`Duplicate puzzle id: ${p.id}`);
    seen.add(p.id);
  }
  cache = puzzles;
  return puzzles;
}

function failureRate(stats: ThemeStats | undefined, theme: string): number {
  const s = stats?.[theme];
  if (!s || s.solved + s.failed === 0) return 0.35; // unknown themes: mild priority
  return s.failed / (s.solved + s.failed);
}

/**
 * Pick the next puzzle: within the level's rating window, weighted toward
 * themes the player struggles with, avoiding recently seen ids.
 */
export function pickNextPuzzle(options: {
  puzzles: Puzzle[];
  maxRating: number;
  themeStats?: ThemeStats;
  excludeIds?: Set<string>;
}): Puzzle | null {
  const { puzzles, maxRating, themeStats, excludeIds } = options;
  const eligible = puzzles.filter(
    (p) =>
      p.rating <= maxRating && !(excludeIds && excludeIds.has(p.id)),
  );
  const pool =
    eligible.length > 0
      ? eligible
      : puzzles.filter((p) => p.rating <= maxRating);
  if (pool.length === 0) return null;

  const inBand = pool.filter((p) => p.rating >= maxRating - 300);
  const candidates = inBand.length > 0 ? inBand : pool;

  // Weighted random pick by theme weakness.
  const weights = candidates.map(
    (p) => 1 + 4 * failureRate(themeStats, p.primaryTheme),
  );
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
