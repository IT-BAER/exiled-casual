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
/** Gap between two stacked plates, on top of the taller one's own height. */
const PLATE_GAP = 4;

/**
 * Plate fill per rarity. PoE2 tints the plate itself (`docs/todo/image-2.png`):
 * a unique sits on dark maroon, a rare on dark gold, so the tier reads before a
 * single letter does.
 */
const PLATE_BG: Record<string, string> = {
  normal: "rgba(10,10,10,0.78)",
  magic: "rgba(14,20,42,0.82)",
  rare: "rgba(34,25,8,0.82)",
  unique: "rgba(38,17,7,0.86)",
};

export interface LootLabelsProps {
  snapshot: Snapshot | null;
  /** Null until the Babylon scene exists; plates then hold their last position. */
  project: Projector | null;
  /** Clicking a plate walks to the drop and picks it up once in range. */
  onPick?: (entityId: number, x: number, y: number) => void;
  /**
   * Draw the name plates at all. False hides the HUD but keeps this component
   * mounted, because the drop cue is announced from here: the setting is "do
   * not show me the plates", never "do not tell me something dropped".
   */
  plates?: boolean;
}

/**
 * Persistent rarity-coloured name plate over every ground item, the way PoE
 * shows drops (reference-screenshots/ground-loot*.png): a dark plate with a thin
 * rarity border and small-caps serif text in the rarity colour.
 *
 * Content is React's; position is not. The camera moves every frame while the
 * snapshot only changes at 30 Hz, so a rAF loop writes transforms straight to
 * the plate nodes instead of re-rendering the tree.
 */
export function LootLabels({ snapshot, project, onPick, plates = true }: LootLabelsProps) {
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
        // Plates are one or two lines tall, so the pitch is the plate above's own
        // height; a fixed pitch overlaps a two-line rare with the plate under it.
        const pitch = (prev.node.offsetHeight || PLATE_ROW) + PLATE_GAP;
        if (Math.abs(cur.x - prev.x) < PLATE_SPREAD_X && cur.y - prev.y < pitch) {
          cur.y = prev.y + pitch;
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
      {(plates ? items : []).map((e) => {
        const rarity = (e.rarity ?? "normal") as keyof typeof RARITY;
        const look = RARITY[rarity] ?? RARITY.normal;
        // The base type only earns its own line where PoE2 gives it one: under a
        // rolled name, on a magic or better drop. A normal item IS its base, and a
        // currency plate saying "Waystone (Tier 1) / Waystone" is one line of noise.
        const base =
          rarity !== "normal" && !e.unidentified && e.baseName && e.baseName !== e.name
            ? e.baseName
            : null;
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
              padding: base ? "3px 12px 4px" : "2px 12px 3px",
              background: PLATE_BG[rarity] ?? PLATE_BG["normal"],
              border: `1px solid ${look.frame}66`, // the reference plate is filled, not outlined
              color: look.text,
              font: `14px ${SERIF}`,
              fontVariant: "small-caps",
              letterSpacing: "0.04em",
              lineHeight: 1.25,
              textAlign: "center",
              whiteSpace: "nowrap",
              textShadow: "0 1px 2px #000",
              pointerEvents: "auto", // the wrapper is inert; the plates are clickable
            }}
          >
            {e.name ?? "Item"}
            {base ? <div style={{ fontSize: 12, opacity: 0.85 }}>{base}</div> : null}
            {/* Stem down to the drop, so a plate lifted out of a stack still says
                which item on the floor it belongs to. */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: "50%",
                top: "100%",
                width: 1,
                height: PLATE_LIFT - 6,
                background: `linear-gradient(180deg, ${look.frame}99, transparent)`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
