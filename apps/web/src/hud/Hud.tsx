import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { MAP_PORTALS } from "@exiled/protocol";
import { MONSTERS } from "@exiled/content-runtime";
import { atlasGraph } from "@exiled/rules";
import { DISPLAY, ItemTooltip, SERIF } from "./ItemTooltip";
import { flaskTooltip } from "./flask-tooltip";
import { PANEL_W } from "./layout";
import { SkillTooltip } from "./SkillTooltip";
import { XpBar } from "./XpBar";
import { TargetFrame } from "./TargetFrame";
import { playDropSound } from "../audio/drop-sound";
import { DEFAULT_KEYBINDS_BY_MODE, DEFAULT_SETTINGS, MOUSE_SLOT_BASE, MOVE_SOCKET, SKILL_ACTIONS, SKILL_SLOT_COUNT, type ControlMode, type Keybinds } from "../settings";
import { VENDOR_NAME, VENDOR_TITLE } from "../npc";
import type { FrameHook, Projector } from "./LootLabels";

// Bottom HUD geometry, measured off reference-screenshots/poe1-lower-bar.png, a 2558x388 crop
// of Path of Exile **1**'s bottom bar (PoE1, not PoE2 — its globes are bigger and its ring
// far thinner than the PoE2 orbs we started from). Measured there: the liquid sphere is
// 263px across = 10.3% of the screen width; the braided ring is a 19px band = 7.2% of the
// sphere; the sphere's outer edge stops ~10px from the screen side and its bottom ~2% of
// the screen height above the bottom edge; a bronze figure leans on the outer side.
// The globe is a fraction of the screen, not a pixel size — PoE1 scales it with the
// resolution, and at 2048px wide a fixed 160px globe reads a quarter too small.
// Sized by the fill's HEIGHT: PoE2's red is 34px of a 2560px screen = 1.33vw (boss-fight.png).
// Our frame art is far taller per width (1280x222, window 28.4% of it), so 28vw of frame gives
// 1.38vw of fill height; matching PoE2's width (35%) instead made the bar twice as tall.
const BOSS_BAR_W = "28vw";
/** Just under the boss bar: its top, plus the 1280x222 frame drawn at BOSS_BAR_W, plus a gap. */
const UNDER_BOSS_BAR = `${(0.6 + (28 * 222) / 1280 + 0.3).toFixed(2)}vw`;
const ORB_HOLE = 0.869; // ring art: its transparent hole is this fraction of the file
const ORB_VW = 10.3; // sphere diameter
const ORB = `${ORB_VW}vw`;
const ORB_FRAME = `${(ORB_VW / ORB_HOLE).toFixed(2)}vw`;
const RING_VW = (ORB_VW / ORB_HOLE - ORB_VW) / 2; // ring band thickness
const ORB_INSET = "0.39vw"; // sphere offset from the side; the ring overhangs off-screen
const BAR_SIDE = 28;
// The border-image slices the frame art keeps for its own top and bottom edges, and the
// rail between the two socket rows. On the 2558-wide reference these measure 19px, 7px and
// 18px: a heavy cornice, a thin lip, a recessed rail. In px they only held that ratio at
// one window width, and ours had them near enough backwards (14 top, 16 bottom, a 2px gap).
const BAR_TOP = "0.74vw";
const BAR_BOTTOM = "0.27vw";
const BAR_RAIL = "0.70vw";
const BAR_PAD_EXPR = `${ORB_INSET} + ${ORB} + ${RING_VW.toFixed(3)}vw - ${BAR_SIDE}px`;
const ORB_BOTTOM = "2.1vh"; // sphere bottom above the screen edge
const FIGURE_H = `${(ORB_VW * 1.08).toFixed(2)}vw`; // bronze figure height, same crop
const FIGURE_OUT = "0.9vw"; // figure hangs off the screen side, covering ~30% of the globe
// The bars are a fraction of the globe, not a pixel size. On the same PoE1 crop the flask
// panel stands 190px tall against the 263px sphere (0.72), its vials 134px (0.51), and the
// skill tiles are 58px (0.22) in two rows; both panels run *under* the globe, the braided
// ring and its bronze figure covering the panel's end, which is what makes the bottom of
// the screen read as one piece of furniture instead of two boxes parked beside two globes.
// Ours was 0.58 while the skill panel held a single row: now that the mouse buttons stack
// above the numbered slots, it takes PoE1's full 0.72 and the tiles drop to its 0.22.
// That crop is a 16:9 fullscreen grab (2558 wide), so its pixels convert straight to vw:
// the skill panel's 190px is 7.43vw and the flask panel's 162px is 6.33vw, which is where
// these two fractions come from.
// Exported because the inventory panel has to stop exactly where this starts.
export const BAR_H = `${(ORB_VW * 0.72).toFixed(2)}vw`;
/**
 * How far the globe and its braided ring rise above the bar, i.e. above the foot
 * of the panes. The globe is *meant* to overlap the pane's lower corner — that
 * is what tucks the panel behind the furniture instead of parking it alongside.
 * What it is not meant to overlap is anything the player has to read or click,
 * and the inventory pins its currency strip to that foot, so the mana globe was
 * sitting on the strip and on the last row of the backpack. The inventory keeps
 * its content clear of this band; the corner it leaves bare is the overlap.
 */
export const ORB_RISE =
  `calc(${ORB_BOTTOM} + ${(ORB_VW + RING_VW).toFixed(2)}vw - ${(ORB_VW * 0.72).toFixed(2)}vw)`;
const READOUT_LIFT_VW = ORB_VW * 0.04;
const READOUT_FONT = `clamp(11px, ${(ORB_VW * 0.066).toFixed(2)}vw, 18px)`;
/**
 * How far the globe's `Life 140/140` readout reaches above the pane foot: ORB_RISE,
 * the readout's lift off the ring, and its line with a little air. A pane's
 * scrolling rows stop under this, or they pass behind the numbers.
 */
export const READOUT_RISE = `calc(${ORB_RISE} + ${READOUT_LIFT_VW.toFixed(2)}vw + 1.6 * ${READOUT_FONT})`;
// PoE1's left panel stands a step shorter than the right one, 162px against 190px on the
// same crop, but that step leaves a strip of bare world between the flask frame and the
// foot of the stash pane, which stops on BAR_H the way the inventory does. The panes'
// shared bottom line wins over the step: both frames start where both panes end.
const SLOT_GAP = 2; // px between tiles; PoE1 packs them against a hairline
// A tile is as big as the smaller of two budgets. Width: what is left of the frame once
// the globe's padding and the frame's own sides are taken off it. Height: two rows, the
// cornice, the lip and the rail between them all have to stay inside the bar's own box,
// or the bottom row runs off the screen edge.
// Both are vw now that PANEL_W is (layout.ts), so the same budget wins at every window
// width and the numbered row runs flush to the frame. While PANEL_W was fixed px the
// width budget outgrew the height one as the window narrowed, and the leftover — 54px at
// 2048 — sat as bare stone to the left of the row, which PoE1 never shows.
const SLOT = `min(
  calc((${PANEL_W} - ${2 * BAR_SIDE}px - (${BAR_PAD_EXPR}) - ${4 * SLOT_GAP}px) / 5),
  calc((${BAR_H} - ${BAR_TOP} - ${BAR_BOTTOM} - ${BAR_RAIL}) / 2)
)`;
const FLASK_W = `${(ORB_VW * 0.20).toFixed(2)}vw`;
const FLASK_H = `${(ORB_VW * 0.50).toFixed(2)}vw`;
// The passive-tree plus button, a shade wider than a vial, centred on the bar.
const PLUS_W = `${(ORB_VW * 0.22).toFixed(2)}vw`;
// The border-image's own side slice. Named because the padding below has to
// subtract exactly it, or the first slot drifts out from under the ring.
// Content clears the globe by padding, not by offsetting the whole bar: that way the art
// keeps running behind the ring. BAR_SIDE is the border-image's own side slice, which
// already sits between the bar's edge and its first slot.
const BAR_PAD = `calc(${BAR_PAD_EXPR})`;

