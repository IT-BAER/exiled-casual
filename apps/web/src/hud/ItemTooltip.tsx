import React from "react";
import type { ItemStatLine } from "@exiled/protocol";

// PoE2 item tooltip. Matched to reference-screenshots/item-{normal,magic,rare,unique}.png:
// near-black panel, centered small-caps serif, a rarity-framed header band with
// inward flourishes, an item-class line, then affix lines in augmented-blue.
// All four rarities roll today; the sim still does not model weapon base stats or
// requirements beyond what the base carries, so those rows are absent when unknown.
/**
 * The display face: titles, labels, numbers, everything short.
 *
 * Cinzel is a Trajan, which is the letter PoE's own furniture is carved in. It
 * is shipped with the client (`/fonts`, declared in index.html) rather than
 * merely named, which it was until now — the fallback everyone actually saw was
 * Georgia.
 */
/**
 * The reading face: everything that is a word rather than a title.
 *
 * Cinzel, which used to be this, is a Trajan — a capitals-only alphabet
 * whose "lower case" is small capitals. Set a sentence in it and the
 * sentence comes out shouting, which is what every panel here was doing.
 * It is still the face of every title; see DISPLAY.
 */
export const SERIF = '"EB Garamond", Georgia, "Times New Roman", serif';
/** The carved face, for titles, labels and anything already uppercase. */
export const DISPLAY = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';

const AFFIX_BLUE = "#8f97ff";
const CLASS_TAN = "#8a8065";
const LABEL_GREY = "#7b7b74"; // stat/requirement words
const VALUE_LIGHT = "#d2d2c8"; // stat/requirement numbers
const UNID_RED = "#d02020"; // the unread marker

// `band` is a painted header frame (assets/menu -> build_menu_textures.py),
// drawn as a nine-slice: `cap` is where the ornate end-cap ends and the
// repeatable middle begins, in source pixels of the 768-wide band.
type Look = { text: string; frame: string; ornate: boolean; band: string; cap: number };
export const RARITY = {
  normal: { text: "#c8c8c8", frame: "#8a8a8a", ornate: false, band: "/textures/ui/menu/tooltip_header_normal.png", cap: 70 },
  magic: { text: "#8f97ff", frame: "#57699f", ornate: false, band: "/textures/ui/menu/tooltip_header_magic.png", cap: 58 },
  rare: { text: "#e6d64a", frame: "#a3812f", ornate: true, band: "/textures/ui/menu/tooltip_header_rare.png", cap: 106 },
  unique: { text: "#af6025", frame: "#7f4a20", ornate: true, band: "/textures/ui/menu/tooltip_header_unique.png", cap: 100 },
} satisfies Record<string, Look>;

/** Source height of every band master after the build step. */
const BAND_H = 126;
/** Header band height on screen; the caps scale with it. */
const HEAD_H = 34;

// Faint section divider between the stat block, requirements, and affixes.
function Rule() {
  return <div style={{ height: 1, margin: "8px auto", width: "82%", background: "linear-gradient(90deg,transparent,#302f28 18%,#302f28 82%,transparent)" }} />;
}

