import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { SERIF } from "./ItemTooltip";

/**
 * Top-left effect squares, PoE's buff row (reference:
 * `reference-screenshots/inside-map.jpg`, top-left): dark framed tiles with the
 * effect's art inside and a small count plate hanging off the lower-left
 * corner — ours carries the remaining seconds. Buffs run in the first row,
 * debuffs in a second row beneath them.
 */

const TILE_VW = 2.4;
const INSET_VW = 0.6;

/** The face each effect id wears. An id with no art still gets a tile: an
 *  effect the player cannot see is worse than an ugly square. */
const BUFF_ART: Record<string, { icon: string; name: string }> = {
  grace: { icon: "/textures/buffs/grace.png", name: "Spawn Grace" },
};

type Buff = NonNullable<Snapshot["player"]["buffs"]>[number];

function Tile({ b }: { b: Buff }): React.JSX.Element {
  const art = BUFF_ART[b.id];
  return (
    <div
      title={art?.name ?? b.id}
      style={{
        position: "relative",
        width: `${TILE_VW}vw`,
        height: `${TILE_VW}vw`,
        background: "rgba(8,8,10,0.9)",
        // The reference frame is a thin worn-metal bevel, not a glowing line.
        border: "1px solid #5a5548",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.7)",
      }}
    >
      {art && (
        <img
          src={art.icon}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: "-0.15vw",
          bottom: "-0.35vw",
          minWidth: "0.9vw",
          padding: "0 0.15vw",
          background: "rgba(10,10,12,0.95)",
          border: "1px solid #5a5548",
          fontFamily: SERIF,
          fontSize: "0.75vw",
          lineHeight: "1.1vw",
          textAlign: "center",
          color: "#d8d0bc",
        }}
      >
        {b.remainingSec}
      </div>
    </div>
  );
}

export function BuffBar({ snapshot }: { snapshot: Snapshot | null }): React.JSX.Element | null {
  const all = snapshot?.player.buffs ?? [];
  if (all.length === 0) return null;
  const rows: Buff[][] = [
    all.filter((b) => b.kind === "buff"),
    all.filter((b) => b.kind === "debuff"),
  ];
  return (
    <div
      data-testid="buff-bar"
      style={{
        position: "absolute",
        top: `${INSET_VW}vw`,
        left: `${INSET_VW}vw`,
        display: "flex",
        flexDirection: "column",
        gap: "0.55vw",
        pointerEvents: "none",
      }}
    >
      {rows.map((row, i) =>
        row.length > 0 ? (
          <div key={i} style={{ display: "flex", gap: "0.3vw" }}>
            {row.map((b) => <Tile key={b.id} b={b} />)}
          </div>
        ) : null,
      )}
    </div>
  );
}
