import React from "react";
import type { ContainerId, DisplayItem, EquipSlotId, Intent, Snapshot } from "@exiled/protocol";
import { canEquip } from "@exiled/simulation";
import { currencyAccepts, currencyResultRarity } from "@exiled/rules";
import { ItemTooltip } from "./ItemTooltip";
import { playDropSound } from "../audio/drop-sound";
import { BAR_H } from "./Hud";
import { CELL, CELL_VW, PANEL_PAD, PANEL_W } from "./layout";

type Inventory = Snapshot["inventory"];
type Equipment = Snapshot["equipment"];
/** An inventory entry: the display item plus where and how big it sits in the grid. */
type GridItem = Inventory["items"][number];

/**
 * Would spending `currency` on `it` do anything? Legality is the sim's call; this is
 * the cursor's guess at it, off the same table, so an illegal target reads as illegal
 * before the click rather than after a silent refusal.
 */
function accepts(currency: GridItem, it: GridItem): boolean {
  if (it.itemClass === "currency" || (it.x === currency.x && it.y === currency.y)) return false;
  return currencyAccepts(currency.baseId ?? "", it.rarity, it.unidentified === true, it.lines.length);
}

/** Where a drag started, which decides the intent it turns into on release. */
type DragSource = { kind: "grid"; container: ContainerId; x: number; y: number } | { kind: "slot"; slot: EquipSlotId };

// PoE2 inventory+equipment screen. The 12x5 backpack grid is functional (fed by
// snapshot.inventory, the real drop->pickup path). The equipment paper-doll,
// flask row and currency strip are styled placeholders: equipping, flasks and
// currency are not in the sim yet, so those slots are honestly empty.
// Matches poe2-screenshots/inventory+equipment.png.
// Exported so the character sheet dresses in the same carved gold as this panel
// rather than keeping a second copy of the palette that can drift from it.
export const SERIF = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
export const GOLD = "#c8a44d";
export const GOLD_DIM = "#7a5c22";
export const PARCHMENT = "#e8dcc0";
const MAGIC = "#8aa6ff";

