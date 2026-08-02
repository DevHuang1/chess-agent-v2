import { Chess } from "chess.js";
import { NextResponse } from "next/server";

const BACKEND_BOT_MOVE_API_URL = process.env.BOT_MOVE_API_URL;

type MoveRequest = {
  fen: string;
  emotion?: string;
  strengthPreference?: "adaptive" | "gentle" | "challenging";
};

type Profile = {
  depth: number;
  skillLevel: number;
  elo: number;
};

const EMOTION_STRENGTH_PROFILES: Record<string, Profile> = {
  stressed: { depth: 1, skillLevel: 1, elo: 1320 },
  frustrated: { depth: 2, skillLevel: 3, elo: 1320 },
  calm: { depth: 4, skillLevel: 6, elo: 1500 },
  neutral: { depth: 6, skillLevel: 10, elo: 1700 },
  focused: { depth: 8, skillLevel: 15, elo: 2700 },
  confident: { depth: 10, skillLevel: 20, elo: 3190 },
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
      const centerBonus = (3.5 - Math.abs(r - 3.5)) * 5 + (3.5 - Math.abs(c - 3.5)) * 5;
      const totalVal = val + centerBonus;
      score += piece.color === "w" ? totalVal : -totalVal;
    }
  }
  return score;
}

function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean
): number {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateBoard(chess);
  }

  const moves = chess.moves({ verbose: true });
  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const evalVal = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      maxEval = Math.max(maxEval, evalVal);
      alpha = Math.max(alpha, evalVal);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      chess.move(move);
      const evalVal = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      minEval = Math.min(minEval, evalVal);
      beta = Math.min(beta, evalVal);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function calculateJsBotMove(fen: string, emotion: string): { botMove: string | null; engineProfile: Profile & { emotion: string }; status?: string } {
  const normEmotion = EMOTION_STRENGTH_PROFILES[emotion.toLowerCase()] ? emotion.toLowerCase() : "neutral";
  const profile = EMOTION_STRENGTH_PROFILES[normEmotion];
  
  const chess = new Chess(fen);
  if (chess.isGameOver()) {
    return {
      botMove: null,
      status: "Checkmate or Draw",
      engineProfile: { emotion: normEmotion, ...profile },
    };
  }

  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return {
      botMove: null,
      status: "Checkmate or Draw",
      engineProfile: { emotion: normEmotion, ...profile },
    };
  }

  const isBlack = chess.turn() === "b";
  const searchDepth = Math.min(3, Math.max(1, Math.floor(profile.depth / 2)));
  
  const blunderProbability = ((20 - profile.skillLevel) / 20) * 0.45; 
  if (Math.random() < blunderProbability) {
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    const uci = randomMove.from + randomMove.to + (randomMove.promotion || "");
    return {
      botMove: uci,
      engineProfile: { emotion: normEmotion, ...profile },
    };
  }

  let bestMove = moves[0];
  let bestScore = isBlack ? Infinity : -Infinity;

  for (const move of moves) {
    chess.move(move);
    const score = minimax(chess, searchDepth - 1, -Infinity, Infinity, !isBlack);
    chess.undo();

    if (isBlack ? score < bestScore : score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  const uciMove = bestMove.from + bestMove.to + (bestMove.promotion || "");
  return {
    botMove: uciMove,
    engineProfile: { emotion: normEmotion, ...profile },
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
  const strengthPreference =
    payload.strengthPreference === "gentle" ||
    payload.strengthPreference === "challenging"
      ? payload.strengthPreference
      : "adaptive";

  if (BACKEND_BOT_MOVE_API_URL) {
    try {
      const backendResponse = await fetch(BACKEND_BOT_MOVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: payload.fen,
          emotion,
          strengthPreference,
        }),
        cache: "no-store",
      });

      if (backendResponse.ok) {
        const parsedBody = await backendResponse.json();
        return NextResponse.json(parsedBody, { status: 200 });
      }
    } catch {
      // Fall through to in-memory JS chess engine
    }
  }

  const result = calculateJsBotMove(payload.fen, emotion);
  return NextResponse.json(result, { status: 200 });
}
