import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { RES_CAP } from "@exiled/rules";
import { SERIF, GOLD, GOLD_DIM, PARCHMENT } from "./InventoryPanel";

// PoE2's character sheet (C), matched to poe2-screenshots/character-stats.png:
// a gold cartouche header, arched stone niches for the resource and defence
// totals, a resistance pill band, then a scrolling label/value detail list.
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

const PANEL_W = 380;
const STONE = "linear-gradient(180deg,#16130d 0%,#0d0b07 100%)";

/** Arched niche interior: recessed, warm, lit slightly from above like the carved stone in the shot. */
const NICHE: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "10px 4px 12px",
  background: "radial-gradient(ellipse at 50% 20%, #221c12 0%, #0c0a07 75%)",
  border: `1px solid ${GOLD_DIM}`,
  // Round the top corners hard and the bottom barely, which reads as an arch.
  borderRadius: "44% 44% 4px 4px / 26% 26% 4px 4px",
  boxShadow: "inset 0 0 14px rgba(0,0,0,0.8), inset 0 1px 0 rgba(200,164,77,0.10)",
};

function Niche({ id, label, value, icon }: { id: string; label: string; value: string; icon: React.ReactNode }) {
  return (
    <div data-testid={`char-stat-${id}`} style={NICHE}>
      <div style={{ height: 22, display: "flex", alignItems: "center" }}>{icon}</div>
      <span style={{ color: GOLD, fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase" }}>{label}</span>
      <span style={{ color: "#fff", fontSize: 16, textShadow: "0 1px 3px #000" }}>{value}</span>
    </div>
  );
}

/**
 * One resistance, printed "capped% (uncapped%)" exactly as the reference does.
 * The two numbers only differ once gear pushes past RES_CAP, which is the whole
 * point of showing both: the sheet is where wasted overcap becomes visible.
 */
function ResPill({ id, label, pct, icon }: { id: string; label: string; pct: number; icon: React.ReactNode }) {
  return (
    <div
      data-testid={`char-res-${id}`}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 12px",
        background: "linear-gradient(180deg,#1a150e,#0d0b07)",
        border: "1px solid #2f2716",
        borderRadius: 20,
      }}
    >
      <span style={{ display: "flex", alignItems: "center" }}>{icon}</span>
      <span style={{ color: PARCHMENT, fontSize: 12, letterSpacing: 1, flex: 1 }}>{label}</span>
      <span style={{ color: "#fff", fontSize: 13 }}>
        {Math.min(pct, RES_CAP)}%{" "}
        <span style={{ color: "#6f6754", fontSize: 12 }}>({pct}%)</span>
      </span>
    </div>
  );
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

// Painted icons like the reference's would need art we do not ship, so these are
// flat vector glyphs in the same tints: red life drop, blue mana drop, gold
// crest for armour, orange flame for fire.
const Glyph = ({ d, fill, size = 18 }: { d: string; fill: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill={fill} stroke="rgba(0,0,0,0.6)" strokeWidth="0.7" />
  </svg>
);
const DROP = "M12 2C12 2 5 10.2 5 14.6 5 18.7 8.1 22 12 22s7-3.3 7-7.4C19 10.2 12 2 12 2z";
const CREST = "M12 2 3 5.5v6.2c0 5 3.8 9.2 9 10.3 5.2-1.1 9-5.3 9-10.3V5.5L12 2z";
const FLAME = "M13.5 1.5c.6 3.6-1.4 5-2.9 6.6C9 9.8 7 11.6 7 15a5 5 0 0 0 10 0c0-1.7-.6-3-1.4-4.2.2 1.3-.4 2.4-1.3 2.7.6-2.1-.2-4.6-1.4-6.2 1.4-.3 2.3-1.4 2.3-2.9 0-1.4-.7-2.6-1.7-2.9z";

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
        // Above the HUD (zIndex 3 in Hud.tsx), or the globes and the life
        // readout paint straight over the panel's lower rows.
        zIndex: 4,
        // No full-screen backdrop: PoE2 keeps the character sheet and the
        // inventory open side by side, so this must not swallow the world.
        pointerEvents: "auto",
        background: STONE,
        border: `1px solid ${GOLD_DIM}`,
        boxShadow: `0 0 0 1px #000, 0 0 0 4px #1b1710, 0 0 0 5px ${GOLD_DIM}, 0 14px 48px rgba(0,0,0,0.85)`,
        fontFamily: SERIF,
        color: PARCHMENT,
      }}
    >
      {/* Gold cartouche header */}
      <div
        style={{
          position: "sticky", top: 0, zIndex: 2,
          padding: "11px 0",
          textAlign: "center",
          background: "linear-gradient(180deg,#3a2c12,#6d5320 45%,#2c210d)",
          borderBottom: `1px solid ${GOLD_DIM}`,
          boxShadow: `inset 0 1px 0 ${GOLD}66, inset 0 -1px 0 #000`,
        }}
      >
        <span style={{ fontSize: 17, letterSpacing: 4, textTransform: "uppercase", color: "#f3e4bd", textShadow: "0 1px 2px #000" }}>
          Character
        </span>
        <button
          data-testid="character-close"
          onClick={onClose}
          style={{
            position: "absolute", top: 7, right: 10,
            width: 22, height: 22, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #b5442e, #6d1d13)",
            border: "1px solid #2b0d08", color: "#f0d3c4",
            cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Niche id="life" label="Life" value={String(Math.round(player.maxLife))} icon={<Glyph d={DROP} fill="#b8392f" />} />
          <Niche id="mana" label="Mana" value={String(Math.round(player.maxMana))} icon={<Glyph d={DROP} fill="#2f6fb8" />} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Niche id="armour" label="Armour" value={`${s.armourPct}%`} icon={<Glyph d={CREST} fill="#c8a44d" />} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 8px" }}>
          <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #3b2f18 60%)" }} />
          <span style={{ color: GOLD_DIM, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>Resistances</span>
          <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, #3b2f18 40%, transparent)" }} />
        </div>
        <ResPill id="fire" label="Fire" pct={s.fireResPct} icon={<Glyph d={FLAME} fill="#d1662a" size={15} />} />

        <div data-testid="char-detail" style={{ marginTop: 16 }}>
          <DetailSection title="Life" rows={[["Maximum Life", String(Math.round(player.maxLife))]]} />
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
              ["Fire Resistance", `${Math.min(s.fireResPct, RES_CAP)}% (${s.fireResPct}%)`],
            ]}
          />
          <DetailSection title="Offence" rows={[["Increased Spell Damage", `${s.spellDamagePct}%`]]} />
        </div>
      </div>
    </div>
  );
}
