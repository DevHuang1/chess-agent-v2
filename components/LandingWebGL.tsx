"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function createKingPiece(): THREE.Group {
  const group = new THREE.Group();

  const baseMat = new THREE.MeshPhysicalMaterial({
    color: 0xf1e9d8,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.45,
    reflectivity: 0.28,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: 0xe0d2b8,
    roughness: 0.5,
    metalness: 0.0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.5,
  });

  function lathe(
    points: [number, number][],
    segments = 36,
  ): THREE.Mesh {
    const vec2 = points.map(([x, y]) => new THREE.Vector2(x, y));
    const m = new THREE.Mesh(
      new THREE.LatheGeometry(vec2, segments),
      baseMat,
    );
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

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

  function seatRing(scale = 1): THREE.Mesh {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.205 * scale, 0.02, 12, 30),
      accentMat,
    );
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.105;
    return r;
  }

  function accentRing(radius: number, y: number, tube = 0.02): THREE.Mesh {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 12, 26),
      accentMat,
    );
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    return r;
  }

  // Body
  const bodyMesh = lathe([
    [0.155, 0.13],
    [0.155, 0.24],
    [0.17, 0.32],
    [0.155, 0.4],
    [0.14, 0.48],
    [0.13, 0.55],
    [0.125, 0.6],
  ]);

  // Crown band
  const crownBand = accentRing(0.128, 0.605, 0.02);

  // Finial ball
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 10),
    accentMat,
  );
  ball.position.y = 0.645;

  // Cross vertical
  const crossV = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.16, 0.045),
    accentMat,
  );
  crossV.position.y = 0.72;

  // Cross horizontal
  const crossH = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.035, 0.045),
    accentMat,
  );
  crossH.position.y = 0.76;

  group.add(base(0), seatRing(), bodyMesh, crownBand, ball, crossV, crossH);
  group.scale.setScalar(1.5);
  return group;
}

interface TileData {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startRot: THREE.Euler;
}

