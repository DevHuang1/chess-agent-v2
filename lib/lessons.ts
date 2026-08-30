/**
 * Ready-made training positions ("Learn" track).
 *
 * Lessons are curated move sequences from a start position (default: the
 * initial position) with per-step narration. loadLessons() validates every
 * lesson by replaying it with chess.js — an illegal line throws, so bad
 * content can never ship silently.
 */

import { Chess } from "chess.js";

export type LessonStep = {
  san: string;
  narration: string;
};

export type Lesson = {
  id: string;
  title: string;
  category: "openings" | "endgames" | "attacks" | "ready";
  intro: string;
  difficulty?: 1 | 2 | 3;
  tags?: string[];
  estimatedMinutes?: number;
  /** Defaults to the standard starting position. */
  startFen?: string;
  steps: LessonStep[];
};

export const LESSON_CATEGORIES = [
  { key: "openings", label: "Openings & Traps" },
  { key: "endgames", label: "Endgame Technique" },
  { key: "attacks", label: "Classic Attacks" },
  { key: "ready", label: "Ready Mating Nets" },
] as const;

let cache: Lesson[] | null = null;

/** Load and validate the bundled lessons (cached). */
export async function loadLessons(): Promise<Lesson[]> {
  if (cache) return cache;
  const mod = await import("../data/lessons.json");
  const raw = (mod.default ?? mod) as Lesson[];

  // Integrity: every step must be a legal SAN move in sequence.
  for (const lesson of raw) {
    validateLesson(lesson);
  }
  cache = raw;
  return raw;
}

/** Replay a lesson's line; throws with a precise message when illegal. */
export function validateLesson(lesson: Lesson): void {
  if (!lesson.id || !lesson.title || !Array.isArray(lesson.steps)) {
    throw new Error(`Malformed lesson: ${JSON.stringify(lesson.id)}`);
  }
  const chess = new Chess(lesson.startFen);
  for (const step of lesson.steps) {
    try {
      chess.move(step.san);
    } catch {
      throw new Error(
        `Illegal move "${step.san}" in lesson ${lesson.id} at ply ${
          chess.history().length + 1
        }`,
      );
    }
  }
  if (!LESSON_CATEGORIES.some((category) => category.key === lesson.category)) {
    throw new Error(`Unknown category "${lesson.category}" in lesson ${lesson.id}`);
  }
}

export function difficultyForLesson(lesson: Lesson): 1 | 2 | 3 {
  if (lesson.difficulty) return lesson.difficulty;
  if (lesson.steps.length <= 3) return 1;
  if (lesson.steps.length <= 8) return 2;
  return 3;
}

export function estimatedMinutesForLesson(lesson: Lesson): number {
  return lesson.estimatedMinutes ?? Math.max(2, Math.ceil(lesson.steps.length / 2));
}

/** FEN after applying the first `upTo` steps of a lesson. */
export function fenAfterSteps(lesson: Lesson, upTo: number): string {
  const chess = new Chess(lesson.startFen);
  for (let i = 0; i < upTo && i < lesson.steps.length; i++) {
    try {
      chess.move(lesson.steps[i].san);
    } catch {
      break;
    }
  }
  return chess.fen();
}

export function groupByCategory(
  lessons: Lesson[],
): Record<string, Lesson[]> {
  const grouped: Record<string, Lesson[]> = {};
  for (const category of LESSON_CATEGORIES) {
    grouped[category.key] = [];
  }
  for (const lesson of lessons) {
    (grouped[lesson.category] ??= []).push(lesson);
  }
  return grouped;
}
