/**
 * Shared browser voice-recording + transcription helpers for the Voice Coach
 * flow. This deliberately does NOT touch move parsing — the Voice Move path in
 * SpeechTab.tsx keeps its own MediaRecorder wiring. Voice Coach reuses the same
 * /api/transcribe endpoint (language=my) that Voice Move already relies on.
 */


/**
 * A handle for an in-progress microphone recording.
 */
export type VoiceRecordingHandle = {
  /** Stop the recorder, stop all media tracks, and return the audio blob. */
  stop: () => Promise<Blob | null>;
  /** Abort the recording and release the microphone immediately. */
  cancel: () => void;
};

/**
 * Opens the microphone and starts recording. Returns null when getUserMedia or
 * MediaRecorder is unavailable (e.g. permission denied, unsupported browser).
 * Callers MUST always invoke stop() or cancel() so microphone tracks are
 * released and the mic does not stay active.
 */
export async function startVoiceRecording(): Promise<VoiceRecordingHandle | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return null;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.start();
  let stopped = false;

  return {
    stop: () => {
      if (stopped) return Promise.resolve(null);
      stopped = true;
      return new Promise<Blob | null>((resolve) => {
        recorder.onstop = () => {
          // Always stop every track so the mic light turns off and the
          // microphone is released to other apps.
          stream.getTracks().forEach((track) => track.stop());
          const blob = new Blob(chunks, { type: "audio/webm" });
          resolve(blob.size > 0 ? blob : null);
        };
        if (recorder.state !== "inactive") recorder.stop();
        else resolve(null);
      });
    },
    cancel: () => {
      stream.getTracks().forEach((track) => track.stop());
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore recorder teardown errors.
        }
      }
    },
  };
}

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; detail: string };

/**
 * Posts an audio blob to /api/transcribe with language=my and, optionally, a
 * provider hint (groq/elevenlabs/assemblyai). Reuses the exact endpoint the
 * Voice Move flow uses, so no second recorder/transcriber is introduced.
 */
export async function transcribeVoiceAudio(
  blob: Blob,
  opts?: { provider?: string },
): Promise<TranscribeResult> {
  const formData = new FormData();
  formData.append("file", blob, "recording.webm");
  formData.append("language", "my");
  if (opts?.provider) formData.append("provider", opts.provider);

  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });
    const data = (await response.json()) as { text?: string; detail?: string };
    if (response.ok && data.text) {
      return { ok: true, text: data.text };
    }
    return { ok: false, detail: data.detail ?? `Transcription failed (${response.status}).` };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error
          ? error.message
          : "Transcription service is unavailable.",
    };
  }
}