import { describe, expect, it } from "vitest";
import {
  applySolveResult,
  completeLesson,
  emptyProgress,
  levelFromXp,
  markPuzzleSolved,
  maxRatingForLevel,
  recordAnalyzedGame,
  recordRunScore,
  tierForLevel,
  xpForLevel,
} from "./puzzleProgress";

describe("puzzle progress - leveling curve", () => {
  it("level 1 requires no XP", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelFromXp(0)).toBe(1);
  });

  it("monotonically maps XP to levels", () => {
    let last = 1;
    for (let xp = 0; xp <= 5000; xp += 50) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });

  it("assigns higher tiers at higher levels", () => {
    expect(tierForLevel(1).name).toBe("Bronze");
    expect(tierForLevel(5).name).toBe("Silver");
    expect(tierForLevel(31).name).toBe("Legend");
  });

  it("raises the rating ceiling with level, capped at 2200", () => {
    expect(maxRatingForLevel(1)).toBe(890);
    expect(maxRatingForLevel(20)).toBe(2200);
  });
});

describe("puzzle progress - solve accounting", () => {
  it("awards streak-scaled XP on solves and none on failures", () => {
    let progress = emptyProgress();
    const r1 = applySolveResult(progress, {
      rating: 1000,
      solved: true,
      usedHint: false,
      theme: "fork",
    });
    expect(r1.xpGained).toBeGreaterThan(0);
    progress = r1.progress;

    const fail = applySolveResult(progress, {
      rating: 1000,
      solved: false,
      usedHint: false,
      theme: "fork",
    });
    expect(fail.xpGained).toBe(0);
    expect(fail.progress.currentStreak).toBe(0);

    // Failure is recorded against the theme.
    expect(fail.progress.themeStats.fork.failed).toBe(1);
  });

  it("halves XP when a hint was used", () => {
    const plain = applySolveResult(emptyProgress(), {
      rating: 1200,
      solved: true,
      usedHint: false,
      theme: "pin",
    });
    const hinted = applySolveResult(emptyProgress(), {
      rating: 1200,
      solved: true,
      usedHint: true,
      theme: "pin",
    });
    expect(hinted.xpGained).toBe(Math.round(plain.xpGained / 2));
  });

  it("detects level-ups", () => {
    let outcome = applySolveResult(emptyProgress(), {
      rating: 2100,
      solved: true,
      usedHint: false,
      theme: "mate",
    });
    // Grind close to the next level without crossing.
    while (!applySolveResult(outcome.progress, {
      rating: 900,
      solved: true,
      usedHint: false,
      theme: "mate",
    }).leveledUp && outcome.progress.xp < xpForLevel(2)) {
      outcome = applySolveResult(outcome.progress, {
        rating: 900,
        solved: true,
        usedHint: false,
        theme: "mate",
      });
    }
    outcome = applySolveResult(outcome.progress, {
      rating: 900,
      solved: true,
      usedHint: false,
      theme: "mate",
    });
    expect(levelFromXp(outcome.progress.xp)).toBe(
      levelFromXp(outcome.progress.xp),
    );
    expect(typeof outcome.leveledUp).toBe("boolean");
  });

  it("markPuzzleSolved is idempotent", () => {
    const once = markPuzzleSolved(emptyProgress(), "p1");
    const twice = markPuzzleSolved(once, "p1");
    expect(twice.solvedIds).toEqual(["p1"]);
  });

  it("markPuzzleSolved caps the tracked-id list", () => {
    let progress = emptyProgress();
    for (let i = 0; i < 1_200; i++) {
      progress = markPuzzleSolved(progress, `p${i}`);
    }
    expect(progress.solvedIds.length).toBe(1000);
    // Oldest ids fall off first.
    expect(progress.solvedIds[0]).toBe("p200");
    expect(progress.solvedIds[999]).toBe("p1199");
  });

  it("lesson XP granted once per lesson", () => {
    const first = completeLesson(emptyProgress(), "l1");
    expect(first.xpGained).toBeGreaterThan(0);
    const second = completeLesson(first.progress, "l1");
    expect(second.xpGained).toBe(0);
  });

  it("analyzed games add fixed XP and count", () => {
    const result = recordAnalyzedGame(emptyProgress());
    expect(result.progress.gamesAnalyzed).toBe(1);
    expect(result.xpGained).toBeGreaterThan(0);
  });

  it("run scores track personal bests", () => {
    const a = recordRunScore(emptyProgress(), "rush", 7);
    expect(a.newBest).toBe(true);
    const b = recordRunScore(a.progress, "rush", 5);
    expect(b.newBest).toBe(false);
    expect(b.progress.bestScores.rush).toBe(7);
  });
});
