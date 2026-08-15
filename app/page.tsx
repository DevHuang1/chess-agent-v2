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
 * a depth-10 search at ELO 3190. It spawns an isolated Stockfish instance
 * per request, configures it with the profile, and returns the best move.
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
import { Chess, Square } from "chess.js";
import dynamic from "next/dynamic";
import SpeechTab from "@/components/SpeechTab";
import Simulation3D, { ReplayGame, ReplayMove } from "@/components/Simulation3D";
import GameInfo from "@/components/GameInfo";
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

const BOT_MOVE_API_URL = "/api/bot-move";
const COACH_API_URL = "/api/coach";

type EmotionLabel =
  | "calm"
  | "focused"
  | "neutral"
  | "frustrated"
  | "stressed"
  | "confident";

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

function pieceColorAtSquare(square: string, fen: string): "w" | "b" | null {
  const board = fen.split(" ")[0];
  const rows = board.split("/");
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - parseInt(square[1]);
  const row = rows[rank];
  if (!row) return null;
  let col = 0;
  for (const ch of row) {
    if (col > file) break;
    if (col === file) {
      if (ch >= "1" && ch <= "8") return null;
      return ch === ch.toUpperCase() ? "w" : "b";
    }
    if (ch >= "1" && ch <= "8") {
      col += parseInt(ch);
    } else {
      col++;
    }
  }
  return null;
}

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
type CoachLlmConnection = "checking" | "connected" | "disconnected" | "disabled";
type SidebarTab = "coach" | "speech" | "ai" | "benchmarks" | "3d" | "replay";
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

const EMOTION_PROFILES: Record<EmotionLabel, { depth: number; skillLevel: number; elo: number }> = {
  stressed: { depth: 1, skillLevel: 1, elo: 1320 },
  frustrated: { depth: 2, skillLevel: 3, elo: 1320 },
  calm: { depth: 4, skillLevel: 6, elo: 1600 },
  neutral: { depth: 6, skillLevel: 10, elo: 2000 },
  focused: { depth: 8, skillLevel: 15, elo: 2600 },
  confident: { depth: 10, skillLevel: 20, elo: 3190 },
};

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

type FaceApiModule = typeof import("@vladmandic/face-api");

const EXPRESSION_TO_EMOTION: Record<string, EmotionLabel> = {
  happy: "confident",
  neutral: "neutral",
  sad: "frustrated",
  angry: "frustrated",
  fearful: "stressed",
  surprised: "focused",
  disgusted: "stressed",
};

const EMOTION_BUFFER_SIZE = 3;
const emotionBuffer: EmotionLabel[] = [];

function mostFrequentInBuffer(): EmotionLabel | null {
  if (emotionBuffer.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const e of emotionBuffer) {
    counts[e] = (counts[e] ?? 0) + 1;
  }
  return Object.entries(counts).sort(
    (a, b) => b[1] - a[1],
  )[0][0] as EmotionLabel;
}

async function detectEmotionFromVideo(
  faceapi: FaceApiModule,
  videoElement: HTMLVideoElement | null,
): Promise<EmotionLabel> {
  if (
    !videoElement ||
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return "neutral";
  }

  try {
    const detection = await faceapi
      .detectSingleFace(
        videoElement,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }),
      )
      .withFaceExpressions();

    if (!detection?.expressions) {
      return "neutral";
    }

    const sorted = detection.expressions.asSortedArray();
    const top = sorted[0];

    if (!top || top.probability < 0.35) {
      return "neutral";
    }

    return EXPRESSION_TO_EMOTION[top.expression] ?? "neutral";
  } catch {
    return "neutral";
  }
}

