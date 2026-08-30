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

/**
 * Structured timing/identity metadata returned by the move endpoint that the
 * client attaches to each bot move's provenance. No secrets are ever sent.
 */
export type EngineDiagnostics = {
  engineId?: string;
  engineName?: string;
  engineVersion?: string;
  algorithm?: string;
  requestedDepth?: number;
  completedDepth?: number;
  timeBudgetMs?: number;
  searchTimeMs?: number;
  totalLatencyMs?: number;
  nodesVisited?: number;
  cacheHit?: boolean;
  cancelled?: boolean;
  timeout?: boolean;
  fallbackUsed?: boolean;
};
