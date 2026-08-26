"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startVoiceRecording,
  transcribeVoiceAudio,
  type VoiceRecordingHandle,
} from "@/lib/voiceRecorder";

type VoiceCoachControlProps = {
  /** Called with the transcribed (and user-editable) Burmese question. */
  onTranscriptReady: (text: string) => void;
  /** Called to ask the coach with the given question text. */
  onSubmit: (text: string) => void;
  /** True while a coach request is in flight — disables all actions. */
  disabled: boolean;
};

type Phase =
  | "idle"
  | "recording"
  | "transcribing"
  | "hasTranscript"
  | "error";

/**
 * Voice Coach control — a push-to-talk mic that records a short Burmese clip,
 * transcribes it via the existing /api/transcribe path, shows the raw editable
 * transcript, and submits it to handleAskCoach(). Kept logically and visibly
 * separate from the Voice Move tab (SpeechTab.tsx).
 */
export default function VoiceCoachControl({
  onTranscriptReady,
  onSubmit,
  disabled,
}: VoiceCoachControlProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const recordingRef = useRef<VoiceRecordingHandle | null>(null);

  const stopRecording = useCallback(() => {
    const handle = recordingRef.current;
    recordingRef.current = null;
    return handle?.stop() ?? Promise.resolve(null);
  }, []);

  const releaseRecording = useCallback(() => {
    const handle = recordingRef.current;
    recordingRef.current = null;
    if (handle) handle.cancel();
  }, []);

  // On unmount, guarantee the microphone is released.
  useEffect(() => {
    return () => {
      releaseRecording();
    };
  }, [releaseRecording]);

  const handleStopRecording = useCallback(async () => {
    setPhase("recording");
    const blob = await stopRecording();
    if (!blob) {
      setError("No audio was captured. Try again.");
      setPhase("idle");
      return;
    }

    setPhase("transcribing");
    setError("");
    const result = await transcribeVoiceAudio(blob);
    if (result.ok) {
      const text = result.text.trim();
      setTranscript(text);
      setPhase("hasTranscript");
      onTranscriptReady(text);
      if (autoSubmit && text) {
        setIsSubmitting(true);
        try {
          onSubmit(text);
        } finally {
          setIsSubmitting(false);
        }
      }
    } else {
      setError(result.detail);
      setPhase("idle");
    }
  }, [autoSubmit, onTranscriptReady, onSubmit, stopRecording]);

  const handleMicClick = useCallback(async () => {
    setError("");
    if (phase === "idle" || phase === "hasTranscript") {
      const handle = await startVoiceRecording();
      if (!handle) {
        setError("Microphone permission denied or unavailable.");
        return;
      }
      recordingRef.current = handle;
      setTranscript("");
      setPhase("recording");
      return;
    }
    if (phase === "recording") {
      await handleStopRecording();
    }
  }, [phase, handleStopRecording]);

  const handleSubmitClick = useCallback(() => {
    if (!transcript.trim() || disabled || isSubmitting) return;
    onTranscriptReady(transcript.trim());
    setIsSubmitting(true);
    try {
      onSubmit(transcript.trim());
    } finally {
      setIsSubmitting(false);
    }
  }, [transcript, disabled, isSubmitting, onTranscriptReady, onSubmit]);

  const busy = isSubmitting || phase === "transcribing";
  const buttonDisabled = disabled || busy || phase !== "hasTranscript" || !transcript.trim();
  // __VOICE_COACH_JSX__

  return (
    <div
      data-voice-coach-control
      className="mb-3 rounded-xl border border-teal-500/30 bg-teal-950/20 p-3 light:border-teal-300 light:bg-teal-50"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-bold text-teal-300 light:text-teal-700">
          🎙️ Burmese Voice Coach
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            phase === "recording"
              ? "animate-pulse bg-rose-900/60 text-rose-200 light:bg-rose-100 light:text-rose-700"
              : phase === "transcribing"
                ? "bg-amber-900/60 text-amber-200 light:bg-amber-100 light:text-amber-700"
                : "bg-zinc-800 text-zinc-400 light:bg-slate-100 light:text-slate-500"
          }`}
        >
          {phase === "recording"
            ? "RECORDING"
            : phase === "transcribing"
              ? "TRANSCRIBING"
              : phase === "hasTranscript"
                ? "READY"
                : "IDLE"}
        </span>
      </div>

      <p className="mb-2 text-[11px] text-zinc-400 light:text-slate-600">
        Ask the coach a question in Burmese (e.g. ဒီအခြေအနေမှာ ဘယ်လိုရွှေ့သင့်လဲ).
        Your question is sent with the current position and answered in Burmese.
      </p>

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={handleMicClick}
          disabled={phase === "transcribing" || disabled}
          aria-label={phase === "recording" ? "Stop recording" : "Start recording"}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-40 ${
            phase === "recording"
              ? "bg-rose-600 text-white hover:bg-rose-500"
              : "bg-teal-600 text-white hover:bg-teal-500"
          }`}
        >
          {phase === "recording" ? "■ Stop" : "🎙️ Hold to ask"}
        </button>
        <button
          type="button"
          onClick={handleStopRecording}
          disabled={phase !== "recording"}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-40 light:bg-slate-200 light:text-slate-700"
        >
          ✕
        </button>
      </div>

      <label className="mb-2 flex items-center gap-2 text-[11px] text-zinc-400 light:text-slate-600">
        <input
          type="checkbox"
          checked={autoSubmit}
          onChange={(event) => setAutoSubmit(event.target.checked)}
          className="accent-teal-500"
        />
        Send automatically after transcription
      </label>

      <textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder="Burmese transcript appears here — edit before asking."
        rows={2}
        aria-label="Voice coach transcript"
        className="mb-2 w-full resize-none rounded-lg border border-zinc-700/80 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none focus:border-teal-500/60 light:border-slate-300 light:bg-white light:text-slate-800"
      />

      <button
        type="button"
        onClick={handleSubmitClick}
        disabled={buttonDisabled}
        className="w-full rounded-lg bg-teal-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-teal-400 transition-colors disabled:opacity-40"
      >
        {disabled || busy
          ? "Waiting..."
          : "Ask Coach"}
      </button>

      {error && (
        <p className="mt-2 text-[11px] text-rose-300 light:text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}