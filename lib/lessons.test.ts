import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  fenAfterSteps,
  groupByCategory,
  loadLessons,
  validateLesson,
} from "./lessons";
import { pickNextPuzzle, type Puzzle } from "./puzzles";

describe("lessons - bundled content integrity", () => {
  it("every lesson replays legally with chess.js", async () => {
    const lessons = await loadLessons();
    expect(lessons.length).toBeGreaterThan(0);
    for (const lesson of lessons) {
      expect(() => validateLesson(lesson)).not.toThrow();
    }
  });

  it("covers all four categories with at least one lesson", async () => {
    const grouped = groupByCategory(await loadLessons());
    expect(grouped.openings.length).toBeGreaterThanOrEqual(1);
    expect(grouped.endgames.length).toBeGreaterThanOrEqual(1);
    expect(grouped.attacks.length).toBeGreaterThanOrEqual(1);
    expect(grouped.ready.length).toBeGreaterThanOrEqual(1);
  });

  it("computes legal FENs after partial step counts", async () => {
    const lessons = await loadLessons();
    const italian = lessons.find((l) => l.id === "italian-basics")!;
    const afterOne = fenAfterSteps(italian, 1);
    // After 1.e4 the pawn must be on e4.
    expect(afterOne.split(" ")[0]).toContain("P");
  });

  it("the smothered mate lesson ends in mate", async () => {
    const lessons = await loadLessons();
    const smothered = lessons.find((l) => l.id === "smothered-mate")!;
    const finalFen = fenAfterSteps(smothered, smothered.steps.length);
    expect(new Chess(finalFen).isCheckmate()).toBe(true);
  });

  it("every ready mating net ends in checkmate", async () => {
    const ready = groupByCategory(await loadLessons()).ready;
    expect(ready.length).toBeGreaterThanOrEqual(4);
    for (const lesson of ready) {
      const finalFen = fenAfterSteps(lesson, lesson.steps.length);
      expect(new Chess(finalFen).isCheckmate(), lesson.id).toBe(true);
    }
  });
});

describe("puzzle selection", () => {
  function makePuzzle(id: string, rating: number, theme: string): Puzzle {
    return {
      id,
      fen: "start",
      opponentMoveUci: "e2e4",
      playerMovesUci: ["e7e5"],
      movesSan: ["e4", "e5"],
      themes: [theme],
      primaryTheme: theme,
      rating,
      popularity: 90,
      solverColor: "b",
      openingTags: "",
      gameUrl: "",
    };
  }

  const pool = [
    makePuzzle("easy-fork", 900, "fork"),
    makePuzzle("mid-pin", 1500, "pin"),
    makePuzzle("hard-mate", 2100, "mate"),
    makePuzzle("over-cap", 2500, "fork"),
  ];

  it("never serves puzzles above the level ceiling", () => {
    for (let i = 0; i < 30; i++) {
      const picked = pickNextPuzzle({ puzzles: pool, maxRating: 1600 });
      expect(picked!.rating).toBeLessThanOrEqual(1600);
      expect(picked!.id).not.toBe("over-cap");
    }
  });

  it("avoids excluded ids when alternatives exist", () => {
    const picked = pickNextPuzzle({
      puzzles: pool,
      maxRating: 2200,
      excludeIds: new Set(["hard-mate", "mid-pin"]),
    });
    expect(["easy-fork"]).toContain(picked!.id);
  });

  it("falls back to the full eligible pool when the top band is empty", () => {
    const small = [makePuzzle("only-one", 800, "endgame")];
    expect(
      pickNextPuzzle({ puzzles: small, maxRating: 2200 })!.id,
    ).toBe("only-one");
  });

  it("returns null from an empty pool", () => {
    expect(pickNextPuzzle({ puzzles: [], maxRating: 2200 })).toBeNull();
  });
});
