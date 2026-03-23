"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useGraph } from "@/hooks/use-knowledge";
import type { GraphEdge, GraphNode } from "@/types";

type PositionedNode = GraphNode & { x: number; y: number };

const width = 960;
const height = 640;

const sourceColors: Record<string, string> = {
  MANUAL: "#22c55e",
  EXTRACTED: "#a855f7",
  DISTILLED: "#3b82f6",
};

const relationStyles: Record<string, { dasharray?: string }> = {
  updates: {},
  extends: { dasharray: "4 4" },
  derives: { dasharray: "10 6" },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): PositionedNode[] {
  const positioned = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1);
    const radius = Math.min(width, height) * 0.28;
    return {
      ...node,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
    };
  });

  const positions = new Map(positioned.map((node) => [node.id, node]));

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const forces = new Map<string, { x: number; y: number }>(
      positioned.map((node) => [node.id, { x: 0, y: 0 }]),
    );

    for (let i = 0; i < positioned.length; i += 1) {
      for (let j = i + 1; j < positioned.length; j += 1) {
        const a = positioned[i];
        const b = positioned[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const repulsion = 1800 / (distance * distance);
        const fx = (dx / distance) * repulsion;
        const fy = (dy / distance) * repulsion;
        const forceA = forces.get(a.id)!;
        const forceB = forces.get(b.id)!;
        forceA.x += fx;
        forceA.y += fy;
        forceB.x -= fx;
        forceB.y -= fy;
      }
    }

    for (const edge of edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const attraction = (distance - 140) * 0.0035;
      const fx = dx * attraction;
      const fy = dy * attraction;
      const sourceForce = forces.get(source.id)!;
      const targetForce = forces.get(target.id)!;
      sourceForce.x += fx;
      sourceForce.y += fy;
      targetForce.x -= fx;
      targetForce.y -= fy;
    }

    for (const node of positioned) {
      const force = forces.get(node.id)!;
      node.x = clamp(node.x + force.x, 48, width - 48);
      node.y = clamp(node.y + force.y, 48, height - 48);
    }
  }

  return positioned;
}

export default function KnowledgeGraphPage() {
  const { graph, loading } = useGraph();
  const [hoveredNode, setHoveredNode] = useState<PositionedNode | null>(null);

  const laidOutNodes = useMemo(() => {
    if (!graph) return [];
    return layoutGraph(graph.nodes, graph.edges);
  }, [graph]);

  const nodeMap = useMemo(() => new Map(laidOutNodes.map((node) => [node.id, node])), [laidOutNodes]);

  if (loading) {
    return <div className="h-[640px] animate-pulse rounded-lg border border-white/[0.06] bg-neutral-950" />;
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <EmptyState
        title="No graph data"
        description="No graph data yet. The graph visualizes connections between knowledge entries — nodes represent memories, edges represent update/extend/derive relationships."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Knowledge Graph</h1>
          <p className="mt-1 text-sm text-neutral-500">SVG force layout of memory nodes and relation edges.</p>
        </div>
        <span className="rounded-full border border-white/[0.06] bg-neutral-950 px-3 py-1 text-sm text-neutral-300">
          {graph.total} nodes
        </span>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
        <p className="mb-4 text-sm text-neutral-500">
          Explore how memories connect over time through update, extension, and derivation relationships.
        </p>
        <div className="relative overflow-hidden rounded-lg bg-black">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-[640px] w-full">
            {graph.edges.map((edge, index) => {
              const source = nodeMap.get(edge.source);
              const target = nodeMap.get(edge.target);
              if (!source || !target) return null;
              const style = relationStyles[edge.relation] ?? { dasharray: "3 3" };
              return (
                <g key={`${edge.source}-${edge.target}-${index}`}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="#475569"
                    strokeWidth="1.5"
                    strokeDasharray={style.dasharray}
                    opacity="0.75"
                  />
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2}
                    fill="#64748b"
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {edge.relation}
                  </text>
                </g>
              );
            })}
            {laidOutNodes.map((node) => (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredNode(node)}
                onMouseLeave={() => setHoveredNode((current) => (current?.id === node.id ? null : current))}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="14"
                  fill={sourceColors[node.source] ?? "#94a3b8"}
                  stroke={node.is_static ? "#f8fafc" : "#0f172a"}
                  strokeWidth="2"
                />
              </g>
            ))}
          </svg>

          {hoveredNode && (
            <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-white/[0.06] bg-neutral-950/95 px-3 py-2 text-sm text-white shadow-lg">
              <div className="font-medium">{hoveredNode.topic}</div>
              <div className="mt-1 text-xs text-neutral-400">{hoveredNode.source}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
