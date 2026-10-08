/**
 * How does this character move: PoE2's two schemes, asked once, the first time a
 * new character stands in the hideout. Options can change it later.
 *
 * Modal on purpose, with no way out but a choice: until one is made the keys mean
 * nothing settled, and W would either walk or cast depending on an answer the
 * player has not given yet. Game keys are swallowed while it is up.
 */
import React from "react";
import type { ControlMode } from "../settings";
import { Divider, FramedPanel, GOLD, GOLD_DIM, MenuButton, PARCHMENT, DISPLAY, SERIF } from "./frames";

const SCHEMES: readonly {
  mode: ControlMode;
  title: string;
  body: string;
  keys: readonly [string, string][];
  action: string;
}[] = [
  {
    mode: "mouse",
    title: "Click to move",
    body: "Left click walks, PoE's classic hand. The keyboard is all skills.",
    keys: [["LMB", "Move"], ["RMB", "Attack"], ["QWERT", "Skills"], ["12", "Flasks"]],
    action: "Play with mouse",
  },
  {
    mode: "wasd",
    title: "WASD",
    body: "The keys walk and left click attacks where the cursor points. Skills sit around the movement hand.",
    keys: [["WASD", "Move"], ["LMB", "Attack"], ["QERTF", "Skills"], ["12", "Flasks"]],
    action: "Play with WASD",
  },
];

export function ControlsDialog({ onPick }: { onPick: (mode: ControlMode) => void }): React.ReactElement {
  // Capture phase on window runs before the game's own listeners there, so a key
  // pressed while choosing neither walks, casts nor opens a panel.
  React.useEffect(() => {
    const swallow = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "Enter" || e.key === " ") return; // focus and the buttons
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", swallow, { capture: true });
    return () => window.removeEventListener("keydown", swallow, { capture: true });
  }, []);

  return (
    <div
      data-testid="controls-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your controls"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(3,4,6,0.72)",
        backdropFilter: "blur(2px)",
        zIndex: 60,
        pointerEvents: "auto",
      }}
    >
      <FramedPanel style={{ width: "min(56vw, 760px)", padding: "16px 22px 18px" }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 20,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: GOLD,
            textAlign: "center",
          }}
        >
          Choose your controls
        </div>
        <Divider style={{ margin: "10px 0 12px" }} />
        {SCHEMES.map((s, i) => (
          <div
            key={s.mode}
            data-testid={`controls-${s.mode}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "12px 8px",
              borderTop: `1px solid ${GOLD_DIM}33`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 16, letterSpacing: 2.5, textTransform: "uppercase", color: PARCHMENT }}>
                {s.title}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 13, color: "#a9a290", lineHeight: 1.5, marginTop: 4 }}>
                {s.body}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
                {s.keys.map(([keys, what]) => (
                  <span key={what} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Keycap>{keys}</Keycap>
                    <span style={{ fontFamily: SERIF, fontSize: 12, color: "#8f8877" }}>{what}</span>
                  </span>
                ))}
              </div>
            </div>
            <MenuButton tone="primary" onClick={() => onPick(s.mode)} autoFocus={i === 0} style={{ width: 190 }}>
              {s.action}
            </MenuButton>
          </div>
        ))}
        <div style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, textAlign: "center", marginTop: 8 }}>
          Options can change this later.
        </div>
      </FramedPanel>
    </div>
  );
}

/** A key, or a run of keys read as one block, the way a bar's hotkey reads. */
function Keycap({ children }: { children: string }): React.ReactElement {
  return (
    <span
      style={{
        fontFamily: DISPLAY,
        fontSize: 12,
        letterSpacing: 2,
        color: PARCHMENT,
        padding: "1px 6px",
        border: `1px solid ${GOLD_DIM}`,
        borderRadius: 2,
        background: "linear-gradient(180deg,#1d1a15,#0c0b09)",
        boxShadow: "inset 0 1px 0 rgba(200,164,77,0.18)",
      }}
    >
      {children}
    </span>
  );
}
