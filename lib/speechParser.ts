const PIECE_MAP: Record<string, Record<string, string>> = {
  en: { pawn: "", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" },
  es: { peón: "", caballo: "N", alfil: "B", torre: "R", dama: "Q", rey: "K" },
  fr: { pion: "", cavalier: "N", fou: "B", tour: "R", dame: "Q", roi: "K" },
  de: { bauer: "", springer: "N", läufer: "B", turm: "R", dame: "Q", könig: "K" },
  it: { pedone: "", cavallo: "N", alfiere: "B", torre: "R", regina: "Q", re: "K" },
  pt: { peão: "", cavalo: "N", bispo: "B", torre: "R", rainha: "Q", rei: "K" },
};

const PHONETIC_PIECE_HOMOPHONES: Record<string, string> = {
  // Knight mishearings
  night: "knight",
  nite: "knight",
  nigh: "knight",
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
};

const FILLER_WORDS = ["on", "at", "the", "a", "an", "square", "en", "à", "al", "el", "la", "le", "der", "die", "das", "il", "lo", "um", "uma", "o", "os", "as"];

function normalizeText(text: string): string {
  let normalized = text.toLowerCase().trim();
  normalized = normalized.replace(/[^a-zà-ÿœæéèêëîïôöùûüçñáéíóúäöüß0-9\s-]/g, " ");
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

  // Join isolated file letter + number (e.g., "c 3" or "c three" -> "c3")
  joined = joined.replace(/\b([a-h])\s+([1-8])\b/g, "$1$2");
  return joined;
}

function extractSquare(text: string): string | null {
  const matches = text.match(/[a-h][1-8]/g);
  return matches ? matches[matches.length - 1] : null;
}

function detectCastle(text: string): string | null {
  const castlePatterns = [
    /o-o-o|queen[’']?s\s*side\s*castle|long\s*castle|grand[’']?s\s*roqu?/i,
    /o-o|king[’']?s\s*side\s*castle|short\s*castle|petit\s*roqu?|small\s*castle/i,
  ];
  if (castlePatterns[0].test(text)) return "O-O-O";
  if (castlePatterns[1].test(text)) return "O-O";
  return null;
}

function detectTakes(text: string, lang: string): boolean {
  const takeWords: Record<string, string[]> = {
    en: ["takes", "captures", "takes on", "captures on", "x", "kills", "destroys", "eats"],
    es: ["toma", "captura", "come"],
    fr: ["prend", "capture", "prends"],
    de: ["nimmt", "schlägt", "erobert"],
    it: ["prende", "cattura", "mangia"],
    pt: ["toma", "captura", "come"],
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
  const map = PIECE_MAP[lang] ?? PIECE_MAP.en;

  for (const [name, letter] of Object.entries(map)) {
    if (name && new RegExp(`\\b${name}\\b`, "i").test(text)) return letter;
  }

  for (const word of text.split(/\s+/)) {
    if (word in PIECE_ABBREVIATIONS) return PIECE_ABBREVIATIONS[word];
  }

  let best: { dist: number; letter: string } | null = null;
  for (const word of text.split(/\s+/)) {
    if (word.length < 3) continue;
    for (const [name, letter] of Object.entries(map)) {
      if (!name) continue;
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

export function parseChessMove(text: string, lang: string = "en"): string | null {
  const castle = detectCastle(text);
  if (castle) return castle;

  let normalized = normalizeText(text);
  normalized = preprocessPhonetics(normalized);

  const uciMatch = normalized.match(/^([a-h][1-8])([a-h][1-8])$/);
  if (uciMatch) return `${uciMatch[1]}${uciMatch[2]}`;

  const takes = detectTakes(normalized, lang);

  for (const word of FILLER_WORDS) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "g"), "");
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

  if (takes) {
    if (!piece && pawnCaptureFile) return `${prev}x${square}`;
    return `${pieceLetter}x${square}`;
  }
  return `${pieceLetter}${square}`;
}