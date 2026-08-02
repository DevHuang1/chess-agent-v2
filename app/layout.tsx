/**
 * Sentio — Emotion-Adaptive Chess AI
 * ======================================
 *
 * This is a full-stack chess application where a human plays against Stockfish
 * whose difficulty adapts in real time based on detected emotion from webcam.
 *
 * SYSTEM OVERVIEW:
 * - Emotion Detection: face-api.js (TinyFaceDetector + FaceExpressionNet) in browser
 * - Adaptive Engine: Python FastAPI → Stockfish with emotion-driven ELO/depth/skill
 * - LLM Coach: Next.js API route → LM Studio (local LLM) with fallback analysis
 * - UI: Next.js App Router + React 19 + react-chessboard + Tailwind CSS v4
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Sentio — Emotion-Adaptive Chess",
  description: "Play chess against Stockfish that adapts to your emotions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-screen antialiased overflow-hidden`}
    >
      <body
        className={`${geistSans.className} h-full flex flex-col bg-zinc-900 overflow-hidden`}
      >
        {children}
      </body>
    </html>
  );
}
