/**
 * The furniture every menu screen is built out of: the plate a button is
 * painted on, the ornate frame a panel wears, the rule between sections.
 *
 * All three are generated art (`assets/menu/`, built by
 * `tools/build_menu_textures.py`), because hand-authored SVG cannot get near
 * the look and the gap is visible at a glance. The art is deliberately EMPTY —
 * no baked text, no baked portrait — so one plate serves every button and one
 * frame serves every panel, at any size, in one download.
 *
 * Hover and pressed states are CSS filters over the same plate rather than
 * separate renders. Two generations of the same object are never quite the same
 * object, and a button that changes shape under the pointer reads as a glitch.
 */
import React from "react";

export const MENU_ART = "/textures/ui/menu";

/** Matches the HUD, so a menu button and an inventory header are the same voice. */
export const SERIF = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
export const GOLD = "#c8a44d";
export const GOLD_DIM = "#7a5c22";
export const PARCHMENT = "#e8dcc0";
export const EMBER = "#d9762f";

/**
 * Nine-slice inset of `panel_frame.png`, in source pixels, MEASURED off the
 * alpha channel by `tools/build_menu_textures.py` — not guessed from the brief.
 * The corner ornament ends here; past it the edge is a repeating rail. Get this
 * wrong and the corners stretch, which is the single most obvious way a frame
 * looks fake.
 */
export const FRAME_SLICE = "44 45 44 45";
/** Drawn at half the source inset, so the frame reads crisp rather than chunky. */
export const FRAME_BORDER = 22;

/**
 * How much of the gilt a dialog's frame keeps. The art is painted at full
 * brightness so a *frame* render can be judged on its own, but a window is not
 * the thing the player came to read: at 1.0 the border out-shouted the rows
 * inside it. The knob is here rather than in the PNG because prominence is a
 * taste that gets retuned, and a baked-in dimming cannot be turned back up.
 */
export const FRAME_DIM = "brightness(0.68) saturate(0.85)";

/**
 * A panel wearing the ornate frame, with a dark fill inside it.
 *
 * The frame is drawn TWICE over: once as this element's own transparent border,
 * which is what reserves the space and keeps the padding box honest, and once as
 * an inert overlay carrying the art at `FRAME_DIM`. A filter cannot be aimed at
 * a border alone — put it on the element and it dims every row inside as well —
 * so the border and the thing that dims it have to be two boxes.
 */
export function FramedPanel({
  children,
  style,
  fill = "linear-gradient(180deg, rgba(10,11,13,0.94), rgba(6,7,9,0.97))",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { fill?: string }): React.ReactElement {
  return (
    <div
      {...rest}
      style={{
        position: "relative",
        borderStyle: "solid",
        borderWidth: FRAME_BORDER,
        borderColor: "transparent",
        // Without this the fill paints under the frame's transparent gaps and
        // the ornament sits on a solid block instead of on the scene.
        backgroundClip: "padding-box",
        background: fill,
        boxShadow: "0 14px 46px rgba(0,0,0,0.62)",
        ...style,
      }}
    >
      <div
        aria-hidden
        data-testid="frame-gilt"
        style={{
          position: "absolute",
          // Absolute insets are measured from the padding box, so backing out by
          // the border width is what makes this overlay the border box exactly.
          inset: -FRAME_BORDER,
          pointerEvents: "none",
          borderStyle: "solid",
          borderWidth: FRAME_BORDER,
          borderImageSource: `url(${MENU_ART}/panel_frame.png)`,
          borderImageSlice: FRAME_SLICE,
          borderImageRepeat: "round",
          filter: FRAME_DIM,
        }}
      />
      {children}
    </div>
  );
}

export type ButtonTone = "normal" | "primary" | "danger";

const TONE_TEXT: Record<ButtonTone, string> = {
  normal: PARCHMENT,
  primary: "#f6e6bd",
  danger: "#e8b7a2",
};

/**
 * One menu button.
 *
 * `disabled` is a real disabled attribute rather than a click that quietly does
 * nothing, and it keeps its `title`: every disabled control in these screens is
 * disabled for a reason the player is owed (no character yet, roster full,
 * online not built), and a dead button with no explanation is worse than no
 * button.
 */
export function MenuButton({
  children,
  tone = "normal",
  height = 44,
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  height?: number;
}): React.ReactElement {
  const [hover, setHover] = React.useState(false);
  const [down, setDown] = React.useState(false);
  const off = rest.disabled === true;
  return (
    <button
      type="button"
      {...rest}
      onMouseEnter={(e) => { setHover(true); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); setDown(false); rest.onMouseLeave?.(e); }}
      onMouseDown={(e) => { setDown(true); rest.onMouseDown?.(e); }}
      onMouseUp={(e) => { setDown(false); rest.onMouseUp?.(e); }}
      style={{
        appearance: "none",
        border: "none",
        padding: 0,
        height,
        minWidth: 180,
        backgroundColor: "transparent",
        backgroundImage: `url(${MENU_ART}/button_plate.png)`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        fontFamily: SERIF,
        fontSize: Math.round(height * 0.34),
        letterSpacing: 2.5,
        textTransform: "uppercase",
        color: off ? "#8a8378" : TONE_TEXT[tone],
        textShadow: off ? "none" : "0 1px 2px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.7)",
        // The plate itself carries the state. Brightness on the art, not a new colour
        // on top of it, is what keeps the gilt reading as gilt.
        filter: off
          ? "grayscale(0.65) brightness(0.5)"
          : down
            ? "brightness(0.82)"
            : hover
              ? "brightness(1.35) saturate(1.12)"
              : "none",
        transform: down && !off ? "translateY(1px)" : "none",
        transition: "filter 90ms linear",
        opacity: off ? 0.85 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** A filigree rule. Falls back to a gilt hairline until the art is generated. */
export function Divider({ style }: { style?: React.CSSProperties }): React.ReactElement {
  return (
    <div
      aria-hidden
      style={{
        height: 10,
        backgroundImage: `url(${MENU_ART}/divider.png), linear-gradient(90deg, transparent, ${GOLD_DIM}, transparent)`,
        backgroundSize: "100% 100%, 100% 1px",
        backgroundPosition: "center, center",
        backgroundRepeat: "no-repeat, no-repeat",
        opacity: 0.85,
        ...style,
      }}
    />
  );
}

/** Small caps label in the panel voice — the "GATEWAY" / "FILTER CHARACTERS" tone. */
export function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): React.ReactElement {
  return (
    <span
      style={{
        fontFamily: SERIF,
        fontSize: 11,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: GOLD_DIM,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
