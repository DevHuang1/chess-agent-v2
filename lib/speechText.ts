/**
 * Converts raw coach-reply markdown into text suitable for text-to-speech.
 *
 * Coach replies are rendered as markdown on screen (bold headers, tables,
 * code spans, FEN values, engine traces). Reading them aloud verbatim makes
 * the voice spell out FEN strings and punctuation soup. This strips anything
 * that is not natural prose while keeping the human-readable words.
 *
 * Pure function — no DOM/Next imports — so vitest can exercise it directly.
 */

/** Board part of a standard chess FEN (eight rank fields). */
const FEN_BOARD = "(?:[rnbqkpRNBQKP1-8]{1,8}/){7}[rnbqkpRNBQKP1-8]{1,8}";
/** Everything after the board: side, castling, en-passant, clocks. */
const FEN_TAIL =
  "\\s+[wb]\\s+(?:K?Q?k?q?[A-Ha-h]{0,4}|-)\\s+(?:[a-h][36]|-)\\s+\\d+\\s+\\d+";

export function toSpeechText(raw: string): string {
  let text = raw ?? "";

  // Drop fenced code blocks entirely (their content is never speakable).
  text = text.replace(/```[\s\S]*?```/g, " ");

  // Inline code spans: keep the content, drop the backticks (e.g. `a3` -> a3).
  text = text.replace(/`([^`\n]*)`/g, "$1");

  // Remove FEN mentions — the voice must never read "rnbqkbnr/pppppppp..."
  // aloud. Handles three shapes: a full "FEN: <value>" line, a bare FEN
  // value anywhere, and a leftover "FEN:" label whose value was stripped.
  text = text.replace(
    new RegExp(`^[ \\t]*FEN[ \\t]*[:：][ \\t]*\`?${FEN_BOARD}${FEN_TAIL}\`?[ \\t]*$`, "gim"),
    " ",
  );
  text = text.replace(new RegExp(`\`?\\b${FEN_BOARD}${FEN_TAIL}\\b\`?`, "g"), " ");
  text = text.replace(/^[ \t]*FEN[ \t]*[:：][ \t]*$/gim, " ");

  // Images and links: images vanish, links keep only their visible text.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Headings and blockquotes: keep the words, drop the markers.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");

  // Emphasis / strikethrough markers around words.
  text = text.replace(/(\*\*\*|\*\*|\*|__|~~)([^\n]+?)\1/g, "$2");

  // Markdown table separator rows disappear; remaining pipes become spaces
  // so table rows read as short phrases instead of "bar bar bar".
  text = text.replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm, " ");
  text = text.replace(/\|/g, " ");

  // List bullets and ordered-list numbers.
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");

  // Horizontal rules.
  text = text.replace(/^\s*([-_*]\s*){3,}$/gm, " ");

  // Collapse the leftover whitespace so the voice gets clean sentences.
  text = text
    .replace(/\u00AD/g, "") // soft hyphens
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return text;
}