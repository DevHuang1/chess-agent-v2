/**
 * Pure helpers for deciding whether a `language=my` transcription actually
 * contains usable Burmese content.
 *
 * Whisper-family engines (the local CT2 fine-tune, Groq's Whisper, and even
 * cloud tiers) can "succeed" with HTTP 200 while returning text that is
 * useless for a Burmese flow: replacement-character soup (`\uFFFD`), a wrong
 * script (Thai, Devanagari, Han), or English hallucination. Gating on the
 * Myanmar Unicode block (plus a few short chess tokens) lets the
 * /api/transcribe route skip a "successful" but unusable tier and fall
 * through to the next provider.
 *
 * Pure module — no Next/server imports — so vitest can exercise it directly.
 */

/** Myanmar script + extensions (Myanmar, Tai Laing, Myanmar Extended-B). */
export const MYANMAR_BLOCK = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/;

/** U+FFFD replacement character — the tell-tale of a garbage decode. */
const REPLACEMENT_RE = /\uFFFD/g;

/**
 * True when the text is pure standard chess notation the speech parser
 * accepts without any Myanmar script (e.g. "O-O", "Nf3", "e4").
 */
export function hasChessNotationOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^O-O(-O)?$/i.test(t)) return true;
  return (
    t.length <= 12 &&
    /^[O0-8a-hKQRBNx+#\s-]+$/i.test(t) &&
    /[a-h]/.test(t)
  );
}

/**
 * Accept a Burmese-tier result only when it plausibly contains Burmese
 * content. Rejects wrong-script hallucination and replacement-char soup even
 * when the provider returned HTTP 200.
 */
export function looksLikeBurmese(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;

  // Replacement-character soup means the model decoded gibberish; a clean
  // transcript (from any engine) never contains more than a couple.
  const replacementCount = (t.match(REPLACEMENT_RE) ?? []).length;
  if (replacementCount > 4 || replacementCount / t.length > 0.1) return false;

  if (MYANMAR_BLOCK.test(t)) return true;
  if (t.length <= 3) return true; // "e4", "O-O", "Nf3"
  return hasChessNotationOnly(t);
}