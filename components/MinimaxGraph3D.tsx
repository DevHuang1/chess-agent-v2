"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { MinimaxSearchNode, MinimaxTrace } from "@/lib/minimax";
import type { MctsSearchNode, MctsTrace } from "@/lib/mcts";

type MinimaxGraph3DProps = {
  trace: MinimaxTrace | MctsTrace | null;
  algorithm?: "minimax" | "mcts";
  activeNodeIndex: number;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

type LayoutNode = MinimaxSearchNode & { graphX: number; graphY: number; graphZ: number };

const COLORS = {
  root: 0x22d3ee,
  principal: 0xfbbf24,
  evaluated: 0x34d399,
  pruned: 0xfb7185,
  exploring: 0xa78bfa,
  edge: 0x64748b,
  activeEdge: 0x67e8f9,
};

function isMctsNode(node: MinimaxSearchNode | MctsSearchNode | null): node is MctsSearchNode {
  return Boolean(node && "phase" in node && "visits" in node && "winRate" in node && "exploration" in node);
}

function nodeColor(node: MinimaxSearchNode) {
  if (node.status === "principal") return COLORS.principal;
  if (node.status === "evaluated") return COLORS.evaluated;
  if (node.status === "pruned") return COLORS.pruned;
  return node.depth === 0 ? COLORS.root : COLORS.exploring;
}

function createParticleField(node: LayoutNode): THREE.Points {
  const count = 14;
  const positions = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, () => new THREE.Vector3());
  const phases = Array.from({ length: count }, () => Math.random() * Math.PI * 2);
  for (let index = 0; index < count; index++) {
    const offset = index * 3;
    const angle = phases[index];
    const radius = 0.18 + Math.random() * 0.16;
    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] = (Math.random() - 0.5) * 0.18;
    positions[offset + 2] = Math.sin(angle) * radius;
    velocities[index].set(Math.cos(angle) * 0.08, 0.12 + Math.random() * 0.08, Math.sin(angle) * 0.08);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: nodeColor(node),
    size: 0.07,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  particles.userData.phases = phases;
  particles.userData.baseColor = nodeColor(node);
  return particles;
}

