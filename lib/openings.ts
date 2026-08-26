/**
 * Small curated opening book for displaying the name of the current opening.
 *
 * Keys are SAN move sequences joined by spaces (e.g. "e4 c5 Nf3 d6 d4 cxd4").
 * Lookup performs a longest-prefix match against the game's SAN history, so
 * transpositions that reach the same position via a different order still
 * match as long as the move sequence matches a known prefix.
 */

export type OpeningEntry = {
  /** SAN moves joined by spaces. */
  moves: string;
  /** Standard opening name. */
  name: string;
  /** Encyclopaedia of Chess Openings code, if applicable. */
  eco?: string;
};

export const OPENINGS: OpeningEntry[] = [
  // 1.e4 — open games
  { moves: "e4 e5 Nf3 Nc6 Bb5", name: "Ruy López", eco: "C60" },
  { moves: "e4 e5 Nf3 Nc6 Bc4", name: "Italian Game", eco: "C50" },
  { moves: "e4 e5 Nf3 Nc6 Bc4 Bc5", name: "Giuoco Piano", eco: "C53" },
  { moves: "e4 e5 Nf3 Nc6 Bc4 Nf6", name: "Two Knights Defense", eco: "C55" },
  { moves: "e4 e5 Nf3 Nc6 d4", name: "Scotch Game", eco: "C44" },
  { moves: "e4 e5 Nf3 Nf6", name: "Petrov's Defense", eco: "C42" },
  { moves: "e4 e5 Nc3", name: "Vienna Game", eco: "C25" },
  { moves: "e4 e5 f4", name: "King's Gambit", eco: "C30" },
  { moves: "e4 e5 Bc4", name: "Bishop's Opening", eco: "C23" },
  { moves: "e4 e5 Nf3 d6", name: "Philidor Defense", eco: "C41" },

  // 1.e4 c5 — Sicilian
  { moves: "e4 c5", name: "Sicilian Defense", eco: "B20" },
  {
    moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3",
    name: "Sicilian, Open",
    eco: "B50",
  },
  {
    moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6",
    name: "Sicilian, Dragon",
    eco: "B70",
  },
  {
    moves: "e4 c5 Nf3 e6",
    name: "Sicilian, Taimanov/French Variation",
    eco: "B40",
  },
  { moves: "e4 c5 Nf3 Nc6", name: "Sicilian, Old Sicilian", eco: "B30" },
  { moves: "e4 c5 Nc3", name: "Sicilian, Closed", eco: "B23" },
  { moves: "e4 c5 c3", name: "Sicilian, Alapin Variation", eco: "B22" },
  { moves: "e4 c5 d4", name: "Sicilian, Smith-Morra Gambit", eco: "B21" },

  // 1.e4 — French / Caro-Kann / Pirc / Scandinavian
  { moves: "e4 e6", name: "French Defense", eco: "C00" },
  { moves: "e4 e6 d4 d5", name: "French Defense, Main Line", eco: "C01" },
  { moves: "e4 c6", name: "Caro-Kann Defense", eco: "B10" },
  { moves: "e4 d5", name: "Scandinavian Defense", eco: "B01" },
  { moves: "e4 d6", name: "Pirc Defense", eco: "B07" },
  { moves: "e4 g6", name: "Modern Defense", eco: "B06" },
  { moves: "e4 Nf6", name: "Alekhine's Defense", eco: "B02" },

  // 1.d4 — closed games
  { moves: "d4 d5 c4", name: "Queen's Gambit", eco: "D06" },
  { moves: "d4 d5 c4 dxc4", name: "Queen's Gambit Accepted", eco: "D20" },
  { moves: "d4 d5 c4 e6", name: "Queen's Gambit Declined", eco: "D30" },
  { moves: "d4 d5 c4 c6", name: "Slav Defense", eco: "D10" },
  {
    moves: "d4 d5 c4 Nf6",
    name: "Queen's Gambit, Marshall Defense",
    eco: "D02",
  },
  { moves: "d4 Nf6 c4 e6", name: "Indian Game", eco: "E00" },
  { moves: "d4 Nf6 c4 e6 Nc3 Bb4", name: "Nimzo-Indian Defense", eco: "E20" },
  { moves: "d4 Nf6 c4 e6 Nf3 b6", name: "Queen's Indian Defense", eco: "E12" },
  { moves: "d4 Nf6 c4 g6", name: "King's Indian Defense", eco: "E60" },
  { moves: "d4 Nf6 c4 g6 Nc3 d5", name: "Grünfeld Defense", eco: "D80" },
  { moves: "d4 Nf6 c4 c5", name: "Benoni Defense", eco: "A56" },
  { moves: "d4 f5", name: "Dutch Defense", eco: "A80" },
  { moves: "d4 d5 Nf3", name: "Queen's Pawn Game", eco: "D02" },
  { moves: "d4 e6", name: "Horwitz Defense", eco: "A40" },

  // Flank / other first moves
  { moves: "c4", name: "English Opening", eco: "A10" },
  { moves: "c4 e5", name: "English, Reversed Sicilian", eco: "A20" },
  { moves: "Nf3", name: "Zukertort Opening", eco: "A04" },
  { moves: "Nf3 d5 g3", name: "King's Indian Attack", eco: "A07" },
  { moves: "g3", name: "Benko Opening", eco: "A00" },
  { moves: "b3", name: "Nimzo-Larsen Attack", eco: "A01" },
  { moves: "f4", name: "Bird's Opening", eco: "A02" },
  { moves: "b4", name: "Polish Opening", eco: "A00" },
  {
    moves: "e4 e5 Nf3 Nc6 Bb5 a6",
    name: "Ruy López, Morphy Defense",
    eco: "C70",
  },
  {
    moves: "e4 e5 Nf3 Nc6 Bb5 Nf6",
    name: "Ruy López, Berlin Defense",
    eco: "C65",
  },
];

/**
 * Find the name of the opening matching the longest prefix of the given SAN
 * move list. Returns null when no opening matches.
 */
export function lookupOpening(sanMoves: string[]): OpeningEntry | null {
  if (sanMoves.length === 0) return null;
  const played = sanMoves.join(" ");

  let best: OpeningEntry | null = null;
  let bestLength = -1;

  for (const entry of OPENINGS) {
    if (
      played.startsWith(entry.moves) &&
      (entry.moves.length > bestLength ||
        // Prefer an exact match over a longer-but-non-matching entry.
        (entry.moves.length === bestLength && best === null))
    ) {
      // A prefix only counts if it ends on a move boundary.
      const nextChar = played[entry.moves.length];
      if (nextChar === undefined || nextChar === " ") {
        best = entry;
        bestLength = entry.moves.length;
      }
    }
  }

  return best;
}
