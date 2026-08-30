"use client";

import { useEffect, useRef, useState } from "react";
import {
  classifyEmotion,
  pickEmotion,
  type EmotionScores,
} from "@/lib/emotionClassifier";
import { fuseEmotion, type GameSignals } from "@/lib/emotionFusion";
import { classifyBlendshapes } from "@/lib/blendshapeEmotion";
import {
  blendshapeEvidence,
  type FaceBox,
  type FaceFrame,
  type FacePoint,
} from "@/lib/faceExplain";
import type { EmotionLabel } from "@/lib/engineProfiles";

type FaceApiModule = typeof import("@vladmandic/face-api");
type VisionModule = typeof import("@mediapipe/tasks-vision");
type FaceLandmarkerInstance = Awaited<
  ReturnType<VisionModule["FaceLandmarker"]["createFromOptions"]>
>;

/**
 * Which facial-analysis backend drives emotion detection. Set
 * NEXT_PUBLIC_EMOTION_BACKEND=blendshapes to use the MediaPipe
 * FaceLandmarker valence/arousal pipeline (more accurate separation of
 * calm/neutral/focused/stressed); the default remains the lightweight
 * face-api.js expression classifier. Both fall back to "neutral" when the
 * camera or models are unavailable.
 */
const EMOTION_BACKEND: "face-api" | "blendshapes" =
  process.env.NEXT_PUBLIC_EMOTION_BACKEND === "blendshapes"
    ? "blendshapes"
    : "face-api";

const EMOTION_BUFFER_SIZE = 3;
const DETECTION_INTERVAL_MS = 2200;
/** How many timeline samples to retain for the monitor UI. */
const EMOTION_TIMELINE_LIMIT = 120;

export type EmotionSource = "face-api" | "blendshapes" | "fallback";

export type DetectionOutcome = {
  emotion: EmotionLabel;
  scores: EmotionScores;
};

type DetectionResult = DetectionOutcome & { frame: FaceFrame | null };

function fallbackResult(): DetectionResult {
  return {
    ...fallbackOutcome(),
    frame: null,
  };
}

/** One smoothed emotion sample with the time it became active. */
export type EmotionTimelineEntry = {
  emotion: EmotionLabel;
  at: number;
};

function isE2ETestRun(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    new URLSearchParams(window.location.search).has("e2e")
  );
}

function fallbackOutcome(): DetectionOutcome {
  return { emotion: "neutral", scores: classifyEmotion(null).scores };
}

/** face-api.js path: landmarks + full expression distribution → classifier. */
async function detectWithFaceApi(
  faceapi: FaceApiModule,
  videoElement: HTMLVideoElement | null,
): Promise<DetectionResult> {
  if (
    !videoElement ||
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return fallbackResult();
  }

  try {
    // Landmarks + box feed the face-marker overlay; the expression channels
    // drive the classifier exactly as before.
    const detection = await faceapi
      .detectSingleFace(
        videoElement,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }),
      )
      .withFaceLandmarks()
      .withFaceExpressions();

    if (!detection?.expressions) {
      return fallbackResult();
    }

    // Pass every channel's probability to the classifier instead of argmax:
    // elevated-but-not-dominant fear/disgust/surprise still carry signal.
    const raw = detection.expressions as unknown as Record<string, unknown>;
    const expressions: Record<string, number> = {};
    for (const key of [
      "happy",
      "neutral",
      "sad",
      "angry",
      "fearful",
      "disgusted",
      "surprised",
    ]) {
      const value = raw[key];
      expressions[key] = typeof value === "number" ? value : 0;
    }
    const outcome = classifyEmotion(expressions);

    // Normalize landmarks and box into 0..1 video coordinates.
    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    const landmarks: FacePoint[] = detection.landmarks.positions.map((p) => ({
      x: p.x / vw,
      y: p.y / vh,
    }));
    const rawBox = detection.detection.box;
    const box: FaceBox = {
      x: rawBox.x / vw,
      y: rawBox.y / vh,
      width: rawBox.width / vw,
      height: rawBox.height / vh,
    };
    const channels = Object.entries(expressions)
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score);

    return {
      ...outcome,
      frame: {
        at: Date.now(),
        source: "face-api",
        videoWidth: vw,
        videoHeight: vh,
        box,
        landmarks,
        evidence: { kind: "expressions", channels },
        emotion: outcome.emotion,
        fusionNotes: [],
      },
    };
  } catch {
    return fallbackResult();
  }
}

