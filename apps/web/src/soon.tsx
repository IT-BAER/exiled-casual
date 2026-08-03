/**
 * The teaser page: the main menu's hall with nobody in it and nothing to click.
 *
 * Same painting, same two braziers, same embers as `MainMenu` — the menu's
 * Atmosphere stack, unchanged — with the panel, the buttons and the news taken
 * out and one word left standing in the middle of the flood. The trademark is
 * the joke: SOON™ is what Path of Exile players are told when they ask for a
 * date, so the ™ has to be visible enough to read and small enough to be a
 * footnote.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { Atmosphere } from "./menu/atmos";
import { BRAZIERS } from "./menu/braziers";

const MENU_ART = "/textures/ui/menu";
const DISPLAY = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const GOLD = "#c8a44d";

/**
 * The word is filled with an actual gilt-metal PLATE, clipped to the glyphs:
 * generated art (`assets/menu/gilt_metal_v1.png`, same pipeline as the rest of
 * the menu), tiled at a size where the hammer grain and the scratches read at
 * display size instead of blurring into a swatch. `color` stays gold under the
 * `-webkit-text-fill-color`, so a browser without background-clip:text gets a
 * plain gold word rather than an invisible one.
 */
const GILT: React.CSSProperties = {
  backgroundImage: `url(${MENU_ART}/gilt_metal.png)`,
  backgroundSize: "230px",
  backgroundPosition: "center",
  /* The tile that ships is the master pulled most of the way back toward flat
     gilt (see the note in tools/, and the master in assets/menu/): raw, its
     tarnish is deep enough to punch holes through a letter at this size. */
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: GOLD,
  WebkitTextFillColor: "transparent",
};

function Soon(): React.ReactElement {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Atmosphere backdrop={`${MENU_ART}/menu_backdrop.jpg`} braziers={BRAZIERS} />

      <img
        src={`${MENU_ART}/logo.png`}
        alt="Exiled Casual"
        style={{
          position: "absolute",
          top: "6vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(46vw, 760px)",
          filter: "drop-shadow(0 10px 34px rgba(0,0,0,0.85))",
          zIndex: 2,
        }}
      />

      {/* Sits below the middle: the painting's toppled head owns the centre, and
          the word reads as carved into the water line rather than pasted over
          the art. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "56%",
          transform: "translate(-50%, -50%)",
          zIndex: 2,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: "clamp(44px, 10vw, 168px)",
          letterSpacing: "0.14em",
          /* The letterspacing is applied to the right of every glyph, including
             the last, so the block hangs left of centre without this. */
          paddingLeft: "0.14em",
          whiteSpace: "nowrap",
          /* The glow has to be a filter rather than a text-shadow: the gilt
             below is a background clipped to the glyphs, and a shadow cast by
             transparent text is cast by nothing. */
          filter: "drop-shadow(0 0 38px rgba(217,118,47,0.40)) drop-shadow(0 8px 26px rgba(0,0,0,0.9))",
        }}
      >
        <span style={{ position: "relative", display: "inline-block", ...GILT }}>
          SOON
          {/* Absolutely placed, not a <sup>: superscript aligns to the baseline
              through the font's own metrics, and Cinzel is an all-caps face
              whose ascender sits well above its cap height, so the mark floated
              off the top of the S. This pins it to the cap line instead. */}
          <span
            style={{
              position: "absolute",
              /* In the mark's OWN em, which is a quarter of the word's: the
                 offset that lands it on the cap line is therefore about 1em,
                 not the 0.16 that reads right for the number it looks like. */
              top: "1em",
              right: "-0.10em",
              fontSize: "0.24em",
              letterSpacing: 0,
              lineHeight: 1,
              /* Its own colour back: `-webkit-text-fill-color` inherits, and the
                 gilt background is clipped to the parent's box, not to this
                 out-of-flow one — so left alone the mark is transparent text
                 over nothing at all. */
              WebkitTextFillColor: GOLD,
            }}
          >
            ™
          </span>
        </span>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Soon />);