const U_VW = +(CELL_VW * (54 / 48)).toFixed(3); // 2.363
const U = `${U_VW}vw`; // equipment paper-doll unit, kept in step with CELL

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
  slot, x, y, w, h, label, item, highlight, onGrab, onHover, onLeave,
}: {
  slot: EquipSlotId; x: number; y: number; w: number; h: number; label: string;
  item?: DisplayItem; highlight: "legal" | "illegal" | "none";
  onGrab: (slot: EquipSlotId, e: React.PointerEvent) => void;
  onHover: (item: DisplayItem, e: React.MouseEvent) => void;
  onLeave: (item: DisplayItem) => void;
}) {
  const border = highlight === "legal" ? GOLD : item ? RARITY_BORDER[item.rarity]! : "#3b2f18";
  return (
    <div
      data-testid={`equip-slot-${slot}`}
      data-drop-slot={slot}
      onPointerDown={item ? (e) => onGrab(slot, e) : undefined}
      onMouseEnter={item ? (e) => onHover(item, e) : undefined}
      onMouseMove={item ? (e) => onHover(item, e) : undefined}
      onMouseLeave={item ? () => onLeave(item) : undefined}
      style={{
        ...slotStyle(),
        left: `calc(${x} * ${U})`, top: `calc(${y} * ${U})`, width: `calc(${w} * ${U} - 4px)`, height: `calc(${h} * ${U} - 4px)`, margin: 2,
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
          width: `calc(${U} - 4px)`,
          height: `calc(${U} * 1.35)`,
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
  inventory, stash, equipment = {}, onClose, onCloseStash, onIntent,
}: {
  inventory: Inventory; stash?: Inventory; equipment?: Equipment;
  onClose: () => void; onCloseStash?: () => void; onIntent?: (intent: Intent) => void;
}) {
  const { cols, rows } = inventory;
  // Both grids are owned by this one component so a single drag can cross between
  // them: the drop target is resolved against whichever grid the cursor is over,
  // never against a remembered one.
  const grids: Partial<Record<ContainerId, Inventory>> = { backpack: inventory, ...(stash ? { stash } : {}) };
  // Keyed by the item, not a grid index, so equipped slots and backpack cells
  // share one hover path; an index could only ever address the backpack.
  const [hover, setHover] = React.useState<{ item: DisplayItem; x: number; y: number } | null>(null);
  // `w`/`h` are the held piece's footprint in cells, carried on the drag because
  // DisplayItem itself has no size: only the backpack entry that wraps it does.
  const [drag, setDrag] = React.useState<{ from: DragSource; item: DisplayItem; w: number; h: number; x: number; y: number } | null>(null);
  // PoE's currency flow: right-click a currency to take it onto the cursor, then
  // left-click the item to spend it on. Holds the currency itself rather than a flag,
  // because which orb is on the cursor decides what every other cell will accept.
  const [armed, setArmed] = React.useState<GridItem | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const gridRefs = React.useRef<Partial<Record<ContainerId, HTMLDivElement | null>>>({});

  // Does a w x h piece fit with its top-left at (x, y)? Mirrors the sim's canPlaceAt,
  // including ignoring the dragged item's own footprint, so the highlight cannot
  // promise a placement the sim then refuses. The sim stays the authority.
  const fitsAt = (g: Inventory, self: DisplayItem, w: number, h: number, x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x + w <= g.cols && y + h <= g.rows &&
    !g.items.some((p) => p !== self && x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y);

  // The cell the held item would land on. PoE carries a piece by its centre rather
  // than by the corner you grabbed, so the target is the item's centre rounded to
  // the grid, not the cursor's own cell. Null while the cursor is off the grid.
  const dropTarget = React.useMemo(() => {
    if (!drag || drag.from.kind !== "grid") return null;
    for (const [id, g] of Object.entries(grids) as [ContainerId, Inventory][]) {
      const r = gridRefs.current[id]?.getBoundingClientRect();
      if (!r) continue;
      if (drag.x < r.left || drag.x >= r.right || drag.y < r.top || drag.y >= r.bottom) continue;
      // Each grid measures its OWN width: the two have different column counts, so
      // one shared cell size would land the drop a cell out in the other grid.
      const c = r.width / g.cols;
      const x = Math.round((drag.x - r.left - (drag.w * c) / 2) / c);
      const y = Math.round((drag.y - r.top - (drag.h * c) / 2) / c);
      return { container: id, x, y, ok: fitsAt(g, drag.item, drag.w, drag.h, x, y) };
    }
    return null;
  }, [drag]);

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
        if (drag.from.kind === "grid" && drag.from.container === "backpack" && canEquip(drag.item.itemClass ?? "", slot)) {
          onIntent?.({ kind: "equipItem", x: drag.from.x, y: drag.from.y, slot });
        }
        return;
      }
      if (onGrid) {
        // Unequipping always lands in the backpack — the sim has no stash path for it.
        if (drag.from.kind === "slot") onIntent?.({ kind: "unequipItem", slot: drag.from.slot });
        else if (dropTarget?.ok && (dropTarget.container !== drag.from.container || dropTarget.x !== drag.from.x || dropTarget.y !== drag.from.y)) {
          // The container fields are omitted for a plain backpack move, so the
          // intent stays exactly the shape it had before the stash existed.
          onIntent?.({
            kind: "moveItem", x: drag.from.x, y: drag.from.y, toX: dropTarget.x, toY: dropTarget.y,
            ...(drag.from.container === "stash" ? { from: "stash" as const } : {}),
            ...(dropTarget.container === "stash" ? { to: "stash" as const } : {}),
          });
        }
        return;
      }
      // Released over the world behind the panel: the item goes back on the floor.
      // Another open HUD panel is not the world — the character sheet overlaps
      // this one, and releasing on it must not silently throw the item away.
      const onOtherPanel = !!target?.closest("[data-hud-panel]");
      if (!insidePanel && !onOtherPanel && drag.from.kind === "grid" && drag.from.container === "backpack") {
        onIntent?.({ kind: "dropItem", x: drag.from.x, y: drag.from.y });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, dropTarget, onIntent]);

  const grab = (from: DragSource, item: DisplayItem, w: number, h: number, e: React.PointerEvent) => {
    e.preventDefault();
    setHover(null);
    setDrag({ from, item, w, h, x: e.clientX, y: e.clientY });
  };
  const slotHighlight = (slot: EquipSlotId): "legal" | "illegal" | "none" => {
    if (!drag || drag.from.kind === "slot") return "none";
    return canEquip(drag.item.itemClass ?? "", slot) ? "legal" : "illegal";
  };

  // PoE's shift-click: send the piece to the other container without a drag. The
  // destination cell is picked here rather than by a new intent, because the sim
  // stays the authority — it re-checks the placement and simply refuses a bad one.
  const quickTransfer = (container: ContainerId, it: GridItem) => {
    const to: ContainerId = container === "backpack" ? "stash" : "backpack";
    const dest = grids[to];
    if (!dest) return; // stash closed: nothing to send it to
    // Currency lands on the stack it merges with, so a shift-click does not
    // scatter seven scrolls across seven cells.
    const stack = it.itemClass === "currency" && it.baseId !== undefined
      ? dest.items.find((p) => p.itemClass === "currency" && p.baseId === it.baseId)
      : undefined;
    // Same first-fit scan the sim runs: rows, then columns, top-left wins.
    const fit = stack ?? (() => {
      for (let y = 0; y <= dest.rows - it.h; y++) {
        for (let x = 0; x <= dest.cols - it.w; x++) {
          if (fitsAt(dest, it, it.w, it.h, x, y)) return { x, y };
        }
      }
      return undefined;
    })();
    if (!fit) return; // no room over there; the item stays put
    onIntent?.({
      kind: "moveItem", x: it.x, y: it.y, toX: fit.x, toY: fit.y,
      ...(container === "stash" ? { from: "stash" as const } : { to: "stash" as const }),
    });
  };

  // One grid, rendered for either container. Both share the drag, the hover
  // tooltip and the armed-currency cursor, so an item behaves the same in the
  // stash as in the bag rather than through a second copy of this markup.
  const renderGrid = (container: ContainerId) => {
    const g = grids[container]!;
    return (
          <div
            data-drop-grid={container}
            ref={(el) => { gridRefs.current[container] = el; }}
            style={{
              position: "relative",
              width: `calc(${g.cols} * ${CELL})`,
              height: `calc(${g.rows} * ${CELL})`,
              margin: "0 auto",
              // A column flex would squeeze both of these on a short window, and the
              // drag math divides this box's measured width by the column count, so a
              // squeezed grid would place items in the wrong cell. Never shrink.
              flexShrink: 0,
              background: "#0a0b0e",
              border: `1px solid ${GOLD_DIM}`,
              boxShadow: "inset 0 0 14px rgba(0,0,0,0.8)",
            }}
          >
            {Array.from({ length: g.rows }).map((_, y) =>
              Array.from({ length: g.cols }).map((__, x) => (
                <div
                  key={`${x}-${y}`}
                  data-testid={`${container === "stash" ? "stash" : "inventory"}-cell-${x}-${y}`}
                  style={{ position: "absolute", left: `calc(${x} * ${CELL})`, top: `calc(${y} * ${CELL})`, width: CELL, height: CELL, border: "1px solid #2c2415", boxShadow: "inset 0 0 4px rgba(0,0,0,0.5)" }}
                />
              )),
            )}
            {/* Where the held item would land: the whole footprint lit, not one cell,
                because a 1x3 staff has to show all three. Green fits, red does not. */}
            {dropTarget?.container === container && (
              <div
                data-testid="drop-highlight"
                style={{
                  position: "absolute",
                  left: `calc(${dropTarget.x} * ${CELL})`,
                  top: `calc(${dropTarget.y} * ${CELL})`,
                  width: `calc(${drag?.w ?? 1} * ${CELL})`,
                  height: `calc(${drag?.h ?? 1} * ${CELL})`,
                  background: dropTarget.ok ? "rgba(96,200,120,0.22)" : "rgba(200,70,60,0.22)",
                  border: `1px solid ${dropTarget.ok ? "#6fd48a" : "#d05a4e"}`,
                  boxShadow: `inset 0 0 12px ${dropTarget.ok ? "#6fd48a55" : "#d05a4e55"}`,
                  pointerEvents: "none",
                }}
              />
            )}
            {g.items.map((it, i) => (
              <div
                key={i}
                data-testid={`${container === "stash" ? "stash" : "inventory"}-item-${i}`}
                onMouseEnter={(e) => !drag && setHover({ item: it, x: e.clientX + 18, y: e.clientY + 18 })}
                onMouseMove={(e) => !drag && setHover({ item: it, x: e.clientX + 18, y: e.clientY + 18 })}
                onMouseLeave={() => setHover((h) => (h?.item === it ? null : h))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Right-clicking the armed currency again, or anything that is not
                  // currency at all, puts what is on the cursor back in the bag.
                  setArmed((a) => (container === "backpack" && it.itemClass === "currency" && a?.x !== it.x ? it : null));
                }}
                onPointerDown={(e) => {
                  if (e.shiftKey) {
                    e.preventDefault();
                    setHover(null);
                    quickTransfer(container, it);
                    return;
                  }
                  if (armed && container === "backpack" && accepts(armed, it)) {
                    e.preventDefault();
                    setHover(null);
                    setArmed(null);
                    // The outcome is the payoff, so it gets the drop chime at the rarity
                    // the application lands on, which is audible before the new lines are
                    // legible (docs/09 rule 2).
                    playDropSound(currencyResultRarity(armed.baseId ?? "") ?? it.rarity);
                    onIntent?.({ kind: "applyCurrency", fromX: armed.x, fromY: armed.y, x: it.x, y: it.y });
                    return;
                  }
                  grab({ kind: "grid", container, x: it.x, y: it.y }, it, it.w, it.h, e);
                }}
                style={{
                  position: "absolute",
                  left: `calc(${it.x} * ${CELL} + 2px)`,
                  top: `calc(${it.y} * ${CELL} + 2px)`,
                  width: `calc(${it.w} * ${CELL} - 4px)`,
                  height: `calc(${it.h} * ${CELL} - 4px)`,
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
                  cursor: armed ? (accepts(armed, it) ? "crosshair" : "not-allowed") : "grab",
                  opacity: drag?.from.kind === "grid" && drag.from.container === container && drag.from.x === it.x && drag.from.y === it.y ? 0.3 : 1,
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
                {/* Stack size in the bottom-right of the cell, where PoE puts it. */}
                {it.count !== undefined && it.count > 1 && (
                  <span
                    data-testid={`${container === "stash" ? "stash" : "inventory"}-count-${i}`}
                    style={{ position: "absolute", right: 2, bottom: 1, fontSize: 11, color: "#e8dfc4", textShadow: "0 1px 2px #000", pointerEvents: "none" }}
                  >
                    {it.count}
                  </span>
                )}
                {/* An unread item wears a question mark, so the backpack shows what is
                    still owed without a hover (docs/09 rule 2: unseen is unfelt). */}
                {it.unidentified && (
                  <span
                    data-testid={`${container === "stash" ? "stash" : "inventory"}-unread-${i}`}
                    style={{ position: "absolute", left: 3, top: 1, fontSize: 12, fontWeight: 700, color: "#d02020", textShadow: "0 1px 2px #000", pointerEvents: "none" }}
                  >
                    ?
                  </span>
                )}
              </div>
            ))}
          </div>
    );
  };

  const equipW = `calc(10 * ${U})`; // paper-doll spans 10 units wide
  const equipH = `calc(6 * ${U})`;
  // The grid is the wider of the two, so it is what sets the content width.
  const contentW = `${Math.max(10 * U_VW, cols * CELL_VW).toFixed(2)}vw`;

  return (
    <div
      data-testid="inventory-panel"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        // Docked to the bottom-right corner, the way inventory+equipment.png has it:
        // the panel is a column against the screen edge, not a dialog floating in the
        // middle, and its bottom-right corner runs behind the mana globe.
        alignItems: "flex-end",
        justifyContent: "flex-end",
        // No dimming backdrop and no pointer capture: PoE leaves the world lit and
        // playable with the inventory open. The box below takes its own events back.
        pointerEvents: "none",
        // Under the globes (zIndex 3) so the mana orb paints over the panel's corner,
        // which is what makes it read as tucked behind rather than parked next to it.
        zIndex: 2,
        fontFamily: SERIF,
        color: PARCHMENT,
      }}
    >
      {/* Stash box, docked bottom-left. PoE opens the stash beside the inventory
          rather than instead of it, so both grids are reachable in one drag. */}
      {stash && (
        <div
          data-testid="stash-panel"
          data-hud-panel=""
          style={{
            pointerEvents: "auto",
            marginRight: "auto",
            // Off the screen edge, or the panel's outer gilt line is clipped away.
            marginLeft: 12,
            marginBottom: BAR_H,
            padding: PANEL_PAD,
            background: "linear-gradient(180deg,#12100b 0%,#0b0a07 100%)",
            border: `1px solid ${GOLD_DIM}`,
            boxShadow: `0 0 0 1px #000, 0 0 0 4px #1b1710, 0 0 0 5px ${GOLD_DIM}, 0 14px 48px rgba(0,0,0,0.85)`,
          }}
        >
          <div
            style={{
              margin: `calc(-1 * ${PANEL_PAD}) calc(-1 * ${PANEL_PAD}) 10px`,
              padding: "10px 0",
              textAlign: "center",
              position: "relative",
              background: "linear-gradient(180deg,#4a1a13,#6b2018 45%,#3a1310)",
              borderBottom: `1px solid ${GOLD_DIM}`,
              boxShadow: `inset 0 1px 0 ${GOLD}55, inset 0 -1px 0 #000`,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: PARCHMENT, textShadow: "0 1px 2px #000" }}>
              Stash
            </span>
            <button
              data-testid="stash-close"
              onClick={onCloseStash}
              style={{ position: "absolute", top: 6, right: 10, background: "none", border: "none", color: "#c9b48a", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          {renderGrid("stash")}
        </div>
      )}
      <div
        ref={boxRef}
        style={{
          pointerEvents: "auto",
          // Stops where the bottom bar starts, whatever height that bar is.
          marginBottom: BAR_H,
          // Full height, not content height: PoE's inventory runs from the top of
          // the screen down to the bar and simply ends in empty panel below the
          // last grid row. A box that shrinks to its contents floats and reads wrong.
          height: `calc(100vh - ${BAR_H})`,
          width: PANEL_W,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          // The wheel still scrolls; PoE has no scrollbar chrome and a pale native
          // one down the panel's gilt edge reads as a browser, not as the game.
          scrollbarWidth: "none",
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

        <div style={{ padding: PANEL_PAD, width: contentW, boxSizing: "content-box", flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Equipment paper-doll */}
          <div style={{ position: "relative", width: equipW, height: equipH, margin: "0 auto", flexShrink: 0 }}>
            {PAPER_DOLL.map((s) => (
              <EquipSlot
                key={s.slot}
                {...s}
                item={equipment[s.slot]}
                highlight={slotHighlight(s.slot)}
                onGrab={(slot, e) => grab({ kind: "slot", slot }, equipment[slot]!, 1.5, 1.5, e)}
                onHover={(item, e) => !drag && setHover({ item, x: e.clientX + 18, y: e.clientY + 18 })}
                onLeave={(item) => setHover((h) => (h?.item === item ? null : h))}
              />
            ))}
          </div>

          {/* Flasks + currency */}
          <SectionRule>Flasks</SectionRule>
          {/* Flasks sit in their own centred strip between the paper-doll and the
              backpack, the way inventory.png has them. The currency moved out to
              the strip at the foot of the panel. */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Flask kind="life" hotkey="Q" />
            <Flask kind="mana" hotkey="E" />
          </div>

          {/* Backpack grid (functional) */}
          <SectionRule>Backpack</SectionRule>
          {renderGrid("backpack")}

          {/* Currency strip. PoE's inventory does not end at the last grid row: a
              band of currency and charm sockets runs under it, which is what keeps
              a 12x5 backpack from leaving dead panel below itself on a tall screen.
              `marginTop: auto` pins it to the foot, so the slack lands between the
              grid and the strip instead of below everything. */}
          <div
            data-testid="currency-strip"
            style={{
              marginTop: "auto",
              display: "flex",
              gap: 26,
              alignItems: "center",
              padding: "12px 16px",
              background: "linear-gradient(180deg,#16130c,#0b0906)",
              border: `1px solid ${GOLD_DIM}`,
              boxShadow: "inset 0 0 16px rgba(0,0,0,0.85)",
            }}
          >
            <Currency label="Gold" value={0} />
            <Currency label="Shards" value={0} />
          </div>
        </div>
      </div>
      {hover && <ItemTooltip {...hover.item} x={hover.x} y={hover.y} />}
      {drag && (
        <div
          data-testid="drag-ghost"
          style={{
            position: "fixed",
            left: `calc(${drag.x}px - ${drag.w} * ${CELL} / 2)`,
            top: `calc(${drag.y}px - ${drag.h} * ${CELL} / 2)`,
            width: `calc(${drag.w} * ${CELL})`,
            height: `calc(${drag.h} * ${CELL})`,
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
