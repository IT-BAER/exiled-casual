import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { ItemTooltip } from "./ItemTooltip";

type Inventory = Snapshot["inventory"];

// PoE2 inventory+equipment screen. The 12x5 backpack grid is functional (fed by
// snapshot.inventory, the real drop->pickup path). The equipment paper-doll,
// flask row and currency strip are styled placeholders: equipping, flasks and
// currency are not in the sim yet, so those slots are honestly empty.
// Matches poe2-screenshots/inventory+equipment.png.
const SERIF = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const GOLD = "#c8a44d";
const GOLD_DIM = "#7a5c22";
const PARCHMENT = "#e8dcc0";
const MAGIC = "#8aa6ff";

const CELL = 40; // backpack grid cell
const U = 46; // equipment paper-doll unit

const RARITY_BORDER: Record<string, string> = { normal: "#6b6b6b", magic: "#5566b0" };
const RARITY_TEXT: Record<string, string> = { normal: "#c8c8c8", magic: MAGIC };

// A single equipment slot: dark inset, gold-brown frame, ghosted type label.
function slotStyle(): React.CSSProperties {
  return {
    position: "absolute",
    background: "radial-gradient(ellipse at 50% 35%, #16130d 0%, #0b0906 100%)",
    border: "1px solid #3b2f18",
    boxShadow: "inset 0 0 10px rgba(0,0,0,0.75), inset 0 1px 0 rgba(200,164,77,0.08)",
    borderRadius: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#5a4c30",
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "center",
    userSelect: "none",
  };
}

