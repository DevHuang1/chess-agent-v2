"use client";

import { EMOTION_LABELS, type EmotionLabel } from "@/lib/engineProfiles";
import type { EmotionScores } from "@/lib/emotionClassifier";
import type { EmotionTimelineEntry } from "@/hooks/useEmotionDetection";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type { EmotionTimelineEntry };

const EMOTION_COLORS: Record<EmotionLabel, string> = {
  calm: "bg-sky-400",
  focused: "bg-cyan-400",
  neutral: "bg-zinc-400",
  frustrated: "bg-orange-400",
  stressed: "bg-red-400",
  confident: "bg-emerald-400",
};

const EMOTION_BADGE_VARIANT: Record<EmotionLabel, "calm" | "focused" | "neutral" | "frustrated" | "stressed" | "confident"> = {
  calm: "calm",
  focused: "focused",
  neutral: "neutral",
  frustrated: "frustrated",
  stressed: "stressed",
  confident: "confident",
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
    <Card className="mt-3 w-full border-zinc-800 bg-zinc-950/70 light:border-slate-300 light:bg-slate-100/80">
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 light:text-slate-500">
            Emotion telemetry
          </span>
          <Badge variant={manual ? "warning" : "muted"} className="text-[10px]">
            {manual ? "manual override" : "live"}
          </Badge>
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
                      ? `text-${label === "calm" ? "sky-300" : label === "focused" ? "cyan-300" : label === "neutral" ? "zinc-300" : label === "frustrated" ? "orange-300" : label === "stressed" ? "red-300" : "emerald-300"} light:text-${label === "calm" ? "sky-700" : label === "focused" ? "cyan-700" : label === "neutral" ? "slate-600" : label === "frustrated" ? "orange-700" : label === "stressed" ? "red-700" : "emerald-700"}`
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
      </CardContent>
    </Card>
  );
}
