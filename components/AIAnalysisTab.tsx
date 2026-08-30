"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { MinimaxSearchNode } from "@/lib/minimax";
import { MctsSearchNode } from "@/lib/mcts";
import { AgentStrategy, AgentTrace, buildAgentTraces } from "@/lib/agents";
import AgentsGraph3D from "@/components/AgentsGraph3D";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

type LastBotMove = {
  uci: string;
  san: string;
  fen: string;
} | null;

type AIAnalysisTabProps = {
  fen: string;
  isBotThinking: boolean;
  lastBotMove: LastBotMove;
  emotion: string;
  analysisEnabled: boolean;
};

const PIECES: Record<string, string> = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚",
};

function formatScore(score: number | null) {
  if (score === null) return "—";
  const pawns = score / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function isMctsNode(
  node: MinimaxSearchNode | MctsSearchNode,
): node is MctsSearchNode {
  return "phase" in node && "visits" in node && "winRate" in node;
}

function nodeTone(node: MinimaxSearchNode, active: boolean) {
  if (active)
    return "border-cyan-400 bg-cyan-400/15 text-cyan-100 shadow-lg shadow-cyan-500/10";
  if (node.status === "principal")
    return "border-amber-400/70 bg-amber-400/10 text-amber-100";
  if (node.status === "pruned")
    return "border-rose-400/40 bg-rose-950/20 text-rose-300 opacity-75";
  if (node.status === "evaluated")
    return "border-emerald-400/40 bg-emerald-950/20 text-emerald-200";
  return "border-zinc-700 bg-zinc-950/60 text-zinc-300";
}

export default function AIAnalysisTab({
  fen,
  isBotThinking,
  lastBotMove,
  emotion,
  analysisEnabled,
}: AIAnalysisTabProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [depth, setDepth] = useState(3);
  const [activeNodeIndex, setActiveNodeIndex] = useState(0);
  const [selectedAgentId, setSelectedAgentId] =
    useState<AgentStrategy>("materialist");
  const [viewMode, setViewMode] = useState<"board" | "graph">("board");
  const [algorithm, setAlgorithm] = useState<"minimax" | "mcts">("minimax");
  const [nodeQuery, setNodeQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "principal" | "evaluated" | "pruned" | "exploring"
  >("all");
  const [depthFilter, setDepthFilter] = useState<"all" | `${number}`>("all");

  const board = useMemo(() => {
    try {
      return new Chess(fen).board();
    } catch {
      return [];
    }
  }, [fen]);

  const agentTraces = useMemo<AgentTrace[]>(() => {
    try {
      if (!analysisEnabled) return [];
      const current = new Chess(fen);
      if (current.isGameOver()) return [];
      return buildAgentTraces(fen, {
        algorithm,
        depth,
        aiColor: current.turn(),
      });
    } catch {
      return [];
    }
  }, [fen, depth, algorithm, analysisEnabled]);

  const focusedEntry =
    agentTraces.find((entry) => entry.agent.id === selectedAgentId) ??
    agentTraces[0] ??
    null;
  const trace = focusedEntry?.trace ?? null;

  useEffect(() => {
    if (!trace || !isPlaying) return;
    const interval = window.setInterval(
      () => {
        setActiveNodeIndex((current) => {
          if (current >= trace.nodes.length - 1) return 0;
          return current + 1;
        });
      },
      Math.max(90, 620 / speed),
    );
    return () => window.clearInterval(interval);
  }, [trace, isPlaying, speed]);

  const safeActiveNodeIndex =
    trace && trace.nodes.length > 0 ? activeNodeIndex % trace.nodes.length : 0;
  const activeIndexes = agentTraces.map(
    (entry) => activeNodeIndex % Math.max(1, entry.trace.nodes.length),
  );
  const activeNode = trace?.nodes[safeActiveNodeIndex] ?? null;
  const selectedNode =
    trace?.nodes.find((node) => node.id === selectedNodeId) ?? activeNode;
  const highlightedFrom =
    selectedNode?.from ?? lastBotMove?.uci.slice(0, 2) ?? null;
  const highlightedTo =
    selectedNode?.to ?? lastBotMove?.uci.slice(2, 4) ?? null;
  const principal = trace?.principalVariation ?? [];
  const liveSearch = isBotThinking && trace?.sideToMove === "b";
  const mctsTrace = trace && "iterations" in trace ? trace : null;
  const availableDepths = useMemo(
    () =>
      Array.from(new Set(trace?.nodes.map((node) => node.depth) ?? [])).sort(
        (a, b) => a - b,
      ),
    [trace],
  );
  const filteredNodes = useMemo(() => {
    if (!trace) return [];
    const query = nodeQuery.trim().toLowerCase();
    return trace.nodes.filter((node) => {
      const matchesQuery =
        !query ||
        [
          node.id,
          node.san ?? "root",
          node.explanation,
          node.from ?? "",
          node.to ?? "",
        ].some((value) => value.toLowerCase().includes(query));
      const matchesStatus =
        statusFilter === "all" || node.status === statusFilter;
      const matchesDepth =
        depthFilter === "all" || String(node.depth) === depthFilter;
      return matchesQuery && matchesStatus && matchesDepth;
    });
  }, [trace, nodeQuery, statusFilter, depthFilter]);
  const highlightedNodeIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes],
  );
  const filterActive =
    nodeQuery.trim().length > 0 ||
    statusFilter !== "all" ||
    depthFilter !== "all";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 chat-scroll">
      <Card className="border-cyan-500/25 bg-gradient-to-br from-cyan-950/35 via-zinc-950/80 to-amber-950/20 light:border-cyan-300 light:bg-cyan-50/70">
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-cyan-100 light:text-cyan-900">
                  {algorithm === "mcts"
                    ? "MCTS Rollout Observatory"
                    : "Minimax Flight Recorder"}
                </span>
                <Badge
                  variant={
                    !analysisEnabled
                      ? "muted"
                      : liveSearch
                        ? "info"
                        : "outline"
                  }
                  className={`text-[10px] ${liveSearch ? "animate-pulse" : ""}`}
                >
                  {!analysisEnabled
                    ? "WAITING FOR GAME"
                    : liveSearch
                      ? "SEARCHING"
                      : "LIVE TRACE"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 light:text-slate-600">
                {!analysisEnabled
                  ? "Make the first move to start live AI analysis. This workspace follows the current game only; use the separate Replay tab for completed games."
                  : algorithm === "mcts"
                    ? `Watch the ${trace?.sideToMove === "b" ? "AI" : "player"} search select promising branches, expand candidates, simulate continuations, and backpropagate win rates.`
                    : `Watch the ${trace?.sideToMove === "b" ? "AI" : "player"} search compare candidate moves, back up evaluations, and prune branches before choosing the principal variation.`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex rounded-md border border-zinc-700/80 bg-black/20 p-0.5 light:border-slate-300 light:bg-white/60">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAlgorithm("minimax")}
                  className={`text-[10px] ${algorithm === "minimax" ? "bg-amber-400/15 text-amber-200" : "text-zinc-500"}`}
                >
                  Minimax
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAlgorithm("mcts")}
                  className={`text-[10px] ${algorithm === "mcts" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500"}`}
                >
                  MCTS
                </Button>
              </div>
              <div className="rounded-lg border border-zinc-700/70 bg-black/25 px-2 py-1 text-right text-[10px] light:border-slate-300 light:bg-white/60">
                <div className="font-mono text-cyan-300 light:text-cyan-700">
                  {emotion}
                </div>
                <div className="text-zinc-500 light:text-slate-500">
                  engine mood
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] sm:gap-3">
            <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2.5 light:border-slate-300 light:bg-white/70">
              <div className="font-mono text-lg text-cyan-200 light:text-cyan-800">
                {trace?.depth ?? depth}
              </div>
              <div className="text-zinc-500">plies</div>
            </div>
            <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2.5 light:border-slate-300 light:bg-white/70">
              <div className="font-mono text-lg text-emerald-300 light:text-emerald-700">
                {algorithm === "mcts"
                  ? (mctsTrace?.iterations ?? 0)
                  : (trace?.evaluatedLeaves ?? 0)}
              </div>
              <div className="text-zinc-500">
                {algorithm === "mcts" ? "rollouts" : "leaves"}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2.5 light:border-slate-300 light:bg-white/70">
              <div className="font-mono text-lg text-rose-300 light:text-rose-700">
                {algorithm === "mcts"
                  ? (mctsTrace?.rootVisits ?? 0)
                  : (trace?.prunedBranches ?? 0)}
              </div>
              <div className="text-zinc-500">
                {algorithm === "mcts" ? "root visits" : "pruned"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/50 light:border-slate-300 light:bg-white/70">
        <CardContent className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-zinc-200 light:text-slate-800">
                Position under analysis
              </span>
              <span className="ml-2 font-mono text-[10px] text-zinc-500">
                {fen.split(" ")[1] === "b" ? "AI to move" : "player to move"}
              </span>
            </div>
            <div className="flex rounded-md border border-zinc-700/80 bg-black/20 p-0.5 light:border-slate-300 light:bg-white/60">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("board")}
                className={`text-[10px] ${viewMode === "board" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500"}`}
              >
                Board
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("graph")}
                className={`text-[10px] ${viewMode === "graph" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500"}`}
              >
                3D Graph
              </Button>
            </div>
          </div>
          {viewMode === "graph" ? (
            <div className="ai-graph-stage flex w-full justify-center">
              <AgentsGraph3D
                agents={agentTraces}
                algorithm={algorithm}
                activeIndexes={activeIndexes}
                selected={
                  selectedNode
                    ? {
                        agentId: focusedEntry?.agent.id ?? "materialist",
                        nodeId: selectedNode.id,
                      }
                    : null
                }
                highlightedNodeIds={highlightedNodeIds}
                highlightAgentId={focusedEntry?.agent.id}
                highlightFilterActive={filterActive}
                onSelectNode={(agentId, nodeId) => {
                  setSelectedAgentId(agentId);
                  setSelectedNodeId(nodeId);
                  const entry = agentTraces.find(
                    (candidate) => candidate.agent.id === agentId,
                  );
                  const index =
                    entry?.trace.nodes.findIndex((node) => node.id === nodeId) ??
                    -1;
                  if (index >= 0) setActiveNodeIndex(index);
                }}
              />
            </div>
          ) : (
            <div className="mx-auto grid aspect-square w-[min(380px,80vw)] max-w-full grid-cols-8 overflow-hidden rounded-lg border border-zinc-700 shadow-2xl light:border-slate-300">
              {board.flatMap((row, rankIndex) =>
                row.map((piece, fileIndex) => {
                  const square = `${String.fromCharCode(97 + fileIndex)}${8 - rankIndex}`;
                  const isLight = (rankIndex + fileIndex) % 2 === 0;
                  const isFrom = square === highlightedFrom;
                  const isTo = square === highlightedTo;
                  return (
                    <div
                      key={square}
                      className={`relative flex aspect-square items-center justify-center text-3xl sm:text-4xl ${isLight ? "bg-[#ead9c3] text-zinc-900" : "bg-[#75563b] text-white"} ${isFrom ? "ring-inset ring-4 ring-cyan-300" : ""} ${isTo ? "ring-inset ring-4 ring-amber-300" : ""}`}
                      title={`${square}${isFrom ? " · candidate origin" : ""}${isTo ? " · candidate destination" : ""}`}
                    >
                      {piece ? (
                        <span
                          className={`drop-shadow-md ${piece.color === "b" ? "text-zinc-950" : "text-white"}`}
                        >
                          {PIECES[`${piece.color}${piece.type}`]}
                        </span>
                      ) : null}
                      {fileIndex === 0 ? (
                        <span className="absolute left-1 top-0.5 text-[8px] font-mono opacity-60">
                          {8 - rankIndex}
                        </span>
                      ) : null}
                      {rankIndex === 7 ? (
                        <span className="absolute bottom-0 right-1 text-[8px] font-mono opacity-60">
                          {String.fromCharCode(97 + fileIndex)}
                        </span>
                      ) : null}
                    </div>
                  );
                }),
              )}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
            <span className="text-zinc-500">
              {viewMode === "graph"
                ? algorithm === "mcts"
                  ? "Active rollout is enlarged · drag to orbit · click a node for stats"
                  : "Active branch is enlarged · drag to orbit · click a node for heuristic weights"
                : "Cyan: candidate origin · Amber: destination"}
            </span>
            {lastBotMove ? (
              <span className="font-mono text-amber-300 light:text-amber-700">
                Last AI: {lastBotMove.san}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/50 light:border-slate-300 light:bg-white/70">
        <CardContent className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-zinc-200 light:text-slate-800">
                Search tree
              </span>
              <span className="ml-2 text-[10px] text-zinc-500">
                click a node to inspect
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPlaying((value) => !value)}
              className="border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-200 hover:bg-cyan-500/20"
            >
              {isPlaying ? "Pause" : "Play"}
            </Button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {agentTraces.map((entry) => (
              <Button
                key={entry.agent.id}
                variant={focusedEntry?.agent.id === entry.agent.id ? "accent" : "outline"}
                size="sm"
                onClick={() => {
                  setSelectedAgentId(entry.agent.id);
                  setSelectedNodeId(null);
                }}
                className="text-[10px]"
              >
                <span
                  className="mr-1.5 h-2 w-2 rounded-full inline-block"
                  style={{ backgroundColor: entry.agent.color }}
                />
                {entry.agent.name}
              </Button>
            ))}
          </div>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Input
              aria-label="Search graph nodes"
              value={nodeQuery}
              onChange={(event) => setNodeQuery(event.target.value)}
              placeholder="Search SAN, node ID, or explanation"
              className="min-w-0 text-[11px]"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-9 text-[11px]" aria-label="Graph node status" />
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="principal">Principal</SelectItem>
                <SelectItem value="evaluated">Evaluated</SelectItem>
                <SelectItem value="pruned">Pruned</SelectItem>
                <SelectItem value="exploring">Exploring</SelectItem>
              </SelectContent>
            </Select>
            <Select value={depthFilter} onValueChange={(v) => setDepthFilter(v as typeof depthFilter)}>
              <SelectTrigger className="h-9 text-[11px]" aria-label="Graph node depth" />
              <SelectContent>
                <SelectItem value="all">All depths</SelectItem>
                {availableDepths.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    Depth {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500">
            <span>
              {filterActive
                ? `${filteredNodes.length} matching nodes`
                : `${trace?.nodes.length ?? 0} nodes in trace`}
            </span>
            {filterActive ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setNodeQuery("");
                  setStatusFilter("all");
                  setDepthFilter("all");
                }}
                className="h-auto p-0 text-cyan-300 hover:text-cyan-100"
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-2">
            {trace && filteredNodes.length > 0 ? (
              filteredNodes.slice(0, 36).map((node) => (
                <Button
                  variant="ghost"
                  type="button"
                  key={node.id}
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    const index =
                      trace?.nodes.findIndex(
                        (candidate) => candidate.id === node.id,
                      ) ?? -1;
                    if (index >= 0) setActiveNodeIndex(index);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-all ${nodeTone(node, node.id === selectedNode?.id)} ${node.depth === 0 ? "border-cyan-500/30" : "ml-2"}`}
                >
                  <span className="min-w-0">
                    <span className="mr-2 font-mono text-[10px] text-zinc-500">
                      d{node.depth}
                    </span>
                    <span className="font-mono text-xs font-bold">
                      {node.san ?? "root"}
                    </span>
                    <span className="ml-2 truncate text-[10px] opacity-70">
                      {node.status === "pruned"
                        ? "alpha–beta cutoff"
                        : isMctsNode(node)
                          ? `${node.phase} · ${node.visits} visits`
                          : node.explanation}
                    </span>
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-[10px]">
                    {formatScore(node.score)}
                  </span>
                </Button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-xs text-zinc-500 light:border-slate-300">
                {trace
                  ? "No nodes match the current search or filters."
                  : "Make a move to give Sentio a position to search."}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="border-amber-500/25 bg-amber-950/15 light:border-amber-300 light:bg-amber-50/70">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 light:text-amber-700">
              {algorithm === "mcts" ? "Most visited line" : "Principal variation"}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {principal.length > 0 ? (
                principal.map((move, index) => (
                  <Badge key={`${move}-${index}`} variant="accent" className="font-mono text-xs">
                    {index + 1}. {move}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-zinc-500">
                  Waiting for an AI turn.
                </span>
              )}
            </div>
            <div className="mt-3 text-xs text-zinc-300 light:text-slate-700">
              {algorithm === "mcts" &&
              trace?.selectedMove &&
              "visits" in trace.selectedMove ? (
                <span className="mr-2 text-cyan-200">
                  {trace.selectedMove.visits} visits ·{" "}
                  {(trace.selectedMove.winRate * 100).toFixed(0)}% win rate
                </span>
              ) : null}
              Selected:{" "}
              <strong className="font-mono text-amber-300 light:text-amber-700">
                {trace?.selectedMove?.san ?? lastBotMove?.san ?? "—"}
              </strong>
              {trace?.selectedMove ? (
                <span className="ml-2 text-zinc-500">
                  evaluation {formatScore(trace.selectedMove.score)}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800/80 bg-zinc-950/50 light:border-slate-300 light:bg-white/70">
          <CardContent className="p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
              Playback depth
            </div>
            <div className="flex items-center gap-2">
              <input
                aria-label={
                  algorithm === "mcts" ? "MCTS rollout depth" : "Minimax depth"
                }
                type="range"
                min="1"
                max="6"
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
                className="w-full accent-cyan-400"
              />
              <span className="w-7 text-right font-mono text-xs text-cyan-300">
                {depth}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] text-zinc-500">
                {algorithm === "mcts" ? "Rollout speed" : "Animation speed"}
              </span>
              {[0.5, 1, 2].map((value) => (
                <Button
                  key={value}
                  variant={speed === value ? "accent" : "outline"}
                  size="sm"
                  className="text-[10px]"
                  onClick={() => setSpeed(value)}
                >
                  {value}×
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
