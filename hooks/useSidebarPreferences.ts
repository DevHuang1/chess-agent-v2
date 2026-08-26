"use client";

import { useEffect, useState } from "react";

export type SidebarTab =
  | "coach"
  | "speech"
  | "logician"
  | "ai"
  | "benchmarks"
  | "3d"
  | "replay";

const SIDEBAR_PREFERENCES_KEY = "sentio-sidebar-preferences-v1";

/**
 * Persists the game-controller layout (expanded/wide/split/detached/splitTab)
 * to localStorage. Preferences are restored after mount to avoid hydration
 * mismatches, and written back whenever they change.
 */
export function useSidebarPreferences() {
  const [expanded, setExpanded] = useState(true);
  const [wide, setWide] = useState(false);
  const [split, setSplit] = useState(false);
  const [splitTab, setSplitTab] = useState<SidebarTab>("benchmarks");
  const [detached, setDetached] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(SIDEBAR_PREFERENCES_KEY);
        if (saved) {
          const preferences = JSON.parse(saved) as {
            expanded?: boolean;
            wide?: boolean;
            split?: boolean;
            splitTab?: SidebarTab;
            detached?: boolean;
          };
          if (typeof preferences.expanded === "boolean")
            setExpanded(preferences.expanded);
          if (typeof preferences.wide === "boolean") setWide(preferences.wide);
          if (typeof preferences.split === "boolean")
            setSplit(preferences.split);
          if (preferences.splitTab === "benchmarks") setSplitTab("benchmarks");
          if (typeof preferences.detached === "boolean")
            setDetached(preferences.detached);
        }
      } catch {
        // Corrupted preferences are ignored; defaults remain in effect.
      }
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(
        SIDEBAR_PREFERENCES_KEY,
        JSON.stringify({ expanded, wide, split, splitTab, detached }),
      );
    } catch {
      // Storage may be unavailable (private browsing); layout still works.
    }
  }, [ready, expanded, wide, split, splitTab, detached]);

  return {
    expanded,
    wide,
    split,
    splitTab,
    detached,
    ready,
    setExpanded,
    setWide,
    setSplit,
    setSplitTab,
    setDetached,
  };
}
