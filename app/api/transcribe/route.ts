import { NextResponse } from "next/server";
import { looksLikeBurmese } from "@/lib/burmese";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// whisper-large-v3-turbo handles Burmese acceptably; the non-turbo
// whisper-large-v3 is stronger on low-resource languages when accuracy
// matters more than latency — configurable via env.
const GROQ_MODEL = process.env.GROQ_STT_MODEL ?? "whisper-large-v3-turbo";
// Reject oversized uploads before buffering them into memory (and before
// base64-encoding them for Gemini).
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const BACKEND_TRANSCRIBE_URL =
  process.env.BACKEND_TRANSCRIBE_URL ?? "http://localhost:8000/api/transcribe";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL ?? "scribe_v2";
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

/**
 * Vocabulary boost for Whisper decoding of Burmese chess speech. The prompt
 * biases the decoder toward the piece words and square-letter sounds it
 * habitually mangles (Burmese has no /f/, so "f3" surfaces as အာပ်/အဖ်...).
 * Also carries the English notation the parser expects back.
 */
const BURMESE_STT_PROMPT = [
  "မြန်မာစကား စစ်ဆေးရန် အသံ။",
  "Chess vocabulary: ဘုရင် (king), မိဖုရား (queen), ရိုက် (rook), လှေ (rook),",
  "ဆင် (bishop), မြင်း (knight), နိုင်/စစ်သား (pawn).",
  'Squares sound like: "အီး သုံး" = e3, "အာပ် ဖိုး" = f4, "ဘီ နှစ်" = b2.',
  "Keep chess notation (a-h, 1-8, Nf3, O-O) in Latin letters.",
].join(" ");

/**
 * Groq-hosted Whisper transcription. `prompt` optionally steers decoding
 * toward domain vocabulary; temperature 0 keeps results deterministic so
 * retries don't reshuffle mishearings.
 */
async function transcribeWithGroq(
  audioFile: Blob,
  language?: string,
  prompt?: string,
): Promise<string | null> {
  if (!GROQ_API_KEY) return null;
  const groqForm = new FormData();
  groqForm.append("file", audioFile);
  groqForm.append("model", GROQ_MODEL);
  groqForm.append("response_format", "json");
  groqForm.append("temperature", "0");
  if (language) groqForm.append("language", language);
  if (prompt) groqForm.append("prompt", prompt);

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: groqForm,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim() || null;
}

async function transcribeWithAssemblyAI(
  audioFile: Blob,
  language?: string,
): Promise<string | null> {
  const headers = { authorization: ASSEMBLYAI_API_KEY as string };
  const buf = Buffer.from(await audioFile.arrayBuffer());

  const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: buf,
    signal: AbortSignal.timeout(30000),
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `AssemblyAI upload error (${uploadResponse.status}): ${await uploadResponse.text()}`,
    );
  }
  const { upload_url } = (await uploadResponse.json()) as {
    upload_url: string;
  };

  const transcriptResponse = await fetch(
    "https://api.assemblyai.com/v2/transcript",
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: upload_url,
        language_code: language,
        speech_models: ["universal-3-5-pro", "universal-2"],
        punctuate: false,
        format_text: false,
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!transcriptResponse.ok) {
    throw new Error(
      `AssemblyAI transcript error (${transcriptResponse.status}): ${await transcriptResponse.text()}`,
    );
  }
  const { id } = (await transcriptResponse.json()) as { id: string };

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const pollResponse = await fetch(
      `https://api.assemblyai.com/v2/transcript/${id}`,
      {
        headers,
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!pollResponse.ok) {
      throw new Error(
        `AssemblyAI poll error (${pollResponse.status}): ${await pollResponse.text()}`,
      );
    }
    const poll = (await pollResponse.json()) as {
      status: string;
      text?: string;
    };
    if (poll.status === "completed") return (poll.text ?? "").trim() || null;
    if (poll.status === "error")
      throw new Error(`AssemblyAI transcription failed`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("AssemblyAI transcription timed out");
}

async function transcribeWithElevenLabs(
  audioFile: Blob,
): Promise<string | null> {
  const form = new FormData();
  form.append("file", audioFile, "recording.webm");
  form.append("model_id", ELEVENLABS_MODEL);
  form.append("language_code", "mya");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY as string },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim() || null;
}

