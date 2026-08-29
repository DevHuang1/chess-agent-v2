"use client";

/**
 * Sentio is an emotion-adaptive chess AI. Instead of asking you to pick a
 * difficulty level, it watches your face through the webcam and adjusts
 * Stockfish's strength in real time based on how you're feeling.
 *
 * The system runs four subsystems in parallel. The first is emotion detection:
 * every 2.2 seconds, face-api.js (TinyFaceDetector + FaceExpressionNet)
 * classifies your facial expression into one of seven categories, maps it to
 * a game emotion (stressed, frustrated, calm, neutral, focused, confident),
 * and smooths the result across the last three frames to avoid jitter.
 *
 * The second subsystem is the adaptive engine. When you make a move, the
 * frontend sends your FEN and detected emotion to a Python FastAPI backend.
 * The backend maps your emotion to a Stockfish profile — stressed gets you
 * an engine that searches only one ply deep at ELO 1320; confident gets you
 * a depth-10 search at ELO 3190. It acquires a Stockfish instance from a
 * small persistent pool, reconfigures it with the profile, and returns the
 * best move.
 * This keeps you in flow: easier when you're struggling, harder when you're
 * cruising.
 *
 * The third subsystem is the LLM coach. A Next.js API route accepts your
 * questions about the position alongside your emotion history. It always has
 * a fallback mode that uses chess.js to analyze the board and fetches
 * Stockfish's best move to offer concrete advice. When enabled and reachable,
 * it augments this with a local LLM (LM Studio) that acts as an empathetic
 * chess tutor — or as a general assistant if your query isn't chess-related.
 *
 * The fourth subsystem is the bot's personality. Canned taunts and
 * encouragement are served from pools keyed to your emotion, with separate
 * pools for checks and captures. When you're frustrated or stressed, the
 * coach also chimes in with unsolicited encouragement (capped at one message
 * per 25 seconds).
 *
 * Together, these subsystems create a chess opponent that watches you as
 * closely as you watch the board.
 */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Simulation3D, {
  ReplayGame,
} from "@/components/Simulation3D";
import PromotionPicker from "@/components/PromotionPicker";
import EvalBar from "@/components/EvalBar";
import GameOverOverlay from "@/components/GameOverOverlay";
import AILabWorkspace from "@/components/AILabWorkspace";
import { PIECE_DESIGNS, PieceDesignKey } from "@/components/pieces";
import type { ChessboardOptions } from "react-chessboard";
import { setSoundMuted } from "@/lib/audio";
import { type SidebarTab } from "@/hooks/useSidebarPreferences";
import { useEmotionDetection } from "@/hooks/useEmotionDetection";
import { useCoachAudio } from "@/hooks/useCoachAudio";
import { useChessGame } from "@/hooks/useChessGame";
import EmotionMonitor from "@/components/EmotionMonitor";
import { EMOTION_EMOJI } from "@/lib/emotionClassifier";
import {
  emptyProgress,
  levelFromXp,
  loadProgress,
  saveProgress,
  tierForLevel,
  type PuzzleProgress,
} from "@/lib/puzzleProgress";
import TrainingWorkspace from "@/components/train/TrainingWorkspace";
import { type EmotionLabel } from "@/lib/engineProfiles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { ChatMessage } from "@/lib/gameTypes";
import type { GameSignals } from "@/lib/emotionFusion";
import type { Chess, Square } from "chess.js";
import ControllerPanel from "@/components/ControllerPanel";
import TopBar from "@/components/TopBar";
import BoardWorkspace from "@/components/BoardWorkspace";

const COACH_API_URL = "/api/coach";
const REPLAY_GAMES_KEY = "sentio-replay-games-v1";
const SETBACK_WINDOW_MS = 90_000;
const EVAL_LOSS_FRESH_MS = 30_000;

function questionWantsMove(question: string): boolean {
  const s = question.toLowerCase().trim();
  if (!s) return false;
  if (/[a-h][1-8]/.test(s)) return true;
  return (
    /\b(move|play|recommend|suggest|best)\b/.test(s) ||
    /what should i/.test(s) ||
    /next move|make a move|your move|for me/.test(s)
  );
}

function serializeReplayMoves(chess: Chess): import("@/components/Simulation3D").ReplayMove[] {
  return chess.history({ verbose: true }).map((move) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    color: move.color,
    flags: move.flags,
    promotion: move.promotion,
  }));
}

