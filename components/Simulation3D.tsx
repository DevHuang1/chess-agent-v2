"use client";

import { Chess, Square } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import GameInfo from "@/components/GameInfo";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { validateDropTarget } from "@/lib/dropValidation";

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
type Gesture = "none" | "fist" | "palm";

const BOARD_SIZE = 8;
const SQUARE_SIZE = 1;
const BOARD_OFFSET = (BOARD_SIZE - 1) * SQUARE_SIZE / 2;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const DEFAULT_ORBIT = { theta: Math.PI / 2, phi: 0.84, radius: 19 };
const GESTURE_CONFIRMATION_FRAMES = 8;
const DWELL_MS = 2200;
const PLAYER_MOVE_DURATION = 0.72;
const ROBOT_MOVE_SPEED = 5.2;

function easeInOutCubic(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

// Reusable temporaries so the per-frame animation loop and the hand-detection
// path never allocate garbage — allocations there cause GC hitches and frame
// drops while the WebGL scene renders.
const _v = new THREE.Vector3();
const _boardCorners = [
  new THREE.Vector3(-BOARD_OFFSET, 0, -BOARD_OFFSET),
  new THREE.Vector3(BOARD_OFFSET, 0, -BOARD_OFFSET),
  new THREE.Vector3(-BOARD_OFFSET, 0, BOARD_OFFSET),
  new THREE.Vector3(BOARD_OFFSET, 0, BOARD_OFFSET),
];

// All 3D pieces of a given color share one base + one accent material instead
// of creating fresh MeshPhysicalMaterials per piece. Material identity must be
// stable so pieces can be merged into single-draw-call geometry at build time.
const pieceMaterials = new Map<
  string,
  { base: THREE.MeshPhysicalMaterial; accent: THREE.MeshPhysicalMaterial }
>();

// Merged piece geometry cache keyed by `${color}${type}` — built once on first
// use, then every rebuild only fabricates lightweight meshes from it.
const pieceGeometryCache = new Map<
  string,
  { base: THREE.BufferGeometry; accent: THREE.BufferGeometry | null }
>();

function getPieceMaterials(color: string) {
  let mats = pieceMaterials.get(color);
  if (!mats) {
    const isWhite = color === "w";
    mats = {
      // Ivory whites are slightly rough with a soft clearcoat — a matte,
      // warm finish that reads as natural rather than plastic. Dark pieces
      // keep a restrained sheen for contrast.
      base: new THREE.MeshPhysicalMaterial({
        color: isWhite ? 0xf1e9d8 : 0x1c1d24,
        roughness: isWhite ? 0.42 : 0.22,
        metalness: isWhite ? 0.0 : 0.2,
        clearcoat: isWhite ? 0.12 : 0.5,
        clearcoatRoughness: isWhite ? 0.45 : 0.25,
        reflectivity: isWhite ? 0.28 : 0.55,
      }),
      accent: new THREE.MeshPhysicalMaterial({
        color: isWhite ? 0xe0d2b8 : 0x272933,
        roughness: isWhite ? 0.5 : 0.28,
        metalness: isWhite ? 0.0 : 0.15,
        clearcoat: isWhite ? 0.1 : 0.35,
        clearcoatRoughness: isWhite ? 0.5 : 0.3,
      }),
    };
    pieceMaterials.set(color, mats);
  }
  return mats;
}

// Bakes each mesh's local transform into its geometry and merges them into a
// single indexed BufferGeometry, so a piece draws as one call per material.
function mergePieceMeshes(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  if (meshes.length === 0) return null;
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    m.updateMatrix();
    geos.push(m.geometry.applyMatrix4(m.matrix));
  }
  return mergeGeometries(geos);
}

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
  const v = _v;
  let top = -Infinity;
  let bottom = Infinity;
  for (const c of _boardCorners) {
    v.copy(c).project(cam);
    if (v.y > top) top = v.y;
    if (v.y < bottom) bottom = v.y;
  }
  return { top, bottom };
}

function createPieceGeometry(type: string, color: string): THREE.Group {
  const group = new THREE.Group();
  const { base: baseMat, accent: accentMat } = getPieceMaterials(color);

function lathe(points: [number, number][], segments = 36): THREE.Mesh {
    const vec2 = points.map(([x, y]) => new THREE.Vector2(x, y));
    const m = new THREE.Mesh(new THREE.LatheGeometry(vec2, segments), baseMat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // Shared foot: a flared bowl with a beveled shoulder. Every piece's stem
  // sprouts from y ≈ 0.13 so the whole set reads as one coherent design.
  function base(yOffset: number, scale = 1): THREE.Mesh {
    const b = lathe([
      [0, 0],
      [0.28 * scale, 0],
      [0.36 * scale, 0.02],
      [0.36 * scale, 0.055],
      [0.285 * scale, 0.085],
      [0.205 * scale, 0.11],
      [0.165 * scale, 0.13],
    ]);
    b.position.y = yOffset;
    return b;
  }

// Decorative accent ring seat where the stem meets the foot.
  function seatRing(scale = 1): THREE.Mesh {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.205 * scale, 0.02, 12, 30),
      accentMat,
    );
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.105;
    return r;
  }

  // Accent torus that hugs a stem at `radius`/`y`.
  function accentRing(radius: number, y: number, tube = 0.02): THREE.Mesh {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 12, 26),
      accentMat,
    );
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    return r;
  }

  switch (type) {
    case "p": {
      // Pawn: foot, swelling shoulder, neck ring and round head
      const body = lathe([
        [0.16, 0.13],
        [0.16, 0.185],
        [0.185, 0.235],
        [0.212, 0.275],
        [0.19, 0.32],
        [0.155, 0.365],
        [0.13, 0.405],
        [0.142, 0.43],
      ]);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 22, 18),
        baseMat,
      );
      head.position.y = 0.545;
      head.scale.y = 0.82;
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.132, 0.022, 12, 26),
        accentMat,
      );
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.44;
      group.add(base(0), seatRing(), body, head, collar);
      break;
    }
    case "n": {
      // Knight: foot, tapered body, thrust neck, ears + muzzle
      const bodyMesh = lathe([
        [0.15, 0.13],
        [0.15, 0.19],
        [0.178, 0.235],
        [0.158, 0.28],
        [0.135, 0.325],
      ]);
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.062, 0.1, 0.2, 14),
        baseMat,
      );
      neck.position.set(0, 0.42, 0.1);
      neck.rotation.z = 0.12;
      const skull = new THREE.Mesh(
        new THREE.SphereGeometry(0.095, 16, 12),
        baseMat,
      );
      skull.position.set(0.12, 0.51, 0.1);
      skull.scale.set(0.95, 0.78, 1.05);
      const muzzle = new THREE.Mesh(
        new THREE.SphereGeometry(0.058, 12, 10),
        accentMat,
      );
muzzle.position.set(0.22, 0.46, 0.1);
      muzzle.scale.set(1.25, 0.55, 0.85);
      const earL = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.08, 8), accentMat);
      earL.position.set(-0.05, 0.56, 0.1);
      earL.rotation.x = 0.4;
      const earR = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.08, 8), accentMat);
      earR.position.set(0.035, 0.575, 0.1);
      earR.rotation.x = -0.15;
      group.add(base(0, 0.95), seatRing(0.95), bodyMesh, neck, skull, muzzle, earL, earR);
      break;
      break;
    }
    case "b": {
      // Bishop: foot, tall tapered body, ring, rounded mitre with cleft
      const bodyMesh = lathe([
        [0.155, 0.13],
        [0.155, 0.21],
        [0.16, 0.28],
        [0.14, 0.36],
        [0.12, 0.43],
        [0.105, 0.5],
        [0.09, 0.555],
      ]);
      const mitre = new THREE.Mesh(
        new THREE.SphereGeometry(0.105, 20, 16),
        baseMat,
      );
      mitre.position.y = 0.61;
      mitre.scale.set(1, 0.8, 1);
      const cleftL = new THREE.Mesh(
        new THREE.SphereGeometry(0.026, 10, 8),
        accentMat,
      );
      cleftL.position.set(-0.042, 0.675, 0);
      const cleftR = new THREE.Mesh(
        new THREE.SphereGeometry(0.026, 10, 8),
        accentMat,
      );
cleftR.position.set(0.042, 0.675, 0);
      group.add(
        base(0),
        seatRing(),
        bodyMesh,
        accentRing(0.115, 0.52),
        mitre,
        cleftL,
        cleftR,
      );
      break;
      break;
    }
    case "r": {
      // Rook: foot, column, crown disc and crenellated merlons
      const column = lathe([
        [0.145, 0.13],
        [0.15, 0.2],
        [0.14, 0.28],
        [0.125, 0.36],
        [0.135, 0.43],
        [0.152, 0.475],
        [0.168, 0.505],
      ]);
      const crownDisk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.215, 0.215, 0.07, 24),
        baseMat,
      );
