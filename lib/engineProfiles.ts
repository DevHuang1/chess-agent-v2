/**
 * Single source of truth for emotion → Stockfish strength profiles.
 *
 * This module is imported by the frontend (header display), the Next.js
 * bot-move route (JS fallback engine), and mirrored by the Python backend
 * (backend/main.py EMOTION_STRENGTH_PROFILES). Keep all three in sync —
 * the values here are canonical.
 */

export type EmotionLabel =
  | "calm"
  | "focused"
  | "neutral"
  | "frustrated"
  | "stressed"
  | "confident";

export type EngineProfile = {
  depth: number;
  skillLevel: number;
  elo: number;
};

export const EMOTION_PROFILES: Record<EmotionLabel, EngineProfile> = {
  stressed: { depth: 1, skillLevel: 1, elo: 1320 },
  frustrated: { depth: 2, skillLevel: 3, elo: 1320 },
  calm: { depth: 4, skillLevel: 6, elo: 1600 },
  neutral: { depth: 6, skillLevel: 10, elo: 2000 },
  focused: { depth: 8, skillLevel: 15, elo: 2600 },
  confident: { depth: 10, skillLevel: 20, elo: 3190 },
};

export const MIN_UCI_ELO = 1320;
export const MAX_UCI_ELO = 3190;

export const EMOTION_LABELS = Object.keys(EMOTION_PROFILES) as EmotionLabel[];

/** Resolve an arbitrary emotion string to a known label, defaulting to neutral. */
export function normalizeEmotion(emotion: string): EmotionLabel {
  const normalized = emotion.trim().toLowerCase();
  return (EMOTION_LABELS as string[]).includes(normalized)
    ? (normalized as EmotionLabel)
    : "neutral";
}

/** Clamp an ELO value into Stockfish's supported UCI_Elo range. */
export function clampElo(elo: number): number {
  return Math.max(MIN_UCI_ELO, Math.min(MAX_UCI_ELO, elo));
}
