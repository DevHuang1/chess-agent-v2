"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PrologAdvice = {
  priority: number;
  category: string;
  text: string;
};

const CATEGORY_VARIANT: Record<string, "destructive" | "warning" | "info" | "success" | "default"> = {
  safety: "destructive",
  tactics: "warning",
  opening: "info",
  strategy: "success",
  endgame: "default",
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
        <Badge
          variant={
            available === null
              ? "warning"
              : available
                ? "success"
                : "destructive"
          }
          className="text-[10px]"
          title={detail || "Rule-based reasoning via prolog/ai_system.pl"}
        >
          {available === null
            ? "Checking…"
            : available
              ? "Prolog Active"
              : "Unavailable"}
        </Badge>
      </div>

      {available === false ? (
        <Card className="border-zinc-800 bg-zinc-950/70 light:border-slate-300 light:bg-slate-50">
          <CardContent className="p-3 text-xs leading-relaxed text-zinc-400 light:text-slate-600">
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
          </CardContent>
        </Card>
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
              <Card
                key={`${item.priority}-${item.text}`}
                className="border-zinc-800 bg-zinc-900/90 light:border-slate-300 light:bg-white"
              >
                <CardContent className="p-3">
                  <Badge
                    variant={CATEGORY_VARIANT[item.category] ?? "muted"}
                    className="mb-1 text-[9px] uppercase"
                  >
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </Badge>
                  <p className="text-xs leading-relaxed text-zinc-200 light:text-slate-800">
                    {item.text}
                  </p>
                </CardContent>
              </Card>
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
