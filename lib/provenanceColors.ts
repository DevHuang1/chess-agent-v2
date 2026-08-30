/**
 * Stable color system for move provenance.
 *
 * Each actor / engine family gets a stable base color. Different engine
 * versions are differentiated with labels / secondary styling (badges), NOT
 * random colors. Colors are chosen to hold sufficient contrast in both the
 * dark (zinc) and "light:" (slate) themes used by the app.
 */

import type { MoveProvenance } from "./provenance";

export type ProvenanceColor = {
  /** Arrow + highlight fill color (used in board annotations). */
  hex: string;
  /** CSS border/focus accent, contrast-tested for both themes. */
  accent: string;
  /** Short text label for the legend. */
  label: string;
};

export const PROVENANCE_COLORS: Record<string, ProvenanceColor> = {
  player: { hex: "#22b8cf", accent: "#0e7490", label: "You" },
  sentio: { hex: "#8b5cf6", accent: "#6d28d9", label: "Sentio (engine)" },
  engine: { hex: "#8b5cf6", accent: "#6d28d9", label: "Engine" },
  mcts: { hex: "#f59e0b", accent: "#b45309", label: "Alternative (MCTS)" },
  prolog: { hex: "#22c55e", accent: "#15803d", label: "Logician (Prolog)" },
  fallback: { hex: "#fb923c", accent: "#c2410c", label: "Fallback / timeout" },
  unknown: { hex: "#9ca3af", accent: "#6b7280", label: "Imported / unknown" },
  error: { hex: "#ef4444", accent: "#b91c1c", label: "Illegal / error" },
};

/**
 * Resolve the annotation color for a move's provenance.
 * - player -> cyan/blue
 * - sentio / primary engine -> violet
 * - mcts -> amber
 * - prolog -> green
 * - fallback/timeout -> orange
 * - unknown/imported/replay -> gray
 * - anything else (defensive) -> gray
 */
export function colorForProvenance(provenance: MoveProvenance): ProvenanceColor {
  if (provenance.fallbackUsed) return PROVENANCE_COLORS.fallback;
  switch (provenance.actor) {
    case "player":
      return PROVENANCE_COLORS.player;
    case "sentio":
    case "engine":
      if (provenance.algorithm === "mcts") return PROVENANCE_COLORS.mcts;
      if (provenance.algorithm === "lesson-line" || provenance.algorithm === "puzzle-line")
        return PROVENANCE_COLORS.prolog;
      return PROVENANCE_COLORS.sentio;
    case "unknown":
    case "imported":
    case "replay":
      return PROVENANCE_COLORS.unknown;
    default:
      return PROVENANCE_COLORS.unknown;
  }
}

export function errorColor(): ProvenanceColor {
  return PROVENANCE_COLORS.error;
}
