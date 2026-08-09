import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Intent } from "@exiled/protocol";
import {
  PASSIVE_TREE, canAllocate, canRefund, passiveLines, passiveNode, passiveTheme, startNodeId,
  type PassiveNode,
} from "@exiled/rules";
import { characterClass } from "@exiled/content-runtime";
import { DISPLAY, GOLD, PARCHMENT, SERIF } from "./InventoryPanel";
import { Divider, GOLD_DIM, MenuButton } from "../menu/frames";

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

/** How much of the tree is on screen at zoom 1. Tree units, see passives.ts. */
const VIEW = 1750;
// The whole web is 1600 units across, so anything under this is zooming out
// past the tree into empty field.
const ZOOM_MIN = 0.85;
const ZOOM_MAX = 3.2;
/**
 * Where it opens: close in, on this character's own door.
 *
 * The whole web at once is a picture of a tree rather than a thing to spend a
 * point in — PoE opens on your start for the same reason, and the wheel is one
 * scroll away either way.
 */
const OPEN_ZOOM = 1.9;

const RADIUS: Record<PassiveNode["kind"], number> = {
  start: 30, minor: 11, notable: 21, keystone: 24,
};

/** Taken, reachable, or out of reach — the three states a node is drawn in. */
type NodeState = "taken" | "open" | "far";

/**
 * Contrast is the whole readability of this screen, and the first pass had none:
 * an unallocated node at #241f18 against a translucent plate over a lit map was
 * invisible, so 200 of the 207 nodes simply were not there. PoE's tree dims what
 * you have not taken, it does not hide it — a dark disc inside a clearly visible
 * ring. The second pass over-corrected into flat mustard discs; what the
 * reference actually draws is a dark SOCKET inside a bronze ring, and only the
 * allocated path burns gold. Socket fill and ring stroke per state:
 */
const RING: Record<NodeState, string> = {
  taken: "#f4e2ac",
  open: "#a98d54",
  far: "#4e452f",
};

/**
 * The painted faces (`public/hud/passives/`, sliced by build_passive_textures.py
 * from codex-imagegen sheets): one ornate bronze FRAME per kind and one engraved
 * ICON per theme. State never swaps the art — `far` dims it and `taken` burns
 * gold around it, which is exactly how the reference keeps 200 unallocated nodes
 * readable without 200 more textures.
 */
const FRAME_SRC: Record<PassiveNode["kind"], string> = {
  minor: "/hud/passives/frame-minor.png",
  notable: "/hud/passives/frame-notable.png",
  keystone: "/hud/passives/frame-keystone.png",
  start: "/hud/passives/frame-start.png",
};
/** How far past the hit radius the frame art reaches. */
const FRAME_OVER: Record<PassiveNode["kind"], number> = {
  minor: 1.35, notable: 1.35, keystone: 1.4, start: 1.3,
};
const DIM = 0.42;

/**
 * The path an edge is drawn on, stopping at each node's RIM rather than its
 * centre — a line drawn to the centre shows through the painted face, and no
 * paint order fixes that while the frame's middle is transparent. Two minors of
 * one cluster ring their notable, so their link bends AROUND it as an arc of the
 * rosette's own circle — PoE's clusters read as rings because their chains are
 * arcs, and the same nodes joined by chords read as pentagons. Everything else
 * (spokes, bridges, rim, doors) stays a straight line.
 */
function edgePath(a: PassiveNode, b: PassiveNode): string {
  const ta = RADIUS[a.kind] + 2;
  const tb = RADIUS[b.kind] + 2;
  const m = /^(p\.\w+\.\d+)\.\d+$/.exec(a.id);
  const hub = m && b.id.startsWith(`${m[1]}.`) ? passiveNode(`${m[1]}.hub`) : undefined;
  if (hub && hub.id !== a.id && hub.id !== b.id) {
    const r = (Math.hypot(a.x - hub.x, a.y - hub.y) + Math.hypot(b.x - hub.x, b.y - hub.y)) / 2;
    let angA = Math.atan2(a.y - hub.y, a.x - hub.x);
    let angB = Math.atan2(b.y - hub.y, b.x - hub.x);
    // Shorter way round; the sign also says which way each end retreats.
    let d = angB - angA;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) * r > ta + tb) {
      const s = Math.sign(d);
      angA += (s * ta) / r;
      angB -= (s * tb) / r;
      const ax = hub.x + Math.cos(angA) * r;
      const ay = hub.y + Math.sin(angA) * r;
      const bx = hub.x + Math.cos(angB) * r;
      const by = hub.y + Math.sin(angB) * r;
      return `M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${d > 0 ? 1 : 0} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    }
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= ta + tb) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return `M ${(a.x + ux * ta).toFixed(1)} ${(a.y + uy * ta).toFixed(1)} L ${(b.x - ux * tb).toFixed(1)} ${(b.y - uy * tb).toFixed(1)}`;
}

/**
 * Every link once, not twice. Both ends name each other (the tree's links are
 * symmetric on purpose), so drawing them all would paint each line over
 * itself — invisible at rest, and visibly doubled the moment a line is
 * highlighted by alpha. Module scope: the tree is static content, so its
 * geometry never belongs to a component instance.
 */
const EDGES: readonly { a: PassiveNode; b: PassiveNode; d: string }[] = (() => {
  const seen = new Set<string>();
  const out: { a: PassiveNode; b: PassiveNode; d: string }[] = [];
  for (const node of PASSIVE_TREE) {
    for (const id of node.links) {
      const key = node.id < id ? `${node.id}|${id}` : `${id}|${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = passiveNode(id);
      if (other) out.push({ a: node, b: other, d: edgePath(node, other) });
    }
  }
  return out;
})();

