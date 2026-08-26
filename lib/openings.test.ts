import { describe, expect, it } from "vitest";
import { lookupOpening, OPENINGS } from "./openings";

describe("lookupOpening", () => {
  it("returns null for an empty move list", () => {
    expect(lookupOpening([])).toBeNull();
  });

  it("returns null when no opening matches", () => {
    expect(lookupOpening(["e4", "a6", "d4"])).toBeNull();
  });

  it("matches a first-move opening", () => {
    const result = lookupOpening(["c4"]);
    expect(result?.name).toBe("English Opening");
    expect(result?.eco).toBe("A10");
  });

  it("matches the longest prefix, not the first entry", () => {
    // "e4 c5" alone is the Sicilian; the longer Dragon line must win when played.
    const sicilian = lookupOpening(["e4", "c5", "Nf3"]);
    expect(sicilian?.name).toBe("Sicilian Defense");

    const dragon = lookupOpening([
      "e4",
      "c5",
      "Nf3",
      "d6",
      "d4",
      "cxd4",
      "Nxd4",
      "Nf6",
      "Nc3",
      "g6",
    ]);
    expect(dragon?.name).toContain("Dragon");
  });

  it("does not match a partial move token (boundary check)", () => {
    // "e" would be a string-prefix of "e4" but is not a legal SAN move.
    expect(lookupOpening(["e"])).toBeNull();
  });

  it("matches Ruy López main line", () => {
    const result = lookupOpening(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    expect(result?.name).toBe("Ruy López, Morphy Defense");
  });

  it("matches Queen's Gambit Declined", () => {
    const result = lookupOpening(["d4", "d5", "c4", "e6", "Nc3", "Nf6"]);
    expect(result?.name).toBe("Queen's Gambit Declined");
  });

  it("has no duplicate move sequences in the book", () => {
    const seen = new Set<string>();
    for (const entry of OPENINGS) {
      expect(seen.has(entry.moves)).toBe(false);
      seen.add(entry.moves);
    }
  });
});
