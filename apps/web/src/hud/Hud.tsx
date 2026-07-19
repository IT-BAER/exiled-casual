import React from "react";
import type { Snapshot } from "@pact/protocol";

const SKILL_SLOTS = [
  { id: "skill.ember_bolt.v1", label: "Ember Bolt" },
  { id: "skill.cinder_ground.v1", label: "Cinder Ground" },
  { id: "skill.blink.v1", label: "Blink" },
] as const;

interface HudProps {
  snapshot: Snapshot | null;
}

export function Hud({ snapshot }: HudProps) {
  if (!snapshot) return null;

  const { life, maxLife, mana, maxMana, cooldowns } = snapshot.player;
  const lifePct = maxLife > 0 ? (life / maxLife) * 100 : 0;
  const manaPct = maxMana > 0 ? (mana / maxMana) * 100 : 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {/* Resource bars */}
      <div style={{ display: "flex", gap: 8 }}>
        <div
          data-testid="life-bar"
          style={{ width: 180, height: 14, background: "#333", borderRadius: 4, overflow: "hidden" }}
        >
          <div
            data-testid="life-bar-fill"
            style={{ width: `${lifePct}%`, height: "100%", background: "#c0392b" }}
          />
        </div>
        <div
          data-testid="mana-bar"
          style={{ width: 120, height: 14, background: "#333", borderRadius: 4, overflow: "hidden" }}
        >
          <div
            data-testid="mana-bar-fill"
            style={{ width: `${manaPct}%`, height: "100%", background: "#2980b9" }}
          />
        </div>
      </div>

      {/* Skill slots */}
      <div style={{ display: "flex", gap: 8 }}>
        {SKILL_SLOTS.map((slot, idx) => {
          const cd = cooldowns[slot.id] ?? 0;
          const ready = cd <= 0;
          return (
            <div
              key={slot.id}
              data-testid={`skill-slot-${idx + 1}`}
              style={{
                width: 56,
                height: 56,
                background: ready ? "#4a4a4a" : "#2a2a2a",
                border: `2px solid ${ready ? "#aaa" : "#555"}`,
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: ready ? "#fff" : "#888",
                fontSize: 11,
              }}
            >
              <span>{idx + 1}</span>
              <span>{ready ? "Ready" : `${cd.toFixed(1)}s`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
