"use client";

import AIAnalysisTab from "@/components/AIAnalysisTab";
import type { EmotionLabel } from "@/lib/engineProfiles";

type LastBotMove = {
  uci: string;
  san: string;
  fen: string;
} | null;

export interface AILabWorkspaceProps {
  gamePosition: string;
  isBotThinking: boolean;
  lastBotMove: LastBotMove;
  emotion: EmotionLabel;
  activeTab: string;
}

export default function AILabWorkspace({
  gamePosition,
  isBotThinking,
  lastBotMove,
  emotion,
  activeTab,
}: AILabWorkspaceProps) {
  const analysisEnabled =
    gamePosition !== "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" &&
    activeTab !== "replay";

  return (
    <section
      className="ai-lab-workspace flex min-h-0 flex-1 flex-col overflow-hidden p-6"
      aria-label="Full-width AI Lab workspace"
    >
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.8)]" />
            <h1 className="text-lg font-bold text-cyan-100 light:text-cyan-900">
              AI Lab · Live Game Analysis
            </h1>
          </div>
          <p className="mt-1 text-xs text-zinc-400 light:text-slate-600">
            A full-width view of the current user-versus-AI game. Analysis
            starts after the first real move and follows the live position
            only.
          </p>
        </div>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200 light:border-cyan-300 light:bg-cyan-50 light:text-cyan-700">
          {analysisEnabled ? "tracking live game" : "waiting for first move"}
        </span>
      </div>
      <div className="ai-lab-workspace-panel min-h-0 flex-1 overflow-hidden rounded-2xl border border-cyan-500/25 bg-zinc-950/45 p-4 shadow-2xl light:border-cyan-300 light:bg-white/60">
        <AIAnalysisTab
          fen={gamePosition}
          isBotThinking={isBotThinking}
          lastBotMove={lastBotMove}
          emotion={emotion}
          analysisEnabled={analysisEnabled}
        />
      </div>
    </section>
  );
}
