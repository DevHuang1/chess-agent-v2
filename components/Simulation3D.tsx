"use client";

import { Chess, Square } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import GameInfo from "@/components/GameInfo";
import { playMoveSound, playCaptureSound, playCheckSound } from "@/lib/audio";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

// MediaPipe's wasm writes its internal logs (e.g. "INFO: Created TensorFlow
// Lite XNNPACK delegate for CPU.") to stderr, which emscripten routes through
// console.error. Next.js dev intercepts every console.error and pops an
// "error" overlay over the board, blocking piece interaction. Filter those
// wasm-origin writes out; real errors from our code still log normally.
{
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    if (/vision_wasm|put_char|fd_write/.test(new Error().stack ?? "")) return;
    origError(...args);
  };
}

type HandLandmark = [number, number, number];
type Gesture = "none" | "fist" | "palm" | "two";

const BOARD_SIZE = 8;
const SQUARE_SIZE = 1;
const BOARD_OFFSET = (BOARD_SIZE - 1) * SQUARE_SIZE / 2;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareToPosition(square: string): THREE.Vector3 {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]) - 1;
  return new THREE.Vector3(file - BOARD_OFFSET, 0.15, BOARD_OFFSET - rank);
}

function positionToSquare(x: number, z: number): string | null {
  const f = Math.round(x + BOARD_OFFSET);
  const r = Math.round(BOARD_OFFSET - z);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return `${FILES[f]}${r + 1}`;
}

// Vertical NDC band the board occupies on screen for the current camera.
// top = highest square on screen (black's back rank), bottom = lowest (white's back rank).
function boardNdcBounds(cam: THREE.PerspectiveCamera): { top: number; bottom: number } {
  const v = new THREE.Vector3();
  let top = -Infinity;
  let bottom = Infinity;
  const corners = [
    new THREE.Vector3(-BOARD_OFFSET, 0, -BOARD_OFFSET),
    new THREE.Vector3(BOARD_OFFSET, 0, -BOARD_OFFSET),
    new THREE.Vector3(-BOARD_OFFSET, 0, BOARD_OFFSET),
    new THREE.Vector3(BOARD_OFFSET, 0, BOARD_OFFSET),
  ];
  for (const c of corners) {
    v.copy(c).project(cam);
    if (v.y > top) top = v.y;
    if (v.y < bottom) bottom = v.y;
  }
  return { top, bottom };
}

function createPieceGeometry(type: string, color: string): THREE.Group {
  const group = new THREE.Group();

  const isWhite = color === "w";
  const baseMat = new THREE.MeshPhysicalMaterial({
    color: isWhite ? 0xf7f4ee : 0x1c1d24,
    roughness: isWhite ? 0.25 : 0.20,
    metalness: isWhite ? 0.05 : 0.20,
    clearcoat: isWhite ? 0.4 : 0.6,
    clearcoatRoughness: 0.25,
    reflectivity: 0.6,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: isWhite ? 0xeadeca : 0x272933,
    roughness: isWhite ? 0.35 : 0.25,
    metalness: isWhite ? 0.05 : 0.15,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
  });

  function lathe(points: [number, number][], segments = 32): THREE.Mesh {
    const vec2 = points.map(([x, y]) => new THREE.Vector2(x, y));
    const m = new THREE.Mesh(new THREE.LatheGeometry(vec2, segments), baseMat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // All pieces: shared base profile (wide foot, tapered stem)
  function base(yOffset: number, scale = 1): THREE.Mesh {
    const b = lathe([
      [0, 0],
      [0.34 * scale, 0],
      [0.36 * scale, 0.03],
      [0.35 * scale, 0.06],
      [0.26 * scale, 0.08],
      [0.21 * scale, 0.12],
      [0.19 * scale, 0.16],
    ]);
    b.position.y = yOffset;
    return b;
  }

  switch (type) {
    case "p": {
      // Pawn: base + tapered body + collar + round head
      const b = base(0);
      const body = lathe([
        [0.18, 0.16],
        [0.18, 0.22],
        [0.22, 0.28],
        [0.20, 0.34],
        [0.16, 0.38],
        [0.14, 0.40],
        [0.16, 0.42],
        [0.14, 0.46],
      ]);
      body.position.y = 0;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 20, 16),
        baseMat,
      );
      head.position.y = 0.52;
      head.scale.y = 0.8;
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.025, 8, 20),
        accentMat,
      );
      collar.position.y = 0.42;
      collar.rotation.x = Math.PI / 2;
      group.add(b, body, head, collar);
      break;
    }
    case "n": {
      // Knight: base + body + horse head
      const b = base(0, 0.95);
      const bodyMesh = lathe([
        [0.17, 0.16],
        [0.17, 0.22],
        [0.20, 0.26],
        [0.16, 0.30],
        [0.14, 0.34],
      ]);
      bodyMesh.position.y = 0;
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 0.16, 10),
        baseMat,
      );
      neck.position.set(0, 0.42, 0.06);
      neck.rotation.z = 0.15;
      const headMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 10, 8),
        baseMat,
      );
      headMesh.position.set(0.12, 0.52, 0.06);
      headMesh.scale.set(0.9, 0.7, 1.0);
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.03, 0.08, 6),
        accentMat,
      );
      ear.position.set(-0.02, 0.56, 0.06);
      ear.rotation.x = 0.2;
      const snout = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 6),
        accentMat,
      );
      snout.position.set(0.20, 0.48, 0.06);
      snout.scale.set(1.2, 0.6, 0.8);
      group.add(b, bodyMesh, neck, headMesh, ear, snout);
      break;
    }
    case "b": {
      // Bishop: base + tall body + cleft mitre
      const b = base(0);
      const bodyMesh = lathe([
        [0.18, 0.16],
        [0.18, 0.24],
        [0.16, 0.32],
        [0.14, 0.40],
        [0.16, 0.44],
        [0.14, 0.48],
        [0.12, 0.52],
        [0.10, 0.56],
      ]);
      bodyMesh.position.y = 0;
      const collarRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.025, 8, 18),
        accentMat,
      );
      collarRing.position.y = 0.58;
      collarRing.rotation.x = Math.PI / 2;
      // Mitre cleft: two small spheres
      const cleftL = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 6),
        accentMat,
      );
      cleftL.position.set(-0.04, 0.64, 0);
      const cleftR = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 6),
        accentMat,
      );
      cleftR.position.set(0.04, 0.64, 0);
      group.add(b, bodyMesh, collarRing, cleftL, cleftR);
      break;
    }
    case "r": {
      // Rook: base + column + battlements
      const b = base(0, 0.95);
      const column = lathe([
        [0.16, 0.16],
        [0.16, 0.20],
        [0.18, 0.24],
        [0.16, 0.32],
        [0.16, 0.40],
        [0.18, 0.44],
        [0.20, 0.46],
        [0.22, 0.48],
      ]);
      column.position.y = 0;
      const topRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.025, 8, 20),
        accentMat,
      );
      topRing.position.y = 0.50;
      topRing.rotation.x = Math.PI / 2;
      // Battlements: 4 small blocks
      const merlonPositions = [
        [-0.18, 0.54, 0],
        [0.18, 0.54, 0],
        [0, 0.54, 0.18],
        [0, 0.54, -0.18],
      ];
      for (const [mx, my, mz] of merlonPositions) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.06, 0.06),
          accentMat,
        );
        m.position.set(mx, my, mz);
        group.add(m);
      }
      group.add(b, column, topRing);
      break;
    }
    case "q": {
      // Queen: base + body + crown with points
      const b = base(0);
      const bodyMesh = lathe([
        [0.18, 0.16],
        [0.18, 0.22],
        [0.20, 0.28],
        [0.18, 0.32],
        [0.16, 0.36],
        [0.18, 0.40],
        [0.16, 0.44],
        [0.14, 0.46],
        [0.12, 0.48],
      ]);
      bodyMesh.position.y = 0;
      const crownRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.025, 8, 18),
        accentMat,
      );
      crownRing.position.y = 0.50;
      crownRing.rotation.x = Math.PI / 2;
      // Crown spikes
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.025, 0.08, 6),
          accentMat,
        );
        spike.position.set(Math.cos(angle) * 0.13, 0.56, Math.sin(angle) * 0.13);
        group.add(spike);
      }
      const topBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 6),
        accentMat,
      );
      topBall.position.y = 0.52;
      group.add(b, bodyMesh, crownRing, topBall);
      break;
    }
    case "k": {
      // King: tallest piece, base + body + cross
      const b = base(0);
      const bodyMesh = lathe([
        [0.18, 0.16],
        [0.18, 0.24],
        [0.16, 0.30],
        [0.18, 0.36],
        [0.16, 0.42],
        [0.18, 0.46],
        [0.16, 0.50],
        [0.14, 0.54],
        [0.12, 0.56],
      ]);
      bodyMesh.position.y = 0;
      const crownBand = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.025, 8, 18),
        accentMat,
      );
      crownBand.position.y = 0.58;
      crownBand.rotation.x = Math.PI / 2;
      // Cross
      const crossV = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.14, 0.04),
        accentMat,
      );
      crossV.position.y = 0.68;
      const crossH = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.03, 0.04),
        accentMat,
      );
      crossH.position.y = 0.74;
      group.add(b, bodyMesh, crownBand, crossV, crossH);
      break;
    }
  }

  return group;
}

