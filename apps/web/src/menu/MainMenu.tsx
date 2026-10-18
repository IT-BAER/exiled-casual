/**
 * The main menu.
 *
 * The LAYOUT is composed from PoE1's own (reference-screenshots/main-menu.png):
 * the title emblem hung in quiet air up top, a framed panel low in the frame
 * carrying the buttons, a boot log whispering away in the bottom left, and the
 * art's weight on the right. What is deliberately NOT borrowed is the gateway
 * dropdown and the LOG IN column: there is no server yet, and a dead control
 * that implies one is a lie the first player would catch.
 *
 * The PAINTING is not borrowed either, and the first one was. It was a colossal
 * seated god in a domed rotunda, which is PoE1's main menu redrawn rather than
 * answered — close enough to be recognised, which is the one thing this screen
 * must not be. It is now a toppled god's head half-sunk in a flooded ruin: the
 * same hour of the same world, from outside the hall you are chosen in.
 *
 * PLAY does not start a game. It asks which world the character lives in, which
 * is the one question that cannot be changed afterwards (local and online
 * characters are separate pools by design, see the accounts spec).
 */
import React from "react";
import { GAME_VERSION } from "../version";
import { NEWS_ENTRIES } from "../news.generated";
import { Atmosphere } from "./atmos";
import { BRAZIERS } from "./braziers";
import { Divider, EMBER, FramedPanel, GOLD, GOLD_DIM, MENU_ART, MenuButton, PARCHMENT, DISPLAY, SERIF } from "./frames";
import { BUILT_AT } from "../telemetry/client";
import { useLiveConfig } from "../telemetry/liveops";

export interface MainMenuProps {
  /** How many characters the save holds. Shown in the boot log, like PoE's login log. */
  characterCount: number;
  onPlay: () => void;
  onOptions: () => void;
  onAbout: () => void;
}

export function MainMenu({
  characterCount,
  onPlay,
  onOptions,
  onAbout,
}: MainMenuProps): React.ReactElement {
  const live = useLiveConfig();
    return (
    <div data-testid="main-menu" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Atmosphere backdrop={`${MENU_ART}/menu_backdrop.jpg`} braziers={BRAZIERS} />

      <img
        src={`${MENU_ART}/logo.webp`}
        srcSet={`${MENU_ART}/logo-512.webp 512w, ${MENU_ART}/logo.webp 1024w`}
        sizes="min(46vw, 760px)"
        alt="Exiled Casual"
        style={{
          position: "absolute",
          top: "3.5vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(46vw, 760px)",
          filter: "drop-shadow(0 10px 34px rgba(0,0,0,0.85))",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />

      <LiveNotices />

      <FramedPanel
        style={{
          position: "absolute",
          left: "50%",
          bottom: "8vh",
          transform: "translateX(-50%)",
          width: "min(56vw, 820px)",
          display: "flex",
          gap: 22,
          padding: 18,
          zIndex: 2,
        }}
      >
        <LatestPanel />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 220 }}>
          <MenuButton
            tone="primary"
            onClick={onPlay}
            autoFocus
            disabled={live.maintenance !== undefined}
            title={live.maintenance?.text}
          >
            Play
          </MenuButton>
          <MenuButton onClick={onOptions}>Options</MenuButton>
          <MenuButton onClick={onAbout}>About</MenuButton>
        </div>
      </FramedPanel>

      <BootLog characterCount={characterCount} />

      <div
        style={{
          position: "absolute",
          right: 18,
          bottom: 12,
          zIndex: 2,
          fontFamily: SERIF,
          fontSize: 12,
          letterSpacing: 1.4,
          color: GOLD_DIM,
        }}
      >
        <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: GOLD_DIM, marginRight: 14 }}>
          Privacy
        </a>
        {GAME_VERSION}
      </div>
    </div>
  );
}

/**
 * Where PoE1 puts a microtransaction sale, this puts what the build actually is.
 * The composition needs the weight on that side of the panel; the content does
 * not need to be a shop.
 */
