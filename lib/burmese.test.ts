import { describe, expect, it } from "vitest";
import { hasChessNotationOnly, looksLikeBurmese } from "./burmese";

describe("looksLikeBurmese", () => {
  it("accepts clean Myanmar script output", () => {
    expect(looksLikeBurmese("မြင်း f3 ကို")).toBe(true);
    expect(looksLikeBurmese("ဒီအခြေအနေမှာ ဘယ်လိုရွှေ့သင့်လဲ")).toBe(true);
    expect(looksLikeBurmese(" းေှယ််က််း််််် ")).toBe(true);
  });

  it("accepts short chess tokens with no Myanmar script", () => {
    expect(looksLikeBurmese("O-O")).toBe(true);
    expect(looksLikeBurmese("e4")).toBe(true);
    expect(looksLikeBurmese("Nf3")).toBe(true);
  });

  it("rejects wrong-script hallucination from Burmese misdetection", () => {
    expect(looksLikeBurmese("ทีชีนี่มาบลูชวิติลี")).toBe(false); // Thai
    expect(looksLikeBurmese("तिची निमा बलुश्वे ते ले")).toBe(false); // Devanagari
    expect(looksLikeBurmese("澳三素及")).toBe(false); // Han
    expect(looksLikeBurmese("He left three.")).toBe(false); // English
    expect(looksLikeBurmese("")).toBe(false);
  });

  it("rejects replacement-character soup", () => {
    expect(looksLikeBurmese("�\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD")).toBe(
      false,
    );
    expect(looksLikeBurmese("မင်း�း��်က်က်��်��််က�")).toBe(false);
  });

  it("rejects English chess words on a Burmese-labeled flow", () => {
    expect(looksLikeBurmese("knight f3")).toBe(false);
  });
});

describe("hasChessNotationOnly", () => {
  it("matches castling and algebraic moves", () => {
    expect(hasChessNotationOnly("O-O")).toBe(true);
    expect(hasChessNotationOnly("O-O-O")).toBe(true);
    expect(hasChessNotationOnly("e4")).toBe(true);
    expect(hasChessNotationOnly("Nf3")).toBe(true);
    expect(hasChessNotationOnly("Qxd5")).toBe(true);
    expect(hasChessNotationOnly("exd5")).toBe(true);
  });

  it("rejects prose", () => {
    expect(hasChessNotationOnly("knight to f3")).toBe(false);
    expect(hasChessNotationOnly("what should I play")).toBe(false);
  });
});