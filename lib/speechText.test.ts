import { describe, expect, it } from "vitest";
import { toSpeechText } from "./speechText";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("toSpeechText", () => {
  it("removes FEN labels and FEN strings", () => {
    const input = `**အခြေအနေ အကျဉ်းချုပ်**\nFEN: \`${START_FEN}\`\nအဖြစ်အပျက်မှာ အဖြူက အခွင့်အလမ်း ၂၀ လုံးရှိပြီး။`;
    const result = toSpeechText(input);
    expect(result).not.toContain("rnbqkbnr");
    expect(result).not.toContain("FEN");
    expect(result).toContain("အဖြူက အခွင့်အလမ်း ၂၀ လုံးရှိပြီး။");
  });

  it("removes a bare FEN even without a label", () => {
    const result = toSpeechText(`Position ${START_FEN} is quiet.`);
    expect(result).toBe("Position is quiet.");
  });

  it("strips bold, headers and list markers while keeping words", () => {
    const input = "**အကဲဖြတ်**\n- **a3** – အကောင်းဆုံးရွေးချယ်မှုဖြစ်သည်\n1. first item";
    const result = toSpeechText(input);
    expect(result).not.toContain("**");
    expect(result).not.toContain("- ");
    expect(result).not.toMatch(/^\d+\./m);
    expect(result).toContain("အကဲဖြတ်");
    expect(result).toContain("a3 – အကောင်းဆုံးရွေးချယ်မှုဖြစ်သည်");
    expect(result).toContain("first item");
  });

  it("drops code fences but keeps inline code contents", () => {
    const input = "Use \`a3\` here.\n```\nrnbq.../8/8 w - - 0 1\n```";
    const result = toSpeechText(input);
    expect(result).not.toContain("`");
    expect(result).toContain("Use a3 here.");
  });

  it("flattens markdown tables into readable phrases", () => {
    const input = "| အချက် | မေးခွန်း |\n|------|----------|\n| ၁ | ဘာဖြစ်လဲ |";
    const result = toSpeechText(input);
    expect(result).not.toContain("|");
    expect(result).not.toContain("---");
    expect(result).toContain("အချက်");
    expect(result).toContain("ဘာဖြစ်လဲ");
  });

  it("keeps plain Burmese text untouched", () => {
    const input = "ဒီချေနဲ့ မပြလို့ရှု့တယ်နော်";
    expect(toSpeechText(input)).toBe(input);
  });

  it("returns an empty string for whitespace-only or empty input", () => {
    expect(toSpeechText("")).toBe("");
    expect(toSpeechText("   \n  ")).toBe("");
  });
});
