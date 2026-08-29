"use client";

import { useEffect, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import { type ReplayGame, type ReplayMove } from "@/components/Simulation3D";
import type { SidebarTab } from "@/hooks/useSidebarPreferences";

const REPLAY_GAMES_KEY = "sentio-replay-games-v1";

export function serializeReplayMoves(chess: Chess): ReplayMove[] {
  return chess.history({ verbose: true }).map((move) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    color: move.color,
    flags: move.flags,
    promotion: move.promotion,
  }));
}

type UseReplayParams = {
  chessRef: React.MutableRefObject<Chess>;
  gamePosition: string;
  setGamePosition: (pos: string) => void;
  setStatusMessage: (msg: string) => void;
  activeTab: SidebarTab;
};

type UseReplayReturn = {
  savedReplayGames: ReplayGame[];
  setSavedReplayGames: React.Dispatch<React.SetStateAction<ReplayGame[]>>;
  replayGameId: string;
  setReplayGameId: (id: string) => void;
  replayMoveIndex: number;
  setReplayMoveIndex: (idx: number) => void;
  replayPlaying: boolean;
  setReplayPlaying: (playing: boolean) => void;
  replayBusy: boolean;
  setReplayBusy: (busy: boolean) => void;
  replayAnimate: boolean;
  setReplayAnimate: (animate: boolean) => void;
  currentReplayGame: ReplayGame;
  setCurrentReplayGame: React.Dispatch<React.SetStateAction<ReplayGame>>;
  replayCounterRef: React.MutableRefObject<number>;
  replayGames: ReplayGame[];
  activeReplayGame: ReplayGame;
  replayActive: boolean;
  setReplayBoard: (
    game: ReplayGame,
    targetIndex: number,
    animateMove: boolean,
  ) => void;
  selectReplayGame: (gameId: string) => void;
  stepReplay: (direction: -1 | 1) => void;
  resetReplayState: () => void;
};

export function useReplay({
  chessRef,
  gamePosition,
  setGamePosition,
  setStatusMessage,
  activeTab,
}: UseReplayParams): UseReplayReturn {
  const [savedReplayGames, setSavedReplayGames] = useState<ReplayGame[]>([]);
  const [replayGameId, setReplayGameId] = useState("current");
  const [replayMoveIndex, setReplayMoveIndex] = useState(-1);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayAnimate, setReplayAnimate] = useState(true);
  const replayCounterRef = useRef(1);
  const [currentReplayGame, setCurrentReplayGame] = useState<ReplayGame>({
    id: "current",
    label: "Current game",
    moves: [],
  });

  // Restore persisted replay games once on mount (deferred past first paint
  // to avoid a synchronous setState inside the effect).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(REPLAY_GAMES_KEY);
        if (saved) setSavedReplayGames(JSON.parse(saved) as ReplayGame[]);
      } catch {
        // Ignore corrupted replay storage.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Persist replay games whenever they change.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        REPLAY_GAMES_KEY,
        JSON.stringify(savedReplayGames),
      );
    } catch {
      // Storage unavailable; replays stay in-memory for this session.
    }
  }, [savedReplayGames]);

  // Keep currentReplayGame in sync when viewing the live game.
  useEffect(() => {
    if (replayGameId === "current") {
      setCurrentReplayGame({
        id: "current",
        label: "Current game",
        moves: serializeReplayMoves(chessRef.current),
      });
    }
  }, [gamePosition, replayGameId]);

  const replayGames = [currentReplayGame, ...savedReplayGames];
  const activeReplayGame =
    replayGames.find((game) => game.id === replayGameId) ?? replayGames[0];
  const replayActive = activeTab === "replay";

  function setReplayBoard(
    game: ReplayGame,
    targetIndex: number,
    animateMove: boolean,
  ) {
    const board = new Chess();
    const boundedIndex = Math.max(
      -1,
      Math.min(targetIndex, game.moves.length - 1),
    );
    const movesToApply = game.moves.slice(0, boundedIndex + 1);
    for (const move of movesToApply) {
      board.move({
        from: move.from as Square,
        to: move.to as Square,
        promotion: move.promotion as "q" | "r" | "b" | "n" | undefined,
      });
    }
    if (!animateMove) {
      chessRef.current = board;
      setGamePosition(board.fen());
      setReplayMoveIndex(boundedIndex);
      setReplayBusy(false);
      setReplayAnimate(false);
      return;
    }
    const move = game.moves[boundedIndex];
    if (!move) return;
    const before = new Chess();
    for (const previous of game.moves.slice(0, boundedIndex)) {
      before.move({
        from: previous.from as Square,
        to: previous.to as Square,
        promotion: previous.promotion as "q" | "r" | "b" | "n" | undefined,
      });
    }
    const animatedBoard = new Chess(before.fen());
    const applied = animatedBoard.move({
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion as "q" | "r" | "b" | "n" | undefined,
    });
    if (!applied) return;
    chessRef.current = animatedBoard;
    setReplayMoveIndex(boundedIndex);
    setReplayBusy(true);
    setReplayAnimate(true);
    setGamePosition(animatedBoard.fen());
    setStatusMessage(`Replay: ${applied.san}`);
  }

  function selectReplayGame(gameId: string) {
    const game = replayGames.find((candidate) => candidate.id === gameId);
    if (!game) return;
    setReplayGameId(gameId);
    setReplayPlaying(false);
    setReplayBusy(false);
    setReplayAnimate(false);
    setReplayBoard(game, -1, false);
  }

  function stepReplay(direction: -1 | 1) {
    if (!activeReplayGame || replayBusy) return;
    const nextIndex = replayMoveIndex + direction;
    if (direction === 1 && nextIndex >= activeReplayGame.moves.length) {
      setReplayPlaying(false);
      return;
    }
    if (direction === 1) setReplayBoard(activeReplayGame, nextIndex, true);
    else setReplayBoard(activeReplayGame, nextIndex, false);
  }

  // Auto-play timer effect for replays.
  useEffect(() => {
    if (
      !replayActive ||
      !replayPlaying ||
      replayBusy ||
      !activeReplayGame ||
      replayMoveIndex >= activeReplayGame.moves.length - 1
    ) {
      return;
    }
    const timer = window.setTimeout(() => stepReplay(1), 980);
    return () => window.clearTimeout(timer);
  }, [
    replayActive,
    replayPlaying,
    replayBusy,
    activeReplayGame,
    replayMoveIndex,
  ]);

  function resetReplayState() {
    setReplayGameId("current");
    setReplayMoveIndex(-1);
    setReplayPlaying(false);
    setReplayBusy(false);
  }

  return {
    savedReplayGames,
    setSavedReplayGames,
    replayGameId,
    setReplayGameId,
    replayMoveIndex,
    setReplayMoveIndex,
    replayPlaying,
    setReplayPlaying,
    replayBusy,
    setReplayBusy,
    replayAnimate,
    setReplayAnimate,
    currentReplayGame,
    setCurrentReplayGame,
    replayCounterRef,
    replayGames,
    activeReplayGame,
    replayActive,
    setReplayBoard,
    selectReplayGame,
    stepReplay,
    resetReplayState,
  };
}
