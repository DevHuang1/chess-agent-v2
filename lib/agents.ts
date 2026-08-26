import { buildMinimaxTrace, HeuristicWeights, MinimaxTrace } from "./minimax";
import { buildMctsTrace, MctsTrace } from "./mcts";

export type AgentStrategy = "materialist" | "positional" | "defender" | "tactician";
export type SearchAlgorithm = "minimax" | "mcts";

export type AgentDefinition = {
  id: AgentStrategy;
  name: string;
  color: string;
  colorHex: number;
  tagline: string;
  weights: HeuristicWeights;
  search: {
    depthOffset: number;
    branchLimit: number;
    iterationsMultiplier: number;
    rolloutDepthOffset: number;
  };
};

export const AGENTS: AgentDefinition[] = [
  {
    id: "materialist",
    name: "Materialist",
    color: "#f472b6",
    colorHex: 0xf472b6,
    tagline: "hunts material, values captures above all",
    weights: { material: 1.8, positional: 0.4, kingSafety: 0.6 },
    search: { depthOffset: 0, branchLimit: 5, iterationsMultiplier: 1.0, rolloutDepthOffset: 0 },
  },
  {
    id: "positional",
    name: "Positional",
    color: "#34d399",
    colorHex: 0x34d399,
    tagline: "seeks control and piece activity",
    weights: { material: 0.6, positional: 1.8, kingSafety: 0.8 },
    search: { depthOffset: 0, branchLimit: 5, iterationsMultiplier: 1.1, rolloutDepthOffset: 0 },
  },
  {
    id: "defender",
    name: "Defender",
    color: "#38bdf8",
    colorHex: 0x38bdf8,
    tagline: "prioritizes king safety and shelter",
    weights: { material: 0.7, positional: 0.5, kingSafety: 2.1 },
    search: { depthOffset: 0, branchLimit: 5, iterationsMultiplier: 1.0, rolloutDepthOffset: 0 },
  },
  {
    id: "tactician",
    name: "Tactician",
    color: "#fbbf24",
    colorHex: 0xfbbf24,
    tagline: "searches deeper to find forcing lines",
    weights: { material: 1.0, positional: 1.0, kingSafety: 1.0 },
    search: { depthOffset: 1, branchLimit: 6, iterationsMultiplier: 1.4, rolloutDepthOffset: 1 },
  },
];

export type AgentTrace = {
  agent: AgentDefinition;
  trace: MinimaxTrace | MctsTrace;
};

export function buildAgentTraces(
  fen: string,
  options: { algorithm: SearchAlgorithm; depth: number; aiColor: "w" | "b" },
): AgentTrace[] {
  return AGENTS.map((agent) => {
    const search = agent.search;
    const trace =
      options.algorithm === "mcts"
        ? buildMctsTrace(fen, {
            iterations: Math.max(24, (options.depth + search.depthOffset) * 24 * search.iterationsMultiplier),
            branchLimit: search.branchLimit,
            rolloutDepth: options.depth + search.rolloutDepthOffset,
            aiColor: options.aiColor,
            weights: agent.weights,
          })
        : buildMinimaxTrace(fen, {
            depth: Math.max(1, options.depth + search.depthOffset),
            branchLimit: search.branchLimit,
            aiColor: options.aiColor,
            weights: agent.weights,
          });
    return { agent, trace };
  });
}