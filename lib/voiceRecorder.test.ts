import { afterEach, describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import { parseChessMove } from "./speechParser";
import {
  createVoiceRecorder,
  MIC_CAPTURE_CONSTRAINTS,
  selectRecorderMimeType,
  startVoiceRecording,
  transcribeVoiceAudio,
} from "./voiceRecorder";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribeVoiceAudio", () => {
  it("posts to /api/transcribe with language=my", async () => {
    let postedUrl = "";
    let postedLanguage = "";
    let postedProvider = "";
    let formBody: FormData | null = null;

    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        postedUrl = String(input);
        formBody = init?.body instanceof FormData ? init.body : null;
        if (formBody) {
          postedLanguage = formBody.get("language")?.toString() ?? "";
          postedProvider = formBody.get("provider")?.toString() ?? "";
        }
        return new Response(JSON.stringify({ text: "မင်္ဂလာပါ" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    const blob = new Blob(["fake"], { type: "audio/webm" });
    const result = await transcribeVoiceAudio(blob, { provider: "groq" });

    expect(postedUrl).toBe("/api/transcribe");
    expect(postedLanguage).toBe("my");
    expect(postedProvider).toBe("groq");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("မင်္ဂလာပါ");
  });

  it("returns a friendly error on a provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ detail: "All Burmese transcription tiers failed." }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const result = await transcribeVoiceAudio(new Blob(["x"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("transcription");
  });
});

describe("startVoiceRecording", () => {
  it("returns null when the browser has no microphone support", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    // No navigator.mediaDevices available in this test environment.
    const handle = await startVoiceRecording();
    expect(handle).toBeNull();
  });
});

describe("Burmese-tuned capture helpers", () => {
  it("requests a clean mono signal with noise suppression and auto gain", () => {
    const audio = MIC_CAPTURE_CONSTRAINTS.audio as MediaTrackConstraints;
    expect(audio.channelCount).toBe(1);
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.autoGainControl).toBe(true);
    expect(audio.echoCancellation).toBe(true);
    expect(audio.sampleRate).toBe(48_000);
  });

  it("selectRecorderMimeType prefers opus/webm, then webm, then mp4", () => {
    const all = () => true;
    const onlyWebm = (m: string) => m === "audio/webm";
    const onlyMp4 = (m: string) => m === "audio/mp4";
    const none = () => false;
    expect(selectRecorderMimeType(all)).toBe("audio/webm;codecs=opus");
    expect(selectRecorderMimeType(onlyWebm)).toBe("audio/webm");
    expect(selectRecorderMimeType(onlyMp4)).toBe("audio/mp4"); // Safari path
    expect(selectRecorderMimeType(none)).toBeNull();
  });

  it("createVoiceRecorder records at high bitrate with the selected mime", () => {
    let constructedWith: MediaRecorderOptions | undefined;
    class FakeRecorder {
      static isTypeSupported(m: string) {
        return m.startsWith("audio/webm");
      }
      mimeType: string;
      constructor(stream: MediaStream, opts?: MediaRecorderOptions) {
        constructedWith = opts;
        this.mimeType = opts?.mimeType ?? "audio/webm";
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    const recorder = createVoiceRecorder({} as MediaStream);
    expect(recorder).toBeInstanceOf(FakeRecorder);
    expect(constructedWith?.mimeType).toBe("audio/webm;codecs=opus");
    // Default Opus VOIP sits near 24-32 kbps — too low for Burmese tones.
    expect(constructedWith?.audioBitsPerSecond).toBe(128_000);
  });

  it("createVoiceRecorder falls back to defaults when options are rejected", () => {
    class PickyRecorder {
      static isTypeSupported() {
        return true;
      }
      mimeType = "audio/webm";
      constructor(_stream: MediaStream, opts?: MediaRecorderOptions) {
        if (opts) throw new TypeError("Unsupported options");
      }
    }
    vi.stubGlobal("MediaRecorder", PickyRecorder);
    const recorder = createVoiceRecorder({} as MediaStream);
    expect(recorder).toBeInstanceOf(PickyRecorder);
    expect(recorder?.mimeType).toBe("audio/webm");
  });
});

describe("Voice Move safety — incomplete/unknown transcription never parses as a move", () => {
  it("does not parse an arbitrary Burmese coach question as a move", () => {
    const board = new Chess();
    expect(
      parseChessMove("ဒီအခြေအနေမှာ ဘယ်လိုရွှေ့လို့ ရမလဲ", "my", board),
    ).toBeNull();
  });

  it("does not parse a piece without any destination square", () => {
    const board = new Chess();
    expect(parseChessMove("မြင်းကို ရွှေ့", "my", board)).toBeNull();
  });

  it("still parses a well-formed spoken Burmese move (Voice Move unchanged)", () => {
    const board = new Chess();
    // "မြင်း f3 ကို" -> White knight to f3 is legal at the start position.
    expect(parseChessMove("မြင်း f3 ကို", "my", board)).toBeTruthy();
  });
});