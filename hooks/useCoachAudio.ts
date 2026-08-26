"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toSpeechText } from "@/lib/speechText";

/**
 * useCoachAudio - manages playback of coach replies, one at a time.
 *
 * Responsibilities:
 *  - Generate a short-lived audio URL from the server-side /api/tts route.
 *  - Keep a session cache keyed by message id so the same reply is not
 *    re-generated when the user replays it.
 *  - Play/pause/stop/replay through a real HTMLAudioElement.
 *  - Enforce a single active speech response at a time.
 *  - Clean up audio + object URLs on unmount or when a new response starts.
 *  - Fall back to the visible text (optionally browser SpeechSynthesis) if TTS
 *    generation fails. Speech is skipped entirely under `muted`.
 *
 * This deliberately lives OUTSIDE lib/audio.ts, which is reserved for chess
 * sound effects.
 */

const MUTED_PREF_KEY = "sentio-coach-muted-v1";
const AUTOREAD_PREF_KEY = "sentio-coach-autoread-v1";

type AudioStatus =
  | { phase: "idle"; id: null }
  | { phase: "loading"; id: string }
  | { phase: "playing"; id: string }
  | { phase: "error"; id: string };

function readBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function useCoachAudio() {
  const [muted, setMutedState] = useState(() =>
    readBoolPref(MUTED_PREF_KEY, false),
  );
  const [autoRead, setAutoReadState] = useState(() =>
    readBoolPref(AUTOREAD_PREF_KEY, false),
  );
  const [status, setStatus] = useState<AudioStatus>({
    phase: "idle",
    id: null,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());

  const setMuted = useCallback((mutedValue: boolean) => {
    setMutedState(mutedValue);
    try {
      window.localStorage.setItem(MUTED_PREF_KEY, mutedValue ? "1" : "0");
    } catch {
      // Storage may be unavailable; the in-memory pref still applies.
    }
  }, []);

  const setAutoRead = useCallback((value: boolean) => {
    setAutoReadState(value);
    try {
      window.localStorage.setItem(AUTOREAD_PREF_KEY, value ? "1" : "0");
    } catch {
      // Storage may be unavailable.
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.remove();
      audioRef.current = null;
    }
    setStatus({ phase: "idle", id: null });
  }, []);

  // Clean up active audio + all cached object URLs on unmount.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
        audio.remove();
      }
      cache.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke errors.
        }
      });
      cache.clear();
    };
  }, []);

  const playUrl = useCallback(
    (url: string, messageId: string) => {
      return new Promise<void>((resolve, reject) => {
        const previous = audioRef.current;
        if (previous) {
          previous.pause();
          previous.src = "";
          previous.remove();
        }
        const audio = new Audio(url);
        audioRef.current = audio;

        setStatus({ phase: "playing", id: messageId });

        audio.onended = () => {
          setStatus((current) =>
            current.phase === "playing" && current.id === messageId
              ? { phase: "idle", id: null }
              : current,
          );
          resolve();
        };
        audio.onerror = () => {
          setStatus({ phase: "error", id: messageId });
          reject(new Error("Audio playback failed"));
        };

        const playPromise = audio.play();
        if (playPromise) {
          playPromise.catch(() => {
            // Autoplay blocked -> keep the text visible; the user can press the
            // speaker button manually.
            setStatus({ phase: "error", id: messageId });
            reject(new Error("Autoplay was blocked by the browser"));
          });
        }
      });
    },
    [],
  );

  /**
   * Optional browser SpeechSynthesis fallback. Used only when server TTS fails
   * AND a usable Burmese voice actually exists - never assumed. When
   * unavailable, the Burmese text simply remains on screen.
   */
  const speakWithBrowser = useCallback((text: string) => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      !window.speechSynthesis
    ) {
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    const burmeseVoice = voices.find((voice) =>
      voice.lang.toLowerCase().startsWith("my"),
    );
    if (!burmeseVoice) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = burmeseVoice;
    utterance.lang = burmeseVoice.lang;
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    async (messageId: string, text: string) => {
      if (typeof window === "undefined") return;

      if (muted) return;

      // Coach replies are markdown (FEN lines, tables, bold markers). Strip
      // everything that is not natural prose before speaking or caching so
      // the voice never reads FEN strings or punctuation soup aloud.
      const spoken = toSpeechText(text);
      if (!spoken) return;

      // Stop any previous playback before starting a new one.
      stop();

      setStatus({ phase: "loading", id: messageId });

      const cached = cacheRef.current.get(messageId);
      if (cached) {
        await playUrl(cached, messageId).catch(() => {
          setStatus({ phase: "error", id: messageId });
        });
        return;
      }

      let url: string;
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 25000);
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: spoken, language: "my-MM" }),
          signal: controller.signal,
        });
        window.clearTimeout(timeout);
        if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
        const blob = await response.blob();
        if (blob.size === 0) throw new Error("Empty TTS audio");
        url = URL.createObjectURL(blob);
      } catch {
        // Server TTS unavailable - never block the text conversation. Try the
        // optional browser voice in the background, then show an error state.
        speakWithBrowser(spoken);
        setStatus({ phase: "error", id: messageId });
        return;
      }

      cacheRef.current.set(messageId, url);
      await playUrl(url, messageId).catch(() => {
        setStatus({ phase: "error", id: messageId });
      });
    },
    [muted, stop, playUrl, speakWithBrowser],
  );

  // Pre-load browser voices for the fallback path (voices load asynchronously).
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    const onVoicesChanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    return () => {
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        onVoicesChanged,
      );
    };
  }, []);

  return {
    muted,
    autoRead,
    status,
    speak,
    stop,
    setMuted,
    setAutoRead,
  };
}