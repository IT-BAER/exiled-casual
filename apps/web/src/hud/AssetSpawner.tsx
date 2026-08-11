import React from "react";
import { SPAWNABLE } from "../render/gallery";
import type { SpawnKind } from "@exiled/protocol";

/**
 * The sim half of the workbench. Every one of these also has a numpad key
 * (`SPAWN_KEYS`, bindings.ts), which nobody discovers; the labels say what the
 * press does, not what the message is called.
 */
const SIM_ACTIONS: { kind: SpawnKind; label: string }[] = [
  { kind: "imp", label: "one imp" },
  { kind: "pack", label: "a pack" },
  { kind: "rare", label: "a rare" },
  { kind: "boss", label: "the boss" },
  { kind: "hurtboss", label: "hurt boss -20%" },
  { kind: "item", label: "drop an item" },
  { kind: "shields", label: "both shields" },
  { kind: "levelup", label: "level up +1" },
  { kind: "clear", label: "kill all monsters" },
];

/**
 * F4's asset menu: pick one thing and stand it on the floor.
 *
 * Deliberately plain. This is a workbench, not part of the game's furniture, so
 * it borrows the F3 readout's flat black panel rather than the nine-slice frame
 * every real panel wears — a dev tool that looks like a game panel is a dev tool
 * somebody screenshots by accident.
 */
export function AssetSpawner({
  onSpawn,
  onClear,
  onClose,
  onSim,
  standing,
}: {
  onSpawn: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Sends a lab spawn message to the worker. */
  onSim: (kind: SpawnKind) => void;
  /** How many are on the floor already, so the Clear button can say. */
  standing: number;
}) {
  const groups = ["Props", "Creatures"] as const;
  return (
    <div
      data-testid="asset-spawner"
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 50,
        width: 210,
        maxHeight: "78vh",
        overflowY: "auto",
        padding: "8px 10px",
        background: "rgba(0, 0, 0, 0.78)",
        color: "#cfd6dd",
        font: "12px/1.5 Consolas, monospace",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: "#9f9" }}>spawn asset</span>
        <button type="button" onClick={onClose} style={CLOSE}>x</button>
      </div>
      {groups.map((group) => (
        <div key={group}>
          <div style={{ color: "#7a8792", marginTop: 6 }}>{group}</div>
          {SPAWNABLE.filter((s) => s.group === group).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSpawn(s.id)}
              style={ROW}
            >
              {s.label}
            </button>
          ))}
        </div>
      ))}
      <div style={{ color: "#7a8792", marginTop: 6 }}>Sim</div>
      {SIM_ACTIONS.map((a) => (
        <button
          key={a.kind}
          type="button"
          data-testid={`sim-${a.kind}`}
          onClick={() => onSim(a.kind)}
          style={a.kind === "clear" ? { ...ROW, color: "#e08a7a" } : ROW}
        >
          {a.label}
        </button>
      ))}
      <button type="button" onClick={onClear} style={{ ...ROW, marginTop: 8, color: "#e08a7a" }}>
        clear assets {standing > 0 ? `(${standing})` : ""}
      </button>
    </div>
  );
}

const ROW: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "2px 4px",
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

const CLOSE: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#7a8792",
  font: "inherit",
  cursor: "pointer",
};
