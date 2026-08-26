/**
 * Pure server-side Burmese text-to-speech helpers used by /api/tts.
 *
 * Kept free of next/server so vitest can exercise validation and provider
 * success/failure paths without a Next.js runtime. API keys are always passed
 * in by the caller and are never logged or exposed to the client.
 */

export const MAX_TTS_TEXT_CHARS = 2000;
export const SUPPORTED_TTS_LANGUAGES = ["my-MM", "en-US"] as const;
export const DEFAULT_TTS_LANGUAGE = "my-MM";
export const TTS_TIMEOUT_MS = 25_000;

export type TtsInput = {
  text?: string;
  language?: string;
  voice?: string;
};

export type TtsValidation =
  | { ok: true; text: string; language: string; voice?: string }
  | { ok: false; status: number; detail: string };

/** Normalize a language tag (accepts my, my-MY, en, en-us, ...). */
export function normalizeTtsLanguage(language?: string): string {
  const norm = (language ?? "").toLowerCase().replace(/_/g, "-");
  if (norm.startsWith("my")) return "my-MM";
  if (norm.startsWith("en")) return "en-US";
  return (language ?? DEFAULT_TTS_LANGUAGE).trim();
}

export function validateTtsInput(payload: TtsInput): TtsValidation {
  const text = (payload.text ?? "").trim();
  if (!text) {
    return {
      ok: false,
      status: 400,
      detail: "Request body must include non-empty text.",
    };
  }
  if (text.length > MAX_TTS_TEXT_CHARS) {
    return {
      ok: false,
      status: 413,
      detail: `Text too long (max ${MAX_TTS_TEXT_CHARS} characters).`,
    };
  }
  const language = normalizeTtsLanguage(payload.language);
  if (!(SUPPORTED_TTS_LANGUAGES as readonly string[]).includes(language)) {
    return {
      ok: false,
      status: 400,
      detail: `Unsupported language "${language}". Supported: my-MM, en-US.`,
    };
  }
  return { ok: true, text, language, voice: payload.voice };
}

// Minimal fetch-compatible surface so tests can inject a mock.
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export type TtsSynthResult =
  | { ok: true; contentType: string; audioBytes: Uint8Array }
  | { ok: false; status: number; detail: string };

/** Default Azure neural voice per language — both officially support Burmese. */
export const AZURE_VOICE_BURMESE = "my-MM-NilarNeural";
export const AZURE_VOICE_ENGLISH = "en-US-JennyNeural";

/**
 * Calls the Azure Speech REST API (cognitiveservices/v1). Unlike ElevenLabs'
 * multilingual model, Azure ships dedicated, generally-available Burmese
 * neural voices (my-MM-NilarNeural / my-MM-ThihaNeural), so pronunciation is
 * accurate rather than approximated. Returns raw MP3 bytes on success.
 */
export async function synthesizeAzureTts(
  params: {
    text: string;
    language: string;
    voice?: string;
    apiKey: string;
    region: string;
  },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TtsSynthResult> {
  const { text, language, apiKey, region } = params;
  const voice =
    params.voice ??
    (language === "en-US" ? AZURE_VOICE_ENGLISH : AZURE_VOICE_BURMESE);

  // Escape XML-special characters before embedding in SSML.
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xml:lang="${language}"><voice name="${voice}">${escaped}</voice></speak>`;

  let response;
  try {
    response = await fetchImpl(
      `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        },
        body: ssml,
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      detail: timedOut
        ? "TTS provider timed out. Try again."
        : "Azure TTS service is temporarily unavailable.",
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: 502,
        detail:
          "Azure TTS not authorized: check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.",
      };
    }
    return {
      ok: false,
      status: 502,
      detail: `Azure TTS provider error (${response.status}).`,
    };
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.length === 0) {
    return {
      ok: false,
      status: 502,
      detail: "TTS provider returned an empty audio response.",
    };
  }

  return { ok: true, contentType: "audio/mpeg", audioBytes: audio };
}


/**
 * Calls the local Python backend's edge-tts bridge (POST /tts). The
 * open-source edge-tts package reaches Microsoft Edge's speech endpoint,
 * which serves the same generally-available Burmese neural voices as Azure
 * Speech (my-MM-NilarNeural / my-MM-ThihaNeural) without requiring an Azure
 * account or API key. Used between Azure and ElevenLabs so Burmese
 * pronunciation stays accurate even with no Azure subscription.
 */
export async function synthesizeEdgeBackendTts(
  params: {
    text: string;
    language: string;
    backendUrl: string;
  },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TtsSynthResult> {
  const { text, language, backendUrl } = params;

  let response;
  try {
    response = await fetchImpl(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      detail: timedOut
        ? "TTS provider timed out. Try again."
        : "Local TTS backend is unavailable.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      detail: `Local TTS backend error (${response.status}).`,
    };
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.length === 0) {
    return {
      ok: false,
      status: 502,
      detail: "TTS provider returned an empty audio response.",
    };
  }

  return { ok: true, contentType: "audio/mpeg", audioBytes: audio };
}


/**
 * Calls the ElevenLabs HTTP text-to-speech endpoint (eleven_multilingual_v2,
 * which auto-detects language so Burmese is spoken naturally). Returns raw MP3
 * bytes on success; memory is short-lived (audio is delivered directly).
 */
export async function synthesizeElevenLabsTts(
  params: {
    text: string;
    voice: string;
    apiKey: string;
    model: string;
  },
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<TtsSynthResult> {
  const { text, voice, apiKey, model } = params;

  let response;
  try {
    response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const timedOut =
      error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      detail: timedOut
        ? "TTS provider timed out. Try again."
        : "TTS service is temporarily unavailable.",
    };
  }

  if (!response.ok) {
    // Map the two most common, actionable failures to clear messages. We never
    // echo provider internals verbatim — the text below is curated.
    //  401 missing_permissions => the configured key lacks text_to_speech.
    //  402 / 429               => billing/quota; nothing the user code can do
    //                            except retry or top up the account.
    if (response.status === 401) {
      return {
        ok: false,
        status: 502,
        detail:
          "TTS not authorized: the configured ElevenLabs key lacks text_to_speech permission. Use a key that includes TTS.",
      };
    }
    if (response.status === 402 || response.status === 429) {
      return {
        ok: false,
        status: 502,
        detail:
          "TTS provider quota/billing error. Check the ElevenLabs account balance or rate limits.",
      };
    }
    // Keep other errors safe and generic — don't echo provider internals.
    return {
      ok: false,
      status: 502,
      detail: `TTS provider error (${response.status}).`,
    };
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.length === 0) {
    return {
      ok: false,
      status: 502,
      detail: "TTS provider returned an empty audio response.",
    };
  }

  return {
    ok: true,
    contentType: "audio/mpeg",
    audioBytes: audio as Uint8Array,
  };
}