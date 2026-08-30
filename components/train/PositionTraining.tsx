"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { ChessboardOptions } from "react-chessboard";
import dynamic from "next/dynamic";
import {
  LESSON_CATEGORIES,
  difficultyForLesson,
  estimatedMinutesForLesson,
  fenAfterSteps,
  type Lesson,
} from "@/lib/lessons";
import type {
  LessonAttemptInput,
  PuzzleProgress,
} from "@/lib/puzzleProgress";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-square animate-pulse rounded-xl bg-zinc-900/70 light:bg-slate-200" />
    ),
  },
);

type LessonMode = "study" | "practice";
type CategoryFilter = "all" | (typeof LESSON_CATEGORIES)[number]["key"];
type DifficultyFilter = "all" | 1 | 2 | 3;
type StatusFilter = "all" | "new" | "completed" | "review";

export default function PositionTraining({
  progress,
  onPracticeResult,
  onPlayFromPosition,
  onExit,
  initialMode = "study",
  reviewOnly = false,
}: {
  progress: PuzzleProgress;
  onPracticeResult: (result: LessonAttemptInput) => void;
  onPlayFromPosition: (fen: string) => void;
  onExit: () => void;
  initialMode?: LessonMode;
  reviewOnly?: boolean;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all");
  const [status, setStatus] = useState<StatusFilter>(reviewOnly ? "review" : "all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<LessonMode>(initialMode);
  const [stepIndex, setStepIndex] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [practiceKey, setPracticeKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/lessons")
      .then((mod) => mod.loadLessons())
      .then((loaded) => {
        if (!cancelled) setLessons(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to load lessons.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadVersion]);

  const filteredLessons = useMemo(() => {
    if (!lessons) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return lessons.filter((lesson) => {
      const completed = progress.lessonsCompleted.includes(lesson.id);
      const needsReview = progress.reviewLessonIds.includes(lesson.id);
      if (reviewOnly && !needsReview) return false;
      if (category !== "all" && lesson.category !== category) return false;
      if (difficulty !== "all" && difficultyForLesson(lesson) !== difficulty) return false;
      if (status === "new" && completed) return false;
      if (status === "completed" && !completed) return false;
      if (status === "review" && !needsReview) return false;
      if (
        normalizedQuery &&
        !`${lesson.title} ${lesson.intro} ${(lesson.tags ?? []).join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [lessons, query, category, difficulty, status, progress, reviewOnly]);

  const lesson = useMemo(
    () => lessons?.find((candidate) => candidate.id === selectedId) ?? null,
    [lessons, selectedId],
  );

  useEffect(() => {
    if (!autoPlaying || !lesson || stepIndex >= lesson.steps.length) return;
    const id = window.setTimeout(() => setStepIndex((step) => step + 1), 900);
    return () => window.clearTimeout(id);
  }, [autoPlaying, stepIndex, lesson]);

  const openLesson = (id: string) => {
    setSelectedId(id);
    setStepIndex(0);
    setAutoPlaying(false);
    setMode(initialMode);
    setPracticeKey((key) => key + 1);
  };

  if (loadError) {
    return (
      <CenteredState>
        <Card className="max-w-md border-red-500/30 p-5 text-center">
          <h2 className="font-mono text-base font-bold text-red-300">
            Training positions could not be loaded
          </h2>
          <p className="mt-2 text-xs text-zinc-400">{loadError}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setLoadError(null);
              setLoadVersion((version) => version + 1);
            }}
          >
            Try again
          </Button>
        </Card>
      </CenteredState>
    );
  }

  if (!lessons) return <CenteredState>Loading position library…</CenteredState>;

  if (lesson) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>
            ← Position library
          </Button>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-1 light:border-slate-300 light:bg-slate-100">
            <Button
              variant={mode === "study" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setMode("study")}
            >
              Study
            </Button>
            <Button
              variant={mode === "practice" ? "accent" : "ghost"}
              size="sm"
              onClick={() => {
                setMode("practice");
                setPracticeKey((key) => key + 1);
              }}
            >
              Practice quiz
            </Button>
          </div>
        </div>

        {mode === "study" ? (
          <StudyView
            lesson={lesson}
            stepIndex={stepIndex}
            autoPlaying={autoPlaying}
            onStep={(next) => {
              setAutoPlaying(false);
              setStepIndex(next);
            }}
            onReplay={() => {
              setStepIndex(0);
              setAutoPlaying(true);
            }}
            onStartPractice={() => {
              setMode("practice");
              setPracticeKey((key) => key + 1);
            }}
            onPlayFromPosition={onPlayFromPosition}
          />
        ) : (
          <PracticeView
            key={`${lesson.id}-${practiceKey}`}
            lesson={lesson}
            completedBefore={progress.lessonsCompleted.includes(lesson.id)}
            onResult={onPracticeResult}
            onStudyLine={() => {
              setStepIndex(0);
              setMode("study");
            }}
            onRetry={() => setPracticeKey((key) => key + 1)}
            onPlayFromPosition={onPlayFromPosition}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onExit}>
          ← Back
        </Button>
        <div className="text-center">
          <h2 className="font-mono text-lg font-bold train-accent-text">
            {reviewOnly
              ? "↻ Mistake Review"
              : initialMode === "practice"
                ? "◇ Quiz Arena"
                : "□ Position Library"}
          </h2>
          <p className="text-[11px] text-zinc-500">
            {filteredLessons.length} position{filteredLessons.length === 1 ? "" : "s"}
          </p>
        </div>
        <Badge variant="muted">
          {progress.lessonsCompleted.length}/{lessons.length} mastered
        </Badge>
      </div>

      {!reviewOnly && (
        <div className="flex flex-wrap justify-center gap-1 rounded-xl border border-zinc-800/70 bg-zinc-950/30 p-2 light:border-slate-300 light:bg-slate-100/60">
          <FilterButton active={category === "all"} onClick={() => setCategory("all")}>
            All
          </FilterButton>
          {LESSON_CATEGORIES.map((item) => (
            <FilterButton
              key={item.key}
              active={category === item.key}
              onClick={() => setCategory(item.key)}
            >
              {item.label}
            </FilterButton>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search positions or themes…"
          aria-label="Search training positions"
        />
        <div className="flex flex-wrap gap-1">
          {(["all", 1, 2, 3] as const).map((value) => (
            <FilterButton
              key={value}
              active={difficulty === value}
              onClick={() => setDifficulty(value)}
            >
              {value === "all" ? "Any level" : `Level ${value}`}
            </FilterButton>
          ))}
        </div>
        {!reviewOnly && (
          <div className="flex flex-wrap gap-1">
            {(["all", "new", "completed", "review"] as const).map((value) => (
              <FilterButton
                key={value}
                active={status === value}
                onClick={() => setStatus(value)}
              >
                {value === "all" ? "Any status" : value}
              </FilterButton>
            ))}
          </div>
        )}
      </div>

      {filteredLessons.length === 0 ? (
        <CenteredState>
          <div className="text-center">
            <div className="text-3xl">{reviewOnly ? "✓" : "⌕"}</div>
            <p className="mt-2 text-sm font-semibold">
              {reviewOnly ? "Your review queue is clear" : "No positions match"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {reviewOnly
                ? "Hinted and missed quizzes will appear here."
                : "Try a different category, level, or search."}
            </p>
          </div>
        </CenteredState>
      ) : (
        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pt-1 sm:grid-cols-2 xl:grid-cols-3">
          {filteredLessons.map((item) => {
            const mastery = progress.lessonMastery[item.id];
            const completed = progress.lessonsCompleted.includes(item.id);
            const needsReview = progress.reviewLessonIds.includes(item.id);
            return (
              <Card
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openLesson(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openLesson(item.id);
                  }
                }}
                className="train-accent-ring cursor-pointer p-4 text-left transition-transform hover:scale-[1.01]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm font-bold">{item.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="muted">Level {difficultyForLesson(item)}</Badge>
                      <Badge variant="outline">{estimatedMinutesForLesson(item)} min</Badge>
                      <Badge variant="outline">{categoryLabel(item.category)}</Badge>
                    </div>
                  </div>
                  {completed ? (
                    <Badge variant="success">Mastered</Badge>
                  ) : needsReview ? (
                    <Badge variant="warning">Review</Badge>
                  ) : (
                    <Badge variant="muted">New</Badge>
                  )}
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-400 light:text-slate-600">
                  {item.intro}
                </p>
                <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
                  <span>
                    {item.steps.length} {item.steps.length === 1 ? "step" : "steps"}
                  </span>
                  <span>
                    {mastery
                      ? `${mastery.solved}/${mastery.attempts} solved`
                      : initialMode === "practice"
                        ? "Start quiz →"
                        : "Open position →"}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StudyView({
  lesson,
  stepIndex,
  autoPlaying,
  onStep,
  onReplay,
  onStartPractice,
  onPlayFromPosition,
}: {
  lesson: Lesson;
  stepIndex: number;
  autoPlaying: boolean;
  onStep: (next: number) => void;
  onReplay: () => void;
  onStartPractice: () => void;
  onPlayFromPosition: (fen: string) => void;
}) {
  const fen = fenAfterSteps(lesson, stepIndex);
  const atEnd = stepIndex >= lesson.steps.length;
  const terminal = new Chess(fen).isGameOver();
  const boardOptions: ChessboardOptions = useMemo(
    () => ({
      position: fen,
      boardOrientation: lesson.startFen?.split(" ")[1] === "b" ? "black" : "white",
      allowDragging: false,
      showNotation: true,
      darkSquareStyle: { backgroundColor: "var(--sentio-board-dark)" },
      lightSquareStyle: { backgroundColor: "var(--sentio-board-light)" },
      boardStyle: { touchAction: "none" },
    }),
    [fen, lesson.startFen],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-center lg:overflow-hidden">
      <div className="mx-auto w-full max-w-[480px] shrink-0">
        <Chessboard options={boardOptions} />
      </div>
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
        <LessonHeader lesson={lesson} label="Study the idea" />
        <Card className="p-4">
          <p className="max-h-28 overflow-y-auto text-xs leading-relaxed text-zinc-400 light:text-slate-600">
            {stepIndex === 0 ? lesson.intro : lesson.steps[stepIndex - 1].narration}
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {lesson.steps.map((step, index) => (
              <Badge
                key={`${step.san}-${index}`}
                variant={index < stepIndex ? "accent" : "muted"}
                className="font-mono text-[10px]"
              >
                {step.san}
              </Badge>
            ))}
          </div>
        </Card>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStep(Math.max(0, stepIndex - 1))}
            disabled={stepIndex === 0}
            className="flex-1"
          >
            ◀ Prev
          </Button>
          <Button variant="outline" size="sm" onClick={onReplay}>
            {autoPlaying ? "Playing…" : "▶ Replay"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStep(Math.min(lesson.steps.length, stepIndex + 1))}
            disabled={atEnd}
            className="flex-1"
          >
            Next ▶
          </Button>
        </div>
        <Button variant="default" onClick={onStartPractice} className="w-full">
          ◇ Practice this position
        </Button>
        {!terminal && (
          <Button variant="outline" onClick={() => onPlayFromPosition(fen)} className="w-full">
            ♟ Play from this step vs Sentio
          </Button>
        )}
      </div>
    </div>
  );
}

function PracticeView({
  lesson,
  completedBefore,
  onResult,
  onStudyLine,
  onRetry,
  onPlayFromPosition,
}: {
  lesson: Lesson;
  completedBefore: boolean;
  onResult: (result: LessonAttemptInput) => void;
  onStudyLine: () => void;
  onRetry: () => void;
  onPlayFromPosition: (fen: string) => void;
}) {
  const chessRef = useRef(new Chess(lesson.startFen));
  const stepRef = useRef(0);
  const finishedRef = useRef(false);
  const mistakesRef = useRef(0);
  const hintsRef = useRef(0);
  const [boardFen, setBoardFen] = useState(() =>
    new Chess(lesson.startFen).fen(),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [hints, setHints] = useState(0);
  const [feedback, setFeedback] = useState("Find the best move.");
  const [locked, setLocked] = useState(false);
  const [finished, setFinished] = useState(false);

  const finish = useCallback(
    (solved: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      setFinished(true);
      setLocked(true);
      setFeedback(
        solved
          ? mistakesRef.current === 0 && hintsRef.current === 0
            ? "Perfect recall — solved on the first try."
            : "Solved. This position has been added to your review cycle."
          : "Line revealed. This position is now in your review queue.",
      );
      onResult({
        lessonId: lesson.id,
        solved,
        firstTry:
          solved && mistakesRef.current === 0 && hintsRef.current === 0,
        hintsUsed: hintsRef.current,
      });
    },
    [lesson.id, onResult],
  );

  const playOpponentReply = useCallback(() => {
    const reply = lesson.steps[stepRef.current];
    if (!reply) {
      finish(true);
      return;
    }
    window.setTimeout(() => {
      try {
        chessRef.current.move(reply.san);
        stepRef.current += 1;
        setStepIndex(stepRef.current);
        setBoardFen(chessRef.current.fen());
        if (stepRef.current >= lesson.steps.length) {
          finish(true);
        } else {
          setFeedback("Opponent replied. Find the next move.");
          setLocked(false);
        }
      } catch {
        finish(false);
      }
    }, 420);
  }, [finish, lesson.steps]);

  const onDrop = useCallback(
    (sourceSquare: string, targetSquare: string): boolean => {
      if (locked || finishedRef.current) return false;
      const expected = lesson.steps[stepRef.current];
      if (!expected) return false;
      let applied;
      try {
        const promotion = expected.san.match(/=([QRBN])/)?.[1]?.toLowerCase();
        applied = chessRef.current.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: promotion ?? "q",
        });
      } catch {
        return false;
      }
      if (applied.san !== expected.san) {
        chessRef.current.undo();
        mistakesRef.current += 1;
        setMistakes(mistakesRef.current);
        setFeedback("Legal move, but not the training line. Look for a stronger idea.");
        return false;
      }
      stepRef.current += 1;
      setStepIndex(stepRef.current);
      setBoardFen(chessRef.current.fen());
      setFeedback(expected.narration);
      setLocked(true);
      if (stepRef.current >= lesson.steps.length) {
        finish(true);
      } else {
        playOpponentReply();
      }
      return true;
    },
    [finish, lesson.steps, locked, playOpponentReply],
  );

  const boardOptions: ChessboardOptions = useMemo(
    () => ({
      position: boardFen,
      boardOrientation: lesson.startFen?.split(" ")[1] === "b" ? "black" : "white",
      onPieceDrop: ({ sourceSquare, targetSquare }) => {
        if (!sourceSquare || !targetSquare) return false;
        return onDrop(sourceSquare, targetSquare);
      },
      allowDragging: !locked && !finished,
      animationDurationInMs: 180,
      showNotation: true,
      darkSquareStyle: { backgroundColor: "var(--sentio-board-dark)" },
      lightSquareStyle: { backgroundColor: "var(--sentio-board-light)" },
      boardStyle: { touchAction: "none" },
    }),
    [boardFen, lesson.startFen, locked, finished, onDrop],
  );

  const expected = lesson.steps[stepIndex];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-center lg:overflow-hidden">
      <div className="mx-auto w-full max-w-[480px] shrink-0">
        <Chessboard options={boardOptions} />
      </div>
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
        <LessonHeader lesson={lesson} label="Play the training line" />
        <Card className="p-4">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
            <span>Move {Math.min(stepIndex + 1, lesson.steps.length)} of {lesson.steps.length}</span>
            <span>{mistakes} mistake{mistakes === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800 light:bg-slate-200">
            <div
              className="h-full bg-violet-400 transition-[width]"
              style={{ width: `${(stepIndex / lesson.steps.length) * 100}%` }}
            />
          </div>
          <p
            role="status"
            aria-live="polite"
            className={`mt-3 text-xs leading-relaxed ${finished ? "text-emerald-300" : "text-zinc-300 light:text-slate-700"}`}
          >
            {feedback}
          </p>
          {!finished && hints > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200 light:text-amber-800">
              {hints === 1
                ? `Theme: ${categoryLabel(lesson.category)}. ${lesson.intro}`
                : `Strong hint: look for ${expected?.san ?? "the forcing move"}.`}
            </div>
          )}
        </Card>

        {!finished ? (
          <>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const next = Math.min(2, hintsRef.current + 1);
                  hintsRef.current = next;
                  setHints(next);
                }}
                disabled={hints >= 2}
              >
                {hints === 0 ? "Hint: theme" : hints === 1 ? "Hint: move" : "Hint shown"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  finish(false);
                  onStudyLine();
                }}
              >
                Reveal line
              </Button>
            </div>
            <p className="text-center text-[10px] text-zinc-500">
              Drag the piece on the board. Opponent replies play automatically.
            </p>
          </>
        ) : (
          <>
            <Button variant="default" onClick={onRetry}>
              Practice again
            </Button>
            <Button variant="outline" onClick={onStudyLine}>
              Study the explanation
            </Button>
            {!new Chess(lesson.startFen).isGameOver() && (
              <Button
                variant="outline"
                onClick={() => onPlayFromPosition(lesson.startFen ?? new Chess().fen())}
              >
                ♟ Play from this position vs Sentio
              </Button>
            )}
          </>
        )}
        {completedBefore && !finished && (
          <Badge variant="success" className="justify-center py-1.5">
            Previously mastered
          </Badge>
        )}
      </div>
    </div>
  );
}

function LessonHeader({ lesson, label }: { lesson: Lesson; label: string }) {
  return (
    <Card className="p-4">
      <CardContent className="p-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
            <h3 className="mt-1 font-mono text-sm font-bold">{lesson.title}</h3>
          </div>
          <Badge variant="muted">Level {difficultyForLesson(lesson)}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? "accent" : "ghost"}
      size="sm"
      onClick={onClick}
      className="h-8 px-2.5 text-[10px] capitalize"
    >
      {children}
    </Button>
  );
}

function categoryLabel(category: Lesson["category"]): string {
  return LESSON_CATEGORIES.find((item) => item.key === category)?.label ?? category;
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-52 flex-1 items-center justify-center p-6 text-sm text-zinc-400">
      {children}
    </div>
  );
}
