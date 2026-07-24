import React, { useEffect, useRef } from "react";
import type { Snapshot } from "@exiled/protocol";
import { RARITY, SERIF } from "./ItemTooltip";
import { playDropSound } from "../audio/drop-sound";

/** Screen-space position of a world point, in CSS pixels of the canvas. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** False when the point is behind the camera or outside the depth range. */
  visible: boolean;
}

/** Projects a sim (x, y) ground position to canvas pixels. Supplied by App,
 *  which owns the Babylon camera. */
export type Projector = (x: number, y: number) => ScreenPoint;

/** Pixels the plate floats above the item's ground position. */
const PLATE_LIFT = 26;
/** Row pitch and horizontal tolerance used to unstack co-located plates. */
const PLATE_ROW = 22;
const PLATE_SPREAD_X = 120;

export interface LootLabelsProps {
  snapshot: Snapshot | null;
  /** Null until the Babylon scene exists; plates then hold their last position. */
  project: Projector | null;
  /** Clicking a plate walks to the drop and picks it up once in range. */
  onPick?: (entityId: number, x: number, y: number) => void;
}

/**
 * Persistent rarity-coloured name plate over every ground item, the way PoE
 * shows drops (poe2-screenshots/ground-loot*.png): a dark plate with a thin
 * rarity border and small-caps serif text in the rarity colour.
 *
 * Content is React's; position is not. The camera moves every frame while the
 * snapshot only changes at 30 Hz, so a rAF loop writes transforms straight to
 * the plate nodes instead of re-rendering the tree.
 */
export function LootLabels({ snapshot, project, onPick }: LootLabelsProps) {
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const positions = useRef(new Map<number, { x: number; y: number }>());
  /** Ids already announced. Null until the first snapshot, so items lying on the
   *  ground when the page loads do not all chime at once. */
  const heard = useRef<Set<number> | null>(null);

  // Ground items are static, so the world position can come from the last
  // snapshot even between ticks; only the projection has to be per-frame.
  const items = (snapshot?.entities ?? []).filter((e) => e.kind === "groundItem");
  for (const e of items) positions.current.set(e.id, { x: e.x, y: e.y });

  if (snapshot) {
    const seen = heard.current;
    if (seen === null) heard.current = new Set(items.map((e) => e.id));
    else {
      for (const e of items) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          playDropSound(e.rarity);
        }
      }
      // Forget picked-up ids so a re-drop of the same entity id chimes again.
      const live = new Set(items.map((e) => e.id));
      for (const id of seen) if (!live.has(id)) seen.delete(id);
    }
  }

  useEffect(() => {
    if (!project) return;
    let raf = 0;
    const tick = () => {
      const placed: { node: HTMLDivElement; x: number; y: number }[] = [];
      for (const [id, node] of nodes.current) {
        const at = positions.current.get(id);
        if (!at) continue;
        const p = project(at.x, at.y);
        node.style.visibility = p.visible ? "visible" : "hidden";
        if (p.visible) placed.push({ node, x: p.x, y: p.y - PLATE_LIFT });
      }
      // A monster's whole drop lands on one tile, so plates would sit exactly on
      // top of each other. PoE stacks them into a readable column instead.
      placed.sort((a, b) => a.y - b.y || a.x - b.x);
      for (let i = 1; i < placed.length; i++) {
        const cur = placed[i]!;
        const prev = placed[i - 1]!;
        if (Math.abs(cur.x - prev.x) < PLATE_SPREAD_X && cur.y - prev.y < PLATE_ROW) {
          cur.y = prev.y + PLATE_ROW;
        }
      }
      for (const { node, x, y } of placed) {
        node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {items.map((e) => {
        const look = RARITY[(e.rarity ?? "normal") as keyof typeof RARITY] ?? RARITY.normal;
        return (
          <div
            key={e.id}
            data-testid={`loot-label-${e.id}`}
            data-rarity={e.rarity ?? "normal"}
            ref={(node) => {
              if (node) nodes.current.set(e.id, node);
              else nodes.current.delete(e.id);
            }}
            onPointerDown={(ev) => {
              ev.stopPropagation(); // the plate is the target, not the ground under it
              onPick?.(e.id, e.x, e.y);
            }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              visibility: "hidden", // until the first projection places it
              padding: "2px 10px 3px",
              background: "rgba(0,0,0,0.72)",
              border: `1px solid ${look.frame}`,
              color: look.text,
              font: `13px ${SERIF}`,
              fontVariant: "small-caps",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              textShadow: "0 1px 2px #000",
              pointerEvents: "auto", // the wrapper is inert; the plates are clickable
              cursor: "pointer",
            }}
          >
            {e.name ?? "Item"}
          </div>
        );
      })}
    </div>
  );
}
