import { NextResponse } from "next/server";

/**
 * Proxy for the Logician (Prolog) panel. Forwards a FEN to the Python
 * backend's /api/prolog-advice endpoint, which converts the position into
 * Prolog facts and queries the knowledge base for prioritized advice.
 *
 * Purely additive: when the backend reports Prolog as unavailable (e.g.
 * SWI-Prolog not installed), the response is passed through so the UI can
 * show a setup hint. No other part of the app depends on this route.
 */

const BACKEND_PROLOG_API_URL =
  process.env.BACKEND_PROLOG_API_URL ??
  "http://127.0.0.1:8000/api/prolog-advice";

type PrologAdvice = {
  priority: number;
  category: string;
  text: string;
};

type PrologResponse = {
  available: boolean;
  detail?: string;
  advice?: PrologAdvice[];
};

export async function POST(request: Request) {
  let payload: { fen?: string };

  try {
    payload = (await request.json()) as { fen?: string };
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  if (!payload?.fen || typeof payload.fen !== "string") {
    return NextResponse.json(
      { detail: "Request body must include a valid fen string." },
      { status: 400 },
    );
  }

  try {
    const backendResponse = await fetch(BACKEND_PROLOG_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen: payload.fen }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!backendResponse.ok) {
      const detail = await backendResponse.text();
      return NextResponse.json(
        { available: false, detail: `Prolog backend error: ${detail}` },
        { status: 200 },
      );
    }

    const data = (await backendResponse.json()) as PrologResponse;
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        detail:
          error instanceof Error
            ? `Prolog backend unreachable: ${error.message}`
            : "Prolog backend unreachable.",
      },
      { status: 200 },
    );
  }
}
