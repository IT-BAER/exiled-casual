import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { MAP_PORTALS } from "@exiled/protocol";
import { SERIF } from "./ItemTooltip";
import { PANEL_W } from "./layout";
import { SkillTooltip } from "./SkillTooltip";
import { playDropSound } from "../audio/drop-sound";

// Bottom HUD geometry, measured off poe2-screenshots/poe1-lower-bar.png, a 2558x388 crop
// of Path of Exile **1**'s bottom bar (PoE1, not PoE2 — its globes are bigger and its ring
// far thinner than the PoE2 orbs we started from). Measured there: the liquid sphere is
// 263px across = 10.3% of the screen width; the braided ring is a 19px band = 7.2% of the
// sphere; the sphere's outer edge stops ~10px from the screen side and its bottom ~2% of
// the screen height above the bottom edge; a bronze figure leans on the outer side.
// The globe is a fraction of the screen, not a pixel size — PoE1 scales it with the
// resolution, and at 2048px wide a fixed 160px globe reads a quarter too small.
const BOSS_ENGAGE_RANGE = 10; // world units; boss bar appears once you are this close
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
// The border-image's own side slice. Named because the padding below has to
// subtract exactly it, or the first slot drifts out from under the ring.
// Content clears the globe by padding, not by offsetting the whole bar: that way the art
// keeps running behind the ring. BAR_SIDE is the border-image's own side slice, which
// already sits between the bar's edge and its first slot.
const BAR_PAD = `calc(${BAR_PAD_EXPR})`;

// Five skill slots on keys 1-5, then the three mouse buttons, as PoE1's bar does:
// left, middle and right click each hold a skill of their own. Only three skills
// exist, the rest render as empty sockets.
// PoE2 itself puts skills on QWERT and flasks on the digits — we swap the two, so
// the movement hand keeps the flasks. Deliberate, not a parity miss.
type SkillSlot = { id: string | null; key: string; mouse?: boolean; icon?: string; glow?: string };
const SKILL_SLOTS: SkillSlot[] = [
  { id: "skill.ember_bolt.v1", key: "1", icon: "/textures/skills/ember_bolt.png", glow: "#ff7a2f" },
  { id: "skill.cinder_ground.v1", key: "2", icon: "/textures/skills/cinder_ground.png", glow: "#e0492b" },
  { id: "skill.blink.v1", key: "3", icon: "/textures/skills/blink.png", glow: "#3fb6ff" },
  { id: null, key: "4" },
  { id: null, key: "5" },
  { id: null, key: "L", mouse: true },
  { id: null, key: "M", mouse: true },
  { id: null, key: "R", mouse: true },
];

/**
 * One skill tile. Extracted because the bar is two rows now, as PoE1's is
 * (poe2-screenshots/poe1-lower-bar.png): the mouse buttons sit in their own row
 * above the numbered slots, and both rows draw the same tile.
 */
function SkillTile({ slot, n, cooldowns, onHover }: {
  slot: SkillSlot;
  n: number;
  cooldowns: Record<string, number>;
  onHover: (id: string | null) => void;
}) {
  const cd = slot.id ? cooldowns[slot.id] ?? 0 : 0;
  const ready = cd <= 0;
  return (
    <div
      data-testid={`skill-slot-${n}`}
      onMouseEnter={() => onHover(slot.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        width: SLOT,
        height: SLOT,
        position: "relative",
        overflow: "hidden",
        background: slot.icon
          ? "radial-gradient(circle at 50% 35%, #262c34, #0b0d11)"
          : "radial-gradient(circle at 50% 35%, #14171d, #07090c)",
        border: `1px solid ${slot.icon && ready ? "#6b5a34" : "#2b3038"}`,
        borderRadius: 2,
        boxShadow: slot.icon && ready
          ? `0 0 6px ${slot.glow}33, inset 0 0 10px rgba(0,0,0,0.75)`
          : "inset 0 0 10px rgba(0,0,0,0.85)",
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
          color: slot.mouse ? "#d9b04a" : "#c9cdd3",
          textShadow: "0 1px 3px #000",
        }}
      >
        {slot.key}
      </span>
    </div>
  );
}

// One life flask on Q, one mana flask on E.
const FLASKS = [
  { kind: "life", key: "Q" },
  { kind: "mana", key: "E" },
] as const;