function makeLayout(trace: MinimaxTrace, focusIndex: number): LayoutNode[] {
  const active = trace.nodes[focusIndex] ?? trace.nodes[0];
  const byId = new Map(trace.nodes.map((node) => [node.id, node]));
  const focusIds = new Set<string>();
  let cursor: MinimaxSearchNode | undefined = active;
  while (cursor) {
    focusIds.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const nearby = trace.nodes.slice(Math.max(0, focusIndex - 18), focusIndex + 19);
  const principal = trace.nodes.filter((node) => node.status === "principal").slice(0, 12);
  const candidates = [...focusIds, ...nearby.map((node) => node.id), ...principal.map((node) => node.id)]
    .map((id) => byId.get(id))
    .filter((node): node is MinimaxSearchNode => Boolean(node));
  const selected = new Map<string, MinimaxSearchNode>();
  for (const node of candidates) selected.set(node.id, node);
  for (const node of trace.nodes) {
    if (selected.size >= 64) break;
    if (!selected.has(node.id)) selected.set(node.id, node);
  }
  if (active && !selected.has(active.id)) selected.set(active.id, active);

  const layers = new Map<number, MinimaxSearchNode[]>();
  for (const node of selected.values()) {
    const layer = layers.get(node.depth) ?? [];
    layer.push(node);
    layers.set(node.depth, layer);
  }
  const result: LayoutNode[] = [];
  for (const [depth, layer] of layers) {
    layer.sort((a, b) => {
      if (a.id === active?.id) return -1;
      if (b.id === active?.id) return 1;
      if (a.status === "principal") return -1;
      if (b.status === "principal") return 1;
      return a.id.localeCompare(b.id);
    });
    const activeFirst = layer.filter((node) => node.id === active?.id || node.status === "principal");
    const remaining = layer.filter((node) => node.id !== active?.id && node.status !== "principal");
    const compactLayer = [...activeFirst, ...remaining].slice(0, 12);
    const spacing = compactLayer.length > 8 ? 1.18 : 1.42;
    compactLayer.forEach((node, index) => {
      result.push({
        ...node,
        graphX: (index - (compactLayer.length - 1) / 2) * spacing,
        graphY: 2.7 - depth * 1.02,
        graphZ: (depth % 2 === 0 ? 0.35 : -0.35) + ((index % 3) - 1) * 0.22,
      });
    });
  }
  return relaxLayout(result);
}

function relaxLayout(nodes: LayoutNode[]): LayoutNode[] {
  const positions = new Map(nodes.map((node) => [node.id, new THREE.Vector3(node.graphX, node.graphY, node.graphZ)]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const iterations = 8;
  const collisionRadius = 0.62;
  const maxX = 7.1;
  const maxZ = 2.1;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const forces = new Map(nodes.map((node) => [node.id, new THREE.Vector3()]));
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const position = positions.get(node.id);
      const force = forces.get(node.id);
      if (!position || !force) continue;
      for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex++) {
        const other = nodes[otherIndex];
        if (other.depth !== node.depth) continue;
        const otherPosition = positions.get(other.id);
        const otherForce = forces.get(other.id);
        if (!otherPosition || !otherForce) continue;
        const delta = position.clone().sub(otherPosition);
        delta.y = 0;
        const distance = Math.max(0.001, delta.length());
        if (distance >= collisionRadius) continue;
        const push = delta.normalize().multiplyScalar((collisionRadius - distance) * 0.42);
        force.add(push);
        otherForce.sub(push);
      }
    }

    for (const node of nodes) {
      const position = positions.get(node.id);
      const force = forces.get(node.id);
      if (!position || !force) continue;
      if (node.parentId) {
        const parent = byId.get(node.parentId);
        const parentPosition = parent ? positions.get(parent.id) : undefined;
        if (parentPosition) {
          const horizontal = new THREE.Vector3(parentPosition.x - position.x, 0, parentPosition.z - position.z);
          force.add(horizontal.multiplyScalar(0.025));
        }
      }
      const targetZ = node.depth % 2 === 0 ? 0.35 : -0.35;
      force.z += (targetZ - position.z) * 0.035;
      position.add(force.multiplyScalar(0.78));
      position.x = THREE.MathUtils.clamp(position.x, -maxX, maxX);
      position.z = THREE.MathUtils.clamp(position.z, -maxZ, maxZ);
    }
  }

  return nodes.map((node) => {
    const position = positions.get(node.id)!;
    return { ...node, graphX: position.x, graphY: position.y, graphZ: position.z };
  });
}

type OverviewNode = {
  node: MinimaxSearchNode;
  x: number;
  y: number;
};

type OverviewEdge = {
  from: OverviewNode;
  to: OverviewNode;
};

function makeOverview(trace: MinimaxTrace | MctsTrace, activeIndex: number): { nodes: OverviewNode[]; edges: OverviewEdge[] } {
  const active = trace.nodes[activeIndex] ?? trace.nodes[0];
  const source = trace.nodes.slice(0, 128);
  if (active && !source.some((node) => node.id === active.id)) source.push(active);
  const layers = new Map<number, MinimaxSearchNode[]>();
  for (const node of source) {
    const layer = layers.get(node.depth) ?? [];
    layer.push(node);
    layers.set(node.depth, layer);
  }
  const nodes: OverviewNode[] = [];
  const byId = new Map<string, OverviewNode>();
  const layerCount = Math.max(1, layers.size - 1);
  for (const [depth, layer] of layers) {
    const maxLayer = Math.max(1, layer.length - 1);
    layer.forEach((node, index) => {
      const overviewNode = {
        node,
        x: 10 + (index / maxLayer) * 164,
        y: 12 + (depth / layerCount) * 64,
      };
      nodes.push(overviewNode);
      byId.set(node.id, overviewNode);
    });
  }
  const edges: OverviewEdge[] = [];
  for (const overviewNode of nodes) {
    for (const childId of overviewNode.node.children) {
      const child = byId.get(childId);
      if (child) edges.push({ from: overviewNode, to: child });
    }
  }
  if (active && !byId.has(active.id)) {
    const fallback = nodes[0];
    if (fallback) {
      byId.set(active.id, fallback);
    }
  }
  return { nodes, edges };
}

