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

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import dynamic from "next/dynamic";
import SpeechTab from "@/components/SpeechTab";
import Simulation3D, {
  ReplayGame,
  ReplayMove,
} from "@/components/Simulation3D";
import GameInfo from "@/components/GameInfo";
import LogicianPanel from "@/components/LogicianPanel";
import OverflowMenu from "@/components/OverflowMenu";
import EvalBar from "@/components/EvalBar";
import AIAnalysisTab from "@/components/AIAnalysisTab";
import BenchmarkTab from "@/components/BenchmarkTab";
import benchmarkReport from "@/benchmarks/search-benchmark.json";
import { PIECE_DESIGNS, PieceDesignKey } from "@/components/pieces";
import type { ChessboardOptions } from "react-chessboard";
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
  setSoundMuted,
} from "@/lib/audio";
import { buildMinimaxTrace } from "@/lib/minimax";
import { buildMctsTrace } from "@/lib/mcts";
import {
  useSidebarPreferences,
  type SidebarTab,
} from "@/hooks/useSidebarPreferences";
import { useEmotionDetection } from "@/hooks/useEmotionDetection";
import { useCoachAudio } from "@/hooks/useCoachAudio";
import VoiceCoachControl from "@/components/VoiceCoachControl";
import { EMOTION_PROFILES, type EmotionLabel } from "@/lib/engineProfiles";
import { lookupOpening } from "@/lib/openings";

const BOT_MOVE_API_URL = "/api/bot-move";
const COACH_API_URL = "/api/coach";
const REPLAY_GAMES_KEY = "sentio-replay-games-v1";

const COACH_AUTO_ENCOURAGEMENT: Record<string, string[]> = {
  confident: [
    "You're playing with real confidence — love to see it. Keep the pressure on.",
    "Great energy! You're in control. Stay sharp.",
    "Love the swagger. Just don't get careless.",
  ],
  focused: [
    "You're locked in. That's how you win games.",
    "Nice concentration — keep calculating deep.",
    "Focused and sharp. You've got this.",
  ],
  neutral: [
    "Solid and steady. Good things will come.",
    "You're playing fine — trust your instincts.",
    "No panic. Just keep making good moves.",
  ],
  calm: [
    "You look relaxed — that's your best state to play in.",
    "Calm and collected. That's the way.",
    "Staying cool under pressure. Well played.",
  ],
  frustrated: [
    "Hey, you're doing better than you think. Take a breath.",
    "Don't be hard on yourself. One good move changes everything.",
    "Frustration is normal. Reset and focus on the next move.",
    "You've got this. Don't let one setback shake you.",
  ],
  stressed: [
    "Take a deep breath. You've handled tougher positions.",
    "You're feeling the pressure, but you're still in this.",
    "Slow down. You don't need to rush — think clearly.",
    "Trust yourself. You know more than you think.",
  ],
};

const BOT_REMARKS: Record<string, string[]> = {
  confident: [
    "Confidence looks good on you. Shame it won't save your king.",
    "You're feeling bold. I love breaking that.",
    "That swagger won't help when I'm done with you.",
    "Love the energy. Let me crush it.",
  ],
  focused: [
    "Sharp focus. I'll still outplay you.",
    "Calculating hard? So am I. I'm just better at it.",
    "You're locked in. Good. I prefer a challenge.",
    "Focused? Good. You'll need it to keep up.",
  ],
  neutral: [
    "Playing it cool? Let's see how long that lasts.",
    "I'm just getting started.",
    "Quiet now. Let's change that.",
    "Neutral energy. I'll take that as a challenge.",
  ],
  calm: [
    "Too relaxed. Let me fix that.",
    "Calm before the storm. Here it comes.",
    "You should be nervous.",
    "Serene. Unbothered. About to be embarrassed.",
  ],
  frustrated: [
    "I can feel the frustration. Makes you sloppy.",
    "Don't tilt. Actually, do. I love it.",
    "Rage makes you predictable.",
    "Take a breath. You're playing right into my hands.",
  ],
  stressed: [
    "You look stressed. Good.",
    "Pressure cooker. Let's see if you crack.",
    "Your play is getting shaky.",
    "I can smell the panic. Beautiful.",
  ],
};

const CHECK_REMARKS = [
  "Check. Squirm a little.",
  "Check. What are you gonna do about it?",
  "King in danger. Again. Stay focused.",
  "Check. Hope you saw that coming.",
];

const CAPTURE_REMARKS = [
  "Piece down. You okay?",
  "Thanks for the material.",
  "That piece is mine now. Deal with it.",
  "Oops. Did you need that?",
];

function generateRemark(
  em: EmotionLabel,
  isCheck: boolean,
  isCapture: boolean,
): string {
  const pool = BOT_REMARKS[em] ?? BOT_REMARKS.neutral;
  let remark = pool[Math.floor(Math.random() * pool.length)];
  if (isCheck) {
    remark = CHECK_REMARKS[Math.floor(Math.random() * CHECK_REMARKS.length)];
  } else if (isCapture) {
    remark =
      CAPTURE_REMARKS[Math.floor(Math.random() * CAPTURE_REMARKS.length)];
  }
  return remark;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  bestMove?: { uci: string; san: string } | null;
  playedByCoach?: boolean;
};

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

type EngineProfile = {
  emotion: string;
  depth: number;
  skillLevel: number;
  elo: number;
  moveQuality?: string;
};

type GameOutcome = "active" | "checkmate" | "stalemate" | "draw" | "gameover";
type CoachLlmConnection =
  | "checking"
  | "connected"
  | "disconnected"
  | "disabled";
type LiveAiMode = "off" | "minimax" | "mcts";

function serializeReplayMoves(chess: Chess): ReplayMove[] {
  return chess.history({ verbose: true }).map((move) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    color: move.color,
    flags: move.flags,
    promotion: move.promotion,
  }));
}

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center sentio-bg font-mono text-zinc-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
          Loading Sentio...
        </div>
      </div>
    ),
  },
);

