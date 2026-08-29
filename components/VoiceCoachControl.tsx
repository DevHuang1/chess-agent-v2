"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startVoiceRecording,
  transcribeVoiceAudio,
  type VoiceRecordingHandle,
} from "@/lib/voiceRecorder";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

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

  return (
    <Card
      data-voice-coach-control
      className="mb-3 border-teal-500/30 bg-teal-950/20 light:border-teal-300 light:bg-teal-50"
    >
      <CardContent className="p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-bold text-teal-300 light:text-teal-700">
            Burmese Voice Coach
          </p>
          <Badge
            variant={
              phase === "recording"
                ? "destructive"
                : phase === "transcribing"
                  ? "warning"
                  : "muted"
            }
            className={`text-[10px] ${phase === "recording" ? "animate-pulse" : ""}`}
          >
            {phase === "recording"
              ? "RECORDING"
              : phase === "transcribing"
                ? "TRANSCRIBING"
                : phase === "hasTranscript"
                  ? "READY"
                  : "IDLE"}
          </Badge>
        </div>

        <p className="mb-2 text-[11px] text-zinc-400 light:text-slate-600">
          Ask the coach a question in Burmese (e.g. ဒီအခြေအနေမှာ ဘယ်လိုရွှေ့သင့်လဲ).
          Your question is sent with the current position and answered in Burmese.
        </p>

        <div className="mb-2 flex items-center gap-2">
          <Button
            onClick={handleMicClick}
            disabled={phase === "transcribing" || disabled}
            variant={phase === "recording" ? "destructive" : "default"}
            className="flex-1"
          >
            {phase === "recording" ? "■ Stop" : "🎙️ Hold to ask"}
          </Button>
          <Button
            onClick={handleStopRecording}
            disabled={phase !== "recording"}
            variant="secondary"
            size="icon"
          >
            ✕
          </Button>
        </div>

        <label className="mb-2 flex items-center gap-2 text-[11px] text-zinc-400 light:text-slate-600">
          <Checkbox
            checked={autoSubmit}
            onChange={(event) => setAutoSubmit(event.target.checked)}
          />
          Send automatically after transcription
        </label>

        <Textarea
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder="Burmese transcript appears here — edit before asking."
          rows={2}
          aria-label="Voice coach transcript"
          className="mb-2 text-xs"
        />

        <Button
          onClick={handleSubmitClick}
          disabled={buttonDisabled}
          className="w-full"
        >
          {disabled || busy ? "Waiting..." : "Ask Coach"}
        </Button>

        {error && (
          <p className="mt-2 text-[11px] text-rose-300 light:text-rose-700">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
