"use client";

import { useEffect, useRef, useState } from "react";
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

function makeLayout(trace: MinimaxTrace): LayoutNode[] {
  const visible = trace.nodes.slice(0, 80);
  const layers = new Map<number, MinimaxSearchNode[]>();
  for (const node of visible) {
    const layer = layers.get(node.depth) ?? [];
    layer.push(node);
    layers.set(node.depth, layer);
  }
  const result: LayoutNode[] = [];
  for (const [depth, layer] of layers) {
    const width = Math.max(1, layer.length - 1);
    layer.forEach((node, index) => {
      const row = index % Math.max(1, Math.ceil(layer.length / 3));
      const column = Math.floor(index / Math.max(1, Math.ceil(layer.length / 3)));
      result.push({
        ...node,
        graphX: ((row / Math.max(1, Math.ceil(layer.length / 3) - 1)) - 0.5) * Math.min(10, Math.max(4, layer.length * 0.42)),
        graphY: 3.5 - depth * 1.35,
        graphZ: (column - Math.max(0, Math.floor(width / 3))) * 1.35,
      });
    });
  }
  return result;
}

export default function MinimaxGraph3D({ trace, algorithm = "minimax", activeNodeIndex, selectedNodeId, onSelectNode }: MinimaxGraph3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const graphGroupRef = useRef<THREE.Group | null>(null);
  const nodeMeshesRef = useRef(new Map<string, THREE.Mesh>());
  const layoutRef = useRef<LayoutNode[]>([]);
  const hoveredNodeRef = useRef<string | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const activeNodeIndexRef = useRef(activeNodeIndex);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

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
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 1.5, 14);
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
    let radius = 14;
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
      radius = THREE.MathUtils.clamp(radius + event.deltaY * 0.012, 7, 24);
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
      camera.lookAt(0, 0.4, 0);
      graphGroup.rotation.y += delta * 0.035;
      for (const [nodeId, mesh] of nodeMeshesRef.current) {
        const isActive = layoutRef.current[activeNodeIndexRef.current]?.id === nodeId;
        const isSelected = selectedNodeIdRef.current === nodeId;
        const pulse = isActive || isSelected ? 1 + Math.sin(now * 0.006) * 0.15 : 1;
        mesh.scale.lerp(new THREE.Vector3(pulse, pulse, pulse), Math.min(1, delta * 9));
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = isSelected ? 1.05 : isActive ? 0.72 : 0.28;
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
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      graphGroup.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
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
      scene.clear();
    };
  }, []);

  useEffect(() => {
    const group = graphGroupRef.current;
    if (!group) return;
    group.clear();
    nodeMeshesRef.current.clear();
    if (!trace) {
      layoutRef.current = [];
      return;
    }
    const layout = makeLayout(trace);
    layoutRef.current = layout;
    const byId = new Map(layout.map((node) => [node.id, node]));
    const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.42 });
    for (const node of layout) {
      for (const childId of node.children) {
        const child = byId.get(childId);
        if (!child) continue;
        const points = [new THREE.Vector3(node.graphX, node.graphY, node.graphZ), new THREE.Vector3(child.graphX, child.graphY, child.graphZ)];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const edge = new THREE.Line(geometry, edgeMaterial.clone());
        group.add(edge);
      }
    }
    for (const node of layout) {
      const material = new THREE.MeshStandardMaterial({ color: nodeColor(node), emissive: nodeColor(node), emissiveIntensity: 0.28, metalness: 0.25, roughness: 0.32, transparent: true, opacity: node.status === "pruned" ? 0.58 : 0.94 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(node.depth === 0 ? 0.25 : 0.16, 18, 14), material);
      mesh.position.set(node.graphX, node.graphY, node.graphZ);
      mesh.userData.nodeId = node.id;
      nodeMeshesRef.current.set(node.id, mesh);
      group.add(mesh);
    }
  }, [trace]);

  const hoveredNode = trace?.nodes.find((node) => node.id === hoveredNodeId) ?? null;
  const selectedNode = trace?.nodes.find((node) => node.id === selectedNodeId) ?? hoveredNode;
  const mctsNode = isMctsNode(selectedNode) ? selectedNode : null;

  return (
    <div className="relative h-[410px] overflow-hidden rounded-xl border border-cyan-500/25 bg-[#070b16] shadow-2xl">
      <div ref={containerRef} className="absolute inset-0" aria-label="3D minimax decision tree" />
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-zinc-700/70 bg-black/45 px-3 py-2 text-[10px] text-zinc-300 backdrop-blur-sm">
        <div className="font-semibold text-cyan-200">{algorithm === "mcts" ? "3D MCTS rollout graph" : "3D minimax decision graph"}</div>
        <div className="mt-1 text-zinc-500">Drag to orbit · wheel to zoom · click a node</div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-[9px] text-zinc-400">
        <span className="rounded border border-amber-300/40 bg-amber-400/15 px-1.5 py-1 text-amber-200">PV</span>
        <span className="rounded border border-emerald-300/40 bg-emerald-400/15 px-1.5 py-1 text-emerald-200">evaluated</span>
        <span className="rounded border border-rose-300/40 bg-rose-400/15 px-1.5 py-1 text-rose-200">pruned</span>
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
