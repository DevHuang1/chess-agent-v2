"use client";

import { Chess, Square, type Move } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseChessMove } from "@/lib/speechParser";
import { censorText } from "@/lib/censor";
import { playMoveSound, playCaptureSound, playCheckSound } from "@/lib/audio";

declare global {
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
  }

  interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
  }

  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

const LANGUAGES = [
  { code: "en-US", label: "English", langKey: "en" },
  { code: "es-ES", label: "Español", langKey: "es" },
  { code: "fr-FR", label: "Français", langKey: "fr" },
  { code: "de-DE", label: "Deutsch", langKey: "de" },
  { code: "it-IT", label: "Italiano", langKey: "it" },
  { code: "pt-BR", label: "Português", langKey: "pt" },
  { code: "zh-CN", label: "中文", langKey: "en" },
  { code: "ja-JP", label: "日本語", langKey: "en" },
  { code: "ru-RU", label: "Русский", langKey: "en" },
  { code: "my-MM", label: "မြန်မာ", langKey: "my" },
];

const SPEECH_EXAMPLES: Record<string, string[]> = {
  en: ["knight f3", "pawn to e4", "e2 to e4", "queen takes d5", "castle"],
  es: ["caballo f3", "peón a e4", "dama come d5", "enroque"],
  fr: ["cavalier f3", "pion en e4", "dame prend d5", "petit roque"],
  de: ["springer f3", "bauer e4", "dame schlägt d5", "kurze rochade"],
  it: ["cavallo f3", "pedone e4", "regina prende d5", "arrocco"],
  pt: ["cavalo f3", "peão e4", "rainha captura d5", "roque"],
  my: ["မြင်း f3 ကို", "နိုင် e4 ကို", "ဘုရင် e1 ကနေ e2", "မိဖုရား d5 ဖမ်း", "O-O"],
};

type SpeechMode = "browser" | "groq" | "elevenlabs" | "assemblyai";

// Languages supported by Chrome's server-side Web Speech recognition.
// Burmese is NOT in this set — it must use Groq mode.
const BROWSER_SPEECH_LANGS = new Set([
  "af", "id", "ms", "ca", "cs", "de", "en", "es", "eu", "fil", "fr", "gl",
  "hr", "zu", "is", "it", "jv", "lv", "lt", "hu", "nl", "nb", "pl", "pt",
  "ro", "sk", "sl", "fi", "sv", "vi", "tr", "el", "bg", "ru", "sr", "uk",
  "he", "ar", "fa", "hi", "th", "cmn", "yue", "ja", "ko",
]);

type SpeechTabProps = {
  chessRef: React.MutableRefObject<Chess>;
  gameOutcome: string;
  isBotThinking: boolean;
  onMoveExecuted: () => void;
  setStatusMessage: (msg: string) => void;
};

export default function SpeechTab({
  chessRef,
  gameOutcome,
  isBotThinking,
  onMoveExecuted,
  setStatusMessage,
}: SpeechTabProps) {
  const [mode, setMode] = useState<SpeechMode>("groq");
  const [isListening, setIsListening] = useState(false);
  const [language, setLanguage] = useState("en-US");
  const [transcript, setTranscript] = useState("");
  const [lastMove, setLastMove] = useState("");
  const [autoExecute, setAutoExecute] = useState(true);

  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [showSpeechHelp, setShowSpeechHelp] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef("");

  const langEntry = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  const browserSupported = BROWSER_SPEECH_LANGS.has(language.split("-")[0]);

  const getLangKey = useCallback(() => langEntry.langKey, [langEntry]);

  const tryMove = useCallback(
    (text: string) => {
      const langKey = getLangKey();
      const parsed = parseChessMove(text, langKey, chessRef.current);
      if (!parsed) {
        setError(`Couldn't understand a move in: "${text.trim()}"`);
        setStatusMessage(`Couldn't understand a move in: "${text.trim()}"`);
        return;
      }

      const chess = chessRef.current;
      if (chess.turn() !== "w" || gameOutcome !== "active" || isBotThinking) {
        const reason = isBotThinking
          ? "Engine is thinking — wait for your turn."
          : gameOutcome !== "active"
            ? "Game is over — reset to play again."
            : "It's not your turn yet.";
        setError(reason);
        setStatusMessage(reason);
        return;
      }

      const playMove = (move: Move) => {
        if (move.captured) playCaptureSound();
        else if (chess.inCheck()) playCheckSound();
        else playMoveSound();
        setLastMove(`${parsed} (${move.san})`);
        setStatusMessage(`Voice move: ${move.san}`);
        setError("");
        onMoveExecuted();
      };

      try {
        const uciMatch = parsed.match(/^([a-h][1-8])([a-h][1-8])$/);
        if (uciMatch) {
          const from = uciMatch[1] as Square;
          const to = uciMatch[2] as Square;
          const move = chess.move({ from, to, promotion: "q" });
          if (move) {
            playMove(move);
            return;
          }
        }

        const move = chess.move(parsed);
        if (move) {
          playMove(move);
        } else {
          const msg = `"${parsed}" is not a legal move right now.`;
          setError(msg);
          setStatusMessage(msg);
        }
      } catch {
        const msg = `"${parsed}" is not a legal move right now.`;
        setError(msg);
        setStatusMessage(msg);
      }
    },
    [chessRef, gameOutcome, isBotThinking, onMoveExecuted, setStatusMessage, getLangKey],
  );

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const startBrowserListening = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError("Browser speech recognition not supported. Try Chrome or use Groq mode.");
      return;
    }
    if (!BROWSER_SPEECH_LANGS.has(language.split("-")[0])) {
      setError(`${langEntry.label} isn't supported by Chrome's built-in speech. Switch to Groq mode.`);
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let final = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += censorText(result[0].transcript);
          if (autoExecute) tryMove(final);
        } else {
          interim += censorText(result[0].transcript);
        }
      }
      const display = final + interim;
      setTranscript(display);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(`Recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      if (isListening) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setError("");
  }, [language, autoExecute, tryMove, isListening, langEntry]);

  const stopBrowserListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  const startGroqRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) return;

        const formData = new FormData();
        formData.append("file", blob, "recording.webm");
        const langCode = language.split("-")[0];
        formData.append("language", langCode);
        formData.append("provider", mode);

        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            body: formData,
          });
          const data = await response.json();
          if (data.text) {
            const censored = censorText(data.text);
            setTranscript((prev) => prev + censored + " ");
            if (autoExecute) tryMove(censored);
          }
          if (data.detail) setError(data.detail);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed");
        }
        setIsRecording(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setError("");
    } catch {
      setError("Microphone access denied.");
    }
  }, [language, autoExecute, tryMove, mode]);

  const stopGroqRecording = useCallback(() => {
    setIsRecording(false);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopBrowserListening();
      stopGroqRecording();
    };
  }, [stopBrowserListening, stopGroqRecording]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between mb-3">
        <p className="text-lg text-zinc-300 font-medium light:text-slate-700">Speech Control</p>
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${
            isListening || isRecording
              ? "bg-emerald-900/40 text-emerald-300 animate-pulse light:bg-emerald-100 light:text-emerald-700"
              : "bg-zinc-700 text-zinc-400 light:bg-slate-200 light:text-slate-600"
          }`}
        >
          {isListening || isRecording ? "LISTENING" : "IDLE"}
        </span>
      </div>

      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => setMode("groq")}
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "groq"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 light:bg-amber-100 light:text-amber-700"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600 light:bg-slate-100 light:text-slate-600 light:border-slate-300 light:hover:border-slate-400"
          }`}
        >
          Groq
        </button>
        <button
          type="button"
          onClick={() => setMode("elevenlabs")}
          title="ElevenLabs Scribe (cloud transcription)"
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "elevenlabs"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 light:bg-amber-100 light:text-amber-700"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600 light:bg-slate-100 light:text-slate-600 light:border-slate-300 light:hover:border-slate-400"
          }`}
        >
          ElevenLabs
        </button>
        <button
          type="button"
          onClick={() => setMode("assemblyai")}
          title="AssemblyAI Universal-1 (cloud transcription)"
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "assemblyai"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 light:bg-amber-100 light:text-amber-700"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600 light:bg-slate-100 light:text-slate-600 light:border-slate-300 light:hover:border-slate-400"
          }`}
        >
          AssemblyAI
        </button>
        <button
          type="button"
          onClick={() => setMode("browser")}
          disabled={!browserSupported}
          title={
            browserSupported
              ? undefined
              : `${langEntry.label} isn't supported by Chrome's built-in speech — use Groq mode.`
          }
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
            mode === "browser"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 light:bg-amber-100 light:text-amber-700"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600 light:bg-slate-100 light:text-slate-600 light:border-slate-300 light:hover:border-slate-400"
          }`}
        >
          Browser
        </button>
      </div>

      {!browserSupported && (
        <p className="mb-3 rounded bg-amber-950/20 border border-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-300/90 light:bg-amber-100 light:border-amber-300 light:text-amber-800">
          ⚠ Chrome&apos;s built-in speech doesn&apos;t support {langEntry.label} — Groq mode is
          used automatically.
        </p>
      )}

      <div className="mb-3 flex items-center gap-2">
        <select
          value={language}
          onChange={(e) => {
            const next = e.target.value;
            setLanguage(next);
            if (mode === "browser" && !BROWSER_SPEECH_LANGS.has(next.split("-")[0])) {
              setMode("groq");
            }
          }}
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 light:border-slate-300 light:bg-white light:text-slate-800"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowSpeechHelp((prev) => !prev)}
          title="What to say"
          className={`h-8 w-8 shrink-0 rounded-full border text-sm font-bold transition-all ${
            showSpeechHelp
              ? "border-amber-500/40 bg-amber-500/20 text-amber-300 light:border-amber-400 light:bg-amber-100 light:text-amber-700"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-amber-500/40 hover:text-amber-300 light:border-slate-300 light:bg-white light:text-slate-500"
          }`}
        >
          ?
        </button>
      </div>

      {showSpeechHelp && (
        <div className="mb-3 rounded border border-amber-500/20 bg-amber-950/20 p-3 text-xs light:border-amber-300 light:bg-amber-100">
          <p className="mb-1.5 font-bold text-amber-300 light:text-amber-700">
            What to say ({langEntry.label}):
          </p>
          <ul className="space-y-1 text-zinc-300 light:text-slate-700">
            {(SPEECH_EXAMPLES[langEntry.langKey] ?? SPEECH_EXAMPLES.en).map(
              (example) => (
                <li key={example} className="font-mono">
                  • {example}
                </li>
              ),
            )}
          </ul>
          <p className="mt-1.5 text-[11px] italic text-zinc-500 light:text-slate-500">
            Say the piece, then the destination square (e.g. file + rank).
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer light:text-slate-600">
          <input
            type="checkbox"
            checked={autoExecute}
            onChange={(e) => setAutoExecute(e.target.checked)}
            className="accent-amber-500"
          />
          Auto-execute moves
        </label>
      </div>

      <button
        type="button"
        onClick={
          mode === "browser"
            ? isListening
              ? stopBrowserListening
              : startBrowserListening
            : isRecording
              ? stopGroqRecording
              : startGroqRecording
        }
        className={`w-full rounded py-2.5 text-sm font-semibold transition-colors ${
          isListening || isRecording
            ? "bg-rose-600 text-white hover:bg-rose-500"
            : "bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
        }`}
      >
        {isListening || isRecording ? "Stop Listening" : "Start Listening"}
      </button>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded border border-zinc-800 bg-zinc-900 p-3 light:border-slate-300 light:bg-white">
        <p className="text-xs text-zinc-500 mb-1 light:text-slate-500">Transcript:</p>
        <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed light:text-slate-700">
          {transcript || <span className="text-zinc-600 italic light:text-slate-400">Waiting for speech...</span>}
        </p>
      </div>

      {lastMove && (
        <div className="mt-2 rounded bg-emerald-900/20 px-3 py-2 text-sm text-emerald-300 border border-emerald-800/30 light:bg-emerald-100 light:text-emerald-700 light:border-emerald-300">
          Last move: {lastMove}
        </div>
      )}

      {error && (
        <div className="mt-2 rounded bg-rose-900/20 px-3 py-2 text-sm text-rose-300 border border-rose-800/30 light:bg-rose-100 light:text-rose-700 light:border-rose-300">
          {error}
        </div>
      )}
    </div>
  );
}