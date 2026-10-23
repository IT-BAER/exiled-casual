/**
 * How does this character move: PoE2's two schemes, asked once, the first time a
 * new character stands in the hideout. Options can change it later.
 *
 * Modal on purpose, with no way out but a choice: until one is made the keys mean
 * nothing settled, and W would either walk or cast depending on an answer the
 * player has not given yet. Game keys are swallowed while it is up.
 */
import React from "react";
import { DEFAULT_KEYBINDS_BY_MODE, SKILL_ACTIONS, type ControlMode, type KeybindAction, type Keybinds } from "../settings";
import { Divider, FramedPanel, GOLD, GOLD_DIM, MenuButton, PARCHMENT, DISPLAY, SERIF } from "./frames";
import { keyLabel } from "./OptionsPanel";

/** A run of keys as one keycap: single letters run together (QWERT), named keys keep a space. */
function keyRun(binds: Keybinds, actions: readonly KeybindAction[]): string {
  const labels = actions.map((a) => keyLabel(binds[a]));
  return labels.join(labels.every((l) => l.length === 1) ? "" : " ");
}

const SCHEMES: readonly {
  mode: ControlMode;
  title: string;
  art: (binds: Keybinds) => React.ReactElement;
  keys: (binds: Keybinds) => readonly [string, string][];
  action: string;
}[] = [
  {
    mode: "mouse",
    title: "Click to move",
    art: () => <MouseArt />,
    keys: (b) => [["LMB", "Move"], ["RMB", "Attack"], [keyRun(b, SKILL_ACTIONS), "Skills"], [keyRun(b, ["flaskLife", "flaskMana"]), "Flasks"]],
    action: "Play with mouse",
  },
  {
    mode: "wasd",
    title: "WASD",
    art: (b) => <KeyCluster binds={b} />,
    keys: (b) => [
      [keyRun(b, ["moveUp", "moveLeft", "moveDown", "moveRight"]), "Move"], ["LMB", "Attack"],
      [keyRun(b, SKILL_ACTIONS), "Skills"], [keyRun(b, ["flaskLife", "flaskMana"]), "Flasks"],
    ],
    action: "Play with WASD",
  },
];

export function ControlsDialog({
  onPick,
  keybinds = DEFAULT_KEYBINDS_BY_MODE,
}: {
  onPick: (mode: ControlMode) => void;
  /** What Options already bound: a player who rebound before the first entry reads their own keys. */
  keybinds?: Readonly<Record<ControlMode, Keybinds>>;
}): React.ReactElement {
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
            <div style={{ width: 128, height: 116, flexShrink: 0, display: "grid", placeItems: "center" }}>
              {s.art(keybinds[s.mode])}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 16, letterSpacing: 2.5, textTransform: "uppercase", color: PARCHMENT }}>
                {s.title}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
                {s.keys(keybinds[s.mode]).map(([keys, what]) => (
                  <span key={what} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Keycap>{keys}</Keycap>
                    <span style={{ fontFamily: SERIF, fontSize: 12, color: "#8f8877" }}>{what}</span>
                  </span>
                ))}
              </div>
            </div>
            {/* MenuButton's 7% padding resolves against its parent: a button-sized
                parent keeps it 7% of the button and clear of the label. */}
            <div style={{ width: 230, flexShrink: 0 }}>
              <MenuButton tone="primary" onClick={() => onPick(s.mode)} autoFocus={i === 0} style={{ width: "100%" }}>
                {s.action}
              </MenuButton>
            </div>
          </div>
        ))}
        <div style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, textAlign: "center", marginTop: 8 }}>
          Options can change this later.
        </div>
      </FramedPanel>
    </div>
  );
}

/** The click-to-move hand: a mouse, its left button lit (move) and its right in gold (attack). */
function MouseArt(): React.ReactElement {
  return (
    <svg data-testid="controls-art-mouse" width="76" height="112" viewBox="0 0 62 92" aria-hidden="true">
      <defs>
        <linearGradient id="controls-mouse-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24201a" />
          <stop offset="1" stopColor="#0c0b09" />
        </linearGradient>
      </defs>
      <path d="M31 3 C14 3 4 15 4 32 V62 C4 79 16 89 31 89 C46 89 58 79 58 62 V32 C58 15 48 3 31 3 Z"
        fill="url(#controls-mouse-body)" stroke={GOLD_DIM} strokeWidth="2" />
      <path d="M30 4 C15 5 5 16 5 32 V38 H30 Z" fill={GOLD} fillOpacity="0.85" />
      <path d="M32 4 C47 5 57 16 57 32 V38 H32 Z" fill={GOLD_DIM} fillOpacity="0.45" />
      <line x1="31" y1="4" x2="31" y2="38" stroke="#0c0b09" strokeWidth="2" />
      <line x1="5" y1="38" x2="57" y2="38" stroke={GOLD_DIM} strokeWidth="1.5" />
      <rect x="28" y="12" width="6" height="14" rx="3" fill="#0c0b09" stroke={GOLD_DIM} strokeWidth="1.2" />
    </svg>
  );
}

/** The WASD hand: the four movement keys as bound, laid out as they sit on the board. */
function KeyCluster({ binds }: { binds: Keybinds }): React.ReactElement {
  const key = (action: KeybindAction, gridColumn: number, gridRow: number) => (
    <span data-key style={{
      ...KEYCAP, gridColumn, gridRow, width: 36, height: 36, display: "grid", placeItems: "center", fontSize: 17, letterSpacing: 0,
    }}>
      {keyLabel(binds[action])}
    </span>
  );
  return (
    <div data-testid="controls-art-wasd" style={{ display: "grid", gridTemplateColumns: "repeat(3, 36px)", gap: 5 }}>
      {key("moveUp", 2, 1)}
      {key("moveLeft", 1, 2)}
      {key("moveDown", 2, 2)}
      {key("moveRight", 3, 2)}
    </div>
  );
}

const KEYCAP: React.CSSProperties = {
  fontFamily: DISPLAY,
  fontSize: 12,
  letterSpacing: 2,
  color: PARCHMENT,
  border: `1px solid ${GOLD_DIM}`,
  borderRadius: 2,
  background: "linear-gradient(180deg,#1d1a15,#0c0b09)",
  boxShadow: "inset 0 1px 0 rgba(200,164,77,0.18)",
};

/** A key, or a run of keys read as one block, the way a bar's hotkey reads. */
function Keycap({ children }: { children: string }): React.ReactElement {
  return (
    <span style={{ ...KEYCAP, padding: "1px 6px" }}>
      {children}
    </span>
  );
}
