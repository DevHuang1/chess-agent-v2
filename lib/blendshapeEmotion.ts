/**
 * Valence/arousal emotion backend based on MediaPipe FaceLandmarker
 * blendshapes (@mediapipe/tasks-vision).
 *
 * The seven-class FaceExpressionNet cannot express where a face sits on the
 * arousal axis, which is exactly what separates Calm (low arousal), Neutral
 * (moderate-low), Focused (moderate-high) and Stressed (high). The 52-face
 * blendshapes give direct anatomical access to that axis:
 *
 *   valence ≈ smiling − frowning − brow-lowering − nose-sneer
 *   arousal ≈ brow-down + eye-widen + jaw-open + brow-raise + mouth-stretch
 *
 * A (valence, arousal) reading is then scored against per-emotion prototype
 * points on the Russell circumplex with Gaussian kernels, producing smooth
 * scores for all six game emotions (usable directly by the UI bars).
 *
 * Pure and synchronous by design; unit-testable without a model download.
 */

import { pickEmotion, type EmotionScores } from "./emotionClassifier";
import type { EmotionLabel } from "./engineProfiles";

export type BlendshapeCategory = { categoryName: string; score: number };

/** Tunable anatomical mixers. Kept exported for tests and tuning. */
export const BLENDSHAPE_WEIGHTS = {
  smileValence: 1,
  frownValence: -1,
  browDownValence: -0.5,
  sneerValence: -0.5,
  browDownArousal: 0.5,
  eyeWideArousal: 1,
  jawOpenArousal: 0.8,
  browRaiseArousal: 0.5,
  mouthStretchArousal: 0.3,
} as const;

function avg(
  byName: Map<string, number>,
  names: string[],
): number {
  let total = 0;
  for (const n of names) total += byName.get(n) ?? 0;
  return total / names.length;
}

/** Compute (valence ∈ [-1,1], arousal ∈ [0,1]) from raw blendshape scores. */
export function valenceArousalFromBlendshapes(
  categories: BlendshapeCategory[],
): { valence: number; arousal: number } {
  const f = blendshapeFeatureAverages(categories);
  const w = BLENDSHAPE_WEIGHTS;

  const valence =
    w.smileValence * f.mouthSmile +
    w.frownValence * f.mouthFrown +
    w.browDownValence * f.browDown +
    w.sneerValence * f.noseSneer;

  const arousal = Math.max(
    0,
    Math.min(
      1,
      w.browDownArousal * f.browDown +
        w.eyeWideArousal * f.eyeWide +
        w.jawOpenArousal * f.jawOpen +
        w.browRaiseArousal * f.browRaise +
        w.mouthStretchArousal * f.mouthStretch,
    ),
  );

  return { valence: Math.max(-1, Math.min(1, valence)), arousal };
}

/** Per-feature averages over left/right blendshape pairs (each 0..1). */
export type BlendshapeFeatureAverages = {
  mouthSmile: number;
  mouthFrown: number;
  browDown: number;
  noseSneer: number;
  eyeWide: number;
  jawOpen: number;
  browRaise: number;
  mouthStretch: number;
};

/**
 * Averages the left/right blendshape pairs into named anatomical features.
 * Single source of truth for both the valence/arousal math above and the
 * "why this emotion" explanations (lib/faceExplain.ts).
 */
export function blendshapeFeatureAverages(
  categories: BlendshapeCategory[],
): BlendshapeFeatureAverages {
  const byName = new Map<string, number>();
  for (const c of categories) {
    if (typeof c?.score === "number" && Number.isFinite(c.score)) {
      byName.set(c.categoryName, Math.max(0, Math.min(1, c.score)));
    }
  }

  return {
    mouthSmile: avg(byName, ["mouthSmileLeft", "mouthSmileRight"]),
    mouthFrown: avg(byName, ["mouthFrownLeft", "mouthFrownRight"]),
    browDown: avg(byName, ["browDownLeft", "browDownRight"]),
    noseSneer: avg(byName, ["noseSneerLeft", "noseSneerRight"]),
    eyeWide: avg(byName, ["eyeWideLeft", "eyeWideRight"]),
    jawOpen: byName.get("jawOpen") ?? 0,
    browRaise: byName.get("browInnerUp") ?? 0,
    mouthStretch: avg(byName, ["mouthStretchLeft", "mouthStretchRight"]),
  };
}

/**
 * Prototype points per game emotion on the circumplex.
 * Valence axis: [-1 .. 1] (negative → positive). Arousal axis: [0 .. 1].
 */
export const VALENCE_AROUSAL_PROTOTYPES: Record<
  EmotionLabel,
  { valence: number; arousal: number }
> = {
  confident: { valence: 0.5, arousal: 0.6 },
  calm: { valence: 0.1, arousal: 0.12 },
  neutral: { valence: 0.0, arousal: 0.22 },
  focused: { valence: 0.0, arousal: 0.42 },
  stressed: { valence: -0.55, arousal: 0.75 },
  frustrated: { valence: -0.45, arousal: 0.45 },
};

/** Gaussian kernel width for prototype scoring. */
const PROTOTYPE_SIGMA = 0.3;

/**
 * Soft scores for every game emotion given a (valence, arousal) reading.
 * score(emotion) = exp(-d² / 2σ²) over the Euclidean distance d to its
 * prototype point, so nearby readings light up smoothly instead of snapping.
 */
export function emotionScoresFromValenceArousal(
  valence: number,
  arousal: number,
): EmotionScores {
  const scores = {} as EmotionScores;
  for (const [label, proto] of Object.entries(VALENCE_AROUSAL_PROTOTYPES)) {
    const dv = valence - proto.valence;
    const da = arousal - proto.arousal;
    scores[label as EmotionLabel] = Math.exp(
      -(dv * dv + da * da) / (2 * PROTOTYPE_SIGMA * PROTOTYPE_SIGMA),
    );
  }
  return scores;
}

/** Convenience wrapper: blendshape categories → label + scores. */
export function classifyBlendshapes(categories: BlendshapeCategory[]): {
  emotion: EmotionLabel;
  scores: EmotionScores;
  valence: number;
  arousal: number;
} {
  const { valence, arousal } = valenceArousalFromBlendshapes(categories);
  const scores = emotionScoresFromValenceArousal(valence, arousal);
  return { emotion: pickEmotion(scores), scores, valence, arousal };
}
