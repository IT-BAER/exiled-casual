import React from "react";
import { SERIF } from "./ItemTooltip";

const GOLD = "#c8aa6e";
const GOLD_DIM = "#6b5a34";
const PARCHMENT = "#c8c2b4";

/**
 * How far back the experience rate looks. PoE's own readout is a rolling average
 * too: too short and a single pack makes it read a million an hour, too long and
 * it never notices you stopped. THIS IS THE TUNING KNOB.
 */
export const XP_RATE_WINDOW_MS = 60_000;

/**
 * A divider every this share of the level. PoE1's own studs sit about every 2%,
 * which is decoration; on 5% you can count what is left without asking for the
 * number, which is why the owner asked for that step.
 */
const SEGMENT_PCT = 5;

/** Thin enough to be noticed sideways and never looked at. */
export const RAIL_H = 4;

/**
 * PoE1's rail is an UNBROKEN orange line with small gold studs set on it, not a
 * row of separate blocks (reference-screenshots/poe1-lower-bar.png, zoomed). A
 * black gap every segment is the thing it is not — so the divider is a stud:
 * a dark hairline, a bright pip, a dark hairline, all sitting on top of the line.
 *
 * Exported because jsdom's CSS parser drops a repeating-linear-gradient that
 * carries a calc(), so neither `.style` nor the style attribute can be read back
 * in a test — the string itself is the only thing left to pin.
 */
export const TICK_BACKGROUND =
  `repeating-linear-gradient(90deg,` +
  `rgba(0,0,0,0) 0 calc(${SEGMENT_PCT}% - 3px),` +
  `rgba(0,0,0,0.5) calc(${SEGMENT_PCT}% - 3px) calc(${SEGMENT_PCT}% - 2px),` +
  `rgba(255,214,140,0.9) calc(${SEGMENT_PCT}% - 2px) calc(${SEGMENT_PCT}% - 1px),` +
  `rgba(0,0,0,0.5) calc(${SEGMENT_PCT}% - 1px) ${SEGMENT_PCT}%)`;

/**
 * Pale core between two darker rims, the way the reference line is lit — a flat
 * gold gradient top-to-bottom read as a bar, not as a line.
 */
const FILL_BACKGROUND =
  `linear-gradient(180deg,` +
  `#5a3a10 0 12%,` +
  `#ffd98f 12% 42%,` +
  `#e08a1c 42% 80%,` +
  `#4a2c0a 80% 100%)`;

export type XpSample = { t: number; total: number };

/**
 * Experience per hour from a rolling window of cumulative-experience samples.
 * Pure so it can be tested without a clock. Returns null until the window is
 * wide enough to mean anything — a rate off 200ms of play is noise, not news.
 */
export function xpPerHour(samples: XpSample[], minSpanMs = 3000): number | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || samples.length < 2) return null;
  const span = last.t - first.t;
  if (span < minSpanMs) return null;
  return ((last.total - first.total) / span) * 3_600_000;
}

/** 1.2M / 45.3k / 812 — the number is glanced at, not read. */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function useXpRate(xp: number, level: number): number | null {
  const samples = React.useRef<XpSample[]>([]);
  const total = React.useRef(0);
  const prev = React.useRef<{ xp: number; level: number } | null>(null);

  React.useEffect(() => {
    const was = prev.current;
    prev.current = { xp, level };
    if (was) {
      // The snapshot carries experience *into the current level*, so a level-up
      // makes it fall. What was banked in the new level is the only part of that
      // gain we can still see; the remainder is lost, which under-reads for one
      // sample rather than printing a negative rate.
      total.current += level > was.level || xp < was.xp ? Math.max(0, xp) : xp - was.xp;
    }
    const now = performance.now();
    samples.current.push({ t: now, total: total.current });
    while (samples.current.length > 1 && now - samples.current[0]!.t > XP_RATE_WINDOW_MS) {
      samples.current.shift();
    }
  }, [xp, level]);

  return xpPerHour(samples.current);
}

/**
 * PoE1 puts experience on a thin segmented rail along the very bottom edge,
 * running behind both bar panels, and prints no text on it at all: the number
 * lives in a tooltip you have to ask for (poe1-lower-bar.png). It is the one bar
 * you are never meant to look at directly, only to notice out of the corner of
 * your eye.
 */
export function XpBar({ level, xp, xpToNext }: { level: number; xp: number; xpToNext: number }) {
  const [hover, setHover] = React.useState(false);
  const rate = useXpRate(xp, level);
  // A capped character has nothing left to earn, so its bar reads full rather than empty.
  const pct = xpToNext > 0 ? Math.max(0, Math.min(100, (xp / xpToNext) * 100)) : 100;

  return (
    <>
      <div
        data-testid="xp-bar"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: RAIL_H,
          background: "linear-gradient(180deg,#0a0805,#16110a)",
          borderTop: "1px solid #2b2216",
          // Below the two panels (zIndex 2) but above the connector band, which is
          // drawn before it at the same layer: the rail passes *behind* the stone.
          zIndex: 1,
        }}
      >
        <div
          data-testid="xp-bar-fill"
          style={{
            height: "100%",
            width: `${pct}%`,
            background: FILL_BACKGROUND,
            boxShadow: "0 0 8px rgba(220,140,50,0.45)",
            transition: "width 200ms linear",
          }}
        />
        <div
          data-testid="xp-bar-ticks"
          style={{
            position: "absolute",
            inset: 0,
            background: TICK_BACKGROUND,
            // Studs sit on the line, so they stop where the line does; past the
            // fill PoE1's rail is plain dark trough. Clipped rather than resized,
            // because the gradient's 5% steps have to keep measuring the whole
            // rail and not whatever is filled so far.
            clipPath: `inset(0 ${100 - pct}% 0 0)`,
            transition: "clip-path 200ms linear",
            pointerEvents: "none",
          }}
        />
      </div>

      {hover && (
        <div
          data-testid="xp-tooltip"
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 6,
            pointerEvents: "none",
            fontFamily: SERIF,
            background: "linear-gradient(180deg,#0a0a0a,#000)",
            border: `1px solid ${GOLD_DIM}`,
            boxShadow: "0 0 18px rgba(0,0,0,0.9)",
            padding: "6px 12px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontSize: 15, color: GOLD, letterSpacing: 1 }}>{`Level ${level}`}</div>
          <div style={{ fontSize: 12, color: PARCHMENT }}>
            {xpToNext > 0
              ? `${xp.toLocaleString("en-US")} / ${xpToNext.toLocaleString("en-US")}  (${pct.toFixed(1)}%)`
              : "Maximum level"}
          </div>
          <div style={{ fontSize: 12, color: GOLD_DIM }}>
            {rate === null ? "Exp/Hour  —" : `Exp/Hour  ${short(rate)}`}
          </div>
        </div>
      )}
    </>
  );
}
