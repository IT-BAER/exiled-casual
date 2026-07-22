import React from "react";
import type { Snapshot } from "@pact/protocol";

type Inventory = Snapshot["inventory"];

// Matches PreparationPanel.tsx's PoE2 gilt-frame idiom for HUD consistency.
const SERIF = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const GOLD = "#c8a44d";
const GOLD_DIM = "#7a5c22";
const PARCHMENT = "#e8dcc0";
const MAGIC = "#8aa6ff";

const CELL = 44;
const RARITY_BORDER: Record<string, string> = { normal: "#6b6b6b", magic: "#5566b0" };
const RARITY_TEXT: Record<string, string> = { normal: "#c8c8c8", magic: MAGIC };

export function InventoryPanel({ inventory, onClose }: { inventory: Inventory; onClose: () => void }) {
  const { cols, rows, items } = inventory;
  return (
    <div
      data-testid="inventory-panel"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.55), rgba(0,0,0,0.78))",
        pointerEvents: "auto",
        fontFamily: SERIF,
        color: PARCHMENT,
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg,#0e0f13,#100d09)",
          border: `1px solid ${GOLD_DIM}`,
          boxShadow: `0 0 0 1px #000, 0 0 0 4px #1b1710, 0 0 0 5px ${GOLD_DIM}, 0 14px 48px rgba(0,0,0,0.8)`,
        }}
      >
        {/* Carved title banner, same idiom as PreparationPanel's "Map Device" */}
        <div
          style={{
            position: "relative",
            padding: "12px 0",
            textAlign: "center",
            background: "linear-gradient(180deg,#4a1a13,#6b2018 45%,#3a1310)",
            borderBottom: `1px solid ${GOLD_DIM}`,
            boxShadow: `inset 0 1px 0 ${GOLD}55, inset 0 -1px 0 #000`,
          }}
        >
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: PARCHMENT,
              textShadow: "0 1px 2px #000",
            }}
          >
            Inventory
          </span>
          <button
            data-testid="inventory-close"
            onClick={onClose}
            style={{
              position: "absolute",
              top: 8,
              right: 12,
              background: "none",
              border: "none",
              color: "#c9b48a",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 22 }}>
          <div style={{ position: "relative", width: cols * CELL, height: rows * CELL, background: "#0b0d11", border: `1px solid ${GOLD_DIM}` }}>
            {Array.from({ length: rows }).map((_, y) =>
              Array.from({ length: cols }).map((__, x) => (
                <div
                  key={`${x}-${y}`}
                  data-testid={`inventory-cell-${x}-${y}`}
                  style={{
                    position: "absolute",
                    left: x * CELL,
                    top: y * CELL,
                    width: CELL,
                    height: CELL,
                    border: "1px solid #241d12",
                  }}
                />
              )),
            )}
            {items.map((it, i) => (
              <div
                key={i}
                data-testid={`inventory-item-${i}`}
                title={`${it.name}${it.lines.length ? "\n" + it.lines.join("\n") : ""}`}
                style={{
                  position: "absolute",
                  left: it.x * CELL + 2,
                  top: it.y * CELL + 2,
                  width: it.w * CELL - 4,
                  height: it.h * CELL - 4,
                  border: `2px solid ${RARITY_BORDER[it.rarity]}`,
                  background: "rgba(10,12,20,0.85)",
                  color: RARITY_TEXT[it.rarity],
                  fontFamily: SERIF,
                  fontSize: 11,
                  letterSpacing: 0.3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: 2,
                  boxSizing: "border-box",
                }}
              >
                {it.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
