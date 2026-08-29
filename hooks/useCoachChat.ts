"use client";

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { useCoachAudio } from "@/hooks/useCoachAudio";
import type { ChatMessage } from "@/lib/gameTypes";
import type { EmotionLabel } from "@/lib/engineProfiles";

const COACH_API_URL = "/api/coach";

const COACH_AUTO_ENCOURAGEMENT: Record<string, string[]> = {
  confident: [
    "You're playing with real confidence — love to see it. Keep the pressure on.",
    "Great energy! You're in control. Stay sharp.",
    "Love the swagger. Just don't get careless.",
  ],
  focused: [
    "You're locked in. That's how you win games.",
    "Nice concentration — keep calculating deep.",
    "Focused and sharp. You've got this.",
  ],
  neutral: [
    "Solid and steady. Good things will come.",
    "You're playing fine — trust your instincts.",
    "No panic. Just keep making good moves.",
  ],
  calm: [
    "You look relaxed — that's your best state to play in.",
    "Calm and collected. That's the way.",
    "Staying cool under pressure. Well played.",
  ],
  frustrated: [
    "Hey, you're doing better than you think. Take a breath.",
    "Don't be hard on yourself. One good move changes everything.",
    "Frustration is normal. Reset and focus on the next move.",
    "You've got this. Don't let one setback shake you.",
  ],
  stressed: [
    "Take a deep breath. You've handled tougher positions.",
    "You're feeling the pressure, but you're still in this.",
    "Slow down. You don't need to rush — think clearly.",
    "Trust yourself. You know more than you think.",
  ],
};

type CoachLlmConnection =
  | "checking"
  | "connected"
  | "disconnected"
  | "disabled";

function questionWantsMove(question: string): boolean {
  const s = question.toLowerCase().trim();
  if (!s) return false;
  if (/[a-h][1-8]/.test(s)) return true;
  return (
    /\b(move|play|recommend|suggest|best)\b/.test(s) ||
    /what should i/.test(s) ||
    /next move|make a move|your move|for me/.test(s)
  );
}

interface UseCoachChatParams {
  chessRef: React.MutableRefObject<Chess>;
  gamePosition: string;
  emotion: EmotionLabel;
  isBotThinking: boolean;
  botMoveAtRef: React.MutableRefObject<number>;
  playerSetbacksRef: React.MutableRefObject<number[]>;
}

