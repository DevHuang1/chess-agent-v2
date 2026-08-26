/**
 * Sentio's coach module provides natural-language chess coaching.
 *
 * It operates in several modes. The fallback mode is always active and requires no
 * external dependencies. When the frontend sends a POST request with a FEN,
 * emotion, optional question, and mode, the coach first parses the position using
 * chess.js to determine whose turn it is, whether the king is in check, how
 * many legal moves exist, and whether the game is over. It then fetches
 * Stockfish's best move from the Python backend and generates structured
 * advice tailored to the position type (forcing vs. flexible) and the
 * player's emotional state. The result is a message with candidate move
 * suggestions and a bestMove (uci + san) the frontend can play with its
 * coach hand animation.
 *
 * The LLM modes augment this with a large language model. The "groq" mode
 * (default) calls the Groq cloud API using GROQ_API_KEY; the "llm" mode calls
 * a local model served by LM Studio when COACH_LLM_ENABLED is true. When the
 * selected provider is reachable, the coach constructs a detailed prompt
 * containing the FEN, emotion history, side to move, legal move count,
 * candidate moves, and the user's question, then sends it to the provider's
 * /chat/completions endpoint. The system prompt changes based on query
 * classification: if the user's input contains no chess keywords and isn't a
 * move notation like "e4", the LLM ignores chess context entirely and acts as
 * a general assistant. Otherwise it acts as an empathetic chess tutor. On
 * failure (provider unreachable, timeout, malformed response), it falls back
 * cleanly to the fallback reply with an error note.
 *
 * The health-check endpoint (GET /api/coach) is polled by the frontend
 * every 10 seconds to display the LLM connection status in the UI.
 */

import { Chess } from "chess.js";
import { NextResponse } from "next/server";
import { buildCoachPrompt } from "@/lib/coachPrompt";

type CoachRequest = {
  fen: string;
  emotion?: string;
  recentEmotions?: string[];
  question?: string;
  mode?: string;
  /**
   * Desired coach reply language. Backward compatible: when absent, behaviour
   * is unchanged (English coaching). "my" asks the provider to answer in
   * natural Burmese Unicode while preserving chess notation and FEN values.
   */
  responseLanguage?: "en" | "my";
  /**
   * Language of the user's question. "my" is sent by the Voice Coach flow and
   * is a strong signal that this is a chess-coaching request even though the
   * English keyword classifier may not match Burmese text.
   */
  inputLanguage?: "en" | "my";
  /**
   * Origin of the request. "voice-coach" bypasses the English-only general
   * query heuristic so Burmese voice questions keep full chess context.
   */
  source?: "typed" | "voice-coach";
};

type CoachMeta = {
  emotion: string;
  sideToMove: string;
  legalMoveCount: number;
  inCheck: boolean;
  gameOver: boolean;
};

type CoachReply = {
  message: string;
  suggestions: string[];
  bestMove?: { uci: string; san: string } | null;
  meta: CoachMeta;
};

type CoachHealth = {
  enabled: boolean;
  connected: boolean;
  detail: string;
  model: string;
  baseUrl: string;
  groq: {
    available: boolean;
    detail: string;
    model: string;
  };
};

type LlmProvider = {
  baseUrl: string;
  apiKey?: string;
  model: string;
};

type LlmChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

const EMOTION_ENCOURAGEMENT: Record<string, string> = {
  confident:
    "They are feeling confident. Acknowledge their form and keep them sharp.",
  focused:
    "They are concentrated. Encourage precision and remind them to stay calm under pressure.",
  neutral: "They are composed. Keep the advice clear and tactical.",
  calm: "They are relaxed. Reinforce good habits and keep them engaged.",
  frustrated:
    "They seem frustrated. Be kind and encouraging. Tell them they are doing well and not to give up.",
  stressed:
    "They appear stressed or anxious. Be warm and supportive. Remind them to breathe and trust their instincts.",
};

const COACH_LLM_ENABLED = process.env.COACH_LLM_ENABLED === "true";
const COACH_LLM_BASE_URL =
  process.env.COACH_LLM_BASE_URL ?? "http://127.0.0.1:1234/v1";
const COACH_LLM_MODEL = process.env.COACH_LLM_MODEL ?? "qwen2.5-7b-instruct";
const COACH_LLM_API_KEY = process.env.COACH_LLM_API_KEY;

const COACH_GROQ_API_KEY = process.env.GROQ_API_KEY;
const COACH_GROQ_BASE_URL =
  process.env.COACH_GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
const COACH_GROQ_MODEL =
  process.env.COACH_GROQ_MODEL ?? "openai/gpt-oss-120b";

function getAuthHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildFallbackReply(
  emotion: string,
  sideToMove: string,
  inCheck: boolean,
  gameOver: boolean,
  legalMoves: ReturnType<Chess["moves"]>,
  question?: string,
  bestMove?: { uci: string; san: string } | null,
  responseLanguage?: CoachRequest["responseLanguage"],
): CoachReply {
  const primaryAdvice = gameOver
    ? "Game over reached. Review critical turning points and missed tactics."
    : inCheck
      ? `${sideToMove} is in check. First find all legal escapes, then choose the safest continuation.`
      : legalMoves.length <= 8
        ? `Position is forcing (${legalMoves.length} legal moves). Calculate concrete lines before moving.`
        : `Position is flexible (${legalMoves.length} legal moves). Improve your worst-placed piece.`;

  const candidateMoves = legalMoves.slice(0, 3).map((move) => move.san);
  const encouragement =
    EMOTION_ENCOURAGEMENT[emotion] ?? EMOTION_ENCOURAGEMENT.neutral;
  const questionSuffix =
    question && question.trim()
      ? `You asked: "${question.trim()}". Focus answer: evaluate king safety, loose pieces, and checks-captures-threats.`
      : "Tip: before each move, scan checks, captures, and threats for both sides.";

  // In Burmese mode the LLM stream (when reachable) returns a full Burmese reply.
  // This rule-based fallback stays in English but notes the mode in Burmese so
  // the player still understands why the text is not in Burmese.
  const burmeseNote =
    responseLanguage === "my"
      ? "\n\n(စက်ဖြင့်ဘာသာပြန်သင်ကြားမှု မရရှိနိုင်ပါ — အင်္ဂလိပ်ဖြင့် အကြံပြုချက် ဖော်ပြပေးထားပါသည်။)"
      : "";

  return {
    message: `${encouragement} ${primaryAdvice} ${questionSuffix}${burmeseNote}`,
    suggestions: candidateMoves.map(
      (san, index) => `Candidate ${index + 1}: ${san}`,
    ),
    bestMove,
    meta: {
      emotion,
      sideToMove,
      legalMoveCount: legalMoves.length,
      inCheck,
      gameOver,
    },
  };
}

async function fetchStockfishBestMove(
  fen: string,
  emotion: string,
): Promise<{ uci: string; san: string } | null> {
  const BOT_MOVE_API_URL =
    process.env.BOT_MOVE_API_URL ?? "http://127.0.0.1:8000/api/bot-move";
  try {
    const response = await fetch(BOT_MOVE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, emotion }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { botMove?: string | null };
    if (!data.botMove) return null;
    const chess = new Chess(fen);
    const move = chess.move(data.botMove.toLowerCase());
    if (!move) return null;
    return { uci: data.botMove.toLowerCase(), san: move.san };
  } catch {
    return null;
  }
}
const HEALTH_CACHE_TTL_MS = 30_000;
let healthCache: { value: CoachHealth; expiresAt: number } | null = null;

async function generateProviderMessage(
  payload: CoachRequest,
  fallback: CoachReply,
  provider: LlmProvider,
): Promise<string> {
  const { isGeneral, systemContent, userContent } = buildCoachPrompt(
    payload,
    fallback,
  );

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(provider.apiKey),
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: isGeneral ? 0.7 : 0.35,
      // Reasoning models (e.g. openai/gpt-oss-*) spend completion tokens on
      // hidden reasoning BEFORE the visible answer, so the budget must be much
      // larger than the answer alone, and reasoning_effort is minimized.
      max_tokens: isGeneral ? 2000 : 1500,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
    cache: "no-store",
    // Bound the LLM call so a hung provider can't stall the request forever.
    signal: AbortSignal.timeout(30_000),
  });

  const rawBody = await response.text();
  let parsedBody: LlmChatCompletionResponse;

  try {
    parsedBody = JSON.parse(rawBody) as LlmChatCompletionResponse;
  } catch {
    throw new Error("LLM provider returned invalid JSON.");
  }

  if (!response.ok) {
    throw new Error(
      parsedBody.error?.message ??
        `LLM request failed with status ${response.status}.`,
    );
  }

  const message = parsedBody.choices?.[0]?.message;
  const content = message?.content?.trim();
  if (content) return content;

  const reasoningContent = message?.reasoning_content?.trim();
  if (reasoningContent) {
    throw new Error(
      "Model returned reasoning-only output. In LM Studio, disable thinking mode for this model preset.",
    );
  }

  throw new Error("LLM provider returned an empty response.");
}