/** A single flask: recessed PoE2 socket holding the painted vial, hotkey at its foot. */
function Flask(props: { kind: "life" | "mana"; hotkey: string; charges: number; max: number }) {
  const { kind, hotkey, charges, max } = props;
  const veilPct = max > 0 ? 100 - (charges / max) * 100 : 100;
  return (
    <div
      data-testid={`flask-${kind}`}
      style={{
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
        src={`/textures/ui/flask_${kind}.png`}
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
  gap: "0.25vw",
  borderStyle: "solid",
  borderWidth: `${BAR_TOP} ${BAR_SIDE}px ${BAR_BOTTOM} ${BAR_SIDE}px`,
  // bar-panel-v3.png, 1024x185: v2 with its top 24 rows of merlons cut off. The
  // battlement squeezed into a 14px border read as a dashed checkerboard against the
  // world; PoE1's panel tops out in a plain stepped cornice over its gold rail, which
  // is what is left underneath. Both ends still close in the art, inside the 78px side
  // slice, rather than in a CSS fade.
  borderImageSource: "url(/hud/bar-panel-v3.png)",
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
}) {
  const { pct, shieldPct = 0, fillTestId, readoutTestId, art, figure, label, value, side } = props;
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
            backgroundImage: `linear-gradient(to top, rgba(102,102,102,1), rgba(0,0,0,1) 55%), url(${art})`,
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
        src="/hud/orb-ring-v6.png"
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
      <div
        data-testid={readoutTestId}
        style={{
          position: "absolute",
          // The label sits just off the ring rather than floating clear of it.
          // PoE1's own bar (poe1-lower-bar.png) leaves about 0.26 of a globe
          // diameter of air there, which reads as detached at this scale.
          bottom: `${(ORB_VW + RING_VW + ORB_VW * 0.04).toFixed(2)}vw`,
          left: `${(-RING_VW).toFixed(3)}vw`,
          right: `${(-RING_VW).toFixed(3)}vw`,
          display: "flex",
          justifyContent: "center",
          gap: "0.75vw",
          fontFamily: SERIF,
          fontSize: `clamp(13px, ${(ORB_VW * 0.099).toFixed(2)}vw, 26px)`,
          letterSpacing: 0.5,
          whiteSpace: "nowrap",
          textShadow: "0 1px 4px #000",
        }}
      >
        <span style={{ color: "#a9a49a" }}>{label}</span>
        <span style={{ color: "#f4f0e6" }}>{value}</span>
      </div>
    </div>
  );
}

export function Hud({ snapshot, hoveredEntityId = null }: HudProps) {
  const [hoveredSkill, setHoveredSkill] = React.useState<string | null>(null);

  // docs/09 rule 1: a reward the player cannot hear and see did not happen. Two
  // guaranteed payouts used to land in total silence — the level the fixed track
  // pays on a dry session (rule 7), and the stones a cleared map hands back, which
  // is rule 4's whole "the map must not be able to pay zero" moment. Both were only
  // discoverable later, by reading a number in a panel.
  const [banner, setBanner] = React.useState<string | null>(null);
  const level = snapshot?.player.level ?? null;
  const stones = snapshot?.waystones.length ?? null;
  const last = React.useRef<{ level: number; stones: number } | null>(null);
  React.useEffect(() => {
    if (level === null || stones === null) return;
    const was = last.current;
    last.current = { level, stones };
    // The first snapshot is the baseline, not a win; a reload would otherwise
    // congratulate the player on the level they already had.
    if (!was) return;
    const won = stones - was.stones;
    const lines = [
      ...(level > was.level ? [`Level ${level}`] : []),
      // Spending a stone on a map is not a payout, so only a rise counts.
      ...(won > 0 ? [`Waystone${won > 1 ? ` x${won}` : ""}`] : []),
    ];
    if (lines.length === 0) return;
    // A boss kill can pay both at once. Rule 3 says concentrate rather than spread,
    // so they share one banner and one sound instead of queueing two.
    setBanner(lines.join("   ·   "));
    playDropSound(level > was.level ? "unique" : "rare");
    const t = setTimeout(() => setBanner(null), 2400);
    return () => clearTimeout(t);
  }, [level, stones]);

  if (!snapshot) return null;

  const { life, maxLife, mana, maxMana, cooldowns, energyShield, maxEnergyShield } = snapshot.player;
  // The life well holds both pools, so the waterline is still "how much is left
  // before you die" — which is what the globe is for. Without a shield the
  // denominator is maxLife and nothing moves.
  const wellMax = maxLife + maxEnergyShield;
  const lifePct = wellMax > 0 ? Math.max(0, Math.min(100, (life / wellMax) * 100)) : 0;
  const shieldPct = wellMax > 0 ? Math.max(0, Math.min(100 - lifePct, (energyShield / wellMax) * 100)) : 0;
  const manaPct = maxMana > 0 ? Math.max(0, Math.min(100, (mana / maxMana) * 100)) : 0;

  // A capped character has nothing left to earn, so its bar reads full rather than empty.
  const { xp, xpToNext } = snapshot.player;
  const xpPct = xpToNext > 0 ? Math.max(0, Math.min(100, (xp / xpToNext) * 100)) : 100;

  // PoE2 raises the boss bar when you enter the arena, not the moment the map
  // loads. The sim has no aggro state to read, so proximity stands in for it:
  // the boss room's half-extent (mapgen carves it 20 cells across), which is
  // also one unit outside the Warden's slam range — inside it, you are in the fight.
  const bossEntity = snapshot.entities.find((e) => e.boss);
  const boss =
    bossEntity && Math.hypot(bossEntity.x - snapshot.player.x, bossEntity.y - snapshot.player.y) <= BOSS_ENGAGE_RANGE
      ? bossEntity
      : undefined;

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
      ? "Vendor"
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
            fontFamily: SERIF,
            fontSize: 30,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#f2d79a",
            textShadow: "0 0 18px rgba(201,168,76,0.55), 0 2px 6px #000",
          }}
        >
          {banner}
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
        shieldPct={shieldPct}
        fillTestId="life-orb-fill"
        readoutTestId="life-readout"
        art="/hud/orb-life-v2.png"
        figure="/hud/orb-figure-life-v5.png"
        label="Life"
        value={
          maxEnergyShield > 0
            ? `${Math.round(life)}/${Math.round(maxLife)} + ${Math.round(energyShield)}`
            : `${Math.round(life)}/${Math.round(maxLife)}`
        }
        side="left"
      />
      <Orb
        pct={manaPct}
        fillTestId="mana-orb-fill"
        readoutTestId="mana-readout"
        art="/hud/orb-mana-v2.png"
        figure="/hud/orb-figure-mana-v5.png"
        label="Mana"
        value={`${Math.round(mana)}/${Math.round(maxMana)}`}
        side="right"
      />

      {/* Experience — a thin trough across the very bottom edge, which is where both
          PoE games put it: it is the one bar you are never meant to look at directly,
          only to notice out of the corner of your eye. Drawn above the two panels so
          it runs unbroken from side to side, with the level printed in the gap between
          them (PoE1 hides the number in a tooltip; we have no tooltip layer here). */}
      <div
        data-testid="xp-level"
        style={{
          position: "absolute",
          bottom: 10,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: SERIF,
          fontSize: 12,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "#b6ab93",
          textShadow: "0 1px 4px #000",
          whiteSpace: "nowrap",
          zIndex: 5,
        }}
      >
        {`Level ${snapshot.player.level}`}
        <span style={{ color: "#6f6757", marginLeft: 8 }}>{`${xpPct.toFixed(1)}%`}</span>
      </div>
      <div
        data-testid="xp-bar"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 5,
          background: "linear-gradient(180deg,#0a0805,#16110a)",
          borderTop: "1px solid #2b2216",
          zIndex: 5,
        }}
      >
        <div
          data-testid="xp-bar-fill"
          style={{
            height: "100%",
            width: `${xpPct}%`,
            background: "linear-gradient(180deg,#e8d18a,#9a7326)",
            boxShadow: "0 0 8px rgba(220,180,90,0.45)",
            transition: "width 200ms linear",
          }}
        />
      </div>

      {/* Flask bar — runs off the screen side and under the life globe, per poe1-lower-bar.png */}
      <div
        data-testid="flask-row"
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
          return <Flask key={f.key} kind={f.kind} hotkey={f.key} charges={charges} max={max} />;
        })}
      </div>

      {/* Skill bar — two rows, as PoE1's lower bar has it: the three mouse buttons
          above, the five numbered slots below, the whole panel running under the
          mana globe the way the flask panel runs under the life globe. */}
      <div
        data-testid="skill-row"
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
        {/* The mouse row closes on a warm hairline, drawn as a shadow so it costs no height. */}
        <div style={{ display: "flex", gap: `${SLOT_GAP}px`, boxShadow: "0 1px 0 rgba(101,81,49,0.85)" }}>
          {SKILL_SLOTS.slice(5).map((slot, i) => (
            <SkillTile key={slot.key} slot={slot} n={i + 6} cooldowns={cooldowns} onHover={setHoveredSkill} />
          ))}
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
          {SKILL_SLOTS.slice(0, 5).map((slot, i) => (
            <SkillTile key={slot.key} slot={slot} n={i + 1} cooldowns={cooldowns} onHover={setHoveredSkill} />
          ))}
        </div>
      </div>

      {/* Outside the skill row on purpose. barStyle puts a drop-shadow filter on that
          row, and a filter makes its own stacking context whatever the z-index says, so
          a tooltip nested inside it can never rise above the inventory panel it opens
          into. Out here it is a plain sibling and its own zIndex settles the order. */}
      <SkillTooltip skills={snapshot.skills} id={hoveredSkill} right={BAR_PAD} bottom={`calc(${BAR_H} + 8px)`} />
    </div>
  );
}
