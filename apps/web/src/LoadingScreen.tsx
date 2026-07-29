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
import { SERIF } from "./hud/ItemTooltip";
import { GOLD, PARCHMENT } from "./menu/frames";

/** Where a biome's plate lives. Built by `tools/build_loading_textures.py`. */
export const LOADING_ART = "/textures/loading";

/**
 * The band's height. A fraction of the VIEWPORT, not of the bar: this screen is
 * not the HUD and has no globe to hold a proportion against. Clamped because a
 * tip has to stay readable on a laptop and must not become a wall on a 4K panel.
 */
const BAND_H = "clamp(76px, 12vh, 136px)";

export interface LoadingScreenProps {
  /** Printed on the right. The place being entered, already resolved to a name. */
  areaName: string;
  /** Printed on the left. One line, picked by the caller so a re-render cannot reshuffle it. */
  tip: string;
  /**
   * Plate to show behind it. Absent (or a file that 404s) falls back to the dark
   * ground the band sits on, which is a plain screen rather than a broken one —
   * the case that matters is a biome shipped before its wallpaper was rendered.
   */
  wallpaper?: string;
}

export function LoadingScreen({ areaName, tip, wallpaper }: LoadingScreenProps): React.ReactElement {
  const [artFailed, setArtFailed] = React.useState(false);
  return (
    <div
      data-testid="loading-screen"
      style={{
        position: "absolute",
        inset: 0,
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
            fontFamily: SERIF,
            fontSize: "clamp(11px, 0.85vw, 17px)",
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
            fontFamily: SERIF,
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
 * PLACEHOLDER. The shipped animation is a pre-rendered frame sequence
 * (`tools/build_loading_spinner.py`, Blender) played by `steps()` on
 * `background-position`, for one reason worth keeping: `buildLevel` is
 * synchronous, so anything driven by `requestAnimationFrame` freezes exactly
 * when the player is most likely to be watching it. A CSS keyframe animation on
 * a composited property keeps turning through a blocked main thread; a JS one
 * does not.
 *
 * This ring holds the position and the size until that sheet exists.
 */
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
        borderRadius: "50%",
        border: "2px solid rgba(200,164,77,0.18)",
        borderTopColor: GOLD,
        animation: "exiled-spin 1.05s linear infinite",
      }}
    >
      <style>{"@keyframes exiled-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
