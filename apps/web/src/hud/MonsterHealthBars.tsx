import React, { useEffect, useRef } from "react";
import type { Snapshot } from "@exiled/protocol";
import type { FrameHook, Projector } from "./LootLabels";

/**
 * WORLD units the bar floats above the monster's feet. The creatures top out
 * around 1.2-1.5; one height for all of them keeps the bar off the body without
 * a per-species table nobody would tune.
 */
const BAR_HEIGHT = 1.7;

const BAR_W = 44;
const BAR_H = 5;

/**
 * A thin life bar over every damaged monster, behind `ui.monsterHealthBars`
 * (mounted only when it is on; default off).
 *
 * "Damaged" is the filter, per his TODO wording: a full-life monster shows
 * nothing, so the screen is not wallpapered with bars, and the bar itself is
 * the tell that a hit landed. The dead show nothing either — the ragdoll says
 * it better — and the boss keeps his big HUD bar (Hud.tsx), never this one.
 *
 * Positioning is LootLabels' trick, for LootLabels' reason: the camera moves
 * every frame and the snapshot lands at 30 Hz, so a rAF loop writes transforms
 * instead of re-rendering. Fill width IS re-rendered per snapshot — life only
 * changes when a snapshot arrives, so that is exactly often enough.
 */
export function MonsterHealthBars({ snapshot, project, afterFrame }: {
  snapshot: Snapshot | null;
  /** Null until the Babylon scene exists; bars then hold their last position. */
  project: Projector | null;
  /** Placement runs on this when it exists, and on rAF when it does not. */
  afterFrame?: FrameHook | null;
}) {
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const positions = useRef(new Map<number, { x: number; y: number }>());

  const damaged = (snapshot?.entities ?? []).filter(
    (e) =>
      e.kind === "monster" &&
      !e.boss &&
      e.life !== undefined &&
      e.maxLife !== undefined &&
      e.maxLife > 0 &&
      e.life > 0 &&
      e.life < e.maxLife,
  );
  for (const e of damaged) positions.current.set(e.id, { x: e.x, y: e.y });

  useEffect(() => {
    if (!project) return;
    const place = () => {
      for (const [id, node] of nodes.current) {
        const at = positions.current.get(id);
        if (!at) continue;
        const p = project(at.x, at.y, BAR_HEIGHT);
        node.style.visibility = p.visible ? "visible" : "hidden";
        if (p.visible) {
          node.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
        }
      }
    };
    if (afterFrame) return afterFrame(place);
    let raf = 0;
    const tick = () => { place(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project, afterFrame]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {damaged.map((e) => (
        <div
          key={e.id}
          data-testid={`monster-hp-${e.id}`}
          ref={(node) => {
            if (node) nodes.current.set(e.id, node);
            else nodes.current.delete(e.id);
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            visibility: "hidden", // until the first projection places it
            width: BAR_W,
            height: BAR_H,
            background: "rgba(0,0,0,0.7)",
            border: "1px solid rgba(0,0,0,0.9)",
            pointerEvents: "none", // the body is the click target, never the bar
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.max(0, Math.min(100, (e.life! / e.maxLife!) * 100))}%`,
              // PoE's monster life red, darker at the base so it reads as a
              // liquid rather than a paint stripe.
              background: "linear-gradient(#c03a2b, #7e1f14)",
            }}
          />
        </div>
      ))}
    </div>
  );
}
