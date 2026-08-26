import { Chess, Move, Square } from "chess.js";
import { DEFAULT_WEIGHTS, evaluateHeuristics, HeuristicWeights, MinimaxSearchNode, MinimaxTrace } from "./minimax";

export type MctsPhase = "selection" | "expansion" | "simulation" | "backpropagation";

export type MctsSearchNode = MinimaxSearchNode & {
  phase: MctsPhase;
  visits: number;
  wins: number;
  winRate: number;
  exploration: number;
};

export type MctsTrace = Omit<MinimaxTrace, "nodes" | "selectedMove"> & {
  algorithm: "mcts";
  nodes: MctsSearchNode[];
  selectedMove: { uci: string; san: string; score: number; visits: number; winRate: number } | null;
  iterations: number;
  rootVisits: number;
};

function hashSeed(input: string) {
  let seed = 2166136261;
  for (let index = 0; index < input.length; index++) {
    seed ^= input.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function random(seed: { value: number }) {
  seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
  return seed.value / 0x1_0000_0000;
}

function movePriority(move: Move) {
  return (move.captured ? 1000 : 0) + (move.promotion ? 500 : 0) + (move.san.includes("+") ? 80 : 0);
}

function orderedMoves(chess: Chess) {
  return chess.moves({ verbose: true }).sort((a, b) => movePriority(b) - movePriority(a) || a.san.localeCompare(b.san));
}

function resultFromScore(score: number) {
  return Math.max(0.02, Math.min(0.98, 0.5 + score / 2400));
}

export function buildMctsTrace(
  fen: string,
  options: { iterations?: number; branchLimit?: number; rolloutDepth?: number; aiColor?: "w" | "b"; weights?: HeuristicWeights } = {},
): MctsTrace {
  const iterations = Math.max(12, Math.min(180, options.iterations ?? 64));
  const branchLimit = Math.max(2, Math.min(8, options.branchLimit ?? 5));
  const rolloutDepth = Math.max(1, Math.min(6, options.rolloutDepth ?? 3));
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const rootChess = new Chess(fen);
  const aiColor = options.aiColor ?? rootChess.turn();
  const seed = { value: hashSeed(fen) };
  const nodes: MctsSearchNode[] = [];
  const states = new Map<string, Chess>();
  const expandedMoves = new Map<string, Move[]>();
  let sequence = 0;
  let evaluatedLeaves = 0;

  const addNode = (node: Omit<MctsSearchNode, "id">, chess: Chess) => {
    const id = `mcts-${sequence++}`;
    const fullNode = { id, ...node };
    nodes.push(fullNode);
    states.set(id, new Chess(chess.fen()));
    if (node.parentId) nodes.find((candidate) => candidate.id === node.parentId)?.children.push(id);
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
    explanation: "MCTS starts at the root and allocates simulations toward promising moves.",
    heuristics: evaluateHeuristics(rootChess, aiColor),
    phase: "selection",
    visits: 0,
    wins: 0,
    winRate: 0.5,
    exploration: 0,
  }, rootChess);

  function uct(node: MctsSearchNode, parentVisits: number) {
    if (node.visits === 0) return Number.POSITIVE_INFINITY;
    return node.winRate + Math.SQRT2 * Math.sqrt(Math.log(Math.max(1, parentVisits)) / node.visits);
  }

  function selectChild(parent: MctsSearchNode) {
    return parent.children
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is MctsSearchNode => Boolean(node))
      .sort((a, b) => uct(b, parent.visits) - uct(a, parent.visits))[0] ?? null;
  }

  for (let iteration = 0; iteration < iterations; iteration++) {
    const path: MctsSearchNode[] = [root];
    let current = root;
    const chess = new Chess(states.get(root.id)!.fen());
    current.phase = "selection";

    while (current.children.length >= branchLimit && current.depth < rolloutDepth) {
      const next = selectChild(current);
      if (!next) break;
      current.phase = "selection";
      next.phase = "selection";
      const applied = next.move ? chess.move({ from: next.move.slice(0, 2) as Square, to: next.move.slice(2, 4) as Square, promotion: next.move[4] as "q" | "r" | "b" | "n" | undefined }) : null;
      if (!applied) break;
      current = next;
      path.push(current);
    }

    const legal = expandedMoves.get(current.id) ?? orderedMoves(chess);
    expandedMoves.set(current.id, legal);
    let child = current.children.length < Math.min(branchLimit, legal.length)
      ? nodes.find((node) => node.parentId === current.id && node.move === `${legal[current.children.length].from}${legal[current.children.length].to}${legal[current.children.length].promotion ?? ""}`)
      : null;

    if (!child && current.children.length < Math.min(branchLimit, legal.length)) {
      const move = legal[current.children.length];
      const applied = chess.move({ from: move.from as Square, to: move.to as Square, promotion: move.promotion });
      if (applied) {
        child = addNode({
          parentId: current.id,
          depth: current.depth + 1,
          move: `${applied.from}${applied.to}${applied.promotion ?? ""}`,
          san: applied.san,
          from: applied.from,
          to: applied.to,
          score: null,
          alpha: null,
          beta: null,
          status: "exploring",
          children: [],
          explanation: `Expansion adds ${applied.san} as a new candidate branch.`,
          heuristics: evaluateHeuristics(chess, aiColor),
          phase: "expansion",
          visits: 0,
          wins: 0,
          winRate: 0.5,
          exploration: Number.POSITIVE_INFINITY,
        }, chess);
        path.push(child);
        current = child;
      }
    }

    current.phase = "simulation";
    const rollout = new Chess(chess.fen());
    for (let ply = 0; ply < rolloutDepth && !rollout.isGameOver(); ply++) {
      const moves = orderedMoves(rollout);
      if (moves.length === 0) break;
      const top = moves.slice(0, Math.min(4, moves.length));
      const chosen = top[Math.floor(random(seed) * top.length)];
      rollout.move({ from: chosen.from as Square, to: chosen.to as Square, promotion: chosen.promotion });
    }
    evaluatedLeaves++;
    const rolloutHeuristics = evaluateHeuristics(rollout, aiColor);
    const score = rolloutHeuristics.material * weights.material + rolloutHeuristics.positional * weights.positional + rolloutHeuristics.kingSafety * weights.kingSafety;
    const result = rollout.isCheckmate() ? (rollout.turn() === aiColor ? 0 : 1) : resultFromScore(score);

    for (const node of path) {
      node.phase = "backpropagation";
      node.visits++;
      node.wins += result;
      node.winRate = node.wins / node.visits;
      node.score = Math.round((node.winRate - 0.5) * 2000);
      node.exploration = node === root || node.visits === 0 ? 0 : uct(node, node.parentId ? nodes.find((candidate) => candidate.id === node.parentId)?.visits ?? 1 : 1);
      node.status = "evaluated";
      node.heuristics = evaluateHeuristics(states.get(node.id) ?? rollout, aiColor);
      node.explanation = `${node.phase === "backpropagation" ? "Backpropagation" : "Simulation"} updates ${node.visits} visits with a ${(node.winRate * 100).toFixed(0)}% win rate.`;
    }
  }

  const rootChildren = root.children
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is MctsSearchNode => Boolean(node))
    .sort((a, b) => b.visits - a.visits || b.winRate - a.winRate);
  const bestRoot = rootChildren[0];
  const principalIds = new Set<string>();
  const principalVariation: string[] = [];
  let cursor = bestRoot;
  while (cursor) {
    principalIds.add(cursor.id);
    if (cursor.san) principalVariation.push(cursor.san);
    cursor = cursor.children
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is MctsSearchNode => Boolean(node))
      .sort((a, b) => b.visits - a.visits)[0];
  }
  for (const node of nodes) if (principalIds.has(node.id)) node.status = "principal";

  return {
    algorithm: "mcts",
    fen,
    sideToMove: rootChess.turn(),
    depth: rolloutDepth,
    nodes,
    selectedMove: bestRoot
      ? { uci: bestRoot.move!, san: bestRoot.san!, score: bestRoot.score ?? 0, visits: bestRoot.visits, winRate: bestRoot.winRate }
      : null,
    principalVariation,
    evaluatedLeaves,
    prunedBranches: 0,
    transpositionHits: 0,
    cutoffs: 0,
    generatedAt: Date.now(),
    iterations,
    rootVisits: root.visits,
  };
}