function createRobot(): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xd7dee8,
    roughness: 0.45,
    metalness: 0.35,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x31435c,
    roughness: 0.4,
    metalness: 0.3,
  });
  const handMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x22d3ee,
    emissiveIntensity: 0.15,
    roughness: 0.3,
    metalness: 0.5,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.22, 16), darkMat);
  base.position.y = 0.11;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.25, 16), bodyMat);
  torso.position.y = 0.85;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.3), darkMat);
  chest.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), darkMat);
  head.position.y = 1.75;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.1), handMat);
  visor.position.set(0, 1.8, 0.28);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6), bodyMat);
  antenna.position.y = 2.12;
  const antennaBall = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), handMat);
  antennaBall.position.y = 2.26;

  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.6, 1.25, 0);

  const armMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.09, 1, 8),
    bodyMat,
  );
  armMesh.position.copy(shoulder.position);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), handMat);
  hand.position.set(0.6, 1.2, -0.6);

  group.add(base, torso, chest, head, visor, antenna, antennaBall, shoulder, armMesh, hand);
  group.userData = { shoulder, hand, armMesh, handMat };
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
    }
  });
  return group;
}

function createHuman(): THREE.Group {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe6b48c,
    roughness: 0.6,
    metalness: 0,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    roughness: 0.7,
    metalness: 0.05,
  });
  const pantMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.8,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x3f2d20,
    roughness: 0.9,
  });
  const handMat = new THREE.MeshStandardMaterial({
    color: 0xe6b48c,
    emissive: 0xffa03a,
    emissiveIntensity: 0,
    roughness: 0.5,
  });

  // Legs
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.9, 10), pantMat);
  legL.position.set(-0.28, 0.45, 0);
  const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.9, 10), pantMat);
  legR.position.set(0.28, 0.45, 0);

  // Torso
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.95, 12), shirtMat);
  torso.position.y = 1.35;

  // Head + hair
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), skinMat);
  head.position.y = 1.95;
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.245, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    hairMat,
  );
  hair.position.y = 2.0;

  // Right arm (follows the tracked hand)
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.4, 1.55, 0);
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1, 8), shirtMat);
  armMesh.position.copy(shoulder.position);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), handMat);
  hand.position.set(0.5, 1.1, -1.0);

  // Left arm (static, resting)
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.9, 8), shirtMat);
  armL.rotation.z = 0.35;
  armL.position.set(-0.75, 1.15, 0.05);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skinMat);
  handL.position.set(-1.0, 0.8, 0.08);

  group.add(legL, legR, torso, head, hair, shoulder, armMesh, hand, armL, handL);
  group.userData = { shoulder, hand, armMesh, handMat };
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
    }
  });
  return group;
}

type RobotAnim = {
  waypoints: { pos: THREE.Vector3; carry: boolean; pieceY: number }[];
  piece: THREE.Group | null;
  dropPos: THREE.Vector3;
  seg: number;
  t: number;
  attached: boolean;
  done: () => void;
};

type Simulation3DProps = {
  chessRef: React.MutableRefObject<Chess>;
  gamePosition: string;
  onMoveExecuted: () => void;
  setStatusMessage: (msg: string) => void;
  onExit: () => void;
};

