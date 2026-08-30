/**
 * Unified profile XP / leveling economy for the Training Arena.
 *
 * XP sources: puzzle solves (scaled by rating band × streak × no-hint
 * bonus), lesson completions, and analyzed games. Levels follow chess.com-
 * style tiers; each level raises the max puzzle rating served. Persisted to
 * localStorage under "sentio-puzzle-progress-v1".
 */

import type { ThemeStats } from "./puzzles";

export type PuzzleProgress = {
  xp: number;
  currentStreak: number;
  bestStreak: number;
  solvedIds: string[];
  themeStats: ThemeStats;
  bestScores: { rush: number; survival: number };
  lessonsCompleted: string[];
  lessonMastery: Record<string, LessonMastery>;
  reviewLessonIds: string[];
  quizTotals: QuizTotals;
  gamesAnalyzed: number;
};

export type LessonMastery = {
  attempts: number;
  solved: number;
  firstTrySolved: number;
  hintsUsed: number;
  lastAttemptAt: string;
};

export type QuizTotals = {
  attempted: number;
  solved: number;
  firstTrySolved: number;
  hintsUsed: number;
};

export const PROGRESS_STORAGE_KEY = "sentio-puzzle-progress-v1";

export const TIERS = [
  { name: "Bronze", minLevel: 1, color: "#cd7f32" },
  { name: "Silver", minLevel: 5, color: "#c0c0c0" },
  { name: "Gold", minLevel: 10, color: "#ffd700" },
  { name: "Platinum", minLevel: 16, color: "#7de3e0" },
  { name: "Diamond", minLevel: 23, color: "#60a5fa" },
  { name: "Legend", minLevel: 31, color: "#f472b6" },
] as const;

/** Per-level XP increment base; total cost grows gently quadratic. */
const LEVEL_STEP = 120;

/** Cumulative XP required to have reached `level`. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += LEVEL_STEP + (l - 1) * 12;
  }
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1) && level < 99) level++;
  return level;
}

export function tierForLevel(level: number): { name: string; color: string } {
  let current: { name: string; color: string } = TIERS[0];
  for (const tier of TIERS) {
    if (level >= tier.minLevel) current = tier;
  }
  return { name: current.name, color: current.color };
}

/** Highest puzzle rating this progress may be served. */
export function maxRatingForLevel(level: number): number {
  return Math.min(2200, 800 + level * 90);
}

export function emptyProgress(): PuzzleProgress {
  return {
    xp: 0,
    currentStreak: 0,
    bestStreak: 0,
    solvedIds: [],
    themeStats: {},
    bestScores: { rush: 0, survival: 0 },
    lessonsCompleted: [],
    lessonMastery: {},
    reviewLessonIds: [],
    quizTotals: { attempted: 0, solved: 0, firstTrySolved: 0, hintsUsed: 0 },
    gamesAnalyzed: 0,
  };
}

export function loadProgress(): PuzzleProgress {
  if (typeof window === "undefined") return emptyProgress();
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<PuzzleProgress>;
    const empty = emptyProgress();
    return {
      ...empty,
      ...parsed,
      bestScores: { ...empty.bestScores, ...parsed.bestScores },
      lessonMastery: parsed.lessonMastery ?? empty.lessonMastery,
      reviewLessonIds: parsed.reviewLessonIds ?? empty.reviewLessonIds,
      quizTotals: { ...empty.quizTotals, ...parsed.quizTotals },
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: PuzzleProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify(progress),
    );
  } catch {
    // Storage unavailable — progress stays in memory for the session.
  }
}

/** Base XP for a puzzle of a given rating. */
function baseXp(rating: number): number {
  return 8 + Math.round(rating / 100);
}

export type SolveInput = {
  rating: number;
  solved: boolean;
  usedHint: boolean;
  theme: string;
};

export type SolveOutcome = {
  progress: PuzzleProgress;
  xpGained: number;
  leveledUp: boolean;
};

function cloneStats(stats: ThemeStats): ThemeStats {
  return Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [k, { ...v }]),
  );
}

/**
 * Apply one puzzle attempt: updates streak, per-theme stats and XP.
 * Failing breaks the streak and grants nothing. Puzzle-id bookkeeping is
 * the caller's job (markPuzzleSolved).
 */
export function applySolveResult(
  previous: PuzzleProgress,
  input: SolveInput,
): SolveOutcome {
  const progress: PuzzleProgress = {
    ...previous,
    themeStats: cloneStats(previous.themeStats),
    solvedIds: [...previous.solvedIds],
    lessonsCompleted: [...previous.lessonsCompleted],
    bestScores: { ...previous.bestScores },
  };
  const stats = progress.themeStats[input.theme] ?? {
    solved: 0,
    failed: 0,
  };
  progress.themeStats[input.theme] = stats;

  if (!input.solved) {
    stats.failed += 1;
    progress.currentStreak = 0;
    return { progress, xpGained: 0, leveledUp: false };
  }

  stats.solved += 1;
  progress.currentStreak += 1;
  progress.bestStreak = Math.max(progress.bestStreak, progress.currentStreak);

  const streakMult = 1 + Math.min(progress.currentStreak - 1, 5) * 0.1;
  let gained = Math.round(baseXp(input.rating) * streakMult);
  if (input.usedHint) gained = Math.round(gained / 2);

  const beforeLevel = levelFromXp(progress.xp);
  progress.xp += gained;

  return {
    progress,
    xpGained: gained,
    leveledUp: levelFromXp(progress.xp) > beforeLevel,
  };
}

