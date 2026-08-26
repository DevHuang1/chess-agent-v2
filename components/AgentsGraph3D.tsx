"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { MinimaxSearchNode, MinimaxTrace } from "@/lib/minimax";
import type { MctsSearchNode } from "@/lib/mcts";
import { AgentStrategy, AgentTrace } from "@/lib/agents";

type AgentsGraph3DProps = {
  agents: AgentTrace[];
  algorithm?: "minimax" | "mcts";
  activeIndexes: number[];
  selected: { agentId: AgentStrategy; nodeId: string } | null;
  highlightedNodeIds?: ReadonlySet<string>;
  highlightAgentId?: AgentStrategy;
  highlightFilterActive?: boolean;
  onSelectNode: (agentId: AgentStrategy, nodeId: string) => void;
};

type LayoutNode = MinimaxSearchNode & {
  graphX: number;
  graphY: number;
  graphZ: number;
};
type PlacedNode = { agentId: AgentStrategy; key: string; node: LayoutNode };

type OverviewNode = {
  node: MinimaxSearchNode;
  x: number;
  y: number;
};

type OverviewEdge = {
  from: OverviewNode;
  to: OverviewNode;
};

const COLUMN_SPACING = 10.5;

function isMctsNode(
  node: MinimaxSearchNode | MctsSearchNode | null,
): node is MctsSearchNode {
  return Boolean(
    node &&
    "phase" in node &&
    "visits" in node &&
    "winRate" in node &&
    "exploration" in node,
  );
}

function createParticleField(agentColorHex: number): THREE.Points {
  const count = 14;
  const positions = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, () => new THREE.Vector3());
  const phases = Array.from(
    { length: count },
    () => Math.random() * Math.PI * 2,
  );
  for (let index = 0; index < count; index++) {
    const offset = index * 3;
    const angle = phases[index];
    const radius = 0.18 + Math.random() * 0.16;
    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] = (Math.random() - 0.5) * 0.18;
    positions[offset + 2] = Math.sin(angle) * radius;
    velocities[index].set(
      Math.cos(angle) * 0.08,
      0.12 + Math.random() * 0.08,
      Math.sin(angle) * 0.08,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: agentColorHex,
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
  particles.userData.baseColor = agentColorHex;
  return particles;
}

function centerLayerOnActive(
  layer: MinimaxSearchNode[],
  activeId: string | undefined,
): MinimaxSearchNode[] {
  const activeIndex = layer.findIndex((node) => node.id === activeId);
  if (activeIndex < 0) return layer;
  const shift = Math.floor(layer.length / 2) - activeIndex;
  return layer.map(
    (_, index) => layer[(index - shift + layer.length) % layer.length],
  );
}

function makeLayout(
  trace: MinimaxTrace,
  focusIndex: number,
  highlightedNodeIds?: ReadonlySet<string>,
): LayoutNode[] {
  const active = trace.nodes[focusIndex] ?? trace.nodes[0];
  const byId = new Map(trace.nodes.map((node) => [node.id, node]));
  const focusIds = new Set<string>();
  let cursor: MinimaxSearchNode | undefined = active;
  while (cursor) {
    focusIds.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const nearby = trace.nodes.slice(
    Math.max(0, focusIndex - 18),
    focusIndex + 19,
  );
  const principal = trace.nodes
    .filter((node) => node.status === "principal")
    .slice(0, 12);
  const highlighted = highlightedNodeIds
    ? trace.nodes.filter((node) => highlightedNodeIds.has(node.id)).slice(0, 24)
    : [];
  const candidates = [
    ...focusIds,
    ...nearby.map((node) => node.id),
    ...principal.map((node) => node.id),
    ...highlighted.map((node) => node.id),
  ]
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
    const activeFirst = layer.filter(
      (node) => node.id === active?.id || node.status === "principal",
    );
    const remaining = layer.filter(
      (node) => node.id !== active?.id && node.status !== "principal",
    );
    const compactLayer = centerLayerOnActive(
      [...activeFirst, ...remaining].slice(0, 12),
      active?.id,
    );
    const spacing = compactLayer.length > 8 ? 1.0 : 1.15;
    compactLayer.forEach((node, index) => {
      result.push({
        ...node,
        graphX: (index - (compactLayer.length - 1) / 2) * spacing,
        graphY: 2.9 - depth * 1.35,
        graphZ: (depth % 2 === 0 ? 0.35 : -0.35) + ((index % 3) - 1) * 0.22,
      });
    });
  }
  const relaxed = relaxLayout(result);
  if (relaxed.length === 0) return relaxed;
  const minX = Math.min(...relaxed.map((node) => node.graphX));
  const maxX = Math.max(...relaxed.map((node) => node.graphX));
  const minY = Math.min(...relaxed.map((node) => node.graphY));
  const maxY = Math.max(...relaxed.map((node) => node.graphY));
  const minZ = Math.min(...relaxed.map((node) => node.graphZ));
  const maxZ = Math.max(...relaxed.map((node) => node.graphZ));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  return relaxed.map((node) => ({
    ...node,
    graphX: node.graphX - centerX,
    graphY: node.graphY - centerY,
    graphZ: node.graphZ - centerZ,
  }));
}

