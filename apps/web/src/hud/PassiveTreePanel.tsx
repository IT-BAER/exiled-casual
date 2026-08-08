import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Intent } from "@exiled/protocol";
import {
  PASSIVE_TREE, canAllocate, passiveLines, passiveNode, startNodeId,
  type PassiveNode,
} from "@exiled/rules";
import { DISPLAY, GOLD, PARCHMENT, SERIF } from "./InventoryPanel";

/**
 * The passive tree, drawn the way `reference-screenshots/skill-tree.png` draws
 * one: a dark field, small round nodes gathered into clusters, a larger notable
 * at the middle of each, a diamond keystone at the end of a long run, and one
 * bright path burnt through the middle of it where the points went.
 *
 * SVG rather than the Babylon scene or a canvas. Two hundred circles and three
 * hundred lines is nothing to lay out, and SVG brings hit-testing, hover and a
 * scalable viewBox for free — a canvas would mean writing all three by hand to
 * get the same picture. The world keeps rendering behind it, which is also PoE's
 * behaviour and the reason the plate is translucent rather than opaque.
 *
 * The whole tree is CONTENT, so it is drawn from `@exiled/rules` directly and
 * only the allocation crosses the wire. What the sim sends back is the authority:
 * a click sends an intent and nothing changes until the snapshot says it did,
 * which is the same contract every other panel here works to.
 */

/** How much of the tree is on screen at rest. Tree units, see passives.ts. */
const VIEW = 1750;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.6;

const RADIUS: Record<PassiveNode["kind"], number> = {
  start: 26, minor: 9, notable: 17, keystone: 21,
};

/** Taken, reachable, or out of reach — the three states a node is drawn in. */
type NodeState = "taken" | "open" | "far";

const FILL: Record<NodeState, string> = {
  taken: "#e8c368",
  open: "#5d5647",
  far: "#241f18",
};
const STROKE: Record<NodeState, string> = {
  taken: "#fff0c0",
  open: "#8d8064",
  far: "#3a3227",
};

export interface PassiveTreePanelProps {
  open: boolean;
  classId: string;
  allocated: readonly string[];
  /** Points still to spend. */
  points: number;
  onIntent?: (intent: Intent) => void;
  onClose: () => void;
}

