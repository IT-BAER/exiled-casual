import React, { useEffect, useRef } from "react";
import type { Snapshot } from "@exiled/protocol";
import { SERIF } from "./ItemTooltip";
import type { Projector } from "./LootLabels";
import { VENDOR_NAME } from "../npc";

/**
 * Pixels the name floats above the NPC's ground position. Measured, not guessed:
 * at the game camera a standing figure is about 120 css pixels tall from sole to
 * crown, and a lift shorter than that prints his name across his chest.
 */
const NAME_LIFT = 140;

/** Who each NPC entity kind is. One name per kind: the hideout holds one of each. */
const NPC_NAME: Partial<Record<Snapshot["entities"][number]["kind"], string>> = {
  vendor: VENDOR_NAME,
};

export interface NpcLabelsProps {
  snapshot: Snapshot | null;
  /** Null until the Babylon scene exists; names then hold their last position. */
  project: Projector | null;
}

/**
 * The NPC's name standing over his head, always on.
 *
 * Bare text, not a plate: a hideout with one person in it does not need a second
 * window floating over him, and PoE draws the town names as unbacked type
 * (reference-screenshots/hideout.jpg). The shadow is what keeps it readable over
 * a bright floor, so it is the only decoration.
 *
 * Positioning is LootLabels' trick, for LootLabels' reason: the camera moves every
 * frame and the snapshot only lands at 30 Hz, so a rAF loop writes the transform
 * instead of re-rendering.
 */
export function NpcLabels({ snapshot, project }: NpcLabelsProps) {
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const positions = useRef(new Map<number, { x: number; y: number }>());

  const npcs = (snapshot?.entities ?? []).filter((e) => NPC_NAME[e.kind] !== undefined);
  for (const e of npcs) positions.current.set(e.id, { x: e.x, y: e.y });

  useEffect(() => {
    if (!project) return;
    let raf = 0;
    const tick = () => {
      for (const [id, node] of nodes.current) {
        const at = positions.current.get(id);
        if (!at) continue;
        const p = project(at.x, at.y);
        node.style.visibility = p.visible ? "visible" : "hidden";
        if (p.visible) {
          node.style.transform =
            `translate(${p.x}px, ${p.y - NAME_LIFT}px) translate(-50%, -100%)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {npcs.map((e) => (
        <div
          key={e.id}
          data-testid={`npc-label-${e.id}`}
          ref={(node) => {
            if (node) nodes.current.set(e.id, node);
            else nodes.current.delete(e.id);
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            visibility: "hidden", // until the first projection places it
            color: "#d8cbb0",
            font: `15px ${SERIF}`,
            fontVariant: "small-caps",
            letterSpacing: "0.05em",
            whiteSpace: "nowrap",
            // Two shadows, not one: a tight black edge so the glyph holds against
            // a lit floor, and a soft one under it so the name sits in the scene.
            textShadow: "0 1px 1px #000, 0 2px 6px rgba(0,0,0,0.85)",
            pointerEvents: "none", // his body is the click target, never the word
          }}
        >
          {NPC_NAME[e.kind]}
        </div>
      ))}
    </div>
  );
}
