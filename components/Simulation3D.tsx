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
type LightingPresetName = "studio" | "warm" | "cool" | "dramatic";

type LightingPreset = {
  ambientColor: number;
  ambientIntensity: number;
  keyColor: number;
  keyIntensity: number;
  rimColor: number;
  rimIntensity: number;
  fillColor: number;
  fillIntensity: number;
  humanColor: number;
  humanIntensity: number;
  robotColor: number;
  robotIntensity: number;
};

const LIGHTING_PRESETS: Record<LightingPresetName, LightingPreset> = {
  studio: {
    ambientColor: 0xffffff,
    ambientIntensity: 0.7,
    keyColor: 0xfff5e6,
    keyIntensity: 2.4,
    rimColor: 0x38bdf8,
    rimIntensity: 0.85,
    fillColor: 0xf59e0b,
    fillIntensity: 0.28,
    humanColor: 0xffb45b,
    humanIntensity: 0.18,
    robotColor: 0x22d3ee,
    robotIntensity: 0.24,
  },
  warm: {
    ambientColor: 0xffe7c2,
    ambientIntensity: 0.78,
    keyColor: 0xffc078,
    keyIntensity: 2.7,
    rimColor: 0xff8a4c,
    rimIntensity: 0.52,
    fillColor: 0xf59e0b,
    fillIntensity: 0.42,
    humanColor: 0xff9d5b,
    humanIntensity: 0.3,
    robotColor: 0xffb347,
    robotIntensity: 0.12,
  },
  cool: {
    ambientColor: 0xc9e7ff,
    ambientIntensity: 0.82,
    keyColor: 0xb9ddff,
    keyIntensity: 2.15,
    rimColor: 0x4f9cff,
    rimIntensity: 1.15,
    fillColor: 0x38bdf8,
    fillIntensity: 0.32,
    humanColor: 0x60a5fa,
    humanIntensity: 0.16,
    robotColor: 0x67e8f9,
    robotIntensity: 0.34,
  },
  dramatic: {
    ambientColor: 0x718096,
    ambientIntensity: 0.42,
    keyColor: 0xffe0ad,
    keyIntensity: 3.05,
    rimColor: 0x2563eb,
    rimIntensity: 1.35,
    fillColor: 0x7c3aed,
    fillIntensity: 0.2,
    humanColor: 0xf97316,
    humanIntensity: 0.22,
    robotColor: 0x06b6d4,
    robotIntensity: 0.38,
  },
};

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

type Particle = {
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  r: number;
  g: number;
  b: number;
};

type ParticleField = {
  points: THREE.Points;
  emit: (origin: THREE.Vector3, colorHex: number, count?: number, spread?: number, speed?: number, life?: number, gravity?: number) => void;
  burst: (origin: THREE.Vector3, colorHex: number, count?: number) => void;
  update: (deltaSeconds: number) => void;
};

