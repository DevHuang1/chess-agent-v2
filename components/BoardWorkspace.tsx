"use client";

import { type RefObject } from "react";
import dynamic from "next/dynamic";
import EvalBar from "@/components/EvalBar";
import EmotionMonitor from "@/components/EmotionMonitor";
import PromotionPicker from "@/components/PromotionPicker";
import { Badge } from "@/components/ui/badge";
import { EMOTION_EMOJI, type EmotionScores } from "@/lib/emotionClassifier";
import type { EmotionLabel } from "@/lib/engineProfiles";
import type { EmotionTimelineEntry } from "@/hooks/useEmotionDetection";
import type { ChessboardOptions } from "react-chessboard";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center sentio-bg font-mono text-zinc-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
          Loading Sentio...
        </div>
      </div>
    ),
  },
);

interface BoardWorkspaceProps {
  evaluation: number | null;
  chessboardOptions: ChessboardOptions;
  boardWrapRef: RefObject<HTMLDivElement | null>;
  aiHandRef: RefObject<HTMLDivElement | null>;
  pendingPromotion: { from: string; to: string } | null;
  choosePromotion: (piece: "q" | "r" | "b" | "n") => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  emotion: EmotionLabel;
  emotionScores: EmotionScores | null;
  emotionTimeline: EmotionTimelineEntry[];
  emotionMode: "auto" | "manual";
  botRemark: string | null;
  handleBoardTouchEndCapture: (event: React.TouchEvent<HTMLDivElement>) => void;
}

export default function BoardWorkspace({
  evaluation,
  chessboardOptions,
  boardWrapRef,
  aiHandRef,
  pendingPromotion,
  choosePromotion,
  videoRef,
  emotion,
  emotionScores,
  emotionTimeline,
  emotionMode,
  botRemark,
  handleBoardTouchEndCapture,
}: BoardWorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-4 xl:flex-row xl:gap-8 xl:overflow-hidden xl:p-6">
      <div className="hidden h-[75vh] max-h-full shrink-0 self-center xl:block">
        <EvalBar evaluation={evaluation} />
      </div>
      <div
        ref={boardWrapRef}
        className="aspect-square w-[660px] max-w-[85vw] max-h-[75vh] rounded-2xl sentio-board-frame p-3.5 shadow-2xl touch-none border border-zinc-700/40 relative overflow-hidden light:border-slate-300"
        onTouchEndCapture={handleBoardTouchEndCapture}
      >
        <Chessboard options={chessboardOptions} />
        <div
          ref={aiHandRef}
          className="absolute left-0 top-0 z-30 pointer-events-none opacity-0"
          style={{
            transition: "opacity 120ms ease-out",
            filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))",
          }}
          title="Coach move"
        >
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <path
              d="M19.15 4.12c-.13-.14-.3-.2-.46-.2l-.02 0c-.16 0-.31.06-.42.17L14 8.28V4.5c0-.38-.31-.66-.69-.66-.38 0-.69.28-.69.66v5.23c0 .15-.11.27-.26.27-.15 0-.26-.12-.26-.27V2.69c0-.38-.31-.69-.69-.69-.38 0-.69.31-.69.69v6.86c0 .15-.11.27-.26.27-.15 0-.26-.12-.26-.27V4.46c0-.38-.31-.69-.69-.69-.38 0-.69.28-.69.69v6.5c0 .15-.11.27-.26.27-.15 0-.26-.12-.26-.27v-2.5c0-.38-.31-.69-.69-.69-.38 0-.69.28-.69.69v7.86c0 .34.13.66.36.9l3.08 3.24c.22.24.53.36.85.36h.03c.58 0 1.15-.22 1.58-.61l4.43-4.19c.47-.45.74-1.07.74-1.72v-9.09c0-.69-1-.77-1.6-1.29zM14.02 14.71h-3.31V13h3.31v1.71z"
              fill="#f59e0b"
              stroke="#18181b"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {pendingPromotion ? (
          <PromotionPicker onChoose={choosePromotion} />
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="relative w-64 h-72 shrink-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl group light:border-slate-300 light:bg-slate-200">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full scale-x-[-1] object-cover"
          />
          <div className="absolute inset-0 pointer-events-none border border-amber-500/10 rounded-2xl" />
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
            <Badge variant="muted" className="font-mono text-[10px] uppercase tracking-wider">
              Camera Feed
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-emerald-300 font-semibold bg-zinc-950/80 backdrop-blur-md border border-zinc-800 px-2.5 py-1 light:bg-white/80 light:border-slate-300 light:text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              {EMOTION_EMOJI[emotion]} {emotion}
            </Badge>
          </div>
        </div>

        <EmotionMonitor
          scores={emotionScores}
          activeEmotion={emotion}
          timeline={emotionTimeline}
          manual={emotionMode === "manual"}
        />

        {botRemark && (
          <div className="w-64 rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-zinc-300 backdrop-blur-md light:border-amber-300 light:bg-amber-100 light:text-slate-700">
            <span className="text-amber-400 font-bold block mb-0.5 light:text-amber-700">
              Sentio Engine:
            </span>
            <span className="italic">{botRemark}</span>
          </div>
        )}
      </div>
    </div>
  );
}