async function transcribeWithLocalBackend(
  audioFile: Blob,
): Promise<string | null> {
  const backendForm = new FormData();
  backendForm.append("file", audioFile);
  backendForm.append("language", "my");
  try {
    const response = await fetch(BACKEND_TRANSCRIBE_URL, {
      method: "POST",
      body: backendForm,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      console.error(
        "Local transcription failed:",
        response.status,
        await response.text(),
      );
      return null;
    }
    const data = (await response.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return text || null;
  } catch (error) {
    console.error(
      "Local transcription backend unavailable:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function transcribeWithGemini(audioFile: Blob): Promise<string | null> {
  // The API key goes in a header, not the URL — keys in query strings leak
  // into server logs, proxies, and error reporters.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const buf = Buffer.from(await audioFile.arrayBuffer());
  const mimeType = audioFile.type || "audio/webm";
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: buf.toString("base64") } },
          {
            text: "Transcribe this audio exactly as heard. It is spoken in Burmese (Myanmar) — it may be a chess move command or a general question about the game. Write Burmese in Myanmar script and keep any chess notation (piece letters, squares like e4, Nf3, O-O) in Latin letters. Return only the transcription, no commentary.",
          },
        ],
      },
    ],
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY as string,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${text}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return text || null;
}

// ---------------------------------------------------------------------------
// Burmese transcription chain
//
// The local Whisper fine-tune can hallucinate replacement-character soup or a
// non-Burmese script (Thai, Devanagari, Han) while reporting HTTP 200, and
// whisper-large on Groq struggles with Burmese tonality the same way. Every
// tier is therefore gated on `looksLikeBurmese` and the chain keeps trying
// providers until one actually returns Myanmar script text (or a short chess
// token such as "O-O"). ElevenLabs Scribe with `language_code: mya` is the
// most reliable recorded Burmese engine, so it leads the default chain; the
// offline local model is always the last resort and its garbage can never
// shadow a working cloud tier.
// ---------------------------------------------------------------------------

type BurmeseTier = {
  name: string;
  run: () => Promise<string | null>;
};

function buildBurmeseTiers(
  audioFile: Blob,
  preferred?: string,
): BurmeseTier[] {
  const tiers: BurmeseTier[] = [];
  const push = (
    name: string,
    available: boolean,
    run: () => Promise<string | null>,
  ) => {
    if (available) tiers.push({ name, run });
  };
  const pref = preferred?.toLowerCase();

  // The provider explicitly picked in the Speech tab leads the chain.
  if (pref === "elevenlabs") {
    push("elevenlabs", Boolean(ELEVENLABS_API_KEY), () =>
      transcribeWithElevenLabs(audioFile),
    );
  }
  if (pref === "assemblyai") {
    push("assemblyai", Boolean(ASSEMBLYAI_API_KEY), () =>
      transcribeWithAssemblyAI(audioFile, "my"),
    );
  }
  if (pref === "groq") {
    push("groq", Boolean(GROQ_API_KEY), () =>
      transcribeWithGroq(audioFile, "my", BURMESE_STT_PROMPT),
    );
  }

  // Default quality chain (also follows an explicit preference so a failing
  // or garbage tier falls through to better options).
  if (pref !== "elevenlabs") {
    push("elevenlabs", Boolean(ELEVENLABS_API_KEY), () =>
      transcribeWithElevenLabs(audioFile),
    );
  }
  if (pref !== "gemini") {
    push("gemini", Boolean(GEMINI_API_KEY), () =>
      transcribeWithGemini(audioFile),
    );
  }
  if (pref !== "groq") {
    push("groq", Boolean(GROQ_API_KEY), () =>
      transcribeWithGroq(audioFile, "my", BURMESE_STT_PROMPT),
    );
  }
  if (pref !== "assemblyai") {
    push("assemblyai", Boolean(ASSEMBLYAI_API_KEY), () =>
      transcribeWithAssemblyAI(audioFile, "my"),
    );
  }

  // Offline last resort.
  push("local", true, () => transcribeWithLocalBackend(audioFile));
  return tiers;
}