// Five numbered skill slots, then the three mouse buttons, as PoE1's bar does:
// left, middle and right click each hold a skill of their own. The numbered
// slots' keys come from the keymap: PoE2's QWERT, or QERTF when WASD walks.
type SkillSlot = {
  /** `button`: the PointerEvent.button of a mouse slot, absent on a keyed one. */
  id: string | null; key: string; button?: number;
  icon?: string; glow?: string; label?: string;
};

/**
 * A skill's face, keyed by id rather than baked into a socket.
 *
 * Split apart when the sockets became reorderable: the art belongs to the skill and
 * the key belongs to the socket, and a bar that carries both cannot be shuffled
 * without the icons walking off with the numbers.
 */
export const SKILL_ART: Record<string, { icon: string; glow: string }> = {
  "skill.ember_bolt.v1": { icon: "/textures/skills/ember_bolt.webp", glow: "#ff7a2f" },
  "skill.cinder_ground.v1": { icon: "/textures/skills/cinder_ground.webp", glow: "#e0492b" },
  "skill.blink.v1": { icon: "/textures/skills/blink.webp", glow: "#3fb6ff" },
  "skill.strike.v1": { icon: "/textures/skills/strike.webp", glow: "#c4a45a" },
  "skill.snap_shot.v1": { icon: "/textures/skills/snap_shot.webp", glow: "#9ab0c4" },
  "skill.ember_spark.v1": { icon: "/textures/skills/ember_spark.webp", glow: "#e8993a" },
  "skill.heavy_strike.v1": { icon: "/textures/skills/heavy_strike.webp", glow: "#e0873a" },
  "skill.piercing_shot.v1": { icon: "/textures/skills/piercing_shot.webp", glow: "#a9c4dc" },
  "skill.ground_slam.v1": { icon: "/textures/skills/ground_slam.webp", glow: "#d9a14a" },
  "skill.split_arrow.v1": { icon: "/textures/skills/split_arrow.webp", glow: "#b6d4a8" },
  "skill.town_portal.v1": { icon: "/textures/skills/town_portal.webp", glow: "#4fb8ff" },
  // Not a skill: the built-in walk action a mouse socket can hold. It lives here
  // so the bar draws it exactly like everything else instead of special-casing it.
  [MOVE_SOCKET]: { icon: "/textures/skills/move.webp", glow: "#9c8a6a" },
};

/** The mouse row, in PointerEvent.button order. */
const MOUSE_KEYS: readonly string[] = ["LMB", "MMB", "RMB"];

/** Socket `i` of the bar. Works for both rows: past MOUSE_SLOT_BASE the key is
 *  a mouse button name, and MOVE_SOCKET gets a label instead of an icon. */
function socketFor(
  bar: (string | null)[],
  i: number,
  keybinds: Keybinds,
  names?: ReadonlyMap<string, string>,
): SkillSlot {
  const id = bar[i] ?? null;
  const art = id ? SKILL_ART[id] : undefined;
  const button = i >= MOUSE_SLOT_BASE ? i - MOUSE_SLOT_BASE : undefined;
  const key = socketKeyLabel(i, keybinds);
  // A label only stands in for art that does not exist; Move has its own icon now.
  const label = art ? undefined
    : id === MOVE_SOCKET ? "Move"
    : id ? (names?.get(id) ?? id) : undefined;
  return {
    id, key, label,
    ...(button !== undefined ? { button } : {}),
    ...(art ? { icon: art.icon, glow: art.glow } : {}),
  };
}

/**
 * One skill tile. Extracted because the bar is two rows now, as PoE1's is
 * (reference-screenshots/poe1-lower-bar.png): the mouse buttons sit in their own row
 * above the numbered slots, and both rows draw the same tile.
 */
/** The chest's size against a skill tile: furniture beside the row, not a fourth socket. */
const CHEST_SCALE = 0.62;

/**
 * A mouse way in to a keyed action at the head of the mouse row, named with its key
 * on hover. The art must carry its own transparency: the hover filter isolates the
 * button, so a blend mode would show the art's ground (tools/build_inventory_icon.py).
 */
function BarIconButton({ testId, art, label, hotkey, onClick }: {
  testId: string; art: string; label: string; hotkey: string; onClick?: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const name = `${label} (${hotkey.toUpperCase()})`;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={name}
      onClick={() => onClick?.()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", width: `calc(${SLOT} * ${CHEST_SCALE})`, height: `calc(${SLOT} * ${CHEST_SCALE})`, padding: 0, cursor: "pointer",
        // The hover filter makes the button a stacking context; lift it so its tooltip clears the skill tiles.
        zIndex: hover ? 3 : undefined,
        background: "none", border: "none",
        filter: hover ? "brightness(1.25) drop-shadow(0 0 6px rgba(217,176,74,0.55))" : "none",
      }}
    >
      <img src={art} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
      {hover && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: 0, whiteSpace: "nowrap",
          padding: "4px 8px", background: "rgba(8,7,6,0.94)", border: "1px solid #6e5a2f",
          color: "#e8d6ad", fontFamily: SERIF, fontSize: 13, pointerEvents: "none",
        }}>
          {name}
        </span>
      )}
    </button>
  );
}

