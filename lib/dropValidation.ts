export type DropValidationReason = "legal" | "cancelled" | "illegal" | "missing-source";

export type DropValidation = {
  accepted: boolean;
  target: string | null;
  reason: DropValidationReason;
};

export function validateDropTarget(
  fromSquare: string | null,
  requestedSquare: string | null,
  legalSquares: readonly string[],
): DropValidation {
  if (!fromSquare) {
    return { accepted: false, target: null, reason: "missing-source" };
  }
  if (!requestedSquare) {
    return { accepted: false, target: null, reason: "cancelled" };
  }
  if (!legalSquares.includes(requestedSquare)) {
    return { accepted: false, target: null, reason: "illegal" };
  }
  return { accepted: true, target: requestedSquare, reason: "legal" };
}