async function transcribeBurmese(
  audioFile: Blob,
  preferred?: string,
): Promise<string | null> {
  for (const tier of buildBurmeseTiers(audioFile, preferred)) {
    try {
      const text = await tier.run();
      if (text && looksLikeBurmese(text)) return text;
      if (text) {
        console.warn(
          `[transcribe] ${tier.name} tier returned unusable Burmese output ` +
            `(${JSON.stringify(text.slice(0, 80))}) — trying the next tier.`,
        );
      }
    } catch (error) {
      console.warn(`[transcribe] ${tier.name} tier failed:`, error);
    }
  }
  return null;
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ detail: "Invalid form data." }, { status: 400 });
  }

  const audioFile = formData.get("file");
  if (!audioFile || !(audioFile instanceof Blob)) {
    return NextResponse.json(
      { detail: "No audio file provided." },
      { status: 400 },
    );
  }

  if (audioFile.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { detail: "Audio file too large (max 15MB)." },
      { status: 413 },
    );
  }

  const language = formData.get("language")?.toString() || undefined;
  const provider = formData.get("provider")?.toString() || undefined;

  // Burmese path: quality-ordered, garbage-gated tier chain. The explicitly
  // selected provider leads; otherwise ElevenLabs Scribe (mya) is tried
  // first, then Gemini, Groq Whisper, AssemblyAI, and finally the offline
  // local model. Each result must actually contain Burmese content — a
  // failing engine can no longer shadow a working one.
  if (language === "my") {
    const text = await transcribeBurmese(audioFile, provider);
    if (text) return NextResponse.json({ text });
    return NextResponse.json(
      { detail: "All Burmese transcription tiers failed." },
      { status: 502 },
    );
  }

  if (provider === "assemblyai") {
    if (ASSEMBLYAI_API_KEY) {
      try {
        const assemblyText = await transcribeWithAssemblyAI(
          audioFile,
          language,
        );
        if (assemblyText) return NextResponse.json({ text: assemblyText });
      } catch (error) {
        console.error("AssemblyAI transcription failed:", error);
      }
    }
    const localText = await transcribeWithLocalBackend(audioFile);
    if (localText) return NextResponse.json({ text: localText });
    return NextResponse.json(
      { detail: "AssemblyAI and local transcription both failed." },
      { status: 502 },
    );
  }

  if (provider === "elevenlabs") {
    if (ELEVENLABS_API_KEY) {
      try {
        const elevenLabsText = await transcribeWithElevenLabs(audioFile);
        if (elevenLabsText) return NextResponse.json({ text: elevenLabsText });
      } catch (error) {
        console.error("ElevenLabs transcription failed:", error);
      }
    }
    const localText = await transcribeWithLocalBackend(audioFile);
    if (localText) return NextResponse.json({ text: localText });
    return NextResponse.json(
      { detail: "ElevenLabs and local transcription both failed." },
      { status: 502 },
    );
  }

  try {
    const groqText = await transcribeWithGroq(audioFile, language);
    if (groqText !== null) return NextResponse.json({ text: groqText });
    return NextResponse.json(
      { detail: "GROQ_API_KEY is not configured in environment." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error ? error.message : "Groq transcription failed.",
      },
      { status: 502 },
    );
  }
}
