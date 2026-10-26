import React from "react";
import type { ContainerId, DisplayItem, EquipSlotId, Intent, Snapshot } from "@exiled/protocol";
import { SORT_MODES } from "@exiled/protocol";
import { canEquip, EQUIP_SLOTS_BY_CLASS } from "@exiled/simulation";
import { currencyAccepts, currencyResultRarity, SHARDS_PER_ORB } from "@exiled/rules";
import { ItemCompare, ItemTooltip } from "./ItemTooltip";
import { flaskTooltip } from "./flask-tooltip";
import { playDropSound } from "../audio/drop-sound";
import { playSfx } from "../audio/sfx";
import { VENDOR_NAME, VENDOR_TITLE } from "../npc";
import { keyCap } from "../settings";
import { Gem } from "../menu/OptionsPanel";
import { BAR_H, ORB_RISE } from "./Hud";
import { CELL, CELL_VW, PANEL_PAD, PANEL_W } from "./layout";

/**
 * The three shard piles the bench can pay into, in the order the rarities that
 * produce them climb. Names only: shards are a counter rather than an item, so
 * there is no icon to look up the way a backpack cell has one.
 */
const SHARD_ROWS: readonly { orbBaseId: string; label: string }[] = [
  { orbBaseId: "currency.transmutation", label: "Transmutation" },
  { orbBaseId: "currency.elevation", label: "Elevation" },
  { orbBaseId: "currency.embers", label: "Ember" },
];

type Inventory = Snapshot["inventory"];
type Equipment = Snapshot["equipment"];
/** An inventory entry: the display item plus where and how big it sits in the grid. */
type GridItem = Inventory["items"][number];
/** A shelf entry is a grid entry that also knows its price. */
type ShelfItem = NonNullable<Snapshot["buyback"]>["items"][number];

/** What the window shows before a snapshot has a shelf in it: the frame, no goods. */
const EMPTY_SHELF: Snapshot["vendor"] = { cols: 12, rows: 8, items: [] };

/** The testid prefix a container's cells and items carry. */
const TID: Record<ContainerId, string> = { backpack: "inventory", stash: "stash", vendor: "vendor", buyback: "buyback" };

/** The vendor's two pages: both are bought from by a click, neither is ever dragged into. */
const isShop = (c: ContainerId): boolean => c === "vendor" || c === "buyback";

/**
 * Would spending `currency` on `it` do anything? Legality is the sim's call; this is
 * the cursor's guess at it, off the same table, so an illegal target reads as illegal
 * before the click rather than after a silent refusal.
 */
function accepts(currency: GridItem, it: GridItem): boolean {
  if (it.itemClass === "currency" || (it.x === currency.x && it.y === currency.y)) return false;
  return currencyAccepts(currency.baseId ?? "", it.rarity, it.unidentified === true, it.lines.length);
}

/**
 * Does a shelf piece answer to the keyword box? PoE matches the whole printed
 * item — its name, its base and its mod lines — rather than the name alone, which
 * is what makes "life" a usable search there.
 */
function matchesHighlight(it: GridItem, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (needle === "") return true;
  return [it.name, it.baseName, it.itemClass, ...it.lines, ...(it.statLines ?? []).map((l) => l.label)]
    .some((s) => s !== undefined && s.toLowerCase().includes(needle));
}

/** Where a drag started, which decides the intent it turns into on release. */
type DragSource = { kind: "grid"; container: ContainerId; x: number; y: number } | { kind: "slot"; slot: EquipSlotId };
type DropTarget = { container: ContainerId; x: number; y: number; ok: boolean };

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  return a === b || (!!a && !!b && a.container === b.container && a.x === b.x && a.y === b.y && a.ok === b.ok);
}
/** The carried piece hangs from its centre, `w` x `h` cells. */
const ghostLeft = (d: { w: number }, px: number): string => `calc(${px}px - ${d.w} * ${CELL} / 2)`;
const ghostTop = (d: { h: number }, py: number): string => `calc(${py}px - ${d.h} * ${CELL} / 2)`;

// PoE2 inventory+equipment screen. The 12x5 backpack grid is functional (fed by
// snapshot.inventory, the real drop->pickup path). The equipment paper-doll,
// flask row and currency strip are styled placeholders: equipping, flasks and
// currency are not in the sim yet, so those slots are honestly empty.
// Matches reference-screenshots/inventory+equipment.png.
// Exported so the character sheet dresses in the same carved gold as this panel
// rather than keeping a second copy of the palette that can drift from it.
/**
 * The reading face: everything that is a word rather than a title. A
 * capitals-only face set a sentence shouting; Marcellus has a lower case.
 */
export const SERIF = '"Marcellus", Georgia, "Times New Roman", serif';
/** The carved face, for titles, labels and anything already uppercase. */
export const DISPLAY = '"Marcellus SC", Georgia, "Times New Roman", serif';
export const GOLD = "#c8a44d";
export const GOLD_DIM = "#7a5c22";
export const PARCHMENT = "#e8dcc0";
const MAGIC = "#8aa6ff";
/**
 * Grid lattice, sampled off reference-screenshots/stash.png: a 1px warm brown line
 * over a cell floor that is nearly black. Reading it back off the reference,
 * the separation comes from the floor being black rather than from the line
 * being bright, which is why the tile under this is unlit almost everywhere.
 */
const LATTICE = "rgb(58,45,26)";

/**
 * The pane the stash and the inventory are both cut from. PoE1 opens them as a
 * matched pair: one width, one top line, one bottom line, mirrored against the
 * left and right screen edges. Anything either pane sets for itself here drifts
 * the moment the other changes, so they share the object.
 *
 * The frame rings are inset, not outset. Both panes sit flush against a screen
 * edge, and an outset ring on a flush edge is simply cropped off, which is what
 * made the stash read as sheared at the top.
 */
export const PANE: React.CSSProperties = {
  pointerEvents: "auto",
  width: PANEL_W,
  // Top of the screen down to the bar, ending in empty pane below the last row.
  height: `calc(100vh - ${BAR_H})`,
  marginBottom: BAR_H,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  // Carved stone inside a dark metal frame, not a flat gradient (stash.png).
  backgroundImage:
    "linear-gradient(180deg, rgba(8,7,5,0.55), rgba(8,7,5,0.78)), url(/textures/ui/char_stone_v1.webp)",
  backgroundSize: "auto, 256px 256px",
  border: `1px solid ${GOLD_DIM}`,
  boxShadow: "inset 0 0 0 4px #1b1710, inset 0 0 0 5px #000, 0 14px 48px rgba(0,0,0,0.85)",
};

