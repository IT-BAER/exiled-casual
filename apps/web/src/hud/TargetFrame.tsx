import React from "react";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { MONSTERS, RARE_TEMPLATES } from "@exiled/content-runtime";
import { areaLevel } from "@exiled/rules";
import { DISPLAY } from "./ItemTooltip";
import { ElementIcon } from "./ElementIcon";

/**
 * The hovered monster, top centre: PoE1's ornate magic/rare frame with modifier lines
 * under it, PoE2's plain bar for a normal one. Small and quiet (owner: many enemies around).
 */
/** The bar every tier shares; each frame is scaled so its own window lands exactly on it. */
const BAR_W = 14;
const BAR_H = 0.9;
export const TARGET_BAR_W = `${BAR_W}vw`;
export const TARGET_BAR_H = `${BAR_H}vw`;

/**
 * Each 1024-wide frame and its transparent window, in image px (left/right/top/bottom).
 * The caps keep their aspect and only the rails between them stretch (border-image).
 */
const FRAMES = {
  normal: { src: "/hud/target-frame-normal-v1.webp", h: 105, l: 27, r: 26, t: 23, b: 23 },
  magic: { src: "/hud/target-frame-magic-v1.webp", h: 90, l: 56, r: 56, t: 26, b: 22 },
  rare: { src: "/hud/target-frame-rare-v1.webp", h: 107, l: 61, r: 64, t: 26, b: 20 },
} as const;

const vw = (n: number) => `${+n.toFixed(3)}vw`;

/** PoE's monster-rarity name colours. */
const NAME_COLOR = { normal: "#e8e2d6", magic: "#8888ff", rare: "#ffff77" } as const;

const DEBUFF_ICON: Record<NonNullable<SnapshotEntity["debuffs"]>[number], { icon: string; name: string }> = {
  burning: { icon: "/textures/buffs/burning.webp", name: "Burning" },
  poison: { icon: "/textures/buffs/poison.webp", name: "Poisoned" },
  bleeding: { icon: "/textures/buffs/bleeding.webp", name: "Bleeding" },
};

const WEAK = "#ff5040";
const SMALL: React.CSSProperties = { fontSize: "0.55vw", color: "#f4f0e6", textShadow: "0 1px 2px #000, 0 0 4px #000" };
const ICON = "0.75vw";

const titleCase = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function modifierLines(e: SnapshotEntity): string[] {
  const out: string[] = [];
  if (e.rare) {
    const t = RARE_TEMPLATES.find((r) => r.element === e.element);
    if (t) {
      out.push("Extra Life");
      if (t.moveSpeedMulPct > 100) out.push("Moves Quickly");
      if (t.damageMulPct > 100) out.push("Extra Damage");
    }
  } else if (e.magic) {
    out.push("Extra Life", "Extra Damage");
  }
  if (e.element) out.push(`${titleCase(e.element)} Attacks`);
  return out;
}

export function TargetFrame({ snapshot, targetId, top = "0.6vw" }: {
  snapshot: Snapshot;
  targetId: number | null;
  /** Where the frame's top edge sits; under the boss bar while that is up. */
  top?: string;
}): React.JSX.Element | null {
  const e = targetId === null ? undefined : snapshot.entities.find((x) => x.id === targetId && x.kind === "monster");
  // The boss bar already says all of this, bigger.
  if (!e || e.boss) return null;
  const tier = e.rare ? "rare" : e.magic ? "magic" : "normal";
  const frame = FRAMES[tier];
  const base = (e.species && MONSTERS.get(e.species)?.name) ?? "";
  const prefix = e.rare ? RARE_TEMPLATES.find((r) => r.element === e.element)?.namePrefix : undefined;
  const lifePct = e.maxLife && e.maxLife > 0 ? Math.max(0, Math.min(100, ((e.life ?? 0) / e.maxLife) * 100)) : 0;
  const mods = modifierLines(e);
  const res = Object.entries(e.res ?? {}) as [keyof NonNullable<SnapshotEntity["res"]>, number][];
  // vw per image px, chosen so this frame's window is exactly BAR_W x BAR_H.
  const k = BAR_H / (frame.h - frame.t - frame.b);

  return (
    <div
      data-testid="target-frame"
      style={{
        position: "absolute",
        top,
        left: "50%",
        transform: "translateX(-50%)",
        width: vw(BAR_W + (frame.l + frame.r) * k),
        pointerEvents: "none",
        filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.8))",
      }}
    >
      <div style={{ position: "relative", height: vw(frame.h * k) }}>
        <div
          data-testid="target-window"
          style={{ position: "absolute", left: vw(frame.l * k), top: vw(frame.t * k), width: TARGET_BAR_W, height: TARGET_BAR_H, background: "#0b0d11" }}
        >
          <div
            data-testid="target-fill"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${lifePct}%`,
              background: "linear-gradient(to bottom, #c4291f, #8a0f0c 55%, #4f0707)",
              transition: "width 120ms linear",
            }}
          />
          <div
            data-testid="target-name"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: NAME_COLOR[tier],
              fontFamily: DISPLAY,
              fontSize: "0.65vw",
              fontVariant: "small-caps",
              letterSpacing: "0.04em",
              textShadow: "0 1px 3px #000, 0 0 6px #000",
              whiteSpace: "nowrap",
            }}
          >
            {prefix ? `${prefix} ${base}` : base}
          </div>
        </div>
        <div
          data-src={frame.src}
          style={{
            position: "absolute",
            inset: 0,
            boxSizing: "border-box",
            borderStyle: "solid",
            borderWidth: `0 ${vw(frame.r * k)} 0 ${vw(frame.l * k)}`,
            borderImage: `url(${frame.src}) 0 ${frame.r} 0 ${frame.l} fill / 0 ${vw(frame.r * k)} 0 ${vw(frame.l * k)} stretch`,
          }}
        />
      </div>
      <div style={{ position: "relative", display: "flex", justifyContent: "center", minHeight: ICON, marginTop: "0.15vw" }}>
        {e.debuffs && (
          <div data-testid="target-debuffs" style={{ position: "absolute", left: "4%", top: 0, display: "flex", gap: "0.25vw" }}>
            {e.debuffs.map((d) => (
              <span key={d} title={DEBUFF_ICON[d].name} style={{ display: "flex", alignItems: "center", gap: "0.1vw", ...SMALL }}>
                <img src={DEBUFF_ICON[d].icon} alt="" style={{ width: ICON, height: ICON }} />
                {d === "burning" && <span>{e.ailmentStacks ?? 1}</span>}
              </span>
            ))}
          </div>
        )}
        {snapshot.areaTier > 0 && (
          <div data-testid="target-level" style={SMALL}>Level {areaLevel(snapshot.areaTier)}</div>
        )}
        {res.length > 0 && (
          <div data-testid="target-res" style={{ position: "absolute", right: "4%", top: 0, display: "flex", gap: "0.3vw" }}>
            {res.map(([el, v]) => (
              <span key={el} style={{ display: "flex", alignItems: "center", gap: "0.1vw", ...SMALL }}>
                <ElementIcon of={el} size={12} />
                <span style={v < 0 ? { color: WEAK } : undefined}>{v > 0 ? `+${v}%` : `${v}%`}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {mods.length > 0 && (
        <div data-testid="target-mods" style={{ textAlign: "center", lineHeight: 1.25, ...SMALL }}>
          {mods.map((m) => <div key={m}>{m}</div>)}
        </div>
      )}
    </div>
  );
}
