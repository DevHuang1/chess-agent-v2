"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
} from "@/lib/audio";
import { buildMinimaxTrace, evaluateMaterial } from "@/lib/minimax";
import { buildMctsTrace } from "@/lib/mcts";
import { FUSION_WEIGHTS, type GameSignals } from "@/lib/emotionFusion";
import { EMOTION_PROFILES, type EmotionLabel } from "@/lib/engineProfiles";
import { lookupOpening } from "@/lib/openings";
import { queueUnanalyzedGame } from "@/lib/gameAnalysis";
import { COACH_AUTO_ENCOURAGEMENT, generateRemark } from "@/lib/remarks";
import type {
  ChatMessage,
  EngineDiagnostics,
  EngineProfile,
  GameOutcome,
  LiveAiMode,
} from "@/lib/gameTypes";
import type { ReplayGame, ReplayMove } from "@/components/Simulation3D";
import type { MoveAlgorithm, MoveProvenance, ProvenancedMove } from "@/lib/provenance";
import {
  actorLabel,
  playerMoveProvenance,
  unknownMoveProvenance,
} from "@/lib/provenance";

const BOT_MOVE_API_URL = "/api/bot-move";

function serializeReplayMoves(moves: ProvenancedMove[]): ReplayMove[] {
  return moves.map((move) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    color: move.color,
    flags: move.flags,
    promotion: move.promotion,
    provenance: move.provenance,
  }));
}

