import { describe, expect, it } from "vitest";
import {
  blendshapeEvidence,
  explainFaceFrame,
  type FaceFrame,
} from "./faceExplain";
import { BLENDSHAPE_WEIGHTS } from "./blendshapeEmotion";
import type { EmotionLabel } from "./engineProfiles";

/** Build MediaPipe-style blendshape categories from a name → score map. */
function shapes(entries: Record<string, number>) {
  return Object.entries(entries).map(([categoryName, score]) => ({
    categoryName,
    score,
  }));
}

function makeFrame(overrides: Partial<FaceFrame> = {}): FaceFrame {
  return {
    at: 1_000,
    source: "blendshapes",
    videoWidth: 640,
    videoHeight: 480,
    box: { x: 0.2, y: 0.1, width: 0.5, height: 0.6 },
    landmarks: [],
    evidence: null,
    emotion: "neutral" as EmotionLabel,
    fusionNotes: [],
    ...overrides,
  };
}

describe("blendshapeEvidence", () => {
  it("returns empty contributions for a completely still face", () => {
    const { contributions } = blendshapeEvidence(shapes({ jawOpen: 0 }));
    expect(contributions).toHaveLength(0);
  });

  it("weights contributions with the same mixers as the classifier", () => {
    const { contributions, valence, arousal } = blendshapeEvidence(
      shapes({ mouthSmileLeft: 0.8, mouthSmileRight: 0.6, jawOpen: 0.5 }),
    );

    // Smile: avg 0.7, weight 1 → valence +0.7. Jaw: 0.5 × 0.8 → arousal +0.4.
    const smile = contributions.find((c) => c.label === "smile");
    const jaw = contributions.find((c) => c.label === "jaw open");
    expect(smile?.effect).toBeCloseTo(BLENDSHAPE_WEIGHTS.smileValence * 0.7, 5);
    expect(jaw?.effect).toBeCloseTo(BLENDSHAPE_WEIGHTS.jawOpenArousal * 0.5, 5);

    // Effects agree with the aggregate reading.
    const valenceEffect = contributions
      .filter((c) => c.axis === "valence")
      .reduce((sum, c) => sum + c.effect, 0);
    const arousalEffect = contributions
      .filter((c) => c.axis === "arousal")
      .reduce((sum, c) => sum + c.effect, 0);
    expect(valenceEffect).toBeCloseTo(valence, 5);
    expect(arousalEffect).toBeCloseTo(arousal, 5);
  });

  it("sorts contributions by absolute effect, strongest first", () => {
    const { contributions } = blendshapeEvidence(
      shapes({
        mouthSmileLeft: 0.1,
        mouthSmileRight: 0.1,
        eyeWideLeft: 0.9,
        eyeWideRight: 0.9,
      }),
    );
    const effects = contributions.map((c) => Math.abs(c.effect));
    for (let i = 1; i < effects.length; i++) {
      expect(effects[i - 1]).toBeGreaterThanOrEqual(effects[i]);
    }
    expect(contributions[0].label).toBe("eye widen");
  });

  it("drops sub-noise-floor features", () => {
    const { contributions } = blendshapeEvidence(
      shapes({ mouthSmileLeft: 0.01, mouthSmileRight: 0.01 }),
    );
    expect(contributions).toHaveLength(0);
  });
});

describe("explainFaceFrame", () => {
  it("explains a blendshapes frame with a reading and signals", () => {
    const { contributions, valence, arousal } = blendshapeEvidence(
      shapes({ browDownLeft: 0.6, browDownRight: 0.6, jawOpen: 0.4 }),
    );
    const explanation = explainFaceFrame(
      makeFrame({
        evidence: {
          kind: "blendshapes",
          contributions,
          valence,
          arousal,
        },
      }),
    );

    expect(explanation.reading).toMatch(/valence −?\d\.\d{2} · arousal \d\.\d{2}/);
    expect(explanation.signals.length).toBeGreaterThan(0);
    expect(explanation.signals[0]).toMatch(/brow furrow|jaw open/);
  });

  it("explains a face-api frame with top expression channels", () => {
    const explanation = explainFaceFrame(
      makeFrame({
        source: "face-api",
        evidence: {
          kind: "expressions",
          channels: [
            { name: "happy", score: 0.71 },
            { name: "neutral", score: 0.18 },
          ],
        },
      }),
    );
    expect(explanation.reading).toBeNull();
    expect(explanation.signals).toEqual(["happy 0.71", "neutral 0.18"]);
  });

  it("handles a frame without evidence", () => {
    const explanation = explainFaceFrame(makeFrame());
    expect(explanation.reading).toBeNull();
    expect(explanation.signals).toEqual([]);
  });
});
