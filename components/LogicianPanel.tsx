"use client";

import { useEffect, useRef, useState } from "react";

type PrologAdvice = {
  priority: number;
  category: string;
  text: string;
};

const CATEGORY_STYLES: Record<string, string> = {
  safety:
    "bg-rose-500/15 text-rose-300 border-rose-500/30 light:bg-rose-100 light:text-rose-700 light:border-rose-300",
  tactics:
    "bg-amber-500/15 text-amber-300 border-amber-500/30 light:bg-amber-100 light:text-amber-700 light:border-amber-300",
  opening:
    "bg-cyan-500/15 text-cyan-300 border-cyan-500/30 light:bg-cyan-100 light:text-cyan-700 light:border-cyan-300",
  strategy:
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 light:bg-emerald-100 light:text-emerald-700 light:border-emerald-300",
  endgame:
    "bg-violet-500/15 text-violet-300 border-violet-500/30 light:bg-violet-100 light:text-violet-700 light:border-violet-300",
};

const CATEGORY_LABELS: Record<string, string> = {
  safety: "Safety",
  tactics: "Tactics",
  opening: "Opening",
  strategy: "Strategy",
  endgame: "Endgame",
};

/**
 * Logician panel — live chess advice derived from the Prolog knowledge base
 * (prolog/ai_system.pl) via the backend's /api/prolog-advice endpoint.
 *
 * Purely observational: it fetches advice for the current FEN and displays
 * prioritized recommendations. It never affects game logic, and degrades to
 * a setup hint when SWI-Prolog is not installed.
 */
export default function LogicianPanel({
  fen,
  active,
}: {
  fen: string;
  /** Whether this tab is currently visible; fetches only when active. */
  active: boolean;
}) {
  const [advice, setAdvice] = useState<PrologAdvice[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const seq = ++requestSeqRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsLoading(true);
        try {
          const response = await fetch("/api/prolog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fen }),
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw new Error("Logician service unavailable.");
          const data = (await response.json()) as {
            available?: boolean;
            detail?: string;
            advice?: PrologAdvice[];
          };
          // Ignore stale responses.
          if (seq !== requestSeqRef.current) return;
          setAvailable(data.available ?? false);
          setDetail(data.detail ?? "");
          setAdvice(data.advice ?? []);
        } catch (error) {
          if (seq !== requestSeqRef.current) return;
          setAvailable(false);
          setDetail(
            error instanceof Error ? error.message : "Logician unavailable.",
          );
          setAdvice([]);
        } finally {
          if (seq === requestSeqRef.current) setIsLoading(false);
        }
      })();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [fen, active]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-200 light:text-slate-800">
          The Logician
        </p>
        <span
          title={detail || "Rule-based reasoning via prolog/ai_system.pl"}
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
            available === null
              ? "bg-amber-950/80 text-amber-300 border border-amber-800/50 light:bg-amber-100 light:text-amber-700 light:border-amber-300"
              : available
                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 light:bg-emerald-100 light:text-emerald-700 light:border-emerald-300"
                : "bg-rose-950/80 text-rose-300 border border-rose-800/50 light:bg-rose-100 light:text-rose-700 light:border-rose-300"
          }`}
        >
          {available === null
            ? "Checking…"
            : available
              ? "Prolog Active"
              : "Unavailable"}
        </span>
      </div>

      {available === false ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-xs leading-relaxed text-zinc-400 light:border-slate-300 light:bg-slate-50 light:text-slate-600">
          <p className="font-semibold text-zinc-300 light:text-slate-700">
            Prolog reasoning is not available.
          </p>
          <p className="mt-1">{detail}</p>
          <p className="mt-2">
            To enable it: install{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-amber-300 light:bg-slate-200 light:text-amber-700">
              swi-prolog
            </code>{" "}
            (e.g.{" "}
            <code className="font-mono text-[10px]">
              brew install swi-prolog
            </code>
            ) and run{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-amber-300 light:bg-slate-200 light:text-amber-700">
              pip install pyswip python-chess
            </code>{" "}
            in the backend venv, then restart the backend.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 chat-scroll">
          {isLoading && advice.length === 0 ? (
            <p className="text-xs italic text-zinc-500 light:text-slate-500">
              Reasoning over the position…
            </p>
          ) : advice.length === 0 && !isLoading ? (
            <p className="text-xs italic text-zinc-500 light:text-slate-500">
              No rule-based advice for this position — play on!
            </p>
          ) : (
            advice.map((item) => (
              <div
                key={`${item.priority}-${item.text}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 light:border-slate-300 light:bg-white"
              >
                <span
                  className={`mb-1 inline-block rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    CATEGORY_STYLES[item.category] ??
                    "border-zinc-700 bg-zinc-800 text-zinc-400 light:border-slate-300 light:bg-slate-200 light:text-slate-600"
                  }`}
                >
                  {CATEGORY_LABELS[item.category] ?? item.category}
                </span>
                <p className="text-xs leading-relaxed text-zinc-200 light:text-slate-800">
                  {item.text}
                </p>
              </div>
            ))
          )}
          {isLoading && advice.length > 0 ? (
            <p className="text-[10px] italic text-zinc-600 light:text-slate-500">
              updating…
            </p>
          ) : null}
        </div>
      )}

      <p className="mt-2 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600 light:border-slate-200 light:text-slate-500">
        Rule-based reasoning from{" "}
        <span className="font-mono">prolog/ai_system.pl</span> — symbolic AI
        alongside the Stockfish search.
      </p>
    </div>
  );
}