async function getGroqHealth(): Promise<CoachHealth["groq"]> {
  if (!COACH_GROQ_API_KEY) {
    return {
      available: false,
      detail: "Groq mode requires GROQ_API_KEY to be set.",
      model: COACH_GROQ_MODEL,
    };
  }
  try {
    const response = await fetch(`${COACH_GROQ_BASE_URL}/models`, {
      method: "GET",
      headers: {
        ...getAuthHeaders(COACH_GROQ_API_KEY),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      return {
        available: false,
        detail: `Groq health check failed with status ${response.status}.`,
        model: COACH_GROQ_MODEL,
      };
    }
    return {
      available: true,
      detail: "Groq reachable.",
      model: COACH_GROQ_MODEL,
    };
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : "Could not reach Groq.",
      model: COACH_GROQ_MODEL,
    };
  }
}

async function getCoachHealth(): Promise<CoachHealth> {
  if (!COACH_LLM_ENABLED) {
    return {
      enabled: false,
      connected: false,
      detail: "LLM coach is disabled by configuration.",
      model: COACH_LLM_MODEL,
      baseUrl: COACH_LLM_BASE_URL,
      groq: await getGroqHealth(),
    };
  }

  try {
    const response = await fetch(`${COACH_LLM_BASE_URL}/models`, {
      method: "GET",
      headers: {
        ...getAuthHeaders(COACH_LLM_API_KEY),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return {
        enabled: true,
        connected: false,
        detail: `LM Studio health check failed with status ${response.status}.`,
        model: COACH_LLM_MODEL,
        baseUrl: COACH_LLM_BASE_URL,
        groq: await getGroqHealth(),
      };
    }

    return {
      enabled: true,
      connected: true,
      detail: "LM Studio reachable.",
      model: COACH_LLM_MODEL,
      baseUrl: COACH_LLM_BASE_URL,
      groq: await getGroqHealth(),
    };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      detail:
        error instanceof Error ? error.message : "Could not reach LM Studio.",
      model: COACH_LLM_MODEL,
      baseUrl: COACH_LLM_BASE_URL,
      groq: await getGroqHealth(),
    };
  }
}

export async function GET() {
  // Cache health results briefly: every open client tab polls this endpoint
  // every 10s, and each uncached check hits the Groq /models API. Caching
  // avoids burning through provider rate limits.
  const now = Date.now();
  if (healthCache && now < healthCache.expiresAt) {
    return NextResponse.json(healthCache.value);
  }
  const health = await getCoachHealth();
  healthCache = { value: health, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS };
  return NextResponse.json(health);
}

export async function POST(request: Request) {
  let payload: CoachRequest;

  try {
    payload = (await request.json()) as CoachRequest;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  if (!payload?.fen || typeof payload.fen !== "string") {
    return NextResponse.json(
      { detail: "Request body must include a valid fen string." },
      { status: 400 },
    );
  }

  const emotion = (payload.emotion ?? "neutral").trim().toLowerCase();

  let chess: Chess;
  try {
    chess = new Chess(payload.fen);
  } catch {
    return NextResponse.json(
      { detail: "Invalid FEN position." },
      { status: 400 },
    );
  }

  const legalMoves = chess.moves({ verbose: true });
  const sideToMove = chess.turn() === "w" ? "White" : "Black";
  const inCheck = chess.inCheck();
  const gameOver = chess.isGameOver();

  const stockfishBestMove = gameOver
    ? null
    : await fetchStockfishBestMove(payload.fen, emotion);

  const fallback = buildFallbackReply(
    emotion,
    sideToMove,
    inCheck,
    gameOver,
    legalMoves,
    payload.question,
    stockfishBestMove,
    payload.responseLanguage,
  );

  const mode = (payload.mode ?? "groq").toLowerCase();

  if (mode === "groq") {
    if (!COACH_GROQ_API_KEY) {
      return NextResponse.json({
        ...fallback,
        message: `${fallback.message}\n\n(Groq mode not configured — add GROQ_API_KEY. Standard mode active.)`,
      });
    }
    try {
      const message = await generateProviderMessage(payload, fallback, {
        baseUrl: COACH_GROQ_BASE_URL,
        apiKey: COACH_GROQ_API_KEY,
        model: COACH_GROQ_MODEL,
      });
      return NextResponse.json({ ...fallback, message });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Failed to query Groq.";
      return NextResponse.json({
        ...fallback,
        message: `${fallback.message}\n\n(Groq fallback active: ${detail})`,
      });
    }
  }

  if (!COACH_LLM_ENABLED) {
    return NextResponse.json(fallback);
  }

  try {
    const message = await generateProviderMessage(payload, fallback, {
      baseUrl: COACH_LLM_BASE_URL,
      apiKey: COACH_LLM_API_KEY,
      model: COACH_LLM_MODEL,
    });
    return NextResponse.json({
      ...fallback,
      message,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to query LM Studio.";
    return NextResponse.json({
      ...fallback,
      message: `${fallback.message}\n\n(LLM fallback active: ${detail})`,
    });
  }
}
