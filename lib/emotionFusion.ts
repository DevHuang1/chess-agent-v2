/**
 * Gameplay-signal fusion for the emotion pipeline.
 *
 * Facial expressions alone cannot reliably separate Calm vs Neutral vs
 * Focused (all present as a still, quiet face) or Frustrated vs Stressed
 * (both are negative affect). This module disambiguates them with signals
 * already available from the game itself:
 *
 *   - long think time on a stable position  -> Focused / Calm
 *   - the player's own eval dropping sharply -> Stressed / Frustrated
 *   - a comfortable material advantage       -> reinforces Confident
 *
 * Fusion is additive on top of the facial scores: game context can boost an
 * emotion the face already hints at, but can never invent one out of nothing
 * (boosts are only applied to non-zero facial baselines, except where noted).
 * Pure and synchronous by design; unit-testable without React or a webcam.
 */

import { pickEmotion, type EmotionScores } from "./emotionClassifier";
import type { EmotionLabel } from "./engineProfiles";

/** Telemetry snapshot describing recent player behaviour. */
export type GameSignals = {
  /** Time the player spent thinking about their most recent move (ms). */
  thinkTimeMs: number | null;
  /**
   * How much evaluation the player lost with their last move, in centipawns
   * (positive = the move was worse than the previous position). Null when no
   * move has been played yet.
   */
  lastMoveEvalLossCp: number | null;
  /** Setbacks (eval-dropping moves) within the recent window. */
  recentSetbacks: number;
  /** Current material/positional evaluation from White's perspective. */
  playerEvalCp: number | null;
};

export const FUSION_WEIGHTS = {
  /** Think time beyond this counts as deliberate deliberation. */
  longThinkMs: 12_000,
  /** An eval loss beyond this (cp) counts as a setback. */
  setbackCp: 150,
  /** Boost applied to focused after a long think on a stable position. */
  focusThinkBoost: 0.35,
  /** Extra calm credit when the player is unhurried and unharried. */
  calmUnhurriedBoost: 0.15,
  /** Confidence above this suppresses the settled-game calm boost. */
  calmCompeteMax: 0.35,
  /** Stress added per recent setback. */
  stressPerSetback: 0.4,
  /** Cap on the cumulative setback-driven stress boost. */
  maxStressBoost: 0.8,
  /** Frustration added per recent setback (smaller than stress). */
  frustrationPerSetback: 0.2,
  /** How much adversity erodes the "nothing is happening" neutral mass. */
  neutralAdversaryDamp: 0.15,
  /** Eval advantage (cp, White perspective) considered comfortable. */
  comfortCp: 300,
  /** Confident boost while comfortably ahead. */
  confidentComfortBoost: 0.15,
} as const;

function emptySignals(): GameSignals {
  return {
    thinkTimeMs: null,
    lastMoveEvalLossCp: null,
    recentSetbacks: 0,
    playerEvalCp: null,
  };
}

/** Treat partial telemetry defensively: any missing field is ignored. */
export function normalizeGameSignals(
  raw: Partial<GameSignals> | null | undefined,
): GameSignals {
  const base = emptySignals();
  if (!raw) return base;
  return {
    thinkTimeMs:
      typeof raw.thinkTimeMs === "number" && Number.isFinite(raw.thinkTimeMs)
        ? raw.thinkTimeMs
        : null,
    lastMoveEvalLossCp:
      typeof raw.lastMoveEvalLossCp === "number" &&
      Number.isFinite(raw.lastMoveEvalLossCp)
        ? raw.lastMoveEvalLossCp
        : null,
    recentSetbacks:
      typeof raw.recentSetbacks === "number" && Number.isFinite(raw.recentSetbacks)
        ? Math.max(0, Math.floor(raw.recentSetbacks))
        : 0,
    playerEvalCp:
      typeof raw.playerEvalCp === "number" && Number.isFinite(raw.playerEvalCp)
        ? raw.playerEvalCp
        : null,
  };
}

function boosted(scores: EmotionScores, label: EmotionLabel, amount: number) {
  scores[label] = scores[label] + amount;
}

/**
 * Fuse facial emotion scores with gameplay telemetry and return the final
 * label plus adjusted scores (useful for UI bars).
 */
export function fuseEmotion(
  facialScores: EmotionScores,
  rawSignals: Partial<GameSignals> | null | undefined,
): { emotion: EmotionLabel; scores: EmotionScores } {
  const s = normalizeGameSignals(rawSignals);
  const scores: EmotionScores = { ...facialScores };

  // Long deliberation over an unharmed position reads as concentration.
  const tookLongThink =
    s.thinkTimeMs !== null && s.thinkTimeMs >= FUSION_WEIGHTS.longThinkMs;
  const lastMoveWasSound =
    s.lastMoveEvalLossCp === null ||
    s.lastMoveEvalLossCp < FUSION_WEIGHTS.setbackCp;
  if (tookLongThink && lastMoveWasSound && scores.focused > 0.02) {
    boosted(scores, "focused", FUSION_WEIGHTS.focusThinkBoost);
  }

  // Adversity erodes the "nothing is happening" neutral signal: after
  // self-inflicted setbacks a still face is composure under strain, not
  // neutrality.
  if (s.recentSetbacks > 0) {
    scores.neutral = Math.max(
      0,
      scores.neutral -
        FUSION_WEIGHTS.neutralAdversaryDamp * Math.min(s.recentSetbacks, 3),
    );
  }

  // Recent self-inflicted setbacks amplify negative affect. Game context can
  // raise stress above its facial baseline (setbacks are arousing), as long
  // as the face shows at least some negative affect to build on.
  if (
    s.recentSetbacks > 0 &&
    scores.stressed + scores.frustrated > 0.05
  ) {
    boosted(
      scores,
      "stressed",
      Math.min(
        FUSION_WEIGHTS.maxStressBoost,
        FUSION_WEIGHTS.stressPerSetback * s.recentSetbacks,
      ),
    );
    boosted(
      scores,
      "frustrated",
      FUSION_WEIGHTS.frustrationPerSetback * Math.min(s.recentSetbacks, 3),
    );
  }

  // Playing well while ahead reinforces confidence.
  const comfortablyAhead =
    s.playerEvalCp !== null && s.playerEvalCp >= FUSION_WEIGHTS.comfortCp;
  if (comfortablyAhead && scores.confident > 0.05) {
    boosted(scores, "confident", FUSION_WEIGHTS.confidentComfortBoost);
  }

  // A quiet face in a stable game settles into calm — but not when the
  // player is visibly enjoying themselves (that reads as confident instead).
  if (
    scores.calm > 0 &&
    !tookLongThink &&
    scores.confident < FUSION_WEIGHTS.calmCompeteMax &&
    s.recentSetbacks === 0
  ) {
    boosted(scores, "calm", FUSION_WEIGHTS.calmUnhurriedBoost);
  }

  return { emotion: pickEmotion(scores), scores };
}
