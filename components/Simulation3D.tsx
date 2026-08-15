"use client";

import { Chess, Square } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import GameInfo from "@/components/GameInfo";
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
type Gesture = "none" | "fist" | "palm";

const BOARD_SIZE = 8;
const SQUARE_SIZE = 1;
const BOARD_OFFSET = (BOARD_SIZE - 1) * SQUARE_SIZE / 2;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// Reusable temporaries so the per-frame animation loop and the hand-detection
// path never allocate garbage — allocations there cause GC hitches and frame
// drops while the WebGL scene renders.
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
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

function createRobot(): THREE.Group {
  const group = new THREE.Group();

  const place = (o: THREE.Object3D, x: number, y: number, z: number) => {
    o.position.set(x, y, z);
    return o;
  };

  // Horizontal torus ring helper (gasket / seam / collar) — torus major
  // axis spins into the XZ plane so the ring hugs a cylinder's waist.
  const ring = (radius: number, tube: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 24), mat);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, y, z);
    return t;
  };

  // Straight cable/bracket between two world-frame points (construction-time
  // only, so it may allocate freely).
  const _cDir = new THREE.Vector3();
  const _cMid = new THREE.Vector3();
  const _cUp = new THREE.Vector3(0, 1, 0);
  const _cQ = new THREE.Quaternion();
  const cable = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rad: number, mat: THREE.Material) => {
    _cDir.set(x1 - x0, y1 - y0, z1 - z0);
    const len = _cDir.length();
    _cMid.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 8), mat);
    m.position.copy(_cMid);
    if (len > 0.0001) m.quaternion.copy(_cQ.setFromUnitVectors(_cUp, _cDir.normalize()));
    return m;
  };

  // Painted outer armour — cool grey clearcoat that picks up the studio env
  const hullMat = new THREE.MeshPhysicalMaterial({
    color: 0xd7dfe7,
    metalness: 0.35,
    roughness: 0.38,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
  });
  // Secondary mid-tone armour (distinct panel zones so the torso reads layered)
  const midMat = new THREE.MeshPhysicalMaterial({
    color: 0xb8c3cf,
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.28,
  });
  // Machined dark-trim housings and joint covers
  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x1a2430,
    roughness: 0.42,
    metalness: 0.45,
  });
  // Dark recessed panel filler (vents, seams, slots)
  const recessMat = new THREE.MeshStandardMaterial({
    color: 0x0e1620,
    roughness: 0.55,
    metalness: 0.3,
  });
  // Brushed/machined steel — bright metallic, grabs IBL highlights
  const steelMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfccd8,
    metalness: 0.95,
    roughness: 0.2,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xae8a4a,
    metalness: 0.82,
    roughness: 0.3,
  });
  // Exposed rubber seals and cable sleeving
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x0a0e13,
    roughness: 0.9,
    metalness: 0.02,
  });
  // Cyan status LEDs — status lighting on the machine, kept as scattered accents
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x8be7ff,
    emissive: 0x22d3ee,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.1,
  });
  // Gripper pod: dark teal housing that lights cyan when carrying a piece
  // (emissiveIntensity animated externally between 0.15 and 0.7)
  const handMat = new THREE.MeshPhysicalMaterial({
    color: 0x155e75,
    emissive: 0x2adcf5,
    emissiveIntensity: 0.15,
    metalness: 0.4,
    roughness: 0.24,
    clearcoat: 1.0,
    clearcoatRoughness: 0.2,
  });

  // Shared small-part geometries (reused across many meshes)
  const boltGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.05, 10);
  const hexGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.026, 6);
  const slatGeo = new THREE.BoxGeometry(0.07, 0.012, 0.02);
  const studGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.03, 10);

  // ---- Pedestal: hex mount plate, rubber isolator, armour plate, glow skirt ----
  const mountPlate = place(new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.78, 0.09, 6), darkTrimMat), 0, 0.05, 0);
  mountPlate.rotation.y = Math.PI / 6;
  const mountSeal = ring(0.72, 0.03, rubberMat, 0, 0.085, 0);
  const mountTop = place(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.66, 0.06, 28), hullMat), 0, 0.13, 0);
  const mountFlange = ring(0.63, 0.02, steelMat, 0, 0.155, 0);
  const mountRim = place(new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.018, 8, 30), glowMat), 0, 0.105, 0);
  mountRim.rotation.x = Math.PI / 2;
  const bolts: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const b = new THREE.Mesh(boltGeo, brassMat);
    place(b, Math.cos(a) * 0.76, 0.135, Math.sin(a) * 0.76);
    b.rotation.y = Math.PI / 6;
    bolts.push(b);
  }

  // ---- Legs: hip ball, gasketed knee, thigh piston, shin guard, booted foot ----
  const legAssembly = (x: number, side: number): THREE.Object3D[] => {
    const parts: THREE.Object3D[] = [];
    parts.push(place(new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 12), darkTrimMat), x, 1.04, 0));
    parts.push(ring(0.16, 0.022, rubberMat, x, 1.07, 0));
    const thigh = place(new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.155, 0.44, 18), hullMat), x, 0.79, 0);
    parts.push(thigh);
    // Front thigh armour plate + hex greeble
    parts.push(place(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.05), midMat), x, 0.79, 0.1));
    parts.push(place(new THREE.Mesh(hexGeo, brassMat), x, 0.9, 0.115));
    // Knee ball, rubber gasket and brass collar
    parts.push(place(new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10), darkTrimMat), x, 0.56, 0));
    parts.push(ring(0.11, 0.016, rubberMat, x, 0.56, 0));
    parts.push(ring(0.098, 0.012, brassMat, x, 0.56, 0));
    // Hydraulic knee piston hugging the outer flank
    parts.push(cable(x + 0.16 * side, 1.02, 0, x + 0.19 * side, 0.58, 0, 0.028, steelMat));
    parts.push(place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.09), recessMat), x + 0.2 * side, 1.02, 0));
    parts.push(place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.09), recessMat), x + 0.23 * side, 0.58, 0));
    // Shin taper + guard plate
    parts.push(place(new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.11, 0.36, 16), darkTrimMat), x, 0.37, 0));
    parts.push(place(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.04), midMat), x, 0.37, 0.085));
    // Ankle actuator + seal
    parts.push(place(new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 10), hullMat), x, 0.175, 0.05));
    parts.push(ring(0.085, 0.016, rubberMat, x, 0.145, 0.05));
    // Booted foot: heel, toe cap, sole and an ankle status LED
    const foot = place(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.44), hullMat), x, 0.12, 0.09);
    parts.push(foot);
    parts.push(place(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.09), steelMat), x, 0.09, 0.3));
    parts.push(place(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.46), rubberMat), x, 0.06, 0.09));
    parts.push(place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.02), glowMat), x, 0.2, 0.34));
    return parts;
  };
  const legL = legAssembly(-0.34, -1);
  const legR = legAssembly(0.34, 1);

  // ---- Pelvis: broad housing, rubber harness, front armour + belt LEDs ----
  const pelvis = place(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.34, 20), darkTrimMat), 0, 1.12, 0);
  const hipBand = ring(0.5, 0.032, rubberMat, 0, 0.98, 0);
  const pelvisPlate = place(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), midMat), 0, 1.28, 0.42);
  const beltBuckle = place(new THREE.Mesh(hexGeo, brassMat), 0, 1.24, 0.455);
  const beltLed = place(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.014, 0.02), glowMat), 0, 1.22, 0.46);
  const pelvisBack = place(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.08), recessMat), 0, 1.2, -0.43);

  // ---- Torso: broad-chested lathe hull + panel seams + chest reactor ----
  const torsoProfile = [
    new THREE.Vector2(0.28, 0),
    new THREE.Vector2(0.44, 0.08),
    new THREE.Vector2(0.47, 0.16),
    new THREE.Vector2(0.4, 0.28),
    new THREE.Vector2(0.345, 0.42),
    new THREE.Vector2(0.35, 0.52),
    new THREE.Vector2(0.46, 0.7),
    new THREE.Vector2(0.48, 0.86),
    new THREE.Vector2(0.42, 0.98),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 28), hullMat);
  torso.position.y = 1.0;
  const seamA = ring(0.36, 0.014, recessMat, 0, 1.22, 0);
  const seamB = ring(0.46, 0.014, recessMat, 0, 1.62, 0);
  const waistBand = ring(0.42, 0.03, brassMat, 0, 1.38, 0);
  // Chest armour plate with brass stud flange
  const chestPlate = place(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.1), midMat), 0, 1.64, 0.375);
  const chestBoltL = place(new THREE.Mesh(studGeo, brassMat), -0.2, 1.64, 0.4);
  const chestBoltR = place(new THREE.Mesh(studGeo, brassMat), 0.2, 1.64, 0.4);
  // Cyan reactor core under the breastplate
  const coreCap = place(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 18), steelMat), 0, 1.58, 0.44);
  const coreRing = ring(0.062, 0.012, glowMat, 0, 1.58, 0.48);
  const coreDot = place(new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), glowMat), 0, 1.58, 0.5);

  // ---- Dorsal backpack + twin neck cable runs ----
  const packBox = place(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.22), darkTrimMat), 0, 1.66, -0.4);
  const packCover = place(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.18), hullMat), 0, 1.93, -0.4);
  const packGlow = place(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.018, 0.02), glowMat), 0, 1.9, -0.52);
  for (let i = 0; i < 3; i++) {
    place(new THREE.Mesh(slatGeo, recessMat), 0, 1.62 + i * 0.06, -0.53);
  }
  const hoseL = cable(-0.15, 2.06, -0.13, -0.15, 1.9, -0.4, 0.028, rubberMat);
  const hoseR = cable(0.15, 2.06, -0.13, 0.15, 1.9, -0.4, 0.028, rubberMat);
  // Bulkhead fittings where the hoses dock
  for (const sign of [-1, 1]) {
    place(new THREE.Mesh(studGeo, brassMat), sign * 0.15, 2.07, -0.13);
    place(new THREE.Mesh(studGeo, brassMat), sign * 0.15, 1.88, -0.4);
  }

  // ---- Neck: articulated vertebrae with rubber crush rings ----
  const neckCollar = ring(0.13, 0.035, rubberMat, 0, 2.0, 0);
  const neckSeg1 = place(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 14), darkTrimMat), 0, 2.08, 0);
  const neckRing1 = ring(0.105, 0.014, rubberMat, 0, 2.13, 0);
  const neckSeg2 = place(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.1, 14), hullMat), 0, 2.19, 0);
  const neckRing2 = ring(0.09, 0.014, rubberMat, 0, 2.24, 0);
  const neckSeg3 = place(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.08, 12), darkTrimMat), 0, 2.29, 0);
  const throatPlate = place(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.03), midMat), 0, 2.18, 0.13);

  // ---- Layered head: skull, brow + visor, cheek vents, jaw, ears, antenna ----
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.31, 26, 20), hullMat);
  skull.scale.set(1, 0.9, 1.05);
  skull.position.set(0, 2.47, 0);
  const skullSeam = ring(0.27, 0.01, recessMat, 0, 2.47, -0.02);
  // Dark brow arc capping the eyes; cyan vision band beneath
  const brow = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.024, 8, 26, Math.PI * 1.2), darkTrimMat);
  brow.rotation.x = Math.PI / 2;
  brow.position.set(0, 2.58, 0.0);
  const visor = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 24, Math.PI * 1.05), glowMat);
  visor.rotation.x = Math.PI / 2;
  visor.position.set(0, 2.53, 0.05);
  // Mid-face plate and cheek vents
  const nosePad = place(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.02), midMat), 0, 2.45, 0.33);
  const cheekL = place(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.035), midMat), -0.25, 2.34, 0.27);
  const cheekR = place(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.035), midMat), 0.25, 2.34, 0.27);
  const ventL = place(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.025), recessMat), -0.25, 2.31, 0.3);
  const ventR = place(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.025), recessMat), 0.25, 2.31, 0.3);
  // Jaw block with chin grill and a lit mouth slit
  const jaw = place(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.14), hullMat), 0, 2.28, 0.18);
  const chinVent = place(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), recessMat), 0, 2.27, 0.25);
  const mouthLed = place(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.014, 0.02), glowMat), 0, 2.34, 0.26);
  const throatBlock = place(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.16), darkTrimMat), 0, 2.12, 0.11);
  // Ear pods: housing, rubber gasket, glow dot (mirrored)
  const earHousing = new THREE.CylinderGeometry(0.045, 0.06, 0.16, 12);
  const earR = place(new THREE.Mesh(earHousing, midMat), 0.35, 2.42, 0);
  earR.rotation.z = Math.PI / 2;
  const earRg = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.013, 8, 16), rubberMat);
  earRg.rotation.y = Math.PI / 2;
  earRg.position.set(0.34, 2.34, 0);
  const earRl = place(new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), glowMat), 0.44, 2.42, 0);
  const earL = earR.clone();
  earL.position.x = -0.35;
  const earLg = earRg.clone();
  earLg.position.x = -0.34;
  const earLl = earRl.clone();
  earLl.position.x = -0.44;
  // Dorsal fin, antenna + tip
  const skullFin = place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.03), darkTrimMat), 0, 2.7, -0.08);
  const antenna = place(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.15, 8), darkTrimMat), 0, 2.83, 0);
  antenna.rotation.z = 0.12;
  const antennaTip = place(new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), glowMat), 0.035, 2.96, 0);

  // ---- Shoulder pauldrons: layered shells + status LED strips ----
  const padShellR = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), darkTrimMat);
  padShellR.scale.set(0.92, 0.5, 1.25);
  padShellR.position.set(0.62, 2.06, 0);
  const padTopR = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), midMat);
  padTopR.scale.set(0.9, 0.42, 1.2);
  const padLedR = place(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.02), glowMat), 0.62, 2.14, 0.09);
  const padShellL = padShellR.clone();
  padShellL.position.x = -0.62;
  const padTopL = padTopR.clone();
  padTopL.position.set(-0.62, 2.12, 0);
  const padLedL = padLedR.clone();
  padLedL.position.x = -0.62;
  padTopR.position.set(0.62, 2.12, 0);

  // ---- Right shoulder socket pivot (driven arm grows from here) ----
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.62, 1.92, 0);
  const sockBall = place(new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), steelMat), 0, 0, 0);
  const sockGasket = ring(0.13, 0.045, rubberMat, 0, 0.0, 0);
  const sockCollar = place(new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.175, 0.12, 18), darkTrimMat), 0, 0.02, -0.08);
  const sockBrass = ring(0.165, 0.016, brassMat, 0, -0.07, -0.06);
  shoulder.add(sockBall, sockGasket, sockCollar, sockBrass);

  // Telescoping boom: the animate loop scales this subtree along local +Y and
  // aims it at the hand, so it must stay a unit, origin-centered, Y-aligned rod.
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 1.0, 16), steelMat);
  armMesh.position.copy(shoulder.position);

  // Four-stage telescoping sleeves (thick near the shoulder, tapering toward
  // the pod) with rubber/brass collar rings and a glowing inner energy rail.
  const boomBase = place(new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.13, 0.32, 20), darkTrimMat), 0, -0.3, 0);
  const boomBaseRing = ring(0.115, 0.018, rubberMat, 0, -0.16, 0);
  const boomStage2 = place(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 0.28, 18), steelMat), 0, -0.03, 0);
  const stage2Ring = ring(0.08, 0.014, brassMat, 0, 0.09, 0);
  const boomMid = place(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.24, 16), hullMat), 0, 0.22, 0);
  const midRing = ring(0.065, 0.016, rubberMat, 0, 0.32, 0);
  const boomTip = place(new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.07, 0.2, 16), darkTrimMat), 0, 0.42, 0);
  const tipCap = place(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.08, 16), hullMat), 0, 0.55, 0);
  const boomLed = place(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.6, 8), glowMat), 0, 0.18, 0);
  armMesh.add(boomBase, boomBaseRing, boomStage2, stage2Ring, boomMid, midRing, boomTip, tipCap, boomLed);

  const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.13, 0.12, 20), handMat);
  hand.position.set(0.62, 1.5, 0.6);
  // Gripper pod: cyan-lit housing (handMat) sealed by a rubber band, brass top
  // rim and a folded throat; six rim bolts plus a hold LED on the board side.
  const podRing = ring(0.12, 0.016, rubberMat, 0, 0.02, 0);
  const podTopRing = ring(0.105, 0.012, brassMat, 0, 0.065, 0);
  const throatSeal = ring(0.16, 0.022, rubberMat, 0, -0.14, 0);
  const throatBellows = ring(0.15, 0.015, darkTrimMat, 0, -0.2, 0);
  const holdLed = place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.02), glowMat), 0, -0.04, 0.31);
  // Rim bolt studs pinning the pod cap to the housing
  const podBolts: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    const b = new THREE.Mesh(studGeo, brassMat);
    place(b, Math.cos(a) * 0.135, -0.02, Math.sin(a) * 0.135);
    podBolts.push(b);
  }

  // ---- Finger lattice: shared scratch math + part builders ----
  const _gUp = new THREE.Vector3(0, 1, 0);
  const _gQ = new THREE.Quaternion();
  const _gDir = new THREE.Vector3();
  const _gTan = new THREE.Vector3();

  // Turn a splay ratio (horizontal lean per unit of drop) into a downward
  // unit vector angled out along `az`, so fingers can flare, re-cup, hook.
  const _splay = (h: number, az: number, out: THREE.Vector3) => {
    out.set(Math.cos(az) * h, -1, Math.sin(az) * h).normalize();
  };

  // Tapered phalanx link, oriented so its axis runs along `dir` from the root
  // toward the fingertip (rTop is the root-end, larger, radius).
  const link = (
    rTop: number,
    rBot: number,
    len: number,
    px: number,
    py: number,
    pz: number,
    dir: THREE.Vector3,
    mat: THREE.Material,
  ): THREE.Mesh => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 8), mat);
    l.position.set(px, py, pz);
    _gQ.setFromUnitVectors(_gUp, dir);
    l.quaternion.copy(_gQ);
    return l;
  };

  // Rubber gasket disc wrapped around a knuckle, square to the finger axis.
  const knuckleCollar = (
    radius: number,
    tube: number,
    mat: THREE.Material,
    px: number,
    py: number,
    pz: number,
    dir: THREE.Vector3,
  ): THREE.Mesh => {
    const c = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 14), mat);
    c.position.set(px, py, pz);
    _gQ.setFromUnitVectors(_gUp, dir);
    c.quaternion.copy(_gQ);
    return c;
  };

  // Steel cross-pin driven through a knuckle, tangent to the grasp circle.
  const knucklePin = (
    radius: number,
    len: number,
    mat: THREE.Material,
    px: number,
    py: number,
    pz: number,
    az: number,
  ): THREE.Mesh => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), mat);
    p.position.set(px, py, pz);
    _gTan.set(-Math.sin(az), 0, Math.cos(az));
    _gQ.setFromUnitVectors(_gUp, _gTan);
    p.quaternion.copy(_gQ);
    return p;
  };

  // Thin hydraulic run bolted to the dorsal (outer) face of a finger link.
  const dorsalCable = (
    px: number,
    py: number,
    pz: number,
    len: number,
    dir: THREE.Vector3,
    mat: THREE.Material,
  ): THREE.Mesh => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, len, 6), mat);
    c.position.set(px, py, pz);
    _gQ.setFromUnitVectors(_gUp, dir);
    c.quaternion.copy(_gQ);
    return c;
  };

  // Per-finger spec. Everything is hand-tuned against the runtime contracts:
  // the carried piece's foot (radius ~0.36) sits at local (0,-1.1,0) in carry
  // and (0,-0.7,0) in grab, and the piece's pillar rises up through the pod, so
  // every link must stay OUTSIDE 0.36 for the whole drop down to the cradle.
  type FingerSpec = {
    az: number;                       // azimuth around the grasp axis (radians)
    r0: number;                       // root offset from the axis (pod rim)
    y0: number;                       // root height just under the pod
    lens: [number, number, number];   // proximal / middle / distal lengths
    splays: [number, number, number]; // per-segment outward lean
    rads: [number, number, number];   // per-segment root thickness (tapering)
    jointR: number;                   // knuckle sphere radius
    tipR: number;                     // steel fingertip radius
    mat: THREE.Material;              // phalanx material
    padMat: THREE.Material;           // rubber fingertip cap material
    pinMat: THREE.Material;           // knuckle cross-pin material
    cableMat: THREE.Material;         // dorsal hydraulic material
    cables?: boolean;                 // dorsal runs on the first two links
    curl?: number;                    // how hard the fingertip hooks inward
  };

  // Three-segment finger: tapered links, knuckle spheres + rubber gasket
  // collars + tangent cross-pins, optional dorsal hydraulic runs, and a
  // rounded steel tip capped by a darker rubber pad aimed at the grasp axis.
  const articulatedFinger = (cfg: FingerSpec): THREE.Object3D[] => {
    const parts: THREE.Object3D[] = [];
    const az = cfg.az;
    const cosA = Math.cos(az);
    const sinA = Math.sin(az);
    let dist = cfg.r0;
    let y = cfg.y0;
    for (let i = 0; i < 3; i++) {
      _splay(cfg.splays[i], az, _gDir);
      const len = cfg.lens[i];
      const rTop = cfg.rads[i];
      const rBot = cfg.rads[Math.min(i + 1, 2)];
      // Link centered at its segment midpoint, oriented along `_gDir`.
      const mx = cosA * dist + _gDir.x * (len / 2);
      const my = y + _gDir.y * (len / 2);
      const mz = sinA * dist + _gDir.z * (len / 2);
      parts.push(link(rTop, rBot, len, mx, my, mz, _gDir, cfg.mat));
      if (cfg.cables && i < 2) {
        // Dorsal hydraulic run hugging the outer face of the link.
        parts.push(dorsalCable(mx + cosA * (rTop + 0.008), my, mz + sinA * (rTop + 0.008), len, _gDir, cfg.cableMat));
      }
      dist += _gDir.x * len;
      y += _gDir.y * len;
      if (i < 2) {
        const kx = cosA * dist;
        const kz = sinA * dist;
        const kn = new THREE.Mesh(new THREE.SphereGeometry(cfg.jointR, 10, 8), cfg.mat);
        kn.position.set(kx, y, kz);
        parts.push(kn);
        parts.push(knuckleCollar(cfg.jointR * 0.88, 0.008, rubberMat, kx, y, kz, _gDir));
        parts.push(knucklePin(0.011, 0.085, cfg.pinMat, kx, y, kz, az));
      }
    }
    // Rounded steel fingertip, nudged toward the grasp axis, capped below by a
    // darker rubber pad so each finger reads as gripping rather than a pin.
    const curl = cfg.curl ?? 0.015;
    const tipCx = cosA * (dist - curl);
    const tipCz = sinA * (dist - curl);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(cfg.tipR, 10, 8), cfg.mat);
    tip.position.set(tipCx, y, tipCz);
    parts.push(tip);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(cfg.tipR * 1.15, 10, 8), cfg.padMat);
    pad.position.set(tipCx, y - 0.018, tipCz);
    parts.push(pad);
    return parts;
  };

  // Four radial fingers deliberately differ in length, splay and thickness so
  // the hand reads as designed rather than a set of identical pins; a fifth,
  // shorter brass thumb opposes them on the board side (+Z).
  const fingerSpecs: FingerSpec[] = [
    { az: Math.PI / 4, r0: 0.21, y0: -0.05, lens: [0.33, 0.44, 0.36], splays: [0.22, 0.45, 0.18], rads: [0.034, 0.026, 0.019], jointR: 0.036, tipR: 0.021, mat: steelMat, padMat: rubberMat, pinMat: brassMat, cableMat: darkTrimMat, cables: true },
    { az: (3 * Math.PI) / 4, r0: 0.21, y0: -0.055, lens: [0.31, 0.43, 0.38], splays: [0.18, 0.46, 0.17], rads: [0.032, 0.024, 0.018], jointR: 0.034, tipR: 0.02, mat: steelMat, padMat: rubberMat, pinMat: brassMat, cableMat: darkTrimMat, cables: true },
    { az: (5 * Math.PI) / 4, r0: 0.21, y0: -0.045, lens: [0.32, 0.45, 0.38], splays: [0.22, 0.43, 0.19], rads: [0.033, 0.025, 0.018], jointR: 0.035, tipR: 0.02, mat: steelMat, padMat: rubberMat, pinMat: brassMat, cableMat: darkTrimMat },
    { az: (7 * Math.PI) / 4, r0: 0.21, y0: -0.05, lens: [0.33, 0.44, 0.37], splays: [0.19, 0.45, 0.16], rads: [0.031, 0.023, 0.017], jointR: 0.033, tipR: 0.019, mat: steelMat, padMat: rubberMat, pinMat: brassMat, cableMat: darkTrimMat },
    // Opposing brass thumb on the board side (+Z): shorter and thicker, hooked
    // inboard so it reads as the opposable digit rather than a fifth pin.
    { az: Math.PI / 2, r0: 0.22, y0: -0.04, lens: [0.28, 0.36, 0.3], splays: [0.18, 0.4, 0.22], rads: [0.038, 0.03, 0.022], jointR: 0.04, tipR: 0.024, mat: brassMat, padMat: rubberMat, pinMat: darkTrimMat, cableMat: brassMat, cables: true, curl: 0.04 },
  ];
  const handParts: THREE.Object3D[] = [];
  for (const spec of fingerSpecs) {
    handParts.push(...articulatedFinger(spec));
  }
  // Brass pallet ring the carried piece's foot settles onto, wrapped by the
  // fingertips just outside its outer rim (runs parallel to the grab plane).
  const cradlePallet = ring(0.44, 0.02, brassMat, 0, -1.12, 0);
  handParts.push(cradlePallet);

  hand.add(podRing, podTopRing, throatSeal, throatBellows, holdLed, ...podBolts, ...handParts);


  // ---- Static left arm: layered shoulder, two-joint arm with gaskets ----
  const armSockL = place(new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), darkTrimMat), -0.6, 1.96, 0);
  const upperL = place(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.44, 16), hullMat), -0.71, 1.76, 0.02);
  upperL.rotation.z = 0.16;
  const elbowL = place(new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), darkTrimMat), -0.78, 1.5, 0.05);
  const elbowLg = ring(0.095, 0.016, rubberMat, -0.78, 1.5, 0.05);
  const elbowBrass = ring(0.082, 0.012, brassMat, -0.78, 1.5, 0.05);
  const foreL = place(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.34, 14), darkTrimMat), -0.84, 1.28, 0.07);
  foreL.rotation.z = 0.22;
  const wristL = ring(0.062, 0.014, rubberMat, -0.87, 1.15, 0.08);
  const handL = place(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.1, 14), hullMat), -0.9, 1.06, 0.09);
  const lensL = place(new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), glowMat), -0.93, 1.04, 0.12);

  group.add(
    mountPlate, mountSeal, mountTop, mountFlange, mountRim, ...bolts,
    ...legL, ...legR,
    pelvis, hipBand, pelvisPlate, beltBuckle, beltLed, pelvisBack,
    torso, seamA, seamB, waistBand,
    chestPlate, chestBoltL, chestBoltR, coreCap, coreRing, coreDot,
    place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.12), recessMat), 0.3, 1.5, 0.05),
    place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.12), recessMat), -0.3, 1.5, 0.05),
    place(new THREE.Mesh(slatGeo, darkTrimMat), 0.3, 1.44, 0.09),
    place(new THREE.Mesh(slatGeo, darkTrimMat), 0.3, 1.495, 0.09),
    place(new THREE.Mesh(slatGeo, darkTrimMat), 0.3, 1.55, 0.09),
    place(new THREE.Mesh(slatGeo, darkTrimMat), -0.3, 1.44, 0.09),
    place(new THREE.Mesh(slatGeo, darkTrimMat), -0.3, 1.495, 0.09),
    place(new THREE.Mesh(slatGeo, darkTrimMat), -0.3, 1.55, 0.09),
    packBox, packCover, packGlow,
    place(new THREE.Mesh(slatGeo, recessMat), 0, 1.56, -0.53),
    place(new THREE.Mesh(slatGeo, recessMat), 0, 1.62, -0.53),
    place(new THREE.Mesh(slatGeo, recessMat), 0, 1.68, -0.53),
    hoseL, hoseR,
    place(new THREE.Mesh(studGeo, brassMat), -0.15, 2.07, -0.13),
    place(new THREE.Mesh(studGeo, brassMat), 0.15, 2.07, -0.13),
    place(new THREE.Mesh(studGeo, brassMat), -0.15, 1.88, -0.4),
    place(new THREE.Mesh(studGeo, brassMat), 0.15, 1.88, -0.4),
    neckCollar, neckSeg1, neckRing1, neckSeg2, neckRing2, neckSeg3, throatPlate,
    skull, skullSeam, brow, visor, nosePad, cheekL, cheekR, ventL, ventR,
    jaw, chinVent, mouthLed, throatBlock,
    earR, earRg, earRl, earL, earLg, earLl, skullFin, antenna, antennaTip,
    padShellR, padTopR, padLedR, padShellL, padTopL, padLedL,
    shoulder,
    armMesh,
    hand,
    armSockL, upperL, elbowL, elbowLg, elbowBrass, foreL, wristL, handL, lensL,
  );
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

  // Skin — warm, soft clearcoat so it reads as skin rather than plastic
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0xf0b48a,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.15,
    clearcoatRoughness: 0.4,
    sheen: 0.35,
    sheenColor: 0xe08a5a,
    sheenRoughness: 0.6,
  });
  // T-shirt — fabric sheen with a soft blue-grey sheen colour
  const shirtMat = new THREE.MeshPhysicalMaterial({
    color: 0x2563eb,
    roughness: 0.68,
    metalness: 0,
    clearcoat: 0.15,
    clearcoatRoughness: 0.7,
    sheen: 0.55,
    sheenColor: 0xd7e4ff,
    sheenRoughness: 0.5,
  });
  // Slightly darker shirt tone for fabric wrinkle / ribbing seams
  const shirtSeamMat = new THREE.MeshPhysicalMaterial({
    color: 0x1d4ed8,
    roughness: 0.75,
    metalness: 0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.8,
    sheen: 0.5,
    sheenColor: 0xbfd3f7,
    sheenRoughness: 0.55,
  });
  // Pants — slate denim, slightly rougher than the shirt
  const pantMat = new THREE.MeshPhysicalMaterial({
    color: 0x363c4a,
    roughness: 0.78,
    metalness: 0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.8,
    sheen: 0.45,
    sheenColor: 0xcbd6ea,
    sheenRoughness: 0.7,
  });
  // Subtle darker fabric for joint creases (knee seams)
  const seamMat = new THREE.MeshPhysicalMaterial({
    color: 0x2b3242,
    roughness: 0.85,
    metalness: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.9,
  });
  const shoeMat = new THREE.MeshPhysicalMaterial({
    color: 0x24272e,
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.6,
    sheen: 0.3,
    sheenColor: 0x9aa4b3,
  });
  // White sneaker sole + laces for a casual read
  const soleMat = new THREE.MeshPhysicalMaterial({
    color: 0xe9eef4,
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.6,
  });
  const sockMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f2f2,
    roughness: 0.85,
    metalness: 0,
    sheen: 0.5,
    sheenColor: 0xffffff,
    sheenRoughness: 0.7,
  });
  // Hair — low roughness with a touch of clearcoat for highlights
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: 0x36281a,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.25,
    sheen: 0.2,
    sheenColor: 0x8a6a4a,
    sheenRoughness: 0.4,
  });
  const eyeWhiteMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7f3ec,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
  });
  const irisMat = new THREE.MeshPhysicalMaterial({
    color: 0x2e3a52,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
  });
  // Small near-black glossy pupil that reads against the iris
  const pupilMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f1016,
    roughness: 0.15,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  });
  // Lips — small dark-tinted mesh so the mouth reads at this scale
  const lipMat = new THREE.MeshPhysicalMaterial({
    color: 0xb05a43,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    sheen: 0.3,
    sheenColor: 0xd97a5a,
    sheenRoughness: 0.6,
  });
  // Driven hand material — emissive tint kept for grab feedback
  const handMat = new THREE.MeshPhysicalMaterial({
    color: 0xf0b48a,
    emissive: 0xffa03a,
    emissiveIntensity: 0,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.15,
    clearcoatRoughness: 0.4,
    sheen: 0.35,
    sheenColor: 0xe08a5a,
    sheenRoughness: 0.6,
  });

  // Tapered limb segment running from a to b; geometry instance is passed in so
  // identical phalanges across fingers cost one buffer, not one per finger.
  const placeSeg = (
    geo: THREE.BufferGeometry,
    a: THREE.Vector3,
    b: THREE.Vector3,
    mat: THREE.Material,
  ): THREE.Mesh => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(geo, mat);
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };
  // A cylinder running from a point a to a point b, tapered from rWide (at a)
  // to rNarrow (at b) — used to build each curled, out-tapering phalanx.
  const seg = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    rNarrow: number,
    rWide: number,
    mat: THREE.Material,
  ): THREE.Mesh =>
    placeSeg(new THREE.CylinderGeometry(rNarrow, rWide, a.distanceTo(b), 10), a, b, mat);

  // Legs: articulated thigh, knee cap + crease seam, calf-tapered shin, ankle,
  // sock, and a rounded sneaker. zOff staggers the two feet for a natural stance.
  const legAssembly = (x: number, zOff: number) => {
    const items: THREE.Mesh[] = [];
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.105, 0.46, 16, 8), pantMat);
    thigh.position.set(x, 0.72, zOff);
    thigh.rotation.x = 0.07; // knee pushed slightly forward toward the board
    const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.102, 14, 10), pantMat);
    kneeCap.position.set(x, 0.485, -0.03 + zOff);
    const kneeSeam = new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.011, 6, 18), seamMat);
    kneeSeam.rotation.x = -Math.PI / 2;
    kneeSeam.position.set(x, 0.475, zOff);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.058, 0.42, 14, 8), pantMat);
    shin.position.set(x, 0.32, -0.005 + zOff);
    shin.rotation.x = 0.04; // calf bulges forward, ankle tapers in
    const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), pantMat);
    ankle.position.set(x, 0.11, -0.01 + zOff);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.06, 12), sockMat);
    sock.position.set(x, 0.135, zOff);
    items.push(thigh, kneeCap, kneeSeam, shin, ankle, sock);
    return items;
  };

  // Sneaker: pill sole, rounded toe/heel, ankle collar, tongue + criss-cross laces
  const footAssembly = (x: number, zOff: number) => {
    const items: THREE.Mesh[] = [];
    const sole = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.22, 4, 14), soleMat);
    sole.scale.set(1, 1, 0.22); // squash to a thin, wide pill (local Z becomes height)
    sole.rotation.x = Math.PI / 2;
    sole.position.set(x, 0.03, -0.05 + zOff);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.1, 0.26), shoeMat);
    upper.position.set(x, 0.095, -0.05 + zOff);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 10), shoeMat);
    toe.scale.set(0.7, 0.62, 0.85);
    toe.position.set(x, 0.09, -0.19 + zOff);
    const heel = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), shoeMat);
    heel.scale.set(0.78, 0.62, 0.7);
    heel.position.set(x, 0.095, 0.09 + zOff);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.103, 0.016, 6, 16), shoeMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(x, 0.145, 0.04 + zOff);
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.06), shoeMat);
    tongue.position.set(x, 0.145, -0.12 + zOff);
    const laceL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.02), soleMat);
    laceL.rotation.z = 0.35;
    laceL.position.set(x, 0.128, -0.07 + zOff);
    const laceR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.02), soleMat);
    laceR.rotation.z = -0.35;
    laceR.position.set(x, 0.128, -0.06 + zOff);
    items.push(sole, upper, toe, heel, collar, tongue, laceL, laceR);
    return items;
  };

  // Torso — lathe silhouette tapering from hips to a defined waist and
  // shoulders, wrapped in a pivot at the hips so it leans forward (-Z) toward
  // the board without dragging the feet.
  const torsoPivot = new THREE.Object3D();
  torsoPivot.position.set(0, 0.95, 0.01);
  torsoPivot.rotation.x = -0.04; // ~2.3° forward lean
  const torsoPts: THREE.Vector2[] = [
    new THREE.Vector2(0.26, 0.92),
    new THREE.Vector2(0.24, 0.99),
    new THREE.Vector2(0.272, 1.1),
    new THREE.Vector2(0.335, 1.26),
    new THREE.Vector2(0.372, 1.46),
    new THREE.Vector2(0.362, 1.6),
    new THREE.Vector2(0.285, 1.74),
    new THREE.Vector2(0.192, 1.83),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 24), shirtMat);
  torso.position.set(0, -0.95, 0);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.252, 0.258, 0.13, 18), pantMat);
  belt.position.y = 0.05;
  // Thin fabric wrinkle seams at the waist and chest
  const waistSeam = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.01, 6, 20), shirtSeamMat);
  waistSeam.rotation.x = Math.PI / 2;
  waistSeam.position.y = 0.17;
  const chestSeam = new THREE.Mesh(new THREE.TorusGeometry(0.375, 0.012, 6, 24), shirtSeamMat);
  chestSeam.rotation.x = Math.PI / 2;
  chestSeam.position.y = 0.55;
  torsoPivot.add(torso, belt, waistSeam, chestSeam);

  // Neck + collar and the whole head assembly, on a pivot so the head pitches
  // naturally forward toward the board.
  const headPivot = new THREE.Object3D();
  headPivot.position.set(0, 1.83, 0.03);
  headPivot.rotation.x = -0.05; // ~2.9° head pitch
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 14), skinMat);
  neck.position.y = 0.08;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.042, 8, 20), shirtMat);
  collar.rotation.x = -Math.PI / 2;
  const collarTop = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 18), shirtMat);
  collarTop.rotation.x = -Math.PI / 2;
  collarTop.position.y = 0.035;

  // Skull + jaw: rounded skull, a defined chin and a subtle jaw fill
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 26, 20), skinMat);
  skull.scale.set(1, 1.12, 0.96);
  skull.position.y = 0.29;
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), skinMat);
  chin.scale.set(0.9, 0.75, 1.1);
  chin.position.set(0, 0.145, -0.1);

  // Nose: forward-tilted bridge + rounded tip
  const noseBridge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.075, 8), skinMat);
  noseBridge.rotation.x = -0.6;
  noseBridge.position.set(0, 0.305, -0.15);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), skinMat);
  noseTip.scale.set(0.72, 1.05, 0.8);
  noseTip.position.set(0, 0.27, -0.205);

  // Brows — dark tufts over the eyes
  const browR = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), hairMat);
  browR.scale.set(1.15, 0.4, 0.5);
  browR.position.set(0.068, 0.37, -0.19);
  const browL = browR.clone();
  browL.position.x = -0.068;

  // Eyes: sclera + iris + glossy pupil, all facing -Z
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), eyeWhiteMat);
  eyeR.position.set(0.07, 0.335, -0.178);
  const eyeL = eyeR.clone();
  eyeL.position.x = -0.07;
  const irisR = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), irisMat);
  irisR.position.set(0.07, 0.335, -0.205);
  const irisL = irisR.clone();
  irisL.position.x = -0.07;
  const pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), pupilMat);
  pupilR.position.set(0.07, 0.335, -0.212);
  const pupilL = pupilR.clone();
  pupilL.position.x = -0.07;

  // Lips — two small overlapping meshes
  const lipUpper = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), lipMat);
  lipUpper.scale.set(1, 0.42, 0.75);
  lipUpper.position.set(0, 0.203, -0.17);
  const lipLower = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), lipMat);
  lipLower.scale.set(0.9, 0.4, 0.7);
  lipLower.position.set(0, 0.186, -0.169);

  // Ears — cupped ovals on the sides
  const earR = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), skinMat);
  earR.scale.set(0.4, 0.85, 0.5);
  earR.position.set(0.203, 0.27, 0.015);
  const earL = earR.clone();
  earL.position.x = -0.203;

  // Hair — layered volume: a full cap dome, a swept crown, an off-centre
  // fringe (side part), temple volume and a nape layer, all standing a little
  // off the scalp so it reads as hair thickness rather than paint.
  const hairDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.218, 26, 14, 0, Math.PI * 2, 0, 1.7),
    hairMat,
  );
  hairDome.position.set(0, 0.4, 0.02);
  const hairSweep = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 14), hairMat);
  hairSweep.scale.set(1.18, 0.5, 0.9);
  hairSweep.position.set(0, 0.44, -0.025);
  const hairFringe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), hairMat);
  hairFringe.scale.set(0.9, 0.55, 0.7);
  hairFringe.position.set(0.025, 0.42, -0.075);
  const hairFringeSide = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10), hairMat);
  hairFringeSide.scale.set(0.7, 0.5, 0.7);
  hairFringeSide.position.set(-0.045, 0.4, -0.03);
  const hairSideR = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), hairMat);
  hairSideR.position.set(0.205, 0.4, 0.02);
  const hairSideL = hairSideR.clone();
  hairSideL.position.x = -0.205;
  const hairNape = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), hairMat);
  hairNape.scale.set(0.9, 0.6, 0.9);
  hairNape.position.set(0, 0.335, 0.16);
  headPivot.add(
    neck,
    collar,
    collarTop,
    skull,
    chin,
    noseBridge,
    noseTip,
    browR,
    browL,
    eyeR,
    eyeL,
    irisR,
    irisL,
    pupilR,
    pupilL,
    lipUpper,
    lipLower,
    earR,
    earL,
    hairDome,
    hairSweep,
    hairFringe,
    hairFringeSide,
    hairSideR,
    hairSideL,
    hairNape,
  );

  // Deltoids — rounded shoulder caps the arms pivot off
  const deltoidR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), shirtMat);
  deltoidR.scale.set(1.05, 0.92, 0.9);
  deltoidR.position.set(0.42, 1.8, 0.03);
  const deltoidL = deltoidR.clone();
  deltoidL.position.set(-0.4, 1.79, 0.03);

  // Right arm (driven by the hand-tracking mechanism) — keep contract primitives
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.42, 1.8, 0.03);
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.063, 1, 18, 12), shirtMat);
  armMesh.position.copy(shoulder.position);
  // Fabric wrinkle rings ride on the sleeve; they stretch gently with the arm
  const elbowWrinkle = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.009, 6, 18), shirtSeamMat);
  elbowWrinkle.rotation.x = Math.PI / 2;
  elbowWrinkle.position.y = -0.14;
  const midWrinkle = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.008, 6, 18), shirtSeamMat);
  midWrinkle.rotation.x = Math.PI / 2;
  midWrinkle.position.y = 0.22;
  armMesh.add(elbowWrinkle, midWrinkle);

  // Hand origin: the engine lerps hand.position toward handFollowTarget and
  // never rotates it, so the fist stays upright while the arm stretches to it.
  // Hand-local frame: +Y up, -Z anterior (toward the board), +Z posterior.
  // When gripping, the piece axis sits at (0, -0.4, 0) with its max radius 0.36
  // at its foot (~y -0.4) and ~0.2 at its upper body (~y -0.3..-0.05), so the
  // fingers curl down and forward around that upper body, just above the foot.
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), handMat);
  hand.position.set(0.5, 1.1, -1.0);

  // Sleeve cuff + skin wrist on the +Z side, blending the stretched arm in
  const cuffArm = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.07, 0.18, 16), shirtMat);
  cuffArm.rotation.x = Math.PI / 2;
  cuffArm.position.set(0, -0.04, 0.26);
  hand.add(cuffArm);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.1, 14), handMat);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0, -0.055, 0.16);
  hand.add(wrist);

  // Redesigned fist — a readable bare hand cupped around the grabbed piece.
  // A dorsal fist cup + metacarpal knuckle ridge sit on the +Z (camera) side,
  // four fingers each carry three real phalanges that hook down and curl
  // around the piece's ~0.2-radius upper body just above its 0.36-radius
  // foot (piece axis sits at hand-local (0,-0.4,0)), index/little splaying
  // inward hardest, and an opposing thumb with a meaty thenar mound crosses
  // toward the piece front. Creases, tendon ridges and nail hints round it
  // out. Everything stays below y≈-0.03 so the crown keeps rising through the
  // top of the fist. All finger segments share one length-1 phalanx buffer.
  const skinCreaseMat = new THREE.MeshPhysicalMaterial({
    color: 0xd69568,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    sheen: 0.25,
    sheenColor: 0xbf6b3d,
    sheenRoughness: 0.7,
  });
  const nailMat = new THREE.MeshPhysicalMaterial({
    color: 0xe9d7bf,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.25,
    sheen: 0.3,
    sheenColor: 0xf5e6d2,
    sheenRoughness: 0.4,
  });

  // Shared geometry buffers — one buffer per part reused across every finger.
  const dorsalGeo = new THREE.SphereGeometry(0.1, 18, 12);
  const thenarGeo = new THREE.SphereGeometry(0.05, 14, 10);
  const knuckleGeo = new THREE.SphereGeometry(0.024, 11, 9);
  const tipGeo = new THREE.SphereGeometry(0.0155, 10, 8);
  const nailGeo = new THREE.SphereGeometry(0.0055, 8, 6);
  const proxGeo = new THREE.CylinderGeometry(0.014, 0.0205, 1, 10);
  const midGeo = new THREE.CylinderGeometry(0.0105, 0.014, 1, 10);
  const distGeo = new THREE.CylinderGeometry(0.0075, 0.0102, 1, 10);
  const creaseGeo = new THREE.TorusGeometry(0.0105, 0.0035, 8, 14);
  const tendonGeo = new THREE.ConeGeometry(0.0065, 0.055, 8);

  // Phalanx: shared length-1 cylinder buffer, stretched to the joint span.
  const phal = (
    geo: THREE.BufferGeometry,
    a: THREE.Vector3,
    b: THREE.Vector3,
    mat: THREE.Material,
  ): THREE.Mesh => {
    const m = placeSeg(geo, a, b, mat);
    m.scale.y = a.distanceTo(b);
    return m;
  };
  // Thin darker wrinkle ring hugging a joint, oriented along the finger axis.
  const creaseRing = (
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    r: number,
  ): THREE.Mesh => {
    const t = new THREE.Mesh(creaseGeo, skinCreaseMat);
    t.position.copy(pos);
    if (dir.lengthSq() > 1e-8) {
      t.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        dir.clone().normalize(),
      );
    }
    const s = r / 0.0105;
    t.scale.set(s, s, 1);
    return t;
  };

  const fistParts: THREE.Object3D[] = [];

  // Dorsal fist cup — the back of the hand rounding the grip on the +Z side,
  // below y≈-0.05 so the piece crown stays clear of the top opening.
  const dorsal = (p: [number, number, number], s: [number, number, number]) => {
    const m = new THREE.Mesh(dorsalGeo, handMat);
    m.position.set(p[0], p[1], p[2]);
    m.scale.set(s[0], s[1], s[2]);
    fistParts.push(m);
  };
  dorsal([0, -0.155, 0.25], [1.15, 0.9, 0.85]);
  dorsal([-0.125, -0.19, 0.21], [0.8, 0.85, 0.95]);
  dorsal([0.125, -0.19, 0.21], [0.8, 0.85, 0.95]);
  dorsal([0, -0.23, 0.19], [1.0, 0.72, 0.85]);

  // Four fingers: knuckle → proximal → middle → distal → fleshy tip. Every
  // point is checked to stay OUTSIDE the piece column (body radius ~0.2 over
  // y -0.3..-0.05); each finger sweeps its azimuth from the back (+Z) around
  // to the front (-Z) so the tips converge toward the piece axis, with the
  // index and little fingers bending in the most.
  type FingerPts = {
    k: [number, number, number];
    p1: [number, number, number];
    p2: [number, number, number];
    p3: [number, number, number];
    tip: [number, number, number];
    kScale: number;
  };
  const fingers: FingerPts[] = [
    {
      k: [-0.141, -0.1, 0.141],
      p1: [-0.224, -0.165, 0.02],
      p2: [-0.204, -0.215, -0.118],
      p3: [-0.145, -0.245, -0.172],
      tip: [-0.082, -0.262, -0.177],
      kScale: 0.95,
    },
    {
      k: [-0.047, -0.095, 0.195],
      p1: [-0.184, -0.16, 0.129],
      p2: [-0.221, -0.215, -0.08],
      p3: [-0.129, -0.25, -0.184],
      tip: [-0.048, -0.266, -0.178],
      kScale: 1.08,
    },
    {
      k: [0.047, -0.095, 0.195],
      p1: [0.184, -0.16, 0.129],
      p2: [0.221, -0.215, -0.08],
      p3: [0.129, -0.25, -0.184],
      tip: [0.048, -0.266, -0.178],
      kScale: 1.08,
    },
    {
      k: [0.141, -0.108, 0.141],
      p1: [0.224, -0.172, 0.02],
      p2: [0.204, -0.222, -0.118],
      p3: [0.145, -0.252, -0.172],
      tip: [0.082, -0.27, -0.177],
      kScale: 0.9,
    },
  ];
  const vec = (a: [number, number, number]): THREE.Vector3 =>
    new THREE.Vector3(a[0], a[1], a[2]);
  for (const f of fingers) {
    const k = vec(f.k);
    const p1 = vec(f.p1);
    const p2 = vec(f.p2);
    const p3 = vec(f.p3);
    const tip = vec(f.tip);
    // Metacarpal knuckle bump — a raised ridge bulging from the fist back.
    const knuckle = new THREE.Mesh(knuckleGeo, handMat);
    knuckle.position.copy(k);
    knuckle.scale.set(f.kScale, f.kScale * 0.9, f.kScale * 0.92);
    fistParts.push(knuckle);
    // Three articulated phalanges with a natural hooked curl (not a flat V).
    fistParts.push(phal(proxGeo, k, p1, handMat));
    fistParts.push(phal(midGeo, p1, p2, handMat));
    fistParts.push(phal(distGeo, p2, p3, handMat));
    // Fleshy rounded tip — slightly fatter than the distal phalanx it follows.
    const tipBall = new THREE.Mesh(tipGeo, handMat);
    tipBall.position.copy(tip);
    tipBall.scale.set(f.kScale, 1.05, f.kScale * 0.98);
    fistParts.push(tipBall);
    // Joint crease rings: MCP (knuckle), PIP and DIP.
    fistParts.push(creaseRing(k.clone().lerp(p1, 0.1), vec(f.p1).sub(vec(f.k)), 0.0205));
    fistParts.push(creaseRing(p1.clone().lerp(p2, 0.15), vec(f.p2).sub(vec(f.p1)), 0.0138));
    fistParts.push(creaseRing(p2.clone().lerp(p3, 0.18), vec(f.p3).sub(vec(f.p2)), 0.0102));
    // Subtle pale nail hint on the dorsal side of the fingertip.
    const nail = new THREE.Mesh(nailGeo, nailMat);
    nail.position.set(tip.x, tip.y + 0.0035, tip.z + 0.011);
    nail.scale.set(0.55, 0.42, 0.42);
    fistParts.push(nail);
  }

  // Dorsal tendon ridges between the knuckles (thin raised cones on +Z).
  const tendonSpots: [number, number, number][] = [
    [-0.095, -0.13, 0.19],
    [0, -0.12, 0.225],
    [0.095, -0.13, 0.19],
  ];
  for (const [x, y, z] of tendonSpots) {
    const t = new THREE.Mesh(tendonGeo, handMat);
    t.position.set(x, y, z);
    t.rotation.x = 0.18;
    t.scale.y = 0.9;
    fistParts.push(t);
  }

  // Opposing thumb: meaty thenar eminence at the +X root, two segments
  // crossing over the front of the piece, and a fleshy rounded tip.
  const thenar = (p: [number, number, number], s: [number, number, number]) => {
    const m = new THREE.Mesh(thenarGeo, handMat);
    m.position.set(p[0], p[1], p[2]);
    m.scale.set(s[0], s[1], s[2]);
    return m;
  };
  fistParts.push(thenar([0.18, -0.055, 0.09], [1.15, 0.95, 0.9]));
  fistParts.push(thenar([0.175, -0.1, 0.13], [0.75, 0.7, 0.72]));
  const troot = new THREE.Vector3(0.155, -0.085, 0.14);
  const t1 = new THREE.Vector3(0.195, -0.15, 0.05);
  const t2 = new THREE.Vector3(0.185, -0.215, -0.055);
  const ttip = new THREE.Vector3(0.16, -0.255, -0.115);
  const thumbRoot = new THREE.Mesh(knuckleGeo, handMat);
  thumbRoot.position.copy(troot);
  thumbRoot.scale.set(1.02, 0.92, 0.82);
  fistParts.push(thumbRoot);
  fistParts.push(seg(t1, troot, 0.014, 0.024, handMat));
  fistParts.push(seg(t2, t1, 0.011, 0.017, handMat));
  fistParts.push(seg(ttip, t2, 0.0085, 0.012, handMat));
  const thumbTip = new THREE.Mesh(tipGeo, handMat);
  thumbTip.position.copy(ttip);
  thumbTip.scale.set(1.1, 1.15, 1.0);
  fistParts.push(thumbTip);

  hand.add(...fistParts);


  // Left arm (static, posed resting at the side with a bent elbow): rolled
  // short sleeve, bare skin forearm, a defined wrist and a relaxed open hand
  // with readable fingers.
  const armJointL = new THREE.Object3D();
  armJointL.position.set(-0.4, 1.79, 0.03);
  armJointL.rotation.set(0.12, 0, -0.18);
  const sleeveL = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.082, 0.36, 16, 8), shirtMat);
  sleeveL.rotation.x = Math.PI;
  sleeveL.position.y = -0.18;
  const sleeveHem = new THREE.Mesh(new THREE.TorusGeometry(0.084, 0.01, 6, 16), shirtMat);
  sleeveHem.rotation.x = Math.PI / 2;
  sleeveHem.position.y = -0.36;
  const sleeveRoll = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 16), shirtSeamMat);
  sleeveRoll.rotation.x = Math.PI / 2;
  sleeveRoll.position.y = -0.3;
  const elbowL = new THREE.Object3D();
  elbowL.position.y = -0.36;
  elbowL.rotation.set(-0.12, 0, 0.16); // forearm swings slightly back toward the body
  const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skinMat);
  const forearmL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.041, 0.42, 14, 8), skinMat);
  forearmL.rotation.x = Math.PI;
  forearmL.position.y = -0.21;
  const wristL = new THREE.Mesh(new THREE.SphereGeometry(0.043, 12, 10), skinMat);
  wristL.position.y = -0.42;
  // Relaxed open palm + thumb eminence
  const palmL = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 10), skinMat);
  palmL.scale.set(1, 0.7, 0.5);
  palmL.position.set(0.005, -0.455, -0.01);
  const thumbEmL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skinMat);
  thumbEmL.scale.set(0.9, 0.7, 0.6);
  thumbEmL.position.set(-0.055, -0.462, 0.005);
  // Four gently curled fingers (shared segment buffers)
  const lProxGeo = new THREE.CylinderGeometry(0.011, 0.014, 0.052, 8);
  const lMidGeo = new THREE.CylinderGeometry(0.008, 0.011, 0.033, 8);
  const lTipGeo = new THREE.SphereGeometry(0.009, 8, 6);
  const lfXs = [-0.022, -0.008, 0.008, 0.022];
  for (const xb of lfXs) {
    const f0 = new THREE.Vector3(xb, -0.455, -0.012);
    const f1 = new THREE.Vector3(xb, -0.503, 0.008);
    const f2 = new THREE.Vector3(xb, -0.533, 0.022);
    elbowL.add(placeSeg(lProxGeo, f0, f1, skinMat));
    elbowL.add(placeSeg(lMidGeo, f1, f2, skinMat));
    const lTip = new THREE.Mesh(lTipGeo, skinMat);
    lTip.position.copy(f2);
    elbowL.add(lTip);
  }
  // Opposing thumb
  const th0 = new THREE.Vector3(-0.05, -0.462, -0.006);
  const th1 = new THREE.Vector3(-0.062, -0.498, 0.016);
  const thTip = new THREE.Vector3(-0.065, -0.512, 0.028);
  elbowL.add(seg(th0, th1, 0.011, 0.014, skinMat));
  const thTipBall = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), skinMat);
  thTipBall.position.copy(thTip);
  elbowL.add(thTipBall);
  elbowL.add(elbowBall, forearmL, wristL, palmL, thumbEmL);
  armJointL.add(sleeveL, sleeveHem, sleeveRoll, elbowL);

  group.add(
    ...legAssembly(0.27, -0.03), // right foot slightly forward
    ...legAssembly(-0.27, 0.05), // left foot back — natural stance
    ...footAssembly(0.27, -0.03),
    ...footAssembly(-0.27, 0.05),
    torsoPivot,
    headPivot,
    deltoidR,
    deltoidL,
    shoulder,
    armMesh,
    hand,
    armJointL,
  );
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
      _v.copy(worldPos).sub(robot.position);
      robotHand.position.copy(_v);
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

    // Pointer interaction state (right-drag orbit + wheel zoom + calibration clicks)
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
    const DWELL_MS = 4000;

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
      setHoveredSquare(null);
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
        // Open palm while holding releases the piece back to its square —
        // the way to cancel a grab instead of placing it.
        if (holding) {
          dropPiece(null);
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
                setStatusMessage(`Holding ${grabSq} · hold still over a green square for 4s to place · palm to release`);

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
          setStatusMessage("Calibration done — palm to move · fist to hold · hold still 4s over a green square to place");
        }
        return;
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
    });

    canvas.addEventListener("pointerup", (e) => {
      if (e.button === 2) {
        isOrbiting = false;
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
    setStatusMessage("Entering 3D Mode — Morphing 2D board to 3D arena...");

    function animate() {
      animRef.current = requestAnimationFrame(animate);

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
        morphT = Math.min(1.0, morphT + 0.015);
        const ease = morphT * morphT * (3 - 2 * morphT); // Smoothstep curve

        // Camera lerps smoothly from top-down 2D flat view to 3D perspective
        _v3.set(0, 19.5, 0.001);
        _v2.set(cx, cy, cz);
        camera.position.lerpVectors(_v3, _v2, ease);
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
        _v.copy(robotHand.position).sub(robotShoulder.position);
        const len = _v.length();
        robotArm.position.addVectors(robotShoulder.position, robotHand.position).multiplyScalar(0.5);
        robotArm.scale.set(1, Math.max(len, 0.01), 1);
        if (len > 0.001) {
          _v2.copy(_v).normalize();
          robotArm.quaternion.setFromUnitVectors(_up, _v2);
        }
      }

      // Human hand follows the tracked hand and holds the piece when grabbing
      _v.copy(humanHandFollowTarget).sub(human.position);
      humanHand.position.lerp(_v, 0.18);
      humanHandMat.emissiveIntensity =
        grabbedPieceSquare && grabbedPieceGroup ? 0.8 : 0;
      {
        _v.copy(humanHand.position).sub(humanShoulder.position);
        const len = _v.length();
        humanArm.position.copy(humanShoulder.position).add(humanHand.position).multiplyScalar(0.5);
        humanArm.scale.set(1, Math.max(len, 0.01), 1);
        if (len > 0.001) {
          _v2.copy(_v).normalize();
          humanArm.quaternion.setFromUnitVectors(_up, _v2);
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
        const pos = _v2.copy(cp0.pos).lerp(cp1.pos, a.t);
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

      // Smooth piece follow for fist grab (held just under the human hand)
      if (grabbedPieceGroup && grabbedPieceSquare) {
        grabbedPieceGroup.position.lerp(pieceFollowTarget, 0.25);
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
            {selectedSquare ? `Holding ${selectedSquare}` : handActive ? gestureLabel || "Hand detected" : "Palm to move · Fist to hold · Hold still over a green square for 4s to place · Palm to release"}
          </span>
          {gestureLabel === "Palm" && (
            <span className="rounded bg-emerald-800/40 px-3 py-1.5 text-xs text-emerald-300 border border-emerald-700/30 backdrop-blur-sm light:bg-emerald-100 light:text-emerald-700 light:border-emerald-300">
              Open palm — move over the board (green square)
            </span>
          )}
          {gestureLabel === "Fist" && (
            <span className="rounded bg-amber-800/40 px-3 py-1.5 text-xs text-amber-300 border border-amber-700/30 backdrop-blur-sm light:bg-amber-100 light:text-amber-700 light:border-amber-300">
              Fist — hold the piece
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
