import { NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const BACKEND_TRANSCRIBE_URL =
  process.env.BACKEND_TRANSCRIBE_URL ?? "http://localhost:8000/api/transcribe";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL ?? "scribe_v2";
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

async function transcribeWithAssemblyAI(audioFile: Blob, language?: string): Promise<string | null> {
  const headers = { authorization: ASSEMBLYAI_API_KEY as string };
  const buf = Buffer.from(await audioFile.arrayBuffer());

  const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: buf,
    signal: AbortSignal.timeout(30000),
  });
  if (!uploadResponse.ok) {
    throw new Error(`AssemblyAI upload error (${uploadResponse.status}): ${await uploadResponse.text()}`);
  }
  const { upload_url } = (await uploadResponse.json()) as { upload_url: string };

  const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
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
  });
  if (!transcriptResponse.ok) {
    throw new Error(`AssemblyAI transcript error (${transcriptResponse.status}): ${await transcriptResponse.text()}`);
  }
  const { id } = (await transcriptResponse.json()) as { id: string };

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!pollResponse.ok) {
      throw new Error(`AssemblyAI poll error (${pollResponse.status}): ${await pollResponse.text()}`);
    }
    const poll = (await pollResponse.json()) as { status: string; text?: string };
    if (poll.status === "completed") return (poll.text ?? "").trim() || null;
    if (poll.status === "error") throw new Error(`AssemblyAI transcription failed`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("AssemblyAI transcription timed out");
}

async function transcribeWithElevenLabs(audioFile: Blob): Promise<string | null> {
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

async function transcribeWithLocalBackend(audioFile: Blob): Promise<string | null> {
  const backendForm = new FormData();
  backendForm.append("file", audioFile);
  backendForm.append("language", "my");
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
}

async function transcribeWithGemini(audioFile: Blob): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const buf = Buffer.from(await audioFile.arrayBuffer());
  const mimeType = audioFile.type || "audio/webm";
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: buf.toString("base64") } },
          {
            text: "Transcribe this audio exactly as heard. It is a chess move command in Burmese. Return only the transcription, no commentary.",
          },
        ],
      },
    ],
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const text = parts.map((p) => p.text ?? "").join("").trim();
  return text || null;
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

  const language = formData.get("language")?.toString() || undefined;
  const provider = formData.get("provider")?.toString() || undefined;

  if (provider === "assemblyai") {
    if (ASSEMBLYAI_API_KEY) {
      try {
        const assemblyText = await transcribeWithAssemblyAI(audioFile, language);
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

  if (language === "my") {
    const localText = await transcribeWithLocalBackend(audioFile);
    if (localText) return NextResponse.json({ text: localText });

    if (GEMINI_API_KEY) {
      try {
        const geminiText = await transcribeWithGemini(audioFile);
        if (geminiText) return NextResponse.json({ text: geminiText });
      } catch (error) {
        // Fall through to the final fallback if Gemini is unavailable.
        console.error("Gemini transcription failed:", error);
      }
    }
    return NextResponse.json(
      { detail: "All Burmese transcription tiers failed." },
      { status: 502 },
    );
  }

  if (!GROQ_API_KEY) {
    return NextResponse.json(
      { detail: "GROQ_API_KEY is not configured in environment." },
      { status: 400 },
    );
  }

  try {
    const groqForm = new FormData();
    groqForm.append("file", audioFile);
    groqForm.append("model", "whisper-large-v3-turbo");
    groqForm.append("response_format", "json");
    if (language) groqForm.append("language", language);

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: groqForm,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { detail: `Groq API error (${response.status}): ${text}` },
        { status: 502 },
      );
    }

    const data = (await response.json()) as { text?: string };
    return NextResponse.json({ text: data.text ?? "" });
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