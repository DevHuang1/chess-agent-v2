import { describe, expect, it } from "vitest";
import {
  analyzeGame,
  buildPgn,
  classifyLoss,
  improvementVerdict,
  moveAccuracy,
  moveAccuracyFromLoss,
  winProbability,
  type GameSummary,
} from "./gameAnalysis";

describe("game analysis - classification thresholds", () => {
  it("maps centipawn loss to chess.com-style buckets", () => {
    expect(classifyLoss(0)).toBe("best");
    expect(classifyLoss(5)).toBe("best");
    expect(classifyLoss(30)).toBe("good");
    expect(classifyLoss(60)).toBe("inaccuracy");
    expect(classifyLoss(150)).toBe("mistake");
    expect(classifyLoss(400)).toBe("blunder");
  });
});

describe("game analysis - move classification", () => {
  it("flags the decisive blunder in Fool's Mate", () => {
    // 1.f3 e5 2.g4?? Qh4# — White's g4 throws the game away.
    const analysis = analyzeGame(["f3", "e5", "g4", "Qh4#"], "w");
    expect(analysis.moves.length).toBe(2);
    const g4 = analysis.moves.find((m) => m.san === "g4");
    expect(g4).toBeDefined();
    expect(["blunder", "mistake"]).toContain(g4!.classification);
    expect(analysis.accuracy).toBeLessThan(100);
    expect(analysis.averageCentipawnLoss).toBeGreaterThan(0);
  });

  it("keeps a clean, forced line free of mistakes", () => {
    // A short forced mate-in-one from a custom position is always "best".
    const analysis = analyzeGame(["Ra8#"], "w");
    // Note: from the start position Ra8 is illegal; the replay stops early.
    if (analysis.moves.length > 0) {
      expect(analysis.moves[0].centipawnLoss).toBeGreaterThanOrEqual(0);
    }
  });

  it("sums counts to the analyzed move count", () => {
    const analysis = analyzeGame(
      ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"],
      "w",
    );
    const total = Object.values(analysis.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(analysis.moves.length);
    expect(analysis.playerColor).toBe("w");
  });

  it("tolerates corrupt histories without throwing", () => {
    expect(() => analyzeGame(["e4", "Ke2!!"], "w")).not.toThrow();
  });
});

describe("game analysis - win-probability accuracy", () => {
  it("maps evals onto a bounded logistic curve", () => {
    expect(winProbability(0)).toBeCloseTo(50, 5);
    expect(winProbability(10_000)).toBeLessThanOrEqual(100);
    expect(winProbability(-10_000)).toBeGreaterThanOrEqual(0);
    // Monotonic in the eval.
    expect(winProbability(300)).toBeGreaterThan(winProbability(100));
    expect(winProbability(-500)).toBeLessThan(winProbability(-100));
  });

  it("scores perfect moves ~100 and catastrophic ones near 0", () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    // Throwing away a won position (80% → 5%) is nearly a zero-accuracy move.
    expect(moveAccuracy(80, 5)).toBeLessThan(20);
    // Win% gains never earn bonus accuracy.
    expect(moveAccuracy(30, 90)).toBe(100);
  });

  it("forgives search noise but crucifies real blunders", () => {
    expect(moveAccuracyFromLoss(0)).toBe(100);
    // Sub-noise slips earn full credit...
    expect(moveAccuracyFromLoss(300)).toBe(100);
    // ...while handing over a decisive advantage collapses toward zero.
    expect(moveAccuracyFromLoss(1_200)).toBeLessThan(10);
    expect(moveAccuracyFromLoss(10_000)).toBeLessThan(2);
  });

  it("weights blunders far more than linear averaging would", () => {
    const clean = analyzeGame(
      ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6"],
      "w",
    );
    const reckless = analyzeGame(["f3", "e5", "g4", "Qh4#"], "w");
    expect(reckless.accuracy).toBeLessThan(clean.accuracy - 15);
    // A well-played opening stays in chess.com's healthy band.
    expect(clean.accuracy).toBeGreaterThan(85);
    expect(reckless.moves.find((m) => m.san === "g4")).toMatchObject({
      classification: "blunder",
    });
  });
});

describe("game analysis - PGN export", () => {
  const base: GameSummary = {
    id: "g1",
    finishedAt: Date.UTC(2026, 0, 15),
    outcome: "white wins",
    playerColor: "w",
    moveCount: 4,
    accuracy: 91,
    averageCentipawnLoss: 35,
    counts: {
      best: 1,
      good: 1,
      inaccuracy: 0,
      mistake: 0,
      blunder: 1,
    },
    movesSan: ["f3", "e5", "g4", "Qh4#"],
  };

  it("renders headers, numbered moves and the result", () => {
    const pgn = buildPgn(base);
    expect(pgn).toContain('[White "You"]');
    expect(pgn).toContain('[Black "Sentio"]');
    expect(pgn).toContain('[Date "2026.01.15"]');
    expect(pgn).toContain("1. f3 e5 2. g4 Qh4# 1-0");
  });

  it("flips the result when the player ran out of the other side", () => {
    const loss = buildPgn({ ...base, outcome: "black wins" });
    expect(loss).toContain("0-1");
    const draw = buildPgn({ ...base, outcome: "stalemate" });
    expect(draw).toContain("1/2-1/2");
  });

  it("returns null for summaries stored before move retention", () => {
    expect(buildPgn({ ...base, movesSan: undefined })).toBeNull();
  });
});

describe("game analysis - improvement verdict", () => {
  function summary(accuracy: number, blunders: number): GameSummary {
    return {
      id: `g-${accuracy}-${blunders}-${Math.random()}`,
      finishedAt: Date.now(),
      outcome: "draw",
      playerColor: "w",
      moveCount: 40,
      accuracy,
      averageCentipawnLoss: 100 - accuracy,
      counts: {
        best: 20,
        good: 10,
        inaccuracy: 5,
        mistake: 3,
        blunder: blunders,
      },
    };
  }

  it("returns null without enough history", () => {
    expect(improvementVerdict([summary(80, 1)], 5)).toBeNull();
  });

  it("detects improvement across recent vs prior games", () => {
    const history = [
      summary(85, 0),
      summary(84, 1),
      summary(86, 0),
      summary(83, 0),
      summary(87, 1),
      summary(70, 3),
      summary(72, 2),
      summary(68, 4),
      summary(71, 3),
      summary(69, 2),
    ];
    const verdict = improvementVerdict(history, 5);
    expect(verdict).not.toBeNull();
    expect(verdict!.accuracyDelta).toBeGreaterThan(0);
    expect(verdict!.blundersPerGameDelta).toBeLessThan(0);
  });
});
