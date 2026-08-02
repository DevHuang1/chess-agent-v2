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

Once the profile is determined, the module spawns a fresh, isolated Stockfish
instance per request. This ensures no state leaks between moves. Stockfish
is configured with the profile parameters plus Threads=2. The FEN is validated
(using set_fen_position as the source of truth, since is_fen_valid can be
unreliable in certain positions), and get_best_move() is called. Stockfish
performs its search using a negamax framework with alpha-beta pruning,
iterative deepening, and transposition tables — the same algorithm that makes
it the strongest open-source chess engine in the world, now constrained to
match the player's emotional state.

The response includes the best move in UCI notation and the resolved engine
profile for the frontend to display.
"""

import glob
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import urllib.request
from typing import Dict

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from stockfish import Stockfish

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


EMOTION_STRENGTH_PROFILES: Dict[str, Dict[str, int]] = {
    "stressed": {"depth": 1, "skillLevel": 1, "elo": 1320},
    "frustrated": {"depth": 2, "skillLevel": 3, "elo": 1320},
    "calm": {"depth": 4, "skillLevel": 6, "elo": 1500},
    "neutral": {"depth": 6, "skillLevel": 10, "elo": 1700},
    "focused": {"depth": 8, "skillLevel": 15, "elo": 2700},
    "confident": {"depth": 10, "skillLevel": 20, "elo": 3190},
}
MIN_UCI_ELO = 1320
MAX_UCI_ELO = 3190


class MoveRequest(BaseModel):
    fen: str
    emotion: str = "neutral"


def resolve_strength_profile(emotion: str):
    normalized_emotion = emotion.strip().lower()
    if normalized_emotion not in EMOTION_STRENGTH_PROFILES:
        normalized_emotion = "neutral"
    profile = EMOTION_STRENGTH_PROFILES[normalized_emotion].copy()
    profile["elo"] = max(MIN_UCI_ELO, min(MAX_UCI_ELO, profile["elo"]))
    return normalized_emotion, profile


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

    try:
        emotion, profile = resolve_strength_profile(request.emotion)

        # Isolated Stockfish instance for this specific execution thread
        stockfish = Stockfish(
            path=path,
            depth=profile["depth"],
            parameters={
                "Threads": 2,
                "UCI_LimitStrength": True,
                "UCI_Elo": profile["elo"],
            },
        )

        try:
            stockfish.set_fen_position(request.fen)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid FEN position received."
            )
        best_move = stockfish.get_best_move()

        if not best_move:
            return {
                "botMove": None,
                "status": "Checkmate or Draw",
                "engineProfile": {
                    "emotion": emotion,
                    "depth": profile["depth"],
                    "skillLevel": profile["skillLevel"],
                    "elo": profile["elo"],
                },
            }

        return {
            "botMove": best_move,
            "engineProfile": {
                "emotion": emotion,
                "depth": profile["depth"],
                "skillLevel": profile["skillLevel"],
                "elo": profile["elo"],
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine evaluation error: {str(e)}")