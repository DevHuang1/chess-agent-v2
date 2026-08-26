import { describe, expect, it } from "vitest";
import {
  BLENDSHAPE_WEIGHTS,
  classifyBlendshapes,
  emotionScoresFromValenceArousal,
  valenceArousalFromBlendshapes,
} from "./blendshapeEmotion";
import { pickEmotion } from "./emotionClassifier";

function shapes(entries: Record<string, number>) {
  return Object.entries(entries).map(([categoryName, score]) => ({
    categoryName,
    score,
  }));
}

describe("blendshape backend - valence/arousal extraction", () => {
  it("a smiling face has positive valence", () => {
    const { valence, arousal } = valenceArousalFromBlendshapes(
      shapes({ mouthSmileLeft: 0.7, mouthSmileRight: 0.7 }),
    );
    expect(valence).toBeGreaterThan(0.5);
    expect(arousal).toBeLessThan(0.2);
  });

  it("brow lowering with wide eyes and an open jaw reads high-arousal negative", () => {
    const { valence, arousal } = valenceArousalFromBlendshapes(
      shapes({
        browDownLeft: 0.8,
        browDownRight: 0.8,
        eyeWideLeft: 0.6,
        eyeWideRight: 0.6,
        jawOpen: 0.5,
        mouthFrownLeft: 0.4,
        mouthFrownRight: 0.4,
      }),
    );
    expect(valence).toBeLessThan(-0.3);
    expect(arousal).toBeGreaterThan(0.6);
  });

  it("clamps malformed and out-of-range inputs", () => {
    const { valence, arousal } = valenceArousalFromBlendshapes([
      { categoryName: "jawOpen", score: Number.NaN },
      { categoryName: "mouthSmileLeft", score: 42 },
      { categoryName: "mouthSmileRight", score: -42 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    // Left smile clamps to 1, right to 0 → average 0.5.
    expect(valence).toBe(0.5);
    expect(arousal).toBe(0);
  });

  it("respects the configured anatomical mixers", () => {
    const shapesInput = shapes({ browDownLeft: 1, browDownRight: 1 });
    const { arousal } = valenceArousalFromBlendshapes(shapesInput);
    expect(arousal).toBeCloseTo(BLENDSHAPE_WEIGHTS.browDownArousal, 5);
  });
});

describe("blendshape backend - circumplex classification", () => {
  it("maps the previously unreachable emotions to distinct regions", () => {
    // Calm: positive-leaning valence, low arousal.
    expect(pickEmotion(emotionScoresFromValenceArousal(0.1, 0.1))).toBe("calm");
    // Focused: neutral valence, moderate-high arousal.
    expect(pickEmotion(emotionScoresFromValenceArousal(0, 0.45))).toBe(
      "focused",
    );
    // Stressed: strongly negative valence, high arousal.
    expect(pickEmotion(emotionScoresFromValenceArousal(-0.6, 0.8))).toBe(
      "stressed",
    );
  });

  it("separates frustrated (mid arousal) from stressed (high arousal)", () => {
    expect(pickEmotion(emotionScoresFromValenceArousal(-0.5, 0.45))).toBe(
      "frustrated",
    );
    expect(pickEmotion(emotionScoresFromValenceArousal(-0.55, 0.75))).toBe(
      "stressed",
    );
  });

  it("keeps confident and calm distinct on the arousal axis", () => {
    expect(pickEmotion(emotionScoresFromValenceArousal(0.5, 0.6))).toBe(
      "confident",
    );
    expect(pickEmotion(emotionScoresFromValenceArousal(0.35, 0.15))).toBe(
      "calm",
    );
  });

  it("end-to-end: tense blendshapes classify as stressed", () => {
    const { emotion } = classifyBlendshapes(
      shapes({
        browDownLeft: 0.9,
        browDownRight: 0.9,
        eyeWideLeft: 0.5,
        eyeWideRight: 0.5,
        mouthFrownLeft: 0.6,
        mouthFrownRight: 0.6,
      }),
    );
    expect(emotion).toBe("stressed");
  });

  it("end-to-end: a blank face reads as calm, not neutral-only", () => {
    const { emotion } = classifyBlendshapes(shapes({ _neutral: 1 }));
    expect(["calm", "neutral"]).toContain(emotion);
  });

  it("produces scores for all six emotions for the UI bars", () => {
    const { scores } = classifyBlendshapes([]);
    expect(Object.keys(scores).sort()).toEqual([
      "calm",
      "confident",
      "focused",
      "frustrated",
      "neutral",
      "stressed",
    ]);
  });
});
