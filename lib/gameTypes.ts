import type { ReplayMove } from "@/components/Simulation3D";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  bestMove?: { uci: string; san: string } | null;
  playedByCoach?: boolean;
};

export type EngineProfile = {
  emotion: string;
  depth: number;
  skillLevel: number;
  elo: number;
  moveQuality?: string;
};

export type GameOutcome = "active" | "checkmate" | "stalemate" | "draw" | "gameover";
export type CoachLlmConnection =
  | "checking"
  | "connected"
  | "disconnected"
  | "disabled";
export type LiveAiMode = "off" | "minimax" | "mcts";
