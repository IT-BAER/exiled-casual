import React from "react";
import type { DisplayItem, EquipSlotId, Intent, Snapshot } from "@exiled/protocol";
import { canEquip } from "@exiled/simulation";
import { ItemTooltip } from "./ItemTooltip";

type Inventory = Snapshot["inventory"];
type Equipment = Snapshot["equipment"];

/** Where a drag started, which decides the intent it turns into on release. */
type DragSource = { kind: "grid"; x: number; y: number } | { kind: "slot"; slot: EquipSlotId };

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

// Keyed by every Rarity; a missing key would render `border: 2px solid undefined`.
const RARITY_BORDER: Record<string, string> = { normal: "#6b6b6b", magic: "#5566b0", rare: "#a3812f", unique: "#7f4a20" };
const RARITY_TEXT: Record<string, string> = { normal: "#c8c8c8", magic: MAGIC, rare: "#e6d64a", unique: "#af6025" };

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

/**
 * One paper-doll slot. `highlight` is driven by the in-flight drag: legal targets
 * glow gold, illegal ones fade back, so the eye lands on the right slot without
 * reading labels (poe2-screenshots/inventory+equipment.png).
 */
function EquipSlot({
  slot, x, y, w, h, label, item, highlight, onGrab,
}: {
  slot: EquipSlotId; x: number; y: number; w: number; h: number; label: string;
  item?: DisplayItem; highlight: "legal" | "illegal" | "none";
  onGrab: (slot: EquipSlotId, e: React.PointerEvent) => void;
}) {
  const border = highlight === "legal" ? GOLD : item ? RARITY_BORDER[item.rarity]! : "#3b2f18";
  return (
    <div
      data-testid={`equip-slot-${slot}`}
      data-drop-slot={slot}
      onPointerDown={item ? (e) => onGrab(slot, e) : undefined}
      style={{
        ...slotStyle(),
        left: x * U, top: y * U, width: w * U - 4, height: h * U - 4, margin: 2,
        border: `${highlight === "legal" ? 2 : 1}px solid ${border}`,
        boxShadow: highlight === "legal"
          ? `inset 0 0 10px rgba(0,0,0,0.75), 0 0 10px ${GOLD}88`
          : "inset 0 0 10px rgba(0,0,0,0.75), inset 0 1px 0 rgba(200,164,77,0.08)",
        opacity: highlight === "illegal" ? 0.35 : 1,
        cursor: item ? "grab" : "default",
      }}
    >
      {item?.icon ? (
        <img src={item.icon} alt={item.name} draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", pointerEvents: "none" }} />
      ) : (
        item?.name ?? label
      )}
    </div>
  );
}

// Paper-doll layout in equipment units, matching poe2-screenshots/inventory+equipment.png.
const PAPER_DOLL: { slot: EquipSlotId; x: number; y: number; w: number; h: number; label: string }[] = [
  { slot: "weapon1", x: 0, y: 0, w: 2, h: 4, label: "Weapon" },
  { slot: "weapon2", x: 8, y: 0, w: 2, h: 4, label: "Weapon" },
  { slot: "helmet", x: 4, y: 0, w: 2, h: 2, label: "Helmet" },
  { slot: "amulet", x: 7, y: 0, w: 1, h: 1, label: "Amulet" },
  { slot: "body", x: 4, y: 2, w: 2, h: 3, label: "Body" },
  { slot: "gloves", x: 2, y: 3, w: 2, h: 2, label: "Gloves" },
  { slot: "boots", x: 6, y: 3, w: 2, h: 2, label: "Boots" },
  { slot: "ring1", x: 3, y: 5, w: 1, h: 1, label: "Ring" },
  { slot: "belt", x: 4, y: 5, w: 2, h: 1, label: "Belt" },
  { slot: "ring2", x: 6, y: 5, w: 1, h: 1, label: "Ring" },
];

// Life or mana flask, in its socket with the hotkey underneath. Same two flasks the
// HUD shows (life on Q, mana on E); charges aren't simulated, so these are static.
function Flask({ kind, hotkey }: { kind: "life" | "mana"; hotkey: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <div
        style={{
          width: U - 4,
          height: U * 1.35,
          borderRadius: "6px 6px 8px 8px",
          border: "1px solid #4a3a1c",
          background: "#0b0906",
          boxShadow: "inset 0 0 8px rgba(0,0,0,0.7)",
          padding: 3,
          boxSizing: "border-box",
        }}
      >
        <img
          src={`/textures/ui/flask_${kind}.png`}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.8))" }}
        />
      </div>
      <span style={{ color: GOLD_DIM, fontSize: 10, letterSpacing: 1 }}>{hotkey}</span>
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