export default function ChessPage() {
  const [emotionMode, setEmotionMode] = useState<"auto" | "manual">("auto");
  const [workspaceTab, setWorkspaceTab] = useState<"board" | "aiLab" | "train">("board");
  const [activeTab, setActiveTab] = useState<SidebarTab>("coach");

  // --- UI state ---
  const [pieceDesign, setPieceDesign] = useState<PieceDesignKey>("chesscom");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [soundMutedState, setSoundMutedState] = useState<boolean>(false);

  const [chatInput, setChatInput] = useState("");
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [coachMode, setCoachMode] = useState<"groq" | "llm">("groq");
  const [coachLlmConnection, setCoachLlmConnection] =
    useState<"checking" | "connected" | "disconnected" | "disabled">("checking");
  const [coachLlmDetail, setCoachLlmDetail] = useState("Checking LLM health...");
  const [groqAvailable, setGroqAvailable] = useState(false);
  const [groqDetail, setGroqDetail] = useState("Checking Groq...");

  // Training profile (XP/level)
  const [trainProgress, setTrainProgress] = useState<PuzzleProgress>(emptyProgress);
  const [progressLoaded, setProgressLoaded] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setTrainProgress(loadProgress());
      setProgressLoaded(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!progressLoaded) return;
    saveProgress(trainProgress);
  }, [progressLoaded, trainProgress]);

  // Replay state
  const [replayGameId, setReplayGameId] = useState("current");
  const [replayMoveIndex, setReplayMoveIndex] = useState(-1);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayAnimate, setReplayAnimate] = useState(true);
  const [currentReplayGame, setCurrentReplayGame] = useState<ReplayGame>({
    id: "current",
    label: "Current game",
    moves: [],
  });

  const {
    muted: coachAudioMuted,
    autoRead: coachAutoRead,
    status: coachAudioStatus,
    speak: speakCoachReply,
    stop: stopCoachReply,
    setMuted: setCoachAudioMuted,
    setAutoRead: setCoachAutoRead,
  } = useCoachAudio();

  // --- Gameplay telemetry (refs shared between page and hook) ---
  const botMoveAtRef = useRef(0);
  const playerSetbacksRef = useRef<number[]>([]);
  const lastEvalLossRef = useRef<{ loss: number; at: number } | null>(null);
  const lastPlayerEvalRef = useRef<number | null>(null);

  function getGameSignals(): Partial<GameSignals> {
    const now = Date.now();
    playerSetbacksRef.current = playerSetbacksRef.current.filter(
      (t) => now - t < SETBACK_WINDOW_MS,
    );
    const freshLoss =
      lastEvalLossRef.current &&
      now - lastEvalLossRef.current.at < EVAL_LOSS_FRESH_MS
        ? lastEvalLossRef.current.loss
        : null;
    return {
      thinkTimeMs:
        botMoveAtRef.current > 0 ? now - botMoveAtRef.current : null,
      lastMoveEvalLossCp: freshLoss,
      recentSetbacks: playerSetbacksRef.current.length,
      playerEvalCp: lastPlayerEvalRef.current,
    };
  }

  function clearGameplayTelemetry(): void {
    botMoveAtRef.current = 0;
    playerSetbacksRef.current = [];
    lastEvalLossRef.current = null;
    lastPlayerEvalRef.current = null;
  }

  // --- Emotion detection ---
  const {
    videoRef,
    emotion,
    setEmotion,
    emotionHistoryRef,
    emotionScores,
    emotionTimeline,
  } = useEmotionDetection({
    activeTab,
    auto: emotionMode === "auto",
    onStatus: () => {},
    getGameSignals,
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I am Sentio. I can coach your position, explain plans, and adapt engine strength based on your emotional state.",
    },
  ]);

  // --- Game hook ---
  const game = useChessGame(
    emotion,
    emotionMode,
    workspaceTab,
    activeTab,
    setWorkspaceTab,
    setChatMessages,
    getGameSignals,
    clearGameplayTelemetry,
  );

  const {
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
    triggerBotTurn,
    handleSquareClick,
    executeCoachMove,
    playCoachMoveWithHand,
    resetGame,
    startTrainingGame,
    savedReplayGames,
    requestHint,
    undoMovePair,
    choosePromotion,
    applyMove,
  } = game;

  // Restore persisted replay games once on mount
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(REPLAY_GAMES_KEY);
        if (saved) setSavedReplayGames(JSON.parse(saved) as ReplayGame[]);
      } catch {
        // Ignore corrupted replay storage.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Persist replay games whenever they change.
  useEffect(() => {
    try {
      window.localStorage.setItem(REPLAY_GAMES_KEY, JSON.stringify(savedReplayGames));
    } catch {
      // Storage unavailable; replays stay in-memory for this session.
    }
  }, [savedReplayGames]);

  // Auto-read latest coach reply aloud
  const lastSpokenRef = useRef<string>("");
  useEffect(() => {
    if (!coachAutoRead || coachAudioMuted) return;
    const latest = chatMessages[chatMessages.length - 1];
    if (
      latest &&
      latest.role === "assistant" &&
      latest.id !== "welcome" &&
      !latest.id.startsWith("assistant-error-") &&
      latest.id !== lastSpokenRef.current
    ) {
      lastSpokenRef.current = latest.id;
      void speakCoachReply(latest.id, latest.content);
    }
  }, [chatMessages, coachAutoRead, coachAudioMuted, speakCoachReply]);

  // Coach health check
  useEffect(() => {
    let active = true;

    async function refreshCoachHealth() {
      try {
        const response = await fetch(COACH_API_URL, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Health endpoint failed (${response.status}).`);
        }

        const data = (await response.json()) as {
          enabled: boolean;
          connected: boolean;
          detail: string;
          model: string;
          groq?: {
            available: boolean;
            detail: string;
            model: string;
          };
        };

        if (!active) return;

        setGroqAvailable(data.groq?.available ?? false);
        setGroqDetail(
          data.groq?.available
            ? `Groq: ${data.groq.model}`
            : (data.groq?.detail ?? "Groq unavailable."),
        );

        if (!data.enabled) {
          setCoachLlmConnection("disabled");
          setCoachLlmDetail(data.detail);
          return;
        }

        setCoachLlmConnection(data.connected ? "connected" : "disconnected");
        setCoachLlmDetail(`${data.detail} Model: ${data.model}`);
      } catch (error) {
        if (!active) return;
        setCoachLlmConnection("disconnected");
        setCoachLlmDetail(
          error instanceof Error
            ? error.message
            : "Could not check LLM connection.",
        );
      }
    }

    void refreshCoachHealth();
    const intervalId = window.setInterval(() => {
      void refreshCoachHealth();
    }, 10000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // --- Replay UI helpers ---
  function setReplayBoard(
    game: ReplayGame,
    targetIndex: number,
    animateMove: boolean,
  ) {
    const { Chess } = require("chess.js") as typeof import("chess.js");
    const board = new Chess();
    const boundedIndex = Math.max(
      -1,
      Math.min(targetIndex, game.moves.length - 1),
    );
    const movesToApply = game.moves.slice(0, boundedIndex + 1);
    for (const move of movesToApply) {
      board.move({
        from: move.from as Square,
        to: move.to as Square,
        promotion: move.promotion as "q" | "r" | "b" | "n" | undefined,
      });
    }
    if (!animateMove) {
      chessRef.current = board;
      setGamePosition(board.fen());
      setReplayMoveIndex(boundedIndex);
      setReplayBusy(false);
      setReplayAnimate(false);
      return;
    }
    const move = game.moves[boundedIndex];
    if (!move) return;
    const before = new Chess();
    for (const previous of game.moves.slice(0, boundedIndex)) {
      before.move({
        from: previous.from as Square,
        to: previous.to as Square,
        promotion: previous.promotion as "q" | "r" | "b" | "n" | undefined,
      });
    }
    const animatedBoard = new Chess(before.fen());
    const applied = animatedBoard.move({
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion as "q" | "r" | "b" | "n" | undefined,
    });
    if (!applied) return;
    chessRef.current = animatedBoard;
    setReplayMoveIndex(boundedIndex);
    setReplayBusy(true);
    setReplayAnimate(true);
    setGamePosition(animatedBoard.fen());
    setStatusMessage(`Replay: ${applied.san}`);
  }

  function selectReplayGame(gameId: string) {
    const allReplayGames = [currentReplayGame, ...savedReplayGames];
    const game = allReplayGames.find((candidate) => candidate.id === gameId);
    if (!game) return;
    setReplayGameId(gameId);
    setReplayPlaying(false);
    setReplayBusy(false);
    setReplayAnimate(false);
    setReplayBoard(game, -1, false);
  }

  function stepReplay(direction: -1 | 1) {
    const allReplayGames = [currentReplayGame, ...savedReplayGames];
    const activeReplayGame = allReplayGames.find((g) => g.id === replayGameId) ?? allReplayGames[0];
    if (!activeReplayGame || replayBusy) return;
    const nextIndex = replayMoveIndex + direction;
    if (direction === 1 && nextIndex >= activeReplayGame.moves.length) {
      setReplayPlaying(false);
      return;
    }
    if (direction === 1) setReplayBoard(activeReplayGame, nextIndex, true);
    else setReplayBoard(activeReplayGame, nextIndex, false);
  }

  // Replay board stepping effect
  useEffect(() => {
    const replayActive = activeTab === "replay";
    if (
      !replayActive ||
      !replayPlaying ||
      replayBusy ||
      !currentReplayGame ||
      currentReplayGame.id === "current" ||
      replayMoveIndex >= currentReplayGame.moves.length - 1
    ) {
      return;
    }
    const timer = window.setTimeout(() => stepReplay(1), 980);
    return () => window.clearTimeout(timer);
  }, [activeTab, replayPlaying, replayBusy, currentReplayGame, replayMoveIndex]);

  // Sync currentReplayGame when viewing "current"
  useEffect(() => {
    if (replayGameId === "current") {
      setCurrentReplayGame({
        id: "current",
        label: "Current game",
        moves: serializeReplayMoves(chessRef.current),
      });
    }
  }, [gamePosition, replayGameId, activeTab]);

  function handleBoardTouchEndCapture(event: React.TouchEvent<HTMLDivElement>) {
    if (!event.cancelable) {
      event.stopPropagation();
    }
  }

  async function handleAskCoach(
    now: number,
    options?: { question?: string; source?: "typed" | "voice-coach" },
  ) {
    const source = options?.source ?? "typed";
    const question = (options?.question ?? chatInput).trim();
    if (!question || isCoachThinking) return;

    const userMessage: ChatMessage = {
      id: `user-${now}`,
      role: "user",
      content: question,
    };

    setChatMessages((previous) => [...previous, userMessage]);
    setChatInput("");

    try {
      setIsCoachThinking(true);
      const response = await fetch(COACH_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: chessRef.current.fen(),
          emotion,
          recentEmotions: emotionHistoryRef.current,
          question,
          mode: coachMode,
          ...(source === "voice-coach"
            ? {
                responseLanguage: "my",
                inputLanguage: "my",
                source: "voice-coach",
              }
            : {}),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(data?.detail ?? "Coach service unavailable.");
      }

      const data = (await response.json()) as {
        message: string;
        suggestions?: string[];
        bestMove?: { uci: string; san: string } | null;
      };

      const coachMessage: ChatMessage = {
        id: `assistant-${now}`,
        role: "assistant",
        bestMove: data.bestMove ?? undefined,
        content: `${data.message}${
          data.suggestions?.length ? `\n${data.suggestions.join("\n")}` : ""
        }`,
      };
      if (
        data.bestMove &&
        questionWantsMove(question) &&
        chessRef.current.turn() === "w" &&
        gameOutcome === "active"
      ) {
        coachMessage.playedByCoach = true;
      }
      setChatMessages((previous) => [...previous, coachMessage]);
      if (coachMessage.playedByCoach && data.bestMove) {
        playCoachMoveWithHand(data.bestMove.uci);
      }
    } catch (error) {
      const coachError: ChatMessage = {
        id: `assistant-error-${now}`,
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Coach service is currently unavailable.",
      };
      setChatMessages((previous) => [...previous, coachError]);
    } finally {
      setIsCoachThinking(false);
    }
  }

  const hintSquareStyles: Record<string, Record<string, string>> = hintMove
    ? {
        [hintMove.from]: {
          boxShadow: "inset 0 0 0 4px rgba(251, 191, 36, 0.85)",
        },
        [hintMove.to]: {
          boxShadow: "inset 0 0 0 4px rgba(251, 191, 36, 0.85)",
          background:
            "radial-gradient(circle, rgba(251,191,36,0.5) 30%, transparent 30%)",
        },
      }
    : {};

  const customSquareStyles = {
    ...hintSquareStyles,
    ...(selectedSquare
      ? {
          [selectedSquare]: { backgroundColor: "rgba(245, 158, 11, 0.45)" },
          ...Object.fromEntries(
            legalMoveTargets.map(({ square: sq, isCapture }) => {
              if (isCapture) {
                return [
                  sq,
                  {
                    boxShadow: "inset 0 0 0 4px rgba(239,68,68,0.5)",
                    borderRadius: "0",
                  },
                ];
              }
              return [
                sq,
                {
                  background:
                    "radial-gradient(circle, rgba(34,197,94,0.5) 25%, transparent 25%)",
                },
              ];
            }),
          ),
        }
      : {}),
  };

  const chessboardOptions: ChessboardOptions = {
    id: "sentio-engine-board",
    position: gamePosition,
    onSquareClick: ({ square }) => {
      handleSquareClick(square, Date.now());
    },
    onPieceClick: ({ square }) => {
      if (square) handleSquareClick(square, Date.now());
    },
    onPieceDrop: ({ sourceSquare, targetSquare }) => {
      if (!targetSquare) return false;
      const chess = chessRef.current;
      if (chess.turn() !== "w") return false;

      const now = Date.now();
      return applyMove(sourceSquare, targetSquare, now);
    },
    squareStyles: customSquareStyles,
    pieces: PIECE_DESIGNS[pieceDesign].pieces,
    allowDragging: true,
    animationDurationInMs: 200,
    showNotation: true,
    darkSquareStyle: { backgroundColor: "var(--sentio-board-dark)" },
    lightSquareStyle: { backgroundColor: "var(--sentio-board-light)" },
    darkSquareNotationStyle: {
      color: "#ebecd0",
      fontSize: "11px",
      opacity: 0.65,
    },
    lightSquareNotationStyle: {
      color: "#4a6741",
      fontSize: "11px",
      opacity: 0.65,
    },
    boardStyle: {
      touchAction: "none",
      borderRadius: "6px",
      overflow: "hidden",
      cursor: "grab",
    },
    draggingPieceStyle: {
      cursor: "grabbing",
    },
    dropSquareStyle: {
      boxShadow: "inset 0 0 0 4px rgba(251,191,36,0.6)",
    },
  };

  const gameResultText =
    gameOutcome === "checkmate"
      ? gamePosition.split(" ")[1] === "b"
        ? "You Win!"
        : "You Lose"
      : gameOutcome === "stalemate"
        ? "Stalemate - Draw"
        : gameOutcome === "draw"
          ? "Draw"
          : null;

  function exportPgn() {
    const pgn = chessRef.current.pgn();
    if (!pgn) {
      setStatusMessage("No moves to export yet.");
      return;
    }
    const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sentio-game-${Date.now()}.pgn`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("PGN downloaded.");
  }

  return (
    <main
      className={`flex h-screen w-screen flex-col overflow-hidden sentio-bg transition-colors duration-300 lg:flex-row ${theme === "light" ? "light text-zinc-900" : "text-zinc-100"}`}
    >
      <section className="flex flex-1 flex-col min-w-0">
        <TopBar
          workspaceTab={workspaceTab}
          setWorkspaceTab={setWorkspaceTab}
          emotionMode={emotionMode}
          setEmotionMode={setEmotionMode}
          emotion={emotion}
          setEmotion={setEmotion}
          engineProfile={engineProfile}
          pieceDesign={pieceDesign}
          setPieceDesign={setPieceDesign}
          soundMuted={soundMutedState}
          setSoundMuted={(muted: boolean) => {
            setSoundMutedState(muted);
            setSoundMuted(muted);
          }}
          theme={theme}
          setTheme={setTheme}
          isBotThinking={isBotThinking}
          trainProgress={trainProgress}
          progressLoaded={progressLoaded}
        />

        {workspaceTab === "train" ? (
          <section
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            aria-label="Training Arena"
          >
            <TrainingWorkspace
              progress={trainProgress}
              emotion={emotion}
              onProgressUpdate={setTrainProgress}
              onPlayFromPosition={startTrainingGame}
            />
          </section>
        ) : workspaceTab === "aiLab" ? (
          <AILabWorkspace
            gamePosition={gamePosition}
            isBotThinking={isBotThinking}
            lastBotMove={lastBotMove}
            emotion={emotion}
            activeTab={activeTab}
          />
        ) : (
          <BoardWorkspace
            evaluation={evaluation}
            chessboardOptions={chessboardOptions}
            boardWrapRef={boardWrapRef}
            aiHandRef={aiHandRef}
            pendingPromotion={pendingPromotion}
            choosePromotion={choosePromotion}
            videoRef={videoRef}
            emotion={emotion}
            emotionScores={emotionScores}
            emotionTimeline={emotionTimeline}
            emotionMode={emotionMode}
            botRemark={botRemark}
            handleBoardTouchEndCapture={handleBoardTouchEndCapture}
          />
        )}
      </section>

      {workspaceTab === "board" ? (
        <ControllerPanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          workspaceTab={workspaceTab}
          setWorkspaceTab={setWorkspaceTab}
          chessRef={chessRef}
          gamePosition={gamePosition}
          gameOutcome={gameOutcome}
          statusMessage={statusMessage}
          engineProfile={engineProfile}
          isBotThinking={isBotThinking}
          openingName={openingName}
          canUndo={canUndo}
          isHintLoading={isHintLoading}
          requestHint={requestHint}
          undoMovePair={undoMovePair}
          resetGame={resetGame}
          exportPgn={exportPgn}
          setStatusMessage={setStatusMessage}
          chatMessages={chatMessages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          isCoachThinking={isCoachThinking}
          coachMode={coachMode}
          setCoachMode={setCoachMode}
          coachLlmConnection={coachLlmConnection}
          coachLlmDetail={coachLlmDetail}
          groqAvailable={groqAvailable}
          groqDetail={groqDetail}
          handleAskCoach={handleAskCoach}
          coachAudioMuted={coachAudioMuted}
          coachAutoRead={coachAutoRead}
          coachAudioStatus={coachAudioStatus}
          speakCoachReply={speakCoachReply}
          stopCoachReply={stopCoachReply}
          setCoachAudioMuted={setCoachAudioMuted}
          setCoachAutoRead={setCoachAutoRead}
          onSpeechMoveExecuted={() => {
            const nextFen = chessRef.current.fen();
            setGamePosition(nextFen);
            setSelectedSquare(null);
            setLegalMoveTargets([]);
            updateGameOutcome(chessRef.current);
            if (
              chessRef.current.turn() === "b" &&
              !chessRef.current.isGameOver()
            ) {
              void triggerBotTurn(nextFen);
            }
          }}
        />
      ) : null}

      {gameResultText && (
        <GameOverOverlay
          resultText={gameResultText}
          onPlayAgain={resetGame}
        />
      )}

      {workspaceTab === "board" &&
        (activeTab === "3d" || activeTab === "replay") && (
          <div className="fixed inset-0 z-50">
            <Simulation3D
              chessRef={chessRef}
              gamePosition={gamePosition}
              theme={theme}
              onMoveExecuted={() => {
                const nextFen = chessRef.current.fen();
                setGamePosition(nextFen);
                setSelectedSquare(null);
                setLegalMoveTargets([]);
                updateGameOutcome(chessRef.current);
                if (
                  chessRef.current.turn() === "b" &&
                  !chessRef.current.isGameOver()
                ) {
                  void triggerBotTurn(nextFen);
                }
              }}
              setStatusMessage={setStatusMessage}
              liveAiMode={liveAiMode}
              liveAiDepth={liveAiDepth}
              onLiveAiModeChange={(mode) => {
                liveAiTurnInFlightRef.current = false;
                setLiveAiMode(mode);
                if (mode === "off") setLiveAiAnimating(false);
              }}
              onLiveAiDepthChange={setLiveAiDepth}
              replayActive={activeTab === "replay"}
              replayGames={[currentReplayGame, ...savedReplayGames]}
              replayGameId={replayGameId}
              replayMoveIndex={replayMoveIndex}
              replayPlaying={replayPlaying}
              replayBusy={replayBusy}
              replayAnimate={replayAnimate}
              onReplaySelect={selectReplayGame}
              onReplayStep={stepReplay}
              onReplayPlayingChange={setReplayPlaying}
              onAnimationStateChange={(animating) => {
                liveAiTurnInFlightRef.current = animating;
                setLiveAiAnimating(animating);
                if (activeTab === "replay") setReplayBusy(animating);
              }}
              onExit={() => {
                liveAiTurnInFlightRef.current = false;
                setLiveAiMode("off");
                setLiveAiAnimating(false);
                setReplayPlaying(false);
                setReplayBusy(false);
                setReplayGameId("current");
                setActiveTab("coach");
              }}
            />
          </div>
        )}
    </main>
  );
}
