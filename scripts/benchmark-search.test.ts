import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { benchmarkReportToMarkdown, runSearchBenchmarks } from "../lib/searchBenchmark";

describe("Minimax versus MCTS performance benchmark", () => {
  it("generates the depth comparison report", () => {
    const report = runSearchBenchmarks({
      depths: [1, 2, 3, 4],
      samples: 5,
      warmups: 2,
    });
    const outputDirectory = resolve(process.cwd(), "benchmarks");
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(resolve(outputDirectory, "search-benchmark.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(resolve(outputDirectory, "search-benchmark.md"), benchmarkReportToMarkdown(report));

    expect(report.rows).toHaveLength(3 * 4 * 2);
    expect(report.rows.every((row) => row.averageMs >= 0 && row.workUnits > 0)).toBe(true);
  }, 120_000);
});
