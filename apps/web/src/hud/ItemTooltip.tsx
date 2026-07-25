import React from "react";
import type { ItemStatLine } from "@exiled/protocol";

// PoE2 item tooltip. Matched to poe2-screenshots/item-{normal,magic,rare,unique}.png:
// near-black panel, centered small-caps serif, a rarity-framed header band with
// inward flourishes, an item-class line, then affix lines in augmented-blue.
// All four rarities roll today; the sim still does not model weapon base stats or
// requirements beyond what the base carries, so those rows are absent when unknown.
export const SERIF = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const AFFIX_BLUE = "#8f97ff";
const CLASS_TAN = "#8a8065";
const LABEL_GREY = "#7b7b74"; // stat/requirement words
const VALUE_LIGHT = "#d2d2c8"; // stat/requirement numbers

type Look = { text: string; headBg: string; frame: string; flourish: string; ornate: boolean };
export const RARITY = {
  normal: { text: "#c8c8c8", headBg: "linear-gradient(180deg,#4a4a4a,#282828)", frame: "#8a8a8a", flourish: "#c0c0c0", ornate: false },
  magic: { text: "#8f97ff", headBg: "linear-gradient(180deg,#1a2340,#0c1020)", frame: "#57699f", flourish: "#8f9bd8", ornate: false },
  rare: { text: "#e6d64a", headBg: "linear-gradient(180deg,#3a2e15,#201707)", frame: "#a3812f", flourish: "#d8b048", ornate: true },
  unique: { text: "#af6025", headBg: "linear-gradient(180deg,#2d1c0b,#180e05)", frame: "#7f4a20", flourish: "#c07b30", ornate: true },
} satisfies Record<string, Look>;

// Inward-pointing dagger/arrow end-cap flanking the header name.
// ponytail: CSS chevron, not the pixel filigree of the real gold frame; upgrade to
// an SVG/sprite flourish if the header needs to be exact.
function Flourish({ color, side, ornate }: { color: string; side: "left" | "right"; ornate: boolean }) {
  // Chunky blade end-cap: a rectangular tail with a wide triangular point aimed
  // inward at the name, echoing the metal daggers in the normal/magic screenshots.
  const clip =
    side === "left"
      ? "polygon(0 28%, 52% 28%, 52% 8%, 100% 50%, 52% 92%, 52% 72%, 0 72%)"
      : "polygon(100% 28%, 48% 28%, 48% 8%, 0 50%, 48% 92%, 48% 72%, 100% 72%)";
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [side]: 8,
        width: ornate ? 28 : 24,
        height: ornate ? 15 : 13,
        background: `linear-gradient(180deg, ${color}, ${color}88)`,
        opacity: 0.92,
        clipPath: clip,
      }}
    />
  );
}

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
  x: number;
  y: number;
}) {
  const r: Look = RARITY[rarity as keyof typeof RARITY] ?? RARITY.normal;
  const width = 300;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const left = Math.min(x, vw - width - 8);
  // Below the midpoint the tooltip grows upward from the cursor instead of down, so a
  // tall one (unique, with stats + mods + flavour) cannot run off the bottom edge.
  // Anchoring an edge avoids measuring the rendered height.
  const flipUp = y > vh / 2;
  const place = flipUp ? { bottom: Math.max(8, vh - y) } : { top: y };
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
          padding: r.ornate ? "9px 34px" : "6px 30px",
          background: r.headBg,
          borderTop: `1px solid ${r.frame}`,
          borderBottom: `1px solid ${r.frame}`,
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.5)`,
        }}
      >
        <Flourish color={r.flourish} side="left" ornate={r.ornate} />
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
        <Flourish color={r.flourish} side="right" ornate={r.ornate} />
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
            poe2-screenshots/item-rare.png the Goat's Horn implicit is set off by a gap,
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

        {flavour && (
          <>
            <Rule />
            <div style={{ color: r.text, fontSize: 12.5, fontStyle: "italic", letterSpacing: 0.4, lineHeight: 1.35, margin: "4px 2px 0" }}>
              {flavour}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
