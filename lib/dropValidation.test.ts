import { describe, expect, it } from "vitest";
import { validateDropTarget } from "./dropValidation";

describe("validateDropTarget", () => {
  it("accepts a requested legal destination", () => {
    expect(validateDropTarget("e2", "e4", ["e3", "e4"])).toEqual({
      accepted: true,
      target: "e4",
      reason: "legal",
    });
  });

  it("rejects a square that is not in the legal target set", () => {
    expect(validateDropTarget("e2", "e5", ["e3", "e4"])).toEqual({
      accepted: false,
      target: null,
      reason: "illegal",
    });
  });

  it("treats a null release as an explicit cancellation", () => {
    expect(validateDropTarget("e2", null, ["e3", "e4"])).toEqual({
      accepted: false,
      target: null,
      reason: "cancelled",
    });
  });

  it("rejects a release when the source piece is no longer available", () => {
    expect(validateDropTarget(null, "e4", ["e4"])).toEqual({
      accepted: false,
      target: null,
      reason: "missing-source",
    });
  });

  it("does not mutate the legal target collection", () => {
    const legalSquares = ["e3", "e4"] as const;
    validateDropTarget("e2", "e4", legalSquares);
    expect(legalSquares).toEqual(["e3", "e4"]);
  });
});