export default function Simulation3D({
  chessRef,
  gamePosition,
  onMoveExecuted,
  setStatusMessage,
  onExit,
}: Simulation3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    pieces: Map<string, THREE.Group>;
    selectionRing: THREE.Mesh;
    tileMeshes: THREE.Mesh[];
    destHighlight: THREE.Mesh;
    cursorRing: THREE.Mesh;
    robot: THREE.Group;
    startRobotAnim: (from: string, to: string, done: () => void) => void;
  } | null>(null);
  const animRef = useRef<number>(0);
  const camOrbit = useRef({ theta: Math.PI / 2, phi: 0.84, radius: 19 });
  const finger3dRef = useRef<{ x: number; z: number } | null>(null);
  const selectedRef = useRef<string | null>(null);
  const legalRef = useRef<string[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const robotAnimatingRef = useRef(false);
  const firstRunRef = useRef(true);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalSquares, setLegalSquares] = useState<string[]>([]);
  const [handActive, setHandActive] = useState(false);
  const [gestureLabel, setGestureLabel] = useState("");
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);
  const smoothHitRef = useRef({ x: 0, z: 0, y: 0 });
  const calibModeRef = useRef<"off" | "top" | "bottom">("off");
  const [calibMode, setCalibMode] = useState<"off" | "top" | "bottom">("off");
  const calibRef = useRef<{ topY: number | null; bottomY: number | null }>({ topY: null, bottomY: null });
  const lastHandPosRef = useRef<{ x: number; y: number } | null>(null);

  const triggerRerender = useCallback(() => forceUpdate((n) => n + 1), []);

  const rebuildPieces = useCallback((chess: Chess, scene: THREE.Scene, pieces: Map<string, THREE.Group>) => {
    for (const [, mesh] of pieces) scene.remove(mesh);
    pieces.clear();
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (!piece) continue;
        const sq = `${FILES[f]}${8 - r}` as Square;
        const pos = squareToPosition(sq);
        const color = piece.color;
        const group = createPieceGeometry(piece.type, color);
        group.position.copy(pos);
        group.userData = { square: sq, type: piece.type, color: piece.color };
        scene.add(group);
        pieces.set(sq, group);
      }
    }
  }, []);

  // Rebuild 3D pieces when the board FEN changes (user move, bot move, or reset)
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      rebuildPieces(chessRef.current, s.scene, s.pieces);
      return;
    }
    const chess = chessRef.current;
    const history = chess.history({ verbose: true });
    const last = history[history.length - 1];

    if (
      last &&
      last.color === "b" &&
      s.startRobotAnim &&
      !robotAnimatingRef.current
    ) {
      s.startRobotAnim(last.from, last.to, () => {
        rebuildPieces(chessRef.current, s.scene, s.pieces);
        setSelectedSquare(null);
        setLegalSquares([]);
        robotAnimatingRef.current = false;
      });
    } else {
      rebuildPieces(chess, s.scene, s.pieces);
      setSelectedSquare(null);
      setLegalSquares([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePosition, rebuildPieces]);

  // Keep a ref to the latest onMoveExecuted so the mount-only effect always calls the current one
  const onMoveRef = useRef(onMoveExecuted);
  useEffect(() => { onMoveRef.current = onMoveExecuted; }, [onMoveExecuted]);

  // Sync refs during render so the detect loop closure has up-to-date values
  // eslint-disable-next-line react-hooks/refs
  selectedRef.current = selectedSquare;
  // eslint-disable-next-line react-hooks/refs
  legalRef.current = legalSquares;
  // eslint-disable-next-line react-hooks/refs
  hoveredRef.current = hoveredSquare;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    // Ultra-modern dark studio background with smooth gradient radial lighting
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 512;
    bgCanvas.height = 512;
    const bgCtx = bgCanvas.getContext("2d");
    if (bgCtx) {
      const grad = bgCtx.createRadialGradient(256, 180, 40, 256, 256, 360);
      grad.addColorStop(0, "#1a1d28");
      grad.addColorStop(0.5, "#0f1118");
      grad.addColorStop(1, "#07080c");
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, 512, 512);
    }
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = bgTex;
    scene.fog = new THREE.Fog(0x07080c, 24, 64);

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    camera.position.set(0, 12.5, 13.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.prepend(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    // Warm key light focusing on board
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.4);
    keyLight.position.set(6, 15, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0001;
    scene.add(keyLight);

    // Cool rim light for subtle edge highlights
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    rimLight.position.set(-6, 8, -8);
    scene.add(rimLight);

    // Studio pedestal table surface
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 15, 0.5, 64),
      new THREE.MeshStandardMaterial({
        color: 0x111218,
        roughness: 0.4,
        metalness: 0.2,
      }),
    );
    pedestal.position.y = -0.27;
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    // Beveled hardwood frame surrounding the board
    const frameMesh = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 0.16, 9.6),
      new THREE.MeshStandardMaterial({
        color: 0x1a1b24,
        roughness: 0.35,
        metalness: 0.15,
      }),
    );
    frameMesh.position.y = -0.09;
    frameMesh.receiveShadow = true;
    scene.add(frameMesh);

    const tileMeshes: THREE.Mesh[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let f = 0; f < BOARD_SIZE; f++) {
        const isLight = (r + f) % 2 === 0;
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(SQUARE_SIZE * 0.94, 0.05, SQUARE_SIZE * 0.94),
          new THREE.MeshStandardMaterial({
            color: isLight ? 0xeedec5 : 0x75563b,
            roughness: isLight ? 0.35 : 0.45,
            metalness: 0.05,
          }),
        );
        tile.position.set(f - BOARD_OFFSET, -0.015, r - BOARD_OFFSET);
        tile.receiveShadow = true;
        tile.userData = { square: `${FILES[f]}${8 - r}`, rank: r, file: f };
        scene.add(tile);
        tileMeshes.push(tile);
      }
    }

    const pieces = new Map<string, THREE.Group>();
    rebuildPieces(chessRef.current, scene, pieces);

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.48, 32),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 0.05;
    selectionRing.visible = false;
    scene.add(selectionRing);

    const destHighlight = new THREE.Mesh(
      new THREE.PlaneGeometry(SQUARE_SIZE * 0.85, SQUARE_SIZE * 0.85),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    destHighlight.rotation.x = -Math.PI / 2;
    destHighlight.position.y = 0.03;
    destHighlight.visible = false;
    scene.add(destHighlight);

    // Hand cursor ring shown while "choosing" a square in open-palm mode
    const cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    cursorRing.rotation.x = -Math.PI / 2;
    cursorRing.position.y = 0.07;
    cursorRing.visible = false;
    scene.add(cursorRing);

    const legalDots: THREE.Mesh[] = [];
    function updateLegalDots(squares: string[]) {
      for (const d of legalDots) scene.remove(d);
      legalDots.length = 0;
      for (const sq of squares) {
        const pos = squareToPosition(sq);
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.1, 16),
          new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(pos.x, 0.04, pos.z);
        scene.add(dot);
        legalDots.push(dot);
      }
    }

    // Robot behind the black side
    const robot = createRobot();
    robot.position.set(0, 0, -5.6);
    scene.add(robot);
    const robotShoulder = robot.userData.shoulder as THREE.Object3D;
    const robotHand = robot.userData.hand as THREE.Mesh;
    const robotArm = robot.userData.armMesh as THREE.Mesh;
    const robotHandMat = robot.userData.handMat as THREE.MeshStandardMaterial;

    // Human figure on the player's (white) side whose hand follows the tracked hand
    const human = createHuman();
    human.position.set(0, 0, 7.0);
    scene.add(human);
    const humanShoulder = human.userData.shoulder as THREE.Object3D;
    const humanHand = human.userData.hand as THREE.Mesh;
    const humanArm = human.userData.armMesh as THREE.Mesh;
    const humanHandMat = human.userData.handMat as THREE.MeshStandardMaterial;
    const HUMAN_HAND_REST = new THREE.Vector3(0.5, 1.1, 6.0);
    const humanHandFollowTarget = HUMAN_HAND_REST.clone();
    const pieceFollowTarget = new THREE.Vector3();

    sceneRef.current = {
      scene,
      camera,
      renderer,
      pieces,
      selectionRing,
      tileMeshes,
      destHighlight,
      cursorRing,
      robot,
      startRobotAnim,
    };

    function setHandWorld(worldPos: THREE.Vector3) {
      robotHand.position.copy(worldPos).sub(robot.position);
    }
    robotHand.position.set(0.6, 1.2, 0.6);

    let robotAnim: RobotAnim | null = null;

    function startRobotAnim(fromSq: string, toSq: string, done: () => void) {
      robotAnimatingRef.current = true;
      const piece = pieces.get(fromSq) ?? null;
      const fromPos = squareToPosition(fromSq);
      const toPos = squareToPosition(toSq);

      const captured = pieces.get(toSq);
      if (captured && captured !== piece) {
        captured.visible = false;
      }

      const rest = new THREE.Vector3(0.3, 1.7, -4.6);
      const waypoints = [
        { pos: rest.clone(), carry: false, pieceY: 0.15 },
        { pos: new THREE.Vector3(fromPos.x, 2.1, fromPos.z), carry: false, pieceY: 0.15 },
        { pos: new THREE.Vector3(fromPos.x, 0.85, fromPos.z), carry: true, pieceY: 0.15 },
        { pos: new THREE.Vector3(fromPos.x, 2.1, fromPos.z), carry: true, pieceY: 1.0 },
        { pos: new THREE.Vector3(toPos.x, 2.1, toPos.z), carry: true, pieceY: 1.0 },
        { pos: new THREE.Vector3(toPos.x, 0.85, toPos.z), carry: true, pieceY: 0.15 },
        { pos: new THREE.Vector3(toPos.x, 2.1, toPos.z), carry: false, pieceY: 0.15 },
        { pos: rest.clone(), carry: false, pieceY: 0.15 },
      ];

      robotAnim = {
        waypoints,
        piece,
        dropPos: new THREE.Vector3(toPos.x, 0.15, toPos.z),
        seg: 0,
        t: 0,
        attached: false,
        done,
      };
      setStatusMessage(`Robot plays ${fromSq}→${toSq}...`);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let videoStream: MediaStream | null = null;
    let gestureRecognizer: GestureRecognizer | null = null;
    let grabbedPieceGroup: THREE.Group | null = null;
    let detectRaf = 0;

    // Pointer interaction state
    let isPointerDragging = false;
    let pointerGrabbedSquare: string | null = null;
    let pointerGrabbedGroup: THREE.Group | null = null;
    const pointerTarget = new THREE.Vector3();
    let releaseAnim: { piece: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; progress: number } | null = null;
    let isOrbiting = false;
    let prevPointerX = 0;
    let prevPointerY = 0;

    // Smooth tracking targets (interpolated in animate loop)
    const fingerFollowTarget = new THREE.Vector3();
    let gestureAnim: {
      piece: THREE.Group;
      from: THREE.Vector3;
      to: THREE.Vector3;
      progress: number;
      done: () => void;
    } | null = null;
    // Orbit target for smooth camera interpolation
    const smoothOrbit = { theta: Math.PI / 2, phi: 0.84, radius: 19 };

    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    })
      .then((stream) => {
        videoStream = stream;
        const vid = videoRef.current;
        if (!vid) { stream.getTracks().forEach(t => t.stop()); return; }
        vid.srcObject = stream;
        vid.playsInline = true;
        vid.muted = true;
        vid.play().catch(() => {});

        initGestures(vid);
      })
      .catch(() => {});

    async function initGestures(video: HTMLVideoElement) {
      try {
        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
        );
        gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "CPU",
          },
          runningMode: "IMAGE",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
          cannedGesturesClassifierOptions: { scoreThreshold: 0.5 },
        });

        // Draw the video frame onto a DOM canvas and pass the resulting ImageData
        // to recognize(). MediaPipe's internal path draws the video onto an
        // OffscreenCanvas, which throws on Safari/WebKit (video → OffscreenCanvas
        // drawImage is unsupported) — the ImageData path works everywhere.
        // IMAGE mode uses a synthetic timestamp that is always monotonic, so it
        // avoids recognizeForVideo's timestamp-bound graph errors entirely.
        const frameCanvas = document.createElement("canvas");
        const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });

        let lastDetectError = 0;
        async function detect() {
          if (!gestureRecognizer || !frameCtx) return;
          if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime > 0) {
            try {
              const inW = video.videoWidth;
              const inH = video.videoHeight;
              const outW = 480;
              const outH = Math.round((inH / inW) * outW);
              if (frameCanvas.width !== outW) frameCanvas.width = outW;
              if (frameCanvas.height !== outH) frameCanvas.height = outH;
              frameCtx.drawImage(video, 0, 0, outW, outH);
              const frame = frameCtx.getImageData(0, 0, outW, outH);

              const result = gestureRecognizer.recognize(frame);
              const cat = result.gestures?.[0]?.[0];
              const lmRaw = result.landmarks?.[0];
              if (cat && lmRaw) {
                const rawGesture: Gesture =
                  cat.categoryName === "Open_Palm"
                    ? "palm"
                    : cat.categoryName === "Closed_Fist"
                      ? "fist"
                      : cat.categoryName === "Victory"
                        ? "two"
                        : "none";
                const lm = lmRaw.map((l) => [l.x, l.y, l.z]) as HandLandmark[];
                processHand(lm, rawGesture);
              } else {
                handActiveRef.current = false;
                setHandActive(false);
                setGestureLabel("");
                destHighlight.visible = false;
                cursorRing.visible = false;
                lastHandPosRef.current = null;
              }
            } catch (e) {
              const now = performance.now();
              if (now - lastDetectError > 2000) {
                lastDetectError = now;
                const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
                const stack = e instanceof Error && e.stack ? `\n${e.stack}` : "";
                console.error(`processHand error: ${msg}${stack}`);
                setStatusMessage(`Tracking issue: ${msg}`);
              }
            }
          }
          detectRaf = requestAnimationFrame(detect);
        }
        detect();
      } catch {
        setStatusMessage("Hand tracking model failed to load");
      }
    }

    const handActiveRef = { current: false };
    let grabbedPieceSquare: string | null = null;
    let stableGesture: Gesture = "none";
    let stableCount = 0;
    let twoArmedSquare: string | null = null;
    let lastBlockMsgTime = 0;

    function dropPiece(toSq: string | null) {
      const grabbed = grabbedPieceGroup;
      const fromSq = grabbedPieceSquare;
      if (!grabbed || !fromSq) return;

      let moveSuccess = false;
      if (toSq && legalRef.current.includes(toSq)) {
        try {
          const move = chessRef.current.move({ from: fromSq as Square, to: toSq as Square, promotion: "q" });
          if (move) {
            const targetPos = squareToPosition(toSq);
            gestureAnim = {
              piece: grabbed,
              from: grabbed.position.clone(),
              to: targetPos,
              progress: 0,
              done: () => {
                setStatusMessage(`3D Move: ${move.san}`);
                rebuildPieces(chessRef.current, scene, pieces);
                onMoveRef.current();
                triggerRerender();
              },
            };
            moveSuccess = true;
          }
        } catch {
          // Board state changed (bot moved, etc.) — animate back
        }
      }

      if (!moveSuccess) {
        const origPos = squareToPosition(fromSq);
        gestureAnim = {
          piece: grabbed,
          from: grabbed.position.clone(),
          to: origPos,
          progress: 0,
          done: () => {},
        };
        setStatusMessage(
          toSq
            ? `Illegal move ${fromSq}→${toSq} — piece returned, still your turn`
            : "Move cancelled — keep your hand over the board to place",
        );
      }

      grabbedPieceSquare = null;
      grabbedPieceGroup = null;
      setSelectedSquare(null);
      setLegalSquares([]);
      updateLegalDots([]);
      selectionRing.visible = false;
      destHighlight.visible = false;
      cursorRing.visible = false;
      humanHandFollowTarget.copy(HUMAN_HAND_REST);
      setHoveredSquare(null);
    }

    function processHand(lm: HandLandmark[], rawGesture: Gesture) {
      if (robotAnimatingRef.current) return;
      handActiveRef.current = true;
      setHandActive(true);

      // Hysteresis: only act once a gesture has been held steady for ~12 frames (~400ms).
      // This confirms intent and rejects one-frame misdetections.
      if (rawGesture === stableGesture) {
        stableCount++;
      } else {
        stableGesture = rawGesture;
        stableCount = 0;
      }
      const gesture: Gesture = stableCount >= 12 ? stableGesture : "none";

      // MediaPipe returns normalized [0..1] landmark coordinates.
      const handX = lm[9][0];
      const handY = lm[9][1];
      lastHandPosRef.current = { x: handX, y: handY };

      // Mirror X so the hand icon follows the same direction as the real hand
      // (matches the mirrored webcam view).
      const ndcX = 1 - handX * 2;
      // Map the user's calibrated hand range onto the board's screen band.
      const bounds = boardNdcBounds(camera);
      const cal = calibRef.current;
      let ndcY: number;
      if (cal.topY !== null && cal.bottomY !== null && cal.bottomY > cal.topY + 0.05) {
        const t = THREE.MathUtils.clamp((handY - cal.topY) / (cal.bottomY - cal.topY), 0, 1);
        ndcY = bounds.top + t * (bounds.bottom - bounds.top);
      } else {
        ndcY = 1 - handY * 2;
      }
      pointer.set(ndcX, ndcY);
      raycaster.setFromCamera(pointer, camera);

      const planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPoint = new THREE.Vector3();
      const ray = raycaster.ray;
      const hit = ray.intersectPlane(planeY, hitPoint);
      const overBoard = hit && hitPoint.x > -BOARD_OFFSET - 0.5 && hitPoint.x < BOARD_OFFSET + 0.5 &&
        hitPoint.z > -BOARD_OFFSET - 0.5 && hitPoint.z < BOARD_OFFSET + 0.5;

      // Smooth finger position with EMA
      if (hit) {
        const smooth = smoothHitRef.current;
        smooth.x += (hitPoint.x - smooth.x) * 0.4;
        smooth.z += (hitPoint.z - smooth.z) * 0.4;
        smooth.y = hitPoint.y;
        finger3dRef.current = { x: smooth.x, z: smooth.z };
      } else {
        finger3dRef.current = null;
      }

      const cursorSq = hit && overBoard ? positionToSquare(hitPoint.x, hitPoint.z) : null;

      // Green square + cursor ring follow the square under the hand in every
      // gesture, so the target is always visible while moving.
      const holding = !!grabbedPieceSquare && !!grabbedPieceGroup;
      if (cursorSq) {
        const pos = squareToPosition(cursorSq);
        destHighlight.position.set(pos.x, 0.03, pos.z);
        destHighlight.visible = true;
        // Green on a legal target while holding, red on an illegal one
        (destHighlight.material as THREE.MeshBasicMaterial).color.setHex(
          holding && !legalRef.current.includes(cursorSq) ? 0xff4444 : 0x00ff88,
        );
        cursorRing.position.set(pos.x, 0.07, pos.z);
        cursorRing.visible = true;
      } else {
        destHighlight.visible = false;
        cursorRing.visible = false;
      }

      // Human hand mirrors the tracked hand; while holding, the piece snaps to
      // the square under the hand and rides just under the fist.
      if (holding && hit) {
        const snapSq = cursorSq ?? grabbedPieceSquare;
        const snap = squareToPosition(snapSq!);
        pieceFollowTarget.set(snap.x, 0.85, snap.z);
        fingerFollowTarget.set(snap.x, 1.25, snap.z);
        humanHandFollowTarget.copy(fingerFollowTarget);
      } else if (cursorSq) {
        humanHandFollowTarget.set(hitPoint.x, 1.15, hitPoint.z);
      } else {
        humanHandFollowTarget.copy(HUMAN_HAND_REST);
      }

      // Pin the target square at the moment two fingers first appear, so the
      // 400ms confirmation delay can't drift the placement square.
      if (rawGesture === "two" && stableCount === 2) twoArmedSquare = cursorSq;

      if (gesture === "palm") {
        setGestureLabel("Palm");
      } else if (gesture === "fist") {
        setGestureLabel("Fist");

        // Grab the nearest movable white piece to the cursor. Proximity-based,
        // so a slightly-off calibration or fist drift still grabs the right piece.
        if (!grabbedPieceSquare) {
          const chess = chessRef.current;

          // chess.js moves({square}) respects the side to move, so while the
          // bot is thinking (black to move) every white piece reports 0 moves.
          // Gate explicitly on whose turn it is and explain why grabbing is off.
          if (chess.turn() !== "w" || chess.isGameOver()) {
            const now = performance.now();
            if (now - lastBlockMsgTime > 1000) {
              lastBlockMsgTime = now;
              setStatusMessage(
                chess.isGameOver()
                  ? "Game over — press Reset to play again"
                  : "Waiting for Sentio engine to move...",
              );
            }
            selectionRing.visible = false;
          } else {
            let grabSq: string | null = null;
            let bestDist = 1.3;
            for (const [sq] of pieces) {
              const p = chess.get(sq as Square);
              if (!p || p.color !== "w") continue;
              if (chess.moves({ square: sq as Square }).length === 0) continue;
              const pos = squareToPosition(sq);
              const d = Math.hypot(pos.x - hitPoint.x, pos.z - hitPoint.z);
              if (d < bestDist) {
                bestDist = d;
                grabSq = sq;
              }
            }
            if (grabSq && overBoard && hit) {
              const piece = chess.get(grabSq as Square);
              if (piece && piece.color === "w") {
                grabbedPieceSquare = grabSq;
                setSelectedSquare(grabSq);
                const moves = chess.moves({ square: grabSq as Square, verbose: true });
                setLegalSquares(moves.map((m) => m.to));
                updateLegalDots(moves.map((m) => m.to));
                const pos = squareToPosition(grabSq);
                selectionRing.position.set(pos.x, 0.05, pos.z);
                selectionRing.visible = true;
                setStatusMessage(`Holding ${grabSq} · open palm to move · 2 fingers to place`);

                const pieceGroup = pieces.get(grabSq);
                if (pieceGroup) {
                  grabbedPieceGroup = pieceGroup;
                  gestureAnim = null;
                }
              } else {
                selectionRing.visible = false;
              }
            }
          }
        }
      } else if (gesture === "two") {
        setGestureLabel("2 fingers");

        // Place the held piece on the pinned square
        if (grabbedPieceSquare && grabbedPieceGroup) {
          dropPiece(twoArmedSquare ?? cursorSq);
          twoArmedSquare = null;
        }
      } else {
        setGestureLabel("");
      }
    }

    // Pointer (mouse/touch) interaction
    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";

    canvas.addEventListener("pointerdown", (e) => {
      if (robotAnimatingRef.current) return;
      if (e.button === 2) {
        isOrbiting = true;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        return;
      }
      if (e.button !== 0) return;

      // Hand-range calibration capture
      if (calibModeRef.current !== "off") {
        const pos = lastHandPosRef.current;
        if (!pos) {
          setStatusMessage("No hand detected — keep your hand in front of the camera, then click");
          return;
        }
        if (calibModeRef.current === "top") {
          calibRef.current.topY = pos.y;
          calibModeRef.current = "bottom";
          setCalibMode("bottom");
          setStatusMessage("Now hold your hand over the BOTTOM row (your pieces) and click");
        } else {
          calibRef.current.bottomY = pos.y;
          calibModeRef.current = "off";
          setCalibMode("off");
          setStatusMessage("Calibration done — palm to move · fist to hold · 2 fingers to place");
        }
        return;
      }

      pointer.set(
        (e.clientX / container.clientWidth) * 2 - 1,
        -(e.clientY / container.clientHeight) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      const pieceList: THREE.Object3D[] = [];
      for (const [, p] of pieces) pieceList.push(p);
      const intersects = raycaster.intersectObjects(pieceList, true);

      if (intersects.length > 0) {
        let obj: THREE.Object3D = intersects[0].object;
        while (obj.parent && !(obj.parent instanceof THREE.Scene)) {
          obj = obj.parent;
        }
        if (obj.userData?.color === "w") {
          const sq = obj.userData.square as string;
          isPointerDragging = true;
          pointerGrabbedSquare = sq;
          pointerGrabbedGroup = pieces.get(sq) ?? null;

          const pos = squareToPosition(sq);
          if (pointerGrabbedGroup) {
            pointerGrabbedGroup.position.y = 1.2;
            pointerTarget.set(pos.x, 1.2, pos.z);
          }

          setSelectedSquare(sq);
          const moves = chessRef.current.moves({ square: sq as Square, verbose: true });
          setLegalSquares(moves.map((m) => m.to));
          updateLegalDots(moves.map((m) => m.to));
          selectionRing.position.set(pos.x, 0.05, pos.z);
          selectionRing.visible = true;
          setStatusMessage(`Holding ${sq}`);
        }
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      if (isOrbiting) {
        const deltaX = (e.clientX - prevPointerX) / container.clientWidth;
        const deltaY = (e.clientY - prevPointerY) / container.clientHeight;
        const orbit = camOrbit.current;
        orbit.theta -= deltaX * 3;
        orbit.phi = Math.max(0.01, Math.min(1.3, orbit.phi + deltaY * 3));
        // Sync smooth orbit target
        smoothOrbit.theta = orbit.theta;
        smoothOrbit.phi = orbit.phi;
        smoothOrbit.radius = orbit.radius;
        const x = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);
        const y = orbit.radius * Math.cos(orbit.phi);
        const z = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);
        camera.position.set(x, y, z);
        camera.lookAt(0, 0, 0);
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        return;
      }

      if (!isPointerDragging || !pointerGrabbedGroup) return;

      pointer.set(
        (e.clientX / container.clientWidth) * 2 - 1,
        -(e.clientY / container.clientHeight) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(planeY, hitPoint);

      pointerTarget.set(hitPoint.x, 1.2, hitPoint.z);

      const sq = positionToSquare(hitPoint.x, hitPoint.z);
      if (sq && legalRef.current.includes(sq)) {
        destHighlight.position.set(squareToPosition(sq).x, 0.03, squareToPosition(sq).z);
        destHighlight.visible = true;
      } else {
        destHighlight.visible = false;
      }
    });

    canvas.addEventListener("pointerup", (e) => {
      if (e.button === 2) {
        isOrbiting = false;
        return;
      }
      if (!isPointerDragging) return;
      isPointerDragging = false;

      const fromSq = pointerGrabbedSquare;
      const grabbed = pointerGrabbedGroup;
      const toSq = positionToSquare(pointerTarget.x, pointerTarget.z);

      if (fromSq && toSq && legalRef.current.includes(toSq)) {
        const chess = chessRef.current;
        const move = chess.move({ from: fromSq as Square, to: toSq as Square, promotion: "q" });
        if (move) {
          if (move.captured) playCaptureSound();
          else if (chess.inCheck()) playCheckSound();
          else playMoveSound();

          setStatusMessage(`3D Move: ${move.san}`);
          rebuildPieces(chess, scene, pieces);
          onMoveRef.current();
          triggerRerender();
        } else if (grabbed) {
          const origPos = squareToPosition(fromSq);
          releaseAnim = { piece: grabbed, from: grabbed.position.clone(), to: origPos, progress: 0 };
        }
      } else if (grabbed && fromSq) {
        const origPos = squareToPosition(fromSq);
        releaseAnim = { piece: grabbed, from: grabbed.position.clone(), to: origPos, progress: 0 };
      }

      pointerGrabbedSquare = null;
      pointerGrabbedGroup = null;
      setSelectedSquare(null);
      setLegalSquares([]);
      updateLegalDots([]);
      selectionRing.visible = false;
      destHighlight.visible = false;
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("wheel", (e) => {
      const orbit = camOrbit.current;
      orbit.radius = Math.max(5, Math.min(25, orbit.radius + e.deltaY * 0.01));
      smoothOrbit.radius = orbit.radius;
      const x = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);
      const y = orbit.radius * Math.cos(orbit.phi);
      const z = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    }, { passive: true });

    const handleResize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    };
    window.addEventListener("resize", handleResize);

    let morphT = 0;
    setStatusMessage("Entering 3D Mode — Morphing 2D board to 3D arena...");

    function animate() {
      animRef.current = requestAnimationFrame(animate);

      // Smooth camera orbit interpolation & morph logic
      const orbit = camOrbit.current;
      orbit.theta += (smoothOrbit.theta - orbit.theta) * 0.08;
      orbit.phi += (smoothOrbit.phi - orbit.phi) * 0.08;
      orbit.radius += (smoothOrbit.radius - orbit.radius) * 0.08;
      const cx = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);
      const cy = orbit.radius * Math.cos(orbit.phi);
      const cz = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);

      if (morphT < 1.0) {
        morphT = Math.min(1.0, morphT + 0.015);
        const ease = morphT * morphT * (3 - 2 * morphT); // Smoothstep curve

        // Camera lerps smoothly from top-down 2D flat view to 3D perspective
        const topDownPos = new THREE.Vector3(0, 19.5, 0.001);
        const targetCamPos = new THREE.Vector3(cx, cy, cz);
        camera.position.lerpVectors(topDownPos, targetCamPos, ease);
        camera.lookAt(0, 0, 0);

        // Extrude board, frame, pedestal & tiles Y scale smoothly
        const flatY = Math.max(0.005, ease);
        pedestal.scale.set(1, flatY, 1);
        frameMesh.scale.set(1, flatY, 1);
        for (const tile of tileMeshes) {
          tile.scale.set(1, flatY, 1);
        }

        // Extrude 3D pieces height smoothly from flat surface
        for (const [, pGroup] of pieces) {
          pGroup.scale.set(1, flatY, 1);
        }

        // Human player figure glides into seat at South (z = 6.2)
        human.position.set(0, 0, THREE.MathUtils.lerp(13.5, 6.2, ease));

        // Enemy Computer AI figure glides into seat at North (z = -5.6)
        robot.position.set(0, 0, THREE.MathUtils.lerp(-13.5, -5.6, ease));

        if (morphT >= 1.0) {
          setStatusMessage("3D Arena Active — Opponents seated face-to-face");
        }
      } else {
        camera.position.set(cx, cy, cz);
        camera.lookAt(0, 0, 0);

        pedestal.scale.set(1, 1, 1);
        frameMesh.scale.set(1, 1, 1);
        for (const tile of tileMeshes) tile.scale.set(1, 1, 1);
        human.position.set(0, 0, 6.2);
        robot.position.set(0, 0, -5.6);
      }

      // Robot arm follows the hand
      {
        const dir = robotHand.position.clone().sub(robotShoulder.position);
        const len = dir.length();
        robotArm.position.copy(robotShoulder.position).add(robotHand.position).multiplyScalar(0.5);
        robotArm.scale.set(1, Math.max(len, 0.01), 1);
        if (len > 0.001) {
          robotArm.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.clone().normalize(),
          );
        }
      }

      // Human hand follows the tracked hand and holds the piece when grabbing
      humanHand.position.lerp(
        humanHandFollowTarget.clone().sub(human.position),
        0.18,
      );
      humanHandMat.emissiveIntensity =
        grabbedPieceSquare && grabbedPieceGroup ? 0.8 : 0;
      {
        const dir = humanHand.position.clone().sub(humanShoulder.position);
        const len = dir.length();
        humanArm.position.copy(humanShoulder.position).add(humanHand.position).multiplyScalar(0.5);
        humanArm.scale.set(1, Math.max(len, 0.01), 1);
        if (len > 0.001) {
          humanArm.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.clone().normalize(),
          );
        }
      }

      // Robot move animation
      if (robotAnim) {
        const a = robotAnim;
        const wp = a.waypoints;
        const p0 = wp[a.seg];
        const p1 = wp[a.seg + 1];
        const dist = p0.pos.distanceTo(p1.pos);
        const speed = 4.5;
        a.t += (0.016 * speed) / Math.max(dist, 0.001);

        if (a.t >= 1) {
          if (a.seg >= wp.length - 2) {
            setHandWorld(p1.pos);
            if (a.piece && a.attached) {
              a.piece.position.copy(a.dropPos);
              a.attached = false;
            }
            const done = a.done;
            robotAnim = null;
            setStatusMessage("Robot move completed.");
            done();
          } else {
            a.seg++;
            a.t = 0;
          }
        }

        const cp0 = wp[a.seg];
        const cp1 = wp[a.seg + 1];
        const pos = cp0.pos.clone().lerp(cp1.pos, a.t);
        setHandWorld(pos);

        if (cp1.carry && !a.attached && a.piece) {
          a.attached = true;
        }
        if (!cp1.carry && a.attached && a.piece) {
          a.piece.position.copy(a.dropPos);
          a.attached = false;
        }
        if (cp1.carry && a.attached && a.piece) {
          a.piece.position.set(pos.x, cp1.pieceY, pos.z);
        }

        robotHandMat.emissiveIntensity = a.attached ? 0.7 : 0.15;
      } else {
        robotHandMat.emissiveIntensity = 0.15;
      }

      // Smooth piece follow for pointer drag
      if (isPointerDragging && pointerGrabbedGroup) {
        pointerGrabbedGroup.position.lerp(pointerTarget, 0.3);
      }

      // Smooth piece follow for fist grab (held just under the human hand)
      if (!isPointerDragging && grabbedPieceGroup && grabbedPieceSquare) {
        grabbedPieceGroup.position.lerp(pieceFollowTarget, 0.25);
      }

      // Release animation (pointer)
      if (releaseAnim) {
        releaseAnim.progress += 0.04;
        if (releaseAnim.progress >= 1) {
          releaseAnim.piece.position.copy(releaseAnim.to);
          releaseAnim = null;
        } else {
          releaseAnim.piece.position.lerpVectors(releaseAnim.from, releaseAnim.to, releaseAnim.progress);
        }
      }

      // Gesture release animation
      if (gestureAnim) {
        gestureAnim.progress += 0.04;
        if (gestureAnim.progress >= 1) {
          gestureAnim.piece.position.copy(gestureAnim.to);
          const done = gestureAnim.done;
          gestureAnim = null;
          done();
        } else {
          gestureAnim.piece.position.lerpVectors(gestureAnim.from, gestureAnim.to, gestureAnim.progress);
        }
      }

      renderer.render(scene, camera);
    }
    animate();

    const cleanupVid = videoRef.current;
    return () => {
      cancelAnimationFrame(animRef.current);
      cancelAnimationFrame(detectRaf);
      gestureRecognizer?.close();
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (cleanupVid) {
        cleanupVid.pause();
        cleanupVid.srcObject = null;
      }
      if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen w-screen bg-black">
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <div className="absolute top-4 left-4 z-20 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={onExit}
            className="rounded bg-black/60 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 border border-zinc-700 backdrop-blur-sm"
          >
            ← Exit 3D
          </button>
          <span className="rounded bg-black/40 px-3 py-1.5 text-sm text-zinc-300 border border-zinc-700/50 backdrop-blur-sm">
            {selectedSquare ? `Holding ${selectedSquare}` : handActive ? gestureLabel || "Hand detected" : "Open palm to move · Fist to hold · 2 fingers to place · Right-click to orbit · Scroll to zoom"}
          </span>
          {gestureLabel === "Palm" && (
            <span className="rounded bg-emerald-800/40 px-3 py-1.5 text-xs text-emerald-300 border border-emerald-700/30 backdrop-blur-sm">
              Open palm — move over the board (green square)
            </span>
          )}
          {gestureLabel === "Fist" && (
            <span className="rounded bg-amber-800/40 px-3 py-1.5 text-xs text-amber-300 border border-amber-700/30 backdrop-blur-sm">
              Fist — hold the piece
            </span>
          )}
          {gestureLabel === "2 fingers" && (
            <span className="rounded bg-sky-800/40 px-3 py-1.5 text-xs text-sky-300 border border-sky-700/30 backdrop-blur-sm">
              2 fingers — place the piece on the green square
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (calibModeRef.current !== "off") {
                calibModeRef.current = "off";
                setCalibMode("off");
                setStatusMessage("Calibration cancelled");
              } else {
                calibModeRef.current = "top";
                setCalibMode("top");
                setStatusMessage("Hold your hand over the TOP row (black side) and click anywhere on the board");
              }
            }}
            className={`rounded px-3 py-1.5 text-sm border backdrop-blur-sm ${
              calibMode !== "off"
                ? "bg-violet-800/60 text-violet-200 border-violet-600 hover:bg-violet-700/60"
                : "bg-black/60 text-zinc-200 border-zinc-700 hover:bg-zinc-800"
            }`}
          >
            {calibMode === "off" ? "Calibrate hand" : calibMode === "top" ? "Click: top row →" : "Click: bottom row →"}
          </button>
        </div>
        <div className="absolute top-20 left-4 z-20 w-96">
          {/* eslint-disable-next-line react-hooks/refs */}
          <GameInfo fen={chessRef.current.fen()} />
        </div>
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 border border-zinc-700/50 backdrop-blur-sm">
          <span className={`h-2 w-2 rounded-full ${handActive ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
          <span className="text-xs text-zinc-300">{handActive ? `Hand · ${gestureLabel || "tracking"}` : "No hand"}</span>
        </div>
        <video
          ref={videoRef}
          muted
          playsInline
          className="hidden"
        />
      </div>
    </div>
  );
}
