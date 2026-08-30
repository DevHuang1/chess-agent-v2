import { Chess } from "chess.js";
import { NextResponse } from "next/server";
import { EMOTION_PROFILES, normalizeEmotion } from "@/lib/engineProfiles";
import { buildMinimaxTrace } from "@/lib/minimax";
import type { EngineDiagnostics } from "@/lib/gameTypes";

const BACKEND_BOT_MOVE_API_URL = process.env.BOT_MOVE_API_URL;

type MoveRequest = {
  fen: string;
  emotion?: string;
  /** "play" (default) uses the adaptive emotion profile; "hint" always uses maximum strength. */
  purpose?: "play" | "hint";
};

type Profile = {
  depth: number;
  skillLevel: number;
  elo: number;
  moveQuality?: string;
};

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

function evaluateBoard(chess: Chess): number {
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const val = PIECE_VALUES[piece.type] || 0;
      const centerBonus =
        (3.5 - Math.abs(r - 3.5)) * 5 + (3.5 - Math.abs(c - 3.5)) * 5;
      const totalVal = val + centerBonus;
      score += piece.color === "w" ? totalVal : -totalVal;
    }
  }
  return score;
}

/**
 * Classify how a move changed the mover's position.
 *
 * Positive scoreDelta always means the position improved for White and
 * worsened for Black (evaluateBoard is from White's perspective).
 */
function classifyMoveQuality(scoreDelta: number, isBlack: boolean): string {
  if (isBlack) {
    // Black wants the score to go down.
    if (scoreDelta <= -20) return "Excellent";
    if (scoreDelta <= 0) return "Good";
    if (scoreDelta <= 20) return "Mistake";
    return "Blunder";
  }
  // White wants the score to go up.
  if (scoreDelta >= 20) return "Excellent";
  if (scoreDelta >= 0) return "Good";
  if (scoreDelta >= -20) return "Mistake";
  return "Blunder";
}

function jsDiagnostics(
  emotion: string,
  requestedDepth: number,
  startedAt: number,
): EngineDiagnostics {
  return {
    engineId: "sentio-js",
    engineName: "Sentio (JS minimax)",
    algorithm: "minimax",
    requestedDepth,
    totalLatencyMs: performance.now() - startedAt,
    cacheHit: false,
    fallbackUsed: true,
  };
}

function calculateJsBotMove(
  fen: string,
  emotion: string,
  purpose: "play" | "hint" = "play",
): {
  botMove: string | null;
  engineProfile: Profile & { emotion: string };
  status?: string;
  diagnostics?: EngineDiagnostics;
} {
  const normEmotion = normalizeEmotion(emotion);
  const startedAt = performance.now();
  // Hints ignore the adaptive profile and use the strongest settings.
  const profile =
    purpose === "hint"
      ? { depth: 6, skillLevel: 20, elo: 3190 }
      : EMOTION_PROFILES[normEmotion];

  const chess = new Chess(fen);
  if (chess.isGameOver() || chess.moves({ verbose: true }).length === 0) {
    return {
      botMove: null,
      status: "Checkmate or Draw",
      engineProfile: { emotion: normEmotion, ...profile },
      diagnostics: jsDiagnostics(normEmotion, profile.depth, startedAt),
    };
  }

  const moves = chess.moves({ verbose: true });
  const isBlack = chess.turn() === "b";
  const searchDepth = Math.min(3, Math.max(1, Math.floor(profile.depth / 2)));

  // Hints must never blunder on purpose.
  const blunderProbability =
    purpose === "hint" ? 0 : ((20 - profile.skillLevel) / 20) * 0.45;
  if (Math.random() < blunderProbability) {
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    const uci = randomMove.from + randomMove.to + (randomMove.promotion || "");
    return {
      botMove: uci,
      engineProfile: { emotion: normEmotion, ...profile },
      diagnostics: jsDiagnostics(normEmotion, profile.depth, startedAt),
    };
  }

  // Reuse the full search implementation from lib/minimax.ts (transposition
  // table, killer moves, history heuristic, move ordering) instead of a
  // separate naive minimax.
  const searchStartedAt = performance.now();
  const trace = buildMinimaxTrace(fen, {
    depth: searchDepth,
    branchLimit: 5,
    aiColor: chess.turn(),
  });
  const searchTimeMs = performance.now() - searchStartedAt;

  let botMove: string | null = trace.selectedMove
    ? trace.selectedMove.uci
    : null;

  if (!botMove) {
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    botMove = randomMove.from + randomMove.to + (randomMove.promotion || "");
  }

  // Score the chosen move to attach a quality label.
  const currentScore = evaluateBoard(chess);
  let scoreAfter = currentScore;
  try {
    const applied = chess.move(botMove);
    if (applied) {
      scoreAfter = evaluateBoard(chess);
      chess.undo();
    }
  } catch {
    // Move already validated by the search; keep currentScore on failure.
  }

  return {
    botMove,
    engineProfile: {
      emotion: normEmotion,
      ...profile,
      moveQuality: classifyMoveQuality(scoreAfter - currentScore, isBlack),
    },
    diagnostics: {
      engineId: "sentio-js",
      engineName: "Sentio (JS minimax)",
      algorithm: "minimax",
      requestedDepth: searchDepth,
      completedDepth: trace.nodes?.length ? searchDepth : undefined,
      searchTimeMs,
      totalLatencyMs: performance.now() - startedAt,
      nodesVisited: trace.nodes?.length,
      cacheHit: false,
    },
  };
}

