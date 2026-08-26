import { describe, expect, it } from "vitest";
import { computeEmotionScores, type EmotionScores } from "./emotionClassifier";
import {
  FUSION_WEIGHTS,
  fuseEmotion,
  normalizeGameSignals,
} from "./emotionFusion";

function facial(input: Parameters<typeof computeEmotionScores>[0]): EmotionScores {
  return computeEmotionScores(input);
}

const quiet: Partial<Parameters<typeof fuseEmotion>[1]> = {};

describe("emotion fusion - signal normalization", () => {
  it("fills missing telemetry with inert defaults", () => {
    const s = normalizeGameSignals(null);
    expect(s).toEqual({
      thinkTimeMs: null,
      lastMoveEvalLossCp: null,
      recentSetbacks: 0,
      playerEvalCp: null,
    });
  });

  it("clamps negative setback counts and drops NaN values", () => {
    const s = normalizeGameSignals({
      recentSetbacks: -4,
      thinkTimeMs: Number.NaN,
      playerEvalCp: 120,
    });
    expect(s.recentSetbacks).toBe(0);
    expect(s.thinkTimeMs).toBeNull();
    expect(s.playerEvalCp).toBe(120);
  });
});

describe("emotion fusion - disambiguating the weak facial signals", () => {
  it("long deliberation on a sound move promotes a hint of focus into focused", () => {
    const base = facial({ neutral: 0.5, surprised: 0.2 });
    const { emotion } = fuseEmotion(base, {
      ...quiet,
      thinkTimeMs: FUSION_WEIGHTS.longThinkMs + 100,
      lastMoveEvalLossCp: 20,
    });
    expect(emotion).toBe("focused");
  });

  it("long deliberation without any facial activation does not invent focus", () => {
    const base = facial({ neutral: 0.9 });
    const { emotion } = fuseEmotion(base, {
      ...quiet,
      thinkTimeMs: FUSION_WEIGHTS.longThinkMs + 100,
      lastMoveEvalLossCp: 20,
    });
    // Facial baseline is calm; fusion may reinforce calm but never focus.
    expect(["calm", "neutral"]).toContain(emotion);
  });

  it("a long think that followed a blunder does not count as focus", () => {
    const base = facial({ neutral: 0.5, surprised: 0.2, sad: 0.25 });
    const { emotion } = fuseEmotion(base, {
      ...quiet,
      thinkTimeMs: FUSION_WEIGHTS.longThinkMs + 100,
      lastMoveEvalLossCp: FUSION_WEIGHTS.setbackCp + 200,
      recentSetbacks: 1,
    });
    expect(emotion === "stressed" || emotion === "frustrated").toBe(true);
  });

  it("recent setbacks push mild negative affect over the stress line", () => {
    const base = facial({ sad: 0.3, neutral: 0.5 }); // frustrated-ish
    const { emotion } = fuseEmotion(base, {
      ...quiet,
      recentSetbacks: 2,
      lastMoveEvalLossCp: FUSION_WEIGHTS.setbackCp + 100,
    });
    expect(emotion).toBe("stressed");
  });

  it("comfortable advantage reinforces an existing confident read", () => {
    const base = facial({ happy: 0.35, neutral: 0.45 });
    const plain = fuseEmotion(base, quiet);
    const ahead = fuseEmotion(base, { ...quiet, playerEvalCp: 500 });
    expect(ahead.scores.confident).toBeGreaterThan(plain.scores.confident);
    expect(ahead.emotion).toBe("confident");
  });

  it("a clean face in a settled game settles into calm", () => {
    const base = facial({ neutral: 0.7 });
    const { emotion, scores } = fuseEmotion(base, {
      ...quiet,
      thinkTimeMs: 3000,
    });
    expect(scores.calm).toBeGreaterThan(base.calm);
    expect(emotion).toBe("calm");
  });
});

describe("emotion fusion - safety properties", () => {
  it("never changes the label when telemetry is absent", () => {
    const base = facial({ happy: 0.7 });
    const { emotion, scores } = fuseEmotion(base, quiet);
    expect(emotion).toBe("confident");
    expect(scores.confident).toBeCloseTo(base.confident, 10);
  });

  it("caps cumulative stress boosts", () => {
    const base = facial({ fearful: 0.3, neutral: 0.4 });
    const { scores } = fuseEmotion(base, { ...quiet, recentSetbacks: 50 });
    expect(scores.stressed - base.stressed).toBeLessThanOrEqual(
      FUSION_WEIGHTS.maxStressBoost + 1e-9,
    );
  });

  it("returns scores for all six emotions so UI bars stay populated", () => {
    const { scores } = fuseEmotion(facial({}), quiet);
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