function SkillTile({ slot, n, cooldowns, onHover, drag, onAssignRequest, flash }: {
  slot: SkillSlot;
  n: number;
  cooldowns: Record<string, number>;
  onHover: (id: string | null) => void;
  /**
   * Reordering, for the numbered row only. `index` is the socket's place in the
   * bar; a tile with no `drag` is a fixed socket (the mouse row), which is exactly
   * what stops a skill being dropped somewhere nothing would ever fire it.
   */
  drag?: { index: number; onDrop: (from: number, to: number) => void };
  onAssignRequest?: () => void;
  /** The gem in this socket just levelled: the banner says WHAT, this says WHERE. */
  flash?: boolean;
}) {
  const cd = slot.id ? cooldowns[slot.id] ?? 0 : 0;
  const ready = cd <= 0;
  const [over, setOver] = React.useState(false);
  return (
    <div
      data-testid={`skill-slot-${n}`}
      data-flash={flash ? "1" : undefined}
      onMouseEnter={() => onHover(slot.id)}
      onMouseLeave={() => onHover(null)}
      // Left click opens the picker. A real drag never fires click, so this does
      // not fight the drag-to-reorder the same tile also carries.
      onClick={() => onAssignRequest?.()}
      // Right click has no job on the bar now, so keep the browser menu off it.
      onContextMenu={(ev) => ev.preventDefault()}
      // Only a socket with something in it can be picked up; every socket in the
      // row can be dropped on, including an empty one, which is how a skill is
      // moved to 4 rather than only swapped with 2.
      draggable={drag !== undefined && slot.id !== null}
      onDragStart={(ev) => {
        if (!drag || slot.id === null) return;
        ev.dataTransfer.setData("text/plain", String(drag.index));
        ev.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(ev) => { if (drag) { ev.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(ev) => {
        setOver(false);
        if (!drag) return;
        ev.preventDefault();
        const from = Number(ev.dataTransfer.getData("text/plain"));
        if (Number.isInteger(from) && from !== drag.index) drag.onDrop(from, drag.index);
      }}
      style={{
        width: SLOT,
        height: SLOT,
        position: "relative",
        overflow: "hidden",
        background: slot.icon
          ? "radial-gradient(circle at 50% 35%, #262c34, #0b0d11)"
          : "radial-gradient(circle at 50% 35%, #14171d, #07090c)",
        border: `1px solid ${over ? "#d9b04a" : slot.icon && ready ? "#6b5a34" : "#2b3038"}`,
        borderRadius: 2,
        boxShadow: flash
          ? `0 0 14px 3px #d9b04a, inset 0 0 10px rgba(0,0,0,0.75)`
          : over
          ? "0 0 8px rgba(217,176,74,0.55), inset 0 0 10px rgba(0,0,0,0.6)"
          : slot.icon && ready
            ? `0 0 6px ${slot.glow}33, inset 0 0 10px rgba(0,0,0,0.75)`
            : "inset 0 0 10px rgba(0,0,0,0.85)",
      }}
    >
      {!slot.icon && slot.label && (
        <span style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: `clamp(7px, ${(ORB_VW * 0.05).toFixed(2)}vw, 11px)`,
          color: "#9aa0a8", textShadow: "0 1px 3px #000",
        }}>
          {slot.label}
        </span>
      )}
      {slot.icon && (
        <img
          src={slot.icon}
          alt=""
          // The icon covers the whole tile, and an img is draggable by default, so
          // without this every grab starts the BROWSER's image drag: the tile's own
          // dragStart never fires, dataTransfer carries a URL, and the drop reads
          // NaN. Invisible to jsdom, which dispatches drag events at the div.
          draggable={false}
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
            fontSize: `clamp(10px, ${(ORB_VW * 0.08).toFixed(2)}vw, 17px)`,
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
          padding: "0 3px 1px",
          borderTopRightRadius: 4,
          background: "rgba(4,6,10,0.7)",
          fontSize: `clamp(8px, ${(ORB_VW * 0.062).toFixed(2)}vw, 14px)`,
          fontWeight: 700,
          color: "#c9cdd3",
          textShadow: "0 1px 3px #000",
        }}
      >
        {slot.button === undefined ? slot.key : <MouseIcon button={slot.button} />}
      </span>
    </div>
  );
}

const MOUSE_BUTTON_NAMES = ["Left mouse button", "Middle mouse button", "Right mouse button"];

/** A mouse a caption high, with the one button that fires this slot lit gold. */
function MouseIcon({ button }: { button: number }): React.ReactElement {
  const fill = (b: number) => (b === button ? "#d9b04a" : "#1a1712");
  return (
    <svg role="img" aria-label={MOUSE_BUTTON_NAMES[button]} viewBox="0 0 14 20"
      style={{ display: "block", height: "1.5em", width: "auto", filter: "drop-shadow(0 1px 2px #000)" }}>
      <path d="M7 1 C3 1 1 3.5 1 7 V13 C1 16.5 3.5 19 7 19 C10.5 19 13 16.5 13 13 V7 C13 3.5 11 1 7 1 Z"
        fill="#0c0b09" stroke="#8a7140" strokeWidth="1" />
      <path d="M6.4 1.6 C3.4 1.9 1.6 4 1.6 7 V8 H6.4 Z" fill={fill(0)} />
      <path d="M7.6 1.6 C10.6 1.9 12.4 4 12.4 7 V8 H7.6 Z" fill={fill(2)} />
      <rect x="5.9" y="3" width="2.2" height="4.2" rx="1.1" fill={fill(1)} stroke="#8a7140" strokeWidth="0.6" />
    </svg>
  );
}

const PICK_TILE = 40;

/** The key caption a socket index wears, matching the bar's own two rows. */
function socketKeyLabel(i: number, keybinds: Keybinds): string {
  return i >= MOUSE_SLOT_BASE ? MOUSE_KEYS[i - MOUSE_SLOT_BASE]! : keybinds[SKILL_ACTIONS[i]!].toUpperCase();
}

/** One choosable tile in the picker: art if the entry has any, else its initial. */
function PickTile({ id, name, bound, selected, onPick, onHover }: {
  id: string | null;
  name: string;
  bound: string | null;
  selected: boolean;
  onPick: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const art = id ? SKILL_ART[id] : undefined;
  return (
    <button
      data-testid={`pick-${id ?? "clear"}`} role="menuitem" title={name}
      onClick={() => onPick(id)}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover(null)}
      style={{
        width: PICK_TILE, padding: 0, cursor: "pointer", font: "inherit",
        display: "flex", flexDirection: "column", alignItems: "stretch",
        background: "transparent", border: "none",
      }}
    >
      <span style={{
        position: "relative", height: PICK_TILE, borderRadius: 2,
        border: `1px solid ${selected ? "#d9b04a" : "#43382180"}`,
        background: art
          ? `#05070a center/cover url(${art.icon})`
          : "radial-gradient(circle at 50% 35%, #1b1d22, #06080b)",
        boxShadow: selected ? `0 0 6px ${art?.glow ?? "#d9b04a"}` : "inset 0 0 8px rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#8d8778", fontSize: 18,
      }}>
        {/* Clear has no art on purpose: an empty socket is what it assigns. */}
        {art ? null : id === null ? "✕" : name.slice(0, 1)}
      </span>
      {/* PoE2 captions each tile with the key it is currently bound to, which is
          how you see at a glance that a skill is already sitting on another socket. */}
      <span style={{
        height: 12, lineHeight: "12px", fontSize: 9, fontWeight: 700,
        color: bound ? "#d9b04a" : "transparent", textShadow: "0 1px 2px #000",
      }}>{bound ?? "."}</span>
    </button>
  );
}

/**
 * Right-click assignment popup, laid out from reference-screenshots/skill-action-bar.webp
 * (PoE2's own socket picker, circled bottom right): a titled panel of icon TILES in
 * labelled sections, each captioned with the key it is bound to, not a text menu.
 */
function SkillPicker({ skills, details, bar, keybinds, current, onPick, onClose }: {
  skills: ReadonlyMap<string, string>;
  keybinds: Keybinds;
  /** Full skill records, so a hovered tile shows the same tooltip the bar does. */
  details: Snapshot["skills"];
  bar: readonly (string | null)[];
  current: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClick = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onClick); };
  }, [onClose]);

  /** Which key this entry already answers to, so the tile can wear it. */
  const boundKey = (id: string | null): string | null => {
    if (id === null) return null;
    const i = bar.indexOf(id);
    return i === -1 ? null : socketKeyLabel(i, keybinds);
  };

  const sections: { title: string; items: { id: string | null; name: string }[] }[] = [
    // No Move: mouse mode keeps it on left click, and WASD walks on the keys.
    { title: "Actions", items: [{ id: null, name: "Clear" }] },
    { title: "Skills", items: [...skills].map(([id, name]) => ({ id: id as string | null, name })) },
  ];

  const pick = (id: string | null) => { onPick(id); onClose(); };

  return (
    <div data-testid="skill-picker" role="menu" onPointerDown={(e) => e.stopPropagation()} style={{
      position: "absolute", right: BAR_PAD, bottom: `calc(${BAR_H} + 8px)`,
      width: PICK_TILE * 4 + 22, zIndex: 40, padding: "2px 6px 6px", pointerEvents: "auto",
      background: "linear-gradient(180deg,#15161a,#0a0b0e)",
      border: "1px solid #6b5a34", borderRadius: 3,
      boxShadow: "0 6px 20px rgba(0,0,0,0.75)", fontFamily: SERIF,
    }}>
      <button aria-label="Close" onClick={onClose} style={{
        position: "absolute", top: 2, right: 4, padding: 0, lineHeight: 1,
        background: "none", border: "none", cursor: "pointer", color: "#7d7566", fontSize: 12,
      }}>{"✕"}</button>
      {sections.map((s) => (
        <div key={s.title}>
          <div style={{
            margin: "4px 0 3px", paddingBottom: 2, textAlign: "center",
            borderBottom: "1px solid #43382160", color: "#b9a06a",
            fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
          }}>{s.title}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
            {s.items.map((c) => (
              <PickTile key={c.id ?? "__clear"} id={c.id} name={c.name}
                bound={boundKey(c.id)} selected={c.id === current}
                onPick={pick} onHover={setHovered} />
            ))}
          </div>
        </div>
      ))}
      {/* Nested inside the panel on purpose: the picker already owns a stacking
          context, so anchoring the tooltip to its top edge keeps it above the
          panel without a second z-index guess about the bar below. */}
      <SkillTooltip skills={details} id={hovered} right="0" bottom="100%" />
    </div>
  );
}

