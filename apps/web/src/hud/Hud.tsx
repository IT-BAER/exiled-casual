import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { MAP_PORTALS } from "@exiled/protocol";

// Bottom HUD geometry, measured off poe2-screenshots/floor#2.webp (2048x1152): the
// liquid sphere is 8.4% of the screen width, the frame ring sits flush with the bottom
// edge and about 1.2% of the width in from the side, and the bars butt up against it.
const ORB = 136; // liquid sphere diameter
const ORB_FRAME = Math.round(ORB / 0.716); // frame art: its hole is 0.716 of the file
const ORB_RING = (ORB_FRAME - ORB) / 2; // ring band thickness
const ORB_INSET = 24 + ORB_RING; // sphere offset from the side; ring keeps a 24px margin
const ORB_BOTTOM = ORB_RING; // ring flush with the bottom edge, sphere sits on top of it
const BAR_H = 76; // flask / skill bar height, incl. the art's top and bottom rails
const SLOT = 42; // flask + skill slot size, sized to the bar art's inner trough

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

/** A single flask: recessed PoE2 socket holding the painted vial, hotkey at its foot. */
function Flask(props: { kind: "life" | "mana"; hotkey: string }) {
  const { kind, hotkey } = props;
  return (
    <div
      data-testid={`flask-${kind}`}
      style={{
        position: "relative",
        width: 30,
        height: SLOT,
        borderRadius: "3px 3px 8px 8px",
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
      <span
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 10,
          fontWeight: 700,
          color: "#c9cdd3",
          background: "rgba(4,6,10,0.7)",
          textShadow: "0 1px 3px #000",
        }}
      >
        {hotkey}
      </span>
    </div>
  );
}

interface HudProps {
  snapshot: Snapshot | null;
  /** Entity id the mouse is hovering — drives the name label. Null = no label. */
  hoveredEntityId?: number | null;
}

/** Ornate bar backing, 9-sliced so the corner brackets never stretch. */
const barStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  height: BAR_H,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 5,
  borderStyle: "solid",
  borderWidth: "16px 40px 18px 40px",
  borderImageSource: "url(/hud/bar-panel-v1.png)",
  borderImageSlice: "42 110 48 110 fill",
  filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.7))",
};

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
        bottom: ORB_BOTTOM,
        [side]: ORB_INSET,
        width: ORB,
        height: ORB,
        zIndex: 3,
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
            boxShadow: "inset 0 3px 6px rgba(255,255,255,0.22)", // liquid meniscus highlight
            transition: "height 120ms linear",
          }}
        />
        {/* sphere volume: dark rim vignette so the edges read as curvature */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 50% 50%, transparent 42%, rgba(0,0,0,0.75) 94%)" }} />
        {/* specular glass highlight, upper-left */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(ellipse 52% 40% at 38% 26%, rgba(255,255,255,0.16), rgba(255,255,255,0) 70%)" }} />
      </div>
      {/* Orb frame (generated art). Its alpha is baked in: the hole is 0.716 of the
          file's width, so at ORB_FRAME the ring lands exactly on the liquid sphere. */}
      <img
        src="/hud/orb-frame-v4.png"
        alt=""
        style={{
          position: "absolute",
          width: ORB_FRAME,
          height: ORB_FRAME,
          left: (ORB - ORB_FRAME) / 2,
          top: (ORB - ORB_FRAME) / 2,
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 14,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "#f4f0e6",
          fontSize: 14,
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
        deep="#3d0a0f"
        bright="#94222a"
        value={`${Math.round(life)}`}
        side="left"
      />
      <Orb
        pct={manaPct}
        fillTestId="mana-orb-fill"
        deep="#131f41"
        bright="#1f6498"
        value={`${Math.round(mana)}`}
        side="right"
      />

      {/* Flask bar — tucked under the life orb frame, per boss-fight.png */}
      <div data-testid="flask-row" style={{ ...barStyle, left: ORB_INSET + ORB + ORB_RING - 16, zIndex: 2 }}>
        {FLASKS.map((f) => (
          <Flask key={f.key} kind={f.kind} hotkey={f.key} />
        ))}
      </div>

      {/* Skill bar — mirror of the flask bar, tucked under the mana orb frame */}
      <div style={{ ...barStyle, right: ORB_INSET + ORB + ORB_RING - 16, zIndex: 2 }}>
        {SKILL_SLOTS.map((slot, idx) => {
          const cd = slot.id ? cooldowns[slot.id] ?? 0 : 0;
          const ready = cd <= 0;
          return (
            <div
              key={slot.key}
              data-testid={`skill-slot-${idx + 1}`}
              style={{
                width: SLOT,
                height: SLOT,
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