/** MediaPipe path: blendshapes → valence/arousal → circumplex scores. */
function detectWithBlendshapes(
  landmarker: FaceLandmarkerInstance,
  videoElement: HTMLVideoElement | null,
): DetectionResult {
  if (
    !videoElement ||
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return fallbackResult();
  }

  try {
    const result = landmarker.detectForVideo(videoElement, performance.now());
    const categories = result.faceBlendshapes?.[0]?.categories;
    if (!categories?.length) {
      return fallbackResult();
    }
    const plain = categories.map((c) => ({
      categoryName: c.categoryName,
      score: c.score,
    }));
    const { emotion, scores } = classifyBlendshapes(plain);

    // FaceLandmarker always emits normalized landmarks alongside blendshapes,
    // so the overlay costs nothing extra to feed.
    const rawLandmarks = result.faceLandmarks?.[0];
    const landmarks: FacePoint[] = rawLandmarks
      ? rawLandmarks.map((p) => ({ x: p.x, y: p.y }))
      : [];
    const evidence = blendshapeEvidence(plain);
    const box: FaceBox | null =
      landmarks.length > 0 ? boxFromLandmarks(landmarks) : null;

    return {
      emotion,
      scores,
      frame: {
        at: Date.now(),
        source: "blendshapes",
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        box,
        landmarks,
        evidence: {
          kind: "blendshapes",
          contributions: evidence.contributions,
          valence: evidence.valence,
          arousal: evidence.arousal,
        },
        emotion,
        fusionNotes: [],
      },
    };
  } catch {
    return fallbackResult();
  }
}

