"use client";

import { useEffect, useRef } from "react";
import type { FaceFrame, FacePoint } from "@/lib/faceExplain";
import type { EmotionLabel } from "@/lib/engineProfiles";

/**
 * Transparent canvas overlaid on the webcam feed that draws face markers:
 * bounding box, eye/iris markers, eyebrow and lip contour lines.
 *
 * Reads the latest detection snapshot from a ref at requestAnimationFrame
 * cadence (the snapshot updates once per detection cycle) so the overlay
 * never re-renders the React tree. Landmarks are normalized to the video
 * frame and mapped through the same object-cover transform the <video> uses;
 * the canvas carries the same CSS mirror as the video, so drawing happens in
 * raw video coordinates.
 */

/** Emotion accent colors, matching EmotionMonitor's palette. */
const EMOTION_RGB: Record<EmotionLabel, string> = {
  calm: "#38bdf8",
  focused: "#22d3ee",
  neutral: "#a1a1aa",
  frustrated: "#fb923c",
  stressed: "#f87171",
  confident: "#34d399",
};

// MediaPipe FaceLandmarker canonical index groups (478-point mesh).
const MP_LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const MP_RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const MP_LEFT_IRIS = [469, 470, 471, 472];
const MP_RIGHT_IRIS = [474, 475, 476, 477];
const MP_LEFT_BROW = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336];
const MP_RIGHT_BROW = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107];
const MP_LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const MP_LIPS_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const MP_FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

// face-api.js 68-point landmark groups (iBUG ordering).
const FA68_EYE_R = [36, 37, 38, 39, 40, 41];
const FA68_EYE_L = [42, 43, 44, 45, 46, 47];
const FA68_BROW_R = [17, 18, 19, 20, 21];
const FA68_BROW_L = [22, 23, 24, 25, 26];
const FA68_LIPS_OUTER = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
const FA68_LIPS_INNER = [60, 61, 62, 63, 64, 65, 66, 67];
const FA68_JAW = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

type LandmarkGroups = {
  eyes: number[][];
  irises: number[][];
  brows: number[][];
  lips: number[][];
  outline: number[][];
};

const MP_GROUPS: LandmarkGroups = {
  eyes: [MP_LEFT_EYE, MP_RIGHT_EYE],
  irises: [MP_LEFT_IRIS, MP_RIGHT_IRIS],
  brows: [MP_LEFT_BROW, MP_RIGHT_BROW],
  lips: [MP_LIPS_OUTER, MP_LIPS_INNER],
  outline: [MP_FACE_OVAL],
};

const FA68_GROUPS: LandmarkGroups = {
  eyes: [FA68_EYE_R, FA68_EYE_L],
  irises: [],
  brows: [FA68_BROW_R, FA68_BROW_L],
  lips: [FA68_LIPS_OUTER, FA68_LIPS_INNER],
  outline: [FA68_JAW],
};

function groupsFor(frame: FaceFrame): LandmarkGroups {
  return frame.landmarks.length > 100 ? MP_GROUPS : FA68_GROUPS;
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: FacePoint[],
  indices: number[],
  toCanvas: (p: FacePoint) => { x: number; y: number },
  closed: boolean,
) {
  if (indices.length < 2) return;
  ctx.beginPath();
  indices.forEach((idx, i) => {
    const p = points[idx];
    if (!p) return;
    const { x, y } = toCanvas(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (closed) ctx.closePath();
  ctx.stroke();
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export default function FaceOverlayCanvas({
  frameRef,
  emotion,
  active,
}: {
  frameRef: React.RefObject<FaceFrame | null>;
  emotion: EmotionLabel;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let lastDrawnAt = -1;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        lastDrawnAt = -1; // force redraw after resize
      }

      const frame = frameRef.current;
      if (!frame || frame.landmarks.length === 0) {
        if (lastDrawnAt !== 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          lastDrawnAt = 0;
        }
        return;
      }
      if (frame.at === lastDrawnAt) return;
      lastDrawnAt = frame.at;

      const color = EMOTION_RGB[emotion] ?? EMOTION_RGB.neutral;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // object-cover mapping: scale the video frame to cover the canvas,
      // center it, crop the overflow. The CSS mirror on the canvas flips the
      // whole bitmap, so drawing happens in raw (unmirrored) coords.
      const scale = Math.max(
        rect.width / frame.videoWidth,
        rect.height / frame.videoHeight,
      );
      const dw = frame.videoWidth * scale;
      const dh = frame.videoHeight * scale;
      const ox = (rect.width - dw) / 2;
      const oy = (rect.height - dh) / 2;
      const toCanvas = (p: FacePoint) => ({
        x: (ox + p.x * dw) * dpr,
        y: (oy + p.y * dh) * dpr,
      });

      const s = dpr; // stroke widths scale with the bitmap
      const groups = groupsFor(frame);

      // Face outline + dashed bounding box with emotion label chip.
      ctx.lineWidth = 1.5 * s;
      ctx.strokeStyle = `${color}cc`;
      for (const outline of groups.outline) {
        drawPolyline(ctx, frame.landmarks, outline, toCanvas, true);
      }
      if (frame.box) {
        const b = frame.box;
        const x = (ox + b.x * dw) * dpr;
        const y = (oy + b.y * dh) * dpr;
        const bw = b.width * dw * dpr;
        const bh = b.height * dh * dpr;
        ctx.lineWidth = 1.5 * s;
        ctx.setLineDash([6 * s, 4 * s]);
        ctx.strokeRect(x, y, bw, bh);
        ctx.setLineDash([]);
        const label = frame.emotion;
        ctx.font = `${11 * s}px ui-monospace, monospace`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = `${color}e6`;
        ctx.fillRect(x, Math.max(0, y - 16 * s), textWidth + 10 * s, 15 * s);
        ctx.fillStyle = "#09090b";
        ctx.fillText(label, x + 5 * s, Math.max(11 * s, y - 5 * s));
      }

      // Brows and lips as contour lines.
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = color;
      for (const brow of groups.brows) {
        drawPolyline(ctx, frame.landmarks, brow, toCanvas, false);
      }
      for (const lips of groups.lips) {
        drawPolyline(ctx, frame.landmarks, lips, toCanvas, true);
      }

      // Eyes: closed outline plus marker dots; iris ring + center dot when
      // the backend provides an iris mesh (MediaPipe only).
      ctx.lineWidth = 1.5 * s;
      for (const eye of groups.eyes) {
        drawPolyline(ctx, frame.landmarks, eye, toCanvas, true);
        for (const idx of eye) {
          const p = frame.landmarks[idx];
          if (!p) continue;
          const { x, y } = toCanvas(p);
          drawDot(ctx, x, y, 1.8 * s, color);
        }
      }
      for (const iris of groups.irises) {
        drawPolyline(ctx, frame.landmarks, iris, toCanvas, true);
        const center = frame.landmarks[iris[0] - 1];
        if (center) {
          const { x, y } = toCanvas(center);
          drawDot(ctx, x, y, 2.6 * s, color);
        }
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [active, emotion, frameRef]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1]"
      aria-hidden="true"
    />
  );
}
