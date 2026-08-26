"use client";

import { useEffect, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  icon?: string;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
};

/**
 * Compact "⋯" dropdown for secondary actions, keeping primary controls
 * visible without crowding the toolbar.
 */
export default function OverflowMenu({
  items,
  label = "More actions",
}: {
  items: MenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`rounded-lg border border-zinc-700/60 bg-zinc-900 px-2.5 py-1.5 text-xs font-bold text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-300 light:border-slate-300 light:bg-white light:text-slate-700 light:hover:text-amber-700 ${
          open ? "border-amber-500/50 text-amber-300" : ""
        }`}
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 py-1 shadow-2xl light:border-slate-300 light:bg-white"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              title={item.title}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 light:text-slate-700 light:hover:bg-slate-100 light:hover:text-amber-700"
            >
              {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