export default function ChessPage() {
  const chessRef = useRef(new Chess());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMoveTimestampRef = useRef<number>(0);
  const lastCoachAutoMessageRef = useRef(0);
  // Incremented on every reset so stale bot responses can never be applied
  // to a new game.
  const gameIdRef = useRef(0);
  // Active engine request, so reset/undo can cancel it immediately instead
  // of letting a stale timeout fire later.
  const botRequestControllerRef = useRef<AbortController | null>(null);

  const [gamePosition, setGamePosition] = useState(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  );
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoveTargets, setLegalMoveTargets] = useState<
    { square: string; isCapture: boolean }[]
  >([]);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [emotionMode, setEmotionMode] = useState<"auto" | "manual">("auto");
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
  const [savedReplayGames, setSavedReplayGames] = useState<ReplayGame[]>([]);
  const [replayGameId, setReplayGameId] = useState("current");
  const [replayMoveIndex, setReplayMoveIndex] = useState(-1);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayAnimate, setReplayAnimate] = useState(true);
  const replayCounterRef = useRef(1);
  const [currentReplayGame, setCurrentReplayGame] = useState<ReplayGame>({
    id: "current",
    label: "Current game",
    moves: [],
  });
  const [coachLlmConnection, setCoachLlmConnection] =
    useState<CoachLlmConnection>("checking");
  const [coachLlmDetail, setCoachLlmDetail] = useState(
    "Checking LLM health...",
  );
  const [botRemark, setBotRemark] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [coachMode, setCoachMode] = useState<"groq" | "llm">("groq");
  const [groqAvailable, setGroqAvailable] = useState(false);
  const [groqDetail, setGroqDetail] = useState("Checking Groq...");

  const {
    muted: coachAudioMuted,
    autoRead: coachAutoRead,
    status: coachAudioStatus,
    speak: speakCoachReply,
    stop: stopCoachReply,
    setMuted: setCoachAudioMuted,
    setAutoRead: setCoachAutoRead,
  } = useCoachAudio();

  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const aiHandRef = useRef<HTMLDivElement | null>(null);
  const aiHandRafRef = useRef<number | null>(null);

  const [workspaceTab, setWorkspaceTab] = useState<"board" | "aiLab">("board");
  const [activeTab, setActiveTab] = useState<SidebarTab>("coach");

  const {
    expanded: controllerExpanded,
    wide: controllerWide,
    split: controllerSplit,
    detached: controllerDetached,
    setExpanded: setControllerExpanded,
    setWide: setControllerWide,
    setSplit: setControllerSplit,
    setSplitTab,
    setDetached: setControllerDetached,
  } = useSidebarPreferences();

  const { videoRef, emotion, setEmotion, emotionHistoryRef } =
    useEmotionDetection({
      activeTab,
      auto: emotionMode === "auto",
      onStatus: setStatusMessage,
    });

  const engineProfile = backendEngineProfile ?? {
    emotion,
    ...EMOTION_PROFILES[emotion],
  };

  const [pieceDesign, setPieceDesign] = useState<PieceDesignKey>("chesscom");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [soundMutedState, setSoundMutedState] = useState<boolean>(false);

  // Restore persisted replay games once on mount (deferred past first paint
  // to avoid a synchronous setState inside the effect).
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
      window.localStorage.setItem(
        REPLAY_GAMES_KEY,
        JSON.stringify(savedReplayGames),
      );
    } catch {
      // Storage unavailable; replays stay in-memory for this session.
    }
  }, [savedReplayGames]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I am Sentio. I can coach your position, explain plans, and adapt engine strength based on your emotional state.",
    },
  ]);

  const postCoachEncouragementRef = useRef((em: EmotionLabel) => {
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
  });

  useEffect(() => {
    if (emotionMode === "auto") {
      postCoachEncouragementRef.current(emotion);
    }
  }, [emotion, emotionMode]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // When "read replies aloud" is enabled, auto-play the newest assistant reply
  // once (skipping the welcome and any error bubbles).
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

  function updateGameOutcome(chess: Chess) {
    if (!chess.isGameOver()) {
      setGameOutcome("active");
      return false;
    }
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

  // The scheduler intentionally calls the local move routine from the latest render; state dependencies control turn boundaries.
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
    // Snapshot the game generation: if the user resets mid-flight, the stale
    // response is discarded instead of applied to the new game.
    const requestGameId = gameIdRef.current;
    setIsBotThinking(true);
    setStatusMessage("Sentio engine is calculating...");

    // Local fallback bot: if the engine backend is unreachable, slow, or
    // returns an illegal move, run a shallow local search so the game never
    // freezes on the bot's turn (random move as a last resort).
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
    // Track the controller so reset/undo can cancel this request immediately.
    const controller = new AbortController();
    botRequestControllerRef.current = controller;
    const timer = setTimeout(
      () => controller.abort(new Error("Engine request timed out")),
      20000,
    );
    try {
      const response = await fetch(BOT_MOVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: currentFen,
          emotion,
        }),
        signal: controller.signal,
      });

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
      };

      if (data.engineProfile) {
        setBackendEngineProfile(data.engineProfile);
      }

      uciMove = data.botMove ?? null;
      if (!uciMove) {
        fallbackUsed = true;
        fallbackReason = data.status ?? "No move available from engine.";
      }
    } catch (error) {
      // If the user reset/undid mid-flight, stay quiet — the generation check
      // below discards everything anyway.
      if (controller.signal.aborted && gameIdRef.current !== requestGameId) {
        setIsBotThinking(false);
        return;
      }
      fallbackUsed = true;
      fallbackReason =
        error instanceof Error && error.name === "AbortError"
          ? "Engine took too long to respond."
          : error instanceof Error
            ? error.message
            : "Engine communication failure.";
      const m = localBotMove(chessRef.current);
      if (m) uciMove = m.from + m.to;
      console.error("Communication failure with Stockfish engine:", error);
    } finally {
      // Always clear the timeout so it can never abort a finished request
      // (the source of the "signal is aborted without reason" console noise).
      clearTimeout(timer);
      if (botRequestControllerRef.current === controller) {
        botRequestControllerRef.current = null;
      }
    }

    if (gameIdRef.current !== requestGameId) {
      // The game was reset while the engine was thinking; discard this move.
      setIsBotThinking(false);
      return;
    }

    if (uciMove) {
      const chess = chessRef.current;
      const lower = uciMove.toLowerCase();

      let isCapture = false;
      let appliedBotSan = "";
      let appliedBotUci = lower.substring(0, 4);
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
        }
      } catch {
        // The engine's suggested move is illegal on the current position —
        // fall back to a guaranteed-legal local move.
        fallbackUsed = true;
        fallbackReason = "Engine returned an illegal move.";
        const m = localBotMove(chess);
        if (m) {
          const fallbackMove = chess.move({ from: m.from, to: m.to });
          if (fallbackMove) {
            appliedBotSan = fallbackMove.san;
            appliedBotUci = `${fallbackMove.from}${fallbackMove.to}${fallbackMove.promotion ?? ""}`;
          }
        }
      }

      const nextFen = chess.fen();
      setLastBotMove(
        appliedBotSan
          ? { uci: appliedBotUci, san: appliedBotSan, fen: nextFen }
          : null,
      );
      setGamePosition(nextFen);
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

      const move = chess.move({
        from: from as Square,
        to: to as Square,
        promotion,
      });

      if (!move) return false;

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
      // Defer to the promotion picker instead of silently promoting to queen.
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

  /**
   * Rewind to the player's previous decision point: undoes the bot's reply
   * and the player's move. Also cancels any in-flight engine request via the
   * game-generation counter.
   */
  function undoMovePair() {
    const chess = chessRef.current;
    const historyLength = chess.history().length;
    if (historyLength === 0) return;

    // Invalidate any pending bot response so it can never land after the undo.
    gameIdRef.current += 1;
    botRequestControllerRef.current?.abort(new Error("Superseded by undo"));
    botRequestControllerRef.current = null;
    setIsBotThinking(false);
    setPendingPromotion(null);
    setHintMove(null);

    // If it's already White's turn, remove the full pair (bot reply + our
    // move). Otherwise (e.g. we just delivered mate) remove only our move.
    const undos = chess.turn() === "w" ? Math.min(2, historyLength) : 1;
    for (let i = 0; i < undos; i++) {
      if (!chess.undo()) break;
    }

    setSelectedSquare(null);
    setLegalMoveTargets([]);
    setGamePosition(chess.fen());
    updateGameOutcome(chess);
    setStatusMessage("Took back your last move.");
  }

  /** Ask the engine for a strong candidate move and highlight it on the board. */
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
  // Declared after undoMovePair so the handler reference is initialized.
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
          // Voice Coach submissions request a Burmese reply and signal that the
          // input is a chess-coaching question (bypasses English classifier).
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
    setReplayGameId("current");
    setReplayMoveIndex(-1);
    setReplayPlaying(false);
    setReplayBusy(false);
    setStatusMessage("New game started.");
  }

  useEffect(() => {
    if (replayGameId === "current") {
      setCurrentReplayGame({
        id: "current",
        label: "Current game",
        moves: serializeReplayMoves(chessRef.current),
      });
    }
  }, [gamePosition, replayGameId, activeTab]);

  const replayGames = [currentReplayGame, ...savedReplayGames];
  const activeReplayGame =
    replayGames.find((game) => game.id === replayGameId) ?? replayGames[0];
  const replayActive = activeTab === "replay";
  const hasGameActivity =
    gamePosition !== "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const splitSecondaryTab: SidebarTab = "benchmarks";

  const openingName = useMemo(
    () => lookupOpening(chessRef.current.history())?.name ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when the position changes
    [gamePosition],
  );

  const canUndo = chessRef.current.history().length > 0;

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

  function setReplayBoard(
    game: ReplayGame,
    targetIndex: number,
    animateMove: boolean,
  ) {
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
    const game = replayGames.find((candidate) => candidate.id === gameId);
    if (!game) return;
    setReplayGameId(gameId);
    setReplayPlaying(false);
    setReplayBusy(false);
    setReplayAnimate(false);
    setReplayBoard(game, -1, false);
  }

  function stepReplay(direction: -1 | 1) {
    if (!activeReplayGame || replayBusy) return;
    const nextIndex = replayMoveIndex + direction;
    if (direction === 1 && nextIndex >= activeReplayGame.moves.length) {
      setReplayPlaying(false);
      return;
    }
    if (direction === 1) setReplayBoard(activeReplayGame, nextIndex, true);
    else setReplayBoard(activeReplayGame, nextIndex, false);
  }

  useEffect(() => {
    if (
      !replayActive ||
      !replayPlaying ||
      replayBusy ||
      !activeReplayGame ||
      replayMoveIndex >= activeReplayGame.moves.length - 1
    ) {
      return;
    }
    const timer = window.setTimeout(() => stepReplay(1), 980);
    return () => window.clearTimeout(timer);
  }, [
    replayActive,
    replayPlaying,
    replayBusy,
    activeReplayGame,
    replayMoveIndex,
  ]);

  return (
    <main
      className={`flex h-screen w-screen flex-col overflow-hidden sentio-bg transition-colors duration-300 lg:flex-row ${theme === "light" ? "light text-zinc-900" : "text-zinc-100"}`}
    >
      <section className="flex flex-1 flex-col min-w-0">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-800/80 bg-zinc-950/80 px-3 py-2 shadow-sm backdrop-blur-md lg:flex-nowrap lg:px-5 dark:bg-zinc-950/80 light:bg-white/90 light:border-slate-200">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)] animate-pulse" />
            <span className="font-mono text-base font-bold tracking-tight text-amber-500 dark:text-amber-400">
              Sentio
            </span>
          </div>

          <nav
            className="workspace-nav z-50 flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-1 light:border-slate-300 light:bg-slate-100"
            aria-label="Workspace navigation"
          >
            <button
              type="button"
              aria-current={workspaceTab === "board" ? "page" : undefined}
              onClick={() => setWorkspaceTab("board")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${workspaceTab === "board" ? "bg-amber-500/20 text-amber-300 light:bg-amber-100 light:text-amber-700" : "text-zinc-500 hover:text-zinc-200 light:text-slate-500 light:hover:text-slate-800"}`}
            >
              Board
            </button>
            <button
              type="button"
              aria-current={workspaceTab === "aiLab" ? "page" : undefined}
              onClick={() => {
                setWorkspaceTab("aiLab");
                setActiveTab("coach");
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${workspaceTab === "aiLab" ? "bg-cyan-500/20 text-cyan-200 light:bg-cyan-100 light:text-cyan-700" : "text-zinc-500 hover:text-zinc-200 light:text-slate-500 light:hover:text-slate-800"}`}
            >
              AI Lab
            </button>
          </nav>

          <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

          <div className="flex items-center gap-2 text-xs">
            <span className="hidden font-medium text-zinc-500 md:inline dark:text-zinc-400 light:text-slate-600">
              Emotion:
            </span>
            <select
              className="rounded-md border border-zinc-800 bg-zinc-900/90 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 light:bg-slate-100 light:border-slate-300 light:text-slate-800 px-2.5 py-1 text-xs outline-none focus:border-amber-500/50"
              value={emotionMode}
              onChange={(event) =>
                setEmotionMode(event.target.value as "auto" | "manual")
              }
            >
              <option value="auto">Auto (Webcam)</option>
              <option value="manual">Manual</option>
            </select>
            <select
              className="rounded-md border border-zinc-800 bg-zinc-900/90 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 light:bg-slate-100 light:border-slate-300 light:text-slate-800 px-2.5 py-1 text-xs outline-none focus:border-amber-500/50 disabled:opacity-40"
              value={emotion}
              disabled={emotionMode === "auto"}
              onChange={(event) =>
                setEmotion(event.target.value as EmotionLabel)
              }
            >
              <option value="calm">Calm</option>
              <option value="focused">Focused</option>
              <option value="neutral">Neutral</option>
              <option value="frustrated">Frustrated</option>
              <option value="stressed">Stressed</option>
              <option value="confident">Confident</option>
            </select>
          </div>

          <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

          <div className="flex items-center gap-2 text-xs">
            <span className="hidden font-medium text-zinc-500 md:inline dark:text-zinc-400 light:text-slate-600">
              Bot Profile:
            </span>
            <span className="rounded bg-amber-500/10 px-2 py-0.5 font-medium text-amber-500 dark:text-amber-300 capitalize">
              {engineProfile.emotion}
            </span>
            <span className="rounded bg-zinc-800/80 dark:bg-zinc-800 dark:text-zinc-200 light:bg-slate-200 light:text-slate-800 px-2 py-0.5 font-mono font-semibold">
              {engineProfile.elo} ELO
            </span>
            <span className="hidden text-zinc-500 lg:inline dark:text-zinc-400 light:text-slate-500">
              d:{engineProfile.depth}
            </span>
            {isBotThinking && (
              <span className="text-amber-500 dark:text-amber-400 animate-pulse font-medium">
                Thinking...
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

          <div className="flex items-center gap-2 text-xs">
            <span className="hidden font-medium text-zinc-500 md:inline dark:text-zinc-400 light:text-slate-600">
              Pieces:
            </span>
            <select
              aria-label="Piece design"
              value={pieceDesign}
              onChange={(event) =>
                setPieceDesign(event.target.value as PieceDesignKey)
              }
              className="rounded-md border border-zinc-800 bg-zinc-900/90 px-2 py-1 text-xs outline-none focus:border-amber-500/50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 light:bg-slate-100 light:border-slate-300 light:text-slate-800"
            >
              {Object.entries(PIECE_DESIGNS).map(([key, d]) => (
                <option key={key} value={key}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const nextMuted = !soundMutedState;
                setSoundMutedState(nextMuted);
                setSoundMuted(nextMuted);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 dark:border-zinc-700/60 light:border-slate-300 bg-zinc-900/90 dark:bg-zinc-900 light:bg-slate-100 px-2.5 py-1 text-xs font-semibold text-zinc-300 dark:text-zinc-200 light:text-slate-800 hover:border-amber-500/50 transition-all shadow-sm"
              title={
                soundMutedState
                  ? "Sound muted — click to enable"
                  : "Sound on — click to mute"
              }
              aria-label={soundMutedState ? "Enable sound" : "Mute sound"}
              aria-pressed={!soundMutedState}
            >
              <span
                className={`text-base leading-none ${soundMutedState ? "text-rose-400" : "text-emerald-400"}`}
              >
                {soundMutedState ? "🔇" : "🔊"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 dark:border-zinc-700/60 light:border-slate-300 bg-zinc-900/90 dark:bg-zinc-900 light:bg-slate-100 px-2.5 py-1 text-xs font-semibold text-zinc-300 dark:text-zinc-200 light:text-slate-800 hover:border-amber-500/50 transition-all shadow-sm"
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              aria-label="Toggle light / dark mode"
            >
              <span className="text-base leading-none">
                {theme === "dark" ? "☀️" : "🌙"}
              </span>
            </button>
          </div>
        </header>

        {workspaceTab === "aiLab" ? (
          <section
            className="ai-lab-workspace flex min-h-0 flex-1 flex-col overflow-hidden p-6"
            aria-label="Full-width AI Lab workspace"
          >
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.8)]" />
                  <h1 className="text-lg font-bold text-cyan-100 light:text-cyan-900">
                    AI Lab · Live Game Analysis
                  </h1>
                </div>
                <p className="mt-1 text-xs text-zinc-400 light:text-slate-600">
                  A full-width view of the current user-versus-AI game. Analysis
                  starts after the first real move and follows the live position
                  only.
                </p>
              </div>
              <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200 light:border-cyan-300 light:bg-cyan-50 light:text-cyan-700">
                {hasGameActivity && activeTab !== "replay"
                  ? "tracking live game"
                  : "waiting for first move"}
              </span>
            </div>
            <div className="ai-lab-workspace-panel min-h-0 flex-1 overflow-hidden rounded-2xl border border-cyan-500/25 bg-zinc-950/45 p-4 shadow-2xl light:border-cyan-300 light:bg-white/60">
              <AIAnalysisTab
                fen={gamePosition}
                isBotThinking={isBotThinking}
                lastBotMove={lastBotMove}
                emotion={emotion}
                analysisEnabled={hasGameActivity && activeTab !== "replay"}
              />
            </div>
          </section>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-4 xl:flex-row xl:gap-8 xl:overflow-hidden xl:p-6">
            <div className="hidden h-[75vh] max-h-full shrink-0 self-center xl:block">
              <EvalBar evaluation={evaluation} />
            </div>
            <div
              ref={boardWrapRef}
              className="aspect-square w-[660px] max-w-[85vw] max-h-[75vh] rounded-2xl sentio-board-frame p-3.5 shadow-2xl touch-none border border-zinc-700/40 relative overflow-hidden light:border-slate-300"
              onTouchEndCapture={handleBoardTouchEndCapture}
            >
              <Chessboard options={chessboardOptions} />
              <div
                ref={aiHandRef}
                className="absolute left-0 top-0 z-30 pointer-events-none opacity-0"
                style={{
                  transition: "opacity 120ms ease-out",
                  filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))",
                }}
                title="Coach move"
              >
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M19.15 4.12c-.13-.14-.3-.2-.46-.2l-.02 0c-.16 0-.31.06-.42.17L14 8.28V4.5c0-.38-.31-.66-.69-.66-.38 0-.69.28-.69.66v5.23c0 .15-.11.27-.26.27-.15 0-.26-.12-.26-.27V2.69c0-.38-.31-.69-.69-.69-.38 0-.69.31-.69.69v6.86c0 .15-.11.27-.26.27-.15 0-.26-.12-.26-.27V4.46c0-.38-.31-.69-.69-.69-.38 0-.69.28-.69.69v6.5c0 .15-.11.27-.26.27-.15 0-.26-.12-.26-.27v-2.5c0-.38-.31-.69-.69-.69-.38 0-.69.28-.69.69v7.86c0 .34.13.66.36.9l3.08 3.24c.22.24.53.36.85.36h.03c.58 0 1.15-.22 1.58-.61l4.43-4.19c.47-.45.74-1.07.74-1.72v-9.09c0-.69-1-.77-1.6-1.29zM14.02 14.71h-3.31V13h3.31v1.71z"
                    fill="#f59e0b"
                    stroke="#18181b"
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              {pendingPromotion ? (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="rounded-xl border border-amber-500/40 bg-zinc-900 p-4 shadow-2xl light:border-amber-300 light:bg-white">
                    <p className="mb-2 text-xs font-semibold text-zinc-200 light:text-slate-800">
                      Choose promotion piece
                    </p>
                    <div className="flex gap-2">
                      {(
                        [
                          ["q", "♛"],
                          ["r", "♜"],
                          ["b", "♝"],
                          ["n", "♞"],
                        ] as const
                      ).map(([piece, glyph]) => (
                        <button
                          key={piece}
                          type="button"
                          onClick={() => choosePromotion(piece)}
                          className="h-12 w-12 rounded-lg border border-zinc-700 bg-zinc-800 text-3xl leading-none text-amber-300 transition-colors hover:border-amber-400 hover:bg-zinc-700 light:border-slate-300 light:bg-slate-100 light:text-slate-800 light:hover:bg-slate-200"
                        >
                          {glyph}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className="relative w-64 h-72 shrink-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl group light:border-slate-300 light:bg-slate-200">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full scale-x-[-1] object-cover"
                />
                <div className="absolute inset-0 pointer-events-none border border-amber-500/10 rounded-2xl" />
                <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                  <span className="rounded-full bg-zinc-950/80 backdrop-blur-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] text-zinc-400 uppercase tracking-wider light:bg-white/80 light:border-slate-300 light:text-slate-600">
                    Camera Feed
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-950/80 backdrop-blur-md border border-emerald-800/50 px-2.5 py-1 font-mono text-[10px] text-emerald-300 font-semibold light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    {emotion}
                  </span>
                </div>
              </div>

              {botRemark && (
                <div className="w-64 rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-zinc-300 backdrop-blur-md light:border-amber-300 light:bg-amber-100 light:text-slate-700">
                  <span className="text-amber-400 font-bold block mb-0.5 light:text-amber-700">
                    Sentio Engine:
                  </span>
                  <span className="italic">{botRemark}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {workspaceTab === "board" ? (
        <aside
          className={`controller-panel ${controllerDetached ? "controller-floating" : ""} ${controllerExpanded ? (controllerWide ? "controller-panel-wide" : "controller-panel-expanded w-full lg:w-[440px]") : "controller-panel-collapsed w-full lg:w-[72px] px-2"} flex shrink-0 flex-col overflow-hidden border-t border-zinc-800/80 bg-zinc-950/90 p-4 backdrop-blur-md lg:border-t-0 lg:border-l light:border-slate-300 light:bg-white/90`}
          data-controller-expanded={controllerExpanded}
          data-controller-wide={controllerWide}
          data-controller-split={controllerSplit}
          data-controller-detached={controllerDetached}
        >
          <div
            className={`flex items-center ${controllerExpanded ? "justify-between" : "justify-center"} mb-2`}
          >
            {controllerExpanded ? (
              <div className="min-w-0">
                <h1 className="font-mono text-base font-bold text-amber-400 light:text-amber-700">
                  Game Controller
                </h1>
                <p className="truncate text-xs text-zinc-400 light:text-slate-600">
                  {statusMessage}
                </p>
              </div>
            ) : (
              <span
                className="font-mono text-lg font-bold text-amber-400 light:text-amber-700"
                aria-hidden="true"
              >
                S
              </span>
            )}
            <div
              className={`flex items-center ${controllerExpanded ? "gap-2" : "flex-col gap-2"}`}
            >
              {controllerExpanded ? (
                <button
                  type="button"
                  onClick={() => {
                    void requestHint();
                  }}
                  disabled={
                    isHintLoading || isBotThinking || gameOutcome !== "active"
                  }
                  className="rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-emerald-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40 light:border-slate-300 light:bg-white light:text-slate-700 light:hover:bg-slate-100 light:hover:text-emerald-700"
                  title="Ask the engine for a strong move (5s cooldown)"
                >
                  {isHintLoading ? "…" : "Hint"}
                </button>
              ) : null}
              {controllerExpanded ? (
                <button
                  type="button"
                  onClick={undoMovePair}
                  disabled={!canUndo}
                  className="rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-violet-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40 light:border-slate-300 light:bg-white light:text-slate-700 light:hover:bg-slate-100 light:hover:text-violet-700"
                  title="Take back your last move (Ctrl/Cmd+Z)"
                >
                  Undo
                </button>
              ) : null}
              {controllerExpanded ? (
                <OverflowMenu
                  items={[
                    {
                      label: "Export PGN",
                      icon: "📄",
                      onSelect: exportPgn,
                      title: "Download the current game as PGN",
                    },
                    {
                      label: "Reset Game",
                      icon: "🔄",
                      onSelect: resetGame,
                    },
                    {
                      label: controllerWide ? "Compact width" : "Wide panel",
                      icon: "↔",
                      onSelect: () => setControllerWide((wide) => !wide),
                      title: "Toggle controller width",
                    },
                    {
                      label: controllerSplit ? "Single pane" : "Split panes",
                      icon: "⧉",
                      disabled: activeTab === "3d" || activeTab === "replay",
                      onSelect: () => {
                        if (activeTab === "3d" || activeTab === "replay")
                          return;
                        setControllerSplit((split) => !split);
                        setControllerWide(true);
                      },
                      title: "Compare two sidebar components",
                    },
                    {
                      label: controllerDetached
                        ? "Dock sidebar"
                        : "Float sidebar",
                      icon: "🪟",
                      onSelect: () =>
                        setControllerDetached((detached) => !detached),
                    },
                  ]}
                />
              ) : null}
              <button
                type="button"
                aria-label={
                  controllerExpanded
                    ? "Collapse game controller"
                    : "Expand game controller"
                }
                aria-expanded={controllerExpanded}
                onClick={() => setControllerExpanded((expanded) => !expanded)}
                className="controller-toggle rounded-lg border border-zinc-700/60 bg-zinc-900 px-2.5 py-1.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300 light:border-slate-300 light:bg-white light:text-slate-700 light:hover:bg-slate-100 light:hover:text-amber-700"
                title={
                  controllerExpanded
                    ? "Collapse game controller"
                    : "Expand game controller"
                }
              >
                {controllerExpanded ? "›" : "‹"}
              </button>
            </div>
          </div>

          {controllerExpanded ? (
            <div
              className={`controller-content ${controllerWide ? "controller-wide-mode" : ""} min-h-0 flex-1`}
            >
              <div className="mt-2">
                {}
                <GameInfo
                  moves={chessRef.current.history({ verbose: true })}
                  openingName={openingName}
                />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1 light:border-slate-300 light:bg-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveTab("coach")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    activeTab === "coach"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm light:bg-amber-100 light:text-amber-700"
                      : "text-zinc-500 hover:text-zinc-300 light:text-slate-500 light:hover:text-slate-700"
                  }`}
                >
                  AI Coach
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("speech")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    activeTab === "speech"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm light:bg-amber-100 light:text-amber-700"
                      : "text-zinc-500 hover:text-zinc-300 light:text-slate-500 light:hover:text-slate-700"
                  }`}
                >
                  Voice Moves
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("logician")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    activeTab === "logician"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm light:bg-amber-100 light:text-amber-700"
                      : "text-zinc-500 hover:text-zinc-300 light:text-slate-500 light:hover:text-slate-700"
                  }`}
                  title="Rule-based advice from the Prolog knowledge base"
                >
                  Logician
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("benchmarks")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    activeTab === "benchmarks"
                      ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 shadow-sm light:bg-emerald-100 light:text-emerald-700"
                      : "text-zinc-500 hover:text-zinc-300 light:text-slate-500 light:hover:text-slate-700"
                  }`}
                >
                  Benchmarks
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("replay")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    activeTab === "replay"
                      ? "bg-violet-500/20 text-violet-200 border border-violet-500/30 shadow-sm light:bg-violet-100 light:text-violet-700"
                      : "text-zinc-500 hover:text-zinc-300 light:text-slate-500 light:hover:text-slate-700"
                  }`}
                >
                  Replay
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("3d")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    activeTab === "3d"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm light:bg-amber-100 light:text-amber-700"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 light:text-slate-500 light:hover:text-slate-700 light:hover:bg-slate-200/60"
                  }`}
                >
                  3D Mode
                </button>
              </div>

              {controllerSplit ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-violet-400/20 bg-violet-950/20 px-2.5 py-2 text-[11px] light:border-violet-300 light:bg-violet-50">
                  <span className="font-semibold text-violet-200 light:text-violet-800">
                    Compare with
                  </span>
                  <select
                    aria-label="Split sidebar component"
                    value={splitSecondaryTab}
                    onChange={(event) =>
                      setSplitTab(event.target.value as SidebarTab)
                    }
                    className="rounded-md border border-violet-400/30 bg-zinc-950 px-2 py-1 text-[11px] text-violet-100 outline-none light:border-violet-300 light:bg-white light:text-violet-800"
                  >
                    <option value="benchmarks">Benchmarks</option>
                  </select>
                </div>
              ) : null}

              <div
                className={`controller-split-region mt-3 min-h-0 flex-1 ${controllerSplit ? "controller-split-grid" : ""}`}
              >
                <div className="controller-primary-pane flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5 backdrop-blur-md light:border-slate-300 light:bg-white/70">
                  {activeTab === "coach" ? (
                    <>
                      <div className="flex items-center justify-between mb-2.5">
                        <p className="text-sm text-zinc-200 font-semibold light:text-slate-800">
                          Coach Assistant
                        </p>
                        {coachMode === "groq" ? (
                          <span
                            title={groqDetail}
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              groqAvailable
                                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 light:bg-emerald-100 light:text-emerald-700 light:border-emerald-300"
                                : "bg-rose-950/80 text-rose-300 border border-rose-800/50 light:bg-rose-100 light:text-rose-700 light:border-rose-300"
                            }`}
                          >
                            {groqAvailable ? "Groq Active" : "Groq Needs Key"}
                          </span>
                        ) : (
                          <span
                            title={coachLlmDetail}
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              coachLlmConnection === "connected"
                                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 light:bg-emerald-100 light:text-emerald-700 light:border-emerald-300"
                                : coachLlmConnection === "disabled"
                                  ? "bg-zinc-800 text-zinc-400 border border-zinc-700 light:bg-slate-200 light:text-slate-600 light:border-slate-300"
                                  : coachLlmConnection === "checking"
                                    ? "bg-amber-950/80 text-amber-300 border border-amber-800/50 light:bg-amber-100 light:text-amber-700 light:border-amber-300"
                                    : "bg-rose-950/80 text-rose-300 border border-rose-800/50 light:bg-rose-100 light:text-rose-700 light:border-rose-300"
                            }`}
                          >
                            {coachLlmConnection === "connected"
                              ? "LLM Active"
                              : coachLlmConnection === "disabled"
                                ? "Standard Mode"
                                : coachLlmConnection === "checking"
                                  ? "Checking LLM..."
                                  : "Offline"}
                          </span>
                        )}
                      </div>
                      <div className="mb-2.5 flex gap-1 rounded-lg bg-zinc-900/90 p-1 border border-zinc-800 light:bg-slate-100 light:border-slate-300">
                        <button
                          type="button"
                          onClick={() => setCoachMode("groq")}
                          disabled={!groqAvailable}
                          className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${
                            coachMode === "groq"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 light:bg-amber-100 light:text-amber-700"
                              : "text-zinc-500 hover:text-zinc-300 disabled:opacity-40 light:text-slate-500 light:hover:text-slate-700"
                          }`}
                          title={groqDetail}
                        >
                          Groq
                        </button>
                        <button
                          type="button"
                          onClick={() => setCoachMode("llm")}
                          disabled={coachLlmConnection === "disabled"}
                          className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${
                            coachMode === "llm"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 light:bg-amber-100 light:text-amber-700"
                              : "text-zinc-500 hover:text-zinc-300 disabled:opacity-40 light:text-slate-500 light:hover:text-slate-700"
                          }`}
                          title={coachLlmDetail}
                        >
                          Local LLM
                        </button>
                      </div>

                      <VoiceCoachControl
                        onTranscriptReady={(text) => setChatInput(text)}
                        onSubmit={(text) =>
                          void handleAskCoach(Date.now(), {
                            question: text,
                            source: "voice-coach",
                          })
                        }
                        disabled={isCoachThinking}
                      />

                      <div className="mb-2.5 flex items-center gap-3 text-[11px] text-zinc-400 light:text-slate-600">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={coachAudioMuted}
                            onChange={(event) =>
                              setCoachAudioMuted(event.target.checked)
                            }
                            className="accent-amber-500"
                          />
                          Mute audio
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={!coachAudioMuted && coachAutoRead}
                            onChange={(event) =>
                              setCoachAutoRead(event.target.checked)
                            }
                            className="accent-amber-500"
                          />
                          Read replies aloud
                        </label>
                      </div>

                      <div
                        ref={chatScrollRef}
                        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 chat-scroll"
                      >
                        {chatMessages.map((message) => (
                          <div
                            key={message.id}
                            className={`rounded-xl border ${
                              message.role === "assistant"
                                ? "border-zinc-800 bg-zinc-900/90 text-zinc-200 light:border-slate-300 light:bg-white light:text-slate-800"
                                : "border-amber-500/20 bg-amber-950/20 text-amber-100 light:border-amber-300 light:bg-amber-100 light:text-amber-900"
                            }`}
                          >
                            <div className="p-3 text-xs leading-relaxed whitespace-pre-line">
                              {message.content}
                            </div>
                            {message.role === "assistant" && (
                              <div className="flex items-center gap-1 border-t border-zinc-800/80 px-3 py-1.5 light:border-slate-300">
                                <button
                                  type="button"
                                  aria-label={`Read reply aloud: ${message.id}`}
                                  title="Read this reply aloud (Burmese)"
                                  onClick={() => {
                                    if (
                                      coachAudioStatus.phase === "playing" &&
                                      coachAudioStatus.id === message.id
                                    ) {
                                      stopCoachReply();
                                    } else {
                                      void speakCoachReply(
                                        message.id,
                                        message.content,
                                      );
                                    }
                                  }}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                                    coachAudioStatus.phase === "playing" &&
                                    coachAudioStatus.id === message.id
                                      ? "text-amber-300 hover:text-amber-200 light:text-amber-700"
                                      : "text-zinc-400 hover:text-amber-300 light:text-slate-500 light:hover:text-amber-700"
                                  }`}
                                >
                                  {coachAudioStatus.phase === "loading" &&
                                  coachAudioStatus.id === message.id ? (
                                    <span className="animate-pulse">⏳</span>
                                  ) : coachAudioStatus.phase === "playing" &&
                                    coachAudioStatus.id === message.id ? (
                                    <span>■ stop</span>
                                  ) : (
                                    <span>🔊 read aloud</span>
                                  )}
                                </button>
                                {coachAudioStatus.phase === "error" &&
                                  coachAudioStatus.id === message.id && (
                                    <span className="text-[10px] italic text-zinc-500 light:text-slate-500">
                                      audio unavailable — text still shown
                                    </span>
                                  )}
                              </div>
                            )}
                            {message.bestMove && message.playedByCoach && (
                              <div className="border-t border-zinc-800/80 px-3 py-2 text-[11px] light:border-slate-300">
                                <span className="font-mono font-bold text-amber-400 light:text-amber-700">
                                  ▶ {message.bestMove.san}
                                </span>
                                <span className="ml-2 text-zinc-400 light:text-slate-500">
                                  playing it now
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          value={chatInput}
                          onChange={(event) => setChatInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void handleAskCoach(Date.now());
                            }
                          }}
                          placeholder="Ask coach for tactical advice or plan..."
                          className="flex-1 rounded-lg border border-zinc-700/80 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-amber-500/60 transition-colors light:border-slate-300 light:bg-white light:text-slate-800"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleAskCoach(Date.now());
                          }}
                          disabled={isCoachThinking || !chatInput.trim()}
                          className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-40 transition-colors shadow-sm"
                        >
                          {isCoachThinking ? "..." : "Ask"}
                        </button>
                      </div>
                    </>
                  ) : activeTab === "speech" ? (
                    <SpeechTab
                      chessRef={chessRef}
                      gameOutcome={gameOutcome}
                      isBotThinking={isBotThinking}
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
                    />
                  ) : activeTab === "logician" ? (
                    <LogicianPanel fen={gamePosition} active />
                  ) : activeTab === "benchmarks" ? (
                    <BenchmarkTab report={benchmarkReport} />
                  ) : (
                    <div className="flex flex-1 flex-col justify-between p-1 space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 light:border-slate-300">
                          <span className="text-xs font-bold text-amber-400 light:text-amber-700">
                            3D Interactive Arena
                          </span>
                          <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300 light:bg-amber-100 light:border-amber-300 light:text-amber-700">
                            3D Active
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed light:text-slate-600">
                          The board has morphed into a full 3D studio where you
                          and Sentio AI sit face-to-face.
                        </p>

                        <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-3 space-y-2.5 text-xs light:bg-white light:border-slate-300">
                          <span className="font-semibold text-zinc-300 block light:text-slate-700">
                            Controls:
                          </span>
                          <ul className="space-y-2 text-zinc-400 text-[11px] light:text-slate-600">
                            <li className="flex items-start gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1 shrink-0" />
                              <span>
                                <strong className="text-zinc-200 light:text-slate-800">
                                  Move Piece:
                                </strong>{" "}
                                Click a piece and a green square, or use fist +
                                hold for 2s
                              </span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 mt-1 shrink-0" />
                              <span>
                                <strong className="text-zinc-200 light:text-slate-800">
                                  Orbit View:
                                </strong>{" "}
                                Right-click & drag canvas to tilt and rotate
                                camera angle
                              </span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                              <span>
                                <strong className="text-zinc-200 light:text-slate-800">
                                  Zoom:
                                </strong>{" "}
                                Scroll wheel or pinch trackpad
                              </span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1 shrink-0" />
                              <span>
                                <strong className="text-zinc-200 light:text-slate-800">
                                  Webcam Gestures:
                                </strong>{" "}
                                Palm to aim · Fist to grab · Hold still over a
                                green square for 2s to place · Palm to release
                              </span>
                            </li>
                          </ul>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveTab("coach")}
                        className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/80 px-4 py-2.5 text-xs font-bold text-zinc-200 transition-all shadow-sm light:bg-slate-200 light:hover:bg-slate-300 light:border-slate-300 light:text-slate-800"
                      >
                        Return to 2D Board & Coach
                      </button>
                    </div>
                  )}
                </div>
                {controllerSplit &&
                activeTab !== "3d" &&
                activeTab !== "replay" ? (
                  <div className="controller-secondary-pane flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-violet-400/25 bg-zinc-900/60 p-3.5 backdrop-blur-md light:border-violet-300 light:bg-white/70">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-violet-200 light:text-violet-800">
                        Benchmarks
                      </span>
                      <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-[9px] font-semibold text-violet-200 light:text-violet-700">
                        side-by-side
                      </span>
                    </div>
                    <BenchmarkTab report={benchmarkReport} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="controller-rail mt-4 flex flex-1 flex-row items-center justify-center gap-3 text-center lg:flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 lg:[writing-mode:vertical-rl] light:text-slate-500">
                Controller
              </span>
              <span
                className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                title={statusMessage}
              />
            </div>
          )}
        </aside>
      ) : null}

      {gameResultText && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-md light:bg-slate-900/60">
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900/90 p-8 text-center shadow-2xl max-w-sm w-full mx-4 light:border-slate-300 light:bg-white">
            <p className="text-3xl font-extrabold text-amber-400 mb-2 light:text-amber-700">
              {gameResultText}
            </p>
            <p className="text-xs text-zinc-400 mb-6 light:text-slate-600">
              Game finished. Would you like to play another round?
            </p>
            <button
              type="button"
              onClick={resetGame}
              className="w-full rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 hover:bg-amber-400 transition-colors shadow-lg"
            >
              Play Again
            </button>
          </div>
        </div>
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
              replayActive={replayActive}
              replayGames={replayGames}
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
                if (replayActive) setReplayBusy(animating);
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
