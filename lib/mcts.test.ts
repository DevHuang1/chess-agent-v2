import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { buildMctsTrace } from "./mcts";

describe("MCTS analysis trace", () => {
  it("builds deterministic rollout statistics for an AI-to-move position", () => {
    const chess = new Chess();
    chess.move("e4");
    const trace = buildMctsTrace(chess.fen(), { iterations: 32, branchLimit: 4, rolloutDepth: 2, aiColor: "b" });
    const legalMoves = new Chess(chess.fen()).moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ""}`);

    expect(trace.algorithm).toBe("mcts");
    expect(trace.sideToMove).toBe("b");
    expect(trace.iterations).toBe(32);
    expect(trace.rootVisits).toBe(32);
    expect(trace.evaluatedLeaves).toBe(32);
    expect(trace.selectedMove).not.toBeNull();
    expect(legalMoves).toContain(trace.selectedMove?.uci);
    expect(trace.nodes.some((node) => node.phase === "backpropagation")).toBe(true);
    expect(trace.nodes.every((node) => node.visits >= 0 && node.winRate >= 0 && node.winRate <= 1)).toBe(true);
  });

  it("exposes heuristic fields and a most-visited principal line", () => {
    const chess = new Chess();
    chess.move("e4");
    const trace = buildMctsTrace(chess.fen(), { iterations: 24, branchLimit: 3, rolloutDepth: 1, aiColor: "b" });
    expect(trace.principalVariation.length).toBeGreaterThan(0);
    expect(trace.nodes.some((node) => node.status === "principal")).toBe(true);
    expect(trace.nodes.every((node) => ["material", "positional", "kingSafety"].every((key) => key in node.heuristics))).toBe(true);
  });
});
