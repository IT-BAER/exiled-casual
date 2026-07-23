import React from "react";
import type { Snapshot } from "@pact/protocol";
import { MAP_PORTALS } from "@pact/protocol";

const SKILL_SLOTS = [
  { id: "skill.ember_bolt.v1", key: "1", label: "Ember", glow: "#ff7a2f" },
  { id: "skill.cinder_ground.v1", key: "2", label: "Cinder", glow: "#e0492b" },
  { id: "skill.blink.v1", key: "3", label: "Blink", glow: "#3fb6ff" },
] as const;

// 3 life + 2 mana, keybinds 1-5, per inside-map.jpg. Charges aren't simulated yet,
// so this is a static HUD prop. ponytail: fixed 5-flask layout, wire to sim state
// when flask charges exist.
const FLASKS = [
  { key: "1", deep: "#5a0f0c", bright: "#d8352a" },
  { key: "2", deep: "#5a0f0c", bright: "#d8352a" },
  { key: "3", deep: "#5a0f0c", bright: "#d8352a" },
  { key: "4", deep: "#0e2c55", bright: "#3a9be0" },
  { key: "5", deep: "#0e2c55", bright: "#3a9be0" },
] as const;

/** A single PoE2 flask: recessed slot, glass vial with bottom-anchored liquid, cork neck. */
function Flask(props: { deep: string; bright: string; idx: number }) {
  const { deep, bright, idx } = props;
  return (
    <div
      data-testid={`flask-slot-${idx}`}
      style={{
        width: 26,
        height: 54,
        borderRadius: 4,
        background: "radial-gradient(circle at 50% 30%, #1a1e26, #05070a)",
        border: "1px solid #2a2013",
        boxShadow: "inset 0 0 6px rgba(0,0,0,0.8)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        padding: 3,
      }}
    >
      {/* glass vial */}
      <div
        style={{
          position: "relative",
          width: 16,
          height: 40,
          borderRadius: "4px 4px 6px 6px",
          overflow: "hidden",
          background: "#0a0c10",
          border: "1px solid rgba(200,180,120,0.35)",
        }}
      >
        {/* liquid — flasks read full */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "78%",
            background: `linear-gradient(to top, ${deep}, ${bright})`,
            boxShadow: "inset 0 2px 4px rgba(255,255,255,0.4)",
          }}
        />
        {/* cork neck */}
        <div style={{ position: "absolute", top: 0, left: 3, right: 3, height: 5, background: "#6b4a28", borderRadius: "0 0 2px 2px" }} />
        {/* specular stripe */}
        <div style={{ position: "absolute", top: 6, left: 3, width: 3, bottom: 4, background: "rgba(255,255,255,0.35)", borderRadius: 2 }} />
      </div>
    </div>
  );
}

interface HudProps {
  snapshot: Snapshot | null;
  /** Entity id the mouse is hovering — drives the name label. Null = no label. */
  hoveredEntityId?: number | null;
}

