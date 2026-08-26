import { Chess, Move, Square } from "chess.js";

export type SearchNodeStatus =
  | "exploring"
  | "evaluated"
  | "pruned"
  | "principal";

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
  heuristics: {
    material: number;
    positional: number;
    kingSafety: number;
  };
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
  transpositionHits: number;
  cutoffs: number;
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

function perspectiveValue(
  pieceColor: "w" | "b",
  aiColor: "w" | "b",
  value: number,
) {
  return pieceColor === aiColor ? value : -value;
}

function kingShield(chess: Chess, color: "w" | "b"): number {
  const board = chess.board();
  let kingFile = -1;
  let kingRank = -1;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (piece?.type === "k" && piece.color === color) {
        kingFile = file;
        kingRank = rank;
      }
    }
  }
  if (kingFile < 0 || kingRank < 0) return 0;
  let shield = 0;
  for (
    let rank = Math.max(0, kingRank - 1);
    rank <= Math.min(7, kingRank + 1);
    rank++
  ) {
    for (
      let file = Math.max(0, kingFile - 1);
      file <= Math.min(7, kingFile + 1);
      file++
    ) {
      if (rank === kingRank && file === kingFile) continue;
      if (board[rank][file]?.color === color) shield++;
    }
  }
  return shield;
}

export function evaluateHeuristics(chess: Chess, aiColor: "w" | "b") {
  let material = 0;
  let positional = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = chess.board()[rank][file];
      if (!piece) continue;
      material += perspectiveValue(piece.color, aiColor, MATERIAL[piece.type]);
      const centerDistance = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
      const centerBonus = Math.round((3.5 - centerDistance) * 8);
      const advancement =
        piece.type === "p" ? (piece.color === "w" ? 7 - rank : rank) * 3 : 0;
      positional += perspectiveValue(
        piece.color,
        aiColor,
        centerBonus + advancement,
      );
    }
  }

  const whiteShield = kingShield(chess, "w");
  const blackShield = kingShield(chess, "b");
  let kingSafety =
    (aiColor === "w" ? whiteShield - blackShield : blackShield - whiteShield) *
    18;
  if (chess.isCheck()) kingSafety += chess.turn() === aiColor ? -120 : 120;

  return { material, positional, kingSafety };
}

export type HeuristicWeights = {
  material: number;
  positional: number;
  kingSafety: number;
};

export const DEFAULT_WEIGHTS: HeuristicWeights = {
  material: 1,
  positional: 1,
  kingSafety: 1,
};

export function evaluateMaterial(
  chess: Chess,
  aiColor: "w" | "b",
  weights: HeuristicWeights = DEFAULT_WEIGHTS,
): number {
  const heuristics = evaluateHeuristics(chess, aiColor);
  if (chess.isCheckmate()) return chess.turn() === aiColor ? -100_000 : 100_000;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  return (
    heuristics.material * weights.material +
    heuristics.positional * weights.positional +
    heuristics.kingSafety * weights.kingSafety
  );
}

function moveOrderingScore(move: Move) {
  return (
    (move.captured ? MATERIAL[move.captured] * 10 : 0) +
    (move.promotion ? MATERIAL[move.promotion] : 0) +
    (move.san.includes("+") ? 45 : 0) +
    (move.san.includes("#") ? 500 : 0)
  );
}

function orderedMoves(
  chess: Chess,
  limit: number,
  preferredMove: string | null,
  killers: string[],
  historyScores: Map<string, number>,
): Move[] {
  return chess
    .moves({ verbose: true })
    .sort((a, b) => {
      const keyA = `${a.from}${a.to}${a.promotion ?? ""}`;
      const keyB = `${b.from}${b.to}${b.promotion ?? ""}`;
      const priorityA =
        (keyA === preferredMove ? 1_000_000 : 0) +
        (killers.includes(keyA) ? 12_000 : 0) +
        (historyScores.get(keyA) ?? 0) +
        moveOrderingScore(a);
      const priorityB =
        (keyB === preferredMove ? 1_000_000 : 0) +
        (killers.includes(keyB) ? 12_000 : 0) +
        (historyScores.get(keyB) ?? 0) +
        moveOrderingScore(b);
      return priorityB - priorityA || a.san.localeCompare(b.san);
    })
    .slice(0, limit);
}

