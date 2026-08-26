#!/usr/bin/env node
/**
 * Import a curated puzzle set from the Lichess open puzzle database.
 *
 * Source: https://database.lichess.org — lichess_db_puzzle.csv.zst (CC0).
 * CSV columns:
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,
 *   GameUrl,OpeningTags,DailyDate
 *
 * Solution semantics (per Lichess docs): the FEN is the position before the
 * opponent's last move, i.e. the FIRST move in Moves is played by the side
 * to move in the FEN (the "opponent" from the solver's perspective); the
 * solver then alternates along the remaining moves.
 *
 * Streams `curl | zstd -d` and stops as soon as every theme × rating-band
 * bucket is full, so the multi-GB database is never fully read. Every kept
 * puzzle is validated with chess.js before being written to
 * data/puzzles.json.
 *
 * Usage:
 *   node scripts/import-puzzles.mjs                # stream from Lichess
 *   PUZZLES_IN=/path/db.csv.zst node scripts/import-puzzles.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Chess } from "chess.js";

const DB_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const IN_FILE = process.env.PUZZLES_IN ?? "";
const OUT_PATH = path.resolve("data/puzzles.json");

/** Theme whitelist mapped to app-facing names. */
const THEME_MAP = {
  mate: "mate",
  mateIn1: "mateIn1",
  mateIn2: "mateIn2",
  fork: "fork",
  pin: "pin",
  skewer: "skewer",
  discoveredAttack: "discoveredAttack",
  hangingPiece: "hangingPiece",
  trappedPiece: "trappedPiece",
  advantage: "advantage",
  endgame: "endgame",
};

/** Quality gates — keep only puzzles with trustworthy, pleasant ratings. */
const MAX_RATING = Number(process.env.PUZZLES_MAX_RATING ?? 2200);
const MAX_RATING_DEVIATION = Number(process.env.PUZZLES_MAX_RD ?? 100);
const MIN_POPULARITY = Number(process.env.PUZZLES_MIN_POPULARITY ?? 70);
const MIN_PLAYS = Number(process.env.PUZZLES_MIN_PLAYS ?? 50);

/** Quotas: per theme × rating-band buckets, plus a global cap. */
const RATING_BANDS = [
  [0, 1100],
  [1100, 1500],
  [1500, 1900],
  [1900, 2201],
];
const PER_BUCKET_TARGET = Number(process.env.PUZZLES_PER_BUCKET ?? 130);
const TOTAL_TARGET = Number(process.env.PUZZLES_TOTAL ?? 4000);

function bandIndex(rating) {
  for (let i = 0; i < RATING_BANDS.length; i++) {
    const [lo, hi] = RATING_BANDS[i];
    if (rating >= lo && rating < hi) return i;
  }
  return -1;
}

/** Minimal CSV field splitter honoring double-quoted fields. */
function splitCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Validate a raw row against chess.js and convert it to our stored schema.
 * Returns null when the position or solution line is illegal.
 */
function toPuzzleRecord(row) {
  const moves = row.Moves.split(" ").filter(Boolean);
  if (moves.length < 2 || moves.length > 12) return null;

  let chess;
  try {
    chess = new Chess(row.FEN);
  } catch {
    return null;
  }

  try {
    for (const uci of moves) {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length === 5 ? uci[4] : undefined,
      });
      if (!move) return null;
    }
  } catch {
    return null;
  }

  const fenActiveColor = row.FEN.split(" ")[1] === "b" ? "b" : "w";
  const themes = [];
  for (const rawTheme of row.Themes.split(" ")) {
    const mapped = THEME_MAP[rawTheme];
    if (mapped && !themes.includes(mapped)) themes.push(mapped);
  }
  if (themes.length === 0) return null;

  return {
    id: row.PuzzleId,
    fen: row.FEN,
    opponentMoveUci: moves[0],
    playerMovesUci: moves.slice(1),
    movesSan: chess.history(),
    themes,
    primaryTheme: themes[0],
    rating: row.Rating,
    popularity: row.Popularity,
    solverColor: fenActiveColor === "b" ? "w" : "b",
    openingTags: row.OpeningTags || "",
    gameUrl: row.GameUrl || "",
  };
}

/** Yield newline-delimited lines from an async byte stream. */
async function* csvLines(source) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineAt;
    while ((newlineAt = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      if (line) yield line;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield buffer.trim();
}

async function openSourceStream() {
  const hasSystemZstd =
    IN_FILE ||
    spawnSync("zstd", ["--version"], { stdio: "ignore" }).status === 0;
  if (!hasSystemZstd) {
    throw new Error(
      "System zstd not found. Install zstd (brew install zstd) or set PUZZLES_IN to a pre-decompressed .csv file path.",
    );
  }
  const shellCmd = IN_FILE
    ? `zstd -dc "${IN_FILE}"`
    : `curl -sSL "${DB_URL}" | zstd -dc`;
  console.log(`Streaming via: ${shellCmd}`);
  const proc = spawn("sh", ["-c", shellCmd], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return proc.stdout;
}

async function main() {
  const buckets = new Map();
  const puzzles = [];
  let scanned = 0;

  const stream = await openSourceStream();

  for await (const line of csvLines(stream)) {
    if (puzzles.length >= TOTAL_TARGET) break;
    if (line.startsWith("PuzzleId")) continue; // CSV header
    scanned++;

    const f = splitCsvLine(line);
    if (f.length < 9) continue;
    const row = {
      PuzzleId: f[0],
      FEN: f[1],
      Moves: f[2],
      Rating: Number(f[3]),
      RatingDeviation: Number(f[4]),
      Popularity: Number(f[5]),
      NbPlays: Number(f[6]),
      Themes: f[7],
      GameUrl: f[8],
      OpeningTags: f[9] ?? "",
    };

    if (row.Rating > MAX_RATING) continue;
    if (row.RatingDeviation > MAX_RATING_DEVIATION) continue;
    if (row.Popularity < MIN_POPULARITY) continue;
    if (row.NbPlays < MIN_PLAYS) continue;

    const band = bandIndex(row.Rating);
    if (band === -1) continue;

    const candidate = toPuzzleRecord(row);
    if (!candidate) continue;

    const key = `${candidate.primaryTheme}:${band}`;
    const count = buckets.get(key) ?? 0;
    if (count >= PER_BUCKET_TARGET) continue;

    buckets.set(key, count + 1);
    puzzles.push(candidate);

    if (puzzles.length % 250 === 0) {
      console.log(`Kept ${puzzles.length}/${TOTAL_TARGET} (scanned ${scanned})`);
    }
  }

  // Stop the curl/zstd pipe once quotas are filled.
  if (stream.parent && typeof stream.parent.kill === "function") {
    stream.parent.kill("SIGTERM");
  }

  puzzles.sort((a, b) => a.rating - b.rating);
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(puzzles));
  console.log(
    `Wrote ${puzzles.length} puzzles across ${buckets.size} buckets → ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
