/**
 * The Options window.
 *
 * Shaped after `reference-screenshots/options.png` (PoE 1): a carved header with
 * the name band on it, a strip of tabs, label-left/control-right rows whose
 * controls line up as one column, and a footer. Drawn over whatever is behind
 * it, which is the same component in the menu and in the game.
 *
 * Presentational on purpose. It takes a `Settings` and emits the next WHOLE one;
 * it never writes to storage and never imports the renderer, so it renders in
 * jsdom and the screen that mounts it owns applying and persisting.
 *
 * There is no SAVE button. A graphics knob's whole value is turning it while
 * looking at the frame it changes, and a setting you have to confirm cannot do
 * that. The plate has a SAVE, drawn dark; ours is the lit CLOSE alone.
 */
import React from "react";
import {
  Divider,
  FramedPanel,
  GOLD,
  GOLD_DIM,
  MENU_ART,
  MenuButton,
  PARCHMENT,
  SERIF,
} from "./frames";
import { MIN_RESOLUTION_SCALE, type Settings, type ShadowQuality } from "../settings";
// hud/layout.ts imports nothing, so the menu bundle gains two numbers, not the HUD.
import { PANEL_W } from "../hud/layout";

type TabId = "graphics" | "sound" | "ui";
const TABS: readonly { id: TabId; label: string }[] = [
  { id: "graphics", label: "Graphics" },
  { id: "sound", label: "Sound" },
  { id: "ui", label: "UI" },
];

