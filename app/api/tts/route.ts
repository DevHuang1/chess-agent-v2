import { NextResponse } from "next/server";
import {
  synthesizeAzureTts,
  synthesizeEdgeBackendTts,
  synthesizeElevenLabsTts,
  validateTtsInput,
  AZURE_VOICE_BURMESE,
  type TtsInput,
} from "@/lib/tts";

/**
 * Sentio server-side Burmese text-to-speech proxy.
 *
 * The browser never talks to ElevenLabs directly — it posts a small JSON body
 * ({ text, language }) and receives an `audio/mpeg` buffer back. API keys stay
 * server-side (process.env) and are never exposed to the client. All request
 * validation and the provider call live in lib/tts.ts so they are
 * unit-testable without a Next.js runtime.
 *
 * Provider priority:
 *   1. Azure Speech REST API — official GA Burmese neural voices (when
 *      AZURE_SPEECH_KEY/AZURE_SPEECH_REGION are configured).
 *   2. Local edge-tts bridge (backend POST /tts) — the same Burmese neural
 *      voices via Microsoft Edge's speech endpoint; no Azure account needed.
 *   3. ElevenLabs `eleven_multilingual_v2` fallback — approximates Burmese.
 *
 * Audio is served as raw bytes (no permanent storage, no database) so the
 * frontend can play it through an object URL and release it with
 * URL.revokeObjectURL().
 *
 * Availability: Azure requires env credentials; the edge bridge requires the
 * local Python backend to be running; ElevenLabs requires ELEVENLABS_API_KEY.
 * If every configured provider fails, the route returns a safe error and the
 * route returns a safe error and the caller must fall back to the on-screen
 * text (optionally browser SpeechSynthesis).
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_TTS_MODEL =
  process.env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2";
const ELEVENLABS_TTS_VOICE_ID =
  process.env.ELEVENLABS_TTS_VOICE_ID ?? "CwhRBWXzGAHq8TQ4Fs17";
// Azure Speech is the PRIMARY TTS provider because it ships dedicated,
// generally-available Burmese neural voices (my-MM-NilarNeural / ThihaNeural)
// — pronunciation is accurate, unlike ElevenLabs' multilingual approximation.
// When Azure credentials are absent the route falls back to ElevenLabs.
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;
const AZURE_TTS_VOICE_MY =
  process.env.AZURE_TTS_VOICE_MY ?? AZURE_VOICE_BURMESE;
// Local edge-tts bridge (backend/main.py POST /tts). Serves the same
// generally-available Burmese neural voices as Azure Speech without needing
// an Azure account, so pronunciation stays accurate when Azure is not
// configured. Tried between Azure and the ElevenLabs approximation.
const BACKEND_TTS_URL =
  process.env.BACKEND_TTS_URL ?? "http://localhost:8000/tts";

export async function POST(request: Request) {
  let payload: TtsInput;
  try {
    payload = (await request.json()) as TtsInput;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateTtsInput(payload);
  if (!validated.ok) {
    return NextResponse.json(
      { detail: validated.detail },
      { status: validated.status },
    );
  }

  const azureConfigured = Boolean(AZURE_SPEECH_KEY && AZURE_SPEECH_REGION);

  // Primary path: Azure neural TTS (official, GA Burmese voices).
  if (azureConfigured) {
    const azure = await synthesizeAzureTts({
      text: validated.text,
      language: validated.language,
      voice:
        validated.voice ??
        (validated.language === "en-US" ? undefined : AZURE_TTS_VOICE_MY),
      apiKey: AZURE_SPEECH_KEY as string,
      region: AZURE_SPEECH_REGION as string,
    });
    if (azure.ok) {
      return new NextResponse(azure.audioBytes.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": azure.contentType,
          "Cache-Control": "private, max-age=0, must-revalidate",
          "Content-Length": String(azure.audioBytes.byteLength),
          "X-TTS-Provider": "azure",
        },
      });
    }
    // Azure configured but failed — fall through to ElevenLabs if possible.
    if (!ELEVENLABS_API_KEY) {
      return NextResponse.json({ detail: azure.detail }, { status: 502 });
    }
  }

  // Secondary path: local edge-tts bridge — same generally-available Burmese
  // neural voices as Azure Speech (my-MM-NilarNeural), reached without an
  // Azure account via Microsoft Edge's speech endpoint. Tried before the
  // ElevenLabs multilingual approximation whenever the Python backend runs.
  const edge = await synthesizeEdgeBackendTts({
    text: validated.text,
    language: validated.language,
    backendUrl: BACKEND_TTS_URL,
  });
  if (edge.ok) {
    return new NextResponse(edge.audioBytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": edge.contentType,
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Length": String(edge.audioBytes.byteLength),
        "X-TTS-Provider": "edge",
      },
    });
  }

  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { detail: azureConfigured ? "TTS providers failed." : edge.detail },
      { status: 502 },
    );
  }

  const result = await synthesizeElevenLabsTts({
    text: validated.text,
    voice: validated.voice ?? ELEVENLABS_TTS_VOICE_ID,
    apiKey: ELEVENLABS_API_KEY,
    model: ELEVENLABS_TTS_MODEL,
  });

  if (!result.ok) {
    return NextResponse.json({ detail: result.detail }, { status: 502 });
  }

  return new NextResponse(result.audioBytes.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Length": String(result.audioBytes.byteLength),
      "X-TTS-Provider": azureConfigured
        ? "elevenlabs-fallback"
        : "elevenlabs",
    },
  });
}