"use client";

import { useEffect } from "react";
import { animate, stagger } from "animejs";

function splitTextToChars(el: HTMLElement): HTMLElement[] {
  const text = el.textContent ?? "";
  el.textContent = "";
  const chars: HTMLElement[] = [];
  for (const ch of text) {
    const span = document.createElement("span");
    span.textContent = ch;
    span.style.display = "inline-block";
    span.style.opacity = "0";
    span.style.transform = "translateY(16px)";
    el.appendChild(span);
    chars.push(span);
  }
  return chars;
}

export default function LandingAnimations() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document
        .querySelectorAll<HTMLElement>(
          ".hero-headline, .hero-subtitle, .cta-button, " +
            ".feature-card, .step, .profile-row, .tech-chip",
        )
        .forEach((el) => {
          el.style.opacity = "1";
          el.style.transform = "none";
        });
      return;
    }

    const cleanupFns: (() => void)[] = [];

    // Hero headline — split into chars, reveal on scroll
    const headlineEl = document.querySelector<HTMLElement>(".hero-headline");
    if (headlineEl) {
      const chars = splitTextToChars(headlineEl);
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            animate(chars, {
              opacity: [0, 1],
              translateY: [16, 0],
              duration: 600,
              delay: stagger(25),
              ease: "outQuad",
            });
            io.disconnect();
          }
        },
        { threshold: 0.3 },
      );
      io.observe(headlineEl);
      cleanupFns.push(() => io.disconnect());
    }

    // Hero subtitle + CTA
    const heroRevealTargets = document.querySelectorAll<HTMLElement>(
      ".hero-subtitle, .cta-button",
    );
    const heroIo = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          animate(heroRevealTargets, {
            opacity: [0, 1],
            translateY: [20, 0],
            duration: 800,
            delay: stagger(150),
            ease: "outQuad",
          });
          heroIo.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    if (heroRevealTargets.length) heroIo.observe(heroRevealTargets[0].closest("section")!);
    cleanupFns.push(() => heroIo.disconnect());

    // Feature cards — stagger from center
    const featureCards = document.querySelectorAll<HTMLElement>(".feature-card");
    if (featureCards.length) {
      const featureIo = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            animate(featureCards, {
              opacity: [0, 1],
              translateY: [40, 0],
              duration: 700,
              delay: stagger(100, { from: "center" }),
              ease: "outExpo",
            });
            featureIo.disconnect();
          }
        },
        { threshold: 0.15 },
      );
      featureIo.observe(featureCards[0].closest("section")!);
      cleanupFns.push(() => featureIo.disconnect());
    }

    // How it works steps
    const steps = document.querySelectorAll<HTMLElement>(".step");
    if (steps.length) {
      const stepIo = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            animate(steps, {
              opacity: [0, 1],
              translateY: [30, 0],
              duration: 600,
              delay: stagger(200),
              ease: "outQuad",
            });
            stepIo.disconnect();
          }
        },
        { threshold: 0.2 },
      );
      stepIo.observe(steps[0].closest("section")!);
      cleanupFns.push(() => stepIo.disconnect());
    }

    // SVG connecting line in how-section
    const svgLine = document.querySelector<SVGLineElement>(".how-line");
    if (svgLine) {
      const lineIo = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            const len = svgLine.getTotalLength?.() ?? 300;
            svgLine.style.strokeDasharray = String(len);
            svgLine.style.strokeDashoffset = String(len);
            animate(svgLine, {
              strokeDashoffset: [len, 0],
              duration: 1200,
              ease: "inOutQuad",
            });
            lineIo.disconnect();
          }
        },
        { threshold: 0.3 },
      );
      lineIo.observe(svgLine.closest("section")!);
      cleanupFns.push(() => lineIo.disconnect());
    }

    // Emotion profile rows
    const profileRows = document.querySelectorAll<HTMLElement>(".profile-row");
    if (profileRows.length) {
      const profileIo = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            animate(profileRows, {
              opacity: [0, 1],
              translateX: [-20, 0],
              duration: 500,
              delay: stagger(70),
              ease: "outQuad",
            });
            profileIo.disconnect();
          }
        },
        { threshold: 0.15 },
      );
      profileIo.observe(profileRows[0].closest("section")!);
      cleanupFns.push(() => profileIo.disconnect());
    }

    // Tech chips
    const techChips = document.querySelectorAll<HTMLElement>(".tech-chip");
    if (techChips.length) {
      const techIo = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            animate(techChips, {
              opacity: [0, 1],
              scale: [0.8, 1],
              duration: 400,
              delay: stagger(50),
              ease: "outQuad",
            });
            techIo.disconnect();
          }
        },
        { threshold: 0.2 },
      );
      techIo.observe(techChips[0].closest("section")!);
      cleanupFns.push(() => techIo.disconnect());
    }

    // Feature card tilt on hover
    const tiltCleanups: (() => void)[] = [];
    featureCards.forEach((card) => {
      const onMove = (e: MouseEvent) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(600px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateZ(4px)`;
      };
      const onLeave = () => {
        card.style.transform = "";
      };
      card.addEventListener("mousemove", onMove);
      card.addEventListener("mouseleave", onLeave);
      tiltCleanups.push(() => {
        card.removeEventListener("mousemove", onMove);
        card.removeEventListener("mouseleave", onLeave);
      });
    });

    return () => {
      cleanupFns.forEach((fn) => fn());
      tiltCleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