export default function ChessPage() {
  const chessRef = useRef(new Chess());
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMoveTimestampRef = useRef<number>(0);
  const faceapiRef = useRef<FaceApiModule | null>(null);
  const emotionHistoryRef = useRef<EmotionLabel[]>([]);
  const lastCoachAutoMessageRef = useRef(0);

  const [gamePosition, setGamePosition] = useState(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  );
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<EmotionLabel>("neutral");
  const [emotionMode, setEmotionMode] = useState<"auto" | "manual">("auto");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [backendEngineProfile, setBackendEngineProfile] =
    useState<EngineProfile | null>(null);
  const engineProfile = backendEngineProfile ?? {
    emotion,
    ...(EMOTION_PROFILES[emotion] ?? EMOTION_PROFILES.neutral),
  };
  const [gameOutcome, setGameOutcome] = useState<GameOutcome>("active");
  const [moveQualities, setMoveQualities] = useState<Record<number, string>>(
    {},
  );
  const [lastPositionScore, setLastPositionScore] = useState<number | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState("Sentio online.");
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [lastBotMove, setLastBotMove] = useState<{ uci: string; san: string; fen: string } | null>(null);
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
  const [currentReplayGame, setCurrentReplayGame] = useState<ReplayGame>({ id: "current", label: "Current game", moves: [] });
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

  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const aiHandRef = useRef<HTMLDivElement | null>(null);
  const aiHandRafRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<SidebarTab>("coach");
  const [controllerExpanded, setControllerExpanded] = useState(true);

  const [pieceDesign, setPieceDesign] = useState<PieceDesignKey>("chesscom");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [soundMutedState, setSoundMutedState] = useState<boolean>(false);

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
    document.body.style.overflow = "hidden";
    const isE2ETest = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("e2e");
    if (isE2ETest || activeTab === "3d") {
      return () => {
        document.body.style.overflow = "";
      };
    }
    lastMoveTimestampRef.current = Date.now();
    let mediaStream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        mediaStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        console.error("Webcam video source offline:", err);
        setStatusMessage(
          "Webcam unavailable. Emotion fallback set to neutral.",
        );
      });

    import("@vladmandic/face-api")
      .then((mod) => {
        Promise.all([
          mod.nets.tinyFaceDetector.loadFromUri("/models"),
          mod.nets.faceExpressionNet.loadFromUri("/models"),
        ])
          .then(() => {
            faceapiRef.current = mod;
            setModelsLoaded(true);
          })
          .catch((loadErr) => {
            console.error("Failed to load face-api models:", loadErr);
            setStatusMessage("Emotion models failed to load.");
          });
      })
      .catch((importErr) => {
        console.error("Failed to import face-api:", importErr);
      });

    return () => {
      document.body.style.overflow = "";
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [activeTab]);

  useEffect(() => {
    const isE2ETest = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("e2e");
    if (isE2ETest || activeTab === "3d" || emotionMode !== "auto" || !faceapiRef.current || !modelsLoaded) return;

    const intervalId = window.setInterval(async () => {
      const api = faceapiRef.current;
      if (!api) return;

      const estimatedEmotion = await detectEmotionFromVideo(
        api,
        videoRef.current,
      );
      emotionBuffer.push(estimatedEmotion);
      if (emotionBuffer.length > EMOTION_BUFFER_SIZE) {
        emotionBuffer.shift();
      }
      const smoothed = mostFrequentInBuffer();
      if (smoothed) {
        setEmotion(smoothed);
        emotionHistoryRef.current.push(smoothed);
        if (emotionHistoryRef.current.length > 7) {
          emotionHistoryRef.current.shift();
        }
      }
    }, 2200);

    return () => {
      window.clearInterval(intervalId);
      emotionBuffer.length = 0;
      emotionHistoryRef.current = [];
    };
  }, [activeTab, emotionMode, modelsLoaded]);

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
    setStatusMessage(`${liveAiMode === "mcts" ? "MCTS" : "Minimax"} is searching at depth ${liveAiDepth}...`);
    const trace = liveAiMode === "mcts"
      ? buildMctsTrace(currentFen, { iterations: Math.min(180, Math.max(24, liveAiDepth * 24)), branchLimit: 5, rolloutDepth: liveAiDepth, aiColor: chess.turn() })
      : buildMinimaxTrace(currentFen, { depth: liveAiDepth, branchLimit: 5, aiColor: chess.turn() });
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
      promotion: selected.uci.length === 5 ? selected.uci[4] as "q" | "r" | "b" | "n" : undefined,
    });
    if (!applied) {
      setIsBotThinking(false);
      setStatusMessage("Live AI returned an unusable move.");
      return false;
    }
    const nextFen = chess.fen();
    setLastBotMove({ uci: `${applied.from}${applied.to}${applied.promotion ?? ""}`, san: applied.san, fen: nextFen });
    setGamePosition(nextFen);
    if (isCapture) playCaptureSound();
    else if (chess.inCheck()) playCheckSound();
    else playMoveSound();
    updateGameOutcome(chess);
    setBotRemark(`${liveAiMode === "mcts" ? "MCTS" : "Minimax"} selected ${applied.san} · depth ${liveAiDepth}`);
    setStatusMessage(`${liveAiMode === "mcts" ? "MCTS" : "Minimax"} plays ${applied.san}`);
    setIsBotThinking(false);
    return true;
  }

  // The scheduler intentionally calls the local move routine from the latest render; state dependencies control turn boundaries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeTab !== "3d" || liveAiMode === "off" || gameOutcome !== "active" || liveAiAnimating || liveAiTurnInFlightRef.current) return;
    const timer = window.setTimeout(() => {
      liveAiTurnInFlightRef.current = true;
      const moved = runLiveAiMove();
      if (!moved) liveAiTurnInFlightRef.current = false;
    }, 480);
    return () => window.clearTimeout(timer);
  }, [activeTab, gamePosition, liveAiMode, liveAiDepth, liveAiAnimating, gameOutcome]);

  async function triggerBotTurn(currentFen: string) {
    setIsBotThinking(true);
    setStatusMessage("Sentio engine is calculating...");

    // Local fallback bot: if the engine backend is unreachable, slow, or
    // returns an illegal move, pick a random legal move in the browser so the
    // game never freezes on the bot's turn.
    const localBotMove = (
      chess: Chess,
    ): { from: Square; to: Square } | null => {
      const moves = chess.moves({ verbose: true });
      if (moves.length === 0) return null;
      const m = moves[Math.floor(Math.random() * moves.length)];
      return { from: m.from, to: m.to };
    };

    let uciMove: string | null = null;
    let fallbackUsed = false;
    let fallbackReason = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(BOT_MOVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: currentFen,
          emotion,
          strengthPreference: "adaptive",
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

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
      setLastBotMove(appliedBotSan ? { uci: appliedBotUci, san: appliedBotSan, fen: nextFen } : null);
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

  function applyMove(from: string, to: string, now: number) {
    const chess = chessRef.current;
    try {
      if (chess.turn() !== "w") return false;

      const move = chess.move({
        from: from as Square,
        to: to as Square,
        promotion: "q",
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
      setLegalMoveSquares([]);
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

  function handleSquareClick(square: string, now: number) {
    const chess = chessRef.current;
    if (gameOutcome !== "active") return;
    const pieceOnSquare = chess.get(square as Square);
    const activeColor = chess.turn();

    if (!selectedSquare) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square: square as Square, verbose: true });
        setLegalMoveSquares(moves.map((m) => m.to));
      }
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      setLegalMoveSquares([]);
      return;
    }

    const moved = applyMove(selectedSquare, square, now);
    if (!moved) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square: square as Square, verbose: true });
        setLegalMoveSquares(moves.map((m) => m.to));
      } else {
        setSelectedSquare(null);
        setLegalMoveSquares([]);
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
      setLegalMoveSquares([]);
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

  async function handleAskCoach(now: number) {
    const question = chatInput.trim();
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

  const customSquareStyles = selectedSquare
    ? {
        [selectedSquare]: { backgroundColor: "rgba(245, 158, 11, 0.45)" },
        ...Object.fromEntries(
          legalMoveSquares.map((sq) => {
            const color = pieceColorAtSquare(sq, gamePosition);
            if (color && color !== "w") {
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
    : {};

  const chessboardOptions: ChessboardOptions = {
    id: "sentio-engine-board",
    position: gamePosition,
    onSquareClick: ({ square }) => {
      // eslint-disable-next-line react-hooks/purity
      handleSquareClick(square, Date.now());
    },
    onPieceClick: ({ square }) => {
      // eslint-disable-next-line react-hooks/purity
      if (square) handleSquareClick(square, Date.now());
    },
    onPieceDrop: ({ sourceSquare, targetSquare }) => {
      if (!targetSquare) return false;
      const chess = chessRef.current;
      if (chess.turn() !== "w") return false;
      // eslint-disable-next-line react-hooks/purity
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
      setSavedReplayGames((previous) => [{ id, label: `Game ${replayCounterRef.current - 1} · ${completedMoves.length} plies`, moves: completedMoves }, ...previous].slice(0, 8));
    }
    liveAiTurnInFlightRef.current = false;
    setLiveAiAnimating(false);
    const newChess = new Chess();
    chessRef.current = newChess;
    setGamePosition(newChess.fen());
    setGameOutcome("active");
    setLastBotMove(null);
    setSelectedSquare(null);
    setLegalMoveSquares([]);
        setReplayGameId("current");
    setReplayMoveIndex(-1);
    setReplayPlaying(false);
    setReplayBusy(false);
    setStatusMessage("New game started.");
  }

  useEffect(() => {
    if (replayGameId === "current") {
      setCurrentReplayGame({ id: "current", label: "Current game", moves: serializeReplayMoves(chessRef.current) });
    }
  }, [gamePosition, replayGameId, activeTab]);

  const replayGames = [currentReplayGame, ...savedReplayGames];
  const activeReplayGame = replayGames.find((game) => game.id === replayGameId) ?? replayGames[0];
  const replayActive = activeTab === "replay";

  function setReplayBoard(game: ReplayGame, targetIndex: number, animateMove: boolean) {
    const board = new Chess();
    const boundedIndex = Math.max(-1, Math.min(targetIndex, game.moves.length - 1));
    const movesToApply = game.moves.slice(0, boundedIndex + 1);
    for (const move of movesToApply) {
      board.move({ from: move.from as Square, to: move.to as Square, promotion: move.promotion as "q" | "r" | "b" | "n" | undefined });
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
      before.move({ from: previous.from as Square, to: previous.to as Square, promotion: previous.promotion as "q" | "r" | "b" | "n" | undefined });
    }
    const animatedBoard = new Chess(before.fen());
    const applied = animatedBoard.move({ from: move.from as Square, to: move.to as Square, promotion: move.promotion as "q" | "r" | "b" | "n" | undefined });
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
    if (!replayActive || !replayPlaying || replayBusy || !activeReplayGame || replayMoveIndex >= activeReplayGame.moves.length - 1) {
      return;
    }
    const timer = window.setTimeout(() => stepReplay(1), 980);
    return () => window.clearTimeout(timer);
  }, [replayActive, replayPlaying, replayBusy, activeReplayGame, replayMoveIndex]);

  return (
    <main
      className={`flex h-screen w-screen overflow-hidden sentio-bg transition-colors duration-300 ${theme === "light" ? "light text-zinc-900" : "text-zinc-100"}`}
    >
      <section className="flex flex-1 flex-col min-w-0">
        <header className="flex items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-5 py-2 shadow-sm dark:bg-zinc-950/80 light:bg-white/90 light:border-slate-200">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)] animate-pulse" />
            <span className="font-mono text-base font-bold tracking-tight text-amber-500 dark:text-amber-400">
              Sentio
            </span>
          </div>

          <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-zinc-500 dark:text-zinc-400 light:text-slate-600">
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
            <span className="font-medium text-zinc-500 dark:text-zinc-400 light:text-slate-600">
              Bot Profile:
            </span>
            <span className="rounded bg-amber-500/10 px-2 py-0.5 font-medium text-amber-500 dark:text-amber-300 capitalize">
              {engineProfile.emotion}
            </span>
            <span className="rounded bg-zinc-800/80 dark:bg-zinc-800 dark:text-zinc-200 light:bg-slate-200 light:text-slate-800 px-2 py-0.5 font-mono font-semibold">
              {engineProfile.elo} ELO
            </span>
            <span className="text-zinc-500 dark:text-zinc-400 light:text-slate-500">
              d:{engineProfile.depth}
            </span>
            {isBotThinking && (
              <span className="text-amber-500 dark:text-amber-400 animate-pulse font-medium">
                Thinking...
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-zinc-800/80 dark:bg-zinc-800 light:bg-slate-300" />

          <div className="flex items-center gap-1.5 text-xs">
            <span className="mr-1 text-zinc-500 dark:text-zinc-400 light:text-slate-600 font-medium">
              Pieces:
            </span>
            {Object.entries(PIECE_DESIGNS).map(([key, d]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPieceDesign(key as PieceDesignKey)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-all ${
                  pieceDesign === key
                    ? "bg-amber-500/20 text-amber-500 dark:text-amber-300 border border-amber-500/40 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300 dark:hover:text-zinc-200 light:text-slate-600 light:hover:text-slate-900 hover:bg-zinc-800/50 light:hover:bg-slate-200/60"
                }`}
              >
                {d.label}
              </button>
            ))}
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
              title="Toggle Capture & Move Sound Effects"
            >
              {soundMutedState ? (
                <>
                  <span className="text-rose-400">🔇</span>
                  <span>Muted</span>
                </>
              ) : (
                <>
                  <span className="text-emerald-400">🔊</span>
                  <span>Sound On</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 dark:border-zinc-700/60 light:border-slate-300 bg-zinc-900/90 dark:bg-zinc-900 light:bg-slate-100 px-2.5 py-1 text-xs font-semibold text-zinc-300 dark:text-zinc-200 light:text-slate-800 hover:border-amber-500/50 transition-all shadow-sm"
              title="Toggle Light / Dark Mode"
            >
              {theme === "dark" ? (
                <>
                  <span className="text-amber-400">☀️</span>
                  <span>Light</span>
                </>
              ) : (
                <>
                  <span className="text-blue-500">🌙</span>
                  <span>Dark</span>
                </>
              )}
            </button>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center gap-8 p-6 min-h-0">
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
      </section>

<aside className={`controller-panel ${controllerExpanded ? "controller-panel-expanded w-[440px]" : "controller-panel-collapsed w-[72px] px-2"} flex shrink-0 flex-col overflow-hidden border-l border-zinc-800/80 bg-zinc-950/90 p-4 backdrop-blur-md light:border-slate-300 light:bg-white/90`} data-controller-expanded={controllerExpanded}>
        <div className={`flex items-center ${controllerExpanded ? "justify-between" : "justify-center"} mb-2`}>
          {controllerExpanded ? (
            <div className="min-w-0">
              <h1 className="font-mono text-base font-bold text-amber-400 light:text-amber-700">Game Controller</h1>
              <p className="truncate text-xs text-zinc-400 light:text-slate-600">{statusMessage}</p>
            </div>
          ) : (
            <span className="font-mono text-lg font-bold text-amber-400 light:text-amber-700" aria-hidden="true">S</span>
          )}
          <div className={`flex items-center ${controllerExpanded ? "gap-2" : "flex-col gap-2"}`}>
            {controllerExpanded ? (
              <button
                type="button"
                onClick={resetGame}
                className="rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-amber-300 transition-colors light:border-slate-300 light:bg-white light:text-slate-700 light:hover:bg-slate-100 light:hover:text-amber-700"
              >
                Reset Game
              </button>
            ) : null}
            <button
              type="button"
              aria-label={controllerExpanded ? "Collapse game controller" : "Expand game controller"}
              aria-expanded={controllerExpanded}
              onClick={() => setControllerExpanded((expanded) => !expanded)}
              className="controller-toggle rounded-lg border border-zinc-700/60 bg-zinc-900 px-2.5 py-1.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300 light:border-slate-300 light:bg-white light:text-slate-700 light:hover:bg-slate-100 light:hover:text-amber-700"
              title={controllerExpanded ? "Collapse game controller" : "Expand game controller"}
            >
              {controllerExpanded ? "›" : "‹"}
            </button>
          </div>
        </div>

        {controllerExpanded ? (
          <div className="controller-content min-h-0 flex-1">
        <div className="mt-2">
          {/* eslint-disable-next-line react-hooks/refs */}
          <GameInfo moves={chessRef.current.history({ verbose: true })} />
        </div>

        <div className="mt-3 flex gap-1 rounded-xl bg-zinc-900/90 p-1 border border-zinc-800 light:bg-slate-100 light:border-slate-300">
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
            onClick={() => setActiveTab("ai")}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              activeTab === "ai"
                ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 shadow-sm light:bg-cyan-100 light:text-cyan-700"
                : "text-zinc-500 hover:text-zinc-300 light:text-slate-500 light:hover:text-slate-700"
            }`}
          >
            AI Lab
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

        <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5 backdrop-blur-md light:border-slate-300 light:bg-white/70">
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
                setLegalMoveSquares([]);
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
          ) : activeTab === "benchmarks" ? (
            <BenchmarkTab report={benchmarkReport} />
          ) : activeTab === "ai" ? (
            <AIAnalysisTab
              fen={gamePosition}
              isBotThinking={isBotThinking}
              lastBotMove={lastBotMove}
              emotion={emotion}
            />
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
                  The board has morphed into a full 3D studio where you and
                  Sentio AI sit face-to-face.
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
                        Click a piece and a green square, or use fist + hold for
                        2s
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 mt-1 shrink-0" />
                      <span>
                        <strong className="text-zinc-200 light:text-slate-800">
                          Orbit View:
                        </strong>{" "}
                        Right-click & drag canvas to tilt and rotate camera
                        angle
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
                        Palm to aim · Fist to grab · Hold still over a green
                        square for 2s to place · Palm to release
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
          </div>
        ) : (
          <div className="controller-rail mt-4 flex flex-1 flex-col items-center gap-3 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 [writing-mode:vertical-rl] light:text-slate-500">Controller</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" title={statusMessage} />
          </div>
        )}
      </aside>

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

      {(activeTab === "3d" || activeTab === "replay") && (
        <div className="fixed inset-0 z-50">
          <Simulation3D
            chessRef={chessRef}
            gamePosition={gamePosition}
            theme={theme}
            onMoveExecuted={() => {
              const nextFen = chessRef.current.fen();
              setGamePosition(nextFen);
              setSelectedSquare(null);
              setLegalMoveSquares([]);
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
