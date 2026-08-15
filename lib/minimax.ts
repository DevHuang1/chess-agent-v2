import { Chess, Move, Square } from "chess.js";

export type SearchNodeStatus = "exploring" | "evaluated" | "pruned" | "principal";

export type MinimaxSearchNode = {
  id: string;
  parentId: string | null;
  depth: number;
  move: string | null;
  san: string | null;
  from: string | null;
  to: string | null;
  score: number | null;
  alpha: number | null;
  beta: number | null;
  status: SearchNodeStatus;
  children: string[];
  explanation: string;
};

export type MinimaxTrace = {
  fen: string;
  sideToMove: "w" | "b";
  depth: number;
  nodes: MinimaxSearchNode[];
  selectedMove: { uci: string; san: string; score: number } | null;
  principalVariation: string[];
  evaluatedLeaves: number;
  prunedBranches: number;
  generatedAt: number;
};

const MATERIAL: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
};

function perspectiveValue(pieceColor: "w" | "b", aiColor: "w" | "b", value: number) {
  return pieceColor === aiColor ? value : -value;
}

export function evaluateMaterial(chess: Chess, aiColor: "w" | "b"): number {
  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece) score += perspectiveValue(piece.color, aiColor, MATERIAL[piece.type]);
    }
  }
  if (chess.isCheckmate()) return chess.turn() === aiColor ? -100_000 : 100_000;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  return score;
}

function moveOrderingScore(move: Move) {
  return (move.captured ? MATERIAL[move.captured] * 10 : 0)
    + (move.promotion ? MATERIAL[move.promotion] : 0)
    + (move.san.includes("+") ? 45 : 0)
    + (move.san.includes("#") ? 500 : 0);
}

function orderedMoves(chess: Chess, limit: number): Move[] {
  return chess.moves({ verbose: true })
    .sort((a, b) => moveOrderingScore(b) - moveOrderingScore(a) || a.san.localeCompare(b.san))
    .slice(0, limit);
}

export function buildMinimaxTrace(
  fen: string,
  options: { depth?: number; branchLimit?: number; aiColor?: "w" | "b" } = {},
): MinimaxTrace {
  const depth = Math.max(1, Math.min(4, options.depth ?? 3));
  const branchLimit = Math.max(2, Math.min(8, options.branchLimit ?? 5));
  const rootChess = new Chess(fen);
  const aiColor = options.aiColor ?? rootChess.turn();
  const nodes: MinimaxSearchNode[] = [];
  let evaluatedLeaves = 0;
  let prunedBranches = 0;
  let sequence = 0;

  const addNode = (node: Omit<MinimaxSearchNode, "id">) => {
    const id = `node-${sequence++}`;
    const fullNode = { id, ...node };
    nodes.push(fullNode);
    if (node.parentId) {
      const parent = nodes.find((candidate) => candidate.id === node.parentId);
      parent?.children.push(id);
    }
    return fullNode;
  };

  const root = addNode({
    parentId: null,
    depth: 0,
    move: null,
    san: null,
    from: null,
    to: null,
    score: null,
    alpha: null,
    beta: null,
    status: "exploring",
    children: [],
    explanation: `Minimax starts from the ${aiColor === "b" ? "AI" : "player"} side to move.`,
  });

  function search(chess: Chess, remainingDepth: number, alpha: number, beta: number, parentId: string, path: string[]): { score: number; pv: string[] } {
    if (remainingDepth === 0 || chess.isGameOver()) {
      evaluatedLeaves++;
      const score = evaluateMaterial(chess, aiColor);
      const node = nodes.find((candidate) => candidate.id === parentId);
      if (node) {
        node.score = score;
        node.alpha = alpha;
        node.beta = beta;
        node.status = "evaluated";
        node.explanation = chess.isGameOver() ? "Terminal position evaluated." : "Leaf position evaluated by material balance.";
      }
      return { score, pv: path };
    }

    const maximizing = chess.turn() === aiColor;
    const moves = orderedMoves(chess, branchLimit);
    let bestScore = maximizing ? -Infinity : Infinity;
    let bestPv: string[] = path;

    for (const move of moves) {
      const childChess = new Chess(chess.fen());
      const applied = childChess.move({ from: move.from as Square, to: move.to as Square, promotion: move.promotion });
      if (!applied) continue;
      const child = addNode({
        parentId,
        depth: depth - remainingDepth + 1,
        move: `${applied.from}${applied.to}${applied.promotion ?? ""}`,
        san: applied.san,
        from: applied.from,
        to: applied.to,
        score: null,
        alpha,
        beta,
        status: "exploring",
        children: [],
        explanation: `${maximizing ? "Max" : "Min"} considers ${applied.san}.`,
      });
      const result = search(childChess, remainingDepth - 1, alpha, beta, child.id, [...path, applied.san]);
      child.score = result.score;
      child.alpha = alpha;
      child.beta = beta;

      const improves = maximizing ? result.score > bestScore : result.score < bestScore;
      if (improves) {
        bestScore = result.score;
        bestPv = result.pv;
      }
      if (maximizing) alpha = Math.max(alpha, bestScore);
      else beta = Math.min(beta, bestScore);

      if (beta <= alpha) {
        const remainingMoves = moves.slice(moves.indexOf(move) + 1);
        prunedBranches += remainingMoves.length;
        for (const prunedMove of remainingMoves) {
          addNode({
            parentId,
            depth: depth - remainingDepth + 1,
            move: `${prunedMove.from}${prunedMove.to}${prunedMove.promotion ?? ""}`,
            san: prunedMove.san,
            from: prunedMove.from,
            to: prunedMove.to,
            score: null,
            alpha,
            beta,
            status: "pruned",
            children: [],
            explanation: `Alpha–beta prunes ${prunedMove.san}; it cannot improve the parent choice.`,
          });
        }
        break;
      }
    }

    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (parent) {
      parent.score = Number.isFinite(bestScore) ? bestScore : evaluateMaterial(chess, aiColor);
      parent.alpha = alpha;
      parent.beta = beta;
      parent.status = "evaluated";
      parent.explanation = `${maximizing ? "Max" : "Min"} backs up the best child score.`;
    }
    return { score: Number.isFinite(bestScore) ? bestScore : 0, pv: bestPv };
  }

  const result = search(rootChess, depth, -Infinity, Infinity, root.id, []);
  const rootChildren = root.children
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is MinimaxSearchNode => Boolean(node));
  const bestRoot = rootChess.turn() === aiColor
    ? rootChildren
      .filter((node) => node.status !== "pruned" && node.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
    : undefined;

  const principalIds = new Set<string>();
  let cursor: MinimaxSearchNode | undefined = bestRoot;
  while (cursor) {
    principalIds.add(cursor.id);
    cursor = cursor.children
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is MinimaxSearchNode => Boolean(node))
      .filter((node) => node.score !== null && node.status !== "pruned")
      .sort((a, b) => Math.abs((b.score ?? 0) - (bestRoot?.score ?? 0)) - Math.abs((a.score ?? 0) - (bestRoot?.score ?? 0)))[0];
  }
  for (const node of nodes) {
    if (principalIds.has(node.id)) node.status = "principal";
  }

  return {
    fen,
    sideToMove: rootChess.turn(),
    depth,
    nodes,
    selectedMove: bestRoot?.move && bestRoot.san && bestRoot.score !== null
      ? { uci: bestRoot.move, san: bestRoot.san, score: bestRoot.score }
      : null,
    principalVariation: result.pv,
    evaluatedLeaves,
    prunedBranches,
    generatedAt: Date.now(),
  };
}
