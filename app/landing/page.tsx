import Link from "next/link";
import MagneticButton from "@/components/MagneticButton";
import LandingAnimations from "@/components/LandingAnimations";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function LandingPage() {
  return (
    <>
      <LandingAnimations />

      {/* ------------------------------------------------------------------ */}
      {/* Nav                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <nav className="landing-nav fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4 bg-[rgba(10,13,20,0.7)] border-b border-[rgba(120,134,158,0.15)]">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          {/* Inline SVG king icon — simplified crown + cross silhouette */}
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Base */}
            <path
              d="M6 22h16l-2 4H8l-2-4z"
              fill="#f59e0b"
              fillOpacity="0.8"
            />
            {/* Body */}
            <path
              d="M9 22V12l-1-4h12l-1 4v10"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Crown band */}
            <line
              x1="8.5"
              y1="12"
              x2="19.5"
              y2="12"
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Ball */}
            <circle cx="14" cy="6.5" r="2" fill="#f59e0b" fillOpacity="0.9" />
            {/* Cross vertical */}
            <line
              x1="14"
              y1="2"
              x2="14"
              y2="4.5"
              stroke="#f59e0b"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            {/* Cross horizontal */}
            <line
              x1="11.8"
              y1="3.2"
              x2="16.2"
              y2="3.2"
              stroke="#f59e0b"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
            Sentio
          </span>
        </Link>
        <MagneticButton
          href="/"
          className="px-5 py-2 text-sm font-medium rounded-lg bg-[var(--sentio-accent)] text-[#0a0d14] hover:brightness-110 no-underline"
        >
          Play
        </MagneticButton>
      </nav>

      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="hero-section min-h-screen flex flex-col items-center justify-center text-center px-6">
        <h1 className="hero-headline text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-tight max-w-4xl text-[var(--foreground)]">
          Your chess opponent reads your face.
        </h1>
        <p className="hero-subtitle mt-6 max-w-xl text-base sm:text-lg text-[var(--text-muted)] leading-relaxed">
          Sentio watches your expressions through the webcam and adapts
          Stockfish&apos;s difficulty in real time — easier when you&apos;re
          struggling, harder when you&apos;re cruising.
        </p>
        <MagneticButton
          href="/"
          className="cta-button mt-10 px-8 py-3.5 text-base font-semibold rounded-xl bg-[var(--sentio-accent)] text-[#0a0d14] hover:brightness-110 no-underline"
        >
          Play Now
        </MagneticButton>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Features                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="features-section py-24 sm:py-32 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Emotion Detection */}
          <Card className="feature-card border-border/40 bg-card/85 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-lg bg-[var(--sentio-accent-glow)] flex items-center justify-center mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--sentio-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
              Emotion Detection
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Webcam reads your expressions in real time and maps them to your
              emotional state.
            </p>
          </Card>

          {/* Adaptive Difficulty */}
          <Card className="feature-card border-border/40 bg-card/85 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-lg bg-[var(--sentio-accent-glow)] flex items-center justify-center mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--sentio-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <circle cx="4" cy="12" r="2" />
                <circle cx="12" cy="10" r="2" />
                <circle cx="20" cy="14" r="2" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
              Adaptive Difficulty
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Engine strength adjusts to match your state — ELO ranges from
              1320 to 3190.
            </p>
          </Card>

          {/* LLM Coach */}
          <Card className="feature-card border-border/40 bg-card/85 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-lg bg-[var(--sentio-accent-glow)] flex items-center justify-center mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--sentio-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
              LLM Coach
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Ask for advice on any position and get natural language analysis
              with suggested moves.
            </p>
          </Card>

          {/* Voice Moves */}
          <Card className="feature-card border-border/40 bg-card/85 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-lg bg-[var(--sentio-accent-glow)] flex items-center justify-center mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--sentio-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
              Voice Moves
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Speak moves in Burmese or English to play them — backed by local
              or cloud STT.
            </p>
          </Card>

          {/* 3D Board */}
          <Card className="feature-card border-border/40 bg-card/85 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-lg bg-[var(--sentio-accent-glow)] flex items-center justify-center mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--sentio-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
              3D Board
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Toggle a Three.js simulation that mirrors your game with a
              fully-articulated               robot opponent.
            </p>
          </Card>

          {/* Replays */}
          <Card className="feature-card border-border/40 bg-card/85 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-lg bg-[var(--sentio-accent-glow)] flex items-center justify-center mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--sentio-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
              Replays
            </h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Save and review past games with full move history               and PGN export.
            </p>
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* How it works                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="how-section py-24 sm:py-32 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-[var(--foreground)] mb-16">
            How it works
          </h2>
          <div className="flex flex-col sm:flex-row items-center sm:items-start justify-center gap-8 sm:gap-0 relative">
            <div className="step flex-1 flex flex-col items-center text-center px-4">
              <div className="step-number w-12 h-12 rounded-full bg-[var(--sentio-accent)] text-[#0a0d14] flex items-center justify-center text-lg font-bold mb-4">
                1
              </div>
              <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
                Play
              </h3>
              <p className="text-sm text-[var(--text-muted)]">
                Make your moves on the board.
              </p>
            </div>

            {/* SVG connecting line */}
            <svg
              className="hidden sm:block absolute top-6 left-[calc(33.33%+1rem)] right-[calc(33.33%+1rem)] h-0.5"
              viewBox="0 0 200 2"
              preserveAspectRatio="none"
            >
              <line
                className="how-line"
                x1="0"
                y1="1"
                x2="200"
                y2="1"
                stroke="var(--sentio-accent)"
                strokeWidth="2"
                strokeOpacity="0.4"
              />
            </svg>

            <div className="step flex-1 flex flex-col items-center text-center px-4">
              <div className="step-number w-12 h-12 rounded-full bg-[var(--sentio-accent)] text-[#0a0d14] flex items-center justify-center text-lg font-bold mb-4">
                2
              </div>
              <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
                Detect
              </h3>
              <p className="text-sm text-[var(--text-muted)]">
                Webcam reads your expression.
              </p>
            </div>

            <div className="step flex-1 flex flex-col items-center text-center px-4">
              <div className="step-number w-12 h-12 rounded-full bg-[var(--sentio-accent)] text-[#0a0d14] flex items-center justify-center text-lg font-bold mb-4">
                3
              </div>
              <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
                Adapt
              </h3>
              <p className="text-sm text-[var(--text-muted)]">
                Engine adjusts to match your state.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Emotion Profiles                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="profiles-section py-24 sm:py-32 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-[var(--foreground)] mb-12">
            Emotion → Engine
          </h2>
          <Card className="rounded-2xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--panel-border)]">
                  <th className="px-5 py-3 font-medium text-[var(--text-muted)]">
                    State
                  </th>
                  <th className="px-5 py-3 font-medium text-[var(--text-muted)]">
                    ELO
                  </th>
                  <th className="px-5 py-3 font-medium text-[var(--text-muted)]">
                    Depth
                  </th>
                  <th className="px-5 py-3 font-medium text-[var(--text-muted)]">
                    Skill
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="profile-row border-b border-[var(--panel-border)] opacity-0">
                  <td className="px-5 py-3 flex items-center gap-2.5 text-[var(--foreground)]">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "var(--emotion-stressed)" }}
                    />
                    Stressed
                  </td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">1320</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">1</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">1</td>
                </tr>
                <tr className="profile-row border-b border-[var(--panel-border)] opacity-0">
                  <td className="px-5 py-3 flex items-center gap-2.5 text-[var(--foreground)]">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "var(--emotion-frustrated)" }}
                    />
                    Frustrated
                  </td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">1320</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">2</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">3</td>
                </tr>
                <tr className="profile-row border-b border-[var(--panel-border)] opacity-0">
                  <td className="px-5 py-3 flex items-center gap-2.5 text-[var(--foreground)]">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "var(--emotion-calm)" }}
                    />
                    Calm
                  </td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">1600</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">4</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">6</td>
                </tr>
                <tr className="profile-row border-b border-[var(--panel-border)] opacity-0">
                  <td className="px-5 py-3 flex items-center gap-2.5 text-[var(--foreground)]">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "var(--emotion-neutral)" }}
                    />
                    Neutral
                  </td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">2000</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">6</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">10</td>
                </tr>
                <tr className="profile-row border-b border-[var(--panel-border)] opacity-0">
                  <td className="px-5 py-3 flex items-center gap-2.5 text-[var(--foreground)]">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "var(--emotion-focused)" }}
                    />
                    Focused
                  </td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">2600</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">8</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">15</td>
                </tr>
                <tr className="profile-row opacity-0">
                  <td className="px-5 py-3 flex items-center gap-2.5 text-[var(--foreground)]">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "var(--emotion-confident)" }}
                    />
                    Confident
                  </td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">3190</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">10</td>
                  <td className="px-5 py-3 text-[var(--text-muted)]">20</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Tech Stack                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="tech-section py-24 sm:py-32 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] mb-10">
            Built with
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              "React",
              "Next.js",
              "TypeScript",
              "Stockfish",
              "Python",
              "FastAPI",
              "face-api.js",
              "Three.js",
              "anime.js",
              "Tailwind CSS",
              "chess.js",
            ].map((tech) => (
              <Badge
                key={tech}
                variant="outline"
                className="tech-chip px-4 py-2 text-sm rounded-lg opacity-0"
              >
                {tech}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CTA                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="cta-section py-32 sm:py-40 px-6 text-center">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(245,158,11,0.08), transparent)",
          }}
        />
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[var(--foreground)] mb-8 relative">
          Play against an opponent
          <br />
          that watches you back.
        </h2>
        <MagneticButton
          href="/"
          className="cta-button relative px-10 py-4 text-lg font-semibold rounded-xl bg-[var(--sentio-accent)] text-[#0a0d14] hover:brightness-110 no-underline"
        >
          Start Playing
        </MagneticButton>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="py-8 text-center text-sm text-[var(--text-muted)] border-t border-[var(--panel-border)]">
        <p>
          &copy; 2026 Sentio &middot;{" "}
          <a
            href="https://github.com"
            className="underline hover:text-[var(--sentio-accent)] transition-colors"
          >
            GitHub
          </a>
        </p>
      </footer>
    </>
  );
}
