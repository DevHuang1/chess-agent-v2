"""
Sentio is an emotion-adaptive chess AI. This file is the backend — the bridge
between the Next.js frontend and the Stockfish chess engine.

When the frontend sends a POST /api/bot-move with a FEN and an emotion string,
this module resolves the emotion to a strength profile. Each emotion maps to
three parameters: depth (search depth in plies, 1-10), Skill Level (Stockfish's
internal skill parameter, 0-20, which introduces intentional blunders at low
values), and UCI_Elo (ELO strength, 1320-3190, enforced via Stockfish's
ELO-limiting mechanism). Stressed players get depth=1, skill=1, ELO=1320 —
a very weak opponent. Confident players get depth=10, skill=20, ELO=3190 —
near-maximum strength.

Once the profile is determined, the module acquires a Stockfish instance from
a small persistent pool (size configurable via STOCKFISH_POOL_SIZE) and fully
reconfigures it for the request — set_depth, update_engine_parameters, and
set_fen_position reset all search state, so no state leaks between moves.
Stockfish is configured with the profile parameters plus Threads=2. The FEN is
validated
(using set_fen_position as the source of truth, since is_fen_valid can be
unreliable in certain positions), and get_best_move() is called. Stockfish
performs its search using a negamax framework with alpha-beta pruning,
iterative deepening, and transposition tables — the same algorithm that makes
it the strongest open-source chess engine in the world, now constrained to
match the player's emotional state.

The response includes the best move in UCI notation and the resolved engine
profile for the frontend to display.
"""

import asyncio
import glob
import os
import platform
import queue
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import urllib.request
from typing import Dict

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from stockfish import Stockfish

app = FastAPI()

# Lock CORS down to known frontend origins; override with a comma-separated
# BACKEND_CORS_ORIGINS env var when deploying.
_cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "BACKEND_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

STOCKFISH_VERSION = "sf_18"
STOCKFISH_DOWNLOAD_URL_BY_ARCH = {
    "x86_64": f"https://github.com/official-stockfish/Stockfish/releases/download/{STOCKFISH_VERSION}/stockfish-ubuntu-x86-64-avx2.tar",
    "aarch64": f"https://github.com/official-stockfish/Stockfish/releases/download/{STOCKFISH_VERSION}/stockfish-android-armv8.tar",
    "arm64": f"https://github.com/official-stockfish/Stockfish/releases/download/{STOCKFISH_VERSION}/stockfish-android-armv8.tar",
}

STOCKFISH_LOCAL_PATH = os.path.join(os.path.dirname(__file__), "stockfish")


def _is_executable(path: str) -> bool:
    return os.path.isfile(path) and os.access(path, os.X_OK)