/** A PoE-style resource orb: dark well, bottom-anchored liquid at `pct`, gold ring. */
function Orb(props: {
  pct: number;
  fillTestId: string;
  deep: string;
  bright: string;
  value: string;
  side: "left" | "right";
}) {
  const { pct, fillTestId, deep, bright, value, side } = props;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        [side]: 28,
        width: 116,
        height: 116,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          overflow: "hidden",
          background: "radial-gradient(circle at 50% 42%, #12151b, #05070a)",
        }}
      >
        <div
          data-testid={fillTestId}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${pct}%`,
            background: `linear-gradient(to top, ${deep}, ${bright})`,
            boxShadow: "inset 0 4px 7px rgba(255,255,255,0.30)", // liquid meniscus highlight
            transition: "height 120ms linear",
          }}
        />
        {/* sphere volume: dark rim vignette so the edges read as curvature */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 50% 50%, transparent 50%, rgba(0,0,0,0.6) 92%)" }} />
        {/* specular glass highlight, upper-left */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(ellipse 46% 34% at 34% 24%, rgba(255,255,255,0.5), rgba(255,255,255,0) 62%)" }} />
      </div>
      {/* ornate beveled metal frame */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: "3px solid #b8903f",
          boxShadow: [
            "0 0 0 1px #e6c877", // bright inner bevel
            "0 0 0 4px #6d5220", // dark gold band
            "0 0 0 6px #2a2013", // black outline
            "0 4px 12px rgba(0,0,0,0.7)", // drop shadow
            "inset 0 0 14px rgba(0,0,0,0.6)", // seat the glass into the frame
          ].join(", "),
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "#f4f0e6",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.3,
          textShadow: "0 1px 3px #000",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function Hud({ snapshot, hoveredEntityId = null }: HudProps) {
  if (!snapshot) return null;

  const { life, maxLife, mana, maxMana, cooldowns } = snapshot.player;
  const lifePct = maxLife > 0 ? Math.max(0, Math.min(100, (life / maxLife) * 100)) : 0;
  const manaPct = maxMana > 0 ? Math.max(0, Math.min(100, (mana / maxMana) * 100)) : 0;

  const boss = snapshot.entities.find((e) => e.boss);

  // Hovered entity drives the name label — mouse proximity, not character proximity.
  // inRange (character distance) only drives the auto-interact fire; never shown.
  const hoveredEntity =
    hoveredEntityId !== null
      ? snapshot.entities.find(
          (e) => e.id === hoveredEntityId && (e.kind === "portal" || e.kind === "mapDevice"),
        )
      : undefined;
  const hoverLabel = hoveredEntity
    ? hoveredEntity.kind === "mapDevice"
      ? "Map Device"
      : snapshot.area === "hideout"
      ? "Enter Map"
      : "Return to Hideout"
    : null;
  const bossLifePct =
    boss && boss.maxLife && boss.maxLife > 0
      ? Math.max(0, Math.min(100, ((boss.life ?? 0) / boss.maxLife) * 100))
      : 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        userSelect: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {boss && (
        <div
          data-testid="boss-bar"
          style={{
            position: "absolute",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            width: 400,
            height: 22,
            background: "#0b0d11",
            border: "2px solid #4a3a1c",
            borderRadius: 4,
            overflow: "hidden",
            boxShadow: "0 2px 8px rgba(0,0,0,0.7)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${bossLifePct}%`,
              background: "linear-gradient(to right, #6d0a0a, #c4241a)",
              transition: "width 120ms linear",
            }}
          />
          <div
            data-testid="boss-phase"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#f4f0e6",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textShadow: "0 1px 3px #000",
            }}
          >
            {boss.bossPhase === 2 ? "II" : "I"}
          </div>
        </div>
      )}

      {/* Area label — top-right, matches the gold border language of the orb ring */}
      <div
        data-testid="area-label"
        style={{
          position: "absolute",
          top: 20,
          right: 28,
          color: "#c9a84c",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1,
          textShadow: "0 1px 4px #000",
          textTransform: "uppercase",
        }}
      >
        {snapshot.area === "hideout" ? "Hideout" : "Map"}
      </div>

      {/* Portal budget — shown while a map is open, next to the area label */}
      {snapshot.mapOpen && (
        <div
          data-testid="portal-counter"
          style={{
            position: "absolute",
            top: 38,
            right: 28,
            color: "#8ab4e8",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.5,
            textShadow: "0 1px 3px #000",
          }}
        >
          {`Portals ${snapshot.portalsLeft} / ${MAP_PORTALS}`}
        </div>
      )}

      {/* Hovered interactable name — centered, just above the skill bar */}
      {hoverLabel && (
        <div
          data-testid="interact-label"
          style={{
            position: "absolute",
            bottom: 100,
            left: "50%",
            transform: "translateX(-50%)",
            color: "#f4f0e6",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 0.5,
            textShadow: "0 1px 4px #000, 0 0 12px rgba(100,140,220,0.55)",
            background: "rgba(0,0,0,0.45)",
            padding: "4px 14px",
            borderRadius: 4,
            border: "1px solid #4a5a7a",
            whiteSpace: "nowrap",
          }}
        >
          {hoverLabel}
        </div>
      )}

      <Orb
        pct={lifePct}
        fillTestId="life-orb-fill"
        deep="#6d1410"
        bright="#e33b2c"
        value={`${Math.round(life)}`}
        side="left"
      />
      <Orb
        pct={manaPct}
        fillTestId="mana-orb-fill"
        deep="#0e2c55"
        bright="#3a9be0"
        value={`${Math.round(mana)}`}
        side="right"
      />

      {/* Flask row — right of the life orb, per inside-map.jpg */}
      <div
        data-testid="flask-row"
        style={{
          position: "absolute",
          bottom: 26,
          left: 150,
          display: "flex",
          gap: 4,
          padding: "6px 8px",
          background: "linear-gradient(#15120c, #0a0806)",
          border: "2px solid #6d5220",
          borderRadius: 6,
          boxShadow: [
            "inset 0 0 0 1px #b8903f",
            "0 3px 10px rgba(0,0,0,0.7)",
          ].join(", "),
        }}
      >
        {FLASKS.map((f, i) => (
          <div key={f.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <Flask deep={f.deep} bright={f.bright} idx={i + 1} />
            <span style={{ fontSize: 10, color: "#9aa0a8", textShadow: "0 1px 2px #000" }}>{f.key}</span>
          </div>
        ))}
      </div>

      {/* Skill bar — left of the mana orb, mirroring the flask row, per inside-map.jpg */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          right: 150,
          display: "flex",
          gap: 10,
        }}
      >
        {SKILL_SLOTS.map((slot, idx) => {
          const cd = cooldowns[slot.id] ?? 0;
          const ready = cd <= 0;
          return (
            <div
              key={slot.id}
              data-testid={`skill-slot-${idx + 1}`}
              style={{
                width: 60,
                height: 60,
                position: "relative",
                background: ready
                  ? "radial-gradient(circle at 50% 35%, #333a44, #12151b)"
                  : "#12151b",
                border: `2px solid ${ready ? "#9c7b3a" : "#3a4048"}`,
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: ready
                  ? `0 0 10px ${slot.glow}55, inset 0 0 8px rgba(0,0,0,0.6)`
                  : "inset 0 0 8px rgba(0,0,0,0.7)",
                color: ready ? "#f4f0e6" : "#7b828c",
                fontSize: 11,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: 5,
                  fontSize: 10,
                  color: "#9aa0a8",
                }}
              >
                {slot.key}
              </span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: ready ? slot.glow : "#565c64",
                  lineHeight: 1,
                }}
              >
                {slot.label[0]}
              </span>
              <span style={{ marginTop: 3 }}>{ready ? "Ready" : `${cd.toFixed(1)}s`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