crownDisk.position.y = 0.54;
      const merlons: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.085, 0.05),
          accentMat,
        );
        m.position.set(Math.cos(angle) * 0.2, 0.595, Math.sin(angle) * 0.2);
        merlons.push(m);
      }
group.add(base(0, 0.95), seatRing(0.95), column, crownDisk, accentRing(0.16, 0.5), ...merlons);
      break;
      break;
    }
    case "q": {
      // Queen: foot, graceful body, coronet with spikes + finial ball
      const bodyMesh = lathe([
        [0.155, 0.13],
        [0.155, 0.22],
        [0.17, 0.3],
        [0.16, 0.38],
        [0.145, 0.46],
        [0.135, 0.52],
        [0.13, 0.56],
      ]);
      const spikes: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const s = new THREE.Mesh(
          new THREE.ConeGeometry(0.028, 0.11, 8),
          accentMat,
        );
        s.position.set(Math.cos(angle) * 0.15, 0.625, Math.sin(angle) * 0.15);
        spikes.push(s);
      }
      const topBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 12, 10),
        accentMat,
      );
      topBall.position.y = 0.665;
      group.add(
        base(0),
        seatRing(),
        bodyMesh,
        accentRing(0.14, 0.55),
        accentRing(0.155, 0.585, 0.022),
        ...spikes,
        topBall,
      );
      break;
    }
    case "k": {
      // King: foot, tallest body, crown band, finial ball and cross
      const bodyMesh = lathe([
        [0.155, 0.13],
        [0.155, 0.24],
        [0.17, 0.32],
        [0.155, 0.4],
        [0.14, 0.48],
        [0.13, 0.55],
        [0.125, 0.6],
      ]);
      const crownBand = accentRing(0.128, 0.605, 0.02);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 12, 10),
        accentMat,
      );
      ball.position.y = 0.645;
      const crossV = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.16, 0.045),
        accentMat,
      );
      crossV.position.y = 0.72;
      const crossH = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.035, 0.045),
        accentMat,
      );
      crossH.position.y = 0.76;
      group.add(base(0), seatRing(), bodyMesh, crownBand, ball, crossV, crossH);
      break;
    }
  }

  // Merge each material's sub-meshes into one geometry so each piece renders
  // as a single draw call per material instead of one per lathe/sphere/cone
  // (a queen, for example, dropped from ~10 meshes to 2). Geometry depends
  // only on (type, color), so it's computed once and shared across rebuilds.
  const cacheKey = `${color}${type}`;
  let cached = pieceGeometryCache.get(cacheKey);
  if (!cached) {
    const baseParts: THREE.Mesh[] = [];
    const accentParts: THREE.Mesh[] = [];
    for (const child of group.children) {
      if (child instanceof THREE.Mesh) {
        (child.material === accentMat ? accentParts : baseParts).push(child);
      }
    }
    const mergedBase = mergePieceMeshes(baseParts);
    const mergedAccent = mergePieceMeshes(accentParts);
    if (!mergedBase) throw new Error(`Piece ${cacheKey} has no base geometry`);
    cached = { base: mergedBase, accent: mergedAccent ?? null };
    pieceGeometryCache.set(cacheKey, cached);
  }
  group.clear();
  const baseMesh = new THREE.Mesh(cached.base, baseMat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  group.add(baseMesh);
  if (cached.accent) {
    const accentMesh = new THREE.Mesh(cached.accent, accentMat);
    accentMesh.castShadow = true;
    accentMesh.receiveShadow = true;
    group.add(accentMesh);
  }

  return group;
}

function disposeThreeResources(roots: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) materials.add(material);
    });
  }

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

type ArticulatedHand = {
  group: THREE.Group;
  setGrip: (amount: number) => void;
};

function createArticulatedHand(
  skinMaterial: THREE.MeshStandardMaterial,
  accentMaterial: THREE.MeshStandardMaterial,
  isRobot: boolean,
): ArticulatedHand {
  const group = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), skinMaterial);
  palm.scale.set(0.88, 0.7, 1.08);
  group.add(palm);

  const fingerJoints: THREE.Object3D[] = [];
  const fingerX = [-0.105, -0.035, 0.035, 0.105];
  for (const [index, x] of fingerX.entries()) {
    const finger = new THREE.Object3D();
    finger.position.set(x, -0.015, -0.115);
    const proximal = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.035, 0.11, 5, 8),
      skinMaterial,
    );
    proximal.rotation.x = Math.PI / 2;
    proximal.position.z = -0.045;
    const distal = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.032, 0.09, 5, 8),
      skinMaterial,
    );
    distal.rotation.x = Math.PI / 2;
    distal.position.set(0, 0.005, -0.13);
    finger.add(proximal, distal);
    fingerJoints.push(finger);
    group.add(finger);
    if (index === 3) {
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), accentMaterial);
      knuckle.position.set(x, 0.015, 0.01);
      group.add(knuckle);
    }
  }

  const thumb = new THREE.Object3D();
  thumb.position.set(isRobot ? -0.14 : 0.14, -0.015, -0.005);
  const thumbMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.04, 0.12, 5, 8),
    skinMaterial,
  );
  thumbMesh.rotation.z = isRobot ? -0.65 : 0.65;
  thumbMesh.position.set(isRobot ? -0.045 : 0.045, 0, -0.09);
  thumb.add(thumbMesh);
  group.add(thumb);

  const setGrip = (amount: number) => {
    const grip = THREE.MathUtils.clamp(amount, 0, 1);
    for (const [index, finger] of fingerJoints.entries()) {
      const spread = (index - 1.5) * 0.035;
      finger.rotation.x = grip * 0.78;
      finger.rotation.z = spread * (1 - grip * 0.7);
    }
    thumb.rotation.x = grip * 0.42;
    thumb.rotation.z = (isRobot ? -0.65 : 0.65) + (isRobot ? 1 : -1) * grip * 0.38;
    palm.scale.y = 0.7 + grip * 0.06;
  };

  setGrip(0.08);
  group.userData = { palm, fingerJoints, thumb, setGrip };
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return { group, setGrip };
}