function relaxLayout(nodes: LayoutNode[]): LayoutNode[] {
  const positions = new Map(
    nodes.map((node) => [
      node.id,
      new THREE.Vector3(node.graphX, node.graphY, node.graphZ),
    ]),
  );
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
      for (
        let otherIndex = index + 1;
        otherIndex < nodes.length;
        otherIndex++
      ) {
        const other = nodes[otherIndex];
        if (other.depth !== node.depth) continue;
        const otherPosition = positions.get(other.id);
        const otherForce = forces.get(other.id);
        if (!otherPosition || !otherForce) continue;
        const delta = position.clone().sub(otherPosition);
        delta.y = 0;
        const distance = Math.max(0.001, delta.length());
        if (distance >= collisionRadius) continue;
        const push = delta
          .normalize()
          .multiplyScalar((collisionRadius - distance) * 0.42);
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
          const horizontal = new THREE.Vector3(
            parentPosition.x - position.x,
            0,
            parentPosition.z - position.z,
          );
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
    return {
      ...node,
      graphX: position.x,
      graphY: position.y,
      graphZ: position.z,
    };
  });
}

export default function AgentsGraph3D({
  agents,
  algorithm = "minimax",
  activeIndexes,
  selected,
  highlightedNodeIds,
  highlightAgentId,
  highlightFilterActive = false,
  onSelectNode,
}: AgentsGraph3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const graphGroupRef = useRef<THREE.Group | null>(null);
  const nodeMeshesRef = useRef(new Map<string, THREE.Mesh>());
  const particleSystemsRef = useRef(new Map<string, THREE.Points>());
  const glowRingsRef = useRef(new Map<string, THREE.Mesh>());
  const placedLayoutRef = useRef<PlacedNode[]>([]);
  const activeNodeKeysRef = useRef<ReadonlySet<string>>(new Set());
  const selectedNodeKeyRef = useRef<string | null>(null);
  const hoveredNodeKeyRef = useRef<string | null>(null);
  const highlightedNodeIdsRef = useRef<ReadonlySet<string>>(new Set());
  const highlightAgentIdRef = useRef<AgentStrategy | undefined>(undefined);
  const highlightFilterActiveRef = useRef(false);
  const activeIndexesRef = useRef<number[]>([]);
  const onSelectNodeRef = useRef(onSelectNode);
  const cameraResetRef = useRef<(() => void) | null>(null);
  const cameraZoomRef = useRef<((delta: number) => void) | null>(null);
  const cameraPanRef = useRef<((x: number, y: number) => void) | null>(null);
  const lastFramedAgentsRef = useRef<unknown>(null);
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string | null>(null);
  const [zoomRadius, setZoomRadius] = useState(18);

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
    activeIndexesRef.current = activeIndexes;
    activeNodeKeysRef.current = new Set(
      agents
        .map(
          (entry, index) =>
            `${entry.agent.id}::${entry.trace.nodes[activeIndexes[index] % Math.max(1, entry.trace.nodes.length)]?.id}`,
        )
        .filter((key): key is string => Boolean(key.split("::")[1])),
    );
    selectedNodeKeyRef.current = selected
      ? `${selected.agentId}::${selected.nodeId}`
      : null;
    highlightedNodeIdsRef.current = highlightedNodeIds ?? new Set();
    highlightAgentIdRef.current = highlightAgentId;
    highlightFilterActiveRef.current = highlightFilterActive;
  }, [
    agents,
    activeIndexes,
    selected,
    highlightedNodeIds,
    highlightAgentId,
    highlightFilterActive,
    onSelectNode,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    container.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b16);
    scene.fog = new THREE.Fog(0x070b16, 40, 90);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
    camera.position.set(0, 1.75, 42);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearAlpha(0);
    container.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0x9fb9ff, 1.1));
    const key = new THREE.DirectionalLight(0x67e8f9, 2.1);
    key.position.set(4, 8, 8);
    scene.add(key);
    const rim = new THREE.PointLight(0xfbbf24, 1.2, 50);
    rim.position.set(-5, 1, 4);
    scene.add(rim);
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
    let radius = 42;
    let panX = 0;
    let panY = 0;
    let targetTheta = 0;
    let targetPhi = 0.08;
    let targetRadius = 42;
    let targetPanX = 0;
    let targetPanY = 0;

    const clampPan = (x: number, y: number) => {
      targetPanX = THREE.MathUtils.clamp(x, -22, 22);
      targetPanY = THREE.MathUtils.clamp(y, -8, 8);
    };

    const onPointerDown = (event: PointerEvent) => {
      isDragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(
        Array.from(nodeMeshesRef.current.values()),
      );
      const key = hit[0]?.object.userData.nodeKey as string | undefined;
      if (key !== hoveredNodeKeyRef.current) {
        hoveredNodeKeyRef.current = key ?? null;
        setHoveredNodeKey(key ?? null);
      }
      if (!isDragging) return;
      targetTheta -= (event.clientX - lastX) * 0.008;
      targetPhi = THREE.MathUtils.clamp(
        targetPhi + (event.clientY - lastY) * 0.006,
        -0.75,
        0.85,
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(
        Array.from(nodeMeshesRef.current.values()),
      );
      const key = hit[0]?.object.userData.nodeKey as string | undefined;
      if (key) {
        const [agentId, nodeId] = key.split("::");
        onSelectNodeRef.current(agentId as AgentStrategy, nodeId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      targetRadius = THREE.MathUtils.clamp(
        targetRadius + event.deltaY * 0.012,
        6,
        90,
      );
      setZoomRadius(targetRadius);
    };
    const setTargetRadius = (nextRadius: number) => {
      targetRadius = THREE.MathUtils.clamp(nextRadius, 6, 90);
      setZoomRadius(targetRadius);
    };
    const frameToLayout = () => {
      const placed = placedLayoutRef.current;
      if (placed.length === 0) return;
      const maxX = Math.max(
        ...placed.map((entry) => Math.abs(entry.node.graphX)),
      );
      const maxY = Math.max(
        ...placed.map((entry) => Math.abs(entry.node.graphY)),
      );
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const tanH = tanV * camera.aspect;
      const targetFill = 0.8;
      const fitX = maxX / (targetFill * tanH);
      const fitY = maxY / (targetFill * tanV);
      targetTheta = 0;
      targetPhi = 0.08;
      theta = 0;
      phi = 0.08;
      clampPan(0, 0);
      panX = 0;
      panY = 0;
      targetRadius = Math.max(fitX, fitY);
      radius = targetRadius;
      setZoomRadius(targetRadius);
    };
    cameraZoomRef.current = (delta) => setTargetRadius(targetRadius + delta);
    cameraPanRef.current = (x, y) => clampPan(targetPanX + x, targetPanY + y);
    cameraResetRef.current = frameToLayout;
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
      const kOrbit = Math.min(1, delta * 8);
      const kMove = Math.min(1, delta * 6);
      theta += (targetTheta - theta) * kOrbit;
      phi += (targetPhi - phi) * kOrbit;
      radius += (targetRadius - radius) * kMove;
      panX += (targetPanX - panX) * kMove;
      panY += (targetPanY - panY) * kMove;
      camera.position.set(
        panX + Math.sin(theta) * Math.cos(phi) * radius,
        panY + 1.5 + Math.sin(phi) * radius * 0.38,
        Math.cos(theta) * Math.cos(phi) * radius,
      );
      camera.lookAt(panX, panY, 0);
      const activeKeys = activeNodeKeysRef.current;
      const selectedKey = selectedNodeKeyRef.current;
      const hoveredKey = hoveredNodeKeyRef.current;
      const highlightIds = highlightedNodeIdsRef.current;
      const highlightAgent = highlightAgentIdRef.current;
      const filterActive = highlightFilterActiveRef.current;
      for (const [nodeKey, mesh] of nodeMeshesRef.current) {
        const isActive = activeKeys.has(nodeKey);
        const isSelected = selectedKey === nodeKey;
        const isHovered = hoveredKey === nodeKey;
        const [agentId, nodeId] = nodeKey.split("::");
        const isMatch = highlightAgent === agentId && highlightIds.has(nodeId);
        const isDimmedByFilter =
          filterActive &&
          highlightAgent === agentId &&
          !isMatch &&
          !isActive &&
          !isSelected;
        const pulse =
          isActive || isSelected || isMatch
            ? 1 + Math.sin(now * 0.006) * 0.15
            : 1;
        const targetScale = isSelected
          ? 1.5 * pulse
          : isActive
            ? 1.35 * pulse
            : isMatch
              ? 1.12 * pulse
              : 1;
        mesh.scale.x += (targetScale - mesh.scale.x) * Math.min(1, delta * 9);
        mesh.scale.y = mesh.scale.x;
        mesh.scale.z = mesh.scale.x;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = isSelected
          ? 1.8
          : isActive
            ? 1.35
            : isMatch
              ? 0.95
              : isHovered
                ? 0.85
                : 0.42;
        material.opacity =
          isSelected || isActive
            ? 1
            : isDimmedByFilter
              ? 0.12
              : ((mesh.userData.baseOpacity as number) ?? 0.94);

        const particles = particleSystemsRef.current.get(nodeKey);
        if (particles) {
          const particleMaterial = particles.material as THREE.PointsMaterial;
          const particleTarget = isSelected
            ? 0.95
            : isActive
              ? 0.78
              : isHovered
                ? 0.42
                : 0.04;
          particleMaterial.opacity +=
            (particleTarget - particleMaterial.opacity) *
            Math.min(1, delta * 8);
          particles.rotation.y += delta * (isActive || isSelected ? 1.8 : 0.35);
          particles.rotation.x =
            Math.sin(
              now * 0.0014 + ((particles.userData.phaseOffset as number) ?? 0),
            ) * 0.16;
          const positionAttribute = particles.geometry.getAttribute(
            "position",
          ) as THREE.BufferAttribute;
          const velocities = particles.userData.velocities as THREE.Vector3[];
          for (let index = 0; index < velocities.length; index++) {
            const currentY =
              positionAttribute.getY(index) + velocities[index].y * delta;
            positionAttribute.setY(index, currentY > 0.62 ? -0.2 : currentY);
          }
          positionAttribute.needsUpdate = true;
        }

        const ring = glowRingsRef.current.get(nodeKey);
        if (ring) {
          const ringMaterial = ring.material as THREE.MeshBasicMaterial;
          const ringTarget = isSelected
            ? 0.82
            : isActive
              ? 0.58
              : isHovered
                ? 0.28
                : 0.04;
          ringMaterial.opacity +=
            (ringTarget - ringMaterial.opacity) * Math.min(1, delta * 10);
          ring.rotation.z += delta * (isActive || isSelected ? 1.2 : 0.22);
          const ringScale = isSelected
            ? 1.18 + Math.sin(now * 0.006) * 0.08
            : isActive
              ? 1.08 + Math.sin(now * 0.005) * 0.06
              : 1;
          ring.scale.setScalar(ringScale);
        }
      }
      for (const child of graphGroup.children) {
        if (!(child instanceof THREE.Line)) continue;
        const edgeMaterial = child.material as THREE.LineBasicMaterial;
        const hotEdge = Boolean(child.userData.hotEdge);
        const targetOpacity = hotEdge
          ? 0.86 + Math.sin(now * 0.007) * 0.12
          : ((child.userData.baseOpacity as number) ?? 0.42);
        edgeMaterial.opacity +=
          (targetOpacity - edgeMaterial.opacity) * Math.min(1, delta * 9);
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

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      cameraResetRef.current = null;
      cameraZoomRef.current = null;
      cameraPanRef.current = null;
      lastFramedAgentsRef.current = null;
      renderer.domElement.remove();
      graphGroup.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Points))
          return;
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material))
          material.forEach((entry) => entry.dispose());
        else material.dispose();
      });
      scene.clear();
    };
  }, []);

  useEffect(() => {
    const group = graphGroupRef.current;
    if (!group) return;
    group.traverse((object) => {
      if (
        !(
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.Points
        )
      )
        return;
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    });
    group.clear();
    nodeMeshesRef.current.clear();
    particleSystemsRef.current.clear();
    glowRingsRef.current.clear();
    if (!agents || agents.length === 0) {
      placedLayoutRef.current = [];
      return;
    }
    const placed: PlacedNode[] = [];
    agents.forEach((entry, agentIndex) => {
      const layout = makeLayout(
        entry.trace,
        activeIndexesRef.current[agentIndex] ?? 0,
        highlightedNodeIdsRef.current,
      );
      const offsetX = (agentIndex - (agents.length - 1) / 2) * COLUMN_SPACING;
      for (const node of layout) {
        placed.push({
          agentId: entry.agent.id,
          key: `${entry.agent.id}::${node.id}`,
          node: { ...node, graphX: node.graphX + offsetX },
        });
      }
    });
    placedLayoutRef.current = placed;
    if (lastFramedAgentsRef.current !== agents && cameraResetRef.current) {
      lastFramedAgentsRef.current = agents;
      cameraResetRef.current();
    }
    const byKey = new Map(placed.map((entry) => [entry.key, entry]));
    // Active/selected keys are maintained by the ref-sync effect (which runs
    // on every animation tick), so this rebuild only needs to run when the
    // trace itself changes — not several times per second during playback.
    const activeKeys = activeNodeKeysRef.current;
    const selectedKey = selectedNodeKeyRef.current;

    for (const entry of placed) {
      const agentColor =
        entry.agentId === "materialist"
          ? 0xf472b6
          : entry.agentId === "positional"
            ? 0x34d399
            : entry.agentId === "defender"
              ? 0x38bdf8
              : 0xfbbf24;
      const node = entry.node;
      for (const childId of node.children) {
        const childEntry = byKey.get(`${entry.agentId}::${childId}`);
        if (!childEntry) continue;
        const points = [
          new THREE.Vector3(node.graphX, node.graphY, node.graphZ),
          new THREE.Vector3(
            childEntry.node.graphX,
            childEntry.node.graphY,
            childEntry.node.graphZ,
          ),
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const hotEdge =
          activeKeys.has(entry.key) ||
          activeKeys.has(childEntry.key) ||
          selectedKey === entry.key ||
          selectedKey === childEntry.key;
        const edge = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: agentColor,
            transparent: true,
            opacity: hotEdge ? 0.72 : 0.3,
          }),
        );
        edge.userData.hotEdge = hotEdge;
        edge.userData.baseOpacity = 0.3;
        group.add(edge);
      }
    }
    for (const entry of placed) {
      const agentColor =
        entry.agentId === "materialist"
          ? 0xf472b6
          : entry.agentId === "positional"
            ? 0x34d399
            : entry.agentId === "defender"
              ? 0x38bdf8
              : 0xfbbf24;
      const node = entry.node;
      const pruned = node.status === "pruned";
      const baseOpacity = pruned ? 0.4 : 0.94;
      const material = new THREE.MeshStandardMaterial({
        color: agentColor,
        emissive: agentColor,
        emissiveIntensity: 0.42,
        metalness: 0.25,
        roughness: 0.32,
        transparent: true,
        opacity: baseOpacity,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(node.depth === 0 ? 0.3 : 0.2, 20, 16),
        material,
      );
      mesh.position.set(node.graphX, node.graphY, node.graphZ);
      mesh.userData.nodeId = node.id;
      mesh.userData.nodeKey = entry.key;
      mesh.userData.baseOpacity = baseOpacity;
      nodeMeshesRef.current.set(entry.key, mesh);
      group.add(mesh);

      const isHot = activeKeys.has(entry.key) || selectedKey === entry.key;
      if (isHot || node.status === "principal" || pruned) {
        const particles = createParticleField(agentColor);
        particles.position.copy(mesh.position);
        particles.userData.phaseOffset = Math.random() * Math.PI * 2;
        particleSystemsRef.current.set(entry.key, particles);
        group.add(particles);
      }

      const glowMaterial = new THREE.MeshBasicMaterial({
        color: agentColor,
        transparent: true,
        opacity: isHot ? 0.56 : 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const glowRing = new THREE.Mesh(
        new THREE.RingGeometry(
          node.depth === 0 ? 0.46 : 0.32,
          node.depth === 0 ? 0.52 : 0.37,
          28,
        ),
        glowMaterial,
      );
      glowRing.position.copy(mesh.position);
      glowRing.rotation.x = Math.PI / 2;
      glowRing.userData.nodeKey = entry.key;
      glowRingsRef.current.set(entry.key, glowRing);
      group.add(glowRing);
    }
  }, [agents]);

  const agentById = useMemo(
    () => new Map(agents.map((entry) => [entry.agent.id, entry])),
    [agents],
  );
  const hovered = useMemo(() => {
    if (!hoveredNodeKey) return null;
    const [agentId, nodeId] = hoveredNodeKey.split("::");
    const entry = agentById.get(agentId as AgentStrategy);
    if (!entry) return null;
    return {
      agent: entry.agent,
      node: entry.trace.nodes.find((node) => node.id === nodeId) ?? null,
    };
  }, [hoveredNodeKey, agentById]);
  const selectedInfo = useMemo(() => {
    if (!selected) return null;
    const entry = agentById.get(selected.agentId);
    if (!entry) return null;
    const node =
      entry.trace.nodes.find((node) => node.id === selected.nodeId) ?? null;
    return node ? { agent: entry.agent, node } : null;
  }, [selected, agentById]);
  const detail = useMemo(() => {
    const candidate = selectedInfo ?? hovered;
    return candidate && candidate.node
      ? { agent: candidate.agent, node: candidate.node }
      : null;
  }, [selectedInfo, hovered]);
  const mctsNode = detail
    ? isMctsNode(detail.node)
      ? detail.node
      : null
    : null;

  const overviews = useMemo(
    () =>
      agents.map((entry, agentIndex) => {
        const active =
          entry.trace.nodes[
            activeIndexes[agentIndex] % Math.max(1, entry.trace.nodes.length)
          ] ?? entry.trace.nodes[0];
        const source = entry.trace.nodes.slice(0, 64);
        if (active && !source.some((node) => node.id === active.id))
          source.push(active);
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
              x: 8 + (index / maxLayer) * 80,
              y: 10 + (depth / layerCount) * 58,
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
        return {
          agentId: entry.agent.id,
          color: entry.agent.color,
          activeId: active?.id,
          nodes,
          edges,
        };
      }),
    [agents, activeIndexes],
  );

  return (
    <div className="ai-graph-shell relative h-[clamp(320px,52vh,460px)] overflow-hidden rounded-xl border border-cyan-500/25 bg-[#070b16] shadow-2xl">
      <div
        ref={containerRef}
        className="absolute inset-0"
        aria-label="3D minimax decision tree"
      />
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-zinc-700/70 bg-black/45 px-3 py-2 text-[10px] text-zinc-300 backdrop-blur-sm">
        <div className="font-semibold text-cyan-200">
          {algorithm === "mcts"
            ? "3D MCTS rollout graph"
            : "3D minimax decision graph"}
        </div>
        <div className="mt-1 text-zinc-500">
          4 agents searching the same position in parallel · drag to orbit ·
          wheel to zoom
        </div>
      </div>
      <div
        className="absolute left-1/2 top-3 hidden -translate-x-1/2 items-center gap-1 rounded-lg border border-cyan-400/25 bg-zinc-950/85 p-1.5 shadow-xl backdrop-blur-md md:flex"
        aria-label="3D graph navigation controls"
      >
        <button
          type="button"
          aria-label="Zoom out graph"
          onClick={() => cameraZoomRef.current?.(2)}
          className="rounded border border-cyan-400/25 px-2 py-1 text-xs font-bold text-cyan-200 transition-colors hover:bg-cyan-400/10"
        >
          −
        </button>
        <span
          className="min-w-14 text-center font-mono text-[10px] text-cyan-200"
          aria-live="polite"
        >
          {zoomRadius.toFixed(1)}×
        </span>
        <button
          type="button"
          aria-label="Zoom in graph"
          onClick={() => cameraZoomRef.current?.(-2)}
          className="rounded border border-cyan-400/25 px-2 py-1 text-xs font-bold text-cyan-200 transition-colors hover:bg-cyan-400/10"
        >
          +
        </button>
        <span className="mx-0.5 h-4 w-px bg-zinc-700" />
        <button
          type="button"
          aria-label="Pan graph left"
          onClick={() => cameraPanRef.current?.(-0.65, 0)}
          className="rounded border border-zinc-700 px-1.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Pan graph up"
          onClick={() => cameraPanRef.current?.(0, 0.5)}
          className="rounded border border-zinc-700 px-1.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Pan graph down"
          onClick={() => cameraPanRef.current?.(0, -0.5)}
          className="rounded border border-zinc-700 px-1.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          ↓
        </button>
        <button
          type="button"
          aria-label="Pan graph right"
          onClick={() => cameraPanRef.current?.(0.65, 0)}
          className="rounded border border-zinc-700 px-1.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          →
        </button>
        <button
          type="button"
          aria-label="Reset graph camera"
          onClick={() => cameraResetRef.current?.()}
          className="ml-0.5 rounded border border-amber-400/25 px-2 py-1 text-[10px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/10"
        >
          Reset
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 hidden flex-wrap gap-1.5 text-[9px] sm:flex">
        {agents.map((entry) => (
          <span
            key={entry.agent.id}
            className="flex items-center gap-1 rounded border border-zinc-700/70 bg-zinc-950/70 px-1.5 py-1"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.agent.color }}
            />
            <span className="text-zinc-300">{entry.agent.name}</span>
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 flex max-w-[240px] flex-col gap-1 rounded-lg border border-cyan-300/40 bg-cyan-950/75 px-2.5 py-2 text-[10px] shadow-lg backdrop-blur-sm">
        <div className="font-semibold uppercase tracking-wider text-cyan-200">
          Agents in parallel
        </div>
        {agents.map((entry, index) => {
          const node =
            entry.trace.nodes[
              activeIndexes[index] % Math.max(1, entry.trace.nodes.length)
            ] ?? null;
          return (
            <div
              key={entry.agent.id}
              className="flex items-center justify-between gap-2 font-mono"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: entry.agent.color }}
                />
                <span className="text-zinc-300">{entry.agent.name}</span>
              </span>
              <span className="text-white">{node?.san ?? "root"}</span>
            </div>
          );
        })}
      </div>
      <div
        className="absolute bottom-3 left-1/2 w-[min(420px,calc(100%-24px))] -translate-x-1/2 rounded-lg border border-cyan-400/25 bg-zinc-950/85 p-2 shadow-xl backdrop-blur-md"
        aria-label="AI Lab graph overview navigator"
      >
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[9px]">
          <span className="font-semibold uppercase tracking-wider text-cyan-200">
            Overview
          </span>
          <span className="font-mono text-zinc-500">
            4 agents · zoom {zoomRadius.toFixed(1)}×
          </span>
        </div>
        <svg
          viewBox="0 0 368 84"
          className="h-[84px] w-full rounded border border-cyan-400/10 bg-[#0a1120]"
          role="img"
          aria-label="Search tree overview"
        >
          {overviews.map((overview, column) => (
            <g key={overview.agentId} transform={`translate(${column * 92} 0)`}>
              {overview.edges.map((edge) => (
                <line
                  key={`${edge.from.node.id}-${edge.to.node.id}`}
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke={overview.color}
                  strokeWidth="0.6"
                  opacity="0.4"
                />
              ))}
              {overview.nodes.map((overviewNode) => {
                const isActive = overviewNode.node.id === overview.activeId;
                return (
                  <circle
                    key={overviewNode.node.id}
                    cx={overviewNode.x}
                    cy={overviewNode.y}
                    r={
                      isActive
                        ? 2.4
                        : overviewNode.node.status === "pruned"
                          ? 1.1
                          : 1.5
                    }
                    fill={overview.color}
                    stroke={isActive ? "#ffffff" : "none"}
                    strokeWidth={isActive ? 1 : 0}
                    opacity={isActive ? 1 : 0.72}
                  />
                );
              })}
            </g>
          ))}
        </svg>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[9px] text-zinc-500">
            each column = one agent searching in parallel
          </span>
          <button
            type="button"
            onClick={() => cameraResetRef.current?.()}
            className="rounded border border-cyan-400/25 px-1.5 py-1 text-[9px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/10"
          >
            Reset view
          </button>
        </div>
      </div>
      {detail ? (
        <div className="absolute right-3 top-3 w-56 max-w-[calc(100%-24px)] rounded-lg border border-cyan-400/30 bg-zinc-950/90 p-3 text-[10px] text-zinc-300 shadow-xl backdrop-blur-md light:bg-white/90 light:text-slate-700">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-mono text-sm font-bold text-cyan-200 light:text-cyan-800">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: detail.agent.color }}
              />
              {detail.node.san ?? "root"}
            </span>
            <span className="font-mono text-amber-200 light:text-amber-700">
              {detail.node.score === null
                ? "—"
                : (detail.node.score / 100).toFixed(2)}
            </span>
          </div>
          <div className="mt-1 text-zinc-500">{detail.node.explanation}</div>
          <div className="mt-1 font-mono text-[9px] text-zinc-400">
            {detail.agent.name} · {detail.agent.tagline}
          </div>
          {mctsNode ? (
            <div className="mt-2 grid grid-cols-2 gap-1 border-y border-cyan-400/15 py-2 font-mono text-[9px]">
              <span className="text-zinc-500">phase</span>
              <span className="text-right text-cyan-200">{mctsNode.phase}</span>
              <span className="text-zinc-500">visits</span>
              <span className="text-right text-cyan-200">
                {mctsNode.visits}
              </span>
              <span className="text-zinc-500">win rate</span>
              <span className="text-right text-emerald-200">
                {(mctsNode.winRate * 100).toFixed(0)}%
              </span>
              <span className="text-zinc-500">UCT</span>
              <span className="text-right text-amber-200">
                {Number.isFinite(mctsNode.exploration)
                  ? mctsNode.exploration.toFixed(2)
                  : "∞"}
              </span>
            </div>
          ) : null}
          <div className="mt-3 border-t border-zinc-800 pt-2 light:border-slate-200">
            <div className="mb-1 uppercase tracking-wider text-zinc-500">
              Heuristic breakdown
            </div>
            <div className="space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-zinc-500">material</span>
                <span className="text-cyan-200 light:text-cyan-800">
                  {detail.node.heuristics.material}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">positional</span>
                <span className="text-emerald-200 light:text-emerald-800">
                  {detail.node.heuristics.positional}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">king safety</span>
                <span className="text-amber-200 light:text-amber-800">
                  {detail.node.heuristics.kingSafety}
                </span>
              </div>
            </div>
            <div className="mt-2 text-[9px] text-zinc-500">
              Hover or click any node to inspect its weighted evaluation.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