export async function POST(request: Request) {
  let payload: MoveRequest;

  try {
    payload = (await request.json()) as MoveRequest;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  if (!payload?.fen || typeof payload.fen !== "string") {
    return NextResponse.json(
      { detail: "Request body must include a valid fen string." },
      { status: 400 },
    );
  }

  const emotion =
    typeof payload.emotion === "string" ? payload.emotion : "neutral";
  const purpose = payload.purpose === "hint" ? "hint" : "play";

  if (BACKEND_BOT_MOVE_API_URL) {
    try {
      const backendResponse = await fetch(BACKEND_BOT_MOVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: payload.fen, emotion, purpose }),
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      });

      if (backendResponse.ok) {
        const parsedBody = await backendResponse.json();
        return NextResponse.json(parsedBody, { status: 200 });
      }
    } catch {
      // Fall through to in-memory JS chess engine
    }
  }

  const result = calculateJsBotMove(payload.fen, emotion, purpose);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fen = searchParams.get("fen");
  const depthParam = Number.parseInt(searchParams.get("depth") ?? "", 10);

  if (!fen || typeof fen !== "string") {
    return NextResponse.json(
      { detail: "Query parameter 'fen' is required." },
      { status: 400 },
    );
  }

  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return NextResponse.json(
      { detail: "Invalid FEN position." },
      { status: 400 },
    );
  }

  const isBlack = chess.turn() === "b";

  if (chess.isGameOver()) {
    // Terminal positions get a decisive evaluation from White's perspective.
    const terminalEval = chess.isCheckmate()
      ? chess.turn() === "w"
        ? -100_000
        : 100_000
      : 0;
    return NextResponse.json(
      { evaluation: terminalEval, isBlack, gameOver: true },
      { status: 200 },
    );
  }

  // Shallow search gives a far more accurate evaluation than raw material.
  // Depth is clamped to keep the request cheap; falls back to material-only
  // if the search yields no move.
  const depth = Number.isFinite(depthParam)
    ? Math.min(4, Math.max(1, depthParam))
    : 2;

  try {
    const trace = buildMinimaxTrace(fen, {
      depth,
      branchLimit: 5,
      aiColor: chess.turn(),
    });

    let evaluation: number;
    if (trace.selectedMove) {
      // Search scores are from the side-to-move's perspective; convert to
      // White's perspective for the eval bar.
      evaluation = isBlack
        ? -trace.selectedMove.score
        : trace.selectedMove.score;
    } else {
      evaluation = evaluateBoard(chess);
    }

    return NextResponse.json({ evaluation, isBlack }, { status: 200 });
  } catch {
    return NextResponse.json(
      { evaluation: evaluateBoard(chess), isBlack },
      { status: 200 },
    );
  }
}
