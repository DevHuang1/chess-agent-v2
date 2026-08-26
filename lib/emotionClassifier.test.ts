import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_THRESHOLDS,
  classifyEmotion,
  computeEmotionScores,
  normalizeExpressions,
  pickEmotion,
} from "./emotionClassifier";

describe("emotion classifier - expression normalization", () => {
  it("fills missing channels with zero", () => {
    const e = normalizeExpressions({ happy: 0.5 });
    expect(e.happy).toBe(0.5);
    expect(e.neutral).toBe(0);
    expect(e.sad).toBe(0);
  });

  it("treats null/undefined input and NaN as all-zero", () => {
    for (const input of [null, undefined, { happy: Number.NaN }]) {
      const e = normalizeExpressions(input);
      expect(Object.values(e).every((v) => v === 0)).toBe(true);
    }
  });
});

describe("emotion classifier - the three previously unreachable emotions", () => {
  it("classifies elevated fearful as stressed even when neutral dominates", () => {
    // Legacy argmax + 0.35 threshold would have returned "neutral" here.
    const { emotion } = classifyEmotion({ neutral: 0.4, fearful: 0.45 });
    expect(emotion).toBe("stressed");
  });

  it("combines disgust and anger into stressed", () => {
    const { emotion, scores } = classifyEmotion({
      disgusted: 0.35,
      angry: 0.3,
      neutral: 0.3,
    });
    expect(scores.stressed).toBeCloseTo(0.35 + 0.3 * 0.4, 5);
    expect(emotion).toBe("stressed");
  });

  it("classifies surprise as focused", () => {
    const { emotion } = classifyEmotion({ surprised: 0.6, neutral: 0.35 });
    expect(emotion).toBe("focused");
  });

  it("gives a clean strong-neutral face the calm label (previously unreachable)", () => {
    const { emotion } = classifyEmotion({ neutral: 0.85 });
    expect(emotion).toBe("calm");
  });

  it("keeps weak clean-neutral readings near the calm/neutral boundary", () => {
    // A mildly-expressed neutral face still leans calm; a heavily diluted
    // one falls back to neutral because competing mass erodes the score.
    expect(classifyEmotion({ neutral: 0.6 }).emotion).toBe("calm");
    expect(
      classifyEmotion({ neutral: 0.45, surprised: 0.25, sad: 0.2 }).emotion,
    ).toBe("neutral");
  });
});

describe("emotion classifier - previously working emotions stay stable", () => {
  it("classifies happiness as confident", () => {
    expect(classifyEmotion({ happy: 0.8 }).emotion).toBe("confident");
  });

  it("classifies sadness (with anger) as frustrated", () => {
    const { emotion, scores } = classifyEmotion({ sad: 0.6, angry: 0.2 });
    expect(emotion).toBe("frustrated");
    expect(scores.frustrated).toBeCloseTo(0.6 + 0.2 * 0.9, 5);
  });

  it("prefers confident when happiness outweighs calm-eligible neutrality", () => {
    expect(classifyEmotion({ happy: 0.55, neutral: 0.4 }).emotion).toBe(
      "confident",
    );
  });
});

describe("emotion classifier - scoring invariants", () => {
  it("never routes a happy face into calm regardless of neutral mass", () => {
    const scores = computeEmotionScores({ neutral: 0.6, happy: 0.4 });
    expect(scores.calm).toBe(0);
  });

  it("allows calm up to the configured happiness tolerance", () => {
    const scores = computeEmotionScores({
      neutral: 0.7,
      happy: CLASSIFIER_THRESHOLDS.calmHappyMax,
    });
    expect(scores.calm).toBeGreaterThan(0);
  });

  it("defaults an all-zero distribution to neutral instead of argmax noise", () => {
    expect(pickEmotion(computeEmotionScores({}))).toBe("neutral");
    expect(classifyEmotion(null).emotion).toBe("neutral");
  });

  it("produces a complete score record covering all six game emotions", () => {
    const scores = computeEmotionScores({ happy: 1 });
    expect(Object.keys(scores).sort()).toEqual(
      ["calm", "confident", "focused", "frustrated", "neutral", "stressed"],
    );
  });
});