def _download_stockfish(target: str):  # noqa: UP
    arch = platform.machine()
    url = STOCKFISH_DOWNLOAD_URL_BY_ARCH.get(arch)
    if not url:
        print(f"[sentio] No pre-built stockfish for arch={arch}")
        return None
    tmp = f"/tmp/stockfish_{STOCKFISH_VERSION}.tar"
    try:
        print(f"[sentio] Downloading stockfish ({arch}) from {url} ...")
        urllib.request.urlretrieve(url, tmp)
        extract_dir = f"/tmp/stockfish_extract"
        shutil.rmtree(extract_dir, ignore_errors=True)
        os.makedirs(extract_dir, exist_ok=True)
        with tarfile.open(tmp, "r") as tar:
            tar.extractall(path=extract_dir)
        binaries = glob.glob(os.path.join(extract_dir, "**", "stockfish*"), recursive=True)
        if not binaries:
            print(f"[sentio] No stockfish binary found in extracted archive")
            return None
        shutil.copy2(binaries[0], target)
        st = os.stat(target)
        os.chmod(target, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        os.remove(tmp)
        shutil.rmtree(extract_dir, ignore_errors=True)
        print(f"[sentio] Stockfish installed at {target}")
        return target
    except Exception as e:
        print(f"[sentio] Failed to download stockfish: {e}")
        return None


def resolve_stockfish_path() -> str:
    candidates = [
        os.environ.get("STOCKFISH_PATH"),
        STOCKFISH_LOCAL_PATH,
        shutil.which("stockfish"),
        "/usr/games/stockfish",
        "/usr/bin/stockfish",
    ]
    for c in candidates:
        if c and _is_executable(c):
            return c
    return "stockfish"


print(f"[sentio] arch={platform.machine()}")
print(f"[sentio] STOCKFISH_PATH={os.environ.get('STOCKFISH_PATH', '(not set)')}")

stockfish_path = resolve_stockfish_path()
if not _is_executable(stockfish_path):
    print(f"[sentio] Stockfish not found. Attempting auto-download...")
    if _download_stockfish(STOCKFISH_LOCAL_PATH):
        stockfish_path = STOCKFISH_LOCAL_PATH
    else:
        print(f"[sentio] Auto-download failed. Try: sudo apt install stockfish")
else:
    print(f"[sentio] Stockfish found at {stockfish_path}")


WHISPER_MODEL_DIR = os.path.join(
    os.path.dirname(__file__), "models", "whisper-small-burmese-v2-ct2"
)
RECORDINGS_DIR = os.path.join(os.path.dirname(__file__), "recordings")
WHISPER_INITIAL_PROMPT = (
    "မြင်း f3 ကို။ နိုင် e4 ကို။ ဘုရင် e1 ကနေ e2။ မိဖုရား d5 ဖမ်း။ "
    "ဆင် c4။ ကျီ a1။ လှေ h8 ဖမ်း။ O-O။"
)
MYANMAR_SCRIPT_RE = re.compile(r"[\u1000-\u109f\uAA60-\uAA7F\uA9E0-\uA9FF]")


def looks_like_burmese(text: str) -> bool:
    """True when a ``language=my`` transcription plausibly contains Burmese.

    The fine-tuned Whisper model can hallucinate replacement-character soup
    or a whole non-Burmese script (Thai, Devanagari) with HTTP 200. Such
    output is treated as failure so callers fall through to a working tier
    instead of showing tofu boxes.
    """
    t = (text or "").strip()
    if not t:
        return False
    replacement_count = len(re.findall(r"\ufffd", t))
    if replacement_count > 4 or replacement_count / len(t) > 0.1:
        return False
    if MYANMAR_SCRIPT_RE.search(t):
        return True
    return len(t) <= 3


_transcribe_model = None
_transcribe_model_lock = threading.Lock()


def get_transcribe_model():
    global _transcribe_model
    if _transcribe_model is None:
        with _transcribe_model_lock:
            if _transcribe_model is None:
                try:
                    from faster_whisper import WhisperModel
                except ImportError:
                    raise HTTPException(
                        status_code=500,
                        detail="faster-whisper is not installed in the backend environment.",
                    )
                if not os.path.isdir(WHISPER_MODEL_DIR):
                    raise HTTPException(
                        status_code=503,
                        detail="Local Burmese transcription model is not converted yet "
                        f"(expected at {WHISPER_MODEL_DIR}).",
                    )
                print(f"[sentio] Loading local Whisper model from {WHISPER_MODEL_DIR} ...")
                _transcribe_model = WhisperModel(
                    WHISPER_MODEL_DIR, device="cpu", compute_type="int8"
                )
    return _transcribe_model


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...), language: str = Form("")):
    try:
        model = get_transcribe_model()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load transcription model: {e}"
        )

    try:
        data = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read audio file.")

    print(
        f"[sentio] transcribe: filename={file.filename} "
        f"size={len(data)} language={language or '(auto)'}"
    )

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".audio")
    try:
        tmp.write(data)
        tmp.close()
        # Persisting raw microphone recordings is opt-in (privacy default: off).
        if os.environ.get("SAVE_RECORDINGS") == "1":
            try:
                os.makedirs(RECORDINGS_DIR, exist_ok=True)
                import time as _time
                with open(
                    os.path.join(RECORDINGS_DIR, f"{int(_time.time())}_{file.filename or 'audio'}"),
                    "wb",
                ) as save:
                    save.write(data)
            except Exception:
                pass
        segments_iter, _ = model.transcribe(
            tmp.name,
            language=language or None,
            initial_prompt=WHISPER_INITIAL_PROMPT if language == "my" else None,
        )
        segments = list(segments_iter)
        text = " ".join(segment.text for segment in segments).strip()
        # Report unusable Burmese decodes as failure (empty text) so the
        # Next.js route proceeds to the next provider instead of receiving
        # replacement-character soup at HTTP 200.
        if language == "my" and text and not looks_like_burmese(text):
            print(
                f"[sentio] transcribe result rejected (unusable Burmese "
                f"output): {text[:80]!r}"
            )
            text = ""
        print(f"[sentio] transcribe result: {text!r}")
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription error: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Burmese/English text-to-speech (edge-tts bridge)
#
# Azure Speech ships the best Burmese neural voices (my-MM-NilarNeural /
# my-MM-ThihaNeural), but requires a paid Azure subscription that is
# unavailable in some regions. The open-source edge-tts package reaches the
# same voices through Microsoft Edge's speech endpoint with no account, key,
# or card, so /tts exposes them locally for the Next.js /api/tts route to use
# as a provider between Azure (when configured) and ElevenLabs.
# ---------------------------------------------------------------------------

