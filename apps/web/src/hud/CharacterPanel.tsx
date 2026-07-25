import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { RES_CAP, ES_RECHARGE_PCT_PER_SEC, ES_RECHARGE_DELAY_TICKS } from "@exiled/rules";
import { SERIF, GOLD_DIM, PARCHMENT } from "./InventoryPanel";

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

const PANEL_W = 400;
/** char_niche_v2.png is 320x224; a niche keeps that ratio or the arch shears. */
const NICHE_W = (PANEL_W - 28) / 2;
const NICHE_H = Math.round((NICHE_W * 224) / 320);
/** char_header_v1.png is 1024x160, and the band has to keep that ratio or the relief shears. */
const HEADER_H = Math.round((PANEL_W * 160) / 1024);

/**
 * The four stat icons ship as one 2x2 sheet, so a quadrant is picked by moving a
 * 200%-scaled background rather than by loading four files.
 */
const ICON_QUADRANT = { life: "0% 0%", mana: "100% 0%", armour: "0% 100%", fire: "100% 100%" } as const;

function Icon({ of, size = 38 }: { of: keyof typeof ICON_QUADRANT; size?: number }) {
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
 * One arched niche. The art's recess does not fill its frame, so the label and
 * value are inset by the fractions of char_niche_v1.png that the carved stone
 * occupies — percentages, so the niche can be resized without re-measuring.
 */
function Niche({ id, label, value, icon }: { id: string; label: string; value: string; icon: React.ReactNode }) {
  return (
    <div
      data-testid={`char-stat-${id}`}
      style={{
        width: NICHE_W, height: NICHE_H,
        backgroundImage: "url(/textures/ui/char_niche_v2.png)",
        backgroundSize: "100% 100%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 2,
        padding: "14% 11% 9%",
        boxSizing: "border-box",
      }}
    >
      {icon}
      <span style={{ color: "#d8b866", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", textShadow: "0 1px 2px #000" }}>
        {label}
      </span>
      <span style={{ color: "#fff", fontSize: 19, textShadow: "0 1px 4px #000" }}>{value}</span>
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
function ShieldGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={34}
      height={34}
      // flex: none, like Icon: the niche is a fixed-height column and a flexible
      // SVG child gets squashed to zero height by the label under it.
      style={{ flex: "none", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.9))" }}
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
    <div style={{ marginBottom: 14 }}>
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
  return (
    <div
      data-testid="character-panel"
      data-hud-panel=""
      style={{
        position: "absolute",
        left: 24,
        top: "50%",
        transform: "translateY(-50%)",
        width: PANEL_W,
        maxHeight: "92vh",
        overflowY: "auto",
        // No full-screen backdrop: PoE2 keeps the character sheet and the
        // inventory open side by side, so this must not swallow the world.
        pointerEvents: "auto",
        // Above the HUD (zIndex 3 in Hud.tsx), or the globes and the life
        // readout paint straight over the panel's lower rows.
        zIndex: 4,
        background: "#0b0906",
        border: "1px solid #2a2216",
        boxShadow: "0 0 0 1px #000, 0 0 0 4px #1b1710, 0 0 0 5px #4a3a1c, 0 14px 48px rgba(0,0,0,0.85)",
        fontFamily: SERIF,
        color: PARCHMENT,
      }}
    >
      {/* A default scrollbar cutting down the stone has no counterpart in the
          reference, and this is a pseudo-element, so it cannot be an inline style. */}
      <style>{`[data-testid="character-panel"]{scrollbar-width:none}[data-testid="character-panel"]::-webkit-scrollbar{display:none}`}</style>

      {/* Carved header band; the cartouche in the art is empty so the title stays crisp text. */}
      <div
        style={{
          position: "relative",
          height: HEADER_H,
          backgroundImage: "url(/textures/ui/char_header_v1.png)",
          backgroundSize: "100% 100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          borderBottom: "1px solid #000",
        }}
      >
        <span
          style={{
            fontSize: 17, letterSpacing: 5, textTransform: "uppercase",
            color: "#f6e6bb",
            textShadow: "0 1px 2px #000, 0 0 10px rgba(0,0,0,0.8)",
          }}
        >
          Character
        </span>
        <button
          data-testid="character-close"
          onClick={onClose}
          style={{
            position: "absolute", top: 6, right: 8,
            width: 22, height: 22, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #c74e35, #6d1d13 70%, #35100a)",
            border: "1px solid #1d0906", color: "#f7ddd0",
            boxShadow: "0 1px 4px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,180,150,0.4)",
            cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Stone body. The overlay keeps the texture from fighting the text on top of it. */}
      <div
        style={{
          padding: 14,
          backgroundImage:
            "linear-gradient(180deg, rgba(8,7,5,0.45), rgba(8,7,5,0.68)), url(/textures/ui/char_stone_v1.png)",
          backgroundSize: "auto, 256px 256px",
        }}
      >
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

        {/* Niches in a band abut, so their pilasters read as one carved plate rather than floating tiles. */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Niche id="life" label="Life" value={String(Math.round(player.maxLife))} icon={<Icon of="life" />} />
          <Niche id="mana" label="Mana" value={String(Math.round(player.maxMana))} icon={<Icon of="mana" />} />
        </div>
        {/* The reference gives energy shield a niche of its own beside life. Ours
            only appears once gear grants a pool: a row frozen at zero would say a
            character has a shield mechanic switched off, which is not what a
            character with no ES gear has. */}
        {player.maxEnergyShield > 0 && (
          <div style={{ display: "flex", marginTop: 6, justifyContent: "center" }}>
            <Niche
              id="energy-shield"
              label="Energy Shield"
              value={String(Math.round(player.maxEnergyShield))}
              icon={<ShieldGlyph />}
            />
          </div>
        )}
        <div style={{ display: "flex", marginTop: 6, justifyContent: "center" }}>
          <Niche id="armour" label="Armour" value={`${s.armourPct}%`} icon={<Icon of="armour" />} />
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

        {/* The reference drops the stone for a flat dark list at the bottom. */}
        <div
          data-testid="char-detail"
          style={{ marginTop: 16, padding: "12px 12px 2px", background: "rgba(4,3,2,0.82)", border: "1px solid #1e1810" }}
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
