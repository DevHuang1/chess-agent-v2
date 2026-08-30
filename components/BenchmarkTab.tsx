"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type BenchmarkRow = {
  position: string;
  algorithm: string;
  depth: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  nodes: number;
  evaluated: number;
  workUnits: number;
  workUnitsPerSecond: number;
};

type BenchmarkReport = {
  generatedAt: string;
  runtime: string;
  depths: number[];
  samples: number;
  warmups: number;
  rows: BenchmarkRow[];
};

type BenchmarkTabProps = {
  report: BenchmarkReport;
};

type MetricKey = "averageMs" | "workUnitsPerSecond" | "nodes";

const METRICS: Record<MetricKey, { label: string; unit: string; better: "lower" | "higher" }> = {
  averageMs: { label: "Average generation time", unit: "ms", better: "lower" },
  workUnitsPerSecond: { label: "Search throughput", unit: "units/s", better: "higher" },
  nodes: { label: "Generated nodes", unit: "nodes", better: "higher" },
};

function formatNumber(value: number) {
  return value >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value.toFixed(value < 10 ? 2 : 0);
}

export default function BenchmarkTab({ report }: BenchmarkTabProps) {
  const [position, setPosition] = useState("all");
  const [metric, setMetric] = useState<MetricKey>("averageMs");

  const positions = useMemo(() => ["all", ...Array.from(new Set(report.rows.map((row) => row.position)))], [report.rows]);
  const visibleRows = useMemo(() => report.rows.filter((row) => position === "all" || row.position === position), [report.rows, position]);
  const chartMax = Math.max(...visibleRows.map((row) => row[metric]), 1);
  const metricInfo = METRICS[metric];
  const avgByAlgorithm = useMemo(() => {
    const result = { minimax: [] as number[], mcts: [] as number[] };
    for (const row of visibleRows) {
      if (row.algorithm === "minimax" || row.algorithm === "mcts") result[row.algorithm].push(row[metric]);
    }
    return {
      minimax: result.minimax.reduce((sum, value) => sum + value, 0) / Math.max(1, result.minimax.length),
      mcts: result.mcts.reduce((sum, value) => sum + value, 0) / Math.max(1, result.mcts.length),
    };
  }, [visibleRows, metric]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 chat-scroll">
      <Card className="border-cyan-500/25 bg-gradient-to-br from-cyan-950/35 via-zinc-950/80 to-amber-950/20 light:border-cyan-300 light:bg-cyan-50/70">
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-cyan-100 light:text-cyan-900">Search Benchmarks</span>
                <Badge variant="success" className="text-[10px]">LOCAL RUN</Badge>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 light:text-slate-600">Compare the current Minimax and MCTS trace builders across depth limits and representative positions.</p>
            </div>
            <div className="text-right text-[10px] text-zinc-500">{report.runtime}<br />{report.samples} samples · {report.warmups} warmups</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-2"><div className="text-[10px] uppercase tracking-wider text-amber-300 light:text-amber-700">Minimax avg</div><div className="mt-1 font-mono text-lg text-amber-100 light:text-amber-800">{formatNumber(avgByAlgorithm.minimax)} <span className="text-[10px]">{metricInfo.unit}</span></div></div>
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 p-2"><div className="text-[10px] uppercase tracking-wider text-cyan-300 light:text-cyan-700">MCTS avg</div><div className="mt-1 font-mono text-lg text-cyan-100 light:text-cyan-800">{formatNumber(avgByAlgorithm.mcts)} <span className="text-[10px]">{metricInfo.unit}</span></div></div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/50 light:border-slate-300 light:bg-white/70">
        <CardContent className="flex flex-wrap gap-2 p-3">
          <div className="flex min-w-[150px] flex-1 flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Position</label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger className="h-8 text-xs" aria-label="Position">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {positions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "all" ? "All positions" : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-[180px] flex-1 flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Metric</label>
            <Select value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
              <SelectTrigger className="h-8 text-xs" aria-label="Metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(METRICS).map(([key, info]) => (
                  <SelectItem key={key} value={key}>
                    {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/50 light:border-slate-300 light:bg-white/70">
        <CardContent className="p-3">
          <div className="mb-3 flex items-center justify-between">
            <div><span className="text-xs font-semibold text-zinc-200 light:text-slate-800">Depth scaling</span><span className="ml-2 text-[10px] text-zinc-500">{metricInfo.better === "lower" ? "lower is better" : "higher is better"}</span></div>
            <div className="flex gap-2 text-[10px]"><span className="text-amber-300">■ Minimax</span><span className="text-cyan-300">■ MCTS</span></div>
          </div>
          <div className="space-y-3">
            {report.depths.map((depth) => (
              <div key={depth}>
                <div className="mb-1 flex justify-between text-[10px] text-zinc-500"><span>Depth {depth}</span><span>{position === "all" ? "aggregated positions" : position}</span></div>
                <div className="space-y-1.5">
                  {(["minimax", "mcts"] as const).map((algorithm) => {
                    const rows = visibleRows.filter((row) => row.depth === depth && row.algorithm === algorithm);
                    const value = rows.reduce((sum, row) => sum + row[metric], 0) / Math.max(1, rows.length);
                    const width = Math.max(3, (value / chartMax) * 100);
                    return <div key={algorithm} className="flex items-center gap-2"><span className={`w-12 text-[9px] uppercase ${algorithm === "minimax" ? "text-amber-300" : "text-cyan-300"}`}>{algorithm}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800 light:bg-slate-200"><div className={`h-full rounded-full transition-all ${algorithm === "minimax" ? "bg-amber-400" : "bg-cyan-400"}`} style={{ width: `${width}%` }} /></div><span className="w-16 text-right font-mono text-[10px] text-zinc-300 light:text-slate-700">{formatNumber(value)} {metricInfo.unit}</span></div>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/50 light:border-slate-300 light:bg-white/70">
        <CardContent className="p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Benchmark context</div>
          <p className="text-xs leading-relaxed text-zinc-400 light:text-slate-600">Timing measures local trace generation. Minimax work units are evaluated leaves; MCTS work units are rollout iterations. Use AI Lab to switch algorithms and inspect the corresponding search tree in 3D.</p>
          <div className="mt-2 font-mono text-[10px] text-zinc-500">Generated {new Date(report.generatedAt).toLocaleString()}</div>
        </CardContent>
      </Card>
    </div>
  );
}