/**
 * The gilt cartouche flanked by carved wings that PoE1 titles both panes with:
 * dark letters cut into the plaque and lit from below rather than printed in
 * cream, and the round stud of a close button in the corner. `bleed` is the
 * pane's own padding, which the band has to pull back over to reach the frame.
 */
export function PaneHeader({ title, bleed, onClose, testId }: {
  title: string; bleed?: string; onClose: () => void; testId: string;
}) {
  return (
    <div
      style={{
        // The band keeps char_header_v1.webp's 1024x160 or the relief shears.
        margin: bleed ? `calc(-1 * ${bleed}) calc(-1 * ${bleed}) 10px` : "0 0 10px",
        // 12.8% of the pane's width, measured off the reference's band.
        height: `calc(12 * ${CELL} * 0.128)`,
        flexShrink: 0,
        position: "sticky",
        // Sticky measures `top` from the scrollport's PADDING edge, so pinning at 0
        // parks the band `bleed` lower than the negative margin just put it and it
        // eats that much of the next child. Pin it where the flow already has it.
        top: bleed ? `calc(-1 * ${bleed})` : 0,
        zIndex: 2,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundImage: "url(/textures/ui/char_header_v1.webp)",
        backgroundSize: "100% 100%",
        borderBottom: "1px solid #000",
      }}
    >
      {/* Lit letters standing on the plaque, not cut into it. The engraved
          version (near-black on the gilt, with a pale rim under it) is a real
          PoE1 treatment, but it only survives at the size PoE1 draws it: at 17px
          over a band this busy the strokes went to mud. inventory+equipment.png
          has PoE2's cartouche lettering pale for the same reason, so brightening
          it is the reference reading too, not a departure from it. */}
      <span style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: 5, textTransform: "uppercase", color: "#f2dfae", textShadow: "0 1px 1px rgba(0,0,0,0.85), 0 0 6px rgba(0,0,0,0.6)" }}>
        {title}
      </span>
      <button
        data-testid={testId}
        onClick={onClose}
        style={{
          position: "absolute", top: 6, right: 8,
          width: 22, height: 22, borderRadius: "50%",
          background: "radial-gradient(circle at 35% 30%, #c74e35, #6d1d13 70%, #35100a)",
          border: "1px solid #1d0906", color: "#f7ddd0",
          boxShadow: "0 1px 4px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,180,150,0.4)",
          fontSize: 13, lineHeight: 1, padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

const U_VW = +(CELL_VW * (54 / 48)).toFixed(3); // 2.363
const U = `${U_VW}vw`; // equipment paper-doll unit, kept in step with CELL

/**
 * How far the pointer may travel between press and release and still count as a
 * click that PICKS THE PIECE UP rather than a drag that placed it. 6 px is the
 * slop a browser itself allows before a press becomes a drag; smaller and a
 * shaky hand loses the pickup, larger and a short deliberate drag is read as a
 * pickup and needs a second click nobody expects.
 */
const CARRY_SLOP = 6;

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
 * reading labels (reference-screenshots/inventory+equipment.png).
 */
function EquipSlot({
  slot, x, y, w, h, label, item, highlight, onGrab, onHover, onLeave,
}: {
  slot: EquipSlotId; x: number; y: number; w: number; h: number; label: string;
  item?: DisplayItem; highlight: "legal" | "illegal" | "none";
  onGrab: (slot: EquipSlotId, e: React.PointerEvent) => void;
  onHover: (item: DisplayItem, e: React.MouseEvent) => void;
  /** Takes no argument on purpose: see the cell's own onMouseLeave. */
  onLeave: () => void;
}) {
  const border = highlight === "legal" ? GOLD : item ? RARITY_BORDER[item.rarity]! : "#3b2f18";
  return (
    <div
      data-testid={`equip-slot-${slot}`}
      data-drop-slot={slot}
      onPointerDown={item ? (e) => onGrab(slot, e) : undefined}
      onMouseEnter={item ? (e) => onHover(item, e) : undefined}
      onMouseMove={item ? (e) => onHover(item, e) : undefined}
      onMouseLeave={item ? () => onLeave() : undefined}
      style={{
        ...slotStyle(),
        left: `calc(${x} * ${U})`, top: `calc(${y} * ${U})`, width: `calc(${w} * ${U} - 4px)`, height: `calc(${h} * ${U} - 4px)`, margin: 2,
        border: `${highlight === "legal" ? 2 : 1}px solid ${border}`,
        boxShadow: highlight === "legal"
          ? `inset 0 0 10px rgba(0,0,0,0.75), 0 0 10px ${GOLD}88`
          : "inset 0 0 10px rgba(0,0,0,0.75), inset 0 1px 0 rgba(200,164,77,0.08)",
        opacity: highlight === "illegal" ? 0.35 : 1,
        // One cell is ~26px at 1280 wide, and Marcellus capitals spell "AMULET"
        // wider than a cell at any readable size: every label is mixed case at that size.
        letterSpacing: 0, textTransform: "none", fontSize: `${U_VW * 0.24}vw`,
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

// Paper-doll layout in equipment units, matching reference-screenshots/inventory+equipment.png.
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
// HUD shows, on the keys it drinks them on; they cannot be moved or swapped.
function Flask({ kind, hotkey, charges }: { kind: "life" | "mana"; hotkey: string; charges?: { now: number; max: number } }) {
  const [tip, setTip] = React.useState<{ x: number; y: number } | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <div
        data-testid={`inventory-flask-${kind}-socket`}
        onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip(null)}
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
          src={`/textures/ui/flask_${kind}.webp`}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.8))" }}
        />
      </div>
      <span data-testid={`inventory-flask-${kind}`} style={{ color: GOLD_DIM, fontSize: 10, letterSpacing: 1 }}>{hotkey}</span>
      {tip && charges && <ItemTooltip {...flaskTooltip(kind, hotkey, charges.now, charges.max)} x={tip.x} y={tip.y} />}
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

const DEFAULT_FLASK_KEYS = { life: "1", mana: "2" };

// memo: GameView renders at 30 Hz while monsters move; this panel only when its own props change.
export const InventoryPanel = React.memo(function InventoryPanel({
  inventory, stash, vendor = EMPTY_SHELF, buyback = EMPTY_SHELF, gold = 0, equipment = {}, shards = {}, vendorOpen = false,
  socketWanted = false, socketedCell = null, compareKey = "ctrl", flaskKeys = DEFAULT_FLASK_KEYS, flasks, level,
  pet = false, onPetToggle,
  onClose, onCloseStash, onCloseVendor, onIntent, onRefused, onSocketWaystone,
}: {
  /** The Celestial Cat follows him; switched on the Cosmetics tab. */
  pet?: boolean;
  onPetToggle?: (on: boolean) => void;
  /** The modifier that, held over an item, shows what is worn in its slot beside it. */
  compareKey?: "ctrl" | "shift";
  /** The keys the HUD drinks each flask on, for the captions under them. */
  flaskKeys?: { life: string; mana: string };
  /** Live flask charges, read by their tooltips. */
  flasks?: Snapshot["player"]["flasks"];
  /** Character level: the sim refuses gear above it, so the slot does too. Absent = not checked. */
  level?: number;
  inventory: Inventory; stash?: Inventory; equipment?: Equipment;
  /** The vendor's shelf, priced per cell. Absent on a snapshot built without a session. */
  vendor?: Snapshot["vendor"];
  /** What was sold since his last restock, priced at what it fetched (PoE2's Buyback tab). */
  buyback?: Snapshot["buyback"];
  /** Gold on hand, which is what decides whether a shelf cell reads as affordable. */
  gold?: number;
  /** Loose shards banked at the bench, orb base id to count. Always known, so the
      backpack's Shards counter can read it whether or not the bench is open. */
  shards?: Record<string, number>;
  vendorOpen?: boolean;
  /** True while an Atlas node is selected and its socket is empty; enables ctrl+click socketing. */
  socketWanted?: boolean;
  /** Backpack cell of the stone seated in the map device: it stays there until the map opens. */
  socketedCell?: { x: number; y: number } | null;
  onClose: () => void; onCloseStash?: () => void; onCloseVendor?: () => void;
  onIntent?: (intent: Intent) => void;
  /** A transfer refused here, before any intent: the other container has no room. */
  onRefused?: () => void;
  /** Called when a waystone from the backpack is placed into the map-device socket. */
  onSocketWaystone?: (x: number, y: number) => void;
}) {
  const { cols, rows } = inventory;
  // Both grids are owned by this one component so a single drag can cross between
  // them: the drop target is resolved against whichever grid the cursor is over,
  // never against a remembered one.
  const grids: Partial<Record<ContainerId, Inventory>> = {
    backpack: inventory,
    ...(stash ? { stash } : {}),
    // Only while the shop is open: the shelf must not be a drag target sitting
    // invisibly under the cursor when the window is shut.
    ...(vendorOpen ? { vendor, buyback } : {}),
  };
  /** What the shop is charging for the piece in this cell, or 0 if it is not a shop cell. */
  const priceOf = (container: ContainerId, it: GridItem): number =>
    isShop(container) ? (it as ShelfItem).price : 0;
  /** A shop cell the click would be refused on: short of gold, or a sale whose orb is spent. */
  const barred = (container: ContainerId, it: GridItem): boolean =>
    isShop(container) && (priceOf(container, it) > gold || (it as ShelfItem).refused === true);
  /** The slot takes the piece and the character meets its level, the same two checks the sim makes. */
  const wearable = (it: DisplayItem, slot: EquipSlotId): boolean =>
    canEquip(it.itemClass ?? "", slot) && (level === undefined || (it.reqLevel ?? 1) <= level);
  // Which of the vendor's pages is showing. Every visit opens on his goods.
  const [vendorPage, setVendorPage] = React.useState<"vendor" | "buyback">("vendor");
  React.useEffect(() => { if (!vendorOpen) setVendorPage("vendor"); }, [vendorOpen]);
  // PoE2's two pages of the one pane: his gear, or what he looks like. Opens on his gear.
  const [page, setPage] = React.useState<"inventory" | "cosmetics">("inventory");

  // The sale itself is the soundscape's (gold in, piece out). The tenth shard
  // spends the pile on an orb, which drops the total and rings like a unique on top.
  // docs/09 rule 2 - a reward the player cannot hear did not happen.
  const shardTotal = Object.values(shards).reduce((a, b) => a + b, 0);
  const lastShardTotal = React.useRef<number | null>(null);
  React.useEffect(() => {
    const prev = lastShardTotal.current;
    lastShardTotal.current = shardTotal;
    if (prev !== null && shardTotal < prev) playDropSound("unique");
  }, [shardTotal]);
  // Keyed by WHERE the cursor is, not by the item that was under it: a cell and a
  // paper-doll slot both address one place, and the sim rebuilds every item object
  // 30 times a second. Holding the object froze the tooltip at the moment of the
  // hover, which is why spending an orb had to close it rather than show what the
  // orb had just written. Resolved against the current snapshot below.
  const [hover, setHover] = React.useState<
    { at: { grid: ContainerId; ix: number; iy: number } | { slot: EquipSlotId }; x: number; y: number } | null
  >(null);
  // A tooltip outlives the cell it came from: removing an element fires no
  // mouseleave, and the tooltip is painted by this component rather than by the
  // pane that closed, so walking away from the stash or the vendor left it hanging
  // over the world. Whenever a container comes or goes, the hover goes with it.
  const shelfOpen = vendorOpen;
  const stashShown = stash !== undefined;
  React.useEffect(() => { setHover(null); }, [shelfOpen, stashShown, vendorPage, page]);
  /** The item the cursor is over, as the CURRENT snapshot has it. Gone from its
   *  cell means gone from the screen, which is what a sold or consumed piece is. */
  const at = hover?.at;
  const hoverItem: DisplayItem | undefined = at === undefined
    ? undefined
    : "slot" in at
      ? equipment[at.slot]
      : grids[at.grid]?.items.find((i) => i.x === at.ix && i.y === at.iy);
  // PoE's compare: the key held over a loose item puts what is worn beside it.
  // Read off key events rather than the mouse's modifiers, so pressing the key
  // with the cursor already resting on the item shows it without a nudge.
  const compareName = compareKey === "shift" ? "Shift" : "Control";
  const [comparing, setComparing] = React.useState(false);
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === compareName) setComparing(true); };
    const up = (e: KeyboardEvent) => { if (e.key === compareName) setComparing(false); };
    // Alt-tab away with the key down never delivers its keyup here.
    const blur = () => setComparing(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [compareName]);
  const worn: DisplayItem[] = comparing && hoverItem && at !== undefined && !("slot" in at)
    ? (EQUIP_SLOTS_BY_CLASS[hoverItem.itemClass ?? ""] ?? []).flatMap((s) => equipment[s] ?? [])
    : [];
  // `w`/`h` are the held piece's footprint in cells, carried on the drag because
  // DisplayItem itself has no size: only the backpack entry that wraps it does.
  // `ox`/`oy` are where the press landed and `carried` says the piece is riding the
  // cursor with no button held, which is the difference between PoE's two gestures.
  const [drag, setDrag] = React.useState<
    { from: DragSource; item: DisplayItem; w: number; h: number; x: number; y: number; ox: number; oy: number; carried: boolean } | null
  >(null);
  // PoE's currency flow: right-click a currency to take it onto the cursor, then
  // left-click the item to spend it on. Holds the currency itself rather than a flag,
  // because which orb is on the cursor decides what every other cell will accept.
  const [armed, setArmed] = React.useState<GridItem | null>(null);
  // Where the armed orb's bare icon rides. Deliberately NOT the drag ghost: no
  // rarity border, no glow, smaller than a cell — using is not moving.
  // State only for its first appearance; after that the move handler drags the img
  // itself, because a panel render per pointer move is what halved the fps.
  const [armedPos, setArmedPos] = React.useState<{ x: number; y: number } | null>(null);
  const armedAt = React.useRef({ x: 0, y: 0 });
  const armedIconRef = React.useRef<HTMLImageElement | null>(null);
  /** The armed orb has been spent by a shift-click since it was armed. */
  const shiftSpent = React.useRef(false);
  React.useEffect(() => {
    if (!armed) { setArmedPos(null); return; }
    const onMove = (e: PointerEvent) => {
      armedAt.current = { x: e.clientX, y: e.clientY };
      const icon = armedIconRef.current;
      if (!icon) { setArmedPos(armedAt.current); return; }
      icon.style.left = `${e.clientX + 10}px`;
      icon.style.top = `${e.clientY + 10}px`;
    };
    // While armed, ANY right-click dismisses — and never reaches the browser's
    // own menu, which the panel's empty ground otherwise let through. Capture
    // phase, so the grid cells' own contextmenu handlers cannot re-arm first.
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setArmed(null);
    };
    // PoE: an orb kept on the cursor by shift-clicks goes back when Shift is let
    // go. A tap of Shift with nothing spent leaves the right-click arming alone.
    shiftSpent.current = false;
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift" && shiftSpent.current) setArmed(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("contextmenu", onCtx, true);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("contextmenu", onCtx, true);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [armed]);
  // A shift-held orb outlives its click, so the stack can run out under it: once
  // the cell no longer holds that currency, nothing is on the cursor any more.
  const armedGone = armed !== null &&
    !inventory.items.some((i) => i.x === armed.x && i.y === armed.y && i.baseId === armed.baseId);
  React.useEffect(() => { if (armedGone) setArmed(null); }, [armedGone]);
  /** The vendor window's keyword box. Local: it dims the shelf, nothing else. */
  const [highlight, setHighlight] = React.useState("");
  // Per grid: the SORT_MODES index its next Sort click will use.
  const [sortNext, setSortNext] = React.useState<Partial<Record<ContainerId, number>>>({});
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
  // Read from the pointer handlers, so the grids come through a ref, never a stale render.
  const gridsRef = React.useRef(grids);
  gridsRef.current = grids;
  const targetAt = (d: NonNullable<typeof drag>, px: number, py: number): DropTarget | null => {
    if (d.from.kind !== "grid") return null;
    for (const [id, g] of Object.entries(gridsRef.current) as [ContainerId, Inventory][]) {
      // The shelf is never a drop target. Goods leave it by being bought, and a
      // drop onto it would be a way to hand an item over without being paid.
      if (isShop(id)) continue;
      const r = gridRefs.current[id]?.getBoundingClientRect();
      if (!r) continue;
      if (px < r.left || px >= r.right || py < r.top || py >= r.bottom) continue;
      // Each grid measures its OWN width: the two have different column counts, so
      // one shared cell size would land the drop a cell out in the other grid.
      const c = r.width / g.cols;
      const x = Math.round((px - r.left - (d.w * c) / 2) / c);
      const y = Math.round((py - r.top - (d.h * c) / 2) / c);
      // Dropped exactly on a pile of the same currency, the sim pours one into the other.
      const pours = d.item.itemClass === "currency"
        && g.items.some((p) => p !== d.item && p.x === x && p.y === y && p.baseId === d.item.baseId);
      return { container: id, x, y, ok: pours || fitsAt(g, d.item, d.w, d.h, x, y) };
    }
    return null;
  };
  // State only for the highlight, and it changes only when the cell does: a mouse
  // reports hundreds of moves a second, and re-rendering the panel on each halved the fps.
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null);
  // Compared here, not in a setState updater: React can render once even for an equal value.
  const targetRef = React.useRef<DropTarget | null>(null);
  const ghostRef = React.useRef<HTMLDivElement | null>(null);
  // Whether the vendor window under the held piece will take it. Same rule as
  // the sim's vendorSellPrice: currency and unread items are refused.
  const [sellHover, setSellHover] = React.useState<"ok" | "refused" | null>(null);
  const sellRef = React.useRef<"ok" | "refused" | null>(null);
  const sellable = (d: NonNullable<typeof drag>): boolean =>
    d.from.kind === "grid" && d.item.itemClass !== "currency" && !d.item.unidentified;
  // The sim refuses those sales without a word, so a ctrl-click on one says why here.
  const [sellNote, setSellNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!sellNote) return;
    const t = setTimeout(() => setSellNote(null), 2500);
    return () => clearTimeout(t);
  }, [sellNote]);

  // Pointer events, not HTML5 drag-and-drop: the release target can be the Babylon
  // canvas behind the panel (drop to ground), which native DnD does not reach.
  // The pointer as of the last event, written outside React: a slow frame can
  // deliver the moves and the release before the moved `drag` is committed.
  const pointerRef = React.useRef({ x: NaN, y: NaN });
  React.useEffect(() => {
    if (!drag) { targetRef.current = null; setDropTarget(null); sellRef.current = null; setSellHover(null); return; }
    const move = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const overSell = e.target instanceof Element && !!e.target.closest("[data-drop-sell]");
      const sell = overSell ? (sellable(drag) ? "ok" : "refused") : null;
      if (sellRef.current !== sell) {
        sellRef.current = sell;
        setSellHover(sell);
      }
      const ghost = ghostRef.current;
      if (ghost) {
        ghost.style.left = ghostLeft(drag, e.clientX);
        ghost.style.top = ghostTop(drag, e.clientY);
      }
      const t = targetAt(drag, e.clientX, e.clientY);
      if (!sameTarget(targetRef.current, t)) {
        targetRef.current = t;
        setDropTarget(t);
      }
    };
    const up = (e: PointerEvent) => {
      // A press released without travelling is a PICKUP, not a drag that ended
      // where it began: the piece rides the cursor and the NEXT release commits
      // it. Both of PoE's gestures therefore work, and which one you used is
      // decided by the pointer rather than by a timer. Travel is measured from
      // the press against `pointerRef`, which only the press and `pointermove` write, so a
      // release event's own coordinates -- absent on a synthetic one, and 0,0 on
      // a click fired at an element rather than a point -- cannot decide it.
      const travel = Math.hypot(pointerRef.current.x - drag.ox, pointerRef.current.y - drag.oy);
      // `!(travel >= SLOP)` rather than `travel < SLOP`, because travel is NaN
      // whenever the press carried no coordinates -- every synthetic pointerdown
      // in jsdom, and any event source that omits them. NaN loses both
      // comparisons, so the strict form would silently make the pickup
      // unreachable; unknown travel has to read as the click it was.
      if (!drag.carried && !(travel >= CARRY_SLOP)) {
        setDrag((d) => (d ? { ...d, carried: true } : d));
        return;
      }
      setDrag(null);
      const dropTarget = targetAt(drag, pointerRef.current.x, pointerRef.current.y);
      // e.target is the topmost element under the pointer (nothing captures it, and
      // the drag ghost is pointer-transparent); elementFromPoint covers synthetic events.
      const target = e.target instanceof Element ? e.target : document.elementFromPoint(e.clientX, e.clientY);
      const slot = target?.closest<HTMLElement>("[data-drop-slot]")?.dataset["dropSlot"] as EquipSlotId | undefined;
      const onGrid = !!target?.closest("[data-drop-grid]");
      const insidePanel = !!boxRef.current && !!target && boxRef.current.contains(target);
      if (slot) {
        if (drag.from.kind === "grid" && (drag.from.container === "backpack" || drag.from.container === "stash") && wearable(drag.item, slot)) {
          onIntent?.({
            kind: "equipItem", x: drag.from.x, y: drag.from.y, slot,
            ...(drag.from.container === "stash" ? { from: "stash" as const } : {}),
          });
        }
        return;
      }
      // Drop onto the map-device socket: seats a waystone from the backpack.
      if (target?.closest("[data-drop-socket]")) {
        if (drag.from.kind === "grid" && drag.from.container === "backpack" && drag.item.baseId === "map.waystone") {
          onSocketWaystone?.(drag.from.x, drag.from.y);
          // This release is also a click on the socket, whose click ejects the stone.
          // A click follows its pointerup in the same task, so the guard ends there.
          const swallow = (c: MouseEvent) => c.stopPropagation();
          window.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
        }
        return;
      }
      // Dropped on the shelf grid: a sale, which the sim prices and may still
      // refuse. Ahead of onGrid, or the shelf would read as a move.
      if (target?.closest("[data-drop-sell]")) {
        if (drag.from.kind === "grid" && sellable(drag)) {
          onIntent?.({
            kind: "sellItem", x: drag.from.x, y: drag.from.y,
            ...(drag.from.container === "stash" ? { from: "stash" as const } : {}),
          });
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
      if (insidePanel || onOtherPanel) return;
      if (drag.from.kind === "slot") onIntent?.({ kind: "dropItem", slot: drag.from.slot });
      else if (drag.from.container === "backpack") onIntent?.({ kind: "dropItem", x: drag.from.x, y: drag.from.y });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onIntent]);

  const grab = (from: DragSource, item: DisplayItem, w: number, h: number, e: React.PointerEvent) => {
    e.preventDefault();
    // Every grab funnels through here, so one guard covers the equipment slots too:
    // a press while a piece is already carried is part of placing it, never a grab.
    if (drag) return;
    // Right-click never grabs: it arms a consumable (onContextMenu), and a grab
    // on the way there is what made using an orb look like moving it.
    if (e.button === 2) return;
    setHover(null);
    pointerRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ from, item, w, h, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, carried: false });
    // Lifting is the cursor's alone, so nothing the sim says can make it untrue.
    playSfx("item-lift");
  };
  const slotHighlight = (slot: EquipSlotId): "legal" | "illegal" | "none" => {
    if (!drag || drag.from.kind === "slot") return "none";
    return wearable(drag.item, slot) ? "legal" : "illegal";
  };

  // PoE's ctrl-click (shift here too): send the piece to the other container without a drag. The
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
    if (!fit) { onRefused?.(); return; } // no room over there; the item stays put
    onIntent?.({
      kind: "moveItem", x: it.x, y: it.y, toX: fit.x, toY: fit.y,
      ...(container === "stash" ? { from: "stash" as const } : { to: "stash" as const }),
    });
  };

  // One grid, rendered for either container. Both share the drag, the hover
  // tooltip and the armed-currency cursor, so an item behaves the same in the
  // stash as in the bag rather than through a second copy of this markup.
  const renderGrid = (container: ContainerId, sortable = false) => {
    const g = grids[container]!;
    const sortMode = SORT_MODES[sortNext[container] ?? 0]!;
    const onSort = () => {
      onIntent?.({ kind: "sortItems", ...(container === "stash" ? { container: "stash" as const } : {}), mode: sortMode });
      setSortNext((s) => ({ ...s, [container]: ((s[container] ?? 0) + 1) % SORT_MODES.length }));
    };
    // The shelf grid is the counter: a piece released on it is sold, and while one is
    // held over it the grid answers first, gilt to take it, red to refuse it.
    const sell = isShop(container) ? sellHover : null;
    return (
          <div
            data-drop-grid={container}
            data-drop-sell={isShop(container) ? "" : undefined}
            data-sell={sell ?? undefined}
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
              // PoE draws the lattice and the faint crest in each empty cell as art,
              // not as borders: one tile repeated is both cheaper than a border per
              // cell and the only way to get the embossed ornament (stash.png).
              backgroundColor: "#0a0b0e",
              // The tile carries the floor and the crest; the lattice is drawn by
              // gradients on top of it because a 256px tile scaled down to a ~42px
              // cell turns its own 4px line into two thirds of a blurred pixel,
              // while the reference's line is a crisp 1px at any cell size.
              backgroundImage: [
                `repeating-linear-gradient(to right, ${LATTICE} 0 1px, transparent 1px ${CELL})`,
                `repeating-linear-gradient(to bottom, ${LATTICE} 0 1px, transparent 1px ${CELL})`,
                "url(/textures/ui/stash_cell_v4.webp)",
              ].join(","),
              backgroundSize: `auto, auto, ${CELL} ${CELL}`,
              border: `1px solid ${GOLD_DIM}`,
              boxShadow: "inset 0 0 14px rgba(0,0,0,0.8)",
              // A 1px border and a faint glow vanished on the dark stone in-game.
              ...(sell && {
                outline: `2px solid ${sell === "ok" ? GOLD : "#d05a4e"}`,
                outlineOffset: -2,
                boxShadow: `inset 0 0 40px ${sell === "ok" ? `${GOLD}8c` : "#d05a4e80"}`,
              }),
            }}
          >
            {/* Sort sits on the grid's top-right corner, just above the cells it rearranges. Neither PoE has one. */}
            {sortable && (
              <button
                type="button"
                data-testid={`${TID[container]}-sort`}
                aria-label={`Sort by ${sortMode}`}
                title={`Sort by ${sortMode}`}
                onClick={onSort}
                style={{
                  position: "absolute", right: 0, bottom: "calc(100% + 3px)", zIndex: 2,
                  width: 24, height: 24, padding: 2, borderRadius: "50%", cursor: "pointer",
                  background: "radial-gradient(circle at 35% 30%, #4a3a20, #1d150b 75%)",
                  border: "1px solid #6b5530",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,220,160,0.25)",
                }}
              >
                <img src="/hud/sort.webp" alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              </button>
            )}
            {Array.from({ length: g.rows }).map((_, y) =>
              Array.from({ length: g.cols }).map((__, x) => (
                <div
                  key={`${x}-${y}`}
                  data-testid={`${TID[container]}-cell-${x}-${y}`}
                  style={{ position: "absolute", left: `calc(${x} * ${CELL})`, top: `calc(${y} * ${CELL})`, width: CELL, height: CELL }}
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
                data-testid={`${TID[container]}-item-${i}`}
                // Refusal is the cursor's job now (index.html): red iron blade over
                // an item the armed orb cannot touch, gilt blade everywhere else.
                data-cursor={armed && !accepts(armed, it) ? "deny" : undefined}
                onMouseEnter={(e) => !drag && setHover({ at: { grid: container, ix: it.x, iy: it.y }, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => !drag && setHover({ at: { grid: container, ix: it.x, iy: it.y }, x: e.clientX, y: e.clientY })}
                // Unconditional: the guard used to be "clear it only if the
                // tooltip is still MINE", compared by object identity, and a
                // snapshot arriving while the cursor sat on a cell rebuilt every
                // DisplayItem — so the item held by the tooltip and the item this
                // cell was rendered with stopped being the same object and the
                // leave stopped clearing anything. That is the tooltip that
                // sticks. The DOM fires leave on the old cell before enter on the
                // new one, so clearing outright cannot blank a fresh hover.
                onMouseLeave={() => setHover(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // A Portal Scroll has no target to be armed at: right-clicking it
                  // IS the use, which is how PoE reads one too. The sim refuses it
                  // outside a map and keeps the scroll, so no check belongs here.
                  if (container === "backpack" && it.baseId === "currency.portal") {
                    setHover(null);
                    setArmed(null);
                    onIntent?.({ kind: "usePortalScroll" });
                    return;
                  }
                  // Shift spends the stack on every item it accepts, one unit each,
                  // in one sim action; the sim stops when the stack runs out.
                  if (e.shiftKey && container === "backpack" && it.itemClass === "currency") {
                    setArmed(null);
                    const first = g.items.find((t) => accepts(it, t));
                    if (!first) return;
                    playDropSound(currencyResultRarity(it.baseId ?? "") ?? first.rarity);
                    onIntent?.({ kind: "applyCurrencyAll", fromX: it.x, fromY: it.y });
                    return;
                  }
                  // Right-clicking the armed currency again, or anything that is not
                  // currency at all, puts what is on the cursor back in the bag.
                  setArmed((a) => (container === "backpack" && it.itemClass === "currency" && a?.x !== it.x ? it : null));
                }}
                onPointerDown={(e) => {
                  // The hand is already full. This press belongs to the release that
                  // will place what is held, so nothing else may read it: grabbing
                  // would silently swap the piece on the cursor, and the vendor and
                  // ctrl paths below would buy or destroy on the way past.
                  if (drag) { e.preventDefault(); return; }
                  // Right-click belongs to onContextMenu (arming a consumable):
                  // it must not buy, sell, transfer or grab on the way there.
                  if (e.button === 2) { e.preventDefault(); return; }
                  // A shelf cell is bought, never dragged: one click is the whole
                  // transaction, and the sim re-checks the price and the room.
                  if (isShop(container)) {
                    e.preventDefault();
                    if (barred(container, it)) return;
                    setHover(null);
                    // Heard as coins once the sim takes the gold (soundscape.ts), not here.
                    onIntent?.({ kind: container === "vendor" ? "buyItem" : "buybackItem", x: it.x, y: it.y });
                    return;
                  }
                  // Ctrl-click breaks an item down, but only while the bench is open:
                  // a destructive gesture must never be one stray modifier away.
                  if (e.ctrlKey && vendorOpen) {
                    e.preventDefault();
                    setHover(null);
                    if (it.unidentified || it.itemClass === "currency") {
                      setSellNote(it.unidentified
                        ? "Unidentified items will not sell. Read it with a Scroll of Wisdom first."
                        : "Currency is the payment, not the goods: it will not sell.");
                      return;
                    }
                    onIntent?.({
                      kind: "sellItem", x: it.x, y: it.y,
                      ...(container === "stash" ? { from: "stash" as const } : {}),
                    });
                    return;
                  }
                  // Ctrl+click a waystone into the map-device socket when the panel
                  // is waiting for one. Vendor wins if both are somehow true (checked above).
                  if (e.ctrlKey && socketWanted && container === "backpack" && it.baseId === "map.waystone") {
                    e.preventDefault();
                    setHover(null);
                    onSocketWaystone?.(it.x, it.y);
                    return;
                  }
                  // Ahead of shift's quick transfer: with an orb on the cursor,
                  // shift means "keep it there", never "send this to the stash".
                  if (armed) {
                    // The hand holds an orb: this click either spends it or does
                    // nothing at all. Falling through to grab was how aiming at
                    // the wrong item picked the item up instead.
                    e.preventDefault();
                    if (container !== "backpack" || !accepts(armed, it)) return;
                    // The tooltip STAYS: it addresses the cell, so the next
                    // snapshot repaints it with what the orb just wrote. Closing it
                    // hid the whole payoff behind a second hover.
                    // PoE: shift held keeps the orb on the cursor for the next item.
                    if (e.shiftKey) shiftSpent.current = true;
                    else setArmed(null);
                    // The outcome is the payoff, so it gets the drop chime at the rarity
                    // the application lands on, which is audible before the new lines are
                    // legible (docs/09 rule 2).
                    playDropSound(currencyResultRarity(armed.baseId ?? "") ?? it.rarity);
                    onIntent?.({ kind: "applyCurrency", fromX: armed.x, fromY: armed.y, x: it.x, y: it.y });
                    return;
                  }
                  // Ctrl is PoE's transfer; shift stays as well.
                  if (e.shiftKey || (e.ctrlKey && stash)) {
                    e.preventDefault();
                    setHover(null);
                    quickTransfer(container, it);
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
                  // An armed orb lights the cells it can legally land on, a
                  // subtle gilt lift rather than a hard ring; everything it
                  // cannot touch keeps only its own rarity glow.
                  boxShadow: armed && container === "backpack" && accepts(armed, it)
                      && (armed.x !== it.x || armed.y !== it.y)
                    ? "inset 0 0 8px #e8c86a66, 0 0 6px #e8c86a55"
                    : `inset 0 0 8px ${RARITY_BORDER[it.rarity]}44`,
                  opacity: drag?.from.kind === "grid" && drag.from.container === container && drag.from.x === it.x && drag.from.y === it.y ? 0.3
                    : container === "backpack" && socketedCell?.x === it.x && socketedCell.y === it.y ? 0.3
                    // PoE's keyword box HIGHLIGHTS rather than filters: the goods
                    // stay where they are and everything else falls back, so the
                    // shelf never reshuffles under a half-typed word.
                    : isShop(container) && highlight !== "" && !matchesHighlight(it, highlight) ? 0.18
                    : barred(container, it) ? 0.45
                    : 1,
                  cursor: barred(container, it) ? "not-allowed" : undefined,
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
                    data-testid={`${TID[container]}-count-${i}`}
                    style={{ position: "absolute", right: 2, bottom: 1, fontSize: 11, color: "#e8dfc4", textShadow: "0 1px 2px #000", pointerEvents: "none" }}
                  >
                    {it.count}
                  </span>
                )}
                {/* The price rides in the cell's bottom-left, opposite the stack
                    count, and turns red when the purse cannot cover it. */}
                {isShop(container) && (
                  <span
                    data-testid={`${TID[container]}-price-${i}`}
                    style={{
                      position: "absolute", left: 2, bottom: 1, fontSize: 10,
                      color: barred(container, it) ? "#d05a4e" : "#f0d789",
                      textShadow: "0 1px 2px #000", pointerEvents: "none",
                    }}
                  >
                    {priceOf(container, it)}
                  </span>
                )}
                {/* An unread item wears a question mark, so the backpack shows what is
                    still owed without a hover (docs/09 rule 2: unseen is unfelt). */}
                {it.unidentified && (
                  <span
                    data-testid={`${TID[container]}-unread-${i}`}
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
    <>
    {/* The stash gets its own layer only so it can dock left while the inventory
        docks right. It stays under the globes and the bar (zIndex 3), the way the
        inventory does: the life orb is meant to sit on top of its lower corner. */}
    {stash && (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "flex-start", pointerEvents: "none", zIndex: 2, fontFamily: SERIF, color: PARCHMENT }}>
        <div
          data-testid="stash-panel"
          data-hud-panel=""
          style={{ ...PANE, padding: PANEL_PAD }}
        >
          <PaneHeader title="Stash" bleed={PANEL_PAD} onClose={() => onCloseStash?.()} testId="stash-close" />
          {renderGrid("stash", true)}
        </div>
      </div>
    )}
    {/* The vendor's purchase window, borrowed from PoE1 (poe1-vendor-purchase.png):
        the shelf as a grid under a gilt cartouche, a keyword box along its foot,
        and the price printed in the cell rather than hidden behind a hover. It
        docks left where the stash does, and the two never open together. */}
    {vendorOpen && (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "flex-start", pointerEvents: "none", zIndex: 2, fontFamily: SERIF, color: PARCHMENT }}>
        <div
          data-testid="vendor-panel"
          data-hud-panel=""
          style={{ ...PANE, padding: PANEL_PAD, overflowY: "auto", scrollbarWidth: "none" }}
        >
          {/* His name, not the transaction: the window belongs to a person. */}
          <PaneHeader title={VENDOR_NAME} bleed={PANEL_PAD} onClose={() => onCloseVendor?.()} testId="vendor-close" />

          {/* The reference labels the shelf and then tabs it: PoE1's page chip for
              his goods, then PoE2's Buyback tab, because a sale has no confirm. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, letterSpacing: 1.5, color: "#b7ac8e" }}>{VENDOR_TITLE}</span>
            <span style={{ display: "flex", gap: 2 }}>
              {(["vendor", "buyback"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  data-testid={`${p}-tab`}
                  aria-pressed={vendorPage === p}
                  onClick={() => setVendorPage(p)}
                  style={{
                    fontFamily: SERIF, fontSize: 10, letterSpacing: 1, padding: "1px 10px", cursor: "pointer",
                    color: vendorPage === p ? GOLD : "#8a7f66",
                    background: vendorPage === p ? "linear-gradient(180deg,#221c11,#12100a)" : "#0b0a07",
                    border: `1px solid ${GOLD_DIM}`, borderBottom: "none",
                  }}
                >
                  {p === "vendor" ? "-1-" : "Buyback"}
                </button>
              ))}
            </span>
          </div>

          {renderGrid(vendorPage)}

          {/* Highlight, not filter — see matchesHighlight. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: 1, color: GOLD, whiteSpace: "nowrap" }}>Highlight Items</span>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                data-testid="vendor-highlight"
                value={highlight}
                onChange={(e) => setHighlight(e.target.value)}
                placeholder="Type keywords here..."
                style={{
                  width: "100%", boxSizing: "border-box", padding: "4px 22px 4px 8px",
                  background: "#0a0906", border: `1px solid ${GOLD_DIM}`, borderRadius: 2,
                  color: PARCHMENT, fontFamily: SERIF, fontSize: 11, letterSpacing: 0.5,
                  outline: "none",
                }}
              />
              {highlight !== "" && (
                <button
                  data-testid="vendor-highlight-clear"
                  onClick={() => setHighlight("")}
                  style={{
                    position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "#8c8069", fontSize: 12, lineHeight: 1, padding: 0,
                  }}
                >
                  ⊗
                </button>
              )}
            </div>
          </div>

          {/* The sell half. Gold is paid for anything the counter takes; these pips
              are the extra a magic or better piece breaks down into, and they stay
              on the same window because it is one counter, not two services. */}
          <SectionRule>Sell</SectionRule>
          {SHARD_ROWS.map(({ orbBaseId, label }) => {
            const n = shards[orbBaseId] ?? 0;
            return (
              <div key={orbBaseId} data-testid={`shard-${orbBaseId}`} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: PARCHMENT, letterSpacing: 1 }}>
                  <span>{label} Shards</span>
                  <span style={{ color: n > 0 ? GOLD : "#6b6152" }}>{n} / {SHARDS_PER_ORB}</span>
                </div>
                <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                  {Array.from({ length: SHARDS_PER_ORB }, (_, k) => (
                    <div
                      key={k}
                      style={{
                        flex: 1,
                        height: 6,
                        border: "1px solid #000",
                        background: k < n ? "linear-gradient(180deg,#e0a13c,#8a5410)" : "#171410",
                        boxShadow: k < n ? `0 0 5px ${GOLD}66` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {sellNote ? (
            <div data-testid="vendor-sell-note" style={{ fontSize: 11, color: "#d05a4e", lineHeight: 1.45, marginTop: 2 }}>
              {sellNote}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#8c8069", lineHeight: 1.45, marginTop: 2 }}>
              Click the shelf to buy. Drag your own onto it or ctrl-click it to sell: all of it pays gold,
              magic and better also break into shards.
            </div>
          )}
        </div>
      </div>
    )}
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
      <div
        ref={boxRef}
        // The wheel still scrolls; PoE has no scrollbar chrome and a pale native
        // one down the pane's gilt edge reads as a browser, not as the game.
        style={{ ...PANE, overflowY: "auto", scrollbarWidth: "none" }}
      >
        <PaneHeader title="Inventory" onClose={onClose} testId="inventory-close" />

        {/* The extra foot of padding is the band the mana globe rises into: the
            strip below is pinned to the bottom of this column, so without it the
            globe lands squarely on the currency and on the backpack's last row. */}
        <div style={{ padding: PANEL_PAD, paddingBottom: `calc(${PANEL_PAD} + ${ORB_RISE})`, width: contentW, boxSizing: "content-box", flex: 1, display: "flex", flexDirection: "column" }}>
          {/* PoE2's pair of tabs on the doll's top edge: INVENTORY at the left,
              COSMETICS at the right (inventory+equipment.png). */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            {(["inventory", "cosmetics"] as const).map((p) => (
              <button
                key={p}
                type="button"
                data-testid={`${p}-tab`}
                aria-pressed={page === p}
                onClick={() => setPage(p)}
                style={{
                  fontFamily: SERIF, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
                  padding: "2px 14px", cursor: "pointer",
                  color: page === p ? GOLD : "#8a7f66",
                  background: page === p ? "linear-gradient(180deg,#221c11,#12100a)" : "#0b0a07",
                  border: `1px solid ${GOLD_DIM}`, borderBottom: "none",
                }}
              >
                {p}
              </button>
            ))}
          </div>
          {page === "cosmetics" ? (
            <div data-testid="cosmetics-page" style={{ width: equipW, height: equipH, margin: "0 auto", flexShrink: 0 }}>
              <SectionRule>Pets</SectionRule>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "linear-gradient(180deg,#16130c,#0b0906)", border: `1px solid ${GOLD_DIM}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: GOLD }}>Celestial Cat</div>
                  <div style={{ fontSize: 11, color: "#8c8069" }}>Floats along behind you. It never fights.</div>
                </div>
                <Gem label="Celestial Cat" on={pet} onToggle={(on) => onPetToggle?.(on)} />
              </div>
            </div>
          ) : (
          /* Equipment paper-doll. The flasks live inside it, in the block the
              right-hand weapon leaves empty below itself, rather than in a strip
              of their own under the whole doll: that strip cost a full row of
              panel height and pushed the backpack down into the mana globe.
              PoE2's own screen centres them under the doll (inventory+equipment
              .png), but its doll fills its box and ours does not — two columns of
              bare panel beside the boots is the more obvious wrong. */
          <div style={{ position: "relative", width: equipW, height: equipH, margin: "0 auto", flexShrink: 0 }}>
            <div
              style={{
                position: "absolute",
                left: `calc(8 * ${U})`, top: `calc(4 * ${U})`,
                width: `calc(2 * ${U})`, height: `calc(2 * ${U})`,
                display: "flex", gap: 4, justifyContent: "center", alignItems: "flex-start",
              }}
            >
              <Flask kind="life" hotkey={keyCap(flaskKeys.life)} {...(flasks ? { charges: { now: flasks.lifeCharges, max: flasks.lifeMax } } : {})} />
              <Flask kind="mana" hotkey={keyCap(flaskKeys.mana)} {...(flasks ? { charges: { now: flasks.manaCharges, max: flasks.manaMax } } : {})} />
            </div>
            {PAPER_DOLL.map((s) => (
              <EquipSlot
                key={s.slot}
                {...s}
                item={equipment[s.slot]}
                highlight={slotHighlight(s.slot)}
                // An orb in the hand never picks the worn piece up, same as in the grid:
                // it is spent on the piece where it is worn, as PoE allows.
                onGrab={(slot, e) => {
                  if (!armed) { grab({ kind: "slot", slot }, equipment[slot]!, 1.5, 1.5, e); return; }
                  e.preventDefault();
                  const worn = equipment[slot]!;
                  if (!currencyAccepts(armed.baseId ?? "", worn.rarity, worn.unidentified === true, worn.lines.length)) return;
                  if (e.shiftKey) shiftSpent.current = true;
                  else setArmed(null);
                  playDropSound(currencyResultRarity(armed.baseId ?? "") ?? worn.rarity);
                  onIntent?.({ kind: "applyCurrency", fromX: armed.x, fromY: armed.y, slot });
                }}
                onHover={(_item, e) => !drag && setHover({ at: { slot: s.slot }, x: e.clientX, y: e.clientY })}
                onLeave={() => setHover(null)}
              />
            ))}
          </div>
          )}

          {/* Backpack grid (functional) */}
          <SectionRule>Backpack</SectionRule>
          {renderGrid("backpack", true)}

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
            <Currency label="Gold" value={gold} />
            <Currency label="Shards" value={shardTotal} />
          </div>
        </div>
      </div>
    </div>
    {/* The tooltip and the drag ghost ride over every panel, the stash layer
        included, or an item picked up in the bag vanishes behind the stash. */}
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 60, fontFamily: SERIF, color: PARCHMENT }}>
      {hoverItem && (worn.length > 0
        ? <ItemCompare worn={worn} hovered={{ ...hoverItem, playerLevel: level }} x={hover!.x} y={hover!.y} />
        : <ItemTooltip {...hoverItem} playerLevel={level} x={hover!.x} y={hover!.y} />)}
      {armed && armedPos && !drag && armed.icon && (
        <img
          data-testid="armed-icon"
          ref={armedIconRef}
          src={armed.icon}
          alt=""
          style={{
            position: "fixed",
            left: armedAt.current.x + 10,
            top: armedAt.current.y + 10,
            width: 28,
            height: 28,
            objectFit: "contain",
            pointerEvents: "none",
            zIndex: 10,
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))",
          }}
        />
      )}
      {drag && (
        <div
          data-testid="drag-ghost"
          // The world's pointer handling reads this to know a press is placing the
          // piece rather than commanding a walk. See `bindings.ts` onPointerDown.
          data-carrying=""
          ref={ghostRef}
          style={{
            position: "fixed",
            // The pointer handler moves it between renders; a render puts it where the pointer is now.
            left: ghostLeft(drag, Number.isNaN(pointerRef.current.x) ? drag.x : pointerRef.current.x),
            top: ghostTop(drag, Number.isNaN(pointerRef.current.y) ? drag.y : pointerRef.current.y),
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
    </>
  );
});