export function OptionsPanel({
  settings,
  onChange,
  onClose,
  bottomInset = "0px",
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  /**
   * How much screen the window has to keep clear at its foot. The game passes
   * the bottom bar's height, which is what makes this pane the same pane as the
   * character sheet; the menu has no bar and passes nothing.
   */
  bottomInset?: string;
}): React.ReactElement {
  const [tab, setTab] = React.useState<TabId>("graphics");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setGraphics = (patch: Partial<Settings["graphics"]>): void =>
    onChange({ ...settings, graphics: { ...settings.graphics, ...patch } });
  const setSound = (patch: Partial<Settings["sound"]>): void =>
    onChange({ ...settings, sound: { ...settings.sound, ...patch } });
  const setUi = (patch: Partial<Settings["ui"]>): void =>
    onChange({ ...settings, ui: { ...settings.ui, ...patch } });

  return (
    <div
      data-testid="options-panel"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        // Left edge, foot on the bar: PoE docks this window, it does not float
        // it (reference-screenshots/options.png). Still a full-screen catcher,
        // so nothing behind it can be clicked while it is open.
        alignItems: "flex-end",
        justifyContent: "flex-start",
        zIndex: 40,
      }}
    >
      <FramedPanel
        // The character sheet's own stone. The default fill is 94% dark, which
        // let the life globe's "100/100" read straight through the window.
        fill="linear-gradient(180deg, rgba(8,7,5,0.55), rgba(8,7,5,0.78)), url(/textures/ui/char_stone_v1.png)"
        style={{
          backgroundSize: "auto, 256px 256px",
          // The character sheet's pane, to the pixel: same width, same top line,
          // same foot on the bottom bar (hud/layout.ts, hud/InventoryPanel.tsx).
          width: PANEL_W,
          height: `calc(100vh - ${bottomInset})`,
          marginBottom: bottomInset,
          padding: "14px 20px 16px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Header onClose={onClose} />
        <Tabs current={tab} onPick={setTab} />
        <Divider style={{ margin: "8px 0 12px" }} />

        {/* The window's height is the screen's, so the short tab no longer
            resizes it under the pointer; the body just scrolls inside it. */}
        <div style={{ overflowY: "auto", flex: 1, paddingRight: 6 }}>
          {tab === "graphics" ? (
            <>
              <Group>Detail</Group>
              <Row label="Shadows">
                <Choice<ShadowQuality>
                  label="Shadows"
                  value={settings.graphics.shadows}
                  options={[
                    { value: "off", label: "Off" },
                    { value: "low", label: "Low" },
                    { value: "high", label: "High" },
                  ]}
                  onPick={(shadows) => setGraphics({ shadows })}
                />
              </Row>
              <Row label="Ambient Occlusion">
                <Gem
                  label="Ambient Occlusion"
                  on={settings.graphics.ambientOcclusion}
                  onToggle={(ambientOcclusion) => setGraphics({ ambientOcclusion })}
                />
              </Row>
              <Row label="Bloom">
                <Gem
                  label="Bloom"
                  on={settings.graphics.bloom}
                  onToggle={(bloom) => setGraphics({ bloom })}
                />
              </Row>

              <Group>Atmosphere</Group>
              <Row label="Haze">
                <Choice<Settings["graphics"]["atmosphere"]>
                  label="Haze"
                  value={settings.graphics.atmosphere}
                  options={[
                    { value: "soft", label: "Soft" },
                    { value: "heavy", label: "Heavy" },
                  ]}
                  onPick={(atmosphere) => setGraphics({ atmosphere })}
                />
              </Row>

              <Group>Performance</Group>
              <Row label="Resolution Scale" note="Buys frames with sharpness.">
                <Slider
                  label="Resolution Scale"
                  value={settings.graphics.resolutionScale}
                  min={MIN_RESOLUTION_SCALE}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onSet={(resolutionScale) => setGraphics({ resolutionScale })}
                />
              </Row>
            </>
          ) : tab === "sound" ? (
            <>
              <Group>Volume</Group>
              <Row label="Master Volume">
                <Slider
                  label="Master Volume"
                  value={settings.sound.master}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onSet={(master) => setSound({ master })}
                />
              </Row>
              <Row label="Mute">
                <Gem
                  label="Mute"
                  on={settings.sound.muted}
                  onToggle={(muted) => setSound({ muted })}
                />
              </Row>
              <p
                style={{
                  fontFamily: SERIF,
                  fontSize: 12,
                  color: GOLD_DIM,
                  lineHeight: 1.6,
                  marginTop: 14,
                }}
              >
                One cue per drop is every sound the game has. Music gets its own slider when there
                is music.
              </p>
            </>
          ) : (
            <>
              <Group>Heads-up Display</Group>
              <Row label="Show Minimap" note="The corner map of the area you are in.">
                <Gem
                  label="Show Minimap"
                  on={settings.ui.minimap}
                  onToggle={(minimap) => setUi({ minimap })}
                />
              </Row>
              <Row label="Show Loot Labels" note="Drops still chime, and still hover.">
                <Gem
                  label="Show Loot Labels"
                  on={settings.ui.lootLabels}
                  onToggle={(lootLabels) => setUi({ lootLabels })}
                />
              </Row>
            </>
          )}
        </div>

        <Divider style={{ margin: "12px 0 10px" }} />
        <div style={{ display: "flex", justifyContent: "center" }}>
          <MenuButton height={40} style={{ minWidth: 200 }} onClick={onClose} autoFocus>
            Close
          </MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}

/** The name band, and the X on its right end. */
function Header({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <div style={{ position: "relative", display: "grid", placeItems: "center", marginBottom: 8 }}>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 20,
          letterSpacing: 5,
          textTransform: "uppercase",
          color: GOLD,
          textShadow: "0 1px 2px rgba(0,0,0,0.9)",
        }}
      >
        Options
      </div>
      <button
        type="button"
        aria-label="Close options"
        onClick={onClose}
        style={{
          position: "absolute",
          right: -6,
          top: -2,
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "1px solid #6d2a1c",
          background: "radial-gradient(circle at 40% 35%, #b4402a, #5d1c12)",
          color: "#f0d3c6",
          fontFamily: SERIF,
          fontSize: 14,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        X
      </button>
    </div>
  );
}

function Tabs({
  current,
  onPick,
}: {
  current: TabId;
  onPick: (id: TabId) => void;
}): React.ReactElement {
  return (
    <div role="tablist" aria-label="Options sections" style={{ display: "flex", gap: 4 }}>
      {TABS.map((t) => {
        const on = t.id === current;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onPick(t.id)}
            style={{
              appearance: "none",
              border: "none",
              padding: "8px 22px 10px",
              backgroundColor: "transparent",
              backgroundImage: `url(${MENU_ART}/tab_plate.png)`,
              backgroundSize: "100% 100%",
              backgroundRepeat: "no-repeat",
              fontFamily: SERIF,
              fontSize: 13,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: on ? "#f6e6bd" : "#9a8f7e",
              // One plate, tinted. Two renders of the same tab are never the
              // same tab, and a tab that changes shape reads as a glitch.
              filter: on ? "brightness(1.3) saturate(1.1)" : "brightness(0.62) saturate(0.7)",
              transform: on ? "none" : "translateY(2px)",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontFamily: SERIF,
        fontSize: 13,
        letterSpacing: 3,
        textTransform: "uppercase",
        color: GOLD,
        margin: "12px 0 8px",
      }}
    >
      {children}
    </div>
  );
}

/** Label left, control right. The control column is fixed so they line up. */
function Row({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 260px",
        alignItems: "center",
        gap: 12,
        minHeight: 40,
      }}
    >
      <div>
        <div style={{ fontFamily: SERIF, fontSize: 14, color: PARCHMENT }}>{label}</div>
        {note !== undefined && (
          <div style={{ fontFamily: SERIF, fontSize: 11, color: GOLD_DIM }}>{note}</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

/** The round gem checkbox. Two plates, swapped; the art carries the state. */
function Gem({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={() => onToggle(!on)}
      style={{
        appearance: "none",
        border: "none",
        padding: 0,
        width: 28,
        height: 28,
        backgroundColor: "transparent",
        backgroundImage: `url(${MENU_ART}/${on ? "gem_check_on" : "gem_check_off"}.png)`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        cursor: "pointer",
      }}
    />
  );
}

/** A short row of exclusive plates, for a setting with a handful of states. */
function Choice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onPick: (next: T) => void;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            type="button"
            aria-checked={on}
            onClick={() => onPick(o.value)}
            style={{
              appearance: "none",
              padding: "5px 12px",
              border: `1px solid ${on ? GOLD : "#3a352c"}`,
              background: on ? "rgba(200,164,77,0.16)" : "rgba(0,0,0,0.45)",
              fontFamily: SERIF,
              fontSize: 12,
              letterSpacing: 1.4,
              color: on ? "#f6e6bd" : "#9a8f7e",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The painted track with a real range input laid invisibly over it.
 *
 * The native input is what carries the drag: pointer capture, keyboard and the
 * accessible name all come free, and the game's own pointer handlers cannot eat
 * a drag that never leaves the input. The art is the background under it, and
 * the handle stands proud of the track the way the plate's does.
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onSet,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onSet: (next: number) => void;
}): React.ReactElement {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: 20,
          backgroundImage: `url(${MENU_ART}/slider_track.png)`,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -7,
            height: 34,
            // Inset by a whole handle across the travel so the block stays on
            // the track at both ends rather than hanging off them.
            left: `calc(${pct}% - ${pct * 0.16}px)`,
            width: 16,
            backgroundImage: `url(${MENU_ART}/slider_handle.png)`,
            backgroundSize: "100% 100%",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
          }}
        />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onSet(Number(e.target.value))}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            opacity: 0,
            cursor: "pointer",
            margin: 0,
          }}
        />
      </div>
      <span
        style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, width: 44, textAlign: "right" }}
      >
        {format(value)}
      </span>
    </div>
  );
}
