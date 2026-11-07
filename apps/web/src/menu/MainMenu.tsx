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
import { createPortal } from "react-dom";
import { GAME_VERSION } from "../version";
import { NEWS_HISTORY } from "../news.generated";
import { DEVLOG_TILES } from "../devlog.generated";
import { Atmosphere } from "./atmos";
import { BRAZIERS } from "./braziers";
import { Divider, EMBER, FramedPanel, GOLD, GOLD_DIM, MENU_ART, MenuButton, PARCHMENT, DISPLAY, SERIF } from "./frames";
import { BUILT_AT } from "../telemetry/client";
import { useLiveConfig } from "../telemetry/liveops";
import { gpuRenderer } from "../gpu";
import { deviceNotices, probeDevice } from "./device-notice";

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
        <DevlogTiles />
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

      <PatchNotes />

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

type DevlogTile = (typeof DEVLOG_TILES)[number];

/**
 * Where PoE1 hangs two shop pictures left of its buttons, the newest devlog
 * shots: one large, two stacked beside it (tools/devlog_to_menu.mjs).
 */
function DevlogTiles(): React.ReactElement {
  const [open, setOpen] = React.useState<DevlogTile | null>(null);
  const [large, ...small] = DEVLOG_TILES;
  return (
    <div
      data-testid="devlog-tiles"
      style={{
        flex: 1,
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        gridTemplateRows: "1fr 1fr",
        gap: 6,
      }}
    >
      {large && <Tile tile={large} big onOpen={setOpen} />}
      {small.map((t) => <Tile key={t.src} tile={t} onOpen={setOpen} />)}
      {open && <Lightbox tile={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Tile({ tile, big, onOpen }: { tile: DevlogTile; big?: boolean; onOpen: (t: DevlogTile) => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onOpen(tile)}
      onPointerEnter={(e) => { e.currentTarget.style.filter = "brightness(1.15)"; }}
      onPointerLeave={(e) => { e.currentTarget.style.filter = ""; }}
      style={{
        position: "relative",
        gridRow: big ? "span 2" : undefined,
        // The large tile takes the two small ones' height; they set it by their own 16:9.
        aspectRatio: big ? undefined : "16 / 9",
        padding: 0,
        border: `1px solid ${GOLD_DIM}`,
        background: "#000",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {/* The caption names the button; the picture adds nothing a reader needs twice. */}
      <img src={tile.src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: big ? "18px 10px 7px" : "12px 6px 4px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
          fontFamily: SERIF,
          fontSize: big ? 13 : 11,
          lineHeight: 1.3,
          color: PARCHMENT,
          textAlign: "left",
          textShadow: "0 1px 2px #000",
        }}
      >
        {tile.caption}
      </span>
    </button>
  );
}

function Lightbox({ tile, onClose }: { tile: DevlogTile; onClose: () => void }): React.ReactElement {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // A portal: the tiles' panel is transformed, and a fixed child of a transform is fixed to IT.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tile.caption}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.8)",
        cursor: "pointer",
      }}
    >
      <FramedPanel style={{ padding: 14, maxWidth: "min(84vw, 1280px)" }}>
        <img src={tile.full} alt={tile.alt} style={{ display: "block", width: "100%", maxHeight: "74vh", objectFit: "contain" }} />
        <div style={{ marginTop: 10, fontFamily: SERIF, fontSize: 15, color: PARCHMENT }}>
          {tile.caption}
          <span style={{ marginLeft: 12, fontSize: 12, color: GOLD_DIM }}>{shortDate(tile.date)}</span>
        </div>
      </FramedPanel>
    </div>,
    document.body,
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-07" as "7 Nov"; anything else as it came. */
const shortDate = (iso: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : iso;
};

/** Narrower than this, the window would be a sliver beside the centre panel. */
const PATCH_NOTES_MIN = "(min-width: 900px)";

function useWide(): boolean {
  const query = typeof window !== "undefined" ? window.matchMedia?.(PATCH_NOTES_MIN) : undefined;
  const [wide, setWide] = React.useState(query?.matches ?? true);
  React.useEffect(() => {
    if (!query) return;
    const on = () => setWide(query.matches);
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, [query]);
  return wide;
}

/**
 * Where PoE1 hangs its sale banner, left of centre: the last five releases in
 * short, straight out of CHANGELOG.md (tools/changelog_to_news.mjs).
 */
function PatchNotes(): React.ReactElement | null {
  if (!useWide()) return null;
  return (
    <div
      data-testid="patch-notes"
      // PoE1 hangs its banner here with no frame at all, a dark patch on the scene:
      // a hairline and a thin fill, so the composition's weight stays on PLAY.
      style={{
        position: "absolute",
        left: "1.2vw",
        top: "50%",
        transform: "translateY(-50%)",
        width: "min(19vw, 310px)",
        padding: "12px 14px",
        zIndex: 2,
        border: "1px solid rgba(200,164,77,0.2)",
        background: "linear-gradient(180deg, rgba(8,9,11,0.55), rgba(6,7,9,0.62))",
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontSize: 13, letterSpacing: 2.5, textTransform: "uppercase", color: GOLD_DIM }}>
        Patch Notes
      </div>
      <Divider style={{ margin: "5px 0 8px", opacity: 0.5 }} />
      <div style={{ maxHeight: "40vh", overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: `${GOLD_DIM} transparent`, paddingRight: 6 }}>
      {NEWS_HISTORY.map((r) => (
        <div key={r.version} style={{ marginBottom: 10 }}>
          <div
            data-version={r.version}
            style={{ fontFamily: DISPLAY, fontSize: 12, letterSpacing: 1.2, color: GOLD_DIM, marginBottom: 3 }}
          >
            {r.version}
            <span>{"  ·  "}{shortDate(r.date)}</span>
          </div>
          {r.entries.map((line) => (
            <div key={line} style={{ display: "flex", gap: 8, fontFamily: SERIF, fontSize: 13, color: PARCHMENT, lineHeight: 1.4, marginBottom: 3 }}>
              {/* The HUD tracker's gilt diamond, one per note. */}
              <span style={{ width: 4, height: 4, marginTop: 7, transform: "rotate(45deg)", border: `1px solid ${GOLD}`, flex: "0 0 auto" }} />
              <span style={{ opacity: 0.85 }}>{line}</span>
            </div>
          ))}
        </div>
      ))}
      </div>
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
 * older than the one the server wants. Below them, why this device cannot play
 * well. Stacked under the logo, in the panel's voice.
 */
function LiveNotices(): React.ReactElement | null {
  const live = useLiveConfig();
  const [dismissed, setDismissed] = React.useState<string | null>(dismissedId);
  const [device] = React.useState(() => deviceNotices(probeDevice(gpuRenderer())));
  const outdated = live.minBuiltAt !== undefined && live.minBuiltAt > BUILT_AT;
  const motd = live.motd && live.motd.id !== dismissed ? live.motd : null;
  if (!motd && !live.maintenance && !outdated && device.length === 0) return null;
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
      {device.map((n) => (
        <Notice key={n.id} testId={`device-${n.id}`} color={EMBER}>
          <span style={{ flex: 1 }}>{n.text}</span>
        </Notice>
      ))}
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