// One life flask, one mana flask, on whatever keys the keymap gives them.
const FLASKS = [
  { kind: "life", action: "flaskLife" },
  { kind: "mana", action: "flaskMana" },
] as const;

/** A single flask: recessed PoE2 socket holding the painted vial, hotkey at its foot. */
function Flask(props: { kind: "life" | "mana"; hotkey: string; charges: number; max: number }) {
  const { kind, hotkey, charges, max } = props;
  const veilPct = max > 0 ? 100 - (charges / max) * 100 : 100;
  const [tip, setTip] = React.useState<{ x: number; y: number } | null>(null);
  return (
    <div
      data-testid={`flask-${kind}`}
      onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setTip(null)}
      style={{
        pointerEvents: "auto",
        position: "relative",
        width: FLASK_W,
        height: FLASK_H,
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
        src={`/textures/ui/flask_${kind}.webp`}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.8))",
        }}
      />
      {/* Charges drain from the top, PoE-style: the spent part of the vial goes dark.
          Painted over the vial, so it has to come after the image. */}
      <div
        data-testid={`flask-${kind}-veil`}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: `${veilPct}%`,
          background: "rgba(4,6,10,0.72)",
          pointerEvents: "none",
        }}
      />
      {/* Hotkey at the vial's foot in the serif face, no plate behind it: PoE1 letters the
          flask niches that way, and a filled label bar reads like a debug overlay. */}
      <span
        style={{
          position: "absolute",
          bottom: "4%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: SERIF,
          fontSize: `clamp(10px, ${(ORB_VW * 0.085).toFixed(2)}vw, 18px)`,
          color: "#e8e2d4",
          textShadow: "0 1px 3px #000, 0 0 6px #000",
        }}
      >
        {hotkey}
      </span>
      {tip && <ItemTooltip {...flaskTooltip(kind, hotkey, charges, max)} x={tip.x} y={tip.y} />}
    </div>
  );
}

interface HudProps {
  snapshot: Snapshot | null;
  /** Entity id the mouse is hovering — drives the name label. Null = no label. */
  hoveredEntityId?: number | null;
  /** Places the name label over the hovered object; without it the label sits
   *  in its fixed slot above the skill bar. */
  project?: Projector | null;
  /** Placement runs on this when it exists, and on rAF when it does not. */
  afterFrame?: FrameHook | null;
  /** Which skill sits in which numbered socket. Defaulted so the lab can boot bare. */
  skillBar?: (string | null)[];
  /** Draw `Life 100/100` over the globes at all. */
  orbNumbers?: boolean;
  /** A skill was dragged to another socket. The caller owns and persists the bar. */
  onSkillBarChange?: (next: (string | null)[]) => void;
  /** Open the passive tree — the plus button beside the flasks, PoE1's own affordance. */
  onOpenPassives?: () => void;
  /** Toggle the inventory from the chest at the head of the mouse row, and the key bound to it. */
  onToggleInventory?: () => void;
  inventoryKey?: string;
  /** Cast Portal from the button left of the chest; same cast as the portal key. */
  onPortal?: () => void;
  /** The active keymap, for the captions under the flasks and the numbered sockets. */
  keybinds?: Keybinds;
  /** Mouse mode keeps left click on Move: that socket is fixed. */
  controlMode?: ControlMode;
  /** The monster under the cursor, for the target frame. Null = none. */
  targetId?: number | null;
}

/**
 * The carved band that runs between the two panels, so the bottom of the screen
 * is one piece of furniture rather than two boxes parked on a lit floor.
 * Per reference-screenshots/options.png, where a frieze crosses the full width
 * under the docked window; ours had the map's own stone reading bright and flat
 * across that whole span, with the level readout floating on it.
 *
 * A fraction of the bar, not the whole of it: the panels have to stay the raised
 * ends, and an opaque strip at BAR_H would take a sixth of the viewport height
 * of playfield with it. This is the knob for how tall the band reads.
 *
 * It is TRIM, not a slab: at 0.38 the nine-slice's own edges (BAR_TOP + BAR_BOTTOM,
 * about 1.01vw) were only a third of it and the rest was stretched middle — a
 * plain dark block under a gilt line. 0.15 leaves the carved edges and almost
 * nothing between them. Do not drop below BAR_TOP + BAR_BOTTOM or the slices
 * crush into each other.
 */
const CONNECT_H = `calc(${BAR_H} * 0.15)`;

/**
 * Same art as the panels — one material, so the top rail lands on one line all
 * the way across. No side slices: the gilt corners belong to the panels, and a
 * second pair of them at the screen edges would read as three separate boxes.
 */
const connectStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: CONNECT_H,
  borderStyle: "solid",
  borderWidth: `${BAR_TOP} 0 ${BAR_BOTTOM} 0`,
  borderImageSource: "url(/hud/bar-panel-v3.webp)",
  borderImageSlice: "26 0 44 0 fill",
  zIndex: 1,
};

/** Ornate bar backing, 9-sliced so the corner brackets never stretch. */
const barStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  height: BAR_H,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: "0.25vw",
  borderStyle: "solid",
  borderWidth: `${BAR_TOP} ${BAR_SIDE}px ${BAR_BOTTOM} ${BAR_SIDE}px`,
  // bar-panel-v3.webp, 1024x185: v2 with its top 24 rows of merlons cut off. The
  // battlement squeezed into a 14px border read as a dashed checkerboard against the
  // world; PoE1's panel tops out in a plain stepped cornice over its gold rail, which
  // is what is left underneath. Both ends still close in the art, inside the 78px side
  // slice, rather than in a CSS fade.
  borderImageSource: "url(/hud/bar-panel-v3.webp)",
  borderImageSlice: "26 78 44 78 fill",
  filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.7))",
};

/**
 * A PoE1 resource globe. The liquid is painted art, not a CSS gradient: the image is
 * pinned to the bottom of the well and revealed up to `pct`, so draining it uncovers the
 * dark well the way a real liquid level drops. Over it sit the sphere's gloss, the braided
 * ring, and a bronze figure leaning on the outer side. The value is a label above the
 * globe — PoE1 prints it there, not inside the sphere.
 */