export default function MinimaxGraph3D({ trace, algorithm = "minimax", activeNodeIndex, selectedNodeId, onSelectNode }: MinimaxGraph3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const graphGroupRef = useRef<THREE.Group | null>(null);
  const nodeMeshesRef = useRef(new Map<string, THREE.Mesh>());
  const particleSystemsRef = useRef(new Map<string, THREE.Points>());
  const glowRingsRef = useRef(new Map<string, THREE.Mesh>());
  const layoutRef = useRef<LayoutNode[]>([]);
  const hoveredNodeRef = useRef<string | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const activeNodeIndexRef = useRef(activeNodeIndex);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const cameraResetRef = useRef<(() => void) | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoomRadius, setZoomRadius] = useState(18);

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
    activeNodeIndexRef.current = activeNodeIndex;
    selectedNodeIdRef.current = selectedNodeId;
  }, [onSelectNode, activeNodeIndex, selectedNodeId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b16);
    scene.fog = new THREE.Fog(0x070b16, 13, 30);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.set(0, 0.4, 18);
    camera.lookAt(0, 1.2, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearAlpha(0);
    container.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0x9fb9ff, 1.1));
    const key = new THREE.DirectionalLight(0x67e8f9, 2.1);
    key.position.set(4, 8, 8);
    scene.add(key);
    const rim = new THREE.PointLight(0xfbbf24, 1.2, 16);
    rim.position.set(-5, 1, 4);
    scene.add(rim);
    const grid = new THREE.GridHelper(18, 18, 0x1e3a5f, 0x10243b);
    grid.position.y = -3.4;
    scene.add(grid);
    const graphGroup = new THREE.Group();
    scene.add(graphGroup);
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    graphGroupRef.current = graphGroup;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let theta = 0;
    let phi = 0.08;
    let radius = 18;
    const onPointerDown = (event: PointerEvent) => {
      isDragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(Array.from(nodeMeshesRef.current.values()));
      const nodeId = hit[0]?.object.userData.nodeId as string | undefined;
      if (nodeId !== hoveredNodeRef.current) {
        hoveredNodeRef.current = nodeId ?? null;
        setHoveredNodeId(nodeId ?? null);
      }
      if (!isDragging) return;
      theta -= (event.clientX - lastX) * 0.008;
      phi = THREE.MathUtils.clamp(phi + (event.clientY - lastY) * 0.006, -0.8, 0.85);
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(Array.from(nodeMeshesRef.current.values()));
      const nodeId = hit[0]?.object.userData.nodeId as string | undefined;
      if (nodeId) onSelectNodeRef.current(nodeId);
    };
    const onWheel = (event: WheelEvent) => {
      radius = THREE.MathUtils.clamp(radius + event.deltaY * 0.012, 10, 28);
      setZoomRadius(radius);
    };
    cameraResetRef.current = () => {
      theta = 0;
      phi = 0.08;
      radius = 18;
      setZoomRadius(18);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });

    let frame = 0;
    let previous = performance.now();
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min(0.05, Math.max(0.001, (now - previous) / 1000));
      previous = now;
      camera.position.set(
        Math.sin(theta) * Math.cos(phi) * radius,
        1.5 + Math.sin(phi) * radius * 0.38,
        Math.cos(theta) * Math.cos(phi) * radius,
      );
      camera.lookAt(0, -0.35, 0);
      graphGroup.rotation.y += delta * 0.035;
      for (const [nodeId, mesh] of nodeMeshesRef.current) {
        const isActive = layoutRef.current[activeNodeIndexRef.current]?.id === nodeId;
        const isSelected = selectedNodeIdRef.current === nodeId;
        const pulse = isActive || isSelected ? 1 + Math.sin(now * 0.006) * 0.15 : 1;
        const targetScale = isSelected ? 1.5 * pulse : isActive ? 1.35 * pulse : 1;
        mesh.scale.x += (targetScale - mesh.scale.x) * Math.min(1, delta * 9);
        mesh.scale.y = mesh.scale.x;
        mesh.scale.z = mesh.scale.x;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = isSelected ? 1.8 : isActive ? 1.35 : 0.42;
        material.opacity = isSelected || isActive ? 1 : (mesh.userData.baseOpacity as number ?? 0.94);

        const particles = particleSystemsRef.current.get(nodeId);
        if (particles) {
          const particleMaterial = particles.material as THREE.PointsMaterial;
          const particleTarget = isSelected ? 0.95 : isActive ? 0.78 : hoveredNodeRef.current === nodeId ? 0.42 : 0.04;
          particleMaterial.opacity += (particleTarget - particleMaterial.opacity) * Math.min(1, delta * 8);
          particles.rotation.y += delta * (isActive || isSelected ? 1.8 : 0.35);
          particles.rotation.x = Math.sin(now * 0.0014 + (particles.userData.phaseOffset as number ?? 0)) * 0.16;
          const positionAttribute = particles.geometry.getAttribute("position") as THREE.BufferAttribute;
          const velocities = particles.userData.velocities as THREE.Vector3[];
          for (let index = 0; index < velocities.length; index++) {
            const currentY = positionAttribute.getY(index) + velocities[index].y * delta;
            positionAttribute.setY(index, currentY > 0.62 ? -0.2 : currentY);
          }
          positionAttribute.needsUpdate = true;
        }

        const ring = glowRingsRef.current.get(nodeId);
        if (ring) {
          const ringMaterial = ring.material as THREE.MeshBasicMaterial;
          const ringTarget = isSelected ? 0.82 : isActive ? 0.58 : hoveredNodeRef.current === nodeId ? 0.28 : 0.04;
          ringMaterial.opacity += (ringTarget - ringMaterial.opacity) * Math.min(1, delta * 10);
          ring.rotation.z += delta * (isActive || isSelected ? 1.2 : 0.22);
          const ringScale = isSelected ? 1.18 + Math.sin(now * 0.006) * 0.08 : isActive ? 1.08 + Math.sin(now * 0.005) * 0.06 : 1;
          ring.scale.setScalar(ringScale);
        }
      }
      for (const child of graphGroup.children) {
        if (!(child instanceof THREE.Line)) continue;
        const edgeMaterial = child.material as THREE.LineBasicMaterial;
        const hotEdge = Boolean(child.userData.hotEdge);
        const targetOpacity = hotEdge ? 0.86 + Math.sin(now * 0.007) * 0.12 : (child.userData.baseOpacity as number ?? 0.42);
        edgeMaterial.opacity += (targetOpacity - edgeMaterial.opacity) * Math.min(1, delta * 9);
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);

    const resize = () => {
      const width = container.clientWidth || 640;
      const height = container.clientHeight || 420;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const nodeMeshes = nodeMeshesRef.current;
    const particleSystems = particleSystemsRef.current;
    const glowRings = glowRingsRef.current;
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      cameraResetRef.current = null;
      graphGroup.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      });
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      nodeMeshes.clear();
      particleSystems.clear();
      glowRings.clear();
      scene.clear();
    };
  }, []);

  useEffect(() => {
    const group = graphGroupRef.current;
    if (!group) return;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    });
    group.clear();
    nodeMeshesRef.current.clear();
    particleSystemsRef.current.clear();
    glowRingsRef.current.clear();
    if (!trace) {
      layoutRef.current = [];
      return;
    }
    const layout = makeLayout(trace, activeNodeIndex);
    layoutRef.current = layout;
    const byId = new Map(layout.map((node) => [node.id, node]));
    const activeNodeId = trace.nodes[activeNodeIndex]?.id;
    const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.42 });
    for (const node of layout) {
      for (const childId of node.children) {
        const child = byId.get(childId);
        if (!child) continue;
        const points = [new THREE.Vector3(node.graphX, node.graphY, node.graphZ), new THREE.Vector3(child.graphX, child.graphY, child.graphZ)];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const hotEdge = node.id === activeNodeId || child.id === activeNodeId || node.id === selectedNodeId || child.id === selectedNodeId;
        const edge = new THREE.Line(geometry, edgeMaterial.clone());
        const edgeLineMaterial = edge.material as THREE.LineBasicMaterial;
        edgeLineMaterial.color.setHex(hotEdge ? COLORS.activeEdge : COLORS.edge);
        edgeLineMaterial.opacity = hotEdge ? 0.86 : 0.42;
        edge.userData.hotEdge = hotEdge;
        edge.userData.baseOpacity = 0.42;
        group.add(edge);
      }
    }
    edgeMaterial.dispose();
    for (const node of layout) {
      const baseOpacity = node.status === "pruned" ? 0.58 : 0.94;
      const material = new THREE.MeshStandardMaterial({ color: nodeColor(node), emissive: nodeColor(node), emissiveIntensity: 0.42, metalness: 0.25, roughness: 0.32, transparent: true, opacity: baseOpacity });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(node.depth === 0 ? 0.34 : 0.22, 20, 16), material);
      mesh.position.set(node.graphX, node.graphY, node.graphZ);
      mesh.userData.nodeId = node.id;
      mesh.userData.baseOpacity = baseOpacity;
      nodeMeshesRef.current.set(node.id, mesh);
      group.add(mesh);

      const isHot = node.id === activeNodeId || node.id === selectedNodeId;
      if (isHot || node.status === "principal" || node.status === "pruned") {
        const particles = createParticleField(node);
        particles.position.copy(mesh.position);
        particles.userData.phaseOffset = Math.random() * Math.PI * 2;
        particleSystemsRef.current.set(node.id, particles);
        group.add(particles);
      }

      const glowMaterial = new THREE.MeshBasicMaterial({
        color: nodeColor(node),
        transparent: true,
        opacity: isHot ? 0.56 : 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const glowRing = new THREE.Mesh(new THREE.RingGeometry(node.depth === 0 ? 0.52 : 0.36, node.depth === 0 ? 0.58 : 0.41, 28), glowMaterial);
      glowRing.position.copy(mesh.position);
      glowRing.rotation.x = Math.PI / 2;
      glowRing.userData.nodeId = node.id;
      glowRingsRef.current.set(node.id, glowRing);
      group.add(glowRing);
    }
  }, [trace, activeNodeIndex, selectedNodeId]);

  const overview = useMemo(() => (trace ? makeOverview(trace, activeNodeIndex) : { nodes: [], edges: [] }), [trace, activeNodeIndex]);
  const hoveredNode = trace?.nodes.find((node) => node.id === hoveredNodeId) ?? null;
  const activeNode = trace?.nodes[activeNodeIndex] ?? null;
  const selectedNode = trace?.nodes.find((node) => node.id === selectedNodeId) ?? hoveredNode ?? activeNode;
  const mctsNode = isMctsNode(selectedNode) ? selectedNode : null;

  return (
    <div className="ai-graph-shell relative h-[410px] overflow-hidden rounded-xl border border-cyan-500/25 bg-[#070b16] shadow-2xl">
      <div ref={containerRef} className="absolute inset-0" aria-label="3D minimax decision tree" />
      {activeNode ? (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-cyan-300/40 bg-cyan-950/75 px-2.5 py-2 text-[10px] shadow-lg backdrop-blur-sm">
          <div className="font-semibold uppercase tracking-wider text-cyan-200">Active search node</div>
          <div className="mt-0.5 font-mono text-sm text-white">{activeNode.san ?? "root"}</div>
          <div className="text-[9px] text-cyan-100/70">depth {activeNode.depth} · {activeNode.status}</div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-zinc-700/70 bg-black/45 px-3 py-2 text-[10px] text-zinc-300 backdrop-blur-sm">
        <div className="font-semibold text-cyan-200">{algorithm === "mcts" ? "3D MCTS rollout graph" : "3D minimax decision graph"}</div>
        <div className="mt-1 text-zinc-500">Active branch is enlarged and centered · drag to orbit · wheel to zoom</div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-[9px] text-zinc-400">
        <span className="rounded border border-amber-300/40 bg-amber-400/15 px-1.5 py-1 text-amber-200">PV</span>
        <span className="rounded border border-emerald-300/40 bg-emerald-400/15 px-1.5 py-1 text-emerald-200">evaluated</span>
        <span className="rounded border border-rose-300/40 bg-rose-400/15 px-1.5 py-1 text-rose-200">pruned</span>
      </div>
      <div className="absolute bottom-3 right-3 w-[188px] rounded-lg border border-cyan-400/25 bg-zinc-950/85 p-2 shadow-xl backdrop-blur-md" aria-label="AI Lab graph overview navigator">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[9px]">
          <span className="font-semibold uppercase tracking-wider text-cyan-200">Overview</span>
          <span className="font-mono text-zinc-500">zoom {zoomRadius.toFixed(1)}×</span>
        </div>
        <svg viewBox="0 0 184 88" className="h-[88px] w-full rounded border border-cyan-400/10 bg-[#0a1120]" role="img" aria-label="Search tree overview">
          {overview.edges.map((edge) => (
            <line key={`${edge.from.node.id}-${edge.to.node.id}`} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} stroke="#334155" strokeWidth="0.7" opacity="0.72" />
          ))}
          {overview.nodes.map((overviewNode) => {
            const isActive = overviewNode.node.id === activeNode?.id;
            const isSelected = overviewNode.node.id === selectedNodeId;
            const fill = isActive ? "#67e8f9" : overviewNode.node.status === "principal" ? "#fbbf24" : overviewNode.node.status === "pruned" ? "#fb7185" : overviewNode.node.status === "evaluated" ? "#34d399" : "#a78bfa";
            return (
              <circle
                key={overviewNode.node.id}
                cx={overviewNode.x}
                cy={overviewNode.y}
                r={isSelected ? 2.6 : isActive ? 2.3 : 1.35}
                fill={fill}
                stroke={isSelected ? "#ffffff" : isActive ? "#cffafe" : "none"}
                strokeWidth={isSelected ? 1 : 0}
                opacity={isActive || isSelected ? 1 : 0.78}
              />
            );
          })}
          <rect x={92 - Math.max(16, Math.min(42, 30 * zoomRadius / 18))} y="7" width={Math.max(32, Math.min(84, 60 * zoomRadius / 18))} height="74" rx="4" fill="none" stroke="#67e8f9" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.75" />
        </svg>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[9px] text-zinc-500">active branch highlighted</span>
          <button type="button" onClick={() => cameraResetRef.current?.()} className="rounded border border-cyan-400/25 px-1.5 py-1 text-[9px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/10">Reset view</button>
        </div>
      </div>
      {selectedNode ? (
        <div className="absolute right-3 top-3 w-56 rounded-lg border border-cyan-400/30 bg-zinc-950/90 p-3 text-[10px] text-zinc-300 shadow-xl backdrop-blur-md light:bg-white/90 light:text-slate-700">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-bold text-cyan-200 light:text-cyan-800">{selectedNode.san ?? "root"}</span>
            <span className="font-mono text-amber-200 light:text-amber-700">{selectedNode.score === null ? "—" : (selectedNode.score / 100).toFixed(2)}</span>
          </div>
          <div className="mt-1 text-zinc-500">{selectedNode.explanation}</div>
          {mctsNode ? <div className="mt-2 grid grid-cols-2 gap-1 border-y border-cyan-400/15 py-2 font-mono text-[9px]"><span className="text-zinc-500">phase</span><span className="text-right text-cyan-200">{mctsNode.phase}</span><span className="text-zinc-500">visits</span><span className="text-right text-cyan-200">{mctsNode.visits}</span><span className="text-zinc-500">win rate</span><span className="text-right text-emerald-200">{(mctsNode.winRate * 100).toFixed(0)}%</span><span className="text-zinc-500">UCT</span><span className="text-right text-amber-200">{Number.isFinite(mctsNode.exploration) ? mctsNode.exploration.toFixed(2) : "∞"}</span></div> : null}
          <div className="mt-3 border-t border-zinc-800 pt-2 light:border-slate-200">
            <div className="mb-1 uppercase tracking-wider text-zinc-500">Heuristic breakdown</div>
            <div className="space-y-1 font-mono">
              <div className="flex justify-between"><span className="text-zinc-500">material</span><span className="text-cyan-200 light:text-cyan-800">{selectedNode.heuristics.material}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">positional</span><span className="text-emerald-200 light:text-emerald-800">{selectedNode.heuristics.positional}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">king safety</span><span className="text-amber-200 light:text-amber-800">{selectedNode.heuristics.kingSafety}</span></div>
            </div>
            <div className="mt-2 text-[9px] text-zinc-500">Hover or click any node to inspect its weighted evaluation.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