/**
 * Mark a puzzle solved once (idempotent). The tracked-id list is capped so
 * localStorage can't grow without bound; oldest ids fall off first (they may
 * resurface much later, which doubles as light spaced repetition).
 */
export const MAX_TRACKED_SOLVED_IDS = 1000;

export function markPuzzleSolved(
  progress: PuzzleProgress,
  puzzleId: string,
): PuzzleProgress {
  if (progress.solvedIds.includes(puzzleId)) return progress;
  return {
    ...progress,
    solvedIds: [...progress.solvedIds, puzzleId].slice(
      -MAX_TRACKED_SOLVED_IDS,
    ),
  };
}

export const LESSON_XP = 40;
export const ANALYSIS_XP = 15;

/** First completion of a lesson grants bonus XP; repeats are free. */
export function completeLesson(
  previous: PuzzleProgress,
  lessonId: string,
): SolveOutcome {
  if (previous.lessonsCompleted.includes(lessonId)) {
    return { progress: previous, xpGained: 0, leveledUp: false };
  }
  const progress: PuzzleProgress = {
    ...previous,
    lessonsCompleted: [...previous.lessonsCompleted, lessonId],
  };
  const beforeLevel = levelFromXp(progress.xp);
  progress.xp += LESSON_XP;
  return {
    progress,
    xpGained: LESSON_XP,
    leveledUp: levelFromXp(progress.xp) > beforeLevel,
  };
}

export type LessonAttemptInput = {
  lessonId: string;
  solved: boolean;
  firstTry: boolean;
  hintsUsed: number;
};

/** Record an interactive lesson attempt and maintain the spaced-review queue. */
export function recordLessonAttempt(
  previous: PuzzleProgress,
  input: LessonAttemptInput,
): SolveOutcome {
  const existing = previous.lessonMastery[input.lessonId] ?? {
    attempts: 0,
    solved: 0,
    firstTrySolved: 0,
    hintsUsed: 0,
    lastAttemptAt: "",
  };
  const lessonMastery = {
    ...previous.lessonMastery,
    [input.lessonId]: {
      attempts: existing.attempts + 1,
      solved: existing.solved + (input.solved ? 1 : 0),
      firstTrySolved:
        existing.firstTrySolved + (input.solved && input.firstTry ? 1 : 0),
      hintsUsed: existing.hintsUsed + Math.max(0, input.hintsUsed),
      lastAttemptAt: new Date().toISOString(),
    },
  };
  const review = new Set(previous.reviewLessonIds);
  if (input.solved && input.firstTry && input.hintsUsed === 0) {
    review.delete(input.lessonId);
  } else {
    review.add(input.lessonId);
  }
  const quizTotals: QuizTotals = {
    attempted: previous.quizTotals.attempted + 1,
    solved: previous.quizTotals.solved + (input.solved ? 1 : 0),
    firstTrySolved:
      previous.quizTotals.firstTrySolved +
      (input.solved && input.firstTry ? 1 : 0),
    hintsUsed: previous.quizTotals.hintsUsed + Math.max(0, input.hintsUsed),
  };
  const tracked: PuzzleProgress = {
    ...previous,
    lessonMastery,
    reviewLessonIds: [...review],
    quizTotals,
  };
  if (!input.solved) {
    return { progress: tracked, xpGained: 0, leveledUp: false };
  }
  return completeLesson(tracked, input.lessonId);
}

export function recordAnalyzedGame(previous: PuzzleProgress): SolveOutcome {
  const progress: PuzzleProgress = { ...previous };
  progress.gamesAnalyzed += 1;
  const beforeLevel = levelFromXp(progress.xp);
  progress.xp += ANALYSIS_XP;
  return {
    progress,
    xpGained: ANALYSIS_XP,
    leveledUp: levelFromXp(progress.xp) > beforeLevel,
  };
}

export function recordRunScore(
  previous: PuzzleProgress,
  mode: "rush" | "survival",
  score: number,
): { progress: PuzzleProgress; newBest: boolean } {
  const prevBest =
    mode === "rush" ? previous.bestScores.rush : previous.bestScores.survival;
  const newBest = score > prevBest;
  return {
    progress: {
      ...previous,
      bestScores:
        mode === "rush"
          ? { ...previous.bestScores, rush: Math.max(prevBest, score) }
          : { ...previous.bestScores, survival: Math.max(prevBest, score) },
    },
    newBest,
  };
}
