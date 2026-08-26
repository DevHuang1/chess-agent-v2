import { describe, expect, it } from "vitest";
import {
  BURMESE_RESPONSE_INSTRUCTION,
  buildCoachPrompt,
  isGeneralQuery,
  type CoachPromptFallback,
} from "./coachPrompt";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const fallback: CoachPromptFallback = {
  meta: {
    emotion: "neutral",
    sideToMove: "White",
    legalMoveCount: 20,
    inCheck: false,
    gameOver: false,
  },
  suggestions: ["e4", "d4", "Nf3"],
};

describe("coach prompt - Burmese response contract", () => {
  it("accepts responseLanguage 'my' without throwing", () => {
    const prompt = buildCoachPrompt(
      {
        fen: START_FEN,
        question: "ဒီအခြေအနေမှာ ဘယ်လိုရွှေ့သင့်လဲ",
        responseLanguage: "my",
      },
      fallback,
    );
    expect(prompt.isGeneral).toBe(false);
    expect(prompt.userContent).toBeTruthy();
  });

  it("injects the Burmese-language instruction when responseLanguage is 'my'", () => {
    const prompt = buildCoachPrompt(
      { fen: START_FEN, question: "ဘာလုပ်ရမလဲ", responseLanguage: "my" },
      fallback,
    );
    expect(prompt.userContent).toContain("Respond in natural Burmese Unicode");
    expect(prompt.userContent).toContain("empathetic chess coach");
  });

  it("preserves the FEN and chess context in the prompt", () => {
    const prompt = buildCoachPrompt(
      {
        fen: START_FEN,
        question: "ဒီဘုတ်ကဘယ်လိုလဲ",
        recentEmotions: ["neutral", "focused"],
        responseLanguage: "my",
      },
      fallback,
    );
    expect(prompt.userContent).toContain(`FEN: ${START_FEN}`);
    expect(prompt.userContent).toContain("Legal move count: 20");
    expect(prompt.userContent).toContain("Candidate moves: e4, d4, Nf3");
    expect(prompt.userContent).toContain(
      "Recent emotions (last 15s): neutral, focused",
    );
    expect(prompt.userContent).toContain("Question:");
  });

  it("keeps chess notation readable in the Burmese instruction", () => {
    expect(BURMESE_RESPONSE_INSTRUCTION).toMatch(/e4|Nf3|O-O|Qxd5/);
    expect(BURMESE_RESPONSE_INSTRUCTION).not.toMatch(
      /chain-of-thought output/,
    );
  });
});

describe("voice-coach classification", () => {
  it("treats voice-coach submissions as chess even with no English keywords", () => {
    const prompt = buildCoachPrompt(
      {
        fen: START_FEN,
        question: "ဘယ်လိုရွှေ့မလဲ",
        source: "voice-coach",
        inputLanguage: "my",
        responseLanguage: "my",
      },
      fallback,
    );
    expect(prompt.isGeneral).toBe(false);
    expect(prompt.systemContent).toContain("chess coach");
  });

  it("respects the explicit voice-coach and inputLanguage flags", () => {
    expect(
      isGeneralQuery("no chess words at all", { source: "voice-coach" }),
    ).toBe(false);
    expect(
      isGeneralQuery("no chess words at all", { inputLanguage: "my" }),
    ).toBe(false);
  });

  it("treats a Burmese chess keyword as chess even without explicit flags", () => {
    expect(isGeneralQuery("ဘုရင်ကို ဘယ်လိုရွှေ့မလဲ")).toBe(false);
    expect(isGeneralQuery("မြင်းဆီကို ဖမ်း")).toBe(false);
  });
});

describe("backward compatibility (typed English coaching unchanged)", () => {
  it("keeps classifying general English chat as general", () => {
    expect(isGeneralQuery("hello there")).toBe(true);
    expect(isGeneralQuery("what's the weather")).toBe(true);
  });

  it("keeps English chess queries as chess coaching", () => {
    expect(isGeneralQuery("what should I move from the e4 position")).toBe(
      false,
    );
    expect(isGeneralQuery("is my king in check")).toBe(false);
  });

  it("defaults to chess coaching when no question is supplied", () => {
    const prompt = buildCoachPrompt({ fen: START_FEN }, fallback);
    expect(prompt.isGeneral).toBe(false);
    expect(prompt.userContent).toContain("Give me the best coaching advice");
  });
});