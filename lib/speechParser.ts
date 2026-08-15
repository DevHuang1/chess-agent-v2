import { Chess } from "chess.js";

const PIECE_MAP: Record<string, Record<string, string>> = {
  en: { pawn: "", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" },
  es: { peón: "", caballo: "N", alfil: "B", torre: "R", dama: "Q", rey: "K" },
  fr: { pion: "", cavalier: "N", fou: "B", tour: "R", dame: "Q", roi: "K" },
  de: { bauer: "", springer: "N", läufer: "B", turm: "R", dame: "Q", könig: "K" },
  it: { pedone: "", cavallo: "N", alfiere: "B", torre: "R", regina: "Q", re: "K" },
  pt: { peão: "", cavalo: "N", bispo: "B", torre: "R", rainha: "Q", rei: "K" },
  my: {
    "ဘုရင်": "K",
    "မိဖုရား": "Q",
    "မိဗျား": "Q",
    "ဘုရင်မ": "Q",
    "ကျီ": "R",
    "လှေ": "R",
    "ဆင်": "B",
    "မြင်း": "N",
    "မြင်": "N",
    "မြင့်": "N",
    "မြေး": "N",
    "နိုင်": "",
  nai: "",
    "စစ်သား": "",
  },
};

const PHONETIC_PIECE_HOMOPHONES: Record<string, string> = {
  // Knight mishearings
  night: "knight",
  nite: "knight",
  nigh: "knight",
  mie: "knight",
  kint: "knight",
  knit: "knight",
  horse: "knight",
  neigh: "knight",
  knife: "knight",
  nine: "knight",
  light: "knight",
  // Bishop mishearings
  shop: "bishop",
  dish: "bishop",
  bush: "bishop",
  bip: "bishop",
  bish: "bishop",
  vishop: "bishop",
  bischop: "bishop",
  fish: "bishop",
  mish: "bishop",
  // Rook mishearings
  rock: "rook",
  look: "rook",
  root: "rook",
  rosh: "rook",
  brook: "rook",
  castle: "rook",
  tower: "rook",
  hook: "rook",
  rick: "rook",
  rack: "rook",
  work: "rook",
  // Queen mishearings
  queer: "queen",
  clean: "queen",
  quinn: "queen",
  quin: "queen",
  green: "queen",
  cream: "queen",
  twin: "queen",
  kwin: "queen",
  // King mishearings
  kin: "king",
  ring: "king",
  ping: "king",
  thing: "king",
  kink: "king",
  kang: "king",
  keen: "king",
  // Pawn mishearings
  pond: "pawn",
  palm: "pawn",
  pomp: "pawn",
  pan: "pawn",
  pin: "pawn",
  phone: "pawn",
  spawn: "pawn",
  corn: "pawn",
  point: "pawn",
  pont: "pawn",
  pour: "pawn",
  pow: "pawn",
};

const FILE_HOMOPHONES: Record<string, string> = {
  alpha: "a",
  hey: "a",
  ay: "a",
  eh: "a",
  bravo: "b",
  be: "b",
  bee: "b",
  bea: "b",
  charlie: "c",
  see: "c",
  sea: "c",
  si: "c",
  delta: "d",
  dee: "d",
  echo: "e",
  y: "e",
  ee: "e",
  he: "e",
  foxtrot: "f",
  ef: "f",
  eff: "f",
  if: "f",
  golf: "g",
  jee: "g",
  gee: "g",
  ji: "g",
  hotel: "h",
  aitch: "h",
  edge: "h",
};

const NUMBER_HOMOPHONES: Record<string, string> = {
  one: "1",
  won: "1",
  two: "2",
  to: "2",
  too: "2",
  three: "3",
  tree: "3",
  free: "3",
  four: "4",
  le: "4",
  for: "4",
  fore: "4",
  five: "5",
  hive: "5",
  six: "6",
  sick: "6",
  sex: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  // Burmese numerals
  "တစ်": "1",
  "နှစ်": "2",
  "သုံး": "3",
  "လေး": "4",
  "ငါး": "5",
  "ခြောက်": "6",
  "ခုနစ်": "7",
  "ရှစ်": "8",
};

// Burmese phonetic renderings of English letters — how the Burmese fine-tuned
// Whisper model transcribes spoken squares such as "eff-three" (f3).
const MYANMAR_FILE_SOUNDS: Array<[string, string]> = [
  ["အီး", "e"],
  ["အီ", "e"],
  ["၏", "e"],
  ["အာပ်", "f"],
  ["အဖ်", "f"],
  ["အပ်", "f"],
  ["အား", "f"],
  ["အာ့", "f"],
  ["အေ", "a"],
  ["ဘီ", "b"],
  ["စီ", "c"],
  ["ဒီ", "d"],
  ["ဂျီ", "g"],
  ["အိတ်", "h"],
];

// Burmese phonetic renderings of English numbers (rank words).
const MYANMAR_RANK_SOUNDS: Array<[string, string]> = [
  ["သူတွေး", "3"],
  ["သူရိလ်", "3"],
  ["သူရိမ်", "3"],
  ["သူတိမ်း", "3"],
  ["သူတေ", "3"],
  ["ဖတ်တွေ", "3"],
  ["ဖတ်တ်", "3"],
  ["သရီး", "3"],
  ["သြီ", "3"],
  ["တရီ", "3"],
  ["ဖိုး", "4"],
  ["ဖော်", "4"],
  ["ဝမ်", "1"],
  ["တူး", "2"],
  ["တူ", "2"],
  ["ဖိုက်", "5"],
  ["ဆစ်", "6"],
  ["ဆဲဗင်", "7"],
  ["အိတ်", "8"],
];

const FILLER_WORDS = [
  "on",
  "at",
  "the",
  "a",
  "an",
  "square",
  "en",
  "à",
  "al",
  "el",
  "la",
  "le",
  "der",
  "die",
  "das",
  "il",
  "lo",
  "um",
  "uma",
  "o",
  "os",
  "as",
  "ကနေ",
  "gu",
  "ကို",
  "မှာ",
  "သို့",
  "ထဲ",
  "ပေါ်",
];

const MYANMAR_DIGITS: Record<string, string> = {
  "၀": "0",
  "၁": "1",
  "၂": "2",
  "၃": "3",
  "၄": "4",
  "၅": "5",
  "၆": "6",
  "၇": "7",
  "၈": "8",
  "၉": "9",
};

function normalizeText(text: string): string {
  let normalized = text.toLowerCase().trim();
  // Keep Latin accents (à-ÿ) plus Myanmar script (U+1000-U+109F, U+AA60-U+AA7F, U+A9E0-U+A9FF).
  normalized = normalized.replace(
    /[^a-zà-ÿœæéèêëîïôöùûüçñáéíóúäöüß\u1000-\u109f\uAA60-\uAA7F\uA9E0-\uA9FF0-9\s-]/g,
    " ",
  );
  // Normalize Myanmar numerals to Latin digits so square extraction works.
  normalized = normalized.replace(/[၀-၉]/g, (d) => MYANMAR_DIGITS[d] ?? d);
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

function preprocessPhonetics(text: string): string {
  const words = text.split(/\s+/);
  const processed = words.map((w) => {
    if (PHONETIC_PIECE_HOMOPHONES[w]) return PHONETIC_PIECE_HOMOPHONES[w];
    if (FILE_HOMOPHONES[w]) return FILE_HOMOPHONES[w];
    if (NUMBER_HOMOPHONES[w]) return NUMBER_HOMOPHONES[w];
    return w;
  });

  let joined = processed.join(" ");

  // Recover Latin squares from Burmese phonetic renderings (e.g. အာပ် သူတွေး -> f 3).
  for (const [sound, latin] of [...MYANMAR_FILE_SOUNDS, ...MYANMAR_RANK_SOUNDS]) {
    joined = joined.split(sound).join(` ${latin} `);
  }

  // Join isolated file letter + number (e.g., "c 3" or "c three" -> "c3")
  joined = joined.replace(/\b([a-h])\s+([1-8])\b/g, "$1$2");
  return joined;
}

function extractSquare(text: string): string | null {
  const matches = text.match(/[a-h][1-8]/g);
  return matches ? matches[matches.length - 1] : null;
}

function detectCastle(text: string, chess?: Chess): string | null {
  const lower = text.toLowerCase();

  const queensidePattern =
    /o-o-o|queenside|queen['’]?s?\s*side|long\s*castle|castle\s+queenside|grand['’]?s?\s*roqu?|queen[’']?s?\s*castle/i;
  const kingsidePattern =
    /o[\s-]*o\b|kingside|king['’]?s?\s*side|short\s*castle|small\s*castle|castle\s+kingside|petit\s*roqu?|king['’]?s?\s*castle/i;
  const bareCastlePattern =
    /(^|\s)(castles?|castling|cassel|castel|enroques?|enrocamiento)(\s|$)/i;

  if (queensidePattern.test(lower)) return "O-O-O";
  if (kingsidePattern.test(lower)) return "O-O";
  if (!bareCastlePattern.test(lower)) return null;

  // Ambiguous bare "castle" — prefer the legal side on the live board.
  if (chess) {
    const legal = chess.moves({ verbose: true });
    const canKing = legal.some((m) => m.flags.includes("k"));
    const canQueen = legal.some((m) => m.flags.includes("q"));
    if (canQueen && !canKing) return "O-O-O";
    if (canKing) return "O-O";
  }
  return "O-O";
}

function detectTakes(text: string, lang: string): boolean {
  const takeWords: Record<string, string[]> = {
    en: ["takes", "take", "takes on", "take on", "captures", "capture", "captures on", "capture on", "x", "kills", "destroys", "eats"],
    es: ["toma", "captura", "come"],
    fr: ["prend", "capture", "prends"],
    de: ["nimmt", "schlägt", "erobert"],
    it: ["prende", "cattura", "mangia"],
    pt: ["toma", "captura", "come"],
    my: ["ယူ", "စား", "ဖမ်း"],
  };
  const words = takeWords[lang] ?? takeWords.en;
  return words.some((w) => text.includes(w));
}

const PIECE_ABBREVIATIONS: Record<string, string> = {
  p: "",
  n: "N",
  b: "B",
  r: "R",
  q: "Q",
  k: "K",
};

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function extractPiece(text: string, lang: string): string | null {
  const maps = lang === "en" ? [PIECE_MAP.en] : [PIECE_MAP[lang] ?? PIECE_MAP.en, PIECE_MAP.en];
  const pieceEntries = Array.from(
    new Map(
      maps.flatMap((pieceMap) => Object.entries(pieceMap)),
    ).entries(),
  )
    .filter(([name]) => name.length > 0)
    .sort(([left], [right]) => right.length - left.length);

  for (const [name, letter] of pieceEntries) {
    // Non-Latin script (e.g. Burmese) has no ASCII word boundaries — use substring match.
    const isLatin = /^[a-zà-ÿ]+$/i.test(name);
    if (isLatin ? new RegExp(`\\b${name}\\b`, "i").test(text) : text.includes(name)) {
      return letter;
    }
  }

  for (const word of text.split(/\s+/)) {
    if (word in PIECE_ABBREVIATIONS) return PIECE_ABBREVIATIONS[word];
  }

  let best: { dist: number; letter: string } | null = null;
  for (const word of text.split(/\s+/)) {
    if (word.length < 3) continue;
    for (const [name, letter] of pieceEntries) {
      const dist = levenshtein(word.toLowerCase(), name.toLowerCase());
      const threshold = Math.max(1, Math.floor(name.length / 2));
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { dist, letter };
      }
    }
  }
  return best ? best.letter : null;
}

function extractSanPiece(text: string, square: string): string | null {
  const idx = text.lastIndexOf(square);
  const prefix = text.slice(0, idx).trim();
  if (!prefix) return null;

  const match = prefix.match(/^([pbnrqk])([a-h]|[1-8])?$/);
  if (!match) return null;

  const pieceLetter = PIECE_ABBREVIATIONS[match[1]];
  return `${pieceLetter}${match[2] ?? ""}`;
}

/**
 * Resolves a candidate SAN against the live board.
 *
 * The parser alone cannot produce a complete SAN for ambiguous moves. A pawn
 * capture such as "Pawn takes D5" needs the origin file ("exd5") to be valid,
 * and a piece capture like "B takes D5" may be ambiguous when two bishops can
 * reach the square. When a `chess` instance is available we resolve the
 * candidate to the unique legal move that matches the spoken destination,
 * piece type, and capture, and return its canonical SAN.
 */
function resolveMove(
  chess: Chess,
  candidate: string,
  square: string,
  pieceLetter: string,
  takes: boolean,
): string | null {
  try {
    const move = chess.move(candidate);
    chess.undo();
    return move.san;
  } catch {
    // Candidate is not directly playable — resolve it below.
  }

  const pieceType = pieceLetter.toLowerCase();
  const targets = chess
    .moves({ verbose: true })
    .filter((m) => {
      if (m.to !== square) return false;
      if (pieceLetter) return m.piece === pieceType;
      return m.piece === "p";
    });

  // Prefer moves matching the spoken capture intent, but ASR frequently drops
  // "takes" — if no move matches the flag, fall back to any unique legal move
  // to the spoken square.
  const exact = targets.filter((m) => {
    if (takes) return m.captured || m.flags.includes("e");
    return !(m.captured || m.flags.includes("e"));
  });
  const pool = exact.length > 0 ? exact : targets;
  if (pool.length === 1) return pool[0].san;
  return null;
}

export function parseChessMove(
  text: string,
  lang: string = "en",
  chess?: Chess,
): string | null {
  const castle = detectCastle(text, chess);
  if (castle) return castle;

  let normalized = normalizeText(text);
  normalized = preprocessPhonetics(normalized);

  const uciMatch = normalized.match(/^([a-h][1-8])([a-h][1-8])$/);
  if (uciMatch) return `${uciMatch[1]}${uciMatch[2]}`;

  const takes = detectTakes(normalized, lang);

  for (const word of FILLER_WORDS) {
    const isLatin = /^[a-zà-ÿ]+$/i.test(word);
    if (isLatin) {
      normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "g"), "");
    } else {
      normalized = normalized.split(word).join(" ");
    }
  }
  normalized = normalized.replace(/\s+/g, " ").trim();
  normalized = normalized.replace(/x/g, "");

  const piece = extractPiece(normalized, lang);
  const square = extractSquare(normalized);

  if (!square) return null;

  const sanPiece = extractSanPiece(normalized, square);
  const pieceLetter = piece ?? sanPiece ?? "";
  const idx = normalized.lastIndexOf(square);
  const prev = idx > 0 ? normalized[idx - 1] : "";
  const pawnCaptureFile = /^[a-h]$/.test(prev);

  const candidate = takes
    ? !piece && pawnCaptureFile
      ? `${prev}x${square}`
      : `${pieceLetter}x${square}`
    : `${pieceLetter}${square}`;

  if (chess) {
    const resolved = resolveMove(chess, candidate, square, pieceLetter, takes);
    if (resolved) return resolved;
  }
  return candidate;
}