export function buildMinimaxTrace(
  fen: string,
  options: {
    depth?: number;
    branchLimit?: number;
    aiColor?: "w" | "b";
    weights?: HeuristicWeights;
  } = {},
): MinimaxTrace {
  const depth = Math.max(1, Math.min(6, options.depth ?? 3));
  const branchLimit = Math.max(2, Math.min(8, options.branchLimit ?? 5));
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const rootChess = new Chess(fen);
  const aiColor = options.aiColor ?? rootChess.turn();
  const nodes: MinimaxSearchNode[] = [];
  let evaluatedLeaves = 0;
  let prunedBranches = 0;
  let transpositionHits = 0;
  let cutoffs = 0;
  let sequence = 0;
  const transpositionTable = new Map<
    string,
    {
      depth: number;
      score: number;
      pv: string[];
      flag: "exact" | "lower" | "upper";
    }
  >();
  const killerMoves = new Map<number, string[]>();
  const historyScores = new Map<string, number>();

  // O(1) id → node lookups (nodes.find was O(n) per insertion).
  const nodesById = new Map<string, MinimaxSearchNode>();

  const addNode = (node: Omit<MinimaxSearchNode, "id">) => {
    const id = `node-${sequence++}`;
    const fullNode = { id, ...node };
    nodes.push(fullNode);
    nodesById.set(id, fullNode);
    if (node.parentId) {
      const parent = nodesById.get(node.parentId);
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
    heuristics: evaluateHeuristics(rootChess, aiColor),
  });

  function search(
    chess: Chess,
    remainingDepth: number,
    alpha: number,
    beta: number,
    parentId: string,
    path: string[],
  ): { score: number; pv: string[] } {
    const originalAlpha = alpha;
    const originalBeta = beta;
    const cacheKey = `${chess.fen()}|${remainingDepth}|${aiColor}`;
    const cached = transpositionTable.get(cacheKey);
    if (cached && cached.depth >= remainingDepth) {
      transpositionHits++;
      if (
        cached.flag === "exact" ||
        (cached.flag === "lower" && cached.score >= beta) ||
        (cached.flag === "upper" && cached.score <= alpha)
      ) {
        return { score: cached.score, pv: [...path, ...cached.pv] };
      }
      if (cached.flag === "lower") alpha = Math.max(alpha, cached.score);
      if (cached.flag === "upper") beta = Math.min(beta, cached.score);
      if (beta <= alpha)
        return { score: cached.score, pv: [...path, ...cached.pv] };
    }
    if (remainingDepth === 0 || chess.isGameOver()) {
      evaluatedLeaves++;
      const score = evaluateMaterial(chess, aiColor, weights);
      const node = nodesById.get(parentId);
      if (node) {
        node.score = score;
        node.alpha = alpha;
        node.beta = beta;
        node.status = "evaluated";
        node.heuristics = evaluateHeuristics(chess, aiColor);
        node.explanation = chess.isGameOver()
          ? "Terminal position evaluated."
          : "Leaf position evaluated by weighted heuristics.";
      }
      return { score, pv: path };
    }

    const maximizing = chess.turn() === aiColor;
    const preferredMove = cached?.pv[0] ? cached.pv[0] : null;
    const moves = orderedMoves(
      chess,
      branchLimit,
      preferredMove,
      killerMoves.get(remainingDepth) ?? [],
      historyScores,
    );
    let bestScore = maximizing ? -Infinity : Infinity;
    let bestPv: string[] = path;

    for (const move of moves) {
      // Apply/undo on the shared instance instead of cloning via FEN per node —
      // FEN round-trips are the dominant cost of the search.
      const applied = chess.move({
        from: move.from as Square,
        to: move.to as Square,
        promotion: move.promotion,
      });
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
        heuristics: evaluateHeuristics(chess, aiColor),
      });
      const result = search(chess, remainingDepth - 1, alpha, beta, child.id, [
        ...path,
        applied.san,
      ]);
      chess.undo();
      child.score = result.score;
      child.alpha = alpha;
      child.beta = beta;

      const improves = maximizing
        ? result.score > bestScore
        : result.score < bestScore;
      if (improves) {
        bestScore = result.score;
        bestPv = result.pv;
      }
      if (maximizing) alpha = Math.max(alpha, bestScore);
      else beta = Math.min(beta, bestScore);

      if (beta <= alpha) {
        cutoffs++;
        const moveKey = `${move.from}${move.to}${move.promotion ?? ""}`;
        const killersForDepth = killerMoves.get(remainingDepth) ?? [];
        if (!killersForDepth.includes(moveKey))
          killerMoves.set(
            remainingDepth,
            [moveKey, ...killersForDepth].slice(0, 2),
          );
        historyScores.set(
          moveKey,
          (historyScores.get(moveKey) ?? 0) + remainingDepth * remainingDepth,
        );
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
            heuristics: evaluateHeuristics(chess, aiColor),
          });
        }
        break;
      }
    }

    const cacheFlag =
      bestScore <= originalAlpha
        ? "upper"
        : bestScore >= originalBeta
          ? "lower"
          : "exact";
    transpositionTable.set(cacheKey, {
      depth: remainingDepth,
      score: Number.isFinite(bestScore) ? bestScore : 0,
      pv: bestPv.slice(path.length),
      flag: cacheFlag,
    });
    const parent = nodesById.get(parentId);
    if (parent) {
      parent.score = Number.isFinite(bestScore)
        ? bestScore
        : evaluateMaterial(chess, aiColor, weights);
      parent.alpha = alpha;
      parent.beta = beta;
      parent.status = "evaluated";
      parent.heuristics = evaluateHeuristics(chess, aiColor);
      parent.explanation = `${maximizing ? "Max" : "Min"} backs up the best child score.`;
    }
    return { score: Number.isFinite(bestScore) ? bestScore : 0, pv: bestPv };
  }

  const result = search(rootChess, depth, -Infinity, Infinity, root.id, []);
  const rootChildren = root.children
    .map((id) => nodesById.get(id))
    .filter((node): node is MinimaxSearchNode => Boolean(node));
  const bestRoot =
    rootChess.turn() === aiColor
      ? rootChildren
          .filter((node) => node.status !== "pruned" && node.score !== null)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
      : undefined;

  const principalIds = new Set<string>();
  let cursor: MinimaxSearchNode | undefined = bestRoot;
  while (cursor) {
    principalIds.add(cursor.id);
    cursor = cursor.children
      .map((id) => nodesById.get(id))
      .filter((node): node is MinimaxSearchNode => Boolean(node))
      .filter((node) => node.score !== null && node.status !== "pruned")
      .sort(
        (a, b) =>
          Math.abs((b.score ?? 0) - (bestRoot?.score ?? 0)) -
          Math.abs((a.score ?? 0) - (bestRoot?.score ?? 0)),
      )[0];
  }
  for (const node of nodes) {
    if (principalIds.has(node.id)) node.status = "principal";
  }

  return {
    fen,
    sideToMove: rootChess.turn(),
    depth,
    nodes,
    selectedMove:
      bestRoot?.move && bestRoot.san && bestRoot.score !== null
        ? { uci: bestRoot.move, san: bestRoot.san, score: bestRoot.score }
        : null,
    principalVariation: result.pv,
    evaluatedLeaves,
    prunedBranches,
    transpositionHits,
    cutoffs,
    generatedAt: Date.now(),
  };
}
