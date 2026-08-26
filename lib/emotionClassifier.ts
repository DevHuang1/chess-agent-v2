/**
 * Composite emotion classifier for the face-api.js expression backend.
 *
 * The legacy pipeline classified emotions by argmax over the seven raw
 * expressions with a flat 0.35 probability threshold. That made three game
 * emotions structurally unreachable:
 *
 *   - stressed  — `fearful`/`disgusted` almost never win the argmax
 *   - focused   — `surprised` rarely wins the argmax either
 *   - calm      — no expression ever mapped to it at all
 *
 * Instead of discarding all non-dominant signal, this module consumes the
 * full expression probability distribution and computes a competitive score
 * per game emotion (see computeEmotionScores). The label is simply the best
 * score, so elevated-but-not-dominant negatives still produce Stressed, a
 * clean strong-neutral face finally produces Calm, and so on.
 *
 * Pure and synchronous by design: unit-testable and reusable by both the
 * webcam hook (hooks/useEmotionDetection.ts) and future backends.
 */

import { EMOTION_LABELS, type EmotionLabel } from "./engineProfiles";

/** The seven FaceExpressionNet output classes, as probabilities in [0, 1]. */
export type ExpressionProbabilities = {
  happy: number;
  neutral: number;
  sad: number;
  angry: number;
  fearful: number;
  disgusted: number;
  surprised: number;
};

/** Competitive score per game emotion (higher = more evidence). */
export type EmotionScores = Record<EmotionLabel, number>;

/** Tunable cross-expression weights. Kept exported for tests and tuning. */
export const CLASSIFIER_WEIGHTS = {
  /** How strongly anger feeds frustration alongside sadness. */
  angryToFrustrated: 0.9,
  /** How strongly anger feeds stress alongside fear/disgust. */
  angryToStressed: 0.4,
} as const;

/**
 * Thresholds governing the calm-vs-neutral split. A "calm" face is one whose
 * neutral reading is clean: negative affect and happiness both low.
 */
export const CLASSIFIER_THRESHOLDS = {
  /** Total negative mass (sad+angry+fearful+disgusted) tolerated for calm. */
  calmNegativeMax: 0.15,
  /** Happiness tolerated before a neutral face reads as confident instead. */
  calmHappyMax: 0.35,
} as const;

const EXPRESSION_KEYS = [
  "happy",
  "neutral",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
] as const satisfies readonly (keyof ExpressionProbabilities)[];

/** Fill any missing expression channel with 0 so arithmetic is total. */
export function normalizeExpressions(
  raw: Partial<Record<string, number>> | null | undefined,
): ExpressionProbabilities {
  const out = {} as ExpressionProbabilities;
  for (const key of EXPRESSION_KEYS) {
    const value = raw?.[key];
    out[key] = typeof value === "number" && Number.isFinite(value)
      ? value
      : 0;
  }
  return out;
}

function isCalmFace(expressions: ExpressionProbabilities): boolean {
  const negativeMass =
    expressions.sad +
    expressions.angry +
    expressions.fearful +
    expressions.disgusted;
  return (
    negativeMass <= CLASSIFIER_THRESHOLDS.calmNegativeMax &&
    expressions.happy <= CLASSIFIER_THRESHOLDS.calmHappyMax
  );
}

/**
 * Compute a competitive score for every game emotion from the full
 * expression distribution.
 *
 * Scoring rules:
 *   - confident  = p(happy)
 *   - frustrated = p(sad) + w·p(angry)
 *   - stressed   = p(fearful) + p(disgusted) + w·p(angry)
 *   - focused    = p(surprised)
 *   - calm       = p(neutral), but only for clean low-arousal faces
 *   - neutral    = p(neutral) otherwise (or when other channels compete)
 */
export function computeEmotionScores(
  input: Partial<Record<string, number>> | null | undefined,
): EmotionScores {
  const e = normalizeExpressions(input);
  const calmFace = isCalmFace(e);

  return {
    confident: e.happy,
    frustrated: e.sad + CLASSIFIER_WEIGHTS.angryToFrustrated * e.angry,
    stressed:
      e.fearful + e.disgusted + CLASSIFIER_WEIGHTS.angryToStressed * e.angry,
    focused: e.surprised,
    // A genuinely relaxed face (clean neutral dominance) reads as Calm;
    // anything with competing affect keeps its Neutral weight instead.
    calm: calmFace ? e.neutral : 0,
    neutral: calmFace ? Math.max(0, 0.5 - e.neutral) : e.neutral,
  };
}

/**
 * Pick the highest-scoring emotion. Ties resolve toward earlier labels in
 * EMOTION_LABELS order (stressed > frustrated > calm > …) so behaviour is
 * deterministic; an all-zero distribution defaults to neutral.
 */
export function pickEmotion(scores: EmotionScores): EmotionLabel {
  let best: EmotionLabel = "neutral";
  let bestScore = 0;
  for (const label of EMOTION_LABELS) {
    if (scores[label] > bestScore) {
      best = label;
      bestScore = scores[label];
    }
  }
  return best;
}

/** Convenience wrapper: classify raw expression probabilities directly. */
export function classifyEmotion(input: Partial<Record<string, number>> | null | undefined): {
  emotion: EmotionLabel;
  scores: EmotionScores;
} {
  const scores = computeEmotionScores(input);
  return { emotion: pickEmotion(scores), scores };
}

/**
 * Emoji shown beside the camera feed (and reused by the training HUD).
 * Matches the emotion table in README.md.
 */
export const EMOTION_EMOJI: Record<EmotionLabel, string> = {
  calm: "😌",
  focused: "🎯",
  neutral: "😐",
  frustrated: "😤",
  stressed: "😰",
  confident: "😎",
};

/** CSS color token name (see app/globals.css) per game emotion. */
export const EMOTION_TOKEN: Record<EmotionLabel, string> = {
  calm: "emotion-calm",
  focused: "emotion-focused",
  neutral: "emotion-neutral",
  frustrated: "emotion-frustrated",
  stressed: "emotion-stressed",
  confident: "emotion-confident",
};