function createRobot(): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xc8d1dd,
    roughness: 0.42,
    metalness: 0.6,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x243447,
    roughness: 0.38,
    metalness: 0.45,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.5,
    metalness: 0.25,
  });
  const handMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x22d3ee,
    emissiveIntensity: 0.3,
    roughness: 0.25,
    metalness: 0.6,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,
    emissive: 0x22d3ee,
    emissiveIntensity: 1.5,
    roughness: 0.3,
    metalness: 0.1,
  });

  // Pedestal with a glowing rim ring and recessed hatch
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.08, 0.28, 24), darkMat);
  base.position.y = 0.14;
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.045, 10, 28), glowMat);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.31;
  const baseHatch = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.05, 18), accentMat);
  baseHatch.position.y = 0.06;

  // Torso with glowing chest core, chest panel and waist band
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.72, 1.4, 20), bodyMat);
  torso.position.y = 1.02;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 14), darkMat);
  neck.position.y = 1.78;
  const shoulderBoltR = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), glowMat);
  shoulderBoltR.position.set(0.66, 1.62, 0.18);
  const shoulderBoltL = shoulderBoltR.clone();
  shoulderBoltL.position.x = -0.66;
  const chestCore = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), glowMat);
  chestCore.position.set(0, 1.12, 0.53);
  const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.06), accentMat);
  chestPanel.position.set(0, 1.38, 0.53);
  const waistRing = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 8, 20), accentMat);
  waistRing.rotation.x = Math.PI / 2;
  waistRing.position.y = 0.42;

  // Shoulder pads
  const padR = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), darkMat);
  padR.scale.set(0.8, 0.55, 1.2);
  padR.position.set(0.64, 1.62, 0);
  const padL = padR.clone();
  padL.position.x = -0.64;

  // Head: rounded helmet with dark faceplate, glowing visor and side pods
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 22, 18), bodyMat);
  head.scale.set(1, 0.92, 1.08);
  head.position.y = 2.06;
  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.44, 0.14), darkMat);
  faceplate.position.set(0, 2.04, 0.34);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.13, 0.1), glowMat);
  visor.position.set(0, 2.08, 0.42);
  const earR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 10), accentMat);
  earR.rotation.z = Math.PI / 2;
  earR.position.set(0.37, 2.06, 0);
  const earL = earR.clone();
  earL.position.x = -0.37;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), bodyMat);
  antenna.position.y = 2.4;
  const antennaBall = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), glowMat);
  antennaBall.position.y = 2.56;

  // Right arm (driven by the move mechanism): shoulder anchor, stretchable arm,
  // static joint and glowing hand
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.66, 1.6, 0);

  const armMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.105, 1, 14),
    bodyMat,
  );
  armMesh.position.copy(shoulder.position);

  const shoulderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), darkMat);
  shoulderJoint.position.copy(shoulder.position);

  const articulatedHand = createArticulatedHand(handMat, glowMat, true);
  const hand = articulatedHand.group;
  hand.position.set(0.66, 1.2, 0.6);

  // Static left arm resting at its side
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 0.95, 14), bodyMat);
  armL.rotation.z = 0.25;
  armL.position.set(-0.68, 1.25, 0.05);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), darkMat);
  handL.position.set(-0.9, 0.75, 0.08);

  group.add(
    base,
    baseRing,
    baseHatch,
    torso,
    neck,
    shoulderBoltR,
    shoulderBoltL,
    chestCore,
    chestPanel,
    waistRing,
    padR,
    padL,
    head,
    faceplate,
    visor,
    earR,
    earL,
    antenna,
    antennaBall,
    shoulder,
    armMesh,
    shoulderJoint,
    hand,
    armL,
    handL,
  );
  group.userData = { shoulder, hand, armMesh, handMat, setGrip: articulatedHand.setGrip };
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
    color: 0xe8b68f,
    roughness: 0.55,
    metalness: 0,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    roughness: 0.65,
    metalness: 0.08,
  });
  const pantMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.75,
    metalness: 0.02,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.6,
    metalness: 0.1,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x3b2b1c,
    roughness: 0.9,
    metalness: 0,
  });
  const handMat = new THREE.MeshStandardMaterial({
    color: 0xe8b68f,
    emissive: 0xffa03a,
    emissiveIntensity: 0,
    roughness: 0.5,
    metalness: 0,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.22,
    roughness: 0.2,
    metalness: 0.05,
  });

  // Legs + shoes
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.95, 12), pantMat);
  legL.position.set(-0.27, 0.48, 0);
  const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.95, 12), pantMat);
  legR.position.set(0.27, 0.48, 0);
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.42), shoeMat);
  shoeL.position.set(-0.27, 0.06, -0.1);
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.42), shoeMat);
  shoeR.position.set(0.27, 0.06, -0.1);

  // Torso with a subtle collar
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 1.0, 16), shirtMat);
  torso.position.y = 1.4;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.18, 12), skinMat);
  neck.position.y = 1.86;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.025, 8, 20), shoeMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.98;
  const shirtButton = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat);
  shirtButton.position.set(0, 1.45, -0.39);
  const shirtButton2 = shirtButton.clone();
  shirtButton2.position.y = 1.3;
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skinMat);
  earL.position.set(-0.25, 2.02, 0);
  const earR = earL.clone();
  earR.position.x = 0.25;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 16), shirtMat);
  collar.rotation.x = -Math.PI / 2;
  collar.position.y = 1.86;

  // Head + hair + a small nose bump (facing the board / camera)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 16), skinMat);
  head.position.y = 2.02;
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.256, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2.3),
    hairMat,
  );
  hair.position.y = 2.08;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), skinMat);
  nose.position.set(0, 2.0, -0.24);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), eyeMat);
  eyeL.position.set(-0.09, 2.08, -0.235);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;

  // Right arm (driven by the hand-tracking mechanism): shoulder anchor,
  // stretchable arm and hand that reaches toward the board
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.42, 1.62, 0);
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 1, 10), shirtMat);
  armMesh.position.copy(shoulder.position);
  const articulatedHand = createArticulatedHand(handMat, eyeMat, false);
  const hand = articulatedHand.group;
  hand.position.set(0.5, 1.1, -1.0);

  // Left arm (static, resting)
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.95, 10), shirtMat);
  armL.rotation.z = -0.28;
  armL.position.set(-0.72, 1.25, 0.05);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), skinMat);
  handL.position.set(-0.98, 0.85, 0.08);

  group.add(legL, legR, shoeL, shoeR, torso, neck, belt, shirtButton, shirtButton2, earL, earR, collar, head, hair, nose, eyeL, eyeR, shoulder, armMesh, hand, armL, handL);
  group.userData = { shoulder, hand, armMesh, handMat, setGrip: articulatedHand.setGrip };
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
  secondaryPiece: THREE.Group | null;
  capturedPiece: THREE.Group | null;
  secondaryFrom: THREE.Vector3 | null;
  secondaryTo: THREE.Vector3 | null;
  seg: number;
  t: number;
  elapsed: number;
  speed: number;
  totalDuration: number;
  attached: boolean;
  done: () => void;
};

type Simulation3DProps = {
  chessRef: React.MutableRefObject<Chess>;
  gamePosition: string;
  onMoveExecuted: () => void;
  setStatusMessage: (msg: string) => void;
  onExit: () => void;
  theme?: "dark" | "light";
};

