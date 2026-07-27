import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { RES_CAP, ES_RECHARGE_PCT_PER_SEC, ES_RECHARGE_DELAY_TICKS } from "@exiled/rules";
import { SERIF, PARCHMENT, PANE, PaneHeader } from "./InventoryPanel";
import { PANEL_PAD, CELL_VW } from "./layout";
import { ORB_RISE } from "./Hud";

// PoE2's character sheet (C), matched to poe2-screenshots/character-stats.png.
// The stone, the carved header band with its gold cartouche, the arch niches
// and the stat icons are generated art under /textures/ui/char_*.png rather
// than CSS approximations, because the reference's weight comes almost entirely
// from that carving and no gradient stack was going to stand in for it.
//
// The reference's identity row (portrait, "Level 80 Invoker", league) and its
// Strength/Dexterity/Intelligence plate are left out, as are the Energy Shield,
// Spirit, Evasion and Block niches and three of the four resistances: none of
// them exist in the sim, and a row frozen at zero would advertise a mechanic
// that is not there. What is drawn is what gear can actually move.
//
// The Offence section is a PoE1 borrow. PoE2 moved offensive stats off the
// sheet and onto skill tooltips, but we have no skill tooltip yet, so a wand's
// spell damage would otherwise be invisible everywhere.

/**
 * The four stat icons ship as one 2x2 sheet, so a quadrant is picked by moving a
 * 200%-scaled background rather than by loading four files.
 */
const ICON_QUADRANT = { life: "0% 0%", mana: "100% 0%", armour: "0% 100%", fire: "100% 100%" } as const;

function Icon({ of, size = 38 }: { of: keyof typeof ICON_QUADRANT; size?: number | string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, flex: "none",
        backgroundImage: "url(/textures/ui/char_icons_v1.png)",
        backgroundSize: "200% 200%",
        backgroundPosition: ICON_QUADRANT[of],
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.9))",
      }}
    />
  );
}

/**
 * The band of niches spans the pane's content width, which is the backpack's own
 * 12 columns, so a band of three tiles and a band of four each fill it. Every
 * measurement inside a tile is a fraction of `w`: a 38px icon that fits a
 * three-wide band overflows a four-wide one, and the whole HUD is already sized
 * in vw off the viewport rather than in pixels.
 */
const BAND_VW = 12 * CELL_VW;
/** char_niche_v2.png is 320x224; a niche keeps that ratio or the arch shears. */
const NICHE_RATIO = 224 / 320;

/**
 * One arched niche, `w` vw wide. The art's recess does not fill its frame, so the
 * label and value are inset by the fractions of char_niche_v2.png that the carved
 * stone occupies. Those fractions are vw off `w`, not percentages: percentage
 * padding resolves against the *containing block's* width, so on a tile that is a
 * flex item it measured the whole band and inset each 129px tile by 72px.
 */
function Niche({ id, label, value, icon, w }: {
  id: string; label: string; value: string; icon: React.ReactNode; w: number;
}) {
  const vw = (f: number) => `${(w * f).toFixed(3)}vw`;
  return (
    <div
      data-testid={`char-stat-${id}`}
      style={{
        width: `${w}vw`, height: vw(NICHE_RATIO),
        backgroundImage: "url(/textures/ui/char_niche_v2.png)",
        backgroundSize: "100% 100%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: vw(0.01),
        padding: `${vw(0.14)} ${vw(0.11)} ${vw(0.09)}`,
        boxSizing: "border-box",
      }}
    >
      {icon}
      {/* "Energy Shield" is the only label that wraps, and only in a band of four. */}
      <span style={{ color: "#d8b866", fontSize: vw(0.058), lineHeight: 1.15, letterSpacing: "0.13em", textAlign: "center", textTransform: "uppercase", textShadow: "0 1px 2px #000" }}>
        {label}
      </span>
      <span style={{ color: "#fff", fontSize: vw(0.1), lineHeight: 1.1, textShadow: "0 1px 4px #000" }}>{value}</span>
    </div>
  );
}

/**
 * One resistance, printed "capped% (uncapped%)" exactly as the reference does.
 * The two numbers only differ once gear pushes past RES_CAP, which is the whole
 * point of showing both: the sheet is where wasted overcap becomes visible.
 */
/**
 * Cold, lightning and chaos glyphs. The icon sheet only carries fire (it was cut
 * when fire was the only resistance), so these are drawn instead of shipping
 * three more PNGs: a snowflake, a bolt and a spiral, tinted the way the
 * reference tints them.
 */
const ELEMENT_GLYPH = {
  cold: { tint: "#8fd0ef", d: "M12 2v20M4 7l16 10M20 7L4 17" },
  lightning: { tint: "#f2d55a", d: "M13 2 5 13h5l-1 9 8-11h-5z" },
  chaos: { tint: "#c98fdd", d: "M17 9a5 5 0 1 0-5 5 3 3 0 1 0 3-3" },
} as const;

