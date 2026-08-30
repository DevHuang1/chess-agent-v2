/**
 * Authoritative move-provenance model.
 *
 * Every move that reaches the game state is tagged with who produced it and
 * with the concrete engine/version/algorithm when one was used. Provenance is
 * captured AT THE MOMENT the move is played — never inferred later from the
 * currently selected engine.
 *
 * Legacy / imported replay rows whose source is unknown are represented as
 * actor === "unknown" and displayed as "Legacy / source unknown". We never
 * fabricate a version for such moves.
 */

export type MoveActor =
  | "player"
  | "sentio"
  | "engine"
  | "replay"
  | "imported"
  | "unknown";

export type MoveAlgorithm =
  | "minimax"
  | "mcts"
  | "stockfish"
  | "lesson-line"
  | "puzzle-line"
  | "random"
  | "unknown";

/** Metadata attached to a single played move. */
export type MoveProvenance = {
  actor: MoveActor;
  engineId?: string;
  engineName?: string;
  engineVersion?: string;
  algorithm?: MoveAlgorithm;
  /** Human-readable difficulty / profile at the time the move was made. */
  profile?: string;
  searchDepth?: number;
  completedDepth?: number;
  timeBudgetMs?: number;
  searchTimeMs?: number;
  totalLatencyMs?: number;
  evaluationBefore?: number;
  evaluationAfter?: number;
  nodesVisited?: number;
  fallbackUsed?: boolean;
  requestId?: string;
  playedAt: number;
};

/** A played move (SAN/UCI plus provenance) stored in reactive game state. */
export type ProvenancedMove = {
  from: string;
  to: string;
  san: string;
  uci: string;
  color: "w" | "b";
  flags: string;
  promotion?: string;
  moveNumber: number;
  fen: string;
  provenance: MoveProvenance;
};

/** Human moves carry only identification + timing; no fabricated engine info. */
export function playerMoveProvenance(playedAt: number = Date.now()): MoveProvenance {
  return { actor: "player", playedAt };
}

/** Neutral fallback meta for a move whose source is not known. */
export function unknownMoveProvenance(playedAt: number = Date.now()): MoveProvenance {
  return { actor: "unknown", algorithm: "unknown", playedAt };
}

/** True for a legacy/imported/unknown move that should render "source unknown". */
export function isLegacyMove(provenance: MoveProvenance): boolean {
  return (
    provenance.actor === "unknown" ||
    provenance.actor === "imported" ||
    provenance.actor === "replay"
  );
}

/** Human-readable actor label (accessibility + legend). */
export function actorLabel(actor: MoveActor): string {
  switch (actor) {
    case "player":
      return "You";
    case "sentio":
      return "Sentio";
    case "engine":
      return "Engine";
    case "replay":
      return "Replay";
    case "imported":
      return "Imported";
    case "unknown":
      return "Legacy / source unknown";
    default:
      return "Unknown";
  }
}

/** Human-readable move detail line used in tooltips/details panels. */
export function provenanceSummary(provenance: MoveProvenance): string {
  if (isLegacyMove(provenance)) return "Legacy / source unknown";
  const actor = actorLabel(provenance.actor);
  const parts: string[] = [actor];
  if (provenance.engineName) {
    let engine = provenance.engineName;
    if (provenance.engineVersion) engine = `${engine} ${provenance.engineVersion}`;
    parts.push(engine);
  } else if (provenance.algorithm) {
    parts.push(provenance.algorithm);
  }
  if (provenance.profile) parts.push(provenance.profile);
  if (provenance.completedDepth != null || provenance.searchDepth != null) {
    parts.push(`d${provenance.completedDepth ?? provenance.searchDepth}`);
  }
  if (provenance.totalLatencyMs != null) {
    parts.push(`${provenance.totalLatencyMs}ms`);
  }
  if (provenance.fallbackUsed) parts.push("fallback");
  return parts.join(" · ");
}

/** Stable 32-bit FEN cache key; deterministic across runs. */
export function fenCacheKey(fen: string): number {
  let h = 2166136261;
  for (let i = 0; i < fen.length; i++) {
    h ^= fen.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