export function PassiveTreePanel({
  open, classId, allocated, points, onIntent, onClose,
}: PassiveTreePanelProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const taken = useMemo(() => new Set(allocated), [allocated]);
  const start = startNodeId(classId);

  /**
   * Every link once, not twice. Both ends name each other (the tree's links are
   * symmetric on purpose), so drawing them all would paint each line over
   * itself — invisible at rest, and visibly doubled the moment a line is
   * highlighted by alpha.
   */
  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: { a: PassiveNode; b: PassiveNode }[] = [];
    for (const node of PASSIVE_TREE) {
      for (const id of node.links) {
        const key = node.id < id ? `${node.id}|${id}` : `${id}|${node.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const other = passiveNode(id);
        if (other) out.push({ a: node, b: other });
      }
    }
    return out;
  }, []);

  const stateOf = useCallback((node: PassiveNode): NodeState => {
    if (node.id === start || taken.has(node.id)) return "taken";
    return canAllocate(classId, allocated, node.id) ? "open" : "far";
  }, [classId, allocated, taken, start]);

  if (!open) return null;

  const half = VIEW / (2 * zoom);
  const viewBox = `${pan.x - half} ${pan.y - half} ${half * 2} ${half * 2}`;
  const hovered = hover ? passiveNode(hover.id) : null;

  return (
    <div
      data-testid="passive-panel"
      style={{
        position: "absolute", inset: 0, zIndex: 4,
        pointerEvents: "auto",
        // Translucent, so the world is still visibly running behind it.
        background: "radial-gradient(circle at 50% 45%, rgba(10,12,16,0.86), rgba(4,5,7,0.96))",
        fontFamily: SERIF, color: PARCHMENT,
        display: "flex", flexDirection: "column",
        userSelect: "none",
      }}
      onWheel={(e) => {
        setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
      }}
    >
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "1.1vh 1.6vw", flex: "none",
          borderBottom: `1px solid ${GOLD}44`,
          background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0))",
        }}
      >
        <span style={{ fontFamily: DISPLAY, letterSpacing: "0.08em", color: GOLD, fontSize: "1.5vh" }}>
          PASSIVE TREE
        </span>
        <span data-testid="passive-points" style={{ fontSize: "1.4vh" }}>
          {points} point{points === 1 ? "" : "s"} unspent
        </span>
        <span style={{ display: "flex", gap: "0.8vw", alignItems: "center" }}>
          <button
            type="button"
            data-testid="passive-respec"
            onClick={() => onIntent?.({ kind: "respecPassives" })}
            disabled={allocated.length === 0}
            style={{
              font: "inherit", fontSize: "1.2vh", padding: "0.4vh 0.9vw",
              color: allocated.length === 0 ? "#6b6355" : PARCHMENT,
              background: "rgba(0,0,0,0.45)", border: `1px solid ${GOLD}55`,
              cursor: allocated.length === 0 ? "default" : "pointer",
            }}
          >
            Refund all
          </button>
          <button
            type="button"
            data-testid="passive-close"
            onClick={onClose}
            style={{
              font: "inherit", fontSize: "1.2vh", padding: "0.4vh 0.9vw",
              color: PARCHMENT, background: "rgba(0,0,0,0.45)", border: `1px solid ${GOLD}55`,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </span>
      </header>

      <svg
        data-testid="passive-svg"
        viewBox={viewBox}
        style={{ flex: 1, width: "100%", cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          // Screen pixels to tree units: the viewBox is `VIEW / zoom` across
          // however many pixels the element happens to be.
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const perPx = VIEW / zoom / Math.max(1, rect.height);
          setPan({ x: d.px - (e.clientX - d.x) * perPx, y: d.py - (e.clientY - d.y) * perPx });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}
      >
        {edges.map(({ a, b }, i) => {
          const lit = (taken.has(a.id) || a.id === start) && (taken.has(b.id) || b.id === start);
          return (
            <line
              key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={lit ? "#e8c368" : "#3b342a"}
              strokeWidth={lit ? 4 : 2}
              opacity={lit ? 0.95 : 0.5}
            />
          );
        })}
        {PASSIVE_TREE.map((node) => {
          const state = stateOf(node);
          const r = RADIUS[node.kind];
          const common = {
            fill: FILL[state],
            stroke: STROKE[state],
            strokeWidth: node.kind === "minor" ? 2 : 3,
            style: { cursor: state === "open" ? "pointer" : "default" },
            onMouseEnter: (e: React.MouseEvent) => setHover({ id: node.id, x: e.clientX, y: e.clientY }),
            onMouseMove: (e: React.MouseEvent) => setHover({ id: node.id, x: e.clientX, y: e.clientY }),
            onMouseLeave: () => setHover(null),
            onClick: () => {
              if (state !== "open") return;
              onIntent?.({ kind: "allocatePassive", nodeId: node.id });
            },
          };
          // A keystone is a diamond in both PoE trees, which is the whole reason
          // one is legible from across the map at this zoom.
          return node.kind === "keystone" ? (
            <rect
              key={node.id} data-testid={`passive-node-${node.id}`}
              x={node.x - r} y={node.y - r} width={r * 2} height={r * 2}
              transform={`rotate(45 ${node.x} ${node.y})`}
              {...common}
            />
          ) : (
            <circle
              key={node.id} data-testid={`passive-node-${node.id}`}
              cx={node.x} cy={node.y} r={r}
              {...common}
            />
          );
        })}
      </svg>

      {hovered && hover && (
        <div
          data-testid="passive-tooltip"
          style={{
            position: "fixed", left: hover.x + 16, top: hover.y + 12,
            maxWidth: "22vw", pointerEvents: "none",
            padding: "0.7vh 0.9vw",
            background: "rgba(6,6,8,0.94)", border: `1px solid ${GOLD}66`,
            fontSize: "1.25vh", lineHeight: 1.45,
          }}
        >
          <div style={{ fontFamily: DISPLAY, color: GOLD, marginBottom: "0.35vh" }}>
            {hovered.name}
          </div>
          {passiveLines(hovered).map((line, i) => (
            <div key={i} style={{ color: "#8aa6ff" }}>{line}</div>
          ))}
          {hovered.kind === "start" && (
            <div style={{ color: "#9a9280" }}>Where this class begins. Costs nothing.</div>
          )}
        </div>
      )}
    </div>
  );
}
