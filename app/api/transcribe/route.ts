import { NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

export async function POST(request: Request) {
  if (!GROQ_API_KEY) {
    return NextResponse.json(
      { detail: "GROQ_API_KEY is not configured in environment." },
      { status: 400 },
    );
  }

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