function createParticleField(scene: THREE.Scene, capacity = 240): ParticleField {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const particles: Particle[] = Array.from({ length: capacity }, () => ({
    life: 0,
    maxLife: 1,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    gravity: -0.3,
    r: 1,
    g: 1,
    b: 1,
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.08,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  let cursor = 0;
  const colorScratch = new THREE.Color();

  function emit(
    origin: THREE.Vector3,
    colorHex: number,
    count = 1,
    spread = 0.12,
    speed = 0.45,
    life = 0.7,
    gravity = -0.25,
  ) {
    colorScratch.setHex(colorHex);
    for (let i = 0; i < count; i++) {
      const index = cursor;
      cursor = (cursor + 1) % capacity;
      const particle = particles[index];
      particle.life = life * (0.72 + Math.random() * 0.56);
      particle.maxLife = particle.life;
      particle.x = origin.x + (Math.random() - 0.5) * spread;
      particle.y = origin.y + (Math.random() - 0.5) * spread;
      particle.z = origin.z + (Math.random() - 0.5) * spread;
      particle.vx = (Math.random() - 0.5) * speed;
      particle.vy = (Math.random() - 0.25) * speed;
      particle.vz = (Math.random() - 0.5) * speed;
      particle.gravity = gravity;
      particle.r = colorScratch.r;
      particle.g = colorScratch.g;
      particle.b = colorScratch.b;
      positions[index * 3] = particle.x;
      positions[index * 3 + 1] = particle.y;
      positions[index * 3 + 2] = particle.z;
      colors[index * 3] = particle.r;
      colors[index * 3 + 1] = particle.g;
      colors[index * 3 + 2] = particle.b;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  return {
    points,
    emit,
    burst: (origin, colorHex, count = 18) => emit(origin, colorHex, count, 0.34, 1.15, 0.82, -0.72),
    update: (deltaSeconds) => {
      let active = false;
      for (let index = 0; index < capacity; index++) {
        const particle = particles[index];
        if (particle.life <= 0) {
          colors[index * 3] = 0;
          colors[index * 3 + 1] = 0;
          colors[index * 3 + 2] = 0;
          continue;
        }
        active = true;
        particle.life = Math.max(0, particle.life - deltaSeconds);
        particle.vy += particle.gravity * deltaSeconds;
        particle.x += particle.vx * deltaSeconds;
        particle.y += particle.vy * deltaSeconds;
        particle.z += particle.vz * deltaSeconds;
        const fade = particle.life / particle.maxLife;
        positions[index * 3] = particle.x;
        positions[index * 3 + 1] = particle.y;
        positions[index * 3 + 2] = particle.z;
        colors[index * 3] = particle.r * fade;
        colors[index * 3 + 1] = particle.g * fade;
        colors[index * 3 + 2] = particle.b * fade;
      }
      if (active) {
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
      }
    },
  };
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
    color: 0xb8c5d1,
    roughness: 0.28,
    metalness: 0.82,
  });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.9,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x172234,
    roughness: 0.3,
    metalness: 0.62,
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x070b12,
    roughness: 0.82,
    metalness: 0.05,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x0b1220,
    roughness: 0.38,
    metalness: 0.48,
  });
  const handMat = new THREE.MeshStandardMaterial({
    color: 0x38d9f3,
    emissive: 0x0e7490,
    emissiveIntensity: 0.28,
    roughness: 0.2,
    metalness: 0.74,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x9ff5ff,
    emissive: 0x22d3ee,
    emissiveIntensity: 1.35,
    roughness: 0.18,
    metalness: 0.22,
  });

  // Layered base gives the machine a believable weight and a visible service seam.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.08, 0.28, 32), rubberMat);
  base.position.y = 0.14;
  const baseDeck = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.9, 0.09, 32), darkMat);
  baseDeck.position.y = 0.32;
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.04, 10, 32), glowMat);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.36;
  const baseHatch = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.52, 0.045, 24), accentMat);
  baseHatch.position.set(0, 0.31, 0.04);
  const baseHatchLine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.025), edgeMat);
  baseHatchLine.position.set(0, 0.34, 0.04);

  // Mechanical lower body: pelvis, thigh actuators, knee caps, shins and feet.
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.34, 0.58), darkMat);
  pelvis.position.y = 0.56;
  pelvis.rotation.y = Math.PI / 4;
  const hipBand = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 8, 24), edgeMat);
  hipBand.rotation.x = Math.PI / 2;
  hipBand.position.y = 0.68;
  const thighL = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.34, 6, 12), bodyMat);
  thighL.position.set(-0.26, 0.85, 0);
  const thighR = thighL.clone();
  thighR.position.x = 0.26;
  const kneeL = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), darkMat);
  kneeL.position.set(-0.26, 1.14, 0.08);
  const kneeR = kneeL.clone();
  kneeR.position.x = 0.26;
  const shinL = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 6, 12), edgeMat);
  shinL.position.set(-0.26, 1.36, 0);
  const shinR = shinL.clone();
  shinR.position.x = 0.26;
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.18, 0.55), rubberMat);
  footL.position.set(-0.26, 0.1, 0.14);
  const footR = footL.clone();
  footR.position.x = 0.26;
  const footPlateL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.025, 0.36), edgeMat);
  footPlateL.position.set(-0.26, 0.2, 0.15);
  const footPlateR = footPlateL.clone();
  footPlateR.position.x = 0.26;

  // Torso shell with a dark underframe, shoulder line and layered chest electronics.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.72, 1.12, 24), bodyMat);
  torso.position.y = 1.86;
  const torsoUnderframe = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.6, 1.18, 20), darkMat);
  torsoUnderframe.position.set(0, 1.84, -0.035);
  const chestArmor = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.72, 0.14), edgeMat);
  chestArmor.position.set(0, 1.94, 0.5);
  chestArmor.rotation.x = -0.08;
  const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.24, 0.055), accentMat);
  chestPanel.position.set(0, 2.08, 0.585);
  const chestCore = new THREE.Mesh(new THREE.CircleGeometry(0.16, 28), glowMat);
  chestCore.position.set(0, 1.82, 0.59);
  const chestCoreRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.024, 8, 24), glowMat);
  chestCoreRing.rotation.x = Math.PI / 2;
  chestCoreRing.position.set(0, 1.82, 0.605);
  const ventBarMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.7 });
  const ventBars: THREE.Mesh[] = [];
  for (let i = -2; i <= 2; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.035), ventBarMat);
    bar.position.set(i * 0.1, 1.64, 0.59);
    ventBars.push(bar);
  }
  const waistRing = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.045, 8, 24), accentMat);
  waistRing.rotation.x = Math.PI / 2;
  waistRing.position.y = 1.34;

  // Head assembly: helmet shell, recessed faceplate, visor, jaw plate, ear modules and sensor.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.2, 16), rubberMat);
  neck.position.y = 2.55;
  const neckRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 20), glowMat);
  neckRing.rotation.x = Math.PI / 2;
  neckRing.position.y = 2.48;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.37, 28, 22), bodyMat);
  head.scale.set(1, 0.96, 1.08);
  head.position.y = 2.84;
  const helmetTop = new THREE.Mesh(new THREE.SphereGeometry(0.33, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), edgeMat);
  helmetTop.position.set(0, 2.92, 0.01);
  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.5, 0.15), darkMat);
  faceplate.position.set(0, 2.8, 0.36);
  const jawPlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.11), accentMat);
  jawPlate.position.set(0, 2.6, 0.39);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.1), glowMat);
  visor.position.set(0, 2.88, 0.45);
  const visorInner = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.018), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  visorInner.position.set(0, 2.9, 0.51);
  const earR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12), darkMat);
  earR.rotation.z = Math.PI / 2;
  earR.position.set(0.39, 2.82, 0);
  const earL = earR.clone();
  earL.position.x = -0.39;
  const earGlowR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glowMat);
  earGlowR.position.set(0.47, 2.82, 0.02);
  const earGlowL = earGlowR.clone();
  earGlowL.position.x = -0.47;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.28, 8), bodyMat);
  antenna.position.y = 3.25;
  const antennaBall = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), glowMat);
  antennaBall.position.y = 3.41;

  // Right arm is driven by the existing move choreography. The stretchable arm
  // remains the authoritative animated segment, with a shoulder actuator and wrist cuff.
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.66, 2.38, 0);
  const shoulderPadR = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 16), darkMat);
  shoulderPadR.scale.set(0.84, 0.58, 1.18);
  shoulderPadR.position.set(0.66, 2.38, 0);
  const shoulderPadL = shoulderPadR.clone();
  shoulderPadL.position.x = -0.66;
  const shoulderBoltR = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), glowMat);
  shoulderBoltR.position.set(0.66, 2.38, 0.2);
  const shoulderBoltL = shoulderBoltR.clone();
  shoulderBoltL.position.x = -0.66;
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 1, 16), bodyMat);
  armMesh.position.copy(shoulder.position);
  const shoulderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), darkMat);
  shoulderJoint.position.copy(shoulder.position);
  const wristCuff = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 16), glowMat);
  wristCuff.rotation.x = Math.PI / 2;
  wristCuff.position.z = 0.15;

  const articulatedHand = createArticulatedHand(handMat, glowMat, true);
  const hand = articulatedHand.group;
  hand.position.set(0.66, 2.0, 0.6);
  hand.add(wristCuff);

  // Static left arm is fully jointed rather than a single rigid cylinder.
  const armLUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.38, 6, 12), bodyMat);
  armLUpper.position.set(-0.72, 2.04, 0.05);
  armLUpper.rotation.z = 0.22;
  const elbowL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), darkMat);
  elbowL.position.set(-0.84, 1.7, 0.06);
  const armLFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 6, 12), edgeMat);
  armLFore.position.set(-0.92, 1.42, 0.08);
  armLFore.rotation.z = -0.18;
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), handMat);
  handL.position.set(-0.96, 1.18, 0.1);

  group.add(
    base, baseDeck, baseRing, baseHatch, baseHatchLine,
    pelvis, hipBand, thighL, thighR, kneeL, kneeR, shinL, shinR, footL, footR, footPlateL, footPlateR,
    torsoUnderframe, torso, chestArmor, chestPanel, chestCore, chestCoreRing, ...ventBars, waistRing,
    neck, neckRing, head, helmetTop, faceplate, jawPlate, visor, visorInner, earR, earL, earGlowR, earGlowL,
    antenna, antennaBall, shoulderPadR, shoulderPadL, shoulderBoltR, shoulderBoltL, shoulder, armMesh,
    shoulderJoint, hand, armLUpper, elbowL, armLFore, handL,
  );
  group.userData = {
    shoulder,
    hand,
    armMesh,
    handMat,
    setGrip: articulatedHand.setGrip,
    idle: { torso, head, chestCore, chestCoreRing, antennaBall, visor },
  };
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

function createHuman(): THREE.Group {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe3a77d, roughness: 0.58, metalness: 0 });
  const skinLightMat = new THREE.MeshStandardMaterial({ color: 0xf0bd96, roughness: 0.52, metalness: 0 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.72, metalness: 0.03 });
  const shirtLightMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.78, metalness: 0.02 });
  const pantMat = new THREE.MeshStandardMaterial({ color: 0x172033, roughness: 0.82, metalness: 0.01 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.62, metalness: 0.08 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 0.94, metalness: 0 });
  const hairHighlightMat = new THREE.MeshStandardMaterial({ color: 0x4b2c1b, roughness: 0.88, metalness: 0 });
  const handMat = new THREE.MeshStandardMaterial({ color: 0xe3a77d, emissive: 0xff8a2a, emissiveIntensity: 0, roughness: 0.54, metalness: 0 });
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.28, metalness: 0 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x3b2418, roughness: 0.34, metalness: 0.02 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x7f3340, roughness: 0.7, metalness: 0 });
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.3, metalness: 0.45 });

  // Seated lower body: separate thighs, knees, shoes and a visible hip seam.
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 0.22, 6, 14), pantMat);
  pelvis.position.y = 0.72;
  pelvis.scale.z = 0.84;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.48, 6, 12), pantMat);
  legL.position.set(-0.27, 0.46, 0);
  const legR = legL.clone();
  legR.position.x = 0.27;
  const kneeL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), pantMat);
  kneeL.position.set(-0.27, 0.73, -0.02);
  const kneeR = kneeL.clone();
  kneeR.position.x = 0.27;
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.44), shoeMat);
  shoeL.position.set(-0.27, 0.08, -0.13);
  shoeL.rotation.x = -0.08;
  const shoeR = shoeL.clone();
  shoeR.position.x = 0.27;
  const soleL = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.025, 0.43), buttonMat);
  soleL.position.set(-0.27, 0.01, -0.13);
  const soleR = soleL.clone();
  soleR.position.x = 0.27;

  // Clothing layers: fitted shirt, chest plane, collar, belt and buttons.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.58, 8, 16), shirtMat);
  torso.position.y = 1.42;
  torso.scale.z = 0.86;
  const shirtFront = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.72, 0.035), shirtLightMat);
  shirtFront.position.set(0, 1.44, -0.34);
  shirtFront.scale.x = 0.82;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.026, 8, 22), shoeMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 1.0;
  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.025), buttonMat);
  beltBuckle.position.set(0, 1.0, -0.39);
  const shirtButton = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), buttonMat);
  shirtButton.position.set(0, 1.57, -0.37);
  const shirtButton2 = shirtButton.clone();
  shirtButton2.position.y = 1.4;
  const shirtButton3 = shirtButton.clone();
  shirtButton3.position.y = 1.23;
  const collarL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.08), shirtLightMat);
  collarL.position.set(-0.12, 1.82, -0.23);
  collarL.rotation.z = -0.42;
  const collarR = collarL.clone();
  collarR.position.x = 0.12;
  collarR.rotation.z = 0.42;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.18, 14), skinMat);
  neck.position.y = 1.88;

  // Head with jaw, ears, textured-looking hair mass, brows, irises and lips.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), skinLightMat);
  head.scale.set(0.96, 1.08, 0.9);
  head.position.y = 2.12;
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), skinMat);
  jaw.scale.set(1.08, 0.62, 0.8);
  jaw.position.set(0, 1.99, -0.015);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.282, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2.15), hairMat);
  hair.position.y = 2.2;
  const hairline = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 24, Math.PI), hairHighlightMat);
  hairline.rotation.x = Math.PI / 2;
  hairline.position.set(0, 2.16, -0.13);
  const sideHairL = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 5, 8), hairMat);
  sideHairL.position.set(-0.25, 2.08, -0.02);
  const sideHairR = sideHairL.clone();
  sideHairR.position.x = 0.25;
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), skinMat);
  earL.scale.set(0.75, 1, 0.5);
  earL.position.set(-0.26, 2.1, 0);
  const earR = earL.clone();
  earR.position.x = 0.26;
  const nose = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.07, 5, 8), skinMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 2.08, -0.245);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), eyeWhiteMat);
  eyeL.scale.set(1.2, 0.68, 0.45);
  eyeL.position.set(-0.095, 2.17, -0.23);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.095;
  const irisL = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), irisMat);
  irisL.position.set(-0.095, 2.17, -0.255);
  const irisR = irisL.clone();
  irisR.position.x = 0.095;
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.025), hairMat);
  browL.position.set(-0.095, 2.245, -0.235);
  browL.rotation.z = 0.08;
  const browR = browL.clone();
  browR.position.x = 0.095;
  browR.rotation.z = -0.08;
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.018), mouthMat);
  mouth.position.set(0, 1.99, -0.19);

  // Right arm remains driven by hand tracking; the surrounding clothing and cuff
  // make the stretched segment read as a sleeve rather than a floating rod.
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.42, 1.66, 0);
  const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), shirtMat);
  shoulderCap.scale.set(0.9, 0.65, 1.05);
  shoulderCap.position.copy(shoulder.position);
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1, 12), shirtMat);
  armMesh.position.copy(shoulder.position);
  const articulatedHand = createArticulatedHand(handMat, eyeWhiteMat, false);
  const hand = articulatedHand.group;
  hand.position.set(0.5, 1.14, -1.0);
  const wristBand = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 8, 16), buttonMat);
  wristBand.rotation.x = Math.PI / 2;
  wristBand.position.z = 0.13;
  hand.add(wristBand);

  // Left arm rests naturally at the side with a sleeve, elbow and hand.
  const armLUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.34, 6, 10), shirtMat);
  armLUpper.position.set(-0.66, 1.38, 0.05);
  armLUpper.rotation.z = -0.25;
  const elbowL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), shirtMat);
  elbowL.position.set(-0.76, 1.08, 0.06);
  const armLFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 6, 10), skinMat);
  armLFore.position.set(-0.84, 0.86, 0.08);
  armLFore.rotation.z = -0.14;
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skinMat);
  handL.position.set(-0.9, 0.65, 0.1);

  group.add(
    pelvis, legL, legR, kneeL, kneeR, shoeL, shoeR, soleL, soleR,
    torso, shirtFront, belt, beltBuckle, shirtButton, shirtButton2, shirtButton3,
    collarL, collarR, neck, head, jaw, hair, hairline, sideHairL, sideHairR, earL, earR,
    nose, eyeL, eyeR, irisL, irisR, browL, browR, mouth,
    shoulder, shoulderCap, armMesh, hand, armLUpper, elbowL, armLFore, handL,
  );
  group.userData = {
    shoulder,
    hand,
    armMesh,
    handMat,
    setGrip: articulatedHand.setGrip,
    idle: { torso, head, jaw, hair, chest: shirtFront, eyeL, eyeR },
  };
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
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
  liveAiMode?: "off" | "minimax" | "mcts";
  liveAiDepth?: number;
  onLiveAiModeChange?: (mode: "off" | "minimax" | "mcts") => void;
  onLiveAiDepthChange?: (depth: number) => void;
  onAnimationStateChange?: (animating: boolean) => void;
  setStatusMessage: (msg: string) => void;
  onExit: () => void;
  theme?: "dark" | "light";
};

