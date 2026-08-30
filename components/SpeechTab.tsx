"use client";

import { Chess, Square, type Move } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseChessMove } from "@/lib/speechParser";
import { censorText } from "@/lib/censor";
import { playMoveSound, playCaptureSound, playCheckSound } from "@/lib/audio";
import {
  createVoiceRecorder,
  MIC_CAPTURE_CONSTRAINTS,
} from "@/lib/voiceRecorder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

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
      // Shared Burmese-tuned capture constraints + high-bitrate recorder.
      const stream = await navigator.mediaDevices.getUserMedia(
        MIC_CAPTURE_CONSTRAINTS,
      );
      const recorder = createVoiceRecorder(stream);
      if (!recorder) {
        stream.getTracks().forEach((t) => t.stop());
        setError("Recording is not supported in this browser.");
        return;
      }
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
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
      <div className="mb-3 flex items-center justify-between">
        <p className="text-lg font-medium text-zinc-300 light:text-slate-700">
          Speech Control
        </p>
        <Badge variant={isListening || isRecording ? "success" : "muted"}>
          {isListening || isRecording ? "LISTENING" : "IDLE"}
        </Badge>
      </div>

      <div className="mb-3 flex gap-2">
        {(["groq", "elevenlabs", "assemblyai", "browser"] as const).map((m) => (
          <Button
            key={m}
            variant={mode === m ? "accent" : "outline"}
            size="sm"
            className="flex-1 capitalize"
            disabled={m === "browser" && !browserSupported}
            title={
              m === "browser" && !browserSupported
                ? `${langEntry.label} isn't supported by Chrome's built-in speech — use Groq mode.`
                : undefined
            }
            onClick={() => setMode(m)}
          >
            {m === "assemblyai" ? "Assembly" : m === "elevenlabs" ? "ElevenLabs" : m.charAt(0).toUpperCase() + m.slice(1)}
          </Button>
        ))}
      </div>

      {!browserSupported && (
        <div className="mb-3 rounded border border-amber-500/20 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-300/90 light:border-amber-300 light:bg-amber-100 light:text-amber-800">
          Chrome&apos;s built-in speech doesn&apos;t support {langEntry.label} — Groq mode is
          used automatically.
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Select value={language} onValueChange={(v) => {
          setLanguage(v);
          if (mode === "browser" && !BROWSER_SPEECH_LANGS.has(v.split("-")[0])) {
            setMode("groq");
          }
        }}>
          <SelectTrigger className="flex-1 h-8 text-sm" aria-label="Speech language" />
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={showSpeechHelp ? "accent" : "outline"}
          size="icon"
          className="h-8 w-8 shrink-0"
          title="What to say"
          onClick={() => setShowSpeechHelp((prev) => !prev)}
        >
          ?
        </Button>
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

      <div className="mb-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer light:text-slate-600">
          <Checkbox
            checked={autoExecute}
            onChange={(e) => setAutoExecute(e.target.checked)}
          />
          Auto-execute moves
        </label>
      </div>

      <Button
        variant={isListening || isRecording ? "destructive" : "default"}
        className="w-full py-2.5"
        onClick={
          mode === "browser"
            ? isListening
              ? stopBrowserListening
              : startBrowserListening
            : isRecording
              ? stopGroqRecording
              : startGroqRecording
        }
      >
        {isListening || isRecording ? "Stop Listening" : "Start Listening"}
      </Button>

      <Card className="mt-3 min-h-0 flex-1 overflow-y-auto border-zinc-800 bg-zinc-900 light:border-slate-300 light:bg-white">
        <CardContent className="p-3">
          <p className="mb-1 text-xs text-zinc-500 light:text-slate-500">Transcript:</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300 light:text-slate-700">
            {transcript || <span className="italic text-zinc-600 light:text-slate-400">Waiting for speech...</span>}
          </p>
        </CardContent>
      </Card>

      {lastMove && (
        <Badge variant="success" className="mt-2">
          Last move: {lastMove}
        </Badge>
      )}

      {error && (
        <Badge variant="destructive" className="mt-2">
          {error}
        </Badge>
      )}
    </div>
  );
}
