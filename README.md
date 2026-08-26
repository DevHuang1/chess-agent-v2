# ♟️ Sentio — Emotion-Adaptive Chess Agent

> _Latin for "I feel" — a chess engine that reads your emotions and adapts in real time._

**Sentio** is a full-stack chess application where you play against a **Stockfish AI** engine whose difficulty adapts based on your **detected emotional state** via webcam. It also features an **LLM-powered coaching chat** for position analysis and encouragement, **voice-controlled moves** (primarily in Burmese), and a **3D board simulation**.

---

## ✨ Features

- **🎮 Play chess** against Stockfish — click-to-move interface with full legal move validation
- **😊 Emotion-aware engine** — webcam reads your expressions (calm, focused, frustrated, etc.) and adjusts ELO (1320–3190), depth, and skill level on the fly
- **🤖 LLM coach** — ask for advice on any position; get natural-language analysis with clickable "Play [move]" buttons
- **🦉 The Logician (Prolog)** — rule-based chess advice from a SWI-Prolog knowledge base (`prolog/ai_system.pl`): hanging pieces, opening principles, castling, center control, endgame tips
- **🎙️ Voice moves** — speak moves (Burmese / English) to play them, backed by local Whisper, Gemini, ElevenLabs, or AssemblyAI transcription
- **💬 Voice Coach** — ask the AI coach a question in Burmese by voice; it answers in natural Burmese and can read the reply aloud via server-side TTS
- **🕹️ 3D simulation** — toggle a Three.js board view that mirrors the game
- **🎨 Light / dark theme** — full light-mode styling via Tailwind v4 `light:` variants
- **💬 Bot trash talk** — the engine taunts or supports you based on your detected emotion
- **🎛️ Manual override** — switch to manual emotion selection at any time
- **👑 Promotion picker** — choose queen / rook / bishop / knight when promoting
- **↩️ Undo** — take back your last move pair (button or `Ctrl/Cmd+Z`); cancels any in-flight engine request
- **💡 Hints** — ask the engine for a strong candidate move, highlighted on the board (5s cooldown)
- **📊 Eval bar** — live engine evaluation beside the board from a shallow search
- **📖 Opening names** — the current opening (with ECO code) shown in the moves panel
- **📄 PGN export** — download any finished game as a PGN file
- **💾 Persistent replays** — saved replay games survive page refreshes

---

## 🧱 Tech Stack

### Frontend

| Technology                                                                                                       | Purpose                                     |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| ![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white)                | React framework (App Router)                |
| ![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)                        | UI library                                  |
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)         | Type safety                                 |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)    | Styling (v4)                                |
| ![chess.js](https://img.shields.io/badge/chess.js-000000?style=flat&logo=chess&logoColor=white)                  | Game logic & move validation                |
| ![react-chessboard](https://img.shields.io/badge/react--chessboard-5B4638?style=flat&logo=chess&logoColor=white) | Interactive chessboard UI                   |
| ![face-api.js](https://img.shields.io/badge/face--api.js-FF6F00?style=flat&logo=openface&logoColor=white)        | Browser-based facial expression recognition |
| ![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat&logo=threedotjs&logoColor=white)             | 3D board simulation                         |
| ![Three.js](https://img.shields.io/badge/CSS--Variables-1572B6?style=flat&logo=css3&logoColor=white)             | Theme switching (`light`/`dark`)            |

### Backend

| Technology                                                                                                    | Purpose                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| ![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)                  | Backend language                           |
| ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)               | REST API framework                         |
| ![Uvicorn](https://img.shields.io/badge/Uvicorn-000000?style=flat&logo=uvicorn&logoColor=white)               | ASGI server                                |
| ![Stockfish](https://img.shields.io/badge/Stockfish-5B4638?style=flat&logo=chess&logoColor=white)             | Chess engine                               |
| ![faster-whisper](https://img.shields.io/badge/faster--whisper-FF6F00?style=flat&logo=openai&logoColor=white) | Local Burmese speech-to-text (CTranslate2) |

### AI / ML

| Technology                                                                                                               | Purpose                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| ![LM Studio](https://img.shields.io/badge/LM_Studio-FF6F00?style=flat&logo=openai&logoColor=white)                       | Local LLM inference for coaching                 |
| ![face-api.js](https://img.shields.io/badge/face--api.js_TinyFaceDetector-FF6F00?style=flat&logo=opencv&logoColor=white) | Lightweight face detection & expression analysis |
| ![Groq](https://img.shields.io/badge/Groq-F55036?style=flat&logo=groq&logoColor=white)                                   | Cloud LLM inference for coaching (default)       |
| ![ElevenLabs](https://img.shields.io/badge/ElevenLabs-000000?style=flat&logo=elevenlabs&logoColor=white)                 | Cloud speech transcription (scribe_v2)           |
| ![AssemblyAI](https://img.shields.io/badge/AssemblyAI-00A5A8?style=flat&logo=assemblyai&logoColor=white)                 | Cloud speech transcription (universal)           |
| ![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=flat&logo=google&logoColor=white)                             | Cloud speech transcription (gemini-2.0-flash)    |

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
- _(Optional)_ **SWI-Prolog** (`brew install swi-prolog`) + `pip install pyswip python-chess` in the backend venv — powers the Logician panel. Without it, everything else works and the Logician tab shows a setup hint.

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

| Variable                 | Default                                   | Description                                       |
| ------------------------ | ----------------------------------------- | ------------------------------------------------- |
| `BOT_MOVE_API_URL`       | `http://127.0.0.1:8000/api/bot-move`      | Python backend endpoint                           |
| `COACH_LLM_ENABLED`      | `true`                                    | Enable/disable LLM coach                          |
| `COACH_LLM_BASE_URL`     | `http://127.0.0.1:1234/v1`                | LM Studio API base URL                            |
| `COACH_LLM_MODEL`        | `qwen2.5-7b-instruct`                     | Model name in LM Studio                           |
| `GROQ_API_KEY`           | —                                         | Groq API key (default coach provider)             |
| `COACH_GROQ_MODEL`       | `llama-3.3-70b-versatile`                 | Groq model for coaching                           |
| `BACKEND_PROLOG_API_URL` | `http://127.0.0.1:8000/api/prolog-advice` | Backend Prolog advice endpoint (Logician)         |
| `BACKEND_TRANSCRIBE_URL` | `http://localhost:8000/api/transcribe`    | Local Whisper transcription endpoint              |
| `GEMINI_API_KEY`         | —                                         | Google Gemini key (speech + transcribe fallback)  |
| `GEMINI_MODEL`           | `gemini-2.0-flash`                        | Gemini model for transcription                    |
| `ELEVENLABS_API_KEY`     | —                                         | ElevenLabs key (scribe_v2 transcription + multilingual TTS) |
| `ELEVENLABS_MODEL`       | `scribe_v2`                               | ElevenLabs transcription model                    |
| `ASSEMBLYAI_API_KEY`     | —                                         | AssemblyAI key (universal transcription)          |
| `ELEVENLABS_TTS_MODEL`   | `eleven_multilingual_v2`                  | ElevenLabs TTS model (supports Burmese)           |
| `ELEVENLABS_TTS_VOICE_ID`| stock voice                               | ElevenLabs voice id for read-aloud replies        |
| `STOCKFISH_PATH`         | —                                         | Optional custom Stockfish binary path             |
| `STOCKFISH_POOL_SIZE`    | `4`                                       | Backend: number of persistent Stockfish instances |
| `BACKEND_CORS_ORIGINS`   | `http://localhost:3000,...`               | Backend: comma-separated allowed origins          |
| `SAVE_RECORDINGS`        | off (`1` to enable)                       | Backend: opt-in saving of raw mic recordings      |

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

| Emotion       | Depth | Skill | ELO  |
| ------------- | ----- | ----- | ---- |
| 😰 Stressed   | 1     | 1     | 1320 |
| 😤 Frustrated | 2     | 3     | 1320 |
| 😌 Calm       | 4     | 6     | 1600 |
| 😐 Neutral    | 6     | 10    | 2000 |
| 🎯 Focused    | 8     | 15    | 2600 |
| 😎 Confident  | 10    | 20    | 3190 |

The webcam captures frames every **2.2 seconds**, runs **TinyFaceDetector + FaceExpressionNet**, buffers the last 3 readings, and sets the majority emotion automatically (ties keep the previous emotion to avoid flicker).

These profiles are defined once in [`lib/engineProfiles.ts`](lib/engineProfiles.ts) and mirrored by the Python backend — keep both in sync if you change them.

---

## 🎙️ Voice Moves

Open the Speech tab and select a transcription provider:

| Provider          | How it runs                                                         | Setup                                                           |
| ----------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Local Whisper** | `backend/models/whisper-small-burmese-v2-ct2` via `/api/transcribe` | Run the conversion script (see below); zero cost, fully offline |
| **Gemini**        | Cloud `gemini-2.0-flash`                                            | `GEMINI_API_KEY`                                                |
| **ElevenLabs**    | Cloud `scribe_v2` with `language_code: mya`                         | `ELEVENLABS_API_KEY`                                            |
| **AssemblyAI**    | Cloud `universal` with a language code                              | `ASSEMBLYAI_API_KEY`                                            |

Spoken moves are parsed by `lib/speechParser.ts`, which understands Burmese phonetics (e.g. `မိဗျား` → Queen, `၏` → e-file, `အာ့` → f-file) plus standard algebraic notation, then resolved against the current legal moves.

---

## 🎙️ Burmese Voice Moves vs. Burmese Voice Coach

These are **two separate features** that reuse the same Burmese transcription backend but route to entirely different actions:

| | 🗣️ Voice Moves (Speech tab) | 🗣️ Voice Coach (AI Coach tab) |
|---|---|---|
| **What you say** | A chess command, e.g. `မြင်း f3 ကို` | A question, e.g. `ဒီအခြေအနေမှာ ဘယ်လိုရွှေ့သင့်လဲ` |
| **Flow** | record → `/api/transcribe` → `parseChessMove()` → validate → execute | record → `/api/transcribe` → editable transcript → `/api/coach` → chat reply → optional speak |
| **Output** | A legal move is played on the board | A Burmese coaching answer is shown and can be read aloud |

The two interfaces are kept visibly and logically separate. The Voice Move path is **unchanged** — it still requires the audio to resolve to a legal move before anything is executed. Voice Coach never auto-plays a move just because you asked a question; the existing typed-question rules (`questionWantsMove`) alone decide whether a `bestMove` is offered.

### How Burmese Voice Coach works

1. In the **AI Coach** tab, use the 🎙️ *Burmese Voice Coach* mic button (push-to-talk).
2. The browser records a short clip and posts it to `/api/transcribe` with `language=my` (reusing the exact providers below).
3. The raw transcript is shown in an **editable** text box so you can fix transcription errors before submitting.
4. On submit, `/api/coach` receives `{ fen, emotion, recentEmotions, question, mode, responseLanguage: "my", inputLanguage: "my", source: "voice-coach" }` and is instructed to answer in natural Burmese Unicode while keeping chess notation (`e4`, `Nf3`, `O-O`, `Qxd5`) and FEN values unchanged.
5. Each assistant reply gets a 🔊 **read aloud** speaker button. Press it (or enable *Read replies aloud*) to speak the reply in Burmese via server-side TTS. If TTS is unavailable, the visible Burmese text always remains available.

### Enabling Burmese voice input

Set up one of the transcription providers for `/api/transcribe` (server-side keys only):

| Provider    | Setup                                                          |
| ----------- | -------------------------------------------------------------- |
| **Local Whisper** | Run `scripts/convert_burmese_to_ct2.py` to build the CT2 model; zero cost, fully offline, no key. Tried first in the Burmese chain. |
| **Gemini**  | `GEMINI_API_KEY` — must be a real API key (`AIza…`), not an OAuth token (`AQ…`) |
| **ElevenLabs** | `ELEVENLABS_API_KEY` (STT model `scribe_v2`, `language_code: mya`). Tried before Gemini in the Burmese chain. |
| **AssemblyAI** | `ASSEMBLYAI_API_KEY`                                        |

> **Known limitation (ElevenLabs STT):** Scribe returns **romanized** Burmese
> (e.g. `မြင်း f3 ကို` → `"Mang F3Q SRP"`) rather than Myanmar script. This is
> fine for **Voice Coach** (the LLM reads transliteration), but for **Voice
> Move** the romanized piece word is ambiguous and may parse as a *different,
> legal* move (e.g. `Kf3` instead of knight f3). Prefer local Whisper or Gemini
> for reliable move parsing; both return native script. The editable transcript
> in Voice Coach lets you correct any transcription before asking.

### Configuring Burmese text-to-speech (TTS)

Server-side Burmese TTS supports three providers, tried in this order:

1. **Azure Speech (primary)** — ships dedicated, **generally available** Burmese neural voices (`my-MM-NilarNeural` female / `my-MM-ThihaNeural` male), so pronunciation is accurate. Configure:
   - `AZURE_SPEECH_KEY` — Azure Speech resource key
   - `AZURE_SPEECH_REGION` — e.g. `southeastasia`
   - `AZURE_TTS_VOICE_MY` — optional; defaults to `my-MM-NilarNeural` (use `my-MM-ThihaNeural` for a male voice)
2. **Local edge-tts bridge (recommended default)** — the Python backend exposes `POST /tts` using the open-source [`edge-tts`](https://pypi.org/project/edge-tts/) package, which serves the **same Azure-quality Burmese neural voices through Microsoft Edge's speech endpoint with no Azure account, key, or card required**. Requires only that the Python backend is running (`uvicorn main:app`) and `pip install edge-tts`. Voice overrides: `TTS_VOICE_MY` / `TTS_VOICE_EN`.
3. **ElevenLabs `eleven_multilingual_v2` (last resort)** — does **not officially list Burmese**, so pronunciation is approximate and can be poor. Used automatically when both Azure and the local bridge are unavailable or fail.

Credentials always stay server-side (`process.env`), never in the browser.

| Env var | Required | Purpose |
| ------- | -------- | ------- |
| `AZURE_SPEECH_KEY` | Optional | Azure Speech resource key (official path to best Burmese quality) |
| `AZURE_SPEECH_REGION` | With the key | e.g. `southeastasia` |
| `AZURE_TTS_VOICE_MY` | No | Defaults to `my-MM-NilarNeural` |
| `BACKEND_TTS_URL` | Recommended | Local edge-tts bridge URL (default: `http://localhost:8000/tts`) |
| `ELEVENLABS_API_KEY` | Fallback | ElevenLabs TTS/STT |
| `ELEVENLABS_TTS_VOICE_ID` | No | Free-plan-safe premade voice (default: Roger) |

The response includes an `X-TTS-Provider` header (`azure`, `edge`, `elevenlabs`, or `elevenlabs-fallback`) so you can see which path served the audio.

When every configured provider fails, the coach reply is still shown as text and the speaker button falls back (optionally) to the browser's own `SpeechSynthesis` **only if a Burmese voice is present**; otherwise it simply stays as text with a retry affordance. We do **not** assume any cloud or browser voice exists.

### Audio & privacy

- Microphone clips and transcripts are treated as sensitive data. API keys live server-side; nothing goes in `NEXT_PUBLIC_*`.
- Raw recordings are **not** logged, and full coaching text is not logged server-side.
- The microphone is only used while you are actively recording (push-to-talk) and all tracks are stopped when recording ends or the component unmounts.
- Generated speech is served as a short-lived audio buffer and `URL.revokeObjectURL()` is called after use — **no audio is stored permanently and no database is added** for coach audio.

> The `prolog/ai_system.pl` knowledge base is a **standalone declarative model** and is **not** part of the runtime voice-coaching service, which is implemented entirely in `app/api/transcribe`, `app/api/coach`, and `app/api/tts`.

---

## 📁 Project Structure

```
chess-agent/
├── app/
│   ├── api/
│   │   ├── bot-move/route.ts    # Proxies moves to Python backend
│   │   ├── coach/route.ts       # LLM coach route handler (Groq / LM Studio)
│   │   ├── transcribe/route.ts  # Voice → text (local or cloud STT)
│   │   └── tts/route.ts         # Server-side Burmese text-to-speech
│   ├── layout.tsx               # Root layout (fonts, metadata, theme)
│   └── page.tsx                 # SPA — all game UI and logic
├── backend/
│   ├── main.py                  # FastAPI app — Stockfish bridge + transcription
│   ├── requirements.txt         # Python dependencies
│   ├── stockfish                # Precompiled macOS binary
│   ├── models/                  # CTranslate2 Whisper model (local STT)
│   └── venv/                    # Python virtual environment
├── components/
│   ├── EvalBar.tsx              # Vertical engine evaluation bar
│   ├── GameInfo.tsx             # Move history + captures + opening name
│   ├── LogicianPanel.tsx        # Prolog-derived advice UI
│   ├── Simulation3D.tsx         # Three.js 3D board (theme-aware)
│   └── SpeechTab.tsx            # Voice move UI (provider selector)
├── hooks/
│   ├── useEmotionDetection.ts   # Webcam + face-api emotion subsystem
│   └── useSidebarPreferences.ts # Persisted controller layout
├── lib/
│   ├── openings.ts              # Opening book (longest-prefix name lookup)
│   └── speechParser.ts          # Burmese/English move parsing + resolution
├── prolog/
│   └── ai_system.pl             # Prolog KB: emotion profiles + chess reasoning
├── scripts/
│   └── convert_burmese_to_ct2.py  # Model conversion for local STT
├── public/
│   └── models/                  # face-api.js model weights
├── .env.local                   # Environment variables (create from table above)
├── package.json
├── tsconfig.json
└── next.config.ts
```
