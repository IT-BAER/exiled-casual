import React from "react";
import type { DeathRecap as Recap, MonsterElement, PlayerStats } from "@exiled/protocol";
import { MONSTERS } from "@exiled/content-runtime";
import { RES_CAP } from "@exiled/rules";
import { SERIF } from "../menu/frames";

/** The sim's name for a burning tick's source (simulation/death-recap.ts). */
const BURNING = "ailment.burning";
/** A killing blow this big is its own lesson: one hit, not attrition. */
const BIG_HIT_PCT = 50;

const ELEMENT: Record<MonsterElement, { label: string; tint: string }> = {
  fire: { label: "Fire", tint: "#e8743b" },
  cold: { label: "Cold", tint: "#8fd0ef" },
  lightning: { label: "Lightning", tint: "#f2d55a" },
  chaos: { label: "Chaos", tint: "#c98fdd" },
  physical: { label: "Physical", tint: "#c9bda8" },
};

/** Rendered from monsters.glb by tools/build_monster_portraits.py. */
export function monsterPortrait(species: string): string | null {
  return MONSTERS.has(species) ? `/hud/monsters/${species.replace(/^monster\./, "").replace(/\.v1$/, "")}.webp` : null;
}

function sourceName(species: string, rare: boolean): string {
  if (species === BURNING) return "Burning";
  const name = MONSTERS.get(species)?.name ?? "Unknown";
  return rare ? `Rare ${name}` : name;
}

/** One tip, from the element that did the most: the defence that answers it, as he has it now. */
function tip(recap: Recap, stats: PlayerStats): string {
  const [el] = (Object.entries(recap.byElement) as [MonsterElement, number][])
    .reduce((a, b) => (b[1] > a[1] ? b : a), ["physical", -1]);
  if (el === "physical") {
    return `Physical hits did the most. You have ${stats.armour} armour (${stats.armourPct}% off a typical hit): more armour or life.`;
  }
  const { label } = ELEMENT[el];
  const res = stats.res[el];
  const shield = el === "chaos" ? " Energy shield takes double from chaos." : "";
  return res < RES_CAP
    ? `${label} did the most. ${label} resistance is ${res}% of a ${RES_CAP}% cap: raise it on gear.${shield}`
    : `${label} did the most, and your ${label.toLowerCase()} resistance is capped: more life or energy shield.${shield}`;
}

function Portrait({ species }: { species: string }) {
  const src = monsterPortrait(species);
  return (
    <div style={{
      width: 40, height: 40, flex: "none", borderRadius: 3,
      background: "rgba(0,0,0,0.45)", boxShadow: "inset 0 0 0 1px rgba(160,130,90,0.35)",
    }}>
      {src && <img src={src} alt="" width={40} height={40} style={{ display: "block" }} />}
    </div>
  );
}

/**
 * What killed him, on the death screen. Neither PoE has one; players of both ask for
 * the killing blow and what took the most over the last seconds, so that is what shows.
 */
export function DeathRecap({ recap, stats }: { recap: Recap; stats: PlayerStats }) {
  const kb = recap.killingBlow;
  const kbEl = ELEMENT[kb.element];
  return (
    <div style={{ fontFamily: SERIF, fontSize: 13, color: "#b8ada0", marginBottom: 16 }}>
      <div data-testid="recap-killing-blow" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Portrait species={kb.species} />
        <div>
          <div style={{ color: "#7d7469", fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>Killing blow</div>
          <div>
            <span style={{ color: "#e2d6c4" }}>{sourceName(kb.species, kb.rare)}</span>
            {" "}for <span style={{ color: kbEl.tint }}>{kb.damage} {kbEl.label}</span>
          </div>
        </div>
      </div>
      {recap.sources.map((s) => {
        const el = ELEMENT[s.element];
        const share = recap.total > 0 ? Math.round((s.damage * 100) / recap.total) : 0;
        return (
          <div key={`${s.species}|${s.rare}`} data-testid="recap-source"
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Portrait species={s.species} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{sourceName(s.species, s.rare)} <span style={{ color: "#7d7469" }}>x{s.hits}</span></span>
                <span style={{ color: el.tint }}>{s.damage} {el.label}</span>
              </div>
              <div style={{ height: 4, marginTop: 4, background: "rgba(255,255,255,0.06)" }}>
                <div style={{ width: `${share}%`, height: "100%", background: el.tint, opacity: 0.8 }} />
              </div>
            </div>
          </div>
        );
      })}
      {kb.pctOfLife >= BIG_HIT_PCT && (
        <div data-testid="recap-big-hit" style={{ marginTop: 10, color: "#c1443a" }}>
          One hit took {kb.pctOfLife}% of your life.
        </div>
      )}
      <div data-testid="recap-tip" style={{ marginTop: 10, color: "#9a9187", maxWidth: 360 }}>
        {tip(recap, stats)}
      </div>
    </div>
  );
}
