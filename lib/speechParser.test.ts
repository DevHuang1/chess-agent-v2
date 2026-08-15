import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { parseChessMove } from "./speechParser";

function parse(text: string, lang = "en", chess = new Chess()) {
  return parseChessMove(text, lang, chess);
}

describe("parseChessMove", () => {
  it("parses a standard English piece move against the live board", () => {
    expect(parse("knight f3")).toBe("Nf3");
  });

  it("parses a pawn destination and compact coordinate notation", () => {
    expect(parse("pawn to e4")).toBe("e4");
    expect(parse("e2e4")).toBe("e2e4");
  });

  it("recognizes explicit and bare castling commands", () => {
    expect(parse("castle kingside")).toBe("O-O");
    expect(parse("queen side castle")).toBe("O-O-O");
  });

  it("parses Burmese piece names and Burmese filler words", () => {
    expect(parse("မြင်း f3 ကို", "my")).toBe("Nf3");
    expect(parse("နိုင် e4 ကို", "my")).toBe("e4");
  });

  it("parses Burmese phonetic file and rank sounds", () => {
    expect(parse("မြင်း အာ့ သူတွေး ကို", "my")).toBe("Nf3");
  });

  it("normalizes Myanmar numerals in spoken squares", () => {
    expect(parse("မြင်း f၃ ကို", "my")).toBe("Nf3");
  });

  it("resolves a Burmese queen capture using the live legal move list", () => {
    const chess = new Chess("4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1");
    expect(parse("မိဖုရား d5 ဖမ်း", "my", chess)).toBe("Qxd5");
  });

  it("prefers the longest Burmese piece alias", () => {
    const chess = new Chess("4k3/8/8/8/8/8/8/4QK2 w - - 0 1");
    expect(parse("ဘုရင်မ e2", "my", chess)).toBe("Qe2+");
  });

  it("does not confuse a spoken file with a rank when the square is explicit", () => {
    const chess = new Chess("4k2r/8/8/8/8/8/8/4K2R w - - 0 1");
    expect(parse("rook h8", "en", chess)).toBe("Rxh8+");
  });

  it("parses romanized Burmese ASR output from sample audio", () => {
    expect(parse("Mie F three ko", "my")).toBe("Nf3");
    expect(parse("Mie F3 Go", "my")).toBe("Nf3");
    expect(parse("Nai y le gu", "my")).toBe("e4");
    expect(parse("O o", "my")).toBe("O-O");
  });

  it("returns null when no destination square can be extracted", () => {
    expect(parse("move the knight", "en")).toBeNull();
  });
});
