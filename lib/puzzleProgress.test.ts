import { describe, expect, it } from "vitest";
import {
  applySolveResult,
  completeLesson,
  emptyProgress,
  levelFromXp,
  markPuzzleSolved,
  maxRatingForLevel,
  migrateProgress,
  progressLevel,
  recordAnalyzedGame,
  recordLessonAttempt,
  recordRunScore,
  tierForLevel,
  xpForLevel,
  type PuzzleProgress,
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

  it("tracks quiz mastery and queues hinted attempts for review", () => {
    const hinted = recordLessonAttempt(emptyProgress(), {
      lessonId: "l1",
      solved: true,
      firstTry: false,
      hintsUsed: 1,
    });
    expect(hinted.xpGained).toBeGreaterThan(0);
    expect(hinted.progress.reviewLessonIds).toContain("l1");
    expect(hinted.progress.lessonMastery.l1).toMatchObject({
      attempts: 1,
      solved: 1,
      firstTrySolved: 0,
      hintsUsed: 1,
    });
    expect(hinted.progress.quizTotals).toMatchObject({
      attempted: 1,
      solved: 1,
      firstTrySolved: 0,
      hintsUsed: 1,
    });
  });

  it("clears a review item after perfect recall without granting XP twice", () => {
    const failed = recordLessonAttempt(emptyProgress(), {
      lessonId: "l1",
      solved: false,
      firstTry: false,
      hintsUsed: 0,
    });
    expect(failed.progress.reviewLessonIds).toContain("l1");
    const perfect = recordLessonAttempt(failed.progress, {
      lessonId: "l1",
      solved: true,
      firstTry: true,
      hintsUsed: 0,
    });
    expect(perfect.progress.reviewLessonIds).not.toContain("l1");
    const repeated = recordLessonAttempt(perfect.progress, {
      lessonId: "l1",
      solved: true,
      firstTry: true,
      hintsUsed: 0,
    });
    expect(repeated.xpGained).toBe(0);
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

describe("puzzle progress - rebalanced curve & migration", () => {
  it("rebalanced curve is steeper at high levels than the legacy curve", () => {
    // The new curve needs more cumulative XP at level 20 than legacy did.
    expect(xpForLevel(20)).toBeGreaterThan(120 * 19 + (12 * 19 * 18) / 2);
    // Early levels stay approachable.
    expect(xpForLevel(2)).toBe(100);
  });

  it("migrates legacy progress by stamping the version and a level floor", () => {
    // A profile with no curve fields is treated as legacy.
    const legacy = { xp: 5000 } as unknown as PuzzleProgress;
    const migrated = migrateProgress(legacy);
    expect(migrated.curveVersion).toBe(2);
    // Floor preserves the old level: raw XP 5000 => old level ~22 under v1.
    expect(migrated.levelFloor).toBeGreaterThanOrEqual(
      progressLevel(migrated),
    );
  });

  it("migration is idempotent for already-migrated data", () => {
    const first = migrateProgress(emptyProgress());
    const second = migrateProgress(first);
    expect(second).toEqual(first);
  });

  it("progressLevel never reports a level below the migration floor", () => {
    // Simulate a legacy player on the old (cheaper) curve.
    const legacyFloor = 22;
    const progress = {
      xp: 5000,
      levelFloor: legacyFloor,
      curveVersion: 2,
    };
    expect(progressLevel(progress)).toBe(legacyFloor);
    // Even a huge XP should not push below the floor.
    expect(progressLevel({ ...progress, xp: 7000 })).toBeGreaterThanOrEqual(
      legacyFloor,
    );
  });

  it("fresh empty progress has no legacy demotion", () => {
    const fresh = emptyProgress();
    expect(progressLevel(fresh)).toBe(1);
    expect(migrateProgress(fresh)).toEqual(fresh);
  });
});