EDGE_TTS_VOICE_MY = os.environ.get("TTS_VOICE_MY", "my-MM-NilarNeural")
EDGE_TTS_VOICE_EN = os.environ.get("TTS_VOICE_EN", "en-US-JennyNeural")
EDGE_TTS_MAX_CHARS = 2000  # Mirrors MAX_TTS_TEXT_CHARS in lib/tts.ts.
EDGE_TTS_TIMEOUT_S = 25.0  # Mirrors TTS_TIMEOUT_MS in lib/tts.ts.


class TtsRequest(BaseModel):
    text: str
    language: str = "my"


@app.post("/tts")
async def tts(request: TtsRequest):
    unavailable = None
    try:
        import edge_tts  # noqa: PLC0415
    except ImportError:
        unavailable = (
            "edge-tts is not installed in the backend environment "
            "(pip install edge-tts)."
        )
    if unavailable is not None:
        raise HTTPException(status_code=503, detail=unavailable)

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must be non-empty.")
    if len(text) > EDGE_TTS_MAX_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Text too long (max {EDGE_TTS_MAX_CHARS} characters).",
        )

    lang = request.language.strip().lower()
    voice = EDGE_TTS_VOICE_EN if lang.startswith("en") else EDGE_TTS_VOICE_MY

    async def _synthesize() -> bytes:
        communicate = edge_tts.Communicate(text, voice)
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)

    try:
        audio = await asyncio.wait_for(_synthesize(), timeout=EDGE_TTS_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=502, detail="TTS synthesis timed out.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS synthesis failed: {e}")

    if not audio:
        raise HTTPException(
            status_code=502, detail="TTS provider returned empty audio."
        )
    return Response(content=audio, media_type="audio/mpeg")


# Mirrors lib/engineProfiles.ts — keep both in sync (that file is canonical).
EMOTION_STRENGTH_PROFILES: Dict[str, Dict[str, int]] = {
    "stressed": {"depth": 1, "skillLevel": 1, "elo": 1320},
    "frustrated": {"depth": 2, "skillLevel": 3, "elo": 1320},
    "calm": {"depth": 4, "skillLevel": 6, "elo": 1600},
    "neutral": {"depth": 6, "skillLevel": 10, "elo": 2000},
    "focused": {"depth": 8, "skillLevel": 15, "elo": 2600},
    "confident": {"depth": 10, "skillLevel": 20, "elo": 3190},
}
MIN_UCI_ELO = 1320
MAX_UCI_ELO = 3190


class MoveRequest(BaseModel):
    fen: str
    emotion: str = "neutral"
    # "play" (default) uses the adaptive emotion profile; "hint" always uses
    # maximum strength so hints are high quality regardless of detected emotion.
    purpose: str = "play"


HINT_PROFILE: Dict[str, int] = {"depth": 14, "skillLevel": 20, "elo": MAX_UCI_ELO}


def resolve_strength_profile(emotion: str, purpose: str = "play"):
    if purpose == "hint":
        return "hint", HINT_PROFILE.copy()
    normalized_emotion = emotion.strip().lower()
    if normalized_emotion not in EMOTION_STRENGTH_PROFILES:
        normalized_emotion = "neutral"
    profile = EMOTION_STRENGTH_PROFILES[normalized_emotion].copy()
    profile["elo"] = max(MIN_UCI_ELO, min(MAX_UCI_ELO, profile["elo"]))
    return normalized_emotion, profile


# ---------------------------------------------------------------------------
# Stockfish engine pool
#
# Spawning a fresh Stockfish process per request costs ~100-300ms of process
# startup plus UCI handshake. Instead we keep a small pool of persistent
# instances and reconfigure them per request (set_depth /
# update_engine_parameters / set_fen_position fully reset search state).
# ---------------------------------------------------------------------------

