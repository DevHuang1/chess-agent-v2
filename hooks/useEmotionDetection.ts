"use client";

import { useEffect, useRef, useState } from "react";
import type { EmotionLabel } from "@/lib/engineProfiles";

type FaceApiModule = typeof import("@vladmandic/face-api");

const EXPRESSION_TO_EMOTION: Record<string, EmotionLabel> = {
  happy: "confident",
  neutral: "neutral",
  sad: "frustrated",
  angry: "frustrated",
  fearful: "stressed",
  surprised: "focused",
  disgusted: "stressed",
};

const EMOTION_BUFFER_SIZE = 3;
const DETECTION_INTERVAL_MS = 2200;

function isE2ETestRun(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    new URLSearchParams(window.location.search).has("e2e")
  );
}

async function detectEmotionFromVideo(
  faceapi: FaceApiModule,
  videoElement: HTMLVideoElement | null,
): Promise<EmotionLabel> {
  if (
    !videoElement ||
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return "neutral";
  }

  try {
    const detection = await faceapi
      .detectSingleFace(
        videoElement,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }),
      )
      .withFaceExpressions();

    if (!detection?.expressions) {
      return "neutral";
    }

    const sorted = detection.expressions.asSortedArray();
    const top = sorted[0];

    if (!top || top.probability < 0.35) {
      return "neutral";
    }

    return EXPRESSION_TO_EMOTION[top.expression] ?? "neutral";
  } catch {
    return "neutral";
  }
}

/**
 * Smooths a buffer of emotion readings into a single label. Ties are broken
 * toward the previously smoothed emotion so the displayed state doesn't
 * flicker between equally-frequent candidates.
 */
function mostFrequentInBuffer(
  buffer: EmotionLabel[],
  preferred: EmotionLabel,
): EmotionLabel {
  if (buffer.length === 0) return preferred;
  const counts: Record<string, number> = {};
  for (const e of buffer) {
    counts[e] = (counts[e] ?? 0) + 1;
  }
  let best =
    counts[preferred] !== undefined ? preferred : buffer[buffer.length - 1];
  let bestCount = counts[best] ?? 0;
  for (const [label, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = label as EmotionLabel;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Encapsulates the webcam + face-api.js emotion-detection subsystem:
 * camera lifecycle, model loading, periodic inference, and temporal smoothing.
 *
 * The camera and detector pause while the 3D tab is active (or during e2e
 * tests, via the ?e2e query flag).
 */
export function useEmotionDetection(options: {
  activeTab: string;
  auto: boolean;
  onStatus?: (message: string) => void;
}) {
  const { activeTab, auto, onStatus } = options;

  const videoRef = useRef<HTMLVideoElement>(null);
  const faceapiRef = useRef<FaceApiModule | null>(null);
  const emotionHistoryRef = useRef<EmotionLabel[]>([]);
  const emotionBufferRef = useRef<EmotionLabel[]>([]);
  const lastSmoothedRef = useRef<EmotionLabel>("neutral");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [emotion, setEmotion] = useState<EmotionLabel>("neutral");

  // Camera + model lifecycle.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    if (isE2ETestRun() || activeTab === "3d") {
      return () => {
        document.body.style.overflow = "";
      };
    }

    let mediaStream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        mediaStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        console.error("Webcam video source offline:", err);
        onStatus?.("Webcam unavailable. Emotion fallback set to neutral.");
      });

    import("@vladmandic/face-api")
      .then((mod) => {
        Promise.all([
          mod.nets.tinyFaceDetector.loadFromUri("/models"),
          mod.nets.faceExpressionNet.loadFromUri("/models"),
        ])
          .then(() => {
            faceapiRef.current = mod;
            setModelsLoaded(true);
          })
          .catch((loadErr) => {
            console.error("Failed to load face-api models:", loadErr);
            onStatus?.("Emotion models failed to load.");
          });
      })
      .catch((importErr) => {
        console.error("Failed to import face-api:", importErr);
      });

    return () => {
      document.body.style.overflow = "";
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
    // onStatus is a stable setState function; omitting it is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Periodic inference with temporal smoothing.
  useEffect(() => {
    if (
      isE2ETestRun() ||
      activeTab === "3d" ||
      !auto ||
      !faceapiRef.current ||
      !modelsLoaded
    ) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      const api = faceapiRef.current;
      if (!api) return;

      const estimatedEmotion = await detectEmotionFromVideo(
        api,
        videoRef.current,
      );
      const buffer = emotionBufferRef.current;
      buffer.push(estimatedEmotion);
      if (buffer.length > EMOTION_BUFFER_SIZE) {
        buffer.shift();
      }
      const smoothed = mostFrequentInBuffer(buffer, lastSmoothedRef.current);
      lastSmoothedRef.current = smoothed;
      setEmotion(smoothed);
      emotionHistoryRef.current.push(smoothed);
      if (emotionHistoryRef.current.length > 7) {
        emotionHistoryRef.current.shift();
      }
    }, DETECTION_INTERVAL_MS);

    const buffer = emotionBufferRef.current;
    return () => {
      window.clearInterval(intervalId);
      buffer.length = 0;
      emotionHistoryRef.current = [];
    };
  }, [activeTab, auto, modelsLoaded]);

  return { videoRef, modelsLoaded, emotion, setEmotion, emotionHistoryRef };
}