function LatestPanel(): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "6px 16px 8px 6px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: GOLD,
        }}
      >
        Latest
      </div>
      <Divider style={{ margin: "2px 0 6px" }} />
      {/* Straight out of CHANGELOG.md, via tools/changelog_to_news.mjs: the
          menu cannot advertise a build that was never released, and nobody has
          to remember to copy anything. The first line is the headline. */}
      <div style={{ fontFamily: SERIF, fontSize: 14, color: PARCHMENT, lineHeight: 1.45 }}>
        {NEWS_ENTRIES[0]}
      </div>
      {NEWS_ENTRIES.slice(1).map((line) => (
        <div key={line} style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, lineHeight: 1.5 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

/**
 * PoE1 runs its login handshake down the bottom left in small grey type. There
 * is no server to hand shake with, so this reports the only thing boot actually
 * did: it read the save and found out who lives in it.
 */
function BootLog({ characterCount }: { characterCount: number }): React.ReactElement {
  const lines = [
    "> local storage ready.",
    "> save read.",
    characterCount === 0
      ? "> no characters yet."
      : `> ${characterCount} character${characterCount === 1 ? "" : "s"} found.`,
  ];
  return (
    <div
      data-testid="boot-log"
      style={{
        position: "absolute",
        left: 16,
        bottom: 12,
        zIndex: 2,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.5,
        color: "rgba(190,196,205,0.42)",
      }}
    >
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

const DISMISSED_KEY = "ec-motd-dismissed";

/** Remembered by message id only: UI state for this tab, not tracking. */
function dismissedId(): string | null {
  try { return sessionStorage.getItem(DISMISSED_KEY); } catch { return null; }
}

/**
 * What the operator can say from the admin console: a message of the day, a
 * maintenance notice (PLAY is disabled beside it) and a reload nudge for a build
 * older than the one the server wants. Stacked under the logo, in the panel's voice.
 */
function LiveNotices(): React.ReactElement | null {
  const live = useLiveConfig();
  const [dismissed, setDismissed] = React.useState<string | null>(dismissedId);
  const outdated = live.minBuiltAt !== undefined && live.minBuiltAt > BUILT_AT;
  const motd = live.motd && live.motd.id !== dismissed ? live.motd : null;
  if (!motd && !live.maintenance && !outdated) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(3.5vh + min(24vw, 400px) * 0.62)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(56vw, 820px)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 3,
      }}
    >
      {motd && (
        <Notice testId="motd" color={motd.level === "warn" ? EMBER : GOLD}>
          <span style={{ flex: 1 }}>{motd.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              try { sessionStorage.setItem(DISMISSED_KEY, motd.id); } catch { /* private mode */ }
              setDismissed(motd.id);
            }}
            style={noticeButton}
          >
            x
          </button>
        </Notice>
      )}
      {live.maintenance && (
        <Notice testId="maintenance" color={EMBER}>
          <span style={{ flex: 1 }}>{live.maintenance.text}</span>
        </Notice>
      )}
      {outdated && (
        <Notice testId="new-version" color={GOLD}>
          <span style={{ flex: 1 }}>A new version is available.</span>
          <button type="button" onClick={() => location.reload()} style={noticeButton}>
            Reload
          </button>
        </Notice>
      )}
    </div>
  );
}

const noticeButton: React.CSSProperties = {
  appearance: "none",
  background: "transparent",
  border: "1px solid currentColor",
  color: "inherit",
  fontFamily: DISPLAY,
  fontSize: 12,
  letterSpacing: 2,
  textTransform: "uppercase",
  padding: "3px 10px",
  cursor: "pointer",
};

function Notice({
  testId,
  color,
  children,
}: {
  testId: string;
  color: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      role="status"
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "9px 16px",
        background: "linear-gradient(180deg, rgba(10,11,13,0.92), rgba(6,7,9,0.95))",
        border: `1px solid ${color}`,
        boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
        color: PARCHMENT,
        fontFamily: SERIF,
        fontSize: 14,
        lineHeight: 1.4,
        // The rule is the notice's own colour; the text stays readable parchment.
        borderLeftWidth: 4,
      }}
    >
      {children}
    </div>
  );
}
