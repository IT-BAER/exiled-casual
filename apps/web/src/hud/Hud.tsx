import React from "react";
import type { Snapshot } from "@pact/protocol";

const SKILL_SLOTS = [
  { id: "skill.ember_bolt.v1", key: "1", label: "Ember", glow: "#ff7a2f" },
  { id: "skill.cinder_ground.v1", key: "2", label: "Cinder", glow: "#e0492b" },
  { id: "skill.blink.v1", key: "3", label: "Blink", glow: "#3fb6ff" },
] as const;

interface HudProps {
  snapshot: Snapshot | null;
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
          background: "#0b0d11",
          boxShadow: "inset 0 0 24px rgba(0,0,0,0.85)",
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
            transition: "height 120ms linear",
          }}
        />
        {/* glass sheen */}
        <div
          style={{
            position: "absolute",
            top: "12%",
            left: "20%",
            width: "36%",
            height: "24%",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.22)",
            filter: "blur(3px)",
          }}
        />
      </div>
      {/* ornate gold ring */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: "4px solid #9c7b3a",
          boxShadow:
            "0 0 0 2px #4a3a1c, 0 3px 10px rgba(0,0,0,0.6), inset 0 0 12px rgba(0,0,0,0.55)",
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

export function Hud({ snapshot }: HudProps) {
  if (!snapshot) return null;

  const { life, maxLife, mana, maxMana, cooldowns } = snapshot.player;
  const lifePct = maxLife > 0 ? Math.max(0, Math.min(100, (life / maxLife) * 100)) : 0;
  const manaPct = maxMana > 0 ? Math.max(0, Math.min(100, (mana / maxMana) * 100)) : 0;

  const boss = snapshot.entities.find((e) => e.boss);
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

      {/* Skill bar */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
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
