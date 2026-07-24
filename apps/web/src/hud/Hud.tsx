import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { MAP_PORTALS } from "@exiled/protocol";

// Six skill slots on keys 1-6; only three skills exist, 4-6 render as empty sockets.
// PoE2 itself puts skills on QWERT and flasks on the digits — we swap the two, so
// the movement hand keeps the flasks. Deliberate, not a parity miss.
type SkillSlot = { id: string | null; key: string; icon?: string; glow?: string };
const SKILL_SLOTS: SkillSlot[] = [
  { id: "skill.ember_bolt.v1", key: "1", icon: "/textures/skills/ember_bolt.png", glow: "#ff7a2f" },
  { id: "skill.cinder_ground.v1", key: "2", icon: "/textures/skills/cinder_ground.png", glow: "#e0492b" },
  { id: "skill.blink.v1", key: "3", icon: "/textures/skills/blink.png", glow: "#3fb6ff" },
  { id: null, key: "4" },
  { id: null, key: "5" },
  { id: null, key: "6" },
];

// One life flask on Q, one mana flask on E. Charges aren't simulated yet, so these
// are static HUD props and the keys do nothing.
// ponytail: decorative flasks, wire to sim state when flask charges exist.
const FLASKS = [
  { kind: "life", key: "Q" },
  { kind: "mana", key: "E" },
] as const;

/** A single flask: recessed PoE2 socket holding the painted vial. */
function Flask(props: { kind: "life" | "mana" }) {
  const { kind } = props;
  return (
    <div
      data-testid={`flask-${kind}`}
      style={{
        width: 34,
        height: 58,
        borderRadius: 4,
        background: "radial-gradient(circle at 50% 30%, #1a1e26, #05070a)",
        border: "1px solid #2a2013",
        boxShadow: "inset 0 0 6px rgba(0,0,0,0.8)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <img
        src={`/textures/ui/flask_${kind}.png`}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.8))",
        }}
      />
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
      {/* ornate PoE2 orb frame (generated art). The PNG has a black background, so an
          annular mask keeps only the gold band (59-74px radius) and drops the black
          center + corners, letting the live liquid show through the hole. */}
      <div
        style={{
          position: "absolute",
          inset: -22, // 116 + 44 = 160px frame; hole aligns to the 116 liquid sphere
          backgroundImage: "url(/hud/orb-frame-v1.png)",
          backgroundSize: "100% 100%",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 50%, transparent 56px, #000 59px, #000 74px, transparent 78px)",
          maskImage:
            "radial-gradient(circle at 50% 50%, transparent 56px, #000 59px, #000 74px, transparent 78px)",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
          pointerEvents: "none",
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
        {FLASKS.map((f) => (
          <div key={f.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <Flask kind={f.kind} />
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
          const cd = slot.id ? cooldowns[slot.id] ?? 0 : 0;
          const ready = cd <= 0;
          return (
            <div
              key={slot.key}
              data-testid={`skill-slot-${idx + 1}`}
              style={{
                width: 56,
                height: 56,
                position: "relative",
                overflow: "hidden",
                background: slot.icon
                  ? "radial-gradient(circle at 50% 35%, #262c34, #0b0d11)"
                  : "radial-gradient(circle at 50% 35%, #14171d, #07090c)",
                border: `2px solid ${slot.icon && ready ? "#9c7b3a" : "#3a4048"}`,
                borderRadius: 6,
                boxShadow: slot.icon && ready
                  ? `0 0 10px ${slot.glow}55, inset 0 0 8px rgba(0,0,0,0.6)`
                  : "inset 0 0 8px rgba(0,0,0,0.7)",
              }}
            >
              {slot.icon && (
                <img
                  src={slot.icon}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: ready ? "none" : "grayscale(0.8) brightness(0.5)",
                  }}
                />
              )}
              {/* cooldown veil, PoE-style: the tile darkens and counts down */}
              {!ready && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(4,6,10,0.55)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#f4f0e6",
                    fontSize: 13,
                    fontWeight: 700,
                    textShadow: "0 1px 3px #000",
                  }}
                >
                  {`${cd.toFixed(1)}s`}
                </div>
              )}
              <span
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  padding: "0 4px 1px",
                  borderTopRightRadius: 4,
                  background: "rgba(4,6,10,0.7)",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#c9cdd3",
                  textShadow: "0 1px 3px #000",
                }}
              >
                {slot.key}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