export function ItemTooltip({
  name,
  baseName,
  rarity,
  itemClass,
  statLines,
  reqLevel,
  reqAttrValue,
  reqAttr,
  implicit,
  lines,
  flavour,
  unidentified,
  x,
  y,
}: {
  name: string;
  /** Base type; rendered as a second header line when it differs from the name (rare/unique). */
  baseName?: string;
  rarity: string;
  itemClass?: string;
  statLines?: ItemStatLine[];
  reqLevel?: number;
  reqAttrValue?: number;
  reqAttr?: string;
  /** The base's own mod, above the rolled ones and set off from them. */
  implicit?: string;
  lines: string[];
  /** unique only: italic flavour line closing the tooltip. */
  flavour?: string;
  /** Unread drop: the mods exist but stay hidden until a Scroll of Wisdom is used. */
  unidentified?: boolean;
  x: number;
  y: number;
}) {
  const r: Look = RARITY[rarity as keyof typeof RARITY] ?? RARITY.normal;
  const width = 300;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  // `x`/`y` are the pointer, which is the TIP of the arrow, and the panel is
  // placed around it: the gap goes on whichever side the panel actually opens
  // toward. Offsetting the coordinate at the call site instead only worked while
  // the panel opened down and right; flipped, the same 18px walked it back over
  // the cursor, and clamped to the right edge it landed under the arrow entirely.
  const GAP = 18;
  // Below the midpoint the tooltip grows upward from the cursor instead of down, so a
  // tall one (unique, with stats + mods + flavour) cannot run off the bottom edge.
  // Anchoring an edge avoids measuring the rendered height.
  const flipUp = y > vh / 2;
  const flipLeft = x + GAP + width > vw - 8;
  const left = flipLeft ? Math.max(8, x - GAP - width) : x + GAP;
  const place = flipUp ? { bottom: Math.max(8, vh - y + GAP) } : { top: y + GAP };
  return (
    <div
      data-testid="item-tooltip"
      style={{
        position: "fixed",
        left,
        ...place,
        zIndex: 50,
        width,
        pointerEvents: "none",
        fontFamily: SERIF,
        textAlign: "center",
        background: "rgba(4,4,4,0.94)",
        border: "1px solid #000",
        boxShadow: "0 8px 28px rgba(0,0,0,0.7)",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minHeight: baseName && baseName !== name ? HEAD_H + 14 : HEAD_H,
          padding: `3px ${Math.round(r.cap * (HEAD_H / BAND_H)) + 10}px`,
          boxSizing: "border-box",
          borderStyle: "solid",
          borderWidth: 0,
          borderImageSource: `url(${r.band})`,
          borderImageSlice: `20 ${r.cap} fill`,
          borderImageWidth: `${Math.round(20 * (HEAD_H / BAND_H))}px ${Math.round(r.cap * (HEAD_H / BAND_H))}px`,
          borderImageRepeat: "stretch",
        }}
      >
        <div
          style={{
            color: r.text,
            fontSize: r.ornate ? 16 : 15,
            fontWeight: 700,
            letterSpacing: 1.4,
            lineHeight: 1.2,
            textTransform: "uppercase",
            textShadow: "0 1px 2px #000",
          }}
        >
          {name}
          {baseName && baseName !== name && (
            <div style={{ fontSize: r.ornate ? 12 : 11, fontWeight: 600, letterSpacing: 1, opacity: 0.82, marginTop: 2 }}>
              {baseName}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "9px 14px 12px" }}>
        {itemClass && (
          <div style={{ color: CLASS_TAN, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", marginBottom: 1 }}>{itemClass}</div>
        )}
        {statLines?.map((s, i) => (
          <div key={i} style={{ fontSize: 13, letterSpacing: 0.3, margin: "1px 0", textTransform: "uppercase" }}>
            <span style={{ color: LABEL_GREY }}>{s.label}: </span>
            <span style={{ color: VALUE_LIGHT }}>{s.value}</span>
          </div>
        ))}

        {reqLevel !== undefined && (
          <>
            <Rule />
            <div style={{ fontSize: 13, letterSpacing: 0.3, textTransform: "uppercase" }}>
              <span style={{ color: LABEL_GREY }}>Requires Level </span>
              <span style={{ color: VALUE_LIGHT }}>{reqLevel}</span>
              {reqAttrValue !== undefined && reqAttr && (
                <>
                  <span style={{ color: LABEL_GREY }}>, </span>
                  <span style={{ color: VALUE_LIGHT }}>{reqAttrValue} </span>
                  <span style={{ color: LABEL_GREY }}>{reqAttr}</span>
                </>
              )}
            </div>
          </>
        )}

        {/* Same blue as the rolled mods, its own block above them: in
            reference-screenshots/item-rare.png the Goat's Horn implicit is set off by a gap,
            not by a colour or a heading. */}
        {implicit && (
          <>
            <Rule />
            <div data-testid="item-implicit" style={{ color: AFFIX_BLUE, fontSize: 13, letterSpacing: 0.4, margin: "4px 0" }}>
              {implicit}
            </div>
          </>
        )}

        {lines.length > 0 && (
          <>
            <Rule />
            {lines.map((l, i) => (
              <div key={i} style={{ color: AFFIX_BLUE, fontSize: 13, letterSpacing: 0.4, margin: "4px 0" }}>
                {l}
              </div>
            ))}
          </>
        )}

        {/* PoE puts the unread marker where the mods would be, in the same red it
            uses for a failed requirement: the gap is the point. */}
        {unidentified && (
          <>
            <Rule />
            <div data-testid="item-unidentified" style={{ color: UNID_RED, fontSize: 13, letterSpacing: 0.4, margin: "4px 0" }}>
              Unidentified
            </div>
          </>
        )}

        {flavour && (
          <>
            <Rule />
            <div style={{ fontFamily: SERIF, color: r.text, fontSize: 13.5, fontStyle: "italic", letterSpacing: 0.3, lineHeight: 1.4, margin: "4px 2px 0" }}>
              {flavour}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
