import { buildMctsTrace } from "./mcts";
import { buildMinimaxTrace } from "./minimax";

export type SearchBenchmarkAlgorithm = "minimax" | "mcts";

export type SearchBenchmarkCase = {
  name: string;
  fen: string;
  aiColor: "w" | "b";
};

export type SearchBenchmarkRow = {
  position: string;
  algorithm: SearchBenchmarkAlgorithm;
  depth: number;
  samples: number;
  warmups: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  nodes: number;
  evaluated: number;
  workUnits: number;
  workUnitsPerSecond: number;
};

export type SearchBenchmarkReport = {
  generatedAt: string;
  runtime: string;
  depths: number[];
  samples: number;
  warmups: number;
  rows: SearchBenchmarkRow[];
};

export const DEFAULT_BENCHMARK_CASES: SearchBenchmarkCase[] = [
  {
    name: "opening response",
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    aiColor: "b",
  },
  {
    name: "developed middlegame",
    fen: "r1bq1rk1/ppp2ppp/2nppn2/8/2PP4/2N2N2/PP2BPPP/R1BQK2R w KQ - 0 1",
    aiColor: "w",
  },
  {
    name: "tactical position",
    fen: "r2q1rk1/ppp1bppp/2np1n2/8/2BPP3/2N2N2/PPP2PPP/R1BQ1RK1 b - - 0 1",
    aiColor: "b",
  },
];

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function runSearchBenchmarks(options: {
  cases?: SearchBenchmarkCase[];
  depths?: number[];
  samples?: number;
  warmups?: number;
  now?: () => number;
} = {}): SearchBenchmarkReport {
  const cases = options.cases ?? DEFAULT_BENCHMARK_CASES;
  const depths = (options.depths ?? [1, 2, 3, 4]).map((depth) => Math.max(1, Math.min(4, depth)));
  const samples = Math.max(1, options.samples ?? 3);
  const warmups = Math.max(0, options.warmups ?? 1);
  const now = options.now ?? (() => performance.now());
  const rows: SearchBenchmarkRow[] = [];

  for (const benchmarkCase of cases) {
    for (const depth of depths) {
      for (const algorithm of ["minimax", "mcts"] as const) {
        const run = () => {
          if (algorithm === "minimax") {
            const trace = buildMinimaxTrace(benchmarkCase.fen, { depth, branchLimit: 5, aiColor: benchmarkCase.aiColor });
            return { nodes: trace.nodes.length, evaluated: trace.evaluatedLeaves, workUnits: trace.evaluatedLeaves };
          }
          const trace = buildMctsTrace(benchmarkCase.fen, {
            iterations: Math.max(24, depth * 24),
            branchLimit: 5,
            rolloutDepth: depth,
            aiColor: benchmarkCase.aiColor,
          });
          return { nodes: trace.nodes.length, evaluated: trace.evaluatedLeaves, workUnits: trace.iterations };
        };

        for (let warmup = 0; warmup < warmups; warmup++) run();

        const durations: number[] = [];
        let last = { nodes: 0, evaluated: 0, workUnits: 0 };
        for (let sample = 0; sample < samples; sample++) {
          const startedAt = now();
          last = run();
          durations.push(now() - startedAt);
        }
        const averageMs = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
        const minMs = Math.min(...durations);
        const maxMs = Math.max(...durations);
        rows.push({
          position: benchmarkCase.name,
          algorithm,
          depth,
          samples,
          warmups,
          averageMs: round(averageMs),
          minMs: round(minMs),
          maxMs: round(maxMs),
          nodes: last.nodes,
          evaluated: last.evaluated,
          workUnits: last.workUnits,
          workUnitsPerSecond: round(last.workUnits / Math.max(averageMs, 0.001) * 1000),
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    runtime: typeof process !== "undefined" ? `${process.version} ${process.platform}/${process.arch}` : "browser",
    depths,
    samples,
    warmups,
    rows,
  };
}

export function benchmarkReportToMarkdown(report: SearchBenchmarkReport) {
  const lines = [
    "# Minimax vs. MCTS Search Benchmarks",
    "",
    `Generated: ${report.generatedAt}  `,
    `Runtime: ${report.runtime}  `,
    `Samples per row: ${report.samples}; warmups per row: ${report.warmups}`,
    "",
    "Timing is wall-clock generation time for the local trace builders. Lower average milliseconds is faster; work-units/sec uses evaluated leaves for Minimax and rollout iterations for MCTS.",
    "",
    "| Position | Algorithm | Depth | Avg ms | Min ms | Max ms | Nodes | Evaluated / rollouts | Work units/s |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of report.rows) {
    lines.push(`| ${row.position} | ${row.algorithm} | ${row.depth} | ${row.averageMs.toFixed(3)} | ${row.minMs.toFixed(3)} | ${row.maxMs.toFixed(3)} | ${row.nodes} | ${row.evaluated} | ${row.workUnitsPerSecond.toFixed(0)} |`);
  }
  return `${lines.join("\n")}\n`;
}