function Orb(props: {
  pct: number;
  /** Energy shield's share of the same well, riding on top of the liquid. 0 = none. */
  shieldPct?: number;
  fillTestId: string;
  readoutTestId: string;
  art: string;
  figure: string;
  label: string;
  value: string;
  side: "left" | "right";
  /** False draws the globe alone. The liquid is the reading; the numbers are a
   *  second opinion, and PoE lets you turn them off. */
  numbers?: boolean;
}) {
  const { pct, shieldPct = 0, fillTestId, readoutTestId, art, figure, label, value, side, numbers = true } = props;
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
            // Two layers, both pinned to the well so neither moves with the level. The art is
            // a lit sphere: its lower hemisphere falls to roughly 0.6 of the equator, so a
            // half-full globe showed only that shadow and read as nearly empty however high
            // the number above it said. The dodge ramp pays that shading back where the art
            // loses it (identity against black, ~1.7x at the very bottom), which keeps the
            // liquid one colour at every level — the sphere's roundness comes from the gloss
            // layers below, not from the liquid.
            // The ramp runs all the way to the top instead of hitting black at 55%
            // and staying there. Two stops with a stop position is a kink in the
            // slope, and a kink in a dodge ramp is a hairline straight across the
            // middle of a full globe — which is what it drew.
            backgroundImage: "linear-gradient(to top,"
              + " rgba(102,102,102,1) 0%, rgba(74,74,74,1) 20%, rgba(45,45,45,1) 40%,"
              + ` rgba(20,20,20,1) 62%, rgba(5,5,5,1) 82%, rgba(0,0,0,1) 100%), url(${art})`,
            backgroundBlendMode: "color-dodge, normal",
            backgroundSize: `${ORB} ${ORB}, ${ORB} ${ORB}`,
            backgroundPosition: "center bottom, center bottom", // globe stays put, the level moves
            boxShadow: "inset 0 3px 6px rgba(255,255,255,0.22)", // liquid meniscus highlight
            // the render came back a hotter red/blue than the shot's blood crimson and cobalt
            filter: "brightness(0.88) saturate(0.9)",
            transition: "height 120ms linear",
          }}
        />
        {/* Energy shield sits ON TOP of the liquid, the way PoE1 stacks it on the
            life globe: the well holds life + shield together, and the pale band is
            the part a hit eats first. With no shield the band is zero-height and the
            globe is exactly the life globe it has always been. */}
        {shieldPct > 0 && (
          <div
            data-testid={`${fillTestId}-shield`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: `${pct}%`,
              height: `${shieldPct}%`,
              background: "linear-gradient(to top, rgba(168,226,255,0.85), rgba(214,244,255,0.95))",
              boxShadow: "inset 0 2px 5px rgba(255,255,255,0.35)",
              transition: "height 120ms linear, bottom 120ms linear",
            }}
          />
        )}
        {/* glass volume: edges fall to near-black so the disc reads as a sphere */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 50% 50%, transparent 58%, rgba(0,0,0,0.30) 100%)" }} />
        {/* specular bloom, upper left — the liquid's brightest point in the PoE1 shot */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(ellipse 54% 42% at 40% 38%, rgba(255,255,255,0.08), rgba(255,255,255,0) 74%)" }} />
        {/* the faint swirl sigil suspended at the sphere's centre */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle ${(ORB_VW * 0.076).toFixed(2)}vw at 50% 35%, rgba(255,255,255,0.42), rgba(255,255,255,0.07) 56%, rgba(255,255,255,0) 82%)` }} />
        {/* inner shadow cast by the ring onto the liquid */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: "inset 0 0 8px rgba(0,0,0,0.6)" }} />
      </div>
      {/* Braided ring (generated art). Its alpha is baked in: the hole is ORB_HOLE of the
          file's width, so at ORB_FRAME the ring lands exactly on the liquid sphere. */}
      <img
        src="/hud/orb-ring-v6.webp"
        alt=""
        style={{
          position: "absolute",
          width: ORB_FRAME,
          height: ORB_FRAME,
          left: `calc((${ORB} - ${ORB_FRAME}) / 2)`,
          top: `calc((${ORB} - ${ORB_FRAME}) / 2)`,
          // PoE1's ring is grimier than the render: sink it into shadow.
          filter: "brightness(0.82) saturate(0.85) hue-rotate(-14deg) drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
          pointerEvents: "none",
        }}
      />
      {/* Bronze figure leaning on the globe's outer side, overlapping ring and liquid. */}
      <img
        src={figure}
        alt=""
        style={{
          position: "absolute",
          height: FIGURE_H,
          bottom: `calc(0px - ${ORB_BOTTOM})`, // stands on the screen edge, PoE1's plinth
          [side]: `calc(0px - ${ORB_INSET} - ${FIGURE_OUT})`, // clipped by the screen side
          // the statue in the shot sits in shadow, not lit like the render's studio bronze
          filter: "brightness(0.62) saturate(0.85) drop-shadow(0 4px 12px rgba(0,0,0,0.8))",
          pointerEvents: "none",
        }}
      />
      {numbers && <div
        data-testid={readoutTestId}
        style={{
          position: "absolute",
          // The label sits just off the ring rather than floating clear of it.
          // PoE1's own bar (poe1-lower-bar.png) leaves about 0.26 of a globe
          // diameter of air there, which reads as detached at this scale.
          bottom: `${(ORB_VW + RING_VW + READOUT_LIFT_VW).toFixed(2)}vw`,
          left: `${(-RING_VW).toFixed(3)}vw`,
          right: `${(-RING_VW).toFixed(3)}vw`,
          display: "flex",
          justifyContent: "center",
          gap: "0.75vw",
          fontFamily: SERIF,
          // Two thirds of what it was: at the old size the pair of readouts was
          // the largest type on the screen, over the one gauge that is already
          // legible as a shape from the corner of the eye.
          fontSize: READOUT_FONT,
          letterSpacing: 0.5,
          whiteSpace: "nowrap",
          textShadow: "0 1px 4px #000",
        }}
      >
        <span style={{ color: "#a9a49a" }}>{label}</span>
        <span style={{ color: "#f4f0e6" }}>{value}</span>
      </div>}
    </div>
  );
}

/**
 * World units above the floor where the hovered name's baseline sits: just over
 * the top of each object, measured on the built meshes (map device 0.95, stash
 * 0.77, the portal's tear about 2.4). The vendor's is over his own name, which
 * NpcLabels keeps at 2.15.
 */
const LABEL_HEIGHT: Partial<Record<Snapshot["entities"][number]["kind"], number>> = {
  portal: 2.55, mapDevice: 1.25, stash: 1.05, vendor: 2.7,
};

export function Hud({
  snapshot,
  hoveredEntityId = null,
  project = null,
  afterFrame = null,
  skillBar = [],
  orbNumbers = DEFAULT_SETTINGS.ui.orbNumbers,
  onSkillBarChange,
  onOpenPassives,
  onToggleInventory,
  inventoryKey = "i",
  onPortal,
  keybinds = DEFAULT_KEYBINDS_BY_MODE.mouse,
  controlMode = "mouse",
  targetId = null,
}: HudProps) {
  const [hoveredSkill, setHoveredSkill] = React.useState<string | null>(null);
  // Length-normalised here rather than trusted: the bar rides in the save, and a
  // row drawn from a short array would silently lose its last sockets.
  const bar = React.useMemo(() => {
    const out: (string | null)[] = [];
    for (let i = 0; i < SKILL_SLOT_COUNT; i++) out.push(skillBar[i] ?? null);
    return out;
  }, [skillBar]);
  /**
   * Swap two sockets. A swap and not an insert: five sockets and three skills
   * means dragging onto an occupied one has to put something back, and pushing the
   * row along would move a skill the player never touched.
   */
  const swapSockets = React.useCallback((from: number, to: number) => {
    const next = [...bar];
    const held = next[from] ?? null;
    next[from] = next[to] ?? null;
    next[to] = held;
    onSkillBarChange?.(next);
  }, [bar, onSkillBarChange]);

  const [assigning, setAssigning] = React.useState<number | null>(null);
  const assignSocket = React.useCallback((index: number, id: string | null) => {
    const next = bar.map((v, i) => (id !== null && v === id && i !== index ? null : v));
    next[index] = id;
    onSkillBarChange?.(next);
  }, [bar, onSkillBarChange]);

  const atlasSeed = snapshot?.atlasSeed ?? 0;
  const activeNodeId = snapshot?.activeNodeId;
  const mapName = React.useMemo(
    () => (activeNodeId ? atlasGraph(atlasSeed).find((n) => n.id === activeNodeId)?.name : undefined),
    [atlasSeed, activeNodeId],
  );

  const skillNames = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const s of snapshot?.skills ?? []) m.set(s.id, s.name);
    return m;
  }, [snapshot?.skills]);

  // docs/09 rule 1: a reward the player cannot hear and see did not happen. Two
  // guaranteed payouts used to land in total silence — the level the fixed track
  // pays on a dry session (rule 7), and the stones a cleared map hands back, which
  // is rule 4's whole "the map must not be able to pay zero" moment. Both were only
  // discoverable later, by reading a number in a panel.
  // `seq` exists so the dismissal is its own effect: hanging the timeout off the
  // payout effect meant the very next snapshot (spending the stone on a map) tore
  // the timer down through cleanup and then returned early without a new one, and
  // the banner stayed up for the rest of the run.
  const [banner, setBanner] = React.useState<{ text: string; seq: number } | null>(null);
  const [flashing, setFlashing] = React.useState<ReadonlySet<string>>(new Set());
  const level = snapshot?.player.level ?? null;
  const stones = snapshot?.inventory.items.filter((i) => i.baseId === "map.waystone").length ?? null;
  const gems = React.useMemo(() => {
    const m: Record<string, { level: number; breakpoints: number }> = {};
    for (const s of snapshot?.skills ?? []) m[s.id] = { level: s.gemLevel, breakpoints: s.breakpoints.length };
    return m;
  }, [snapshot?.skills]);
  const last = React.useRef<{ level: number; stones: number; gems: typeof gems } | null>(null);
  React.useEffect(() => {
    if (level === null || stones === null) return;
    const was = last.current;
    last.current = { level, stones, gems };
    // The first snapshot is the baseline, not a win; a reload would otherwise
    // congratulate the player on the level they already had.
    if (!was) return;
    const won = stones - was.stones;
    const lines = [
      ...(level > was.level ? [`Level ${level}`] : []),
      // Spending a stone on a map is not a payout, so only a rise counts.
      ...(won > 0 ? [`Waystone${won > 1 ? ` x${won}` : ""}`] : []),
    ];
    // A breakpoint outranks the level it arrived with: the level is a number and
    // the breakpoint is the thing that says what changed (docs/09 rule 1). Both
    // ride the one banner rather than queueing two.
    const levelledIds: string[] = [];
    let crossed = false;
    for (const [id, now] of Object.entries(gems)) {
      const before = was.gems[id];
      const name = skillNames.get(id) ?? id;
      if (!before) {
        // A baseline holding no gems at all is the pre-hydration snapshot, not a
        // moment when every skill unlocked at once: the worker starts its clock
        // before the save has loaded, so the restore reads as a burst of unlocks.
        if (Object.keys(was.gems).length === 0) continue;
        lines.push(`${name} Unlocked`);
        levelledIds.push(id);
        continue;
      }
      // Every breakpoint reached since the last snapshot, not just the last:
      // a boss kill can carry a gem past two thresholds in one tick.
      const crossedLines = (snapshot?.skills?.find((s) => s.id === id)?.breakpoints ?? [])
        .slice(before.breakpoints);
      if (crossedLines.length > 0) {
        for (const text of crossedLines) lines.push(`${name}: ${text}`);
        levelledIds.push(id);
        crossed = true;
      } else if (now.level > before.level) {
        lines.push(`${name} Level ${now.level}`);
        levelledIds.push(id);
      }
    }
    // A steady-state tick (nothing levelled) must leave the flash alone: the
    // sim hands the HUD a fresh snapshot every ~33ms whether or not anything
    // changed, and clearing here killed the flash one tick after it lit.
    // The banner-dismissal effect below already owns turning it off.
    if (levelledIds.length > 0) setFlashing((prev) => new Set([...prev, ...levelledIds]));
    if (lines.length === 0) return;
    // A boss kill can pay both at once. Rule 3 says concentrate rather than spread,
    // so they share one banner and one sound instead of queueing two. A gem level
    // often lands a snapshot after the character level: it joins the banner still
    // up rather than replacing it, and the new seq restarts the dismissal.
    setBanner((prev) => ({
      text: [...(prev ? [prev.text] : []), ...lines].join("   ·   "),
      seq: (prev?.seq ?? 0) + 1,
    }));
    // A breakpoint or a character level rings the level-up cue; a bare gem level, "rare".
    playDropSound(crossed || level > was.level ? "level-up" : "rare");
  }, [level, stones, gems, snapshot?.skills, skillNames]);

  React.useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => { setBanner(null); setFlashing(new Set()); }, 2400);
    return () => clearTimeout(t);
  }, [banner]);

  // A refused pickup (inventory full) arrives as a changed `pickupRefusedTick`.
  // Its own state, not the reward banner: it is feedback, not a reward. `seq`
  // lets a second refusal restart the dismissal timer without a second element.
  const [inventoryFull, setInventoryFull] = React.useState<{ seq: number } | null>(null);
  const refusedTick = snapshot?.player.pickupRefusedTick;
  const hasSnapshot = snapshot !== null && snapshot !== undefined;
  const lastRefusedTick = React.useRef<{ tick: number | undefined } | null>(null);
  React.useEffect(() => {
    if (!hasSnapshot) return;
    const was = lastRefusedTick.current;
    lastRefusedTick.current = { tick: refusedTick };
    // The first snapshot is the baseline, so a reload never replays an old refusal.
    if (!was) return;
    if (refusedTick === undefined || refusedTick === was.tick) return;
    setInventoryFull((prev) => ({ seq: (prev?.seq ?? 0) + 1 }));
  }, [hasSnapshot, refusedTick]);

  React.useEffect(() => {
    if (!inventoryFull) return;
    const t = setTimeout(() => setInventoryFull(null), 1600);
    return () => clearTimeout(t);
  }, [inventoryFull]);

  /**
   * The experience rail runs BETWEEN the two panels, never under them: the
   * panels' stone is opaque to the floor, so a rail crossing behind it hid the
   * whole fill of a young character (14% of the screen is less than one panel).
   * PoE1's own rail starts past the flask assembly (poe1-lower-bar.png). The
   * panels are content-sized, so their widths are measured, not declared; they
   * only change with the viewport (vw units), so a resize listener covers it.
   */
  const flaskRowRef = React.useRef<HTMLDivElement>(null);
  const skillRowRef = React.useRef<HTMLDivElement>(null);
  const [railInset, setRailInset] = React.useState({ left: 0, right: 0 });
  React.useLayoutEffect(() => {
    const measure = () => setRailInset({
      left: flaskRowRef.current?.offsetWidth ?? 0,
      right: skillRowRef.current?.offsetWidth ?? 0,
    });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // Keyed on the HUD existing, not on mount: the first mount has no snapshot,
    // renders nothing, and a measure taken then reads both panels as 0.
  }, [snapshot == null]);

  // The hovered object's name stands over the object, the way PoE labels what is
  // under the cursor. Placed per frame by transform, like NpcLabels, because the
  // camera moves every frame and the snapshot lands at 30 Hz.
  const labelNode = React.useRef<HTMLDivElement | null>(null);
  const labelAt = React.useRef<{ x: number; y: number; h: number } | null>(null);
  const labelTarget = hoveredEntityId !== null
    ? snapshot?.entities.find((e) => e.id === hoveredEntityId)
    : undefined;
  labelAt.current = labelTarget && LABEL_HEIGHT[labelTarget.kind] !== undefined
    ? { x: labelTarget.x, y: labelTarget.y, h: LABEL_HEIGHT[labelTarget.kind]! }
    : null;
  React.useEffect(() => {
    if (!project) return;
    const place = () => {
      const node = labelNode.current;
      const at = labelAt.current;
      if (!node || !at) return;
      const p = project(at.x, at.y, at.h);
      node.style.visibility = p.visible ? "visible" : "hidden";
      if (!p.visible) return;
      // Anchored bottom-centre; held inside the viewport, as PoE pins a name at the screen edge.
      const w = node.offsetWidth, h = node.offsetHeight, m = 4;
      const x = Math.min(Math.max(p.x, w / 2 + m), window.innerWidth - w / 2 - m);
      const y = Math.min(Math.max(p.y, h + m), window.innerHeight - m);
      node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    };
    if (afterFrame) return afterFrame(place);
    let raf = 0;
    const tick = () => { place(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project, afterFrame]);

  if (!snapshot) return null;

  const { life, maxLife, mana, maxMana, cooldowns, energyShield, maxEnergyShield } = snapshot.player;
  // The life well holds both pools, so the waterline is still "how much is left
  // before you die" — which is what the globe is for. Without a shield the
  // denominator is maxLife and nothing moves.
  const wellMax = maxLife + maxEnergyShield;
  const lifePct = wellMax > 0 ? Math.max(0, Math.min(100, (life / wellMax) * 100)) : 0;
  const shieldPct = wellMax > 0 ? Math.max(0, Math.min(100 - lifePct, (energyShield / wellMax) * 100)) : 0;
  const manaPct = maxMana > 0 ? Math.max(0, Math.min(100, (mana / maxMana) * 100)) : 0;

  const { xp, xpToNext } = snapshot.player;

  // PoE2 raises the boss bar when you enter the arena, not the moment the map
  // loads: boss-ai's wake (range AND line of sight), so an arena wall hides it.
  const boss = snapshot.entities.find((e) => e.boss && e.bossAwake);

  // Hovered entity drives the name label — mouse proximity, not character proximity.
  // inRange (character distance) only drives the auto-interact fire; never shown.
  const hoveredEntity =
    hoveredEntityId !== null
      ? snapshot.entities.find(
          (e) => e.id === hoveredEntityId && (e.kind === "portal" || e.kind === "mapDevice" || e.kind === "stash" || e.kind === "vendor"),
        )
      : undefined;
  const hoverLabel = hoveredEntity
    ? hoveredEntity.kind === "stash"
      ? "Stash"
      : hoveredEntity.kind === "vendor"
      // A person, not a service. "Vendor" is a job title on a form.
      ? `${VENDOR_NAME}, ${VENDOR_TITLE}`
      : hoveredEntity.kind === "mapDevice"
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
            top: "0.6vw",
            left: "50%",
            transform: "translateX(-50%)",
            width: BOSS_BAR_W,
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.8))",
          }}
        >
          {/* The frame's window, measured off the art's alpha with 2px tucked under the rim. */}
          <div
            style={{
              position: "absolute",
              left: "9.688%",
              right: "9.688%",
              top: "41.441%",
              bottom: "30.18%",
              background: "#0b0d11",
            }}
          >
            <div
              data-testid="boss-fill"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${bossLifePct}%`,
                background: "linear-gradient(to bottom, #c4291f, #8a0f0c 55%, #4f0707)",
                transition: "width 120ms linear",
              }}
            />
            <div
              data-testid="boss-name"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#f2dcc0",
                fontFamily: DISPLAY,
                fontSize: "0.85vw",
                fontVariant: "small-caps",
                letterSpacing: "0.04em",
                textShadow: "0 1px 3px #000, 0 0 6px #000",
                whiteSpace: "nowrap",
              }}
            >
              {(boss.species && MONSTERS.get(boss.species)?.name) ?? ""}
            </div>
            <div
              data-testid="boss-phase"
              style={{
                position: "absolute",
                right: "1.2%",
                top: "50%",
                transform: "translateY(-50%)",
                color: "#f4f0e6",
                fontSize: "0.7vw",
                fontWeight: 700,
                letterSpacing: 1,
                textShadow: "0 1px 3px #000",
              }}
            >
              {boss.bossPhase === 2 ? "II" : "I"}
            </div>
          </div>
          <img src="/hud/boss-bar-frame-v1.webp" alt="" style={{ position: "relative", display: "block", width: "100%" }} />
        </div>
      )}
      <TargetFrame snapshot={snapshot} targetId={targetId} top={boss ? UNDER_BOSS_BAR : undefined} />

      {/* The reward banner: high, centred, over the fight rather than beside it, and
          gone in 2.4s. PoE announces a level with a sound first and text second, so
          the text here is only what the ear already heard. */}
      {banner && (
        <div
          data-testid="reward-banner"
          style={{
            position: "absolute",
            top: "16%",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: DISPLAY,
            fontSize: 30,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#f2d79a",
            textShadow: "0 0 18px rgba(201,168,76,0.55), 0 2px 6px #000",
          }}
        >
          {banner.text}
        </div>
      )}

      {/* Quieter than the reward banner on purpose: a refusal is feedback, not a
          reward, so it is smaller, lower and silent. */}
      {inventoryFull && (
        <div
          data-testid="inventory-full"
          style={{
            position: "absolute",
            top: "34%",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: DISPLAY,
            fontSize: 16,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "rgba(242,215,154,0.8)",
            textShadow: "0 1px 4px #000",
            pointerEvents: "none",
          }}
        >
          Inventory Full
        </div>
      )}

      {/* Stays up while saves are refused: a reload would lose everything since, and the
          player can only act on that (free storage, stop playing) if told. */}
      {snapshot.saveFailed && (
        <div
          data-testid="save-failed"
          role="alert"
          style={{
            position: "absolute",
            top: 20,
            left: 28,
            maxWidth: 320,
            color: "#e8743b",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.5,
            textShadow: "0 1px 4px #000",
            pointerEvents: "none",
          }}
        >
          Progress is not being saved. Browser storage is full or blocked.
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
        {snapshot.area === "hideout" ? "Hideout" : mapName ?? "Map"}
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

      {/* Hovered interactable name: over the object once the scene can project,
          else centred above the skill bar. */}
      {hoverLabel && (
        <div
          data-testid="interact-label"
          ref={labelNode}
          style={{
            position: "absolute",
            ...(project
              ? { left: 0, top: 0, visibility: "hidden" as const }
              : { bottom: 100, left: "50%", transform: "translateX(-50%)" }),
            pointerEvents: "none",
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
        shieldPct={shieldPct}
        fillTestId="life-orb-fill"
        readoutTestId="life-readout"
        art="/hud/orb-life-v2.webp"
        figure="/hud/orb-figure-life-v5.webp"
        label="Life"
        value={
          maxEnergyShield > 0
            ? `${Math.round(life)}/${Math.round(maxLife)} + ${Math.round(energyShield)}`
            : `${Math.round(life)}/${Math.round(maxLife)}`
        }
        side="left"
        numbers={orbNumbers}
      />
      <Orb
        pct={manaPct}
        fillTestId="mana-orb-fill"
        readoutTestId="mana-readout"
        art="/hud/orb-mana-v2.webp"
        figure="/hud/orb-figure-mana-v5.webp"
        label="Mana"
        value={`${Math.round(mana)}/${Math.round(maxMana)}`}
        side="right"
        numbers={orbNumbers}
      />

      <div data-testid="bar-connector" style={connectStyle} />

      <XpBar level={snapshot.player.level} xp={xp} xpToNext={xpToNext} left={railInset.left} right={railInset.right} />

      {/* The unspent-point count no longer rides a center chip; the plus on the
          lower bar (below, right of the flasks) carries it as a badge instead. */}

      {/* Flask bar — runs off the screen side and under the life globe, per poe1-lower-bar.png */}
      <div
        data-testid="flask-row"
        ref={flaskRowRef}
        style={{
          ...barStyle,
          left: 0,
          paddingLeft: BAR_PAD,
          zIndex: 2,
        }}
      >
        {FLASKS.map((f) => {
          const charges = f.kind === "life"
            ? snapshot.player.flasks.lifeCharges
            : snapshot.player.flasks.manaCharges;
          const max = f.kind === "life"
            ? snapshot.player.flasks.lifeMax
            : snapshot.player.flasks.manaMax;
          return <Flask key={f.kind} kind={f.kind} hotkey={keybinds[f.action].toUpperCase()} charges={charges} max={max} />;
        })}
      </div>

      {/* The passive tree's plus, PoE1's own affordance on the lower bar. It stands
          on the world just RIGHT of the flask frame, not inside it — his mark, and
          PoE1 also parks the tree button clear of the flask niches. It shows only
          while points wait, with the count as a badge; the keybind opens the tree
          the rest of the time. */}
      {(snapshot.player.passivePoints ?? 0) > 0 && (
      <button
        type="button"
        data-testid="passive-open-button"
        aria-label="Passive tree"
        onClick={() => onOpenPassives?.()}
        style={{
          position: "absolute",
          // Past the flask frame: globe padding + both border slices + two vials
          // and their gap, then a vial's width of clear stone before the button.
          left: `calc(${BAR_PAD_EXPR} + ${2 * BAR_SIDE}px + 2 * ${FLASK_W} + 0.25vw + ${FLASK_W})`,
          bottom: `calc((${BAR_H} - ${PLUS_W}) / 2)`,
          width: PLUS_W,
          height: PLUS_W,
          padding: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          pointerEvents: "auto",
          zIndex: 3,
        }}
      >
        <img
          src="/hud/passive-plus.webp"
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            filter: "drop-shadow(0 0 6px rgba(232,195,104,0.6)) drop-shadow(0 2px 4px rgba(0,0,0,0.8))",
          }}
        />
        <span
          data-testid="passive-open-count"
          style={{
            position: "absolute",
            top: "-18%",
            right: "-18%",
            minWidth: "1.5em",
            padding: "0 0.3em",
            fontFamily: SERIF,
            fontSize: `clamp(9px, ${(ORB_VW * 0.07).toFixed(2)}vw, 14px)`,
            lineHeight: 1.5,
            color: "#1a1408",
            background: "linear-gradient(180deg,#e8c368,#b98f36)",
            border: "1px solid #f4dfa0",
            borderRadius: "1em",
            boxShadow: "0 0 8px rgba(232,195,104,0.5)",
            textShadow: "none",
          }}
        >
          {snapshot.player.passivePoints}
        </span>
      </button>
      )}

      {/* Skill bar — two rows, as PoE1's lower bar has it: the three mouse buttons
          above, the five numbered slots below, the whole panel running under the
          mana globe the way the flask panel runs under the life globe. */}
      <div
        data-testid="skill-row"
        ref={skillRowRef}
        style={{
          ...barStyle,
          right: 0,
          paddingRight: BAR_PAD,
          zIndex: 2,
          // The HUD overlay is inert so clicks reach the world; the skill panel has
          // to opt back in or a real pointer never hits a tile and the tooltip only
          // ever appears for synthetic events.
          pointerEvents: "auto",
          // Same width as the inventory panel, which docks to the same corner: the
          // panel ran further left than the bar and the two left edges read as a
          // misalignment rather than as two pieces of the same furniture. What is
          // left after the globe's padding is what sizes the tiles.
          width: PANEL_W,
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          // barStyle's own gap spaces the flasks; here it would push the rail out of the
          // frame's inner height and flexbox would shrink the rail to pay for it.
          gap: 0,
        }}
      >
        {/* Portal and chest sit centred over slots 1 and 2, level with the mouse row; the row keeps the right. */}
        <div style={{ alignSelf: "stretch", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: `${SLOT_GAP}px` }}>
          <div style={{ width: SLOT, display: "flex", justifyContent: "center" }}>
            <BarIconButton testId="portal-button" art="/hud/portal.webp" label="Portal" hotkey={keybinds.portal} onClick={onPortal} />
          </div>
          <div data-testid="inventory-chest-cell" style={{ width: SLOT, display: "flex", justifyContent: "center" }}>
            <BarIconButton testId="inventory-open-button" art="/hud/inventory-chest.webp" label="Inventory" hotkey={inventoryKey} onClick={onToggleInventory} />
          </div>
        </div>
        {/* The mouse row closes on a warm hairline, drawn as a shadow so it costs no height. */}
        <div style={{ display: "flex", gap: `${SLOT_GAP}px`, boxShadow: "0 1px 0 rgba(101,81,49,0.85)" }}>
          {MOUSE_KEYS.map((_, i) => {
            const idx = MOUSE_SLOT_BASE + i;
            const fixed = controlMode === "mouse" && idx === MOUSE_SLOT_BASE;
            return (
              <SkillTile
                key={MOUSE_KEYS[i]}
                slot={socketFor(bar, idx, keybinds, skillNames)}
                n={idx + 1}
                cooldowns={cooldowns}
                onHover={setHoveredSkill}
                drag={fixed ? undefined : { index: idx, onDrop: swapSockets }}
                onAssignRequest={fixed ? undefined : () => setAssigning(idx)}
                flash={bar[idx] !== null && flashing.has(bar[idx]!)}
              />
            );
          })}
        </div>
        </div>
        {/* PoE1 recesses a rail between the two rows rather than leaving a gap: 18px of
            shadow on the reference, closed underneath by a brighter hairline that runs the
            frame's full inner width, which is what separates the rows without a border. */}
        <div
          data-testid="skill-rail"
          style={{
            alignSelf: "stretch",
            height: BAR_RAIL,
            boxSizing: "border-box",
            borderBottom: "1px solid #9b7751",
            background: "linear-gradient(180deg,#2a231c,#101013)",
          }}
        />
        <div style={{ display: "flex", gap: `${SLOT_GAP}px` }}>
          {bar.slice(0, MOUSE_SLOT_BASE).map((_, i) => (
            <SkillTile
              key={i}
              slot={socketFor(bar, i, keybinds, skillNames)}
              n={i + 1}
              cooldowns={cooldowns}
              onHover={setHoveredSkill}
              drag={{ index: i, onDrop: swapSockets }}
              onAssignRequest={() => setAssigning(i)}
              flash={bar[i] !== null && flashing.has(bar[i]!)}
            />
          ))}
        </div>
      </div>

      {/* Outside the skill row on purpose. barStyle puts a drop-shadow filter on that
          row, and a filter makes its own stacking context whatever the z-index says, so
          a tooltip nested inside it can never rise above the inventory panel it opens
          into. Out here it is a plain sibling and its own zIndex settles the order. */}
      <SkillTooltip skills={snapshot.skills} id={hoveredSkill} right={BAR_PAD} bottom={`calc(${BAR_H} + 8px)`} />
      {assigning !== null && (
        <SkillPicker
          skills={skillNames}
          details={snapshot.skills}
          bar={bar}
          keybinds={keybinds}
          current={bar[assigning] ?? null}
          onPick={(id) => assignSocket(assigning, id)}
          onClose={() => setAssigning(null)}
        />
      )}
    </div>
  );
}