/** Tight bounding box around a set of normalized landmarks. */
function boxFromLandmarks(landmarks: FacePoint[]): FaceBox {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
 * Encapsulates the webcam emotion-detection subsystem: camera lifecycle,
 * model loading, periodic inference, gameplay-signal fusion, and temporal
 * smoothing.
 *
 * Detection runs one of two backends (see EMOTION_BACKEND):
 *   - "face-api"     TinyFaceDetector + FaceExpressionNet, scored by the
 *                    composite classifier (lib/emotionClassifier.ts)
 *   - "blendshapes"  MediaPipe FaceLandmarker blendshapes mapped through a
 *                    valence/arousal circumplex (lib/blendshapeEmotion.ts)
 *
 * When `getGameSignals` is supplied, each reading is additionally fused with
 * gameplay telemetry (lib/emotionFusion.ts) before smoothing.
 *
 * The camera and detector pause while the 3D tab is active (or during e2e
 * tests, via the ?e2e query flag).
 */
export function useEmotionDetection(options: {
  activeTab: string;
  auto: boolean;
  onStatus?: (message: string) => void;
  getGameSignals?: () => Partial<GameSignals> | null;
}) {
  const { activeTab, auto, onStatus, getGameSignals } = options;

  const videoRef = useRef<HTMLVideoElement>(null);
  const faceapiRef = useRef<FaceApiModule | null>(null);
  const landmarkerRef = useRef<FaceLandmarkerInstance | null>(null);
  // Latest raw detection snapshot for the face-marker overlay. Kept in a ref
  // so the canvas can poll it at rAF cadence without re-rendering the tree.
  const latestFrameRef = useRef<FaceFrame | null>(null);
  const emotionHistoryRef = useRef<EmotionLabel[]>([]);
  const emotionBufferRef = useRef<EmotionLabel[]>([]);
  const lastSmoothedRef = useRef<EmotionLabel>("neutral");
  // Stable access to the latest telemetry provider without re-triggering
  // the inference effect below.
  const gameSignalsRef = useRef(getGameSignals);
  useEffect(() => {
    gameSignalsRef.current = getGameSignals;
  }, [getGameSignals]);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [emotion, setEmotion] = useState<EmotionLabel>("neutral");
  const [emotionScores, setEmotionScores] = useState<EmotionScores | null>(
    null,
  );
  const [emotionTimeline, setEmotionTimeline] = useState<
    EmotionTimelineEntry[]
  >([]);
  // State mirror of latestFrameRef for React consumers (the "why" card);
  // updates once per detection cycle (~2.2s), not per animation frame.
  const [latestFrame, setLatestFrame] = useState<FaceFrame | null>(null);

  // Camera + model lifecycle.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    if (isE2ETestRun() || activeTab === "3d") {
      return () => {
        document.body.style.overflow = "";
      };
    }

    let mediaStream: MediaStream | null = null;
    let cancelled = false;

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

    const loadFaceApi = (): void => {
      import("@vladmandic/face-api")
        .then((mod) => {
          Promise.all([
            mod.nets.tinyFaceDetector.loadFromUri("/models"),
            mod.nets.faceExpressionNet.loadFromUri("/models"),
            // FaceLandmark68Net is required for .withFaceLandmarks(), which
            // feeds the face-marker overlay (box + 68 landmarks).
            mod.nets.faceLandmark68Net.loadFromUri("/models"),
          ])
            .then(() => {
              if (cancelled) return;
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
    };

    if (EMOTION_BACKEND === "blendshapes") {
      import("@mediapipe/tasks-vision")
        .then(async (vision) => {
          const fileset = await vision.FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
          );
          const landmarker = await vision.FaceLandmarker.createFromOptions(
            fileset,
            {
              baseOptions: {
                modelAssetPath: "/models/face_landmarker.task",
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numFaces: 1,
              outputFaceBlendshapes: true,
              outputFacialTransformationMatrixes: false,
            },
          );
          if (cancelled) {
            landmarker.close();
            return;
          }
          landmarkerRef.current = landmarker;
          setModelsLoaded(true);
        })
        .catch((err) => {
          console.error(
            "Blendshape backend unavailable; falling back to face-api:",
            err,
          );
          if (!cancelled) loadFaceApi();
        });
    } else {
      loadFaceApi();
    }

    return () => {
      cancelled = true;
      document.body.style.overflow = "";
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      faceapiRef.current = null;
    };
    // onStatus is a stable setState function; omitting it is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Periodic inference with fusion + temporal smoothing.
  useEffect(() => {
    const backendReady =
      EMOTION_BACKEND === "blendshapes"
        ? landmarkerRef.current !== null
        : faceapiRef.current !== null;
    if (
      isE2ETestRun() ||
      activeTab === "3d" ||
      !auto ||
      !backendReady ||
      !modelsLoaded
    ) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      let result: DetectionResult;
      if (EMOTION_BACKEND === "blendshapes") {
        const landmarker = landmarkerRef.current;
        if (!landmarker) return;
        result = detectWithBlendshapes(landmarker, videoRef.current);
      } else {
        const faceapi = faceapiRef.current;
        if (!faceapi) return;
        result = await detectWithFaceApi(faceapi, videoRef.current);
      }

      // Fuse with gameplay telemetry when a provider is wired up.
      const signals = gameSignalsRef.current?.();
      const fused = signals
        ? fuseEmotion(result.scores, signals)
        : {
            emotion: pickEmotion(result.scores),
            scores: result.scores,
            notes: [] as string[],
          };

      // The frame (with fusion notes attached) feeds both the marker overlay
      // (via ref, read at rAF cadence) and the "why" card (via state).
      if (result.frame) {
        const frame: FaceFrame = {
          ...result.frame,
          emotion: fused.emotion,
          fusionNotes: fused.notes,
        };
        latestFrameRef.current = frame;
        setLatestFrame(frame);
      } else {
        latestFrameRef.current = null;
        setLatestFrame(null);
      }

      const buffer = emotionBufferRef.current;
      buffer.push(fused.emotion);
      if (buffer.length > EMOTION_BUFFER_SIZE) {
        buffer.shift();
      }
      const smoothed = mostFrequentInBuffer(buffer, lastSmoothedRef.current);
      lastSmoothedRef.current = smoothed;
      setEmotion(smoothed);
      setEmotionScores(fused.scores);
      setEmotionTimeline((prev) => [
        ...prev.slice(-(EMOTION_TIMELINE_LIMIT - 1)),
        { emotion: smoothed, at: Date.now() },
      ]);
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

  return {
    videoRef,
    modelsLoaded,
    emotion,
    setEmotion,
    emotionHistoryRef,
    emotionScores,
    emotionTimeline,
    latestFrame,
    latestFrameRef,
    emotionBackend: EMOTION_BACKEND,
  };
}
