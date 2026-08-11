import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { SERIF } from "./ItemTooltip";

const GOLD = "#c8aa6e";
const GOLD_DIM = "#6b5a34";
const PARCHMENT = "#c8c2b4";
const MODIFIER = "#8888ff"; // PoE1 prints skill modifiers in periwinkle

type Skill = NonNullable<Snapshot["skills"]>[number];

/** One right-hand stat column: label over value, like PoE1's gem header. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "0 12px", borderLeft: `1px solid ${GOLD_DIM}`, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: PARCHMENT, opacity: 0.75, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#fff", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

/**
 * PoE1 anchors the skill tooltip to the bar, not the cursor: it sits above the
 * slot row and stays put while you sweep across the sockets.
 */
export function SkillTooltip(
  { skills, id, right, bottom }: { skills: Skill[] | undefined; id: string | null; right: string; bottom: string },
) {
  const skill = skills?.find((s) => s.id === id);
  if (!skill) return null;
  return (
    <div
      data-testid="skill-tooltip"
      style={{
        position: "absolute",
        bottom,
        right,
        width: 430,
        zIndex: 5,
        pointerEvents: "none",
        fontFamily: SERIF,
        background: "linear-gradient(180deg,#0a0a0a,#000)",
        border: `1px solid ${GOLD_DIM}`,
        boxShadow: "0 0 18px rgba(0,0,0,0.9)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
        <div style={{ flex: 1, fontSize: 17, color: GOLD, letterSpacing: 1, whiteSpace: "nowrap" }}>
          {skill.name}
          {/* PoE1's own gem header (skill-tooltip.png) carries the level as a
              badge on the icon, never a fifth stat column: four columns already
              fill the fixed 430px width, and a fifth pushed the name off the
              DPS column. The tooltip draws no icon, so the level rides the name
              line instead, dim rather than gold so it reads as metadata. */}
          <span style={{ marginLeft: 8, fontSize: 12, color: GOLD_DIM }}>{`Level ${skill.gemLevel}`}</span>
        </div>
        {skill.dps !== undefined && <Stat label="DPS" value={String(Math.round(skill.dps))} />}
        <Stat label="Cost" value={`${skill.manaCost} Mana`} />
        <Stat label="Cast Time" value={`${skill.castTimeSec.toFixed(2)} sec`} />
        {skill.cooldownSec > 0 && <Stat label="Cooldown" value={`${skill.cooldownSec.toFixed(2)} sec`} />}
      </div>
      {/* The empty track must read as a vessel waiting to fill, so it stays
          visible against the tooltip's black gradient at 0% fill. */}
      {skill.gemXpToNext > 0 && (
        <div data-testid="gem-xp-rail" style={{ height: 3, background: "#3a2c10" }}>
          <div
            data-testid="gem-xp-fill"
            style={{
              height: "100%",
              width: `${Math.min(100, Math.round((skill.gemXp * 100) / skill.gemXpToNext))}%`,
              background: GOLD_DIM,
            }}
          />
        </div>
      )}
      <div style={{ height: 1, background: GOLD_DIM, opacity: 0.6 }} />
      <div style={{ padding: "8px 12px", fontSize: 13, color: PARCHMENT, lineHeight: 1.35 }}>{skill.description}</div>
      {(skill.breakpoints.length > 0 || skill.nextBreakpoint) && (
        <>
          <div style={{ height: 1, background: GOLD_DIM, opacity: 0.6 }} />
          <div data-testid="breakpoints" style={{ padding: "8px 12px", fontSize: 13, lineHeight: 1.4 }}>
            {skill.breakpoints.map((text) => (
              <div key={text} style={{ color: MODIFIER }}>{text}</div>
            ))}
            {/* The grey line is where the anticipation lives (docs/09 rule 1):
                it is the cheapest device in the whole design, so it is shown
                even before the first breakpoint is reached. */}
            {skill.nextBreakpoint && (
              <div data-testid="next-breakpoint" style={{ color: "#5a5a5a" }}>
                {`Level ${skill.nextBreakpoint.atLevel}: ${skill.nextBreakpoint.text}`}
              </div>
            )}
          </div>
        </>
      )}
      {skill.lines.length > 0 && (
        <>
          <div style={{ height: 1, background: GOLD_DIM, opacity: 0.6 }} />
          <div style={{ padding: "8px 12px", fontSize: 13, color: MODIFIER, textAlign: "center", lineHeight: 1.4 }}>
            {skill.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