MAX_ENGINE_POOL_SIZE = max(1, int(os.environ.get("STOCKFISH_POOL_SIZE", "4")))
_engine_pool: "queue.Queue" = queue.Queue()
_engine_pool_lock = threading.Lock()
_engine_pool_size = 0


def _spawn_engine(path: str):
    return Stockfish(
        path=path,
        depth=6,
        parameters={"Threads": 2},
    )


def _acquire_engine(path: str, timeout: float = 15.0):
    # The wait timeout MUST stay below the frontend's 20s engine-request
    # timeout (hooks/useChessGame.ts) so a saturated pool surfaces as a fast
    # 503 ("All Stockfish engine instances are busy") instead of a silent
    # client-side "Engine request timed out".
    global _engine_pool_size
    try:
        return _engine_pool.get_nowait()
    except queue.Empty:
        pass
    with _engine_pool_lock:
        can_grow = _engine_pool_size < MAX_ENGINE_POOL_SIZE
        if can_grow:
            _engine_pool_size += 1
    if can_grow:
        return _spawn_engine(path)
    # Pool is at capacity — wait for another request to release its engine.
    try:
        return _engine_pool.get(timeout=timeout)
    except queue.Empty:
        raise HTTPException(
            status_code=503,
            detail="All Stockfish engine instances are busy. Try again shortly.",
        )


def _release_engine(engine) -> None:
    _engine_pool.put(engine)


def _discard_engine(engine) -> None:
    """Terminate a broken engine and free its pool slot.

    Without the size decrement the slot stays counted forever: after
    MAX_ENGINE_POOL_SIZE failed requests the pool believes it is at capacity
    while holding zero live instances, so every subsequent request blocks in
    queue.get() until timeout — which manifests on the frontend as
    "Engine request timed out".
    """
    global _engine_pool_size
    try:
        engine.send_quit_command()
    except Exception:
        pass
    with _engine_pool_lock:
        _engine_pool_size = max(0, _engine_pool_size - 1)


@app.post("/api/bot-move")
async def get_bot_move(request: MoveRequest):
    path = stockfish_path if _is_executable(stockfish_path) else resolve_stockfish_path()
    if not _is_executable(path):
        raise HTTPException(
            status_code=500,
            detail="Stockfish engine binary is missing on server. "
            "Set STOCKFISH_PATH env var, run: sudo apt install stockfish, "
            "or use Docker (docker compose up).",
        )

    emotion, profile = resolve_strength_profile(request.emotion, request.purpose)

    engine = None
    engine_healthy = False
    try:
        engine = _acquire_engine(path)

        # Reconfigure the pooled instance for this request. Setting Skill Level
        # alongside UCI_LimitStrength/UCI_Elo keeps the profile explicit; when
        # UCI_LimitStrength is enabled Stockfish derives strength from UCI_Elo.
        engine.set_depth(profile["depth"])
        engine.update_engine_parameters(
            {
                "Threads": 2,
                "Skill Level": profile["skillLevel"],
                "UCI_LimitStrength": True,
                "UCI_Elo": profile["elo"],
            }
        )

        try:
            engine.set_fen_position(request.fen)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid FEN position received."
            )
        best_move = engine.get_best_move()
        engine_healthy = True

        engine_profile = {
            "emotion": emotion,
            "depth": profile["depth"],
            "skillLevel": profile["skillLevel"],
            "elo": profile["elo"],
        }

        if not best_move:
            return {
                "botMove": None,
                "status": "Checkmate or Draw",
                "engineProfile": engine_profile,
            }

        return {
            "botMove": best_move,
            "engineProfile": engine_profile,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine evaluation error: {str(e)}")
    finally:
        # Return healthy engines to the pool; discard engines that errored so a
        # corrupted process can never be reused (and its pool slot is freed).
        if engine is not None:
            if engine_healthy:
                _release_engine(engine)
            else:
                _discard_engine(engine)


# ---------------------------------------------------------------------------
# Logician panel (Prolog)
#
# Purely additive: converts a FEN into Prolog facts, asserts them into the
# knowledge base in prolog/ai_system.pl, and queries advice/3 for prioritized,
# human-readable recommendations. If SWI-Prolog / pyswip / python-chess are
# not installed, this endpoint reports available=false and nothing else in
# the app is affected.
# ---------------------------------------------------------------------------

PROLOG_KB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "prolog", "ai_system.pl")
)

