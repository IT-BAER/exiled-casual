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
export const BUFF_ART: Record<string, { icon: string; name: string }> = {
  grace: { icon: "/textures/buffs/grace.webp", name: "Spawn Grace" },
  burning: { icon: "/textures/buffs/burning.webp", name: "Burning" },
  poison: { icon: "/textures/buffs/poison.webp", name: "Poisoned" },
  bleeding: { icon: "/textures/buffs/bleeding.webp", name: "Bleeding" },
  // The class skills' buffs (spec 2026-11-01): three auras, two timed.
  infernal_cry: { icon: "/textures/buffs/infernal_cry.webp", name: "Furnace Roar" },
  blood_rage: { icon: "/textures/buffs/blood_rage.webp", name: "Crimson Fury" },
  determination: { icon: "/textures/buffs/determination.webp", name: "Iron Resolve" },
  haste: { icon: "/textures/buffs/haste.webp", name: "Windstride" },
  herald_of_ash: { icon: "/textures/buffs/herald_of_ash.webp", name: "Mantle of Embers" },
};

/** The statuses a class skill puts on a monster (TargetFrame), in the same frames. */
export const STATUS_ART: Record<string, { icon: string; name: string }> = {
  scorched: { icon: "/textures/buffs/scorched.webp", name: "Scorched" },
  chilled: { icon: "/textures/buffs/chilled.webp", name: "Chilled" },
  stunned: { icon: "/textures/buffs/stunned.webp", name: "Stunned" },
  marked: { icon: "/textures/buffs/marked.webp", name: "Marked" },
  flammable: { icon: "/textures/buffs/flammable.webp", name: "Flammable" },
  taunted: { icon: "/textures/buffs/taunted.webp", name: "Taunted" },
};

type Buff = NonNullable<Snapshot["player"]["buffs"]>[number];

function Tile({ b }: { b: Buff }): React.JSX.Element {
  const art = BUFF_ART[b.id];
  const aura = b.aura === true;
  return (
    <div
      data-testid="buff-tile"
      data-aura={aura ? "true" : "false"}
      title={art?.name ?? b.id}
      style={{
        position: "relative",
        width: `${TILE_VW}vw`,
        height: `${TILE_VW}vw`,
        background: "rgba(8,8,10,0.9)",
        // The reference frame is a thin worn-metal bevel, not a glowing line. An aura's
        // is lit instead (PoE1 frames a reserved aura in gold and runs no clock on it).
        border: aura ? "1px solid #c8aa6e" : "1px solid #5a5548",
        boxShadow: aura
          ? "inset 0 0 0 1px rgba(0,0,0,0.85), 0 0 6px rgba(232,190,110,0.75)"
          : "inset 0 0 0 1px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.7)",
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
      {!aura && <div
        data-testid="buff-seconds"
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
      </div>}
      {(b.stacks ?? 1) > 1 && (
        // PoE's stack count sits in the upper right, clear of the seconds plate.
        <div
          data-testid="buff-stacks"
          style={{
            position: "absolute",
            right: "0.1vw",
            top: "0.05vw",
            fontFamily: SERIF,
            fontSize: "0.75vw",
            lineHeight: "1vw",
            color: "#f0e6cc",
            textShadow: "0 0 2px #000, 0 0 2px #000",
          }}
        >
          {b.stacks}
        </div>
      )}
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
