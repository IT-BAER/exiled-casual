/**
 * The plate the game hides its waits behind.
 *
 * Layout is the owner's own sketch and is the contract: a full-bleed wallpaper,
 * a rule near the foot, then a band carrying the tip on the left, the animation
 * in the middle and the area's name on the right.
 *
 * `docs/09-reward-psychology.md` rule 8 governs everything else about it —
 * latency is a dopamine tax, so this component never decides WHEN to go away.
 * It renders while it is mounted and its owner unmounts it on a real readiness
 * signal. There is no timer in this file, and adding one is the regression.
 *
 * The furniture is the game's own, not a second invention: the band is the
 * bottom bar's carved stone (`/hud/bar-panel-v3.png`), the rule is the warm
 * hairline the skill rows are split by, and the type is the HUD serif.
 */
import React from "react";
import { DISPLAY, SERIF } from "./hud/ItemTooltip";
import { GOLD, PARCHMENT } from "./menu/frames";

/** Where a biome's plate lives. Built by `tools/build_loading_textures.py`. */
export const LOADING_ART = "/textures/loading";

/**
 * The band's height. A fraction of the VIEWPORT, not of the bar: this screen is
 * not the HUD and has no globe to hold a proportion against. Clamped because a
 * tip has to stay readable on a laptop and must not become a wall on a 4K panel.
 */
const BAND_H = "clamp(76px, 12vh, 136px)";

/**
 * How long the plate takes to dissolve off the finished world, and how long its
 * owner must therefore keep it mounted past ready. Exported so the two cannot
 * drift: a fade longer than the mount is a plate that vanishes mid-dissolve.
 */
export const FADE_MS = 260;

export interface LoadingScreenProps {
  /** Printed on the right. The place being entered, already resolved to a name. */
  areaName: string;
  /** Printed on the left. One line, picked by the caller so a re-render cannot reshuffle it. */
  tip: string;
  /**
   * The game behind it is ready and the plate is dissolving off it.
   *
   * This is still not the plate deciding to go: the owner sets it on the same
   * signal it would have unmounted on, and unmounts `FADE_MS` later. The plate
   * has no clock of its own either way.
   */
  leaving?: boolean;
  /**
   * Plate to show behind it. Absent (or a file that 404s) falls back to the dark
   * ground the band sits on, which is a plain screen rather than a broken one —
   * the case that matters is a biome shipped before its wallpaper was rendered.
   */
  wallpaper?: string;
}

export function LoadingScreen({ areaName, tip, wallpaper, leaving }: LoadingScreenProps): React.ReactElement {
  const [artFailed, setArtFailed] = React.useState(false);
  return (
    <div
      data-testid="loading-screen"
      data-leaving={leaving ? "" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        // Over the canvas, the HUD and every pane. The whole point is that
        // nothing behind it is worth looking at yet.
        zIndex: 100,
        background: "#07080a",
        display: "flex",
        flexDirection: "column",
        // It covers a scene the player cannot act on, so it eats input too.
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {wallpaper && !artFailed && (
          <img
            data-testid="loading-wallpaper"
            src={wallpaper}
            alt=""
            onError={() => setArtFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }}
          />
        )}
        {/* PoE's loading plates are painted, then darkened at the corners so the
            eye lands in the middle and the band reads. A rendered vignette, not
            a CSS radial: the falloff is uneven on purpose, heavier in the upper
            corners, which a symmetric gradient cannot be. */}
        <img
          data-testid="loading-vignette"
          src="/textures/ui/menu/loading_vignette.png"
          alt=""
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
        {/* The art is authored with a calm lower fifth, but a painting is not a
            guarantee: this seats the rule on darkness whatever the plate does. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, transparent 62%, rgba(5,6,8,0.75) 100%)",
          }}
        />
      </div>

      {/* The rule, in the bottom bar's own pairing: a warm hairline closed
          underneath by a dark one, which is what reads as carved rather than drawn. */}
      <div
        aria-hidden
        style={{ height: 2, background: "linear-gradient(180deg, #9b7751 0 1px, #0a0b0d 1px 2px)" }}
      />

      <div
        data-testid="loading-band"
        style={{
          position: "relative",
          height: BAND_H,
          display: "flex",
          alignItems: "center",
          padding: "0 clamp(20px, 3vw, 64px)",
          boxSizing: "border-box",
          // Same stone as the bottom bar, but sliced the other way round from the
          // HUD's connector: that one drops the side slices because its gilt
          // corners belong to the panels it runs between. This band runs between
          // nothing, so it keeps them and ends in a corner. Dropping them here
          // stretched the ornaments across the full width instead, which at this
          // band's height reads as a smear rather than as carving.
          borderStyle: "solid",
          borderWidth: "0.74vw 78px 0.27vw 78px",
          borderImageSource: "url(/hud/bar-panel-v3.png)",
          borderImageSlice: "26 78 44 78 fill",
        }}
      >
        <div
          data-testid="loading-tip"
          style={{
            flex: 1,
            minWidth: 0,
            // A tip is a sentence, so it gets the reading face rather than the
            // carved one, a size up from where the capitals sat.
            fontFamily: SERIF,
            fontSize: "clamp(12px, 0.95vw, 19px)",
            lineHeight: 1.45,
            letterSpacing: 0.4,
            color: PARCHMENT,
            opacity: 0.72,
            textShadow: "0 1px 3px #000",
            paddingRight: "2vw",
          }}
        >
          {tip}
        </div>

        <Spinner />

        <div
          data-testid="loading-area-name"
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "right",
            fontFamily: DISPLAY,
            fontSize: "clamp(14px, 1.15vw, 24px)",
            letterSpacing: 3,
            textTransform: "uppercase",
            color: GOLD,
            textShadow: "0 1px 4px #000, 0 0 14px rgba(0,0,0,0.8)",
            paddingLeft: "2vw",
          }}
        >
          {areaName}
        </div>
      </div>
    </div>
  );
}

