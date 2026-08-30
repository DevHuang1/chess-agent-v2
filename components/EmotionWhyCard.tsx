"use client";

import type { EmotionLabel } from "@/lib/engineProfiles";
import { VALENCE_AROUSAL_PROTOTYPES } from "@/lib/blendshapeEmotion";
import { explainFaceFrame, type FaceFrame } from "@/lib/faceExplain";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * "Why this emotion" panel: shows the raw facial reading (valence/arousal on
 * a mini circumplex, or top expression channels for the face-api backend),
 * the strongest facial signals, and any gameplay-fusion boosts that shifted
 * the final label.
 */

const SOURCE_LABEL: Record<FaceFrame["source"], string> = {
  "face-api": "face-api expressions",
  blendshapes: "face blendshapes",
};

/** Mini valence×arousal circumplex: prototypes + the live reading. */
function Circumplex({ valence, arousal }: { valence: number; arousal: number }) {
  // Plot area in a 0..100 viewBox, arousal on the vertical axis.
  const W = 100;
  const H = 78;
  const px = (v: number) => ((v + 1) / 2) * (W - 12) + 6;
  const py = (a: number) => H - 8 - a * (H - 16);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-24 w-full"
      role="img"
      aria-label={`Reading at valence ${valence.toFixed(2)}, arousal ${arousal.toFixed(2)}`}
    >
      {/* quadrant grid */}
      <line x1={W / 2} y1={4} x2={W / 2} y2={H - 4} stroke="currentColor" strokeWidth="0.3" className="text-zinc-700 light:text-slate-400" />
      <line x1={6} y1={H / 2} x2={W - 6} y2={H / 2} stroke="currentColor" strokeWidth="0.3" className="text-zinc-700 light:text-slate-400" />
      <text x={W - 8} y={H - 1} fontSize="4" textAnchor="end" className="fill-zinc-500 light:fill-slate-500">valence +</text>
      <text x={W - 8} y={7} fontSize="4" textAnchor="end" className="fill-zinc-500 light:fill-slate-500">arousal +</text>

      {/* emotion prototypes */}
      {Object.entries(VALENCE_AROUSAL_PROTOTYPES).map(([label, proto]) => (
        <g key={label}>
          <circle cx={px(proto.valence)} cy={py(proto.arousal)} r={1.6} className="fill-zinc-600 light:fill-slate-500" />
          <text
            x={px(proto.valence) + 2.4}
            y={py(proto.arousal) + 1.5}
            fontSize="3.6"
            className="fill-zinc-500 light:fill-slate-500"
          >
            {label}
          </text>
        </g>
      ))}

      {/* live reading */}
      <circle cx={px(valence)} cy={py(arousal)} r={2.6} className="fill-amber-400 animate-pulse" />
      <circle cx={px(valence)} cy={py(arousal)} r={4.4} fill="none" className="stroke-amber-400/60" strokeWidth="0.6" />
    </svg>
  );
}

export default function EmotionWhyCard({
  frame,
  emotion,
}: {
  frame: FaceFrame | null;
  emotion: EmotionLabel;
}) {
  const explanation = frame ? explainFaceFrame(frame) : null;
  const reading =
    frame?.evidence?.kind === "blendshapes"
      ? { valence: frame.evidence.valence, arousal: frame.evidence.arousal }
      : null;

  return (
    <Card className="mt-3 w-full border-amber-500/25 bg-zinc-950/70 light:border-amber-300 light:bg-slate-100/80">
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400 light:text-amber-700">
            Why {emotion}?
          </span>
          <Badge variant="muted" className="text-[10px]">
            {frame ? SOURCE_LABEL[frame.source] : "waiting for face"}
          </Badge>
        </div>

        {!frame || !explanation ? (
          <p className="text-[11px] text-zinc-500 light:text-slate-500">
            Looking for a face in the camera feed…
          </p>
        ) : (
          <>
            {reading && <Circumplex {...reading} />}

            {explanation.reading && (
              <p className="mb-2 font-mono text-[10px] text-zinc-400 light:text-slate-600">
                {explanation.reading}
              </p>
            )}

            {/* Facial signals, strongest first. */}
            {explanation.signals.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {explanation.signals.map((signal) => (
                  <div
                    key={signal}
                    className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-300 light:text-slate-700"
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                    {signal}
                  </div>
                ))}
              </div>
            )}

            {/* Gameplay fusion boosts on top of the face signal. */}
            {frame.fusionNotes.length > 0 && (
              <div className="mt-2 border-t border-zinc-800/70 pt-2 light:border-slate-300">
                <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500 light:text-slate-500">
                  Game telemetry adjustments
                </p>
                {frame.fusionNotes.map((note) => (
                  <div
                    key={note}
                    className="flex items-center gap-1.5 font-mono text-[10px] text-amber-300/90 light:text-amber-800"
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                    {note}
                  </div>
                ))}
              </div>
            )}

            <p className="mt-2 border-t border-zinc-800/70 pt-2 font-mono text-[9px] leading-relaxed text-zinc-500 light:border-slate-300 light:text-slate-500">
              Soft score bars in the telemetry panel below show the full
              evidence; the top score wins after a 3-sample smoothing window.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