/** Build a ProvenancedMove from an applied chess.js Move, tagging it with provenance. */
function toProvenancedMove(
  move: { from: string; to: string; san: string; color: "w" | "b"; flags: string; promotion?: string },
  fen: string,
  provenance: MoveProvenance,
): ProvenancedMove {
  return {
    from: move.from,
    to: move.to,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ""}`,
    color: move.color,
    flags: move.flags,
    promotion: move.promotion,
    moveNumber: 0,
    fen,
    provenance,
  };
}

/** Recompute each move's display move number from its position in history. */
function computeMoveNumbers(history: ProvenancedMove[]): ProvenancedMove[] {
  let count = 0;
  return history.map((move) => {
    count += 1;
    return {
      ...move,
      moveNumber: move.color === "w" ? Math.floor((count + 1) / 2) : Math.floor(count / 2),
    };
  });
}

export function useChessGame(
  emotion: EmotionLabel,
  emotionMode: "auto" | "manual",
  workspaceTab: "board" | "train",
  activeTab: string,
  setWorkspaceTab: (tab: "board" | "train") => void,
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  getGameSignals: () => Partial<GameSignals>,
  clearExternalTelemetry: () => void,
) {
  const chessRef = useRef(new Chess());
  const lastMoveTimestampRef = useRef<number>(0);
  const lastCoachAutoMessageRef = useRef(0);
  const gameIdRef = useRef(0);
  const botRequestControllerRef = useRef<AbortController | null>(null);

  const [gamePosition, setGamePosition] = useState(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  );
  const [moveHistory, setMoveHistory] = useState<ProvenancedMove[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoveTargets, setLegalMoveTargets] = useState<
    { square: string; isCapture: boolean }[]
  >([]);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [backendEngineProfile, setBackendEngineProfile] =
    useState<EngineProfile | null>(null);
  const [gameOutcome, setGameOutcome] = useState<GameOutcome>("active");
  const [statusMessage, setStatusMessage] = useState("Sentio online.");
  const [hintMove, setHintMove] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [isHintLoading, setIsHintLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<number | null>(null);
  const lastHintAtRef = useRef(0);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [lastBotMove, setLastBotMove] = useState<{
    uci: string;
    san: string;
    fen: string;
  } | null>(null);
  const [liveAiMode, setLiveAiMode] = useState<LiveAiMode>("off");
  const [liveAiDepth, setLiveAiDepth] = useState(3);
  const [liveAiAnimating, setLiveAiAnimating] = useState(false);
  const liveAiTurnInFlightRef = useRef(false);
  const [botRemark, setBotRemark] = useState("");

  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const aiHandRef = useRef<HTMLDivElement | null>(null);
  const aiHandRafRef = useRef<number | null>(null);

  const botMoveAtRef = useRef(0);
  const playerSetbacksRef = useRef<number[]>([]);
  const lastEvalLossRef = useRef<{ loss: number; at: number } | null>(null);
  const lastPlayerEvalRef = useRef<number | null>(null);
  const SETBACK_WINDOW_MS = 90_000;
  const EVAL_LOSS_FRESH_MS = 30_000;

  const engineProfile = backendEngineProfile ?? {
    emotion,
    ...EMOTION_PROFILES[emotion],
  };

  /** Append a played move to reactive history, tagging it with provenance. */
  function appendHistoryMove(
    appliedMove: {
      from: string;
      to: string;
      san: string;
      color: "w" | "b";
      flags: string;
      promotion?: string;
    },
    fen: string,
    provenance: MoveProvenance,
  ) {
    setMoveHistory((previous) =>
      computeMoveNumbers([
        ...previous,
        toProvenancedMove(appliedMove, fen, provenance),
      ]),
    );
  }

  /** Truncate history to `length` moves (used by undo). */
  function truncateHistory(length: number) {
    setMoveHistory((previous) =>
      computeMoveNumbers(previous.slice(0, length)),
    );
  }

  /** Replace the whole history (training start, reset, replay). */
  function replaceHistory(moves: ProvenancedMove[]) {
    setMoveHistory(computeMoveNumbers(moves));
  }

  function updateGameOutcome(chess: Chess) {
    if (!chess.isGameOver()) {
      setGameOutcome("active");
      return false;
    }
    queueUnanalyzedGame({
      id: `game-${gameIdRef.current}-${Date.now()}`,
      finishedAt: Date.now(),
      outcome: chess.isCheckmate()
        ? chess.turn() === "w"
          ? "black wins"
          : "white wins"
        : chess.isStalemate()
          ? "stalemate"
          : "draw",
      playerColor: "w",
      movesSan: chess.history(),
    });
    if (chess.isCheckmate()) {
      setGameOutcome("checkmate");
      setStatusMessage("Checkmate. Game over.");
      return true;
    }
    if (chess.isStalemate()) {
      setGameOutcome("stalemate");
      setStatusMessage("Stalemate. Game over.");
      return true;
    }
    if (chess.isDraw()) {
      setGameOutcome("draw");
      setStatusMessage("Draw. Game over.");
      return true;
    }
    setGameOutcome("gameover");
    setStatusMessage("Game over.");
    return true;
  }

  function runLiveAiMove() {
    if (liveAiMode === "off" || chessRef.current.isGameOver()) return false;
    const chess = chessRef.current;
    const currentFen = chess.fen();
    setIsBotThinking(true);
    setStatusMessage(
      `${liveAiMode === "mcts" ? "MCTS" : "Minimax"} is searching at depth ${liveAiDepth}...`,
    );
    const trace =
      liveAiMode === "mcts"
        ? buildMctsTrace(currentFen, {
            iterations: Math.min(180, Math.max(24, liveAiDepth * 24)),
            branchLimit: 5,
            rolloutDepth: liveAiDepth,
            aiColor: chess.turn(),
          })
        : buildMinimaxTrace(currentFen, {
            depth: liveAiDepth,
            branchLimit: 5,
            aiColor: chess.turn(),
          });
    const selected = trace.selectedMove;
    if (!selected) {
      setIsBotThinking(false);
      setStatusMessage("No legal move available for the live AI.");
      return false;
    }
    const target = chess.get(selected.uci.slice(2, 4) as Square);
    const isCapture = Boolean(target);
    const applied = chess.move({
      from: selected.uci.slice(0, 2) as Square,
      to: selected.uci.slice(2, 4) as Square,
      promotion:
        selected.uci.length === 5
          ? (selected.uci[4] as "q" | "r" | "b" | "n")
          : undefined,
    });
    if (!applied) {
      setIsBotThinking(false);
      setStatusMessage("Live AI returned an unusable move.");
      return false;
    }
    const nextFen = chess.fen();
    setLastBotMove({
      uci: `${applied.from}${applied.to}${applied.promotion ?? ""}`,
      san: applied.san,
      fen: nextFen,
    });
    setGamePosition(nextFen);
    const liveProvenance: MoveProvenance = {
      actor: "sentio",
      engineName: "Sentio",
      algorithm: liveAiMode === "mcts" ? "mcts" : "minimax",
      profile: backendEngineProfile?.emotion ?? emotion,
      searchDepth: liveAiDepth,
      nodesVisited: trace.nodes?.length,
      playedAt: Date.now(),
    };
    appendHistoryMove(
      {
        from: applied.from,
        to: applied.to,
        color: applied.color,
        flags: applied.flags,
        promotion: applied.promotion,
      },
      nextFen,
      liveProvenance,
    );
    if (isCapture) playCaptureSound();
    else if (chess.inCheck()) playCheckSound();
    else playMoveSound();
    updateGameOutcome(chess);
    setBotRemark(
      `${liveAiMode === "mcts" ? "MCTS" : "Minimax"} selected ${applied.san} · depth ${liveAiDepth}`,
    );
    setStatusMessage(
      `${liveAiMode === "mcts" ? "MCTS" : "Minimax"} plays ${applied.san}`,
    );
    setIsBotThinking(false);
    return true;
  }

  // Live AI scheduler
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (
      activeTab !== "3d" ||
      liveAiMode === "off" ||
      gameOutcome !== "active" ||
      liveAiAnimating ||
      liveAiTurnInFlightRef.current
    )
      return;
    const timer = window.setTimeout(() => {
      liveAiTurnInFlightRef.current = true;
      const moved = runLiveAiMove();
      if (!moved) liveAiTurnInFlightRef.current = false;
    }, 480);
    return () => window.clearTimeout(timer);
  }, [
    activeTab,
    gamePosition,
    liveAiMode,
    liveAiDepth,
    liveAiAnimating,
    gameOutcome,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function triggerBotTurn(currentFen: string) {
    const requestGameId = gameIdRef.current;
    setIsBotThinking(true);
    setStatusMessage("Sentio engine is calculating...");

    const localBotMove = (
      chess: Chess,
    ): { from: Square; to: Square } | null => {
      const moves = chess.moves({ verbose: true });
      if (moves.length === 0) return null;
      try {
        const trace = buildMinimaxTrace(chess.fen(), {
          depth: 2,
          branchLimit: 5,
          aiColor: chess.turn(),
        });
        const selected = trace.selectedMove;
        if (selected) {
          const from = selected.uci.slice(0, 2);
          const to = selected.uci.slice(2, 4);
          if (moves.some((m) => m.from === from && m.to === to)) {
            return { from: from as Square, to: to as Square };
          }
        }
      } catch {
        // Fall through to a random move.
      }
      const m = moves[Math.floor(Math.random() * moves.length)];
      return { from: m.from, to: m.to };
    };

    let uciMove: string | null = null;
    let fallbackUsed = false;
    let fallbackReason = "";
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestStart = performance.now();
    let searchStartedAt = 0;
    let searchTimeMs: number | undefined;
    let engineId: string | undefined;
    let engineName: string | undefined;
    let engineVersion: string | undefined;
    let algorithm: MoveAlgorithm | undefined;
    let requestedDepth: number | undefined;
    let completedDepth: number | undefined;
    let nodesVisited: number | undefined;
    let cacheHit = false;
    let timeout = false;
    const controller = new AbortController();
    botRequestControllerRef.current = controller;
    // Client-side budget bounds how long we wait before producing a legal
    // move. Kept well below the server-side deadline so pooled Stockfish
    // saturation surfaces as a fast fallback instead of a long freeze.
    const botTimeBudgetMs = 8000;
    const timer = setTimeout(
      () => {
        timeout = true;
        controller.abort(new Error("Engine request timed out"));
      },
      botTimeBudgetMs,
    );
    try {
      searchStartedAt = performance.now();
      const response = await fetch(BOT_MOVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: currentFen,
          emotion,
          requestId,
        }),
        signal: controller.signal,
      });
      searchTimeMs = performance.now() - searchStartedAt;

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(data?.detail ?? "Backend response error");
      }

      const data = (await response.json()) as {
        botMove?: string | null;
        engineProfile?: EngineProfile;
        status?: string;
        diagnostics?: EngineDiagnostics;
      };

      if (data.engineProfile) {
        setBackendEngineProfile(data.engineProfile);
      }

      const diag = data.diagnostics;
      engineId = diag?.engineId;
      engineName = diag?.engineName;
      engineVersion = diag?.engineVersion;
      algorithm = diag?.algorithm;
      requestedDepth = diag?.requestedDepth;
      completedDepth = diag?.completedDepth;
      nodesVisited = diag?.nodesVisited;
      cacheHit = diag?.cacheHit ?? false;
      if (diag?.searchTimeMs != null) searchTimeMs = diag.searchTimeMs;

      uciMove = data.botMove ?? null;
      if (!uciMove) {
        fallbackUsed = true;
        fallbackReason = data.status ?? "No move available from engine.";
      }
    } catch (error) {
      if (controller.signal.aborted && gameIdRef.current !== requestGameId) {
        setIsBotThinking(false);
        return;
      }
      const wasAbort =
        error instanceof Error && (error.name === "AbortError" || timeout);
      fallbackUsed = true;
      fallbackReason = wasAbort
        ? "Engine took too long to respond."
        : error instanceof Error
          ? error.message
          : "Engine communication failure.";
      const m = localBotMove(chessRef.current);
      if (m) uciMove = m.from + m.to;
      if (!wasAbort) {
        console.error("Communication failure with Stockfish engine:", error);
      }
    } finally {
      clearTimeout(timer);
      if (botRequestControllerRef.current === controller) {
        botRequestControllerRef.current = null;
      }
    }

    if (gameIdRef.current !== requestGameId) {
      setIsBotThinking(false);
      return;
    }

    const totalLatencyMs = performance.now() - requestStart;

    if (uciMove) {
      const chess = chessRef.current;
      const lower = uciMove.toLowerCase();

      let isCapture = false;
      let appliedBotSan = "";
      let appliedBotUci = lower.substring(0, 4);
      let appliedMoveMeta:
        | { from: string; to: string; color: "w" | "b"; flags: string; promotion?: string }
        | undefined;
      try {
        const from = lower.substring(0, 2);
        const to = lower.substring(2, 4);
        const target = chess.get(to as Square);
        isCapture = !!target && target.color === "w";
        const appliedMove = chess.move({
          from: from as Square,
          to: to as Square,
          promotion:
            lower.length === 5
              ? (lower[4] as "q" | "r" | "b" | "n")
              : undefined,
        });
        if (appliedMove) {
          appliedBotSan = appliedMove.san;
          appliedBotUci = `${appliedMove.from}${appliedMove.to}${appliedMove.promotion ?? ""}`;
          appliedMoveMeta = {
            from: appliedMove.from,
            to: appliedMove.to,
            color: appliedMove.color,
            flags: appliedMove.flags,
            promotion: appliedMove.promotion,
          };
        }
      } catch {
        fallbackUsed = true;
        fallbackReason = "Engine returned an illegal move.";
        const m = localBotMove(chess);
        if (m) {
          const fallbackMove = chess.move({ from: m.from, to: m.to });
          if (fallbackMove) {
            appliedBotSan = fallbackMove.san;
            appliedBotUci = `${fallbackMove.from}${fallbackMove.to}${fallbackMove.promotion ?? ""}`;
            appliedMoveMeta = {
              from: fallbackMove.from,
              to: fallbackMove.to,
              color: fallbackMove.color,
              flags: fallbackMove.flags,
              promotion: fallbackMove.promotion,
            };
          }
        }
      }

      const nextFen = chess.fen();
      setLastBotMove(
        appliedBotSan
          ? { uci: appliedBotUci, san: appliedBotSan, fen: nextFen }
          : null,
      );
      botMoveAtRef.current = Date.now();

      const provenance: MoveProvenance = {
        actor: "sentio",
        engineId,
        engineName: engineName ?? (fallbackUsed ? undefined : "Sentio"),
        engineVersion,
        algorithm: algorithm ?? (fallbackUsed ? "minimax" : undefined),
        profile: backendEngineProfile?.emotion ?? emotion,
        searchDepth: requestedDepth,
        completedDepth,
        searchTimeMs,
        totalLatencyMs,
        nodesVisited,
        fallbackUsed,
        requestId,
        playedAt: Date.now(),
      };
      if (appliedMoveMeta) {
        setGamePosition(nextFen);
        appendHistoryMove(appliedMoveMeta, nextFen, provenance);
      }
      if (isCapture) {
        playCaptureSound();
      } else if (chess.inCheck()) {
        playCheckSound();
      } else {
        playMoveSound();
      }

      if (!updateGameOutcome(chess)) {
        setStatusMessage(
          fallbackUsed
            ? `${fallbackReason} Used a local fallback move.`
            : cacheHit
              ? "Engine move (cached)."
              : "Engine move completed.",
        );
        const isCheck = chess.inCheck();
        setBotRemark(generateRemark(emotion, isCheck, isCapture));
      } else {
        setBotRemark(
          chess.isCheckmate()
            ? "Checkmate. Better luck next time."
            : "Game over. I won.",
        );
      }
    } else {
      setStatusMessage(fallbackUsed ? fallbackReason : "No move available.");
    }

    setIsBotThinking(false);
  }

  function commitPlayerMove(
    from: string,
    to: string,
    promotion: "q" | "r" | "b" | "n",
    now: number,
  ) {
    const chess = chessRef.current;
    try {
      if (chess.turn() !== "w") return false;

      const playerEvalBefore = evaluateMaterial(chess, "w");
      const move = chess.move({
        from: from as Square,
        to: to as Square,
        promotion,
      });

      if (!move) return false;

      const evalAfter = evaluateMaterial(chess, "w");
      lastPlayerEvalRef.current = evalAfter;
      const evalLoss = Math.max(0, playerEvalBefore - evalAfter);
      lastEvalLossRef.current = { loss: evalLoss, at: Date.now() };
      if (evalLoss >= FUSION_WEIGHTS.setbackCp) {
        playerSetbacksRef.current.push(Date.now());
      }

      if (move.captured) {
        playCaptureSound();
      } else if (chess.inCheck()) {
        playCheckSound();
      } else {
        playMoveSound();
      }

      const nextFen = chess.fen();
      lastMoveTimestampRef.current = now;
      setSelectedSquare(null);
      setLegalMoveTargets([]);
      setHintMove(null);
      setGamePosition(nextFen);
      setStatusMessage(`You played ${from}-${to}.`);
      appendHistoryMove(move, nextFen, playerMoveProvenance(now));

      if (updateGameOutcome(chess)) {
        return true;
      }

      void triggerBotTurn(nextFen);
      return true;
    } catch {
      return false;
    }
  }

  function applyMove(from: string, to: string, now: number) {
    const chess = chessRef.current;
    if (chess.turn() !== "w") return false;

    const piece = chess.get(from as Square);
    if (piece?.type === "p" && to[1] === "8") {
      setPendingPromotion({ from, to });
      return true;
    }

    return commitPlayerMove(from, to, "q", now);
  }

  function choosePromotion(piece: "q" | "r" | "b" | "n") {
    const pending = pendingPromotion;
    setPendingPromotion(null);
    if (!pending) return;

    commitPlayerMove(pending.from, pending.to, piece, Date.now());
  }

  function undoMovePair() {
    const chess = chessRef.current;
    const historyLength = chess.history().length;
    if (historyLength === 0) return;

    gameIdRef.current += 1;
    botRequestControllerRef.current?.abort(new Error("Superseded by undo"));
    botRequestControllerRef.current = null;
    setIsBotThinking(false);
    setPendingPromotion(null);
    setHintMove(null);

    const undos = chess.turn() === "w" ? Math.min(2, historyLength) : 1;
    for (let i = 0; i < undos; i++) {
      if (!chess.undo()) break;
    }

    setSelectedSquare(null);
    setLegalMoveTargets([]);
    setGamePosition(chess.fen());
    updateGameOutcome(chess);
    clearExternalTelemetry();
    setStatusMessage("Took back your last move.");
  }

  async function requestHint() {
    const chess = chessRef.current;
    if (
      gameOutcome !== "active" ||
      chess.turn() !== "w" ||
      isBotThinking ||
      isHintLoading
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastHintAtRef.current < 5000) return;
    lastHintAtRef.current = now;

    setIsHintLoading(true);
    try {
      const response = await fetch(BOT_MOVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: chess.fen(),
          emotion: "neutral",
          purpose: "hint",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Hint service unavailable.");
      const data = (await response.json()) as { botMove?: string | null };
      if (!data.botMove)
        throw new Error("No hint available for this position.");
      const uci = data.botMove.toLowerCase();
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const isLegal = chess
        .moves({ verbose: true })
        .some((m) => m.from === from && m.to === to);
      if (!isLegal) throw new Error("Hint returned an unusable move.");
      setHintMove({ from, to });
      setStatusMessage(`Hint: consider ${from}-${to}.`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not fetch a hint.",
      );
    } finally {
      setIsHintLoading(false);
    }
  }

  // Ctrl/Cmd+Z takes back the last move pair (ignored while typing).
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        undoMovePair();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  function handleSquareClick(square: string, now: number) {
    const chess = chessRef.current;
    if (gameOutcome !== "active") return;
    const pieceOnSquare = chess.get(square as Square);
    const activeColor = chess.turn();

    if (!selectedSquare) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square: square as Square, verbose: true });
        setLegalMoveTargets(
          moves.map((m) => ({
            square: m.to,
            isCapture: Boolean(chess.get(m.to as Square)),
          })),
        );
      }
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      setLegalMoveTargets([]);
      return;
    }

    const moved = applyMove(selectedSquare, square, now);
    if (!moved) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square: square as Square, verbose: true });
        setLegalMoveTargets(
          moves.map((m) => ({
            square: m.to,
            isCapture: Boolean(chess.get(m.to as Square)),
          })),
        );
      } else {
        setSelectedSquare(null);
        setLegalMoveTargets([]);
      }
    }
  }

  function executeCoachMove(uci: string, now: number) {
    if (gameOutcome !== "active") return;
    const chess = chessRef.current;
    if (chess.turn() !== "w") return;
    try {
      const move = chess.move({
        from: uci.substring(0, 2) as Square,
        to: uci.substring(2, 4) as Square,
        promotion:
          uci.length === 5 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
      });
      if (!move) return;
      if (move.captured) {
        playCaptureSound();
      } else if (chess.inCheck()) {
        playCheckSound();
      } else {
        playMoveSound();
      }
      const nextFen = chess.fen();
      lastMoveTimestampRef.current = now;
      setSelectedSquare(null);
      setLegalMoveTargets([]);
      setHintMove(null);
      setGamePosition(nextFen);
      setStatusMessage(`Coach played ${move.from}-${move.to}.`);
      appendHistoryMove(
        {
          from: move.from,
          to: move.to,
          color: move.color,
          flags: move.flags,
          promotion: move.promotion,
        },
        nextFen,
        {
          actor: "sentio",
          engineName: "Sentio",
          algorithm: "stockfish",
          profile: backendEngineProfile?.emotion ?? emotion,
          playedAt: now,
        },
      );
      if (updateGameOutcome(chess)) return;
      void triggerBotTurn(nextFen);
    } catch {
      // invalid move
    }
  }

  function playCoachMoveWithHand(uci: string) {
    const chess = chessRef.current;
    if (chess.turn() !== "w" || chess.isGameOver()) return;
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    try {
      const test = new Chess(chess.fen());
      const legal = test.move({
        from: from as Square,
        to: to as Square,
        promotion:
          uci.length === 5 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
      });
      if (!legal) return;
    } catch {
      return;
    }

    const wrap = boardWrapRef.current;
    const handEl = aiHandRef.current;
    if (!wrap || !handEl) {
      executeCoachMove(uci, Date.now());
      return;
    }

    const squareCenter = (sq: string): { x: number; y: number } | null => {
      const board = wrap.querySelector("#sentio-engine-board-board");
      if (!board) return null;
      for (const squareEl of Array.from(
        board.querySelectorAll("[data-square]"),
      )) {
        if (squareEl.getAttribute("data-square") === sq) {
          const wrapRect = wrap.getBoundingClientRect();
          const rect = squareEl.getBoundingClientRect();
          return {
            x: rect.x - wrapRect.x + rect.width / 2,
            y: rect.y - wrapRect.y + rect.height / 2,
          };
        }
      }
      return null;
    };

    const startPoint = squareCenter(from);
    const endPoint = squareCenter(to);
    if (!startPoint || !endPoint) {
      executeCoachMove(uci, Date.now());
      return;
    }

    if (aiHandRafRef.current) cancelAnimationFrame(aiHandRafRef.current);

    const startTime = performance.now();
    const duration = 1500;
    handEl.style.opacity = "1";
    handEl.style.transform = `translate(${startPoint.x}px, ${startPoint.y}px) translate(-50%, -50%)`;

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = startPoint.x + (endPoint.x - startPoint.x) * eased;
      const y = startPoint.y + (endPoint.y - startPoint.y) * eased;
      handEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (t < 1) {
        aiHandRafRef.current = requestAnimationFrame(step);
      } else {
        handEl.style.opacity = "0";
        executeCoachMove(uci, Date.now());
      }
    };
    aiHandRafRef.current = requestAnimationFrame(step);
  }

  function resetGame() {
    const completedMoves = serializeReplayMoves(chessRef.current);
    if (completedMoves.length > 0) {
      const id = `game-${replayCounterRef.current++}`;
      setSavedReplayGames((previous) =>
        [
          {
            id,
            label: `Game ${replayCounterRef.current - 1} · ${completedMoves.length} plies`,
            moves: completedMoves,
          },
          ...previous,
        ].slice(0, 8),
      );
    }
    gameIdRef.current += 1;
    botRequestControllerRef.current?.abort(new Error("Superseded by reset"));
    botRequestControllerRef.current = null;
    liveAiTurnInFlightRef.current = false;
    setLiveAiAnimating(false);
    setPendingPromotion(null);
    setHintMove(null);
    const newChess = new Chess();
    chessRef.current = newChess;
    setGamePosition(newChess.fen());
    setGameOutcome("active");
    setLastBotMove(null);
    setSelectedSquare(null);
    setLegalMoveTargets([]);
    clearExternalTelemetry();
    setStatusMessage("New game started.");
  }

  const openingName = useMemo(
    () => lookupOpening(chessRef.current.history())?.name ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when the position changes
    [gamePosition],
  );

  const canUndo = chessRef.current.history().length > 0;

  function startTrainingGame(fen: string): void {
    if (!fen) return;
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return;
    }
    gameIdRef.current += 1;
    botRequestControllerRef.current?.abort(
      new Error("Training game started"),
    );
    botRequestControllerRef.current = null;
    chessRef.current = chess;
    clearExternalTelemetry();
    botMoveAtRef.current = 0;
    setPendingPromotion(null);
    setHintMove(null);
    setSelectedSquare(null);
    setLegalMoveTargets([]);
    setLastBotMove(null);
    setBackendEngineProfile(null);
    setWorkspaceTab("board");
    setGamePosition(chess.fen());
    updateGameOutcome(chess);
    setStatusMessage("Training position loaded. You're up!");
  }

  // Debounced evaluation fetch for the eval bar.
  useEffect(() => {
    if (
      workspaceTab !== "board" ||
      activeTab === "3d" ||
      activeTab === "replay" ||
      gameOutcome !== "active"
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/bot-move?fen=${encodeURIComponent(gamePosition)}&depth=2`,
            { cache: "no-store", signal: AbortSignal.timeout(8000) },
          );
          if (!response.ok) return;
          const data = (await response.json()) as { evaluation?: number };
          if (typeof data.evaluation === "number") {
            setEvaluation(data.evaluation);
          }
        } catch {
          // Keep the last evaluation on transient failures.
        }
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [gamePosition, gameOutcome, workspaceTab, activeTab]);

  // Replay games for reset serialization
  const [savedReplayGames, setSavedReplayGames] = useState<ReplayGame[]>([]);
  const replayCounterRef = useRef(1);

  // Auto-encouragement from coach when in auto emotion mode
  const postCoachEncouragement = useMemo(
    () => (em: EmotionLabel) => {
      const now = Date.now();
      if (now - lastCoachAutoMessageRef.current < 25000) return;
      lastCoachAutoMessageRef.current = now;
      const pool =
        COACH_AUTO_ENCOURAGEMENT[em] ?? COACH_AUTO_ENCOURAGEMENT.neutral;
      const text = pool[Math.floor(Math.random() * pool.length)];
      setChatMessages((prev) => [
        ...prev,
        {
          id: `coach-auto-${now}`,
          role: "assistant",
          content: text,
        },
      ]);
    },
    [setChatMessages],
  );

  // Auto-encouragement effect
  useEffect(() => {
    if (emotionMode === "auto") {
      postCoachEncouragement(emotion);
    }
  }, [emotion, emotionMode, postCoachEncouragement]);

  return {
    gamePosition,
    selectedSquare,
    legalMoveTargets,
    pendingPromotion,
    gameOutcome,
    statusMessage,
    hintMove,
    isHintLoading,
    evaluation,
    isBotThinking,
    lastBotMove,
    liveAiMode,
    liveAiDepth,
    liveAiAnimating,
    botRemark,
    engineProfile,
    openingName,
    canUndo,
    chessRef,
    lastMoveTimestampRef,
    boardWrapRef,
    aiHandRef,
    liveAiTurnInFlightRef,
    setSelectedSquare,
    setLegalMoveTargets,
    setHintMove,
    setPendingPromotion,
    setGamePosition,
    setGameOutcome,
    setStatusMessage,
    setLiveAiMode,
    setLiveAiDepth,
    setLiveAiAnimating,
    setSavedReplayGames,
    updateGameOutcome,
    runLiveAiMove,
    triggerBotTurn,
    commitPlayerMove,
    applyMove,
    choosePromotion,
    undoMovePair,
    requestHint,
    handleSquareClick,
    executeCoachMove,
    playCoachMoveWithHand,
    resetGame,
    startTrainingGame,
    savedReplayGames,
    replayGames: savedReplayGames,
  } as const;
}