export function InventoryPanel({
  inventory, equipment = {}, onClose, onIntent,
}: {
  inventory: Inventory; equipment?: Equipment; onClose: () => void; onIntent?: (intent: Intent) => void;
}) {
  const { cols, rows, items } = inventory;
  const [hover, setHover] = React.useState<{ i: number; x: number; y: number } | null>(null);
  const [drag, setDrag] = React.useState<{ from: DragSource; item: DisplayItem; x: number; y: number } | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  // Pointer events, not HTML5 drag-and-drop: the release target can be the Babylon
  // canvas behind the panel (drop to ground), which native DnD does not reach.
  React.useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      setDrag(null);
      // e.target is the topmost element under the pointer (nothing captures it, and
      // the drag ghost is pointer-transparent); elementFromPoint covers synthetic events.
      const target = e.target instanceof Element ? e.target : document.elementFromPoint(e.clientX, e.clientY);
      const slot = target?.closest<HTMLElement>("[data-drop-slot]")?.dataset["dropSlot"] as EquipSlotId | undefined;
      const onGrid = !!target?.closest("[data-drop-grid]");
      const insidePanel = !!boxRef.current && !!target && boxRef.current.contains(target);
      if (slot) {
        if (drag.from.kind === "grid" && canEquip(drag.item.itemClass ?? "", slot)) {
          onIntent?.({ kind: "equipItem", x: drag.from.x, y: drag.from.y, slot });
        }
        return;
      }
      if (onGrid) {
        if (drag.from.kind === "slot") onIntent?.({ kind: "unequipItem", slot: drag.from.slot });
        return;
      }
      // Released over the world behind the panel: the item goes back on the floor.
      if (!insidePanel && drag.from.kind === "grid") {
        onIntent?.({ kind: "dropItem", x: drag.from.x, y: drag.from.y });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onIntent]);

  const grab = (from: DragSource, item: DisplayItem, e: React.PointerEvent) => {
    e.preventDefault();
    setHover(null);
    setDrag({ from, item, x: e.clientX, y: e.clientY });
  };
  const slotHighlight = (slot: EquipSlotId): "legal" | "illegal" | "none" => {
    if (!drag || drag.from.kind === "slot") return "none";
    return canEquip(drag.item.itemClass ?? "", slot) ? "legal" : "illegal";
  };

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
        ref={boxRef}
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
            {PAPER_DOLL.map((s) => (
              <EquipSlot
                key={s.slot}
                {...s}
                item={equipment[s.slot]}
                highlight={slotHighlight(s.slot)}
                onGrab={(slot, e) => grab({ kind: "slot", slot }, equipment[slot]!, e)}
              />
            ))}
          </div>

          {/* Flasks + currency */}
          <SectionRule>Flasks</SectionRule>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Flask kind="life" hotkey="Q" />
              <Flask kind="mana" hotkey="E" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              <Currency label="Gold" value={0} />
              <Currency label="Shards" value={0} />
            </div>
          </div>

          {/* Backpack grid (functional) */}
          <SectionRule>Backpack</SectionRule>
          <div
            data-drop-grid=""
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
                onMouseEnter={(e) => !drag && setHover({ i, x: e.clientX + 18, y: e.clientY + 18 })}
                onMouseMove={(e) => !drag && setHover({ i, x: e.clientX + 18, y: e.clientY + 18 })}
                onMouseLeave={() => setHover((h) => (h?.i === i ? null : h))}
                onPointerDown={(e) => grab({ kind: "grid", x: it.x, y: it.y }, it, e)}
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
                  cursor: "grab",
                  opacity: drag?.from.kind === "grid" && drag.from.x === it.x && drag.from.y === it.y ? 0.3 : 1,
                }}
              >
                {it.icon ? (
                  <img
                    src={it.icon}
                    alt={it.name}
                    draggable={false}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", pointerEvents: "none" }}
                  />
                ) : (
                  it.name
                )}
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
          flavour={items[hover.i]!.flavour}
          x={hover.x}
          y={hover.y}
        />
      )}
      {drag && (
        <div
          data-testid="drag-ghost"
          style={{
            position: "fixed",
            left: drag.x - CELL / 2,
            top: drag.y - CELL / 2,
            width: CELL * 1.5,
            height: CELL * 1.5,
            pointerEvents: "none",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: RARITY_TEXT[drag.item.rarity],
            fontSize: 10,
            textShadow: "0 1px 2px #000",
            filter: `drop-shadow(0 0 6px ${RARITY_BORDER[drag.item.rarity]})`,
          }}
        >
          {drag.item.icon
            ? <img src={drag.item.icon} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            : drag.item.name}
        </div>
      )}
    </div>
  );
}