export default function Simulation3D({
  chessRef,
  gamePosition,
  onMoveExecuted,
  liveAiMode = "off",
  liveAiDepth = 3,
  onLiveAiModeChange,
  onLiveAiDepthChange,
  onAnimationStateChange,
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
  const liveAiModeRef = useRef(liveAiMode);
  const onAnimationStateChangeRef = useRef(onAnimationStateChange);
  const gamePositionRef = useRef(gamePosition);
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
  const [lightingPreset, setLightingPreset] = useState<LightingPresetName>("studio");
  const [lightingStrength, setLightingStrength] = useState(1);
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  const audioUnlockRef = useRef<() => void>(() => {});
  const lightingSettingsRef = useRef({
    preset: "studio" as LightingPresetName,
    strength: 1,
    shadows: true,
  });

  const triggerRerender = useCallback(() => forceUpdate((n) => n + 1), []);

  // Keep lighting controls in refs so the render loop can apply them without
  // pushing per-frame values through React state.
  // eslint-disable-next-line react-hooks/refs
  lightingSettingsRef.current = {
    preset: lightingPreset,
    strength: lightingStrength,
    shadows: shadowsEnabled,
  };
  // eslint-disable-next-line react-hooks/refs
  soundEnabledRef.current = soundEnabled;

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

  useEffect(() => {
    liveAiModeRef.current = liveAiMode;
    onAnimationStateChangeRef.current = onAnimationStateChange;
  }, [liveAiMode, onAnimationStateChange]);

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
      (last.color === "b" || liveAiModeRef.current !== "off") &&
      s.startRobotAnim &&
      !robotAnimatingRef.current
    ) {
      onAnimationStateChangeRef.current?.(true);
      s.startRobotAnim(last.from, last.to, last.flags, () => {
        rebuildPieces(chessRef.current, s.scene, s.pieces);
        setSelectedSquare(null);
        setLegalSquares([]);
        robotAnimatingRef.current = false;
        onAnimationStateChangeRef.current?.(false);
      });
    } else {
      rebuildPieces(chess, s.scene, s.pieces);
      setSelectedSquare(null);
      setLegalSquares([]);
      onAnimationStateChangeRef.current?.(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePosition, rebuildPieces]);

  // Keep a ref to the latest onMoveExecuted so the mount-only effect always calls the current one
  const onMoveRef = useRef(onMoveExecuted);
  useEffect(() => {
    onMoveRef.current = onMoveExecuted;
  }, [onMoveExecuted]);

  // Sync refs during render so the detect loop closure has up-to-date values
  // eslint-disable-next-line react-hooks/refs
  gamePositionRef.current = gamePosition;
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

    // Localized lights give the figures readable silhouettes and let active
    // gestures create a soft, responsive pool of light near the board.
    const gestureLight = new THREE.PointLight(0xf59e0b, 0.28, 18, 2);
    gestureLight.position.set(0, 5.5, 2.5);
    scene.add(gestureLight);
    const humanLight = new THREE.PointLight(0xffb45b, 0.18, 7, 2);
    humanLight.position.set(0, 2.7, 5.2);
    scene.add(humanLight);
    const robotLight = new THREE.PointLight(0x22d3ee, 0.24, 7, 2);
    robotLight.position.set(0, 3.2, -4.4);
    scene.add(robotLight);
    const interactionLight = new THREE.PointLight(0x7dd3fc, 0, 5.5, 2);
    interactionLight.position.set(0, 1.7, 0);
    scene.add(interactionLight);

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
    const particleField = createParticleField(scene, isLowPowerDevice ? 150 : 300);
    particleField.points.visible = !isE2ETest;
    const particleOrigin = new THREE.Vector3();
    const coreParticleOrigin = new THREE.Vector3();
    let lastCoreParticleAt = 0;
    let lastActivePieceParticleAt = 0;
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
    const robotIdle = robot.userData.idle as {
      torso: THREE.Object3D;
      head: THREE.Object3D;
      chestCore: THREE.Object3D;
      chestCoreRing: THREE.Object3D;
      antennaBall: THREE.Object3D;
      visor: THREE.Object3D;
    };

    // Human figure on the player's (white) side whose hand follows the tracked hand
    const human = createHuman();
    human.position.set(0, 0, 7.0);
    scene.add(human);
    const humanShoulder = human.userData.shoulder as THREE.Object3D;
    const humanHand = human.userData.hand as THREE.Group;
    const humanArm = human.userData.armMesh as THREE.Mesh;
    const humanHandMat = human.userData.handMat as THREE.MeshStandardMaterial;
    const humanSetGrip = human.userData.setGrip as (amount: number) => void;
    const humanIdle = human.userData.idle as {
      torso: THREE.Object3D;
      head: THREE.Object3D;
      jaw: THREE.Object3D;
      hair: THREE.Object3D;
      chest: THREE.Object3D;
      eyeL: THREE.Object3D;
      eyeR: THREE.Object3D;
    };
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
    robotHand.position.set(0.6, 1.75, 0.6);

    let robotAnim: RobotAnim | null = null;
    let appliedLightingSignature = "";

    function applyLightingSettings() {
      const settings = lightingSettingsRef.current;
      const preset = LIGHTING_PRESETS[settings.preset];
      const signature = `${settings.preset}:${settings.strength}:${settings.shadows}`;
      if (signature === appliedLightingSignature) return;
      appliedLightingSignature = signature;
      const strength = settings.strength;
      ambient.color.setHex(preset.ambientColor);
      ambient.intensity = preset.ambientIntensity * strength;
      keyLight.color.setHex(preset.keyColor);
      keyLight.intensity = preset.keyIntensity * strength;
      rimLight.color.setHex(preset.rimColor);
      rimLight.intensity = preset.rimIntensity * strength;
      fillLight.color.setHex(preset.fillColor);
      fillLight.intensity = preset.fillIntensity * strength;
      humanLight.color.setHex(preset.humanColor);
      humanLight.intensity = preset.humanIntensity * strength;
      robotLight.color.setHex(preset.robotColor);
      robotLight.intensity = preset.robotIntensity * strength;
      const shadows = settings.shadows && !isLowPowerDevice;
      renderer.shadowMap.enabled = shadows;
      keyLight.castShadow = shadows;
      renderer.shadowMap.needsUpdate = true;
    }

    let audioContext: AudioContext | null = null;
    let audioMasterGain: GainNode | null = null;

    function unlockAudio() {
      if (typeof window === "undefined") return;
      try {
        if (!audioContext) {
          const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextConstructor) return;
          audioContext = new AudioContextConstructor();
          audioMasterGain = audioContext.createGain();
          audioMasterGain.gain.value = 0.18;
          audioMasterGain.connect(audioContext.destination);
        }
        if (audioContext.state === "suspended") void audioContext.resume();
      } catch {
        audioContext = null;
        audioMasterGain = null;
      }
    }

    audioUnlockRef.current = unlockAudio;

    function playTone(
      frequency: number,
      duration: number,
      volume: number,
      type: OscillatorType = "sine",
      endFrequency = frequency,
    ) {
      if (!soundEnabledRef.current) return;
      unlockAudio();
      if (!audioContext || !audioMasterGain || audioContext.state !== "running") return;
      const start = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(audioMasterGain);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }

    function playServoSound(intensity = 1) {
      playTone(150 + intensity * 35, 0.18, 0.035 * intensity, "sawtooth", 82 + intensity * 18);
      playTone(420 + intensity * 50, 0.12, 0.018 * intensity, "square", 230);
    }

    function playPickupSound() {
      playTone(520, 0.09, 0.045, "triangle", 780);
    }

    function playPlacementSound(capture = false) {
      playTone(capture ? 110 : 260, capture ? 0.24 : 0.16, capture ? 0.07 : 0.05, "sine", capture ? 62 : 420);
      playTone(capture ? 190 : 520, 0.11, 0.025, "triangle", capture ? 90 : 680);
    }

    function playCancelSound() {
      playTone(180, 0.13, 0.028, "sine", 100);
    }

    function startRobotAnim(fromSq: string, toSq: string, flags: string, done: () => void) {
      robotAnimatingRef.current = true;
      playServoSound(0.85);
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
        particleOrigin.copy(toPos);
        particleOrigin.y = 0.48;
        particleField.burst(particleOrigin, 0xfbbf24, 26);
        playPlacementSound(true);
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
                activeGesture = "none";
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
    let activeGesture: Gesture = "none";
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
      onAnimationStateChangeRef.current?.(false);
      playerAnimatingRef.current = false;
      pendingGamePositionRef.current = null;
      if (gestureAnim) {
        gestureAnim.piece.position.copy(gestureAnim.from);
      } else if (grabbedPieceGroup && grabbedPieceSquare) {
        grabbedPieceGroup.position.copy(squareToPosition(grabbedPieceSquare));
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
          reactGamePosition: gamePositionRef.current,
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
          const startFen = chessRef.current.fen();
          const previewChess = new Chess(startFen);
          const previewMove = previewChess.move({
            from: fromSq as Square,
            to: validation.target as Square,
            promotion: "q",
          });
          if (previewMove) {
            const targetPos = squareToPosition(validation.target);
            particleOrigin.copy(targetPos);
            particleOrigin.y = 0.28;
            particleField.emit(particleOrigin, previewMove.captured ? 0xfbbf24 : 0x34d399, 8, 0.14, 0.32, 0.45, -0.16);
            playServoSound(0.42);
            playerAnimatingRef.current = true;
            pendingGamePositionRef.current = startFen;
            gestureAnim = {
              piece: grabbed,
              from: grabbed.position.clone(),
              to: targetPos,
              progress: 0,
              arcHeight: 0.6,
              done: () => {
                if (chessRef.current.fen() !== startFen) {
                  playerAnimatingRef.current = false;
                  pendingGamePositionRef.current = null;
                  rebuildPieces(chessRef.current, scene, pieces);
                  triggerRerender();
                  return;
                }
                const committedMove = chessRef.current.move({
                  from: fromSq as Square,
                  to: validation.target as Square,
                  promotion: "q",
                });
                playerAnimatingRef.current = false;
                pendingGamePositionRef.current = null;
                if (!committedMove) {
                  rebuildPieces(chessRef.current, scene, pieces);
                  triggerRerender();
                  return;
                }
                particleOrigin.copy(targetPos);
                particleOrigin.y = 0.28;
                particleField.burst(particleOrigin, committedMove.captured ? 0xfbbf24 : 0x34d399, committedMove.captured ? 24 : 16);
                playPlacementSound(Boolean(committedMove.captured));
                setStatusMessage(`3D Move: ${committedMove.san}`);
                // Publish while the transaction is still marked active. The
                // parent updates React's FEN, and this component's effect will
                // rebuild once from the committed chess state after the
                // animation instead of racing a second imperative rebuild.
                onMoveRef.current();
                playerAnimatingRef.current = false;
                pendingGamePositionRef.current = null;
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
        playCancelSound();
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
      if (liveAiModeRef.current !== "off") return;
      const validation = validateDropTarget(grabbedPieceSquare, cursorSq, legalRef.current);
      dropPiece(validation.accepted ? validation.target : null);
    }

    function processHand(lm: HandLandmark[], rawGesture: Gesture) {
      if (robotAnimatingRef.current || liveAiModeRef.current !== "off") return;
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
      activeGesture = gesture;

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
                playPickupSound();
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
      audioUnlockRef.current();
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
              playPickupSound();
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
    const interactionTarget = new THREE.Vector3();
    const humanFocusTarget = new THREE.Vector3();
    const robotFocusTarget = new THREE.Vector3();
    const interactionLightOrigin = new THREE.Vector3(0, 1.7, 0);
    setStatusMessage("Entering 3D Mode — Morphing 2D board to 3D arena...");

    function animate(now = performance.now()) {
      animRef.current = requestAnimationFrame(animate);
      const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - previousFrameTime) / 1000));
      previousFrameTime = now;

      applyLightingSettings();

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

      // Small idle motions keep both figures alive without competing with the
      // hand and arm choreography. The motion is intentionally restrained so
      // the chessboard remains the visual focus.
      const playerEngagement = grabbedPieceSquare
        ? 1
        : handActiveRef.current
          ? activeGesture === "palm"
            ? 0.7
            : activeGesture === "fist"
              ? 0.9
              : 0.35
          : 0;
      const robotEngagement = robotAnim ? 1 : playerEngagement * 0.72;
      interactionTarget.set(
        finger3dRef.current?.x ?? 0,
        1.65,
        finger3dRef.current?.z ?? 0,
      );
      if (grabbedPieceSquare) {
        interactionTarget.copy(squareToPosition(grabbedPieceSquare));
        interactionTarget.y = 1.8;
      }
      humanFocusTarget.set(
        THREE.MathUtils.clamp(interactionTarget.x * 0.038, -0.22, 0.22),
        THREE.MathUtils.clamp(-interactionTarget.z * 0.018, -0.08, 0.08),
        0,
      );
      robotFocusTarget.set(
        THREE.MathUtils.clamp(-interactionTarget.x * 0.032, -0.18, 0.18),
        THREE.MathUtils.clamp(-interactionTarget.z * 0.014, -0.06, 0.06),
        0,
      );
      const humanBreath = Math.sin(now * 0.00155);
      humanIdle.torso.rotation.z = humanBreath * 0.008;
      humanIdle.chest.position.y = 1.44 + humanBreath * 0.006;
      humanIdle.head.rotation.y = humanBreath * 0.018 + humanFocusTarget.x * playerEngagement;
      humanIdle.head.rotation.x = humanFocusTarget.y * playerEngagement;
      humanIdle.head.rotation.z = Math.sin(now * 0.0011) * 0.008;
      humanIdle.jaw.rotation.z = Math.sin(now * 0.0013) * 0.004 + playerEngagement * 0.012;
      humanIdle.hair.rotation.y = humanBreath * 0.012;
      const blinkPhase = Math.sin(now * 0.00118);
      const blink = Math.abs(blinkPhase) > 0.985 ? 0.12 : 1;
      humanIdle.eyeL.scale.y = 0.68 * blink;
      humanIdle.eyeR.scale.y = 0.68 * blink;

      const robotBreath = Math.sin(now * 0.00125);
      robotIdle.torso.rotation.z = robotBreath * 0.006;
      robotIdle.head.rotation.y = Math.sin(now * 0.0009) * 0.014 + robotFocusTarget.x * robotEngagement;
      robotIdle.head.rotation.x = robotFocusTarget.y * robotEngagement;
      robotIdle.head.rotation.z = robotBreath * 0.006;
      robotIdle.chestCore.scale.setScalar(1 + Math.sin(now * 0.004) * 0.08);
      robotIdle.chestCoreRing.rotation.z += deltaSeconds * 0.45;
      robotIdle.antennaBall.scale.setScalar(1 + Math.sin(now * 0.005) * 0.08);
      const robotVisorMaterial = (robotIdle.visor as THREE.Mesh).material as THREE.MeshStandardMaterial;
      robotVisorMaterial.emissiveIntensity = 1.15 + Math.sin(now * 0.003) * 0.18 + robotEngagement * 0.32;
      interactionLight.position.lerpVectors(
        interactionLightOrigin,
        interactionTarget,
        Math.min(1, deltaSeconds * 4),
      );
      interactionLight.intensity = robotEngagement * (0.38 + Math.sin(now * 0.006) * 0.08) * lightingSettingsRef.current.strength;
      humanLight.intensity = (LIGHTING_PRESETS[lightingSettingsRef.current.preset].humanIntensity + playerEngagement * 0.18) * lightingSettingsRef.current.strength;
      robotLight.intensity = (LIGHTING_PRESETS[lightingSettingsRef.current.preset].robotIntensity + robotEngagement * 0.2) * lightingSettingsRef.current.strength;

      // Machine core energy and active-piece trails use the same pooled field.
      if (now - lastCoreParticleAt > 72) {
        lastCoreParticleAt = now;
        coreParticleOrigin.set(0, 1.82, 0.59);
        robot.localToWorld(coreParticleOrigin);
        particleField.emit(coreParticleOrigin, 0x67e8f9, 2, 0.12, 0.28, 0.55, 0.05);
      }
      if (now - lastActivePieceParticleAt > 58) {
        lastActivePieceParticleAt = now;
        if (robotAnim?.piece && robotAnim.attached) {
          particleOrigin.copy(robotAnim.piece.position);
          particleOrigin.y += 0.22;
          particleField.emit(particleOrigin, 0x22d3ee, 1, 0.08, 0.18, 0.35, -0.05);
        } else if (gestureAnim) {
          particleOrigin.copy(gestureAnim.piece.position);
          particleOrigin.y += 0.22;
          particleField.emit(particleOrigin, 0x34d399, 1, 0.08, 0.18, 0.35, -0.08);
        } else if (grabbedPieceGroup && grabbedPieceSquare) {
          particleOrigin.copy(grabbedPieceGroup.position);
          particleOrigin.y += 0.24;
          particleField.emit(particleOrigin, 0xfbbf24, 1, 0.08, 0.15, 0.3, -0.08);
        }
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
        grabbedPieceSquare ? -0.12 : activeGesture === "palm" ? 0.02 : 0.08,
        1 - Math.exp(-8 * deltaSeconds),
      );
      humanHand.rotation.x = THREE.MathUtils.lerp(
        humanHand.rotation.x,
        activeGesture === "palm" ? -0.12 : grabbedPieceSquare ? 0.16 : 0,
        1 - Math.exp(-7 * deltaSeconds),
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
          playServoSound(0.42);
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
            playServoSound(0.62);
            particleOrigin.set(framePos.x, 0.95, framePos.z);
            particleField.emit(particleOrigin, 0x67e8f9, 8, 0.18, 0.55, 0.42, -0.18);
          }
          if (!cp1.carry && a.attached && a.piece) {
            a.piece.position.copy(a.dropPos);
            a.attached = false;
            playServoSound(0.72);
            particleOrigin.copy(a.dropPos);
            particleOrigin.y = 0.28;
            particleField.burst(particleOrigin, 0x22d3ee, 22);
            playPlacementSound(false);
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

      particleField.update(deltaSeconds);
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
      audioUnlockRef.current = () => {};
      if (audioContext) void audioContext.close();
      audioContext = null;
      audioMasterGain = null;
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
        <div className="absolute top-52 right-4 z-20 w-52 rounded-lg border border-cyan-500/30 bg-black/60 p-3 text-xs text-zinc-200 backdrop-blur-sm shadow-xl light:bg-white/90 light:border-cyan-300 light:text-slate-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold tracking-wide">Live AI arena</span>
            <span className={`text-[10px] uppercase tracking-wider ${liveAiMode === "off" ? "text-zinc-500" : "text-emerald-300"}`}>{liveAiMode === "off" ? "Manual" : "Live"}</span>
          </div>
          <label className="mb-2 block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-400 light:text-slate-500">Decision engine</span>
            <select
              id="live-ai-algorithm"
              value={liveAiMode}
              onChange={(event) => onLiveAiModeChange?.(event.target.value as "off" | "minimax" | "mcts")}
              className="w-full rounded border border-zinc-600 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-100 outline-none light:border-slate-300 light:bg-white light:text-slate-800"
            >
              <option value="off">Manual play</option>
              <option value="minimax">Minimax</option>
              <option value="mcts">MCTS</option>
            </select>
          </label>
          <label className="mb-3 block">
            <span className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-zinc-400 light:text-slate-500"><span>Search depth</span><span className="font-mono text-cyan-300">{liveAiDepth}</span></span>
            <input id="live-ai-depth" type="range" min="1" max="6" value={liveAiDepth} onChange={(event) => onLiveAiDepthChange?.(Number(event.target.value))} className="w-full accent-cyan-400" />
          </label>
          <div className="mb-3 border-t border-zinc-700/60 pt-2 text-[10px] text-zinc-500 light:border-slate-200">{liveAiMode === "off" ? "Use pointer or hand gestures to play." : `Both sides will alternate ${liveAiMode} decisions.`}</div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold tracking-wide">Scene lighting</span>
            <span className="text-[10px] uppercase tracking-wider text-cyan-300 light:text-cyan-700">Live</span>
          </div>
          <label className="mb-2 block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-400 light:text-slate-500">Preset</span>
            <select
              id="lighting-preset"
              value={lightingPreset}
              onChange={(event) => {
                const next = event.target.value as LightingPresetName;
                setLightingPreset(next);
                setStatusMessage(`Lighting preset: ${next}`);
              }}
              className="w-full rounded border border-zinc-600 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-100 outline-none light:border-slate-300 light:bg-white light:text-slate-800"
            >
              <option value="studio">Studio</option>
              <option value="warm">Warm gallery</option>
              <option value="cool">Cool rim</option>
              <option value="dramatic">Dramatic</option>
            </select>
          </label>
          <label className="mb-2 block">
            <span className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-zinc-400 light:text-slate-500">
              <span>Intensity</span>
              <span>{lightingStrength.toFixed(1)}×</span>
            </span>
            <input
              id="lighting-intensity"
              type="range"
              min="0.55"
              max="1.35"
              step="0.05"
              value={lightingStrength}
              onChange={(event) => setLightingStrength(Number(event.target.value))}
              className="w-full accent-cyan-400"
            />
          </label>
          <label className="flex items-center justify-between text-[11px]">
            <span>Contact shadows</span>
            <input
              id="lighting-shadows"
              type="checkbox"
              checked={shadowsEnabled}
              onChange={(event) => setShadowsEnabled(event.target.checked)}
              className="accent-cyan-400"
            />
          </label>
          <label className="mt-2 flex items-center justify-between text-[11px]">
            <span>Mechanical audio</span>
            <input
              id="mechanical-audio"
              type="checkbox"
              checked={soundEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setSoundEnabled(enabled);
                if (enabled) audioUnlockRef.current();
              }}
              className="accent-cyan-400"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
