"use client";

import type { Ref } from "react";

export interface CollapsedControllerRailProps {
  railRef: Ref<HTMLDivElement>;
  railLabelRef: Ref<HTMLSpanElement>;
  railStatusRef: Ref<HTMLSpanElement>;
  statusMessage: string;
}

export default function CollapsedControllerRail({
  railRef,
  railLabelRef,
  railStatusRef,
  statusMessage,
}: CollapsedControllerRailProps) {
  return (
    <div ref={railRef} className="mt-4 flex flex-1 flex-row items-center justify-center gap-3 text-center lg:flex-col">
      <span ref={railLabelRef} className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 lg:[writing-mode:vertical-rl] light:text-slate-500">
        Controller
      </span>
      <span
        ref={railStatusRef}
        className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
        title={statusMessage}
      />
    </div>
  );
}
