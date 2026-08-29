"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

const LandingWebGL = dynamic(() => import("@/components/LandingWebGL"), {
  ssr: false,
});

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const lenis = new Lenis({
      wrapper: el,
      content: el,
      duration: 1.2,
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 1,
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);

  return (
    <div ref={containerRef} className="landing-scroll-root">
      <LandingWebGL />
      <main className="landing-content">{children}</main>
    </div>
  );
}
