"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { buildMinimaxTrace, MinimaxSearchNode, MinimaxTrace } from "@/lib/minimax";
import { buildMctsTrace, MctsSearchNode, MctsTrace } from "@/lib/mcts";
import MinimaxGraph3D from "@/components/MinimaxGraph3D";

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
};

const PIECES: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

function formatScore(score: number | null) {
  if (score === null) return "—";
  const pawns = score / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function isMctsNode(node: MinimaxSearchNode | MctsSearchNode): node is MctsSearchNode {
  return "phase" in node && "visits" in node && "winRate" in node;
}

function nodeTone(node: MinimaxSearchNode, active: boolean) {
  if (active) return "border-cyan-400 bg-cyan-400/15 text-cyan-100 shadow-lg shadow-cyan-500/10";
  if (node.status === "principal") return "border-amber-400/70 bg-amber-400/10 text-amber-100";
  if (node.status === "pruned") return "border-rose-400/40 bg-rose-950/20 text-rose-300 opacity-75";
  if (node.status === "evaluated") return "border-emerald-400/40 bg-emerald-950/20 text-emerald-200";
  return "border-zinc-700 bg-zinc-950/60 text-zinc-300";
}

export default function AIAnalysisTab({ fen, isBotThinking, lastBotMove, emotion }: AIAnalysisTabProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [depth, setDepth] = useState(3);
  const [activeNodeIndex, setActiveNodeIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"board" | "graph">("board");
  const [algorithm, setAlgorithm] = useState<"minimax" | "mcts">("minimax");

  const board = useMemo(() => {
    try {
      return new Chess(fen).board();
    } catch {
      return [];
    }
  }, [fen]);

  const trace = useMemo<MinimaxTrace | MctsTrace | null>(() => {
    try {
      const current = new Chess(fen);
      if (current.isGameOver()) return null;
      const searchColor = current.turn();
      return algorithm === "mcts"
        ? buildMctsTrace(fen, { iterations: Math.max(24, depth * 24), branchLimit: 5, rolloutDepth: depth, aiColor: searchColor })
        : buildMinimaxTrace(fen, { depth, branchLimit: 5, aiColor: searchColor });
    } catch {
      return null;
    }
  }, [fen, depth, algorithm]);

  useEffect(() => {
    if (!trace || !isPlaying) return;
    const interval = window.setInterval(() => {
      setActiveNodeIndex((current) => {
        if (current >= trace.nodes.length - 1) return 0;
        return current + 1;
      });
    }, Math.max(90, 620 / speed));
    return () => window.clearInterval(interval);
  }, [trace, isPlaying, speed]);

  const safeActiveNodeIndex = trace && trace.nodes.length > 0 ? activeNodeIndex % trace.nodes.length : 0;
  const activeNode = trace?.nodes[safeActiveNodeIndex] ?? null;
  const selectedNode = trace?.nodes.find((node) => node.id === selectedNodeId) ?? activeNode;
  const highlightedFrom = selectedNode?.from ?? lastBotMove?.uci.slice(0, 2) ?? null;
  const highlightedTo = selectedNode?.to ?? lastBotMove?.uci.slice(2, 4) ?? null;
  const principal = trace?.principalVariation ?? [];
  const liveSearch = isBotThinking && trace?.sideToMove === "b";
  const mctsTrace = trace && "iterations" in trace ? trace : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 chat-scroll">
      <div className="rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/35 via-zinc-950/80 to-amber-950/20 p-3 light:border-cyan-300 light:bg-cyan-50/70">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-cyan-100 light:text-cyan-900">{algorithm === "mcts" ? "MCTS Rollout Observatory" : "Minimax Flight Recorder"}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${liveSearch ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-200 animate-pulse" : "border-zinc-700 bg-zinc-900 text-zinc-400 light:border-slate-300 light:bg-white light:text-slate-500"}`}>
                {liveSearch ? "SEARCHING" : "REPLAY"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 light:text-slate-600">
              {algorithm === "mcts" ? `Watch the ${trace?.sideToMove === "b" ? "AI" : "player"} search select promising branches, expand candidates, simulate continuations, and backpropagate win rates.` : `Watch the ${trace?.sideToMove === "b" ? "AI" : "player"} search compare candidate moves, back up evaluations, and prune branches before choosing the principal variation.`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex rounded-md border border-zinc-700/80 bg-black/20 p-0.5 light:border-slate-300 light:bg-white/60">
              <button type="button" onClick={() => setAlgorithm("minimax")} className={`rounded px-2 py-1 text-[10px] font-semibold ${algorithm === "minimax" ? "bg-amber-400/15 text-amber-200" : "text-zinc-500"}`}>Minimax</button>
              <button type="button" onClick={() => setAlgorithm("mcts")} className={`rounded px-2 py-1 text-[10px] font-semibold ${algorithm === "mcts" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500"}`}>MCTS</button>
            </div>
            <div className="rounded-lg border border-zinc-700/70 bg-black/25 px-2 py-1 text-right text-[10px] light:border-slate-300 light:bg-white/60">
            <div className="font-mono text-cyan-300 light:text-cyan-700">{emotion}</div>
            <div className="text-zinc-500 light:text-slate-500">engine mood</div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2 light:border-slate-300 light:bg-white/70"><div className="font-mono text-lg text-cyan-200 light:text-cyan-800">{trace?.depth ?? depth}</div><div className="text-zinc-500">plies</div></div>
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2 light:border-slate-300 light:bg-white/70"><div className="font-mono text-lg text-emerald-300 light:text-emerald-700">{algorithm === "mcts" ? (mctsTrace?.iterations ?? 0) : (trace?.evaluatedLeaves ?? 0)}</div><div className="text-zinc-500">{algorithm === "mcts" ? "rollouts" : "leaves"}</div></div>
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2 light:border-slate-300 light:bg-white/70"><div className="font-mono text-lg text-rose-300 light:text-rose-700">{algorithm === "mcts" ? (mctsTrace?.rootVisits ?? 0) : (trace?.prunedBranches ?? 0)}</div><div className="text-zinc-500">{algorithm === "mcts" ? "root visits" : "pruned"}</div></div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 light:border-slate-300 light:bg-white/70">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <span className="text-xs font-semibold text-zinc-200 light:text-slate-800">Position under analysis</span>
            <span className="ml-2 font-mono text-[10px] text-zinc-500">{fen.split(" ")[1] === "b" ? "AI to move" : "player to move"}</span>
          </div>
          <div className="flex rounded-md border border-zinc-700/80 bg-black/20 p-0.5 light:border-slate-300 light:bg-white/60">
            <button type="button" onClick={() => setViewMode("board")} className={`rounded px-2 py-1 text-[10px] font-semibold ${viewMode === "board" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500"}`}>Board</button>
            <button type="button" onClick={() => setViewMode("graph")} className={`rounded px-2 py-1 text-[10px] font-semibold ${viewMode === "graph" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500"}`}>3D Graph</button>
          </div>
        </div>
        {viewMode === "graph" ? (
          <MinimaxGraph3D
            trace={trace}
            algorithm={algorithm}
            activeNodeIndex={safeActiveNodeIndex}
            selectedNodeId={selectedNodeId}
            onSelectNode={(nodeId) => { setSelectedNodeId(nodeId); const index = trace?.nodes.findIndex((node) => node.id === nodeId) ?? -1; if (index >= 0) setActiveNodeIndex(index); }}
          />
        ) : (
        <div className="mx-auto grid aspect-square w-full max-w-[300px] grid-cols-8 overflow-hidden rounded-lg border border-zinc-700 shadow-2xl light:border-slate-300">
          {board.flatMap((row, rankIndex) => row.map((piece, fileIndex) => {
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
                {piece ? <span className={`drop-shadow-md ${piece.color === "b" ? "text-zinc-950" : "text-white"}`}>{PIECES[`${piece.color}${piece.type}`]}</span> : null}
                {fileIndex === 0 ? <span className="absolute left-1 top-0.5 text-[8px] font-mono opacity-60">{8 - rankIndex}</span> : null}
                {rankIndex === 7 ? <span className="absolute bottom-0 right-1 text-[8px] font-mono opacity-60">{String.fromCharCode(97 + fileIndex)}</span> : null}
              </div>
            );
          }))}
        </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
              <span className="text-zinc-500">{viewMode === "graph" ? (algorithm === "mcts" ? "Active rollout is enlarged · drag to orbit · click a node for stats" : "Active branch is enlarged · drag to orbit · click a node for heuristic weights") : "Cyan: candidate origin · Amber: destination"}</span>
          {lastBotMove ? <span className="font-mono text-amber-300 light:text-amber-700">Last AI: {lastBotMove.san}</span> : null}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 light:border-slate-300 light:bg-white/70">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-zinc-200 light:text-slate-800">Search tree</span>
            <span className="ml-2 text-[10px] text-zinc-500">click a node to inspect</span>
          </div>
          <button type="button" onClick={() => setIsPlaying((value) => !value)} className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/20 light:text-cyan-800">
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {trace ? trace.nodes.slice(0, 36).map((node, index) => (
            <button
              type="button"
              key={node.id}
              onClick={() => { setSelectedNodeId(node.id); setActiveNodeIndex(index); }}
              className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-all ${nodeTone(node, node.id === selectedNode?.id)} ${node.depth === 0 ? "border-cyan-500/30" : "ml-2"}`}
            >
              <span className="min-w-0">
                <span className="mr-2 font-mono text-[10px] text-zinc-500">d{node.depth}</span>
                <span className="font-mono text-xs font-bold">{node.san ?? "root"}</span>
                <span className="ml-2 truncate text-[10px] opacity-70">{node.status === "pruned" ? "alpha–beta cutoff" : (isMctsNode(node) ? `${node.phase} · ${node.visits} visits` : node.explanation)}</span>
              </span>
              <span className="ml-2 shrink-0 font-mono text-[10px]">{formatScore(node.score)}</span>
            </button>
          )) : (
            <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-xs text-zinc-500 light:border-slate-300">Make a move to give Sentio a position to search.</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-3 light:border-amber-300 light:bg-amber-50/70">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 light:text-amber-700">{algorithm === "mcts" ? "Most visited line" : "Principal variation"}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {principal.length > 0 ? principal.map((move, index) => <span key={`${move}-${index}`} className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-xs text-amber-100 light:text-amber-800">{index + 1}. {move}</span>) : <span className="text-xs text-zinc-500">Waiting for an AI turn.</span>}
          </div>
          <div className="mt-3 text-xs text-zinc-300 light:text-slate-700">
            {algorithm === "mcts" && trace?.selectedMove && "visits" in trace.selectedMove ? <span className="mr-2 text-cyan-200">{trace.selectedMove.visits} visits · {(trace.selectedMove.winRate * 100).toFixed(0)}% win rate</span> : null}
            Selected: <strong className="font-mono text-amber-300 light:text-amber-700">{trace?.selectedMove?.san ?? lastBotMove?.san ?? "—"}</strong>
            {trace?.selectedMove ? <span className="ml-2 text-zinc-500">evaluation {formatScore(trace.selectedMove.score)}</span> : null}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 light:border-slate-300 light:bg-white/70">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Playback depth</div>
          <div className="flex items-center gap-2">
            <input aria-label={algorithm === "mcts" ? "MCTS rollout depth" : "Minimax depth"} type="range" min="1" max="6" value={depth} onChange={(event) => setDepth(Number(event.target.value))} className="w-full accent-cyan-400" />
            <span className="w-7 text-right font-mono text-xs text-cyan-300">{depth}</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] text-zinc-500">{algorithm === "mcts" ? "Rollout speed" : "Animation speed"}</span>
            {[0.5, 1, 2].map((value) => <button type="button" key={value} onClick={() => setSpeed(value)} className={`rounded-md border px-2 py-1 text-[10px] ${speed === value ? "border-cyan-300 bg-cyan-400/15 text-cyan-200" : "border-zinc-700 text-zinc-500"}`}>{value}×</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}