/**
 * The web itself — two thousand SVG elements, and the reason this layer is a
 * memo: the panel re-renders on every pan step and hover move, and rebuilding
 * the whole constellation for a viewBox change is what stuttered. Everything
 * state-dependent that changes per POINTER (the hover ring, the tooltip) lives
 * outside; this layer changes only when a point is spent or the class differs.
 */
const TreeWeb = React.memo(function TreeWeb({ classId, allocated, onHover, onHoverEnd, onIntent }: {
  classId: string;
  allocated: readonly string[];
  onHover: (id: string, x: number, y: number) => void;
  onHoverEnd: () => void;
  onIntent?: (intent: Intent) => void;
}) {
  const taken = useMemo(() => new Set(allocated), [allocated]);
  const start = startNodeId(classId);
  const stateOf = (node: PassiveNode): NodeState => {
    if (node.id === start || taken.has(node.id)) return "taken";
    return canAllocate(classId, allocated, node.id) ? "open" : "far";
  };
  return (
    <>
      {/* The reference draws the web as HAIRLINES a shade above the field, and
          burns one thin bright path through where the points went — line weight
          is what separated the two, not just colour, and the old 2.5/5 widths
          read as a wireframe diagram instead of a constellation. */}
      {EDGES.map(({ a, b, d }, i) => {
        const lit = (taken.has(a.id) || a.id === start) && (taken.has(b.id) || b.id === start);
        return lit ? (
          <g key={i}>
            <path
              d={d} fill="none"
              stroke="#c99f4a" strokeWidth={9} opacity={0.28}
              filter="url(#passive-glow)"
            />
            <path
              d={d} fill="none"
              stroke="#ecd291" strokeWidth={3} opacity={0.95}
            />
          </g>
        ) : (
          <path
            key={i}
            d={d} fill="none"
            stroke="#54492f" strokeWidth={1.5} opacity={0.85}
          />
        );
      })}
      {PASSIVE_TREE.map((node) => {
        const state = stateOf(node);
        // Only asked of the handful of nodes actually taken, and only when the
        // allocation changed: TreeWeb is memoized, and this decides a cursor.
        const undo = state === "taken" && node.id !== start
          && canRefund(classId, allocated, node.id);
        const r = RADIUS[node.kind];
        const common = {
          fill: "transparent",
          stroke: "none",
          "data-state": state,
          style: { cursor: state === "open" || undo ? "pointer" : "default" },
          onMouseEnter: (e: React.MouseEvent) => onHover(node.id, e.clientX, e.clientY),
          onMouseMove: (e: React.MouseEvent) => onHover(node.id, e.clientX, e.clientY),
          onMouseLeave: onHoverEnd,
          onClick: () => {
            // A second click on a node you own is undo, which is the gesture PoE
            // itself uses. The door is not a node you bought and can never go
            // back, and a node holding a branch up refuses here as well as in the
            // sim — the click has to be silent rather than send an intent that
            // will be thrown away, or the tree flickers on every dead press.
            if (state === "taken") {
              if (node.id !== start && canRefund(classId, allocated, node.id)) {
                onIntent?.({ kind: "refundPassive", nodeId: node.id });
              }
              return;
            }
            if (state !== "open") return;
            onIntent?.({ kind: "allocatePassive", nodeId: node.id });
          },
        };
        const fh = r * FRAME_OVER[node.kind]; // frame half-span
        const ih = fh * 0.66; // icon half-span, inside the ring
        const theme = passiveTheme(node.id);
        return (
          <g key={node.id} opacity={state === "far" ? DIM : 1}>
            {/* Taken nodes glow; the painted art itself never changes state. */}
            {state === "taken" && (
              <circle cx={node.x} cy={node.y} r={r + 6} fill="#e8c368"
                opacity={0.4} filter="url(#passive-glow)" pointerEvents="none" />
            )}
            {/* A door is its class: the select screen's portrait, clipped
                into the laurel frame, so "where do I start" is a face. */}
            {node.kind === "start" && (
              <>
                <clipPath id={`passive-door-${node.id}`}>
                  <circle cx={node.x} cy={node.y} r={r * 0.94} />
                </clipPath>
                <image
                  href={characterClass(`class.${node.id.slice("p.start.".length)}`).portrait}
                  x={node.x - r} y={node.y - r} width={r * 2} height={r * 2}
                  clipPath={`url(#passive-door-${node.id})`}
                  preserveAspectRatio="xMidYMid slice"
                  pointerEvents="none"
                />
              </>
            )}
            {theme && (
              <image
                href={`/hud/passives/${theme}.png`}
                x={node.x - ih} y={node.y - ih} width={ih * 2} height={ih * 2}
                pointerEvents="none"
              />
            )}
            <image
              href={FRAME_SRC[node.kind]}
              x={node.x - fh} y={node.y - fh} width={fh * 2} height={fh * 2}
              pointerEvents="none"
            />
            {/* Allocation reads as a lit ring OVER the bronze, the reference's
                own move: gold burns around what you own. The HOVER ring is the
                panel's overlay, so a pointer never re-renders this layer. */}
            {state === "taken" && (
              <circle
                cx={node.x} cy={node.y} r={r}
                fill="none" stroke={RING.taken}
                strokeWidth={node.kind === "minor" ? 2 : 3}
                opacity={0.9} pointerEvents="none"
              />
            )}
            {/* The hit target carries the testid; the art is pointer-blind. */}
            {node.kind === "keystone" ? (
              <rect
                data-testid={`passive-node-${node.id}`}
                x={node.x - r} y={node.y - r} width={r * 2} height={r * 2}
                transform={`rotate(45 ${node.x} ${node.y})`}
                {...common}
              />
            ) : (
              <circle
                data-testid={`passive-node-${node.id}`}
                cx={node.x} cy={node.y} r={r}
                {...common}
              />
            )}
          </g>
        );
      })}
    </>
  );
});

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
  const [zoom, setZoom] = useState(OPEN_ZOOM);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const taken = useMemo(() => new Set(allocated), [allocated]);
  const start = startNodeId(classId);

  // Every opening starts at the door again, wherever the last one was left.
  // Panning away and closing it used to mean the next P showed empty field.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const door = passiveNode(start);
      setPan({ x: door?.x ?? 0, y: door?.y ?? 0 });
      setZoom(OPEN_ZOOM);
    }
    wasOpen.current = open;
  }, [open, start]);

  // Stable across pans and hovers, or the memo under them is a no-op.
  const onHover = useCallback((id: string, x: number, y: number) => setHover({ id, x, y }), []);
  const onHoverEnd = useCallback(() => setHover(null), []);

  if (!open) return null;

  const half = VIEW / (2 * zoom);
  const viewBox = `${pan.x - half} ${pan.y - half} ${half * 2} ${half * 2}`;
  const hovered = hover ? passiveNode(hover.id) : null;
  // The hover ring is the panel's own overlay: drawn here so a pointer move
  // repaints one circle, never the two-thousand-element web beneath it.
  const hot = hovered && (hovered.id === start || taken.has(hovered.id)
    || canAllocate(classId, allocated, hovered.id)) ? hovered : null;

  return (
    <div
      data-testid="passive-panel"
      style={{
        position: "absolute", inset: 0, zIndex: 4,
        pointerEvents: "auto",
        // Translucent, so the world is still visibly running behind it.
        // Near-opaque. The world kept rendering behind the first version and a
        // lit beach read straight through the plate, which put a sand-coloured
        // wash behind every node on the screen the tree needs contrast on.
        // Deep desaturated navy, not neutral black: the reference field is a
        // night sky, and the bronze rings only read warm against a cool ground.
        background: "radial-gradient(circle at 50% 45%, rgba(13,17,26,0.988), rgba(4,6,10,0.998))",
        fontFamily: SERIF, color: PARCHMENT,
        display: "flex", flexDirection: "column",
        userSelect: "none",
      }}
      onWheel={(e) => {
        setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
      }}
    >
      <Header
        classId={classId}
        points={points}
        allocatedCount={allocated.length}
        onRespec={() => onIntent?.({ kind: "respecPassives" })}
        onClose={onClose}
      />

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
        <defs>
          {/* Soft halo behind anything gold. Blur in tree units; the region has to
              be generous or the halo clips square at its edges. */}
          <filter id="passive-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <TreeWeb
          classId={classId}
          allocated={allocated}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
          onIntent={onIntent}
        />
        {hot && (hot.kind === "keystone" ? (
          <rect
            x={hot.x - RADIUS.keystone} y={hot.y - RADIUS.keystone}
            width={RADIUS.keystone * 2} height={RADIUS.keystone * 2}
            transform={`rotate(45 ${hot.x} ${hot.y})`}
            fill="none" stroke="#f4e2ac" strokeWidth={3}
            opacity={0.9} pointerEvents="none"
          />
        ) : (
          <circle
            cx={hot.x} cy={hot.y} r={RADIUS[hot.kind]}
            fill="none" stroke="#f4e2ac"
            strokeWidth={hot.kind === "minor" ? 2 : 3}
            opacity={0.9} pointerEvents="none"
          />
        ))}
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
          {/* Undo is only ever discovered if the tree says it is there. */}
          {taken.has(hovered.id) && canRefund(classId, allocated, hovered.id) && (
            <div style={{ color: "#9a9280", marginTop: "0.35vh" }}>Click again to refund.</div>
          )}
          {hovered.kind === "start" && (
            <div style={{ color: "#9a9280" }}>Where this class begins. Costs nothing.</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The band across the top of the tree, in the game's own panel voice rather than
 * in the browser's: the display face and the gilt of `menu/frames.tsx`, the same
 * plate buttons every other screen presses, and the filigree rule under it that
 * the Options window and the character sheet already stand on.
 *
 * The unspent points are the loudest thing on it on purpose. An unspent point is
 * power the player has EARNED and not taken yet (docs/09), so it gets the gold,
 * the numeral, and a slow breath of glow that stops the moment the last one is
 * spent — a counter reading 0 goes quiet and grey instead, because nothing is
 * owed and a pulsing zero is a nag with nothing behind it.
 */
function Header({
  classId, points, allocatedCount, onRespec, onClose,
}: {
  classId: string;
  points: number;
  allocatedCount: number;
  onRespec: () => void;
  onClose: () => void;
}): React.ReactElement {
  const owed = points > 0;
  return (
    <header
      style={{
        flex: "none",
        padding: "1.1vh 1.6vw 0",
        // A vault lit from above: the band is the top of the field, not a bar
        // pasted onto it, so it has no edge of its own and fades into the tree.
        background: "linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0.28) 60%, rgba(0,0,0,0))",
      }}
    >
      <style>
        {"@keyframes passive-points-breath{"
          + "0%,100%{text-shadow:0 0 0.6vh rgba(200,164,77,0.35),0 1px 2px rgba(0,0,0,0.9)}"
          + "50%{text-shadow:0 0 1.5vh rgba(240,205,120,0.85),0 1px 2px rgba(0,0,0,0.9)}}"}
      </style>
      <div
        style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
          gap: "1.2vw",
        }}
      >
        {/* Who is spending, and what they have spent so far. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.2vh" }}>
          <span
            style={{
              fontFamily: DISPLAY, fontSize: "1.35vh", letterSpacing: "0.18em",
              textTransform: "uppercase", color: GOLD,
              textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            }}
          >
            {characterClass(classId)?.name ?? "Exile"}
          </span>
          <span style={{ fontSize: "1.15vh", color: GOLD_DIM }}>
            {allocatedCount} passive{allocatedCount === 1 ? "" : "s"} allocated
          </span>
        </div>

        {/* The title, and under it the one number the screen is about. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3vh" }}>
          <span
            style={{
              fontFamily: DISPLAY, fontSize: "1.9vh", letterSpacing: "0.34em",
              textTransform: "uppercase", color: GOLD,
              // Indented by the tracking's trailing space, or the word sits left
              // of centre by half a letter and nothing looks square with it.
              textIndent: "0.34em",
              textShadow: "0 1px 3px rgba(0,0,0,0.95)",
            }}
          >
            Passive Tree
          </span>
          <span
            data-testid="passive-points"
            style={{
              fontFamily: DISPLAY, fontSize: "1.2vh", letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: owed ? "#f0cd78" : "#7d7768",
              animation: owed ? "passive-points-breath 2.6s ease-in-out infinite" : "none",
            }}
          >
            <span style={{ fontSize: "1.75vh", color: owed ? GOLD : "#7d7768" }}>{points}</span>
            {` point${points === 1 ? "" : "s"} unspent`}
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.7vw", justifyContent: "flex-end" }}>
          <MenuButton
            data-testid="passive-respec"
            height={30}
            style={{ minWidth: "9vw" }}
            disabled={allocatedCount === 0}
            title={allocatedCount === 0 ? "Nothing allocated to refund." : undefined}
            onClick={onRespec}
          >
            Refund All
          </MenuButton>
          <MenuButton
            data-testid="passive-close"
            height={30}
            style={{ minWidth: "7vw" }}
            onClick={onClose}
          >
            Close
          </MenuButton>
        </div>
      </div>
      <Divider style={{ marginTop: "0.9vh" }} />
    </header>
  );
}
