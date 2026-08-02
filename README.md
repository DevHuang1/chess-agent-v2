# ♟️ Sentio — Emotion-Adaptive Chess Agent

> *Latin for "I feel" — a chess engine that reads your emotions and adapts in real time.*

**Sentio** is a full-stack chess application where you play against a **Stockfish AI** engine whose difficulty adapts based on your **detected emotional state** via webcam. It also features an **LLM-powered coaching chat** for position analysis and encouragement, **voice-controlled moves** (primarily in Burmese), and a **3D board simulation**.

---

## ✨ Features

- **🎮 Play chess** against Stockfish — click-to-move interface with full legal move validation
- **😊 Emotion-aware engine** — webcam reads your expressions (calm, focused, frustrated, etc.) and adjusts ELO (1320–3190), depth, and skill level on the fly
- **🤖 LLM coach** — ask for advice on any position; get natural-language analysis with clickable "Play [move]" buttons
- **🎙️ Voice moves** — speak moves (Burmese / English) to play them, backed by local Whisper, Gemini, ElevenLabs, or AssemblyAI transcription
- **🕹️ 3D simulation** — toggle a Three.js board view that mirrors the game
- **🎨 Light / dark theme** — full light-mode styling via Tailwind v4 `light:` variants
- **💬 Bot trash talk** — the engine taunts or supports you based on your detected emotion
- **🎛️ Manual override** — switch to manual emotion selection at any time

---

## 🧱 Tech Stack

### Frontend

| Technology | Purpose |
|---|---|
| ![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white) | React framework (App Router) |
| ![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black) | UI library |
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white) | Type safety |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white) | Styling (v4) |
| ![chess.js](https://img.shields.io/badge/chess.js-000000?style=flat&logo=chess&logoColor=white) | Game logic & move validation |
| ![react-chessboard](https://img.shields.io/badge/react--chessboard-5B4638?style=flat&logo=chess&logoColor=white) | Interactive chessboard UI |
| ![face-api.js](https://img.shields.io/badge/face--api.js-FF6F00?style=flat&logo=openface&logoColor=white) | Browser-based facial expression recognition |
| ![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat&logo=threedotjs&logoColor=white) | 3D board simulation |
| ![Three.js](https://img.shields.io/badge/CSS--Variables-1572B6?style=flat&logo=css3&logoColor=white) | Theme switching (`light`/`dark`) |

### Backend

| Technology | Purpose |
|---|---|
| ![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white) | Backend language |
| ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white) | REST API framework |
| ![Uvicorn](https://img.shields.io/badge/Uvicorn-000000?style=flat&logo=uvicorn&logoColor=white) | ASGI server |
| ![Stockfish](https://img.shields.io/badge/Stockfish-5B4638?style=flat&logo=chess&logoColor=white) | Chess engine |
| ![faster-whisper](https://img.shields.io/badge/faster--whisper-FF6F00?style=flat&logo=openai&logoColor=white) | Local Burmese speech-to-text (CTranslate2) |

### AI / ML

| Technology | Purpose |
|---|---|
| ![LM Studio](https://img.shields.io/badge/LM_Studio-FF6F00?style=flat&logo=openai&logoColor=white) | Local LLM inference for coaching |
| ![face-api.js](https://img.shields.io/badge/face--api.js_TinyFaceDetector-FF6F00?style=flat&logo=opencv&logoColor=white) | Lightweight face detection & expression analysis |
| ![Groq](https://img.shields.io/badge/Groq-F55036?style=flat&logo=groq&logoColor=white) | Cloud LLM inference for coaching (default) |
| ![ElevenLabs](https://img.shields.io/badge/ElevenLabs-000000?style=flat&logo=elevenlabs&logoColor=white) | Cloud speech transcription (scribe_v2) |
| ![AssemblyAI](https://img.shields.io/badge/AssemblyAI-00A5A8?style=flat&logo=assemblyai&logoColor=white) | Cloud speech transcription (universal) |
| ![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=flat&logo=google&logoColor=white) | Cloud speech transcription (gemini-2.0-flash) |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────┐
│                   Browser                       │
│  ┌──────────────┐  ┌────────────────────────┐  │
│  │   Chessboard  │  │   Coach Chat Panel     │  │
│  │  (react-chess │  │   (LLM conversation)   │  │
│  │   board)      │  │                        │  │
│  └──────┬───────┘  └──────────┬─────────────┘  │
│         │                     │                 │
│  ┌──────┴───────┐  ┌──────────┴─────────────┐  │
│  │  chess.js    │  │  /api/coach (Route      │  │
│  │  (validation)│  │  Handler → Groq/LM      │  │
│  └──────┬───────┘  │  Studio)                │  │
│         │          └──────────┬─────────────┘  │
│  ┌──────┴─────────────────────┴─────────────┐  │
│  │         Next.js App (Server Layer)        │  │
│  │    Route: /api/bot-move (proxies to      │  │
│  │          Python backend)                  │  │
│  │    Route: /api/transcribe (voice moves    │  │
│  │          → local Whisper or cloud STT)    │  │
│  └──────────────────┬──────────────────────┘  │
└─────────────────────┼─────────────────────────┘
                      │ HTTP
┌─────────────────────┴─────────────────────────┐
│           Python Backend (FastAPI)             │
│  ┌──────────────────────────────────────────┐  │
│  │        POST /api/bot-move                │  │
│  │   { fen, emotion } → { botMove, profile }│  │
│  │        POST /api/transcribe              │  │
│  │   audio → Burmese text (faster-whisper)  │  │
│  └──────────────────┬───────────────────────┘  │
│                     │                          │
│  ┌──────────────────┴───────────────────────┐  │
│  │            Stockfish Engine               │  │
│  │   (per-request isolated instance)         │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js ≥ 18
- Python ≥ 3.10
- Stockfish engine binary (included at `backend/stockfish` for macOS)
- faster-whisper + a CTranslate2 Burmese model at `backend/models/whisper-small-burmese-v2-ct2` (for local voice moves)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the Python backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

To enable **local Burmese voice moves**, convert the `bobolink/whisper-small-burmese-v2` model to CTranslate2:

```bash
python scripts/convert_burmese_to_ct2.py
```

This writes `backend/models/whisper-small-burmese-v2-ct2`.

### 3. Configure environment

Create `.env.local` in the project root and add the variables you need (see table below):

| Variable | Default | Description |
|---|---|---|
| `BOT_MOVE_API_URL` | `http://127.0.0.1:8000/api/bot-move` | Python backend endpoint |
| `COACH_LLM_ENABLED` | `true` | Enable/disable LLM coach |
| `COACH_LLM_BASE_URL` | `http://127.0.0.1:1234/v1` | LM Studio API base URL |
| `COACH_LLM_MODEL` | `qwen2.5-7b-instruct` | Model name in LM Studio |
| `GROQ_API_KEY` | — | Groq API key (default coach provider) |
| `COACH_GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model for coaching |
| `BACKEND_TRANSCRIBE_URL` | `http://localhost:8000/api/transcribe` | Local Whisper transcription endpoint |
| `GEMINI_API_KEY` | — | Google Gemini key (speech + transcribe fallback) |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model for transcription |
| `ELEVENLABS_API_KEY` | — | ElevenLabs key (scribe_v2 transcription) |
| `ELEVENLABS_MODEL` | `scribe_v2` | ElevenLabs transcription model |
| `ASSEMBLYAI_API_KEY` | — | AssemblyAI key (universal transcription) |
| `STOCKFISH_PATH` | — | Optional custom Stockfish binary path |

### 4. Start the backend

```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 5. Start the frontend

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

> **Note:** If you see `ERR_CONNECTION_REFUSED`, make sure the Python backend is running on port `8000`.

---

## 🧩 Emotion → Engine Profiles

| Emotion | Depth | Skill | ELO |
|---|---|---|---|
| 😰 Stressed | 1 | 1 | 1320 |
| 😤 Frustrated | 2 | 3 | 1320 |
| 😌 Calm | 4 | 6 | 1600 |
| 😐 Neutral | 6 | 10 | 2000 |
| 🎯 Focused | 8 | 15 | 2600 |
| 😎 Confident | 10 | 20 | 3190 |

The webcam captures frames every **2.2 seconds**, runs **TinyFaceDetector + FaceExpressionNet**, buffers the last 3 readings, and sets the majority emotion automatically.

---

## 🎙️ Voice Moves

Open the Speech tab and select a transcription provider:

| Provider | How it runs | Setup |
|---|---|---|
| **Local Whisper** | `backend/models/whisper-small-burmese-v2-ct2` via `/api/transcribe` | Run the conversion script (see below); zero cost, fully offline |
| **Gemini** | Cloud `gemini-2.0-flash` | `GEMINI_API_KEY` |
| **ElevenLabs** | Cloud `scribe_v2` with `language_code: mya` | `ELEVENLABS_API_KEY` |
| **AssemblyAI** | Cloud `universal` with a language code | `ASSEMBLYAI_API_KEY` |

Spoken moves are parsed by `lib/speechParser.ts`, which understands Burmese phonetics (e.g. `မိဗျား` → Queen, `၏` → e-file, `အာ့` → f-file) plus standard algebraic notation, then resolved against the current legal moves.

---

## 📁 Project Structure

```
chess-agent/
├── app/
│   ├── api/
│   │   ├── bot-move/route.ts    # Proxies moves to Python backend
│   │   ├── coach/route.ts       # LLM coach route handler (Groq / LM Studio)
│   │   └── transcribe/route.ts  # Voice → text (local or cloud STT)
│   ├── layout.tsx               # Root layout (fonts, metadata, theme)
│   └── page.tsx                 # SPA — all game UI and logic
├── backend/
│   ├── main.py                  # FastAPI app — Stockfish bridge + transcription
│   ├── requirements.txt         # Python dependencies
│   ├── stockfish                # Precompiled macOS binary
│   ├── models/                  # CTranslate2 Whisper model (local STT)
│   └── venv/                    # Python virtual environment
├── components/
│   ├── GameInfo.tsx             # Move history + captures
│   ├── Simulation3D.tsx         # Three.js 3D board (theme-aware)
│   └── SpeechTab.tsx            # Voice move UI (provider selector)
├── lib/
│   └── speechParser.ts          # Burmese/English move parsing + resolution
├── scripts/
│   └── convert_burmese_to_ct2.py  # Model conversion for local STT
├── public/
│   └── models/                  # face-api.js model weights
├── .env.local                   # Environment variables (create from table above)
├── package.json
├── tsconfig.json
└── next.config.ts
```
