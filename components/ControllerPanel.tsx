"use client";

import { useEffect, useRef } from "react";
import type { Chess } from "chess.js";
import type { ChatMessage, CoachLlmConnection, EngineProfile } from "@/lib/gameTypes";
import { useSidebarPreferences, type SidebarTab } from "@/hooks/useSidebarPreferences";
import benchmarkReport from "@/benchmarks/search-benchmark.json";
import GameInfo from "@/components/GameInfo";
import OverflowMenu from "@/components/OverflowMenu";
import VoiceCoachControl from "@/components/VoiceCoachControl";
import SpeechTab from "@/components/SpeechTab";
import LogicianPanel from "@/components/LogicianPanel";
import BenchmarkTab from "@/components/BenchmarkTab";
import CollapsedControllerRail from "@/components/CollapsedControllerRail";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  controllerContentIn,
  controllerToggleIn,
  controllerRailIn,
  controllerLabelIn,
  controllerStatusPulse,
  controllerWideIn,
  controllerFloatIn,
} from "@/lib/animations";

export interface ControllerPanelProps {
  // Shared tab state
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  workspaceTab: "board" | "train";
  setWorkspaceTab: (tab: "board" | "train") => void;

  // Game state
  chessRef: React.MutableRefObject<Chess>;
  gamePosition: string;
  gameOutcome: string;
  statusMessage: string;
  engineProfile: EngineProfile;
  isBotThinking: boolean;
  openingName: string | null;
  canUndo: boolean;
  isHintLoading: boolean;

  // Callbacks
  requestHint: () => Promise<void>;
  undoMovePair: () => void;
  resetGame: () => void;
  exportPgn: () => void;
  setStatusMessage: (msg: string) => void;

  // Coach state
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  isCoachThinking: boolean;
  coachMode: "groq" | "llm";
  setCoachMode: (mode: "groq" | "llm") => void;
  coachLlmConnection: CoachLlmConnection;
  coachLlmDetail: string;
  groqAvailable: boolean;
  groqDetail: string;
  handleAskCoach: (
    now: number,
    options?: { question?: string; source?: "typed" | "voice-coach" },
  ) => Promise<void>;

  // Coach audio
  coachAudioMuted: boolean;
  coachAutoRead: boolean;
  coachAudioStatus: { phase: string; id: string | null };
  speakCoachReply: (id: string, content: string) => Promise<void>;
  stopCoachReply: () => void;
  setCoachAudioMuted: (muted: boolean) => void;
  setCoachAutoRead: (autoRead: boolean) => void;

  // Speech tab
  onSpeechMoveExecuted: () => void;
}

export default function ControllerPanel({
  activeTab,
  setActiveTab,
  workspaceTab,
  chessRef,
  gamePosition,
  gameOutcome,
  statusMessage,
  engineProfile,
  isBotThinking,
  openingName,
  canUndo,
  isHintLoading,
  requestHint,
  undoMovePair,
  resetGame,
  exportPgn,
  setStatusMessage,
  chatMessages,
  chatInput,
  setChatInput,
  isCoachThinking,
  coachMode,
  setCoachMode,
  coachLlmConnection,
  coachLlmDetail,
  groqAvailable,
  groqDetail,
  handleAskCoach,
  coachAudioMuted,
  coachAutoRead,
  coachAudioStatus,
  speakCoachReply,
  stopCoachReply,
  setCoachAudioMuted,
  setCoachAutoRead,
  onSpeechMoveExecuted,
}: ControllerPanelProps) {
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Sidebar layout preferences (internal)
  const {
    expanded: controllerExpanded,
    wide: controllerWide,
    detached: controllerDetached,
    setExpanded: setControllerExpanded,
    setWide: setControllerWide,
    setDetached: setControllerDetached,
  } = useSidebarPreferences();

  // Controller animation refs
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const railLabelRef = useRef<HTMLSpanElement>(null);
  const railStatusRef = useRef<HTMLSpanElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Entrance animations
  useEffect(() => {
    if (toggleRef.current) controllerToggleIn(toggleRef.current);
  }, []);
  useEffect(() => {
    if (contentRef.current) controllerContentIn(contentRef.current);
  }, []);
  useEffect(() => {
    if (railRef.current) controllerRailIn(railRef.current);
    if (railLabelRef.current) controllerLabelIn(railLabelRef.current);
    if (railStatusRef.current) controllerStatusPulse(railStatusRef.current);
  }, []);
  useEffect(() => {
    if (workspaceTab === "board" && controllerWide && contentRef.current) {
      controllerWideIn(contentRef.current);
    }
  }, [workspaceTab, controllerWide]);
  useEffect(() => {
    if (controllerDetached && asideRef.current) {
      controllerFloatIn(asideRef.current);
    }
  }, [controllerDetached]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  return (
    <aside
      ref={asideRef}
      className={`controller-panel ${controllerDetached ? "controller-floating" : ""} ${controllerExpanded ? (controllerWide ? "controller-panel-wide" : "controller-panel-expanded w-full lg:w-[440px]") : "controller-panel-collapsed w-full lg:w-[72px] px-2"} flex shrink-0 flex-col overflow-hidden border-t border-zinc-800/80 bg-zinc-950/90 p-4 backdrop-blur-md lg:border-t-0 lg:border-l light:border-slate-300 light:bg-white/90`}
      data-controller-expanded={controllerExpanded}
      data-controller-wide={controllerWide}
      data-controller-detached={controllerDetached}
    >
      <div
        className={`flex items-center ${controllerExpanded ? "justify-between" : "justify-center"} mb-2`}
      >
        {controllerExpanded ? (
          <div className="min-w-0">
            <h1 className="font-mono text-base font-bold text-amber-400 light:text-amber-700">
              Game Controller
            </h1>
            <p className="text-xs text-zinc-400 light:text-slate-600">
              {statusMessage}
            </p>
          </div>
        ) : (
          <span
            className="font-mono text-lg font-bold text-amber-400 light:text-amber-700"
            aria-hidden="true"
          >
            S
          </span>
        )}
        <div
          className={`flex items-center ${controllerExpanded ? "gap-2" : "flex-col gap-2"}`}
        >
          {controllerExpanded ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void requestHint();
              }}
              disabled={
                isHintLoading || isBotThinking || gameOutcome !== "active"
              }
              title="Ask the engine for a strong move (5s cooldown)"
            >
              {isHintLoading ? "…" : "Hint"}
            </Button>
          ) : null}
          {controllerExpanded ? (
            <Button
              variant="outline"
              size="sm"
              onClick={undoMovePair}
              disabled={!canUndo}
              title="Take back your last move (Ctrl/Cmd+Z)"
            >
              Undo
            </Button>
          ) : null}
          {controllerExpanded ? (
            <OverflowMenu
              items={[
                {
                  label: "Export PGN",
                  icon: "📄",
                  onSelect: exportPgn,
                  title: "Download the current game as PGN",
                },
                {
                  label: "Reset Game",
                  icon: "🔄",
                  onSelect: resetGame,
                },
                {
                  label: controllerWide ? "Compact width" : "Wide panel",
                  icon: "↔",
                  onSelect: () => setControllerWide((wide) => !wide),
                  title: "Toggle controller width",
                },
                {
                  label: controllerDetached
                    ? "Dock sidebar"
                    : "Float sidebar",
                  icon: "🪟",
                  onSelect: () =>
                    setControllerDetached((detached) => !detached),
                },
              ]}
            />
          ) : null}
          <Button
            ref={toggleRef}
            variant="ghost"
            size="icon"
            aria-label={
              controllerExpanded
                ? "Collapse game controller"
                : "Expand game controller"
            }
            aria-expanded={controllerExpanded}
            onClick={() => setControllerExpanded((expanded) => !expanded)}
            className="min-w-[34px] transition-transform duration-300 hover:-translate-x-0.5 hover:scale-105"
            title={
              controllerExpanded
                ? "Collapse game controller"
                : "Expand game controller"
            }
          >
            {controllerExpanded ? "›" : "‹"}
          </Button>
        </div>
      </div>

      {controllerExpanded ? (
        <div
          ref={contentRef}
          className="controller-content min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="mt-3 flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1 light:border-slate-300 light:bg-slate-100">
            <Button
              variant={activeTab === "game" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("game")}
              className="min-w-[70px] flex-1"
              title="Moves, captures, and opening"
            >
              Game
            </Button>
            <Button
              variant={activeTab === "coach" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("coach")}
              className="min-w-[70px] flex-1"
            >
              AI Coach
            </Button>
            <Button
              variant={activeTab === "speech" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("speech")}
              className="min-w-[70px] flex-1"
            >
              Voice
            </Button>
            <Button
              variant={activeTab === "logician" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("logician")}
              className="min-w-[70px] flex-1"
              title="Rule-based advice from the Prolog knowledge base"
            >
              Logician
            </Button>
            <Button
              variant={activeTab === "benchmarks" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("benchmarks")}
              className="min-w-[70px] flex-1"
            >
              Analysis
            </Button>
            <Button
              variant={activeTab === "replay" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("replay")}
              className="min-w-[70px] flex-1"
            >
              Replay
            </Button>
            <Button
              variant={activeTab === "3d" ? "accent" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("3d")}
              className="min-w-[70px] flex-1"
            >
              3D
            </Button>
          </div>

          <div className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5 backdrop-blur-md light:border-slate-300 light:bg-white/70">
              {activeTab === "game" ? (
                <GameInfo
                  moves={chessRef.current.history({ verbose: true })}
                  openingName={openingName}
                />
              ) : activeTab === "coach" ? (
                <>
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-sm text-zinc-200 font-semibold light:text-slate-800">
                      Coach Assistant
                    </p>
                    {coachMode === "groq" ? (
                      <Badge
                        variant={groqAvailable ? "success" : "destructive"}
                        title={groqDetail}
                        className="text-[10px] font-bold"
                      >
                        {groqAvailable ? "Groq Active" : "Groq Needs Key"}
                      </Badge>
                    ) : (
                      <Badge
                        variant={
                          coachLlmConnection === "connected"
                            ? "success"
                            : coachLlmConnection === "disabled"
                              ? "muted"
                              : coachLlmConnection === "checking"
                                ? "warning"
                                : "destructive"
                        }
                        title={coachLlmDetail}
                        className="text-[10px] font-bold"
                      >
                        {coachLlmConnection === "connected"
                          ? "LLM Active"
                          : coachLlmConnection === "disabled"
                            ? "Standard Mode"
                            : coachLlmConnection === "checking"
                              ? "Checking LLM..."
                              : "Offline"}
                      </Badge>
                    )}
                  </div>
                  <div className="mb-2.5 flex gap-1 rounded-lg bg-zinc-900/90 p-1 border border-zinc-800 light:bg-slate-100 light:border-slate-300">
                    <Button
                      variant={coachMode === "groq" ? "accent" : "outline"}
                      size="sm"
                      onClick={() => setCoachMode("groq")}
                      disabled={!groqAvailable}
                      className="flex-1"
                      title={groqDetail}
                    >
                      Groq
                    </Button>
                    <Button
                      variant={coachMode === "llm" ? "accent" : "outline"}
                      size="sm"
                      onClick={() => setCoachMode("llm")}
                      disabled={coachLlmConnection === "disabled"}
                      className="flex-1"
                      title={coachLlmDetail}
                    >
                      Local LLM
                    </Button>
                  </div>

                  <VoiceCoachControl
                    onTranscriptReady={(text) => setChatInput(text)}
                    onSubmit={(text) =>
                      void handleAskCoach(Date.now(), {
                        question: text,
                        source: "voice-coach",
                      })
                    }
                    disabled={isCoachThinking}
                  />

                  <div className="mb-2.5 flex items-center gap-3 text-[11px] text-zinc-400 light:text-slate-600">
                    <label className="flex items-center gap-1.5">
                      <Checkbox
                        checked={coachAudioMuted}
                        onChange={(event) =>
                          setCoachAudioMuted(event.target.checked)
                        }
                      />
                      Mute audio
                    </label>
                    <label className="flex items-center gap-1.5">
                      <Checkbox
                        checked={!coachAudioMuted && coachAutoRead}
                        onChange={(event) =>
                          setCoachAutoRead(event.target.checked)
                        }
                      />
                      Read replies aloud
                    </label>
                  </div>

                  <div
                    ref={chatScrollRef}
                    className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 chat-scroll"
                  >
                    {chatMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-xl border ${
                          message.role === "assistant"
                            ? "border-zinc-800 bg-zinc-900/90 text-zinc-200 light:border-slate-300 light:bg-white light:text-slate-800"
                            : "border-amber-500/20 bg-amber-950/20 text-amber-100 light:border-amber-300 light:bg-amber-100 light:text-amber-900"
                        }`}
                      >
                        <div className="p-3 text-xs leading-relaxed whitespace-pre-line">
                          {message.content}
                        </div>
                        {message.role === "assistant" && (
                          <div className="flex items-center gap-1 border-t border-zinc-800/80 px-3 py-1.5 light:border-slate-300">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Read reply aloud: ${message.id}`}
                              title="Read this reply aloud (Burmese)"
                              onClick={() => {
                                if (
                                  coachAudioStatus.phase === "playing" &&
                                  coachAudioStatus.id === message.id
                                ) {
                                  stopCoachReply();
                                } else {
                                  void speakCoachReply(
                                    message.id,
                                    message.content,
                                  );
                                }
                              }}
                              className={`h-auto w-auto px-2 py-0.5 text-[11px] font-semibold ${
                                coachAudioStatus.phase === "playing" &&
                                coachAudioStatus.id === message.id
                                  ? "text-amber-300 hover:text-amber-200 light:text-amber-700"
                                  : "text-zinc-400 hover:text-amber-300 light:text-slate-500 light:hover:text-amber-700"
                              }`}
                            >
                              {coachAudioStatus.phase === "loading" &&
                              coachAudioStatus.id === message.id ? (
                                <span className="animate-pulse">⏳</span>
                              ) : coachAudioStatus.phase === "playing" &&
                                coachAudioStatus.id === message.id ? (
                                <span>■ stop</span>
                              ) : (
                                <span>🔊 read aloud</span>
                              )}
                            </Button>
                            {coachAudioStatus.phase === "error" &&
                              coachAudioStatus.id === message.id && (
                                <span className="text-[10px] italic text-zinc-500 light:text-slate-500">
                                  audio unavailable — text still shown
                                </span>
                              )}
                          </div>
                        )}
                        {message.bestMove && message.playedByCoach && (
                          <div className="border-t border-zinc-800/80 px-3 py-2 text-[11px] light:border-slate-300">
                            <span className="font-mono font-bold text-amber-400 light:text-amber-700">
                              ▶ {message.bestMove.san}
                            </span>
                            <span className="ml-2 text-zinc-400 light:text-slate-500">
                              playing it now
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Input
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void handleAskCoach(Date.now());
                        }
                      }}
                      placeholder="Ask coach for tactical advice or plan..."
                      className="flex-1 text-xs border-zinc-700/80 bg-zinc-950 text-zinc-100 focus:border-amber-500/60 light:border-slate-300 light:bg-white light:text-slate-800"
                    />
                    <Button
                      variant="default"
                      onClick={() => {
                        void handleAskCoach(Date.now());
                      }}
                      disabled={isCoachThinking || !chatInput.trim()}
                    >
                      {isCoachThinking ? "..." : "Ask"}
                    </Button>
                  </div>
                </>
              ) : activeTab === "speech" ? (
                <SpeechTab
                  chessRef={chessRef}
                  gameOutcome={gameOutcome}
                  isBotThinking={isBotThinking}
                  onMoveExecuted={onSpeechMoveExecuted}
                  setStatusMessage={setStatusMessage}
                />
              ) : activeTab === "logician" ? (
                <LogicianPanel fen={gamePosition} active />
              ) : activeTab === "benchmarks" ? (
                <BenchmarkTab report={benchmarkReport} />
              ) : (
                <div className="flex flex-1 flex-col justify-between p-1 space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 light:border-slate-300">
                      <span className="text-xs font-bold text-amber-400 light:text-amber-700">
                        3D Interactive Arena
                      </span>
                      <Badge variant="accent" className="text-[10px] font-bold">
                        3D Active
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed light:text-slate-600">
                      The board has morphed into a full 3D studio where you
                      and Sentio AI sit face-to-face.
                    </p>

                    <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-3 space-y-2.5 text-xs light:bg-white light:border-slate-300">
                      <span className="font-semibold text-zinc-300 block light:text-slate-700">
                        Controls:
                      </span>
                      <ul className="space-y-2 text-zinc-400 text-[11px] light:text-slate-600">
                        <li className="flex items-start gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1 shrink-0" />
                          <span>
                            <strong className="text-zinc-200 light:text-slate-800">
                              Move Piece:
                            </strong>{" "}
                            Click a piece and a green square, or use fist +
                            hold for 2s
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 mt-1 shrink-0" />
                          <span>
                            <strong className="text-zinc-200 light:text-slate-800">
                              Orbit View:
                            </strong>{" "}
                            Right-click & drag canvas to tilt and rotate
                            camera angle
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                          <span>
                            <strong className="text-zinc-200 light:text-slate-800">
                              Zoom:
                            </strong>{" "}
                            Scroll wheel or pinch trackpad
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1 shrink-0" />
                          <span>
                            <strong className="text-zinc-200 light:text-slate-800">
                              Webcam Gestures:
                            </strong>{" "}
                            Palm to aim · Fist to grab · Hold still over a
                            green square for 2s to place · Palm to release
                          </span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => setActiveTab("coach")}
                    className="w-full"
                  >
                    Return to 2D Board & Coach
                  </Button>
                </div>
              )}
            </div>
          </div>
      ) : (
        <CollapsedControllerRail
          railRef={railRef}
          railLabelRef={railLabelRef}
          railStatusRef={railStatusRef}
          statusMessage={statusMessage}
        />
      )}
    </aside>
  );
}