_prolog_instance = None
_prolog_lock = threading.Lock()
_prolog_unavailable_reason: str | None = None

PIECE_TYPE_NAMES = {
    1: "pawn",
    2: "knight",
    3: "bishop",
    4: "rook",
    5: "queen",
    6: "king",
}


def _prolog_availability() -> str | None:
    """Return None when Prolog reasoning is usable, else a human-readable reason."""
    global _prolog_instance, _prolog_unavailable_reason
    if _prolog_instance is not None:
        return None
    if _prolog_unavailable_reason is not None:
        return _prolog_unavailable_reason

    with _prolog_lock:
        if _prolog_instance is not None:
            return None
        try:
            from pyswip import Prolog  # noqa: PLC0415
        except ImportError:
            _prolog_unavailable_reason = (
                "pyswip is not installed in the backend environment "
                "(pip install pyswip)."
            )
            return _prolog_unavailable_reason
        if not os.path.isfile(PROLOG_KB_PATH):
            _prolog_unavailable_reason = (
                f"Prolog knowledge base not found at {PROLOG_KB_PATH}."
            )
            return _prolog_unavailable_reason
        try:
            prolog = Prolog()
            prolog.consult(PROLOG_KB_PATH)
            _prolog_instance = prolog
        except Exception as e:  # pragma: no cover - depends on local SWI-Prolog
            _prolog_unavailable_reason = f"Failed to load Prolog KB: {e}"
    return _prolog_unavailable_reason


class PrologAdviceRequest(BaseModel):
    fen: str


@app.post("/api/prolog-advice")
async def prolog_advice(request: PrologAdviceRequest):
    unavailable = _prolog_availability()
    if unavailable is not None:
        return {"available": False, "detail": unavailable}

    try:
        import chess  # noqa: PLC0415
    except ImportError:
        return {
            "available": False,
            "detail": "python-chess is not installed (pip install python-chess).",
        }

    try:
        board = chess.Board(request.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN position.")

    side = "white" if board.turn == chess.WHITE else "black"
    facts: list[str] = []

    for square, piece in board.piece_map().items():
        name = chess.square_name(square)
        color = "white" if piece.color == chess.WHITE else "black"
        facts.append(f"piece({name}, {color}, {PIECE_TYPE_NAMES[piece.piece_type]})")

    facts.append(f"turn({side})")
    facts.append(f"move_number({board.fullmove_number})")

    # Castling heuristic: a king that reached the c/g file has castled.
    king_square = board.king(chess.WHITE)
    if king_square is not None and chess.square_name(king_square) in ("c1", "g1"):
        facts.append("castled(white)")
    king_square = board.king(chess.BLACK)
    if king_square is not None and chess.square_name(king_square) in ("c8", "g8"):
        facts.append("castled(black)")

    if board.is_check():
        facts.append(f"in_check({side})")

    for square in chess.SQUARES:
        name = chess.square_name(square)
        if board.attackers(chess.WHITE, square):
            facts.append(f"attacked_by({name}, white)")
        if board.attackers(chess.BLACK, square):
            facts.append(f"attacked_by({name}, black)")
        occupant = board.piece_at(square)
        if occupant is not None and board.attackers(occupant.color, square):
            facts.append(f"defended_by({name}, {'white' if occupant.color == chess.WHITE else 'black'})")

    prolog = _prolog_instance
    results: list[dict] = []
    with _prolog_lock:
        try:
            for functor, arity in (
                ("piece", 3),
                ("turn", 1),
                ("move_number", 1),
                ("castled", 1),
                ("in_check", 1),
                ("attacked_by", 2),
                ("defended_by", 2),
            ):
                args = ",".join("_" * arity)
                list(prolog.query(f"retractall({functor}({args}))"))
            for fact in facts:
                list(prolog.query(f"assertz({fact})"))
            for solution in prolog.query("advice(P, C, T)", maxresult=24):
                results.append(
                    {
                        "priority": int(solution["P"]),
                        "category": str(solution["C"]),
                        "text": str(solution["T"]),
                    }
                )
        except Exception as e:  # pragma: no cover - depends on local SWI-Prolog
            return {"available": False, "detail": f"Prolog query failed: {e}"}

    results.sort(key=lambda item: item["priority"], reverse=True)
    return {"available": True, "advice": results[:6]}
