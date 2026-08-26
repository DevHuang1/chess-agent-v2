/**
 * Shared browser voice-recording + transcription helpers for the Voice Coach
 * flow. This deliberately does NOT touch move parsing — the Voice Move path in
 * SpeechTab.tsx keeps its own MediaRecorder wiring (but shares these capture
 * helpers). Voice Coach reuses the same /api/transcribe endpoint (language=my)
 * that Voice Move already relies on.
 */

/**
 * Mic constraints tuned for Burmese speech: mono 48 kHz with browser noise
 * suppression and auto gain. Burmese is tonal and has creaky-voice finals,
 * so a clean, level-consistent mono signal matters more than stereo width.
 */
export const MIC_CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48_000,
  },
};

/** Preferred recording container/codecs, best first. */
const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4", // Safari
];

/**
 * Pick the first recording mimeType the browser actually supports. Pure in
 * the `isSupported` predicate so tests can inject fake support tables.
 */
export function selectRecorderMimeType(
  isSupported: (mimeType: string) => boolean,
): string | null {
  for (const mimeType of RECORDER_MIME_CANDIDATES) {
    if (isSupported(mimeType)) return mimeType;
  }
  return null;
}

/**
 * Wrap a MediaStream in a MediaRecorder using the best supported format at a
 * bitrate high enough to preserve Burmese tones (the default Opus VOIP mode
 * sits near 24-32 kbps, which smears tone contours). Returns null when the
 * browser exposes no usable recorder configuration.
 */
export function createVoiceRecorder(stream: MediaStream): MediaRecorder | null {
  if (typeof MediaRecorder === "undefined") return null;
  const isSupported = (mimeType: string) => {
    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  };
  const mimeType = selectRecorderMimeType(isSupported);
  try {
    if (mimeType === null) return new MediaRecorder(stream);
    // 128 kbps keeps tonal contours and consonant clusters intact.
    return new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 });
  } catch {
    try {
      return new MediaRecorder(stream); // Fall back to browser defaults.
    } catch {
      return null;
    }
  }
}

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
    stream = await navigator.mediaDevices.getUserMedia(MIC_CAPTURE_CONSTRAINTS);
  } catch {
    return null;
  }

  const recorder = createVoiceRecorder(stream);
  if (!recorder) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
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
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
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