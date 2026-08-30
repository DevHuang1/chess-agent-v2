/**
 * Explanations for the webcam emotion pipeline: turns raw facial readings
 * (MediaPipe blendshapes or face-api expression channels) into the list of
 * signals that led to the current emotion.
 *
 * Pure and synchronous by design; unit-testable without React or a webcam.
 */

import {
  blendshapeFeatureAverages,
  BLENDSHAPE_WEIGHTS,
  valenceArousalFromBlendshapes,
  type BlendshapeCategory,
} from "./blendshapeEmotion";
import type { EmotionLabel } from "./engineProfiles";

/** Normalized (0..1) point in video coordinates. */
export type FacePoint = { x: number; y: number };

/** Normalized (0..1) face bounding box in video coordinates. */
export type FaceBox = { x: number; y: number; width: number; height: number };

/** One anatomical feature's pull toward valence or arousal. */
export type Contribution = {
  /** Human-readable feature name ("brow furrow", "smile", ...). */
  label: string;
  /** Raw blendshape channels behind the average. */
  detail: string;
  /** Average raw score (0..1). */
  score: number;
  /** Which circumplex axis this feature feeds. */
  axis: "valence" | "arousal";
  /** Signed weighted effect on that axis. */
  effect: number;
};

export type FaceEvidence =
  | {
      kind: "blendshapes";
      contributions: Contribution[];
      valence: number;
      arousal: number;
    }
  | {
      kind: "expressions";
      channels: { name: string; score: number }[];
    };

/**
 * One detection snapshot, shared by the overlay canvas (via a ref, read at
 * rAF cadence) and the "why" card (via state, one update per cycle).
 * All geometry is normalized to the video frame (0..1).
 */
export type FaceFrame = {
  at: number;
  source: "face-api" | "blendshapes";
  /** Intrinsic video dimensions for object-cover mapping. */
  videoWidth: number;
  videoHeight: number;
  box: FaceBox | null;
  landmarks: FacePoint[];
  evidence: FaceEvidence | null;
  emotion: EmotionLabel;
  fusionNotes: string[];
};

/** Features below this raw score carry no explanation signal. */
const NOISE_FLOOR = 0.02;

/**
 * Decompose a blendshape reading into per-feature contributions on the
 * valence/arousal axes, using the same weights as the classifier
 * (lib/blendshapeEmotion.ts) so the explanation can never disagree with the
 * scores that produced the emotion.
 */
export function blendshapeEvidence(categories: BlendshapeCategory[]): {
  contributions: Contribution[];
  valence: number;
  arousal: number;
} {
  const f = blendshapeFeatureAverages(categories);
  const { valence, arousal } = valenceArousalFromBlendshapes(categories);
  const w = BLENDSHAPE_WEIGHTS;

  const entries: Contribution[] = [
    {
      label: "smile",
      detail: "mouthSmile L/R",
      score: f.mouthSmile,
      axis: "valence",
      effect: w.smileValence * f.mouthSmile,
    },
    {
      label: "frown",
      detail: "mouthFrown L/R",
      score: f.mouthFrown,
      axis: "valence",
      effect: w.frownValence * f.mouthFrown,
    },
    {
      label: "brow furrow",
      detail: "browDown L/R",
      score: f.browDown,
      axis: "valence",
      effect: w.browDownValence * f.browDown,
    },
    {
      label: "nose sneer",
      detail: "noseSneer L/R",
      score: f.noseSneer,
      axis: "valence",
      effect: w.sneerValence * f.noseSneer,
    },
    {
      label: "brow furrow",
      detail: "browDown L/R",
      score: f.browDown,
      axis: "arousal",
      effect: w.browDownArousal * f.browDown,
    },
    {
      label: "eye widen",
      detail: "eyeWide L/R",
      score: f.eyeWide,
      axis: "arousal",
      effect: w.eyeWideArousal * f.eyeWide,
    },
    {
      label: "jaw open",
      detail: "jawOpen",
      score: f.jawOpen,
      axis: "arousal",
      effect: w.jawOpenArousal * f.jawOpen,
    },
    {
      label: "brow raise",
      detail: "browInnerUp",
      score: f.browRaise,
      axis: "arousal",
      effect: w.browRaiseArousal * f.browRaise,
    },
    {
      label: "mouth stretch",
      detail: "mouthStretch L/R",
      score: f.mouthStretch,
      axis: "arousal",
      effect: w.mouthStretchArousal * f.mouthStretch,
    },
  ];

  return {
    contributions: entries
      .filter((c) => c.score > NOISE_FLOOR)
      .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)),
    valence,
    arousal,
  };
}

export type FaceExplanation = {
  /** "valence −0.12 · arousal 0.64" style reading of the raw face signal. */
  reading: string | null;
  /** Strongest facial signals, strongest first. */
  signals: string[];
};

function formatEffect(effect: number): string {
  return `${effect >= 0 ? "+" : "−"}${Math.abs(effect).toFixed(2)}`;
}

/** Build the human-readable "why" content from a frame's evidence. */
export function explainFaceFrame(frame: FaceFrame): FaceExplanation {
  const evidence = frame.evidence;
  if (!evidence) return { reading: null, signals: [] };

  if (evidence.kind === "blendshapes") {
    const v = evidence.valence;
    const a = evidence.arousal;
    return {
      reading: `valence ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} · arousal ${a.toFixed(2)}`,
      signals: evidence.contributions
        .slice(0, 4)
        .map(
          (c) =>
            `${c.label} ${c.score.toFixed(2)} (${c.detail}) → ${c.axis} ${formatEffect(c.effect)}`,
        ),
    };
  }

  return {
    reading: null,
    signals: evidence.channels
      .slice(0, 4)
      .map((c) => `${c.name} ${c.score.toFixed(2)}`),
  };
}
