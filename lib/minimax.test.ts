import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { buildMinimaxTrace, evaluateMaterial } from "./minimax";

describe("minimax analysis trace", () => {
  it("evaluates equal material as neutral", () => {
    expect(evaluateMaterial(new Chess(), "b")).toBe(0);
  });

  it("returns an explainable tree with a selected legal move", () => {
    const trace = buildMinimaxTrace(new Chess().fen(), { depth: 2, branchLimit: 4, aiColor: "b" });
    const legalMoves = new Chess().moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ""}`);

    expect(trace.sideToMove).toBe("w");
    expect(trace.nodes[0].depth).toBe(0);
    expect(trace.nodes.some((node) => node.depth === 1)).toBe(true);
    expect(trace.selectedMove).toBeNull();
    expect(trace.evaluatedLeaves).toBeGreaterThan(0);
    expect(trace.nodes.every((node) => node.children.every((childId) => trace.nodes.some((child) => child.id === childId)))).toBe(true);
    expect(trace.nodes.every((node) => ["material", "positional", "kingSafety"].every((key) => key in node.heuristics))).toBe(true);
    expect(legalMoves.length).toBeGreaterThan(0);
  });

  it("selects a legal black move when black is to move", () => {
    const chess = new Chess();
    chess.move("e4");
    const trace = buildMinimaxTrace(chess.fen(), { depth: 2, branchLimit: 5, aiColor: "b" });
    const legalMoves = new Chess(chess.fen()).moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ""}`);

    expect(trace.sideToMove).toBe("b");
    expect(trace.selectedMove).not.toBeNull();
    expect(legalMoves).toContain(trace.selectedMove?.uci);
    expect(trace.principalVariation.length).toBeGreaterThan(0);
  });
});