export function useCoachChat({
  chessRef,
  gamePosition,
  emotion,
  isBotThinking,
  botMoveAtRef,
  playerSetbacksRef,
}: UseCoachChatParams) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastCoachAutoMessageRef = useRef(0);
  const lastSpokenRef = useRef<string>("");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I am Sentio. I can coach your position, explain plans, and adapt engine strength based on your emotional state.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [coachMode, setCoachMode] = useState<"groq" | "llm">("groq");
  const [groqAvailable, setGroqAvailable] = useState(false);
  const [groqDetail, setGroqDetail] = useState("Checking Groq...");
  const [coachLlmConnection, setCoachLlmConnection] =
    useState<CoachLlmConnection>("checking");
  const [coachLlmDetail, setCoachLlmDetail] = useState(
    "Checking LLM health...",
  );

  const {
    muted: coachAudioMuted,
    autoRead: coachAutoRead,
    status: coachAudioStatus,
    speak: speakCoachReply,
    stop: stopCoachReply,
    setMuted: setCoachAudioMuted,
    setAutoRead: setCoachAutoRead,
  } = useCoachAudio();

  const postCoachEncouragementRef = useRef((em: EmotionLabel) => {
    const now = Date.now();
    if (now - lastCoachAutoMessageRef.current < 25000) return;
    lastCoachAutoMessageRef.current = now;
    const pool =
      COACH_AUTO_ENCOURAGEMENT[em] ?? COACH_AUTO_ENCOURAGEMENT.neutral;
    const text = pool[Math.floor(Math.random() * pool.length)];
    setChatMessages((prev) => [
      ...prev,
      {
        id: `coach-auto-${now}`,
        role: "assistant",
        content: text,
      },
    ]);
  });

  // Coach health polling effect
  useEffect(() => {
    let active = true;

    async function refreshCoachHealth() {
      try {
        const response = await fetch(COACH_API_URL, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Health endpoint failed (${response.status}).`);
        }

        const data = (await response.json()) as {
          enabled: boolean;
          connected: boolean;
          detail: string;
          model: string;
          groq?: {
            available: boolean;
            detail: string;
            model: string;
          };
        };

        if (!active) return;

        setGroqAvailable(data.groq?.available ?? false);
        setGroqDetail(
          data.groq?.available
            ? `Groq: ${data.groq.model}`
            : (data.groq?.detail ?? "Groq unavailable."),
        );

        if (!data.enabled) {
          setCoachLlmConnection("disabled");
          setCoachLlmDetail(data.detail);
          return;
        }

        setCoachLlmConnection(data.connected ? "connected" : "disconnected");
        setCoachLlmDetail(`${data.detail} Model: ${data.model}`);
      } catch (error) {
        if (!active) return;
        setCoachLlmConnection("disconnected");
        setCoachLlmDetail(
          error instanceof Error
            ? error.message
            : "Could not check LLM connection.",
        );
      }
    }

    void refreshCoachHealth();
    const intervalId = window.setInterval(() => {
      void refreshCoachHealth();
    }, 10000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Coach auto-encouragement effect
  useEffect(() => {
    postCoachEncouragementRef.current(emotion);
  }, [emotion]);

  // Chat auto-scroll effect
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Auto-read TTS effect
  useEffect(() => {
    if (!coachAutoRead || coachAudioMuted) return;
    const latest = chatMessages[chatMessages.length - 1];
    if (
      latest &&
      latest.role === "assistant" &&
      latest.id !== "welcome" &&
      !latest.id.startsWith("assistant-error-") &&
      latest.id !== lastSpokenRef.current
    ) {
      lastSpokenRef.current = latest.id;
      void speakCoachReply(latest.id, latest.content);
    }
  }, [chatMessages, coachAutoRead, coachAudioMuted, speakCoachReply]);

  async function handleAskCoach(
    now: number,
    options?: {
      question?: string;
      source?: "typed" | "voice-coach";
      emotionHistoryRef?: React.MutableRefObject<{ emotion: string; at: number }[]>;
      gameOutcome?: string;
      playCoachMoveWithHand?: (uci: string) => void;
    },
  ) {
    const source = options?.source ?? "typed";
    const question = (options?.question ?? chatInput).trim();
    if (!question || isCoachThinking) return;

    const userMessage: ChatMessage = {
      id: `user-${now}`,
      role: "user",
      content: question,
    };

    setChatMessages((previous) => [...previous, userMessage]);
    setChatInput("");

    try {
      setIsCoachThinking(true);
      const response = await fetch(COACH_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: chessRef.current.fen(),
          emotion,
          recentEmotions: options?.emotionHistoryRef?.current ?? [],
          question,
          mode: coachMode,
          ...(source === "voice-coach"
            ? {
                responseLanguage: "my",
                inputLanguage: "my",
                source: "voice-coach",
              }
            : {}),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(data?.detail ?? "Coach service unavailable.");
      }

      const data = (await response.json()) as {
        message: string;
        suggestions?: string[];
        bestMove?: { uci: string; san: string } | null;
      };

      const coachMessage: ChatMessage = {
        id: `assistant-${now}`,
        role: "assistant",
        bestMove: data.bestMove ?? undefined,
        content: `${data.message}${
          data.suggestions?.length ? `\n${data.suggestions.join("\n")}` : ""
        }`,
      };
      if (
        data.bestMove &&
        questionWantsMove(question) &&
        chessRef.current.turn() === "w" &&
        (options?.gameOutcome ?? "active") === "active"
      ) {
        coachMessage.playedByCoach = true;
      }
      setChatMessages((previous) => [...previous, coachMessage]);
      if (coachMessage.playedByCoach && data.bestMove && options?.playCoachMoveWithHand) {
        options.playCoachMoveWithHand(data.bestMove.uci);
      }
    } catch (error) {
      const coachError: ChatMessage = {
        id: `assistant-error-${now}`,
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Coach service is currently unavailable.",
      };
      setChatMessages((previous) => [...previous, coachError]);
    } finally {
      setIsCoachThinking(false);
    }
  }

  return {
    chatMessages,
    chatInput,
    setChatInput,
    isCoachThinking,
    coachMode,
    setCoachMode,
    groqAvailable,
    groqDetail,
    coachLlmConnection,
    coachLlmDetail,
    chatScrollRef,
    lastCoachAutoMessageRef,
    lastSpokenRef,
    postCoachEncouragementRef,
    coachAudioMuted,
    coachAutoRead,
    coachAudioStatus,
    speakCoachReply,
    stopCoachReply,
    setCoachAudioMuted,
    setCoachAutoRead,
    handleAskCoach,
  };
}