function ElementGlyph({ of }: { of: keyof typeof ELEMENT_GLYPH }) {
  const g = ELEMENT_GLYPH[of];
  const filled = of === "lightning";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.9))" }}
    >
      <path
        d={g.d}
        fill={filled ? g.tint : "none"}
        stroke={g.tint}
        strokeWidth={filled ? 0 : 2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The reference's energy-shield crest, drawn rather than sprited: the icon sheet
 * is a fixed 2x2 of life/mana/armour/fire and a fifth stat would mean reflowing
 * it for one glyph.
 */
function ShieldGlyph({ size = 34 }: { size?: number | string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      // flex: none, like Icon: the niche is a fixed-height column and a flexible
      // SVG child gets squashed to zero height by the label under it.
      style={{ flex: "none", width: size, height: size, filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.9))" }}
    >
      <path
        d="M12 2 4 5v7c0 5 3.5 8.4 8 10 4.5-1.6 8-5 8-10V5z"
        fill="rgba(120,190,225,0.35)"
        stroke="#8fd0ef"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResPill({ id, label, pct, icon }: { id: string; label: string; pct: number; icon: React.ReactNode }) {
  return (
    <div
      data-testid={`char-res-${id}`}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px 6px 6px",
        background: "linear-gradient(180deg,rgba(38,31,20,0.92),rgba(12,10,7,0.92))",
        border: "1px solid #3a2f1b",
        borderRadius: 22,
        boxShadow: "inset 0 1px 0 rgba(200,164,77,0.12), inset 0 -6px 12px rgba(0,0,0,0.55)",
      }}
    >
      {/* Medallion bezel: the reference sets each element icon in a rimmed disc. */}
      <span
        style={{
          width: 30, height: 30, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 35%, #241d12, #080705)",
          border: "1px solid #6a5222",
          boxShadow: "inset 0 0 8px rgba(0,0,0,0.9)",
        }}
      >
        {icon}
      </span>
      {/* "Lightning" is the longest label; without nowrap its value breaks onto a second line. */}
      <span style={{ color: PARCHMENT, fontSize: 13, letterSpacing: 0.5, flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "#fff", fontSize: 14, whiteSpace: "nowrap" }}>
        {Math.min(pct, RES_CAP)}%{" "}
        <span style={{ color: "#7d7360", fontSize: 13 }}>({pct}%)</span>
      </span>
    </div>
  );
}

/** "45% (60%)" — what applies, then the uncapped total, as the reference does. */
function resRow(pct: number): string {
  return `${Math.min(pct, RES_CAP)}% (${pct}%)`;
}

function DetailSection({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    // A section split across the column break loses its heading, and a heading
    // alone at the foot of a column reads as an empty stat block.
    <div style={{ marginBottom: 14, breakInside: "avoid" }}>
      <div style={{ color: PARCHMENT, fontSize: 15, letterSpacing: 0.5, paddingBottom: 3 }}>{title}</div>
      <div style={{ height: 1, background: "#2a2317", marginBottom: 5 }} />
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
          <span style={{ color: "#9a8a68", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</span>
          <span style={{ color: "#fff", fontSize: 12 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/** The carved rail the reference sets its "Resistances" heading into. */
function BandLabel({ children }: { children: React.ReactNode }) {
  const rule = (dir: string) => ({ flex: 1, height: 2, background: `linear-gradient(${dir}, transparent, #4a3c22)`, boxShadow: "0 1px 0 rgba(0,0,0,0.8)" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 9px" }}>
      <div style={rule("90deg")} />
      <span style={{ color: "#b39a5e", fontSize: 11, letterSpacing: 2.4, textTransform: "uppercase", textShadow: "0 1px 2px #000" }}>{children}</span>
      <div style={rule("270deg")} />
    </div>
  );
}

export function CharacterPanel({ player, onClose }: { player: Snapshot["player"]; onClose: () => void }) {
  const s = player.stats;
  const hasES = player.maxEnergyShield > 0;
  const nicheW = BAND_VW / (hasES ? 4 : 3);
  const glyph = `${(nicheW * 0.24).toFixed(3)}vw`;
  return (
    // The sheet is cut from the same pane as the stash: one width, one top line,
    // one bottom line, docked flush against the left edge under the globes. It
    // used to be a 400px slab floating at left: 24 with its own frame, which
    // read as a dialog laid over the game rather than part of its furniture.
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "flex-start", pointerEvents: "none", zIndex: 2, fontFamily: SERIF, color: PARCHMENT }}>
      <div
        data-testid="character-panel"
        data-hud-panel=""
        style={{ ...PANE, padding: PANEL_PAD, overflowY: "auto", scrollbarWidth: "none" }}
      >
        {/* A default scrollbar cutting down the stone has no counterpart in the
            reference, and this is a pseudo-element, so it cannot be an inline style. */}
        <style>{`[data-testid="character-panel"]::-webkit-scrollbar{display:none}`}</style>

        <PaneHeader title="Character" bleed={PANEL_PAD} onClose={onClose} testId="character-close" />

        {/* The reference's identity row, minus the portrait, the class and the league:
            "Level 80 Invoker" over a stone plate. There is one class and one league,
            so only the number carries information. */}
        <div
          data-testid="char-level"
          style={{
            display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8,
            marginBottom: 8, padding: "5px 0",
            background: "linear-gradient(180deg,rgba(38,31,20,0.9),rgba(10,8,6,0.9))",
            border: "1px solid #3a2f1b",
            boxShadow: "inset 0 1px 0 rgba(200,164,77,0.12)",
          }}
        >
          <span style={{ color: "#d8b866", fontSize: 11, letterSpacing: 1.8, textTransform: "uppercase" }}>Level</span>
          <span style={{ color: "#fff", fontSize: 19, textShadow: "0 1px 4px #000" }}>{player.level}</span>
        </div>

        {/* Niches in a band abut, so their pilasters read as one carved plate rather
            than floating tiles, and the band spans the pane the way every band in
            character-stats.png does. The reference splits pools from defences over
            two bands because it has eight stats; with three or four, a second band
            would be one tile stretched across the whole pane. Energy shield only
            appears once gear grants a pool — a row frozen at zero would advertise a
            mechanic that is switched off, which is not what a character with no ES
            gear has — so the band is three tiles wide or four. */}
        <div style={{ display: "flex" }}>
          <Niche id="life" label="Life" value={String(Math.round(player.maxLife))} icon={<Icon of="life" size={glyph} />} w={nicheW} />
          {hasES && (
            <Niche
              id="energy-shield"
              label="Energy Shield"
              value={String(Math.round(player.maxEnergyShield))}
              icon={<ShieldGlyph size={glyph} />}
              w={nicheW}
            />
          )}
          <Niche id="mana" label="Mana" value={String(Math.round(player.maxMana))} icon={<Icon of="mana" size={glyph} />} w={nicheW} />
          <Niche id="armour" label="Armour" value={`${s.armourPct}%`} icon={<Icon of="armour" size={glyph} />} w={nicheW} />
        </div>

        <BandLabel>Resistances</BandLabel>
        {/* 2x2, fire/cold over lightning/chaos — the reference's arrangement
            (poe2-screenshots/character-stats.png). */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <ResPill id="fire" label="Fire" pct={s.res.fire} icon={<Icon of="fire" size={20} />} />
          <ResPill id="cold" label="Cold" pct={s.res.cold} icon={<ElementGlyph of="cold" />} />
          <ResPill id="lightning" label="Lightning" pct={s.res.lightning} icon={<ElementGlyph of="lightning" />} />
          <ResPill id="chaos" label="Chaos" pct={s.res.chaos} icon={<ElementGlyph of="chaos" />} />
        </div>

        {/* The reference drops the stone for a flat dark list at the bottom. The
            life globe is meant to overlap the pane's lower corner, but not to sit
            on rows the player has to read, so the list ends ORB_RISE above the
            foot the way the inventory's own content does. */}
        <div
          data-testid="char-detail"
          style={{
            // The reserve for the globe is margin, not padding: inside the border it
            // reads as an unfinished box, outside it is the bare pane foot the stash
            // already ends on.
            marginTop: 16, marginBottom: ORB_RISE, padding: "12px 12px 2px",
            background: "rgba(4,3,2,0.82)", border: "1px solid #1e1810",
            // Two columns because the pane is the stash's width now: in one column
            // the list is half again taller than the pane, so it scrolled, and the
            // rows passing the lower-left corner went behind the life globe.
            columnCount: 2, columnGap: 18,
          }}
        >
          <DetailSection title="Life" rows={[["Maximum Life", String(Math.round(player.maxLife))]]} />
          {player.maxEnergyShield > 0 && (
            <DetailSection
              title="Energy Shield"
              rows={[
                ["Maximum Energy Shield", String(Math.round(player.maxEnergyShield))],
                ["Recharge Rate per second", (player.maxEnergyShield * ES_RECHARGE_PCT_PER_SEC / 1000).toFixed(1)],
                ["Recharge Delay", `${(ES_RECHARGE_DELAY_TICKS / 30).toFixed(1)}s`],
              ]}
            />
          )}
          <DetailSection
            title="Mana"
            rows={[
              ["Maximum Mana", String(Math.round(player.maxMana))],
              ["Mana Regeneration per second", s.manaRegenPerSec.toFixed(1)],
            ]}
          />
          <DetailSection
            title="Defence"
            rows={[
              ["Armour", String(Math.round(s.armour))],
              ["Physical Damage Reduction", `${s.armourPct}%`],
              ["Fire Resistance", resRow(s.res.fire)],
              ["Cold Resistance", resRow(s.res.cold)],
              ["Lightning Resistance", resRow(s.res.lightning)],
              ["Chaos Resistance", resRow(s.res.chaos)],
            ]}
          />
          <DetailSection
            title="Offence"
            rows={[
              ["Increased Spell Damage", `${s.spellDamagePct}%`],
              ["Increased Cast Speed", `${s.castSpeedPct}%`],
              ["Increased Critical Strike Chance", `${s.critChancePct}%`],
            ]}
          />
        </div>
      </div>
    </div>
  );
}
