/**
 * Pure coach-prompt helpers shared by the /api/coach route and its unit tests.
 *
 * Keeping this logic outside the route file lets vitest exercise the Burmese
 * classification and prompt-building without loading next/server.
 */

export type CoachResponseLanguage = "en" | "my";
export type CoachSource = "typed" | "voice-coach";

export type CoachPromptRequest = {
  fen: string;
  question?: string;
  recentEmotions?: string[];
  responseLanguage?: CoachResponseLanguage;
  inputLanguage?: "en" | "my";
  source?: CoachSource;
};

export type CoachPromptFallback = {
  meta: {
    emotion: string;
    sideToMove: string;
    legalMoveCount: number;
    inCheck: boolean;
    gameOver: boolean;
  };
  suggestions: string[];
};

/**
 * When responseLanguage === "my", this instruction is appended to the coach
 * prompt. It asks the model to answer in natural Burmese Unicode while keeping
 * chess notation and FEN values byte-for-byte unchanged, so the on-screen text
 * stays understandable together with the spoken audio.
 */
export const BURMESE_RESPONSE_INSTRUCTION = `Respond in natural Burmese Unicode. You are an empathetic chess coach.
Explain the position clearly and practically. Keep chess notation, square names,
move notation, FEN values, and engine suggestions unchanged (e.g. e4, Nf3, O-O,
Qxd5). If the player is frustrated or stressed, be warm and encouraging. Do not
output hidden reasoning or chain-of-thought. Give a short evaluation, the best
practical plan, and one tactical warning. Do not translate chess notation into an
ambiguous phonetic form in the response.`;

/**
 * A small, carefully scoped set of Burmese chess terms. This is a secondary
 * signal only — the explicit `source` / `inputLanguage` mechanism is primary.
 * It prevents Burmese questions that happen to name a piece or a move from being
 * misclassified as general chat when the caller omits the explicit flags.
 * Only terms already used by lib/speechParser.ts are included to avoid guessing.
 */
export const BURMESE_CHESS_TERMS = [
  "ဘုရင်", // king
  "မိဖုရား", // queen
  "မိဗျား", // queen (alternate)
  "ကျီ", // rook / castle
  "လှေ", // rook
  "ဆင်", // bishop
  "မြင်း", // knight
  "နိုင်", // pawn
  "စစ်သား", // pawn
  "ဖမ်း", // capture / takes
];

const ENGLISH_CHESS_KEYWORDS = [
  "move",
  "fen",
  "check",
  "mate",
  "castle",
  "tactic",
  "line",
  "plan",
  "pawn",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
  "board",
  "position",
  "square",
  "capture",
  "attack",
  "defend",
  "win",
  "lose",
  "blunder",
  "threat",
  "play",
  "game",
  "white",
  "black",
  "evaluation",
  "pieces",
  "fork",
  "pin",
  "opening",
  "gambit",
  "endgame",
  "stockfish",
  "analyze",
  "what now",
];

export function isGeneralQuery(
  question?: string,
  opts?: {
    source?: CoachSource;
    inputLanguage?: "en" | "my";
    responseLanguage?: CoachResponseLanguage;
  },
): boolean {
  if (!question || !question.trim()) return false;

  // A Voice Coach submission is, by definition, a chess-coaching request: the
  // caller routes it through the chess coach and supplies current position
  // context. Relying on the English keyword classifier here would misclassify
  // Burmese questions that happen to contain no English chess terms. The same
  // applies when the user explicitly requests a Burmese reply — that field is
  // itself a primary chess-coaching signal.
  if (
    opts?.source === "voice-coach" ||
    opts?.inputLanguage === "my" ||
    opts?.responseLanguage === "my"
  ) {
    return false;
  }

  const lowerQuestion = question.toLowerCase().trim();

  const hasChessKeywords = ENGLISH_CHESS_KEYWORDS.some((keyword) =>
    lowerQuestion.includes(keyword),
  );

  // Regex to catch raw algebraic chess moves typed alone (e.g. "e4", "Nf3", "O-O", "exd5").
  const chessMoveRegex =
    /^[a-h][1-8]$|^[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?$|^O-O(-O)?$/i;
  const isRawMove = chessMoveRegex.test(lowerQuestion);

  // Scoped Burmese chess vocabulary (secondary signal).
  const hasBurmeseChessTerms = BURMESE_CHESS_TERMS.some((term) =>
    question.includes(term),
  );

  // General chat if it has NO chess keywords AND isn't a move notation AND has
  // no Burmese chess terms.
  return !hasChessKeywords && !isRawMove && !hasBurmeseChessTerms;
}

// __BUILD_PROMPT__

export function buildCoachPrompt(
  payload: CoachPromptRequest,
  fallback: CoachPromptFallback,
): { isGeneral: boolean; systemContent: string; userContent: string } {
  const question = payload.question?.trim();
  const wantsBurmese = payload.responseLanguage === "my";
  const isGeneral = isGeneralQuery(question, {
    source: payload.source,
    inputLanguage: payload.inputLanguage,
    responseLanguage: payload.responseLanguage,
  });

  const systemContent = isGeneral
    ? "You are a helpful, direct, and brilliant AI assistant. Provide a highly accurate and thorough response to the user's question, completely ignoring any ongoing chess gameplay context."
    : "You are Sentio, an empathetic and encouraging chess coach. The user's emotional state is reflected in the emotion field — if they are frustrated or stressed, be warm, supportive, and praise their effort. If they are confident or focused, acknowledge their strength and keep them sharp. Always be encouraging, never harsh. Respond with final coaching only. Do not output hidden reasoning.";

  const userContent = isGeneral
    ? question!
    : [
        `FEN: ${payload.fen}`,
        `Emotion: ${fallback.meta.emotion}`,
        ...(payload.recentEmotions?.length
          ? [`Recent emotions (last 15s): ${payload.recentEmotions.join(", ")}`]
          : []),
        `Side to move: ${fallback.meta.sideToMove}`,
        `In check: ${fallback.meta.inCheck}`,
        `Game over: ${fallback.meta.gameOver}`,
        `Legal move count: ${fallback.meta.legalMoveCount}`,
        `Candidate moves: ${fallback.suggestions.join(", ") || "none"}`,
        `Question: ${question || "Give me the best coaching advice for this position."}`,
        wantsBurmese
          ? BURMESE_RESPONSE_INSTRUCTION
          : "Respond in plain language with: 1) quick evaluation 2) best practical plan 3) one concrete tactical warning.",
      ].join("\n");

  return { isGeneral, systemContent, userContent };
}