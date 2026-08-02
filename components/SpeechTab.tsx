"use client";

import { Chess, Square } from "chess.js";
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
];

type SpeechMode = "browser" | "groq";

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

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef("");

  const langEntry = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  const getLangKey = useCallback(() => langEntry.langKey, [langEntry]);

  const tryMove = useCallback(
    (text: string) => {
      const langKey = getLangKey();
      const parsed = parseChessMove(text, langKey);
      if (!parsed) return;

      const chess = chessRef.current;
      if (chess.turn() !== "w" || gameOutcome !== "active" || isBotThinking) return;

      try {
        const uciMatch = parsed.match(/^([a-h][1-8])([a-h][1-8])$/);
        if (uciMatch) {
          const from = uciMatch[1] as Square;
          const to = uciMatch[2] as Square;
          const move = chess.move({ from, to, promotion: "q" });
          if (move) {
            if (move.captured) playCaptureSound();
            else if (chess.inCheck()) playCheckSound();
            else playMoveSound();

            setLastMove(`${parsed} (${move.san})`);
            setStatusMessage(`Voice move: ${move.san}`);
            onMoveExecuted();
            return;
          }
        }

        const move = chess.move(parsed);
        if (move) {
          if (move.captured) playCaptureSound();
          else if (chess.inCheck()) playCheckSound();
          else playMoveSound();

          setLastMove(`${parsed} (${move.san})`);
          setStatusMessage(`Voice move: ${move.san}`);
          onMoveExecuted();
        }
      } catch {}
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
  }, [language, autoExecute, tryMove, isListening]);

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
  }, [language, autoExecute, tryMove]);

  const stopGroqRecording = useCallback(() => {
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
        <p className="text-lg text-zinc-300 font-medium">Speech Control</p>
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${
            isListening || isRecording
              ? "bg-emerald-900/40 text-emerald-300 animate-pulse"
              : "bg-zinc-700 text-zinc-400"
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
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
          }`}
        >
          Groq
        </button>
        <button
          type="button"
          onClick={() => setMode("browser")}
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "browser"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
          }`}
        >
          Browser
        </button>
      </div>

      <div className="mb-3">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
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

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded border border-zinc-800 bg-zinc-900 p-3">
        <p className="text-xs text-zinc-500 mb-1">Transcript:</p>
        <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
          {transcript || <span className="text-zinc-600 italic">Waiting for speech...</span>}
        </p>
      </div>

      {lastMove && (
        <div className="mt-2 rounded bg-emerald-900/20 px-3 py-2 text-sm text-emerald-300 border border-emerald-800/30">
          Last move: {lastMove}
        </div>
      )}

      {error && (
        <div className="mt-2 rounded bg-rose-900/20 px-3 py-2 text-sm text-rose-300 border border-rose-800/30">
          {error}
        </div>
      )}
    </div>
  );
}