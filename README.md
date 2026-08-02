# ♟️ Sentio — Emotion-Adaptive Chess Agent

> *Latin for "I feel" — a chess engine that reads your emotions and adapts in real time.*

**Sentio** is a full-stack chess application where you play against a **Stockfish AI** engine whose difficulty adapts based on your **detected emotional state** via webcam. It also features an **LLM-powered coaching chat** for position analysis and encouragement.

---

## ✨ Features

- **🎮 Play chess** against Stockfish — click-to-move interface with full legal move validation
- **😊 Emotion-aware engine** — webcam reads your expressions (calm, focused, frustrated, etc.) and adjusts ELO (1320–3190), depth, and skill level on the fly
- **🤖 LLM coach** — ask for advice on any position; get natural-language analysis with clickable "Play [move]" buttons
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

### Backend

| Technology | Purpose |
|---|---|
| ![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white) | Backend language |
| ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white) | REST API framework |
| ![Uvicorn](https://img.shields.io/badge/Uvicorn-000000?style=flat&logo=uvicorn&logoColor=white) | ASGI server |
| ![Stockfish](https://img.shields.io/badge/Stockfish-5B4638?style=flat&logo=chess&logoColor=white) | Chess engine |

### AI / ML

| Technology | Purpose |
|---|---|
| ![LM Studio](https://img.shields.io/badge/LM_Studio-FF6F00?style=flat&logo=openai&logoColor=white) | Local LLM inference for coaching |
| ![face-api.js](https://img.shields.io/badge/face--api.js_TinyFaceDetector-FF6F00?style=flat&logo=opencv&logoColor=white) | Lightweight face detection & expression analysis |

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
│  │  (validation)│  │  Handler)               │  │
│  └──────┬───────┘  └──────────┬─────────────┘  │
│         │                     │                 │
│  ┌──────┴─────────────────────┴─────────────┐  │
│  │         Next.js App (Server Layer)        │  │
│  │    Route: /api/bot-move (proxies to      │  │
│  │          Python backend)                  │  │
│  └──────────────────┬──────────────────────┘  │
└─────────────────────┼─────────────────────────┘
                      │ HTTP
┌─────────────────────┴─────────────────────────┐
│           Python Backend (FastAPI)             │
│  ┌──────────────────────────────────────────┐  │
│  │        POST /api/bot-move                │  │
│  │   { fen, emotion } → { botMove, profile }│  │
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

### 3. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` if needed:

| Variable | Default | Description |
|---|---|---|
| `BOT_MOVE_API_URL` | `http://127.0.0.1:8000/api/bot-move` | Python backend endpoint |
| `COACH_LLM_ENABLED` | `true` | Enable/disable LLM coach |
| `COACH_LLM_BASE_URL` | `http://127.0.0.1:1234/v1` | LM Studio API base URL |
| `COACH_LLM_MODEL` | `qwen/qwen3.5-9b` | Model name in LM Studio |

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

## 📁 Project Structure

```
chess-agent/
├── app/
│   ├── api/
│   │   ├── bot-move/route.ts    # Proxies moves to Python backend
│   │   └── coach/route.ts       # LLM coach route handler
│   ├── layout.tsx               # Root layout (fonts, metadata, theme)
│   └── page.tsx                 # SPA — all game UI and logic
├── backend/
│   ├── main.py                  # FastAPI app — Stockfish bridge
│   ├── requirements.txt         # Python dependencies
│   ├── stockfish                # Precompiled macOS binary
│   └── venv/                    # Python virtual environment
├── public/
│   └── models/                  # face-api.js model weights
├── .env.example                 # Environment variable template
├── package.json
├── tsconfig.json
└── next.config.ts
```
