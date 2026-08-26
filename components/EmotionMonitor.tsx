/**
 * Live emotion telemetry panel.
 *
 * Renders two views of the six-game-emotion pipeline output:
 *   1. Score bars — the current fused scores per emotion (from the composite
 *      classifier / valence-arousal backend plus gameplay fusion), so it is
 *      always visible *why* a given emotion won.
 *   2. Timeline strip — the sequence of smoothed emotions over the course of
 *      the game, giving a persistent record that was previously kept only in
 *      an in-memory ref for the LLM coach.
 */
import { EMOTION_LABELS, type EmotionLabel } from "@/lib/engineProfiles";
import type { EmotionScores } from "@/lib/emotionClassifier";
import type { EmotionTimelineEntry } from "@/hooks/useEmotionDetection";

export type { EmotionTimelineEntry };

const EMOTION_COLORS: Record<EmotionLabel, string> = {
  calm: "bg-sky-400",
  focused: "bg-cyan-400",
  neutral: "bg-zinc-400",
  frustrated: "bg-orange-400",
  stressed: "bg-red-400",
  confident: "bg-emerald-400",
};

const EMOTION_TEXT: Record<EmotionLabel, string> = {
  calm: "text-sky-300 light:text-sky-700",
  focused: "text-cyan-300 light:text-cyan-700",
  neutral: "text-zinc-300 light:text-zinc-600",
  frustrated: "text-orange-300 light:text-orange-700",
  stressed: "text-red-300 light:text-red-700",
  confident: "text-emerald-300 light:text-emerald-700",
};

/** How many timeline segments to keep visible (oldest dropped first). */
const TIMELINE_LIMIT = 120;

export default function EmotionMonitor({
  scores,
  activeEmotion,
  timeline,
  manual,
}: {
  scores: EmotionScores | null;
  activeEmotion: EmotionLabel;
  timeline: EmotionTimelineEntry[];
  manual: boolean;
}) {
  const maxScore = scores
    ? Math.max(...EMOTION_LABELS.map((label) => scores[label]), 0.0001)
    : 1;
  const recent = timeline.slice(-TIMELINE_LIMIT);

  return (
    <div className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 light:border-slate-300 light:bg-slate-100/80">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 light:text-slate-500">
          Emotion telemetry
        </span>
        <span className="font-mono text-[10px] capitalize text-zinc-400 light:text-slate-600">
          {manual ? "manual override" : "live"}
        </span>
      </div>

      {/* Score bars: current evidence per game emotion. */}
      <div className="flex flex-col gap-1">
        {EMOTION_LABELS.map((label) => {
          const value = scores?.[label] ?? 0;
          const width = Math.min(100, (value / maxScore) * 100);
          const isActive = label === activeEmotion;
          return (
            <div key={label} className="flex items-center gap-2">
              <span
                className={`w-16 shrink-0 text-right font-mono text-[10px] capitalize ${
                  isActive
                    ? EMOTION_TEXT[label]
                    : "text-zinc-500 light:text-slate-500"
                }`}
              >
                {label}
              </span>
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-900 light:bg-slate-200"
                role="img"
                aria-label={`${label}: ${value.toFixed(2)}`}
                title={value.toFixed(3)}
              >
                <div
                  className={`h-full rounded-full ${EMOTION_COLORS[label]} ${
                    isActive ? "" : "opacity-40"
                  } transition-all duration-500`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Timeline strip: the emotional arc of the game so far. */}
      {recent.length > 0 && (
        <div className="mt-2 border-t border-zinc-800/70 pt-2 light:border-slate-300">
          <div className="flex h-2 items-stretch gap-px overflow-hidden rounded-sm">
            {recent.map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                className={`h-full flex-1 ${EMOTION_COLORS[entry.emotion]}`}
                title={`${entry.emotion} @ ${new Date(entry.at).toLocaleTimeString()}`}
              />
            ))}
          </div>
          <div className="mt-1 text-right font-mono text-[9px] text-zinc-500 light:text-slate-500">
            {recent.length} sample{recent.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