export default function LandingWebGL() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isMobile = window.innerWidth < 768;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !isMobile,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);

    // --- Scene ---
    const scene = new THREE.Scene();

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    camera.position.set(0, 4, 10);
    camera.lookAt(0, 1.5, 0);

    // --- Lights ---
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.0);
    keyLight.position.set(3, 8, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe6f0ff, 0.3);
    fillLight.position.set(-4, 5, -2);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xf59e0b, 0.6, 20);
    rimLight.position.set(0, 3, -5);
    scene.add(rimLight);

    // --- King piece ---
    const king = createKingPiece();
    king.position.set(0, 0, 0);
    scene.add(king);

    // --- Board grid (wireframe tiles with amber edges) ---
    const boardGroup = new THREE.Group();
    const tileGeo = new THREE.BoxGeometry(0.92, 0.02, 0.92);
    const edgeGeo = new THREE.EdgesGeometry(tileGeo);
    const tiles: { group: THREE.Group; data: TileData }[] = [];

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const isLight = (rank + file) % 2 === 0;

        const fillMat = new THREE.MeshBasicMaterial({
          color: isLight ? 0xebecd0 : 0x779556,
          transparent: true,
          opacity: 0.06,
        });
        const fill = new THREE.Mesh(tileGeo, fillMat);

        const edgeMat = new THREE.LineBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.15,
        });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);

        const tileGroup = new THREE.Group();
        tileGroup.add(fill, edges);

        const endPos = new THREE.Vector3(file - 3.5, 0, 3.5 - rank);

        let startPos: THREE.Vector3;
        if (reducedMotion) {
          startPos = endPos.clone();
        } else {
          const angle = Math.random() * Math.PI * 2;
          const radius = 6 + Math.random() * 4;
          startPos = new THREE.Vector3(
            Math.cos(angle) * radius,
            Math.random() * 5 + 2,
            Math.sin(angle) * radius - 3,
          );
          tileGroup.position.copy(startPos);
          tileGroup.rotation.set(
            Math.random() * 0.5,
            Math.random() * Math.PI * 2,
            Math.random() * 0.3,
          );
        }

        const data: TileData = {
          startPos,
          endPos,
          startRot: tileGroup.rotation.clone(),
        };

        boardGroup.add(tileGroup);
        tiles.push({ group: tileGroup, data });
      }
    }

    scene.add(boardGroup);

    // --- Particles ---
    const particleCount = isMobile ? 60 : 150;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 1] = Math.random() * 10 - 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
      velocities[i * 3 + 1] = 0.002 + Math.random() * 0.005;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );

    const particleMat = new THREE.PointsMaterial({
      color: 0xf59e0b,
      size: 0.04,
      transparent: true,
      opacity: 0.5,
      sizeAttenuation: true,
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // --- Scroll tracking ---
    let scrollY = 0;
    let maxScroll = 1;
    const scrollContainer = document.querySelector(".landing-scroll-root");

    function updateMaxScroll() {
      if (scrollContainer) {
        maxScroll =
          scrollContainer.scrollHeight - scrollContainer.clientHeight || 1;
      }
    }
    updateMaxScroll();

    function onScroll() {
      if (scrollContainer) {
        scrollY = scrollContainer.scrollTop;
      }
    }

    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    }

    // --- Cursor tracking ---
    let mx = 0;
    let my = 0;
    function onMouseMove(e: MouseEvent) {
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      my = -(e.clientY / window.innerHeight) * 2 + 1;
    }
    window.addEventListener("mousemove", onMouseMove);

    // --- Resize ---
    function onResize() {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      updateMaxScroll();
    }
    window.addEventListener("resize", onResize);

    const resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(canvas.parentElement!);

    // --- Render loop ---
    let rafId = 0;
    let baseCameraY = 4;
    let baseCameraZ = 10;

    function tick() {
      rafId = requestAnimationFrame(tick);

      if (!reducedMotion) {
        const t = clamp(scrollY / (maxScroll * 0.4), 0, 1);
        const eased = easeOutExpo(t);

        // Camera pull-back on scroll
        const targetY = lerp(4, 7, eased);
        const targetZ = lerp(10, 14, eased);
        baseCameraY = lerp(baseCameraY, targetY, 0.08);
        baseCameraZ = lerp(baseCameraZ, targetZ, 0.08);

        // King rise + spin
        king.position.y = lerp(0, 2.5, eased);
        king.rotation.y += 0.004 + eased * 0.002;

        // Board tile assembly
        for (const { group, data } of tiles) {
          group.position.lerpVectors(data.startPos, data.endPos, eased);
          group.rotation.x = lerp(data.startRot.x, 0, eased);
          group.rotation.y = lerp(data.startRot.y, 0, eased);
          group.rotation.z = lerp(data.startRot.z, 0, eased);

          // Edge glow increases as tiles settle
          const edgeMesh = group.children[1] as THREE.LineSegments;
          if (edgeMesh?.material) {
            (edgeMesh.material as THREE.LineBasicMaterial).opacity = lerp(
              0.15,
              0.5,
              eased,
            );
          }
        }

        // Particle drift
        const pos = particles.geometry.attributes.position;
        for (let i = 0; i < particleCount; i++) {
          pos.array[i * 3 + 1] += velocities[i * 3 + 1];
          if (pos.array[i * 3 + 1] > 8) pos.array[i * 3 + 1] = -3;
        }
        pos.needsUpdate = true;

        // Cursor parallax
        camera.position.x = lerp(camera.position.x, mx * 0.3, 0.05);
        camera.position.y = lerp(
          camera.position.y,
          baseCameraY + my * 0.15,
          0.05,
        );
        camera.position.z = baseCameraZ;
        camera.lookAt(0, lerp(1.5, 2.5, eased), 0);
      } else {
        // Reduced motion: static scene
        king.rotation.y += 0.002;
        camera.lookAt(0, 1.5, 0);
      }

      renderer.render(scene, camera);
    }

    rafId = requestAnimationFrame(tick);

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(rafId);
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", onScroll);
      }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      resizeObs.disconnect();
      renderer.dispose();
      tileGeo.dispose();
      edgeGeo.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    };
  }, []);

  return (
    <div className="landing-webgl-wrap">
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