function EquipSlot({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return (
    <div
      data-testid={`equip-slot-${label.toLowerCase()}-${x}-${y}`}
      style={{ ...slotStyle(), left: x * U, top: y * U, width: w * U - 4, height: h * U - 4, margin: 2 }}
    >
      {label}
    </div>
  );
}

// Life/mana flask or charm vial.
function Flask({ kind }: { kind: "life" | "mana" | "charm" }) {
  const fill =
    kind === "life"
      ? "linear-gradient(180deg,#7d1420 0%,#c0303a 55%,#5c0e17 100%)"
      : kind === "mana"
        ? "linear-gradient(180deg,#12315f 0%,#2f66c4 55%,#0d2247 100%)"
        : "linear-gradient(180deg,#3a2a52 0%,#6b4fa0 55%,#241a36 100%)";
  return (
    <div
      style={{
        width: U - 8,
        height: U * 1.35,
        borderRadius: "6px 6px 8px 8px",
        border: "1px solid #4a3a1c",
        background: "#0b0906",
        boxShadow: "inset 0 0 8px rgba(0,0,0,0.7)",
        padding: 3,
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: "4px 4px 6px 6px", background: fill, boxShadow: `inset 0 2px 3px rgba(255,255,255,0.18)` }} />
    </div>
  );
}

function Currency({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#b7ac8e", fontSize: 12, letterSpacing: 0.5 }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #f0d789, #9c7a2e)", boxShadow: "0 0 4px rgba(200,164,77,0.5)" }} />
      <span>{label}</span>
      <b style={{ color: PARCHMENT }}>{value}</b>
    </span>
  );
}

function SectionRule({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 8px" }}>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #3b2f18 40%, #3b2f18 60%, transparent)" }} />
      {children && <span style={{ color: GOLD_DIM, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>{children}</span>}
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #3b2f18 40%, #3b2f18 60%, transparent)" }} />
    </div>
  );
}

export function InventoryPanel({ inventory, onClose }: { inventory: Inventory; onClose: () => void }) {
  const { cols, rows, items } = inventory;
  const [hover, setHover] = React.useState<{ i: number; x: number; y: number } | null>(null);
  const equipW = 10 * U; // paper-doll spans 10 units wide
  const equipH = 6 * U;
  const gridW = cols * CELL;
  const contentW = Math.max(equipW, gridW);

  return (
    <div
      data-testid="inventory-panel"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.55), rgba(0,0,0,0.8))",
        pointerEvents: "auto",
        fontFamily: SERIF,
        color: PARCHMENT,
      }}
    >
      <div
        style={{
          maxHeight: "96vh",
          overflowY: "auto",
          background: "linear-gradient(180deg,#12100b 0%,#0b0a07 100%)",
          border: `1px solid ${GOLD_DIM}`,
          boxShadow: `0 0 0 1px #000, 0 0 0 4px #1b1710, 0 0 0 5px ${GOLD_DIM}, 0 14px 48px rgba(0,0,0,0.85)`,
        }}
      >
        {/* Carved title banner */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            padding: "12px 0",
            textAlign: "center",
            background: "linear-gradient(180deg,#4a1a13,#6b2018 45%,#3a1310)",
            borderBottom: `1px solid ${GOLD_DIM}`,
            boxShadow: `inset 0 1px 0 ${GOLD}55, inset 0 -1px 0 #000`,
          }}
        >
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: PARCHMENT, textShadow: "0 1px 2px #000" }}>
            Inventory
          </span>
          <button
            data-testid="inventory-close"
            onClick={onClose}
            style={{ position: "absolute", top: 8, right: 12, background: "none", border: "none", color: "#c9b48a", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 20, width: contentW, boxSizing: "content-box" }}>
          {/* Equipment paper-doll */}
          <div style={{ position: "relative", width: equipW, height: equipH, margin: "0 auto" }}>
            <EquipSlot x={0} y={0} w={2} h={4} label="Weapon" />
            <EquipSlot x={8} y={0} w={2} h={4} label="Weapon" />
            <EquipSlot x={4} y={0} w={2} h={2} label="Helmet" />
            <EquipSlot x={7} y={0} w={1} h={1} label="Amulet" />
            <EquipSlot x={4} y={2} w={2} h={3} label="Body" />
            <EquipSlot x={2} y={3} w={2} h={2} label="Gloves" />
            <EquipSlot x={6} y={3} w={2} h={2} label="Boots" />
            <EquipSlot x={3} y={5} w={1} h={1} label="Ring" />
            <EquipSlot x={4} y={5} w={2} h={1} label="Belt" />
            <EquipSlot x={6} y={5} w={1} h={1} label="Ring" />
          </div>

          {/* Flasks + currency */}
          <SectionRule>Flasks</SectionRule>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <Flask kind="life" />
              <Flask kind="life" />
              <Flask kind="mana" />
              <Flask kind="mana" />
              <Flask kind="charm" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              <Currency label="Gold" value={0} />
              <Currency label="Shards" value={0} />
            </div>
          </div>

          {/* Backpack grid (functional) */}
          <SectionRule>Backpack</SectionRule>
          <div
            style={{
              position: "relative",
              width: gridW,
              height: rows * CELL,
              margin: "0 auto",
              background: "#0a0b0e",
              border: `1px solid ${GOLD_DIM}`,
              boxShadow: "inset 0 0 14px rgba(0,0,0,0.8)",
            }}
          >
            {Array.from({ length: rows }).map((_, y) =>
              Array.from({ length: cols }).map((__, x) => (
                <div
                  key={`${x}-${y}`}
                  data-testid={`inventory-cell-${x}-${y}`}
                  style={{ position: "absolute", left: x * CELL, top: y * CELL, width: CELL, height: CELL, border: "1px solid #2c2415", boxShadow: "inset 0 0 4px rgba(0,0,0,0.5)" }}
                />
              )),
            )}
            {items.map((it, i) => (
              <div
                key={i}
                data-testid={`inventory-item-${i}`}
                onMouseEnter={(e) => setHover({ i, x: e.clientX + 18, y: e.clientY + 18 })}
                onMouseMove={(e) => setHover({ i, x: e.clientX + 18, y: e.clientY + 18 })}
                onMouseLeave={() => setHover((h) => (h?.i === i ? null : h))}
                style={{
                  position: "absolute",
                  left: it.x * CELL + 2,
                  top: it.y * CELL + 2,
                  width: it.w * CELL - 4,
                  height: it.h * CELL - 4,
                  border: `2px solid ${RARITY_BORDER[it.rarity]}`,
                  background: "linear-gradient(180deg, rgba(20,26,42,0.9), rgba(8,10,18,0.9))",
                  color: RARITY_TEXT[it.rarity],
                  fontFamily: SERIF,
                  fontSize: 10,
                  letterSpacing: 0.3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: 2,
                  boxSizing: "border-box",
                  boxShadow: `inset 0 0 8px ${RARITY_BORDER[it.rarity]}44`,
                }}
              >
                {it.name}
              </div>
            ))}
          </div>
        </div>
      </div>
      {hover && items[hover.i] && (
        <ItemTooltip
          name={items[hover.i]!.name}
          baseName={items[hover.i]!.baseName}
          rarity={items[hover.i]!.rarity}
          itemClass={items[hover.i]!.itemClass}
          statLines={items[hover.i]!.statLines}
          reqLevel={items[hover.i]!.reqLevel}
          reqAttrValue={items[hover.i]!.reqAttrValue}
          reqAttr={items[hover.i]!.reqAttr}
          lines={items[hover.i]!.lines}
          x={hover.x}
          y={hover.y}
        />
      )}
    </div>
  );
}