/**
 * The ring, as a pre-rendered sprite sheet.
 *
 * 48 frames of a gilt ring with an ember travelling round it, built by
 * `tools/build_loading_spinner.py` (Blender 5.2, Cycles) into an 8x6 grid.
 * The ember carries a real point light, so the metal it passes actually lights
 * up — the one thing a CSS ring cannot do, and the reason this is rendered.
 *
 * Walked by TWO stepped animations rather than one, because the sheet is a grid
 * and not a strip: x steps 8 times per turn, y steps 6 times across 8 turns of
 * x. A 48-frame strip would be 6144px wide, which is past the safe texture
 * width on some mobile GPUs.
 *
 * Both are CSS keyframes on `background-position`, deliberately. `buildLevel`
 * is synchronous, so the main thread is blocked for exactly the stretch the
 * player is most likely to be watching this; a `requestAnimationFrame` loop
 * would freeze there and a frozen spinner reads as a hung game.
 */
const FRAME_COLS = 8;
const FRAME_ROWS = 6;
/** One turn of the ring. 48 frames at 60fps would be 0.8s; this is a shade statelier. */
const SPIN_SEC = 1.05;

/**
 * Where the last frame of an axis sits, as a `background-position` percentage.
 *
 * This is the trap in every percentage sprite sheet and it is worth the four
 * lines. `background-position: p%` does NOT offset the image by p% of its own
 * width — it aligns the p% point OF THE IMAGE with the p% point OF THE BOX. So
 * across a sheet `n` cells wide, cell `i` lands at `i / (n - 1)`, not at `i / n`:
 * the last cell is at 100%, the first at 0%, and there are only `n - 1` gaps
 * between them.
 *
 * `steps(n)` over `0 → end` yields `k * end / n` for k in 0..n-1, so `end` has
 * to be `n / (n - 1) * 100` for those to land on the cells. Use a plain 100%
 * with `steps(8)` — which is what every sprite-sheet snippet on the web does —
 * and every frame after the first is a sliver of two cells at once.
 */
export const axisEnd = (cells: number): number => (cells / (cells - 1)) * 100;

function Spinner(): React.ReactElement {
  const size = "clamp(34px, 3.2vw, 58px)";
  return (
    <div
      data-testid="loading-spinner"
      aria-label="Loading"
      role="img"
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        backgroundImage: `url(${LOADING_ART}/spinner.png)`,
        // The sheet is scaled so ONE cell fills the box.
        backgroundSize: `${FRAME_COLS * 100}% ${FRAME_ROWS * 100}%`,
        backgroundRepeat: "no-repeat",
        animation: `exiled-spin-x ${SPIN_SEC}s steps(${FRAME_COLS}) infinite,`
          + ` exiled-spin-y ${SPIN_SEC * FRAME_ROWS}s steps(${FRAME_ROWS}) infinite`,
      }}
    >
      <style>
        {`@keyframes exiled-spin-x{from{background-position-x:0%}to{background-position-x:${axisEnd(FRAME_COLS)}%}}`
          + `@keyframes exiled-spin-y{from{background-position-y:0%}to{background-position-y:${axisEnd(FRAME_ROWS)}%}}`}
      </style>
    </div>
  );
}