export default function Simulation3D({
  chessRef,
  gamePosition,
  onMoveExecuted,
  setStatusMessage,
  onExit,
  theme = "dark",
}: Simulation3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pieceAssetsRef = useRef(new Map<string, THREE.Group>());
  const cancelAnimationsRef = useRef<() => void>(() => {});
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
    startRobotAnim: (from: string, to: string, flags: string, done: () => void) => void;
  } | null>(null);
  const animRef = useRef<number>(0);
  const camOrbit = useRef({ ...DEFAULT_ORBIT });
  const finger3dRef = useRef<{ x: number; z: number } | null>(null);
  const selectedRef = useRef<string | null>(null);
  const legalRef = useRef<string[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const robotAnimatingRef = useRef(false);
  const playerAnimatingRef = useRef(false);
  const pendingGamePositionRef = useRef<string | null>(null);
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
        const key = `${piece.color}${piece.type}`;
        let asset = pieceAssetsRef.current.get(key);
        if (!asset) {
          asset = createPieceGeometry(piece.type, piece.color);
          pieceAssetsRef.current.set(key, asset);
        }
        const group = asset.clone(true);
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
    if (playerAnimatingRef.current) {
      pendingGamePositionRef.current = gamePosition;
      return;
    }
    pendingGamePositionRef.current = null;
    if (robotAnimatingRef.current) {
      cancelAnimationsRef.current();
    }
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
      s.startRobotAnim(last.from, last.to, last.flags, () => {
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

    let debugApi: Record<string, unknown> | null = null;
    const isE2ETest = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("e2e");
    const scene = new THREE.Scene();
    // Ultra-modern studio background with smooth gradient radial lighting
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 512;
    bgCanvas.height = 512;
    const bgCtx = bgCanvas.getContext("2d");
    if (bgCtx) {
      const isLight = theme === "light";
      const grad = bgCtx.createRadialGradient(256, 180, 40, 256, 256, 360);
      if (isLight) {
        grad.addColorStop(0, "#f1f5f9");
        grad.addColorStop(0.5, "#e2e8f0");
        grad.addColorStop(1, "#cbd5e1");
      } else {
        grad.addColorStop(0, "#1a1d28");
        grad.addColorStop(0.5, "#0f1118");
        grad.addColorStop(1, "#07080c");
      }
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, 512, 512);
    }
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = bgTex;
    scene.fog = theme === "light"
      ? new THREE.Fog(0xcbd5e1, 24, 64)
      : new THREE.Fog(0x07080c, 24, 64);

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    camera.position.set(0, 12.5, 13.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    const isLowPowerDevice = (navigator.hardwareConcurrency ?? 8) <= 4;
    const pixelRatioCap = isLowPowerDevice ? 1.25 : 1.5;
    renderer.setSize(w, h);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    renderer.shadowMap.enabled = !isLowPowerDevice;
// PCFShadowMap samples a single texel kernel while PCFSoftShadowMap runs a
    // 3x3 PCF loop per pixel — roughly double the shadow fill cost with no
    // visible difference at this scene's scale.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // With IBL filling the scene we can expose for a more natural mid-range.
    renderer.toneMappingExposure = 1.0;
    container.prepend(renderer.domElement);

    const isThemeLight = theme === "light";

    // Image-based lighting: a PMREM-mapped studio environment gives the
    // physical materials (pieces use MeshPhysicalMaterial with clearcoat and
    // the pedestal is metallic) real reflections and ambient detail that
    // plain lights can't produce.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    const envMap = pmrem.fromScene(envScene, 0.04).texture;
    envScene.dispose();
    scene.environment = envMap;
    scene.environmentIntensity = isThemeLight ? 0.55 : 0.42;
    pmrem.dispose();

    // Only a whisper of ambient — the environment supplies the base fill now.
    const ambient = new THREE.AmbientLight(0xffffff, isThemeLight ? 0.35 : 0.22);
    scene.add(ambient);

// Warm key light (the only shadow caster) from front-left
    const keyLight = new THREE.DirectionalLight(isThemeLight ? 0xfff2e0 : 0xffd9b3, 2.2);
    keyLight.position.set(6, 14, 8);
    keyLight.castShadow = !isLowPowerDevice;
    keyLight.shadow.mapSize.set(isLowPowerDevice ? 512 : 1024, isLowPowerDevice ? 512 : 1024);
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.normalBias = 0.03;
    keyLight.shadow.radius = 2;
    // Cover the whole arena (pieces, robot at z=-5.6, human at z=7) so no
    // caster falls outside the shadow frustum.
    const keyShadowCam = keyLight.shadow.camera;
    keyShadowCam.left = -8;
    keyShadowCam.right = 8;
    keyShadowCam.top = 8;
    keyShadowCam.bottom = -8;
    keyShadowCam.updateProjectionMatrix();
    scene.add(keyLight);

    // Cool fill from the opposite lower side — opens up the shadow side
    const fillLight = new THREE.DirectionalLight(
      isThemeLight ? 0x9bc9ff : 0x8ab4ff,
      isThemeLight ? 0.7 : 0.42,
    );
    fillLight.position.set(-9, 5, 6);
    scene.add(fillLight);

    // Warm rim from behind — lifts the figures off the dark background
    const rimLight = new THREE.DirectionalLight(0xffb469, isThemeLight ? 0.5 : 0.85);
    rimLight.position.set(-2, 9, -9);
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

// Board tiles are merged into two draw calls (light + dark) instead of 64
    // individual boxes — 32 fewer draw calls, zero visual change.
    const lightTileMat = new THREE.MeshStandardMaterial({
      color: 0xeedec5,
      roughness: 0.35,
      metalness: 0.05,
    });
    const darkTileMat = new THREE.MeshStandardMaterial({
      color: 0x75563b,
      roughness: 0.45,
      metalness: 0.05,
    });
    const lightTileGeos: THREE.BufferGeometry[] = [];
    const darkTileGeos: THREE.BufferGeometry[] = [];

    const haloMaterial = new THREE.MeshBasicMaterial({
      color: theme === "light" ? 0x0f766e : 0x22d3ee,
      transparent: true,
      opacity: theme === "light" ? 0.16 : 0.24,
    });
    const arenaHalo = new THREE.Mesh(
      new THREE.TorusGeometry(6.7, 0.035, 8, 96),
      haloMaterial,
    );
    arenaHalo.rotation.x = Math.PI / 2;
    arenaHalo.position.y = -0.22;
    scene.add(arenaHalo);

    const innerHaloMaterial = new THREE.MeshBasicMaterial({
      color: theme === "light" ? 0xd97706 : 0xf59e0b,
      transparent: true,
      opacity: 0.12,
    });
    const innerHalo = new THREE.Mesh(
      new THREE.TorusGeometry(5.25, 0.018, 8, 96),
      innerHaloMaterial,
    );
    innerHalo.rotation.x = Math.PI / 2;
    innerHalo.position.y = -0.18;
    scene.add(innerHalo);

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let f = 0; f < BOARD_SIZE; f++) {
        const isLight = (r + f) % 2 === 0;
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(SQUARE_SIZE * 0.94, 0.05, SQUARE_SIZE * 0.94),
        );
        tile.position.set(f - BOARD_OFFSET, -0.015, r - BOARD_OFFSET);
        tile.updateMatrix();
        (isLight ? lightTileGeos : darkTileGeos).push(
          tile.geometry.applyMatrix4(tile.matrix),
        );
      }
    }
    const mergedLightTiles = new THREE.Mesh(
      mergeGeometries(lightTileGeos)!,
      lightTileMat,
    );
    const mergedDarkTiles = new THREE.Mesh(
      mergeGeometries(darkTileGeos)!,
      darkTileMat,
    );
    mergedLightTiles.receiveShadow = true;
    mergedDarkTiles.receiveShadow = true;
    scene.add(mergedLightTiles, mergedDarkTiles);
    const tileMeshes: THREE.Mesh[] = [mergedLightTiles, mergedDarkTiles];

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
    const legalDotGeometry = new THREE.CircleGeometry(0.1, 12);
    const legalDotMaterial = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    function updateLegalDots(squares: string[]) {
      for (const dot of legalDots) dot.visible = false;
      for (const [index, sq] of squares.entries()) {
        let dot = legalDots[index];
        if (!dot) {
          dot = new THREE.Mesh(legalDotGeometry, legalDotMaterial);
          dot.rotation.x = -Math.PI / 2;
          scene.add(dot);
          legalDots.push(dot);
        }
        const pos = squareToPosition(sq);
        dot.position.set(pos.x, 0.04, pos.z);
        dot.visible = true;
      }
    }

    // Robot behind the black side
    const robot = createRobot();
    robot.position.set(0, 0, -5.6);
    scene.add(robot);
    const robotShoulder = robot.userData.shoulder as THREE.Object3D;
    const robotHand = robot.userData.hand as THREE.Group;
    const robotArm = robot.userData.armMesh as THREE.Mesh;
    const robotHandMat = robot.userData.handMat as THREE.MeshStandardMaterial;
    const robotSetGrip = robot.userData.setGrip as (amount: number) => void;

    // Human figure on the player's (white) side whose hand follows the tracked hand
    const human = createHuman();
    human.position.set(0, 0, 7.0);
    scene.add(human);
    const humanShoulder = human.userData.shoulder as THREE.Object3D;
    const humanHand = human.userData.hand as THREE.Group;
    const humanArm = human.userData.armMesh as THREE.Mesh;
    const humanHandMat = human.userData.handMat as THREE.MeshStandardMaterial;
    const humanSetGrip = human.userData.setGrip as (amount: number) => void;
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
      _v.copy(worldPos).sub(robot.position);
      robotHand.position.copy(_v);
    }
    robotHand.position.set(0.6, 1.2, 0.6);

    let robotAnim: RobotAnim | null = null;

    function startRobotAnim(fromSq: string, toSq: string, flags: string, done: () => void) {
      robotAnimatingRef.current = true;
      const piece = pieces.get(fromSq) ?? null;
      const fromPos = squareToPosition(fromSq);
      const toPos = squareToPosition(toSq);
      const isCastleKingSide = flags.includes("k");
      const isCastleQueenSide = flags.includes("q");
      const secondaryFromSq = isCastleKingSide ? "h8" : isCastleQueenSide ? "a8" : null;
      const secondaryToSq = isCastleKingSide ? "f8" : isCastleQueenSide ? "d8" : null;
      const secondaryPiece = secondaryFromSq ? pieces.get(secondaryFromSq) ?? null : null;
      const secondaryFrom = secondaryFromSq ? squareToPosition(secondaryFromSq) : null;
      const secondaryTo = secondaryToSq ? squareToPosition(secondaryToSq) : null;

      const captured = pieces.get(toSq);
      if (captured && captured !== piece && captured !== secondaryPiece) {
        captured.visible = false;
        captured.scale.setScalar(0.78);
      }

      const rest = new THREE.Vector3(0.3, 1.7, -4.6);
      const waypoints = [
        { pos: rest.clone(), carry: false, pieceY: 0.15 },
        { pos: new THREE.Vector3(fromPos.x, 2.3, fromPos.z), carry: false, pieceY: 0.15 },
        { pos: new THREE.Vector3(fromPos.x, 0.92, fromPos.z), carry: true, pieceY: 0.15 },
        { pos: new THREE.Vector3(fromPos.x, 2.3, fromPos.z), carry: true, pieceY: 1.0 },
        { pos: new THREE.Vector3(toPos.x, 2.3, toPos.z), carry: true, pieceY: 1.0 },
        { pos: new THREE.Vector3(toPos.x, 0.92, toPos.z), carry: true, pieceY: 0.15 },
        { pos: new THREE.Vector3(toPos.x, 2.3, toPos.z), carry: false, pieceY: 0.15 },
        { pos: rest.clone(), carry: false, pieceY: 0.15 },
      ];

      const totalDistance = waypoints
        .slice(0, -1)
        .reduce((sum, waypoint, index) => sum + waypoint.pos.distanceTo(waypoints[index + 1].pos), 0);
      robotAnim = {
        waypoints,
        piece,
        dropPos: new THREE.Vector3(toPos.x, 0.15, toPos.z),
        secondaryPiece,
        capturedPiece: captured && captured !== piece && captured !== secondaryPiece ? captured : null,
        secondaryFrom,
        secondaryTo,
        seg: 0,
        t: 0,
        elapsed: 0,
        speed: isE2ETest ? 24 : ROBOT_MOVE_SPEED,
        totalDuration: totalDistance / (isE2ETest ? 24 : ROBOT_MOVE_SPEED),
        attached: false,
        done,
      };
      const moveLabel = isCastleKingSide || isCastleQueenSide ? "castles" : `plays ${fromSq}→${toSq}`;
      setStatusMessage(`Robot ${moveLabel}...`);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const gesturePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const gestureHitPoint = new THREE.Vector3();

    let videoStream: MediaStream | null = null;
    let gestureRecognizer: GestureRecognizer | null = null;
    let grabbedPieceGroup: THREE.Group | null = null;
    let detectRaf = 0;

    // Pointer interaction state (right-drag orbit + wheel zoom + calibration clicks)
    let isOrbiting = false;
    let prevPointerX = 0;
    let prevPointerY = 0;
    let pointerDragStart: { x: number; y: number } | null = null;
    let pointerDragging = false;

    // Smooth tracking targets (interpolated in animate loop)
    const fingerFollowTarget = new THREE.Vector3();
    let gestureAnim: {
      piece: THREE.Group;
      from: THREE.Vector3;
      to: THREE.Vector3;
      progress: number;
      arcHeight: number;
      done: () => void;
    } | null = null;
    // Orbit target for smooth camera interpolation
    const smoothOrbit = { ...DEFAULT_ORBIT };

    if (!isE2ETest) {
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
    }

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
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
          cannedGesturesClassifierOptions: { scoreThreshold: 0.5 },
        });

        let lastDetectError = 0;
        let lastVideoTime = -1;
        let lastDetectAt = 0;
        const DETECT_INTERVAL_MS = 100;
        function detect() {
          if (!gestureRecognizer) return;
          if (robotAnimatingRef.current || gestureAnim) {
            detectRaf = requestAnimationFrame(detect);
            return;
          }
          const now = performance.now();
          const hasNewFrame = video.currentTime !== lastVideoTime;
          if (
            hasNewFrame &&
            now - lastDetectAt >= DETECT_INTERVAL_MS &&
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.currentTime > 0
          ) {
            try {
              const result = gestureRecognizer.recognizeForVideo(video, now);
              lastVideoTime = video.currentTime;
              lastDetectAt = now;
              const cat0 = result.gestures?.[0]?.[0];
              const lm0 = result.landmarks?.[0];

              if (cat0 && lm0) {
                const rawGesture: Gesture =
                  cat0.categoryName === "Open_Palm"
                    ? "palm"
                    : cat0.categoryName === "Closed_Fist"
                      ? "fist"
                      : "none";
                const lm = lm0.map((l) => [l.x, l.y, l.z]) as HandLandmark[];
                processHand(lm, rawGesture);
              } else {
                handActiveRef.current = false;
                setHandActive(false);
                setGestureLabel("");
                destHighlight.visible = false;
                cursorRing.visible = false;
                lastHandPosRef.current = null;
                dwellSquare = null;
                lastDwellRemaining = -1;
                // Clear stale gesture state so a returning hand must build up
                // a fresh 12-frame confirmation instead of firing instantly.
                stableGesture = "none";
                stableCount = 0;
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
    let lastBlockMsgTime = 0;
    // Last square under the hand that is a legal target, so the held piece
    // rests there (instead of snapping back to its origin) whenever the cursor
    // leaves the board.
    let lastLegalSq: string | null = null;
    // Dwell-to-place: rest the held piece over a legal square for DWELL_MS and
    // it places automatically.
    let dwellSquare: string | null = null;
    let dwellStartedAt = 0;
    let lastDwellRemaining = -1;
    const DWELL_STATUS_SECONDS = Math.ceil(DWELL_MS / 1000);

    function cancelActiveAnimations() {
      robotAnim = null;
      robotAnimatingRef.current = false;
      playerAnimatingRef.current = false;
      pendingGamePositionRef.current = null;
      if (gestureAnim && grabbedPieceSquare) {
        gestureAnim.piece.position.copy(squareToPosition(grabbedPieceSquare));
      }
      gestureAnim = null;
      grabbedPieceGroup = null;
      grabbedPieceSquare = null;
      dwellSquare = null;
      lastDwellRemaining = -1;
      setSelectedSquare(null);
      setLegalSquares([]);
      updateLegalDots([]);
      selectionRing.visible = false;
      destHighlight.visible = false;
      cursorRing.visible = false;
      setHoveredSquare(null);
    }
    cancelAnimationsRef.current = cancelActiveAnimations;

    if (process.env.NODE_ENV !== "production") {
      const debugSetPosition = (fen: string) => {
        try {
          cancelActiveAnimations();
          chessRef.current.load(fen);
          rebuildPieces(chessRef.current, scene, pieces);
          return true;
        } catch {
          return false;
        }
      };

      const debugStartRobotMove = (from: string, to: string) => {
        try {
          const move = chessRef.current.move({ from: from as Square, to: to as Square, promotion: "q" });
          if (!move) return false;
          startRobotAnim(move.from, move.to, move.flags, () => {
            rebuildPieces(chessRef.current, scene, pieces);
            robotAnimatingRef.current = false;
          });
          return true;
        } catch {
          return false;
        }
      };

      const debugSelectAndMove = (from: string, to: string) => {
        const chess = chessRef.current;
        const piece = chess.get(from as Square);
        if (!piece || piece.color !== "w" || chess.turn() !== "w") return false;
        const moves = chess.moves({ square: from as Square, verbose: true });
        const legalTargets = moves.map((move) => move.to);
        if (!legalTargets.includes(to as Square)) return false;
        grabbedPieceSquare = from;
        grabbedPieceGroup = pieces.get(from) ?? null;
        legalRef.current = legalTargets;
        setSelectedSquare(from);
        setLegalSquares(legalTargets);
        updateLegalDots(legalTargets);
        releaseHeldPiece(to);
        return true;
      };

      debugApi = {
        setPosition: debugSetPosition,
        selectAndMove: debugSelectAndMove,
        startRobotMove: debugStartRobotMove,
        getSquareScreenCenter: (square: string) => {
          const rect = renderer.domElement.getBoundingClientRect();
          const projected = squareToPosition(square).project(camera);
          return {
            x: rect.left + (projected.x + 1) * rect.width / 2,
            y: rect.top + (1 - projected.y) * rect.height / 2,
          };
        },
        getSnapshot: () => ({
          fen: chessRef.current.fen(),
          playerAnimating: Boolean(gestureAnim),
          robotAnimating: Boolean(robotAnim),
          robotSegment: robotAnim?.seg ?? -1,
          robotProgress: robotAnim?.t ?? 0,
          robotCaptureHidden: Boolean(robotAnim?.capturedPiece && !robotAnim.capturedPiece.visible),
          e2Position: pieces.get("e2") ? pieces.get("e2")!.position.toArray() : null,
          e4Position: pieces.get("e4") ? pieces.get("e4")!.position.toArray() : null,
          pieceCount: Array.from(pieces.values()).filter((piece) => piece.visible).length,
          sceneChildren: scene.children.length,
        }),
      };
      (window as unknown as { __sentio3dDebug?: Record<string, unknown> }).__sentio3dDebug = debugApi;
    }

    function dropPiece(toSq: string | null) {
      const grabbed = grabbedPieceGroup;
      const fromSq = grabbedPieceSquare;
      if (!grabbed || !fromSq) return;

      let moveSuccess = false;
      const validation = validateDropTarget(fromSq, toSq, legalRef.current);
      if (validation.accepted && validation.target) {
        try {
          const move = chessRef.current.move({ from: fromSq as Square, to: validation.target as Square, promotion: "q" });
          if (move) {
            const targetPos = squareToPosition(validation.target);
            playerAnimatingRef.current = true;
            pendingGamePositionRef.current = chessRef.current.fen();
            gestureAnim = {
              piece: grabbed,
              from: grabbed.position.clone(),
              to: targetPos,
              progress: 0,
              arcHeight: 0.6,
              done: () => {
                playerAnimatingRef.current = false;
                pendingGamePositionRef.current = null;
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
        playerAnimatingRef.current = false;
        pendingGamePositionRef.current = null;
        const origPos = squareToPosition(fromSq);
        gestureAnim = {
          piece: grabbed,
          from: grabbed.position.clone(),
          to: origPos,
          progress: 0,
          arcHeight: 0.28,
          done: () => {},
        };
        setStatusMessage(
          validation.reason === "illegal"
            ? `Illegal move ${fromSq}→${toSq} — piece returned, still your turn`
            : "Move cancelled — piece returned to its square",
        );
      }

      grabbedPieceSquare = null;
      grabbedPieceGroup = null;
      lastLegalSq = null;
      dwellSquare = null;
      lastDwellRemaining = -1;
      setSelectedSquare(null);
      setLegalSquares([]);
      updateLegalDots([]);
      selectionRing.visible = false;
      destHighlight.visible = false;
      cursorRing.visible = false;
      humanHandFollowTarget.copy(HUMAN_HAND_REST);
      pointerDragStart = null;
      pointerDragging = false;
      setHoveredSquare(null);
    }

    function releaseHeldPiece(cursorSq: string | null) {
      const validation = validateDropTarget(grabbedPieceSquare, cursorSq, legalRef.current);
      dropPiece(validation.accepted ? validation.target : null);
    }

    function processHand(lm: HandLandmark[], rawGesture: Gesture) {
      if (robotAnimatingRef.current) return;
      handActiveRef.current = true;
      setHandActive(true);

      // Defensive: a grab should always have both a square and a live group.
      // If the square is set but the group is gone (e.g. board rebuilt), clear
      // the grab so it can never block future grabs forever.
      if (grabbedPieceSquare && !grabbedPieceGroup) {
        grabbedPieceSquare = null;
        setSelectedSquare(null);
        setLegalSquares([]);
        selectionRing.visible = false;
      }

      // Hysteresis: require a short stable gesture window before acting.
      // This confirms intent and rejects one-frame misdetections.
      if (rawGesture === stableGesture) {
        stableCount++;
      } else {
        stableGesture = rawGesture;
        stableCount = 0;
      }
      const gesture: Gesture = stableCount >= GESTURE_CONFIRMATION_FRAMES ? stableGesture : "none";

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

      const ray = raycaster.ray;
      const hit = ray.intersectPlane(gesturePlane, gestureHitPoint);
      const hitPoint = gestureHitPoint;
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
      if (cursorSq !== hoveredRef.current) {
        setHoveredSquare(cursorSq);
      }

      // Green square + cursor ring follow the square under the hand in every
      // gesture, so the target is always visible while moving.
      const holding = !!grabbedPieceSquare && !!grabbedPieceGroup;
      // Remember the last legal target under the hand so the held piece can
      // stay put when the cursor temporarily leaves the board.
      if (holding && cursorSq && legalRef.current.includes(cursorSq)) {
        lastLegalSq = cursorSq;
      }

      // Dwell-to-place: while holding, resting the cursor over a legal square
      // for DWELL_MS places the piece there automatically. Any gesture except
      // an open palm (which releases the piece) keeps the timer running, so
      // hand jitter or classifier flickers can't reset it. The highlight turns
      // amber while charging so the countdown is visible.
      let dwelling = false;
      if (holding && gesture !== "palm" && cursorSq && legalRef.current.includes(cursorSq)) {
        if (dwellSquare === cursorSq) {
          if (performance.now() - dwellStartedAt >= DWELL_MS) {
            dropPiece(cursorSq);
            dwellSquare = null;
          } else {
            dwelling = true;
          }
        } else {
          dwellSquare = cursorSq;
          dwellStartedAt = performance.now();
          dwelling = true;
        }
      } else {
        if (dwellSquare) {
          dwellSquare = null;
          lastDwellRemaining = -1;
        }
      }

      if (cursorSq) {
        const pos = squareToPosition(cursorSq);
        destHighlight.position.set(pos.x, 0.03, pos.z);
        destHighlight.visible = true;
        // Amber while the dwell timer is charging, green on a legal target,
        // red on an illegal one
        (destHighlight.material as THREE.MeshBasicMaterial).color.setHex(
          dwelling
            ? 0xffb300
            : holding && !legalRef.current.includes(cursorSq)
              ? 0xff4444
              : 0x00ff88,
        );
        cursorRing.position.set(pos.x, 0.07, pos.z);
        cursorRing.visible = true;
      } else {
        destHighlight.visible = false;
        cursorRing.visible = false;
      }

      // Human hand mirrors the tracked hand; while holding, the piece snaps to
      // the square under the hand and rides just under the fist. When the
      // cursor is off-board or on an illegal square, keep the piece on the
      // last legal square instead of yanking it back to its origin.
      if (holding && hit) {
        const snapSq =
          cursorSq && legalRef.current.includes(cursorSq)
            ? cursorSq
            : lastLegalSq ?? grabbedPieceSquare;
        const snap = squareToPosition(snapSq!);
        pieceFollowTarget.set(snap.x, 0.85, snap.z);
        fingerFollowTarget.set(snap.x, 1.25, snap.z);
        humanHandFollowTarget.copy(fingerFollowTarget);
      } else if (cursorSq) {
        humanHandFollowTarget.set(hitPoint.x, 1.15, hitPoint.z);
      } else {
        humanHandFollowTarget.copy(HUMAN_HAND_REST);
      }

      // Surface the dwell countdown so the user can see it charging.
      if (dwelling) {
        const remaining = Math.max(
          1,
          Math.ceil((DWELL_MS - (performance.now() - dwellStartedAt)) / 1000),
        );
        if (remaining !== lastDwellRemaining) {
          lastDwellRemaining = remaining;
          setStatusMessage(`Placing on ${cursorSq} in ${remaining}s — hold still`);
        }
      }

      if (gesture === "palm") {
        setGestureLabel("Palm");
        // Open palm releases onto a legal square. An open palm away from a
        // legal target remains a deliberate cancellation.
        if (holding) {
          releaseHeldPiece(cursorSq);
        }
      } else if (gesture === "fist") {
        setGestureLabel("Fist");

        // Grab the nearest movable white piece to the cursor. Proximity-based,
        // so a slightly-off calibration or fist drift still grabs the right piece.
        if (!grabbedPieceSquare) {
          // Let any in-flight placement/cancel animation finish first — a new
          // grab must not cancel it, or the committed move never completes and
          // the game freezes waiting for the bot.
          if (gestureAnim) return;

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
                setStatusMessage(`Holding ${grabSq} · hold still over a green square for ${DWELL_STATUS_SECONDS}s to place · palm to release`);

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
      } else {
        setGestureLabel("");
      }
    }

    // Pointer (mouse/touch) interaction
    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";

    function squareAtPointer(clientX: number, clientY: number): string | null {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(gesturePlane, gestureHitPoint);
      if (!hit) return null;
      const overBoard = hit.x > -BOARD_OFFSET - 0.5 && hit.x < BOARD_OFFSET + 0.5
        && hit.z > -BOARD_OFFSET - 0.5 && hit.z < BOARD_OFFSET + 0.5;
      return overBoard ? positionToSquare(hit.x, hit.z) : null;
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (robotAnimatingRef.current) return;
      if (e.button === 2) {
        isOrbiting = true;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        return;
      }
      if (e.button !== 0) return;

      // Desktop fallback: click a white piece, then click a legal destination.
      // Camera gestures remain the primary interaction, but the same move commit
      // path keeps both controls synchronized with chess.js.
      if (calibModeRef.current === "off" && !handActiveRef.current && !robotAnimatingRef.current) {
        const square = squareAtPointer(e.clientX, e.clientY);
        if (square) {
          const chess = chessRef.current;
          if (grabbedPieceSquare) {
            if (legalRef.current.includes(square)) {
              dropPiece(square);
            } else {
              setStatusMessage(`${square} is not a legal destination`);
            }
          } else if (chess.turn() === "w" && !chess.isGameOver()) {
            const piece = chess.get(square as Square);
            const moves = piece?.color === "w"
              ? chess.moves({ square: square as Square, verbose: true })
              : [];
            if (moves.length > 0) {
              grabbedPieceSquare = square;
              grabbedPieceGroup = pieces.get(square) ?? null;
              pointerDragStart = { x: e.clientX, y: e.clientY };
              pointerDragging = false;
              try {
                canvas.setPointerCapture(e.pointerId);
              } catch {
                // Pointer capture is not available in all test/browser surfaces.
              }
              setSelectedSquare(square);
              setLegalSquares(moves.map((move) => move.to));
              updateLegalDots(moves.map((move) => move.to));
              const pos = squareToPosition(square);
              selectionRing.position.set(pos.x, 0.05, pos.z);
              selectionRing.visible = true;
              setStatusMessage(`Selected ${square} · click a green square to move`);
            }
          }
        }
        return;
      }

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
          setStatusMessage("Calibration done — palm to move · fist to hold · hold still 4s over a green square to place");
        }
        return;
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      if (pointerDragStart && grabbedPieceSquare && !isOrbiting) {
        const distance = Math.hypot(e.clientX - pointerDragStart.x, e.clientY - pointerDragStart.y);
        if (distance > 6) pointerDragging = true;
        if (pointerDragging) {
          const square = squareAtPointer(e.clientX, e.clientY);
          if (square) {
            const pos = squareToPosition(square);
            destHighlight.position.set(pos.x, 0.03, pos.z);
            destHighlight.visible = true;
            (destHighlight.material as THREE.MeshBasicMaterial).color.setHex(
              legalRef.current.includes(square) ? 0x00ff88 : 0xff4444,
            );
          } else {
            destHighlight.visible = false;
          }
        }
      }
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
    });

    canvas.addEventListener("pointerup", (e) => {
      if (e.button === 2) {
        isOrbiting = false;
        return;
      }
      if (e.button === 0 && pointerDragging && grabbedPieceSquare) {
        const releaseSquare = squareAtPointer(e.clientX, e.clientY);
        releaseHeldPiece(releaseSquare);
      } else if (e.button === 0) {
        pointerDragStart = null;
        pointerDragging = false;
      }
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
      if (!cw || !ch) return;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
      renderer.setSize(cw, ch);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    let morphT = 0;
    let previousFrameTime = performance.now();
    const topDownPos = new THREE.Vector3(0, 19.5, 0.001);
    const targetCamPos = new THREE.Vector3();
    const framePos = new THREE.Vector3();
    const robotDir = new THREE.Vector3();
    const humanDir = new THREE.Vector3();
    const robotUp = new THREE.Vector3(0, 1, 0);
    let humanGrip = 0.08;
    let robotGrip = 0.08;
    const humanHandTargetLocal = new THREE.Vector3();
    const humanHandTargetWorld = new THREE.Vector3();
    setStatusMessage("Entering 3D Mode — Morphing 2D board to 3D arena...");

    function animate(now = performance.now()) {
      animRef.current = requestAnimationFrame(animate);
      const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - previousFrameTime) / 1000));
      previousFrameTime = now;

      // Watchdog: if the robot is flagged busy but no animation object exists,
      // the flag got stuck — clear it so gestures can never be blocked forever.
      if (robotAnimatingRef.current && !robotAnim) {
        robotAnimatingRef.current = false;
      }

      // Smooth camera orbit interpolation & morph logic
      const orbit = camOrbit.current;
      orbit.theta += (smoothOrbit.theta - orbit.theta) * 0.08;
      orbit.phi += (smoothOrbit.phi - orbit.phi) * 0.08;
      orbit.radius += (smoothOrbit.radius - orbit.radius) * 0.08;
      const cx = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);
      const cy = orbit.radius * Math.cos(orbit.phi);
      const cz = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);

      if (morphT < 1.0) {
        morphT = Math.min(1.0, morphT + deltaSeconds * 1.35);
        const ease = morphT * morphT * (3 - 2 * morphT); // Smoothstep curve

        // Camera lerps smoothly from top-down 2D flat view to 3D perspective
targetCamPos.set(cx, cy, cz);
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

      arenaHalo.rotation.z += deltaSeconds * 0.06;
      innerHalo.rotation.z -= deltaSeconds * 0.1;
      const focusPulse = 1 + Math.sin(now * 0.006) * 0.045;
      selectionRing.scale.setScalar(selectionRing.visible ? focusPulse : 1);
      cursorRing.rotation.z += deltaSeconds * 0.8;
      if (destHighlight.visible) {
        const targetPulse = 1 + Math.sin(now * 0.008) * 0.035;
        destHighlight.scale.setScalar(targetPulse);
      } else {
        destHighlight.scale.setScalar(1);
      }

      // Robot arm follows the hand
      {
robotDir.subVectors(robotHand.position, robotShoulder.position);
        const len = robotDir.length();
        robotArm.position.copy(robotShoulder.position).add(robotHand.position).multiplyScalar(0.5);
        robotArm.scale.set(1, Math.max(len, 0.01), 1);
        if (len > 0.001) {
          robotArm.quaternion.setFromUnitVectors(robotUp, robotDir.normalize());
        }
      }

      // Human hand follows the tracked hand and holds the piece when grabbing
humanHandTargetWorld.copy(humanHandFollowTarget);
      humanHandTargetLocal.copy(humanHandTargetWorld).sub(human.position);
      humanHand.position.lerp(
        humanHandTargetLocal,
        1 - Math.exp(-11 * deltaSeconds),
      );
      const humanGripTarget = grabbedPieceSquare && grabbedPieceGroup ? 0.96 : 0.08;
      humanGrip += (humanGripTarget - humanGrip) * (1 - Math.exp(-13 * deltaSeconds));
      humanSetGrip(humanGrip);
      humanHand.rotation.z = THREE.MathUtils.lerp(
        humanHand.rotation.z,
        grabbedPieceSquare ? -0.12 : 0.08,
        1 - Math.exp(-8 * deltaSeconds),
      );
      humanHandMat.emissiveIntensity = humanGrip * 0.8;
      {
        humanDir.subVectors(humanHand.position, humanShoulder.position);
        const len = humanDir.length();
        humanArm.position.copy(humanShoulder.position).add(humanHand.position).multiplyScalar(0.5);
        humanArm.scale.set(1, Math.max(len, 0.01), 1);
        if (len > 0.001) {
          humanArm.quaternion.setFromUnitVectors(robotUp, humanDir.normalize());
        }
      }

      // Robot move animation
      if (robotAnim) {
        const a = robotAnim;
        const wp = a.waypoints;
        a.elapsed += deltaSeconds;
        const completed = a.elapsed >= a.totalDuration;
        if (completed) {
          a.seg = wp.length - 2;
          a.t = 1;
          setHandWorld(wp[wp.length - 1].pos);
          if (a.piece && a.attached) {
            a.piece.position.copy(a.dropPos);
            a.attached = false;
          }
          const done = a.done;
          robotAnim = null;
          setStatusMessage("Robot move completed.");
          done();
        } else {
          let distanceRemaining = a.elapsed * a.speed;
          let segment = 0;
          while (segment < wp.length - 2) {
            const segmentDistance = wp[segment].pos.distanceTo(wp[segment + 1].pos);
            if (distanceRemaining <= segmentDistance) break;
            distanceRemaining -= segmentDistance;
            segment++;
          }
          a.seg = segment;
          const segmentDistance = wp[segment].pos.distanceTo(wp[segment + 1].pos);
          a.t = THREE.MathUtils.clamp(distanceRemaining / Math.max(segmentDistance, 0.001), 0, 1);
        }

        const cp0 = wp[a.seg];
        const cp1 = wp[a.seg + 1];
framePos.lerpVectors(cp0.pos, cp1.pos, a.t);
        setHandWorld(framePos);

        if (cp1.carry && !a.attached && a.piece) {
          a.attached = true;
        }
        if (!cp1.carry && a.attached && a.piece) {
          a.piece.position.copy(a.dropPos);
          a.attached = false;
        }
        if (cp1.carry && a.attached && a.piece) {
          a.piece.position.set(framePos.x, cp1.pieceY, framePos.z);
          if (a.secondaryPiece && a.secondaryFrom && a.secondaryTo) {
            const castleProgress = THREE.MathUtils.clamp((a.seg - 3 + a.t) / 2.5, 0, 1);
            a.secondaryPiece.position.lerpVectors(a.secondaryFrom, a.secondaryTo, easeInOutCubic(castleProgress));
          }
        }

        const robotGripTarget = a.attached ? 0.96 : 0.12;
        robotGrip += (robotGripTarget - robotGrip) * (1 - Math.exp(-12 * deltaSeconds));
        robotSetGrip(robotGrip);
        robotHand.rotation.z = THREE.MathUtils.lerp(
          robotHand.rotation.z,
          a.attached ? 0.16 : -0.08,
          1 - Math.exp(-8 * deltaSeconds),
        );
        robotHandMat.emissiveIntensity = 0.15 + robotGrip * 0.55;
      } else {
        robotGrip += (0.08 - robotGrip) * (1 - Math.exp(-10 * deltaSeconds));
        robotSetGrip(robotGrip);
        robotHandMat.emissiveIntensity = 0.15 + robotGrip * 0.55;
      }

      // Smooth piece follow for fist grab (held just under the human hand)
      if (grabbedPieceGroup && grabbedPieceSquare) {
        grabbedPieceGroup.position.lerp(pieceFollowTarget, 0.25);
      }

      // Gesture release animation
      if (gestureAnim) {
        gestureAnim.progress += deltaSeconds / PLAYER_MOVE_DURATION;
        if (gestureAnim.progress >= 1) {
          gestureAnim.piece.position.copy(gestureAnim.to);
          const done = gestureAnim.done;
          gestureAnim = null;
          done();
        } else {
          const easedProgress = easeInOutCubic(gestureAnim.progress);
          framePos.lerpVectors(gestureAnim.from, gestureAnim.to, easedProgress);
          framePos.y += Math.sin(easedProgress * Math.PI) * gestureAnim.arcHeight;
          gestureAnim.piece.position.copy(framePos);
        }
      }

      renderer.render(scene, camera);
    }
    animate();

    const pieceAssets = pieceAssetsRef.current;
    const cleanupVid = videoRef.current;
    return () => {
      cancelAnimationFrame(animRef.current);
      cancelAnimationFrame(detectRaf);
      gestureRecognizer?.close();
      resizeObserver.disconnect();
      disposeThreeResources([scene, ...pieceAssets.values()]);
      bgTex.dispose();
      legalDotGeometry.dispose();
      legalDotMaterial.dispose();
      scene.clear();
      renderer.dispose();
      renderer.domElement.remove();
      if (cleanupVid) {
        cleanupVid.pause();
        cleanupVid.srcObject = null;
      }
      if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
      const debugWindow = window as unknown as { __sentio3dDebug?: Record<string, unknown> };
      if (debugApi && debugWindow.__sentio3dDebug === debugApi) {
        delete debugWindow.__sentio3dDebug;
      }
      cancelAnimationsRef.current = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen w-screen bg-black light:bg-slate-200">
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <div className="absolute top-4 left-4 z-20 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={onExit}
            className="rounded bg-black/60 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 border border-zinc-700 backdrop-blur-sm light:bg-white/80 light:text-slate-800 light:border-slate-300 light:hover:bg-slate-100"
          >
            ← Exit 3D
          </button>
          <span className="rounded bg-black/40 px-3 py-1.5 text-sm text-zinc-300 border border-zinc-700/50 backdrop-blur-sm light:bg-white/80 light:text-slate-700 light:border-slate-300">
            {selectedSquare
              ? `Holding ${selectedSquare}`
              : hoveredSquare
                ? `Target ${hoveredSquare} · ${gestureLabel || "move hand"}`
                : handActive
                  ? gestureLabel || "Hand detected"
                  : "Palm to aim · Fist to hold · Hold over a green square for 2s · Palm to release"}
          </span>
          {gestureLabel === "Palm" && (
            <span className="rounded bg-emerald-800/40 px-3 py-1.5 text-xs text-emerald-300 border border-emerald-700/30 backdrop-blur-sm light:bg-emerald-100 light:text-emerald-700 light:border-emerald-300">
              Open palm — move over the board (green square)
            </span>
          )}
          {gestureLabel === "Fist" && (
                          <span className="rounded bg-amber-800/40 px-3 py-1.5 text-xs text-amber-300 border border-amber-700/30 backdrop-blur-sm light:bg-amber-100 light:text-amber-700 light:border-amber-300">
              Fist — hold the piece, then keep the target steady

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
                ? "bg-violet-800/60 text-violet-200 border-violet-600 hover:bg-violet-700/60 light:bg-violet-100 light:text-violet-700 light:border-violet-300"
                : "bg-black/60 text-zinc-200 border-zinc-700 hover:bg-zinc-800 light:bg-white/80 light:text-slate-800 light:border-slate-300 light:hover:bg-slate-100"
            }`}
          >
            {calibMode === "off" ? "Calibrate hand" : calibMode === "top" ? "Click: top row →" : "Click: bottom row →"}
          </button>
        </div>
        <div className="absolute top-20 left-4 z-20 w-96">
          {/* eslint-disable-next-line react-hooks/refs */}
          <GameInfo moves={chessRef.current.history({ verbose: true })} />
        </div>
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 border border-zinc-700/50 backdrop-blur-sm light:bg-white/80 light:border-slate-300">
          <span className={`h-2 w-2 rounded-full ${handActive ? "bg-emerald-400 animate-pulse" : "bg-zinc-600 light:bg-slate-400"}`} />
          <span className="text-xs text-zinc-300 light:text-slate-700">{handActive ? `Hand · ${gestureLabel || "tracking"}` : "No hand"}</span>
        </div>
        <div className="absolute top-4 right-4 z-20 w-40 rounded-lg border border-zinc-700/60 bg-black/50 p-1 backdrop-blur-sm shadow-xl light:bg-white/80 light:border-slate-300">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-28 w-full scale-x-[-1] rounded-md object-cover"
          />
          <span className="block px-1 pt-1 text-[10px] uppercase tracking-wider text-zinc-400 font-mono light:text-slate-500">
            Camera
          </span>
        </div>
      </div>
    </div>
  );
}
