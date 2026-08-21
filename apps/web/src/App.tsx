/**
 * Which screen the client is on.
 *
 * Everything the game itself does lives in `GameView`, unchanged; this file's
 * only job is to decide whether that component exists yet. That matters more
 * than routing usually does here: `GameView` builds a Babylon engine and spawns
 * the simulation worker on mount, so keeping it unmounted is the difference
 * between a menu and a menu with a whole ARPG running behind it.
 *
 * The roster is loaded once, up front, and held here. Both the select screen and
 * the create screen read from it and hand back the version they wrote, so there
 * is one copy in the client and it is never re-read behind a screen's back.
 */
import React from "react";
import type { RosterBlob } from "@exiled/persistence";
import { emptyRoster, headers } from "@exiled/persistence";
import { DEFAULT_CLASS_ID } from "@exiled/rules";
import { MainMenu } from "./menu/MainMenu";
import { ModeDialog } from "./menu/ModeDialog";
import { CharacterSelect } from "./menu/CharacterSelect";
import { CreateCharacter } from "./menu/CreateCharacter";
import { LoadingScreen, LOADING_ART } from "./LoadingScreen";
import { pickTip } from "./tips";
import { InfoScreen, CREDITS_TEXT } from "./menu/InfoScreen";
import { OptionsPanel } from "./menu/OptionsPanel";

/**
 * The two screens that own a Babylon engine, split out of the entry bundle.
 *
 * They were the only things dragging `@babylonjs/core` into it, and it was one
 * chunk: 5.5 MB had to arrive before the main menu could paint its title. Now
 * the menu's own art is the first thing down the wire and Babylon follows only
 * when a screen that needs it is actually reached.
 *
 * `lazy` wants a default export and both of these are named, hence the unwrap.
 */
const GameView = React.lazy(() => import("./GameView").then((m) => ({ default: m.GameView })));
const MenuStage = React.lazy(() => import("./menu/MenuStage").then((m) => ({ default: m.MenuStage })));
/** The dev asset viewer. Lazy for the same reason: it owns an engine too. */
const AssetViewer = React.lazy(() =>
  import("./dev/AssetViewer").then((m) => ({ default: m.AssetViewer })),
);
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { setTitle } from "./title";
import { setDebugLogging } from "./debug";
import { setSoundMix } from "./audio/drop-sound";
import { preloadSfx } from "./audio/sfx";
import { warmMenuStage } from "./menu/warm-stage";
import {
  capFor,
  createCharacter,
  deleteCharacter,
  exportRoster,
  importRoster,
  readRoster,
  saveSettingsSoon,
  settingsOf,
  type Mode,
} from "./save/roster";

type Screen =
  | { kind: "menu" }
  | { kind: "mode" }
  | { kind: "select" }
  | { kind: "create" }
  | { kind: "info"; which: "about" }
  | { kind: "game"; characterId: string }
  | { kind: "viewer" };

/** `?play` in the URL: see the roster effect below. Read once, outside render. */
const AUTOPLAY =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("play");

/**
 * `?viewer`: open the asset viewer instead of the menu.
 *
 * DEV only, both here and at the button below. It is a workshop screen with the
 * whole wardrobe on it, and shipping it would hand a player every unearned look
 * in the game as a dropdown.
 */
const VIEWER =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("viewer");
const DEV = import.meta.env?.DEV === true;

/** How long the menu keeps the wire to itself before the stage warms behind it. */
const WARM_DELAY_MS = 400;

export function App(): React.ReactElement {
  const [screen, setScreen] = React.useState<Screen>(
    DEV && VIEWER ? { kind: "viewer" } : { kind: "menu" },
  );
  const [roster, setRoster] = React.useState<RosterBlob>(emptyRoster);
  const [mode, setMode] = React.useState<Mode>("local");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [newClassId, setNewClassId] = React.useState<string>(DEFAULT_CLASS_ID);
  const [error, setError] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS);
  // An overlay, not a screen: the plate draws Options OVER what is behind it.
  const [optionsOpen, setOptionsOpen] = React.useState(false);

  // One read at boot. Migration of a pre-roster save happens inside openRoster,
  // but it is not COMMITTED here: the first save writes the new shape, so a
  // player who only looks at the menu still has their old blob intact.
  React.useEffect(() => {
    let live = true;
    void readRoster().then((r) => {
      if (!live) return;
      setRoster(r);
      setSettings(settingsOf(r));
      const first = r.lastPlayedId ?? r.characters[0]?.id ?? null;
      setSelectedId(first);
      // `?play` walks straight into the world with the last character, so a
      // driven browser can reach the game without three clicks it cannot see
      // (the menus are canvas-adjacent and the mode dialog remounts under a
      // snapshot). DEV only: this is a test hook, not a shortcut we ship.
      if (DEV && first && AUTOPLAY && !VIEWER) setScreen({ kind: "game", characterId: first });
    });
    return () => { live = false; };
  }, []);

  /**
   * Applies live and writes debounced, which is what buys the panel its missing
   * SAVE button. Sound is module state on the audio module, so setting it here
   * covers the menu and the game at once; graphics need a scene and are applied
   * by whoever owns one.
   */
  const changeSettings = React.useCallback(
    (next: Settings) => {
      setSettings(next);
      setSoundMix(next.sound);
      saveSettingsSoon(roster, next);
    },
    [roster],
  );

  // The saved volume has to reach the audio module even if Options is never opened.
  React.useEffect(() => {
    setSoundMix(settings.sound);
  }, [settings.sound]);

  // Module state on debug.ts for the same reason sound is: one place covers the
  // menu and the game, and a logger that only starts when Options is opened
  // would miss the boot it was switched on to explain.
  React.useEffect(() => {
    setDebugLogging(settings.ui.debugLogging);
  }, [settings.ui.debugLogging]);

  // The menu's own cues, fetched before the first press rather than by it: playSfx
  // starts the load and returns silent, so without this the first click of a fresh
  // page is the one click nobody hears. GameView still preloads CORE_SFX for the
  // rest; a context created here is suspended until that first click resumes it.
  React.useEffect(() => {
    void preloadSfx(["ui-click", "ui-hover", "ui-panel-open"]);
  }, []);

  // The figure in the hall, fetched from the menu rather than by the click that
  // reaches him. His chunk, his wardrobe and his clips are the same whoever is
  // picked, so the roster screen has no reason to be where that download starts;
  // see menu/warm-stage. Held off the first frames so the menu's own art is
  // never the thing queued behind it.
  React.useEffect(() => {
    if (screen.kind !== "menu" && screen.kind !== "mode") return;
    const t = setTimeout(() => void warmMenuStage(), WARM_DELAY_MS);
    return () => clearTimeout(t);
  }, [screen.kind]);

  const rows = React.useMemo(() => headers(roster), [roster]);
  /**
   * Null when nobody is selected, and NOT a default class.
   *
   * Falling back to `DEFAULT_CLASS_ID` here reads as harmless and is not: it
   * turns "no character" into "some character", so an empty roster still stood
   * a full figure in the hall and deleting your last one left him behind, wearing
   * a class nobody owned. `MenuStage` takes the null and empties the hall.
   */
  const selectedClassId = rows.find((c) => c.id === selectedId)?.classId ?? null;

  /**
   * The line the Suspense plate reads while the game's chunk arrives. Held in
   * state rather than picked in the render body: App re-renders on every roster
   * and settings change, and a tip that reshuffles mid-sentence is unreadable.
   */
  const [bootTip] = React.useState(() => pickTip());

  // The tab follows the screen. The game screen sets its own, from the area it
  // is standing in, so it is left alone here.
  React.useEffect(() => {
    const where: Partial<Record<Screen["kind"], string>> = {
      select: "Characters",
      create: "New Character",
      info: "About",
    };
    if (screen.kind !== "game") setTitle(where[screen.kind] ?? null);
  }, [screen.kind]);

  if (screen.kind === "game") {
    return (
      // The plate covers the chunk arriving as well as the world being built:
      // GameView raises its own the moment it mounts, so the two are continuous
      // and the player sees one screen rather than a gap and then a screen.
      // "Hideout" is not a guess — a session always begins standing in it.
      <React.Suspense
        fallback={
          <LoadingScreen areaName="Hideout" tip={bootTip} wallpaper={`${LOADING_ART}/hideout.jpg`} />
        }
      >
        <GameView
          characterId={screen.characterId}
          settings={settings}
          onSettingsChange={changeSettings}
          onExit={() => setScreen({ kind: "select" })}
        />
      </React.Suspense>
    );
  }

  if (screen.kind === "viewer") {
    return (
      <React.Suspense fallback={null}>
        <AssetViewer onExit={() => setScreen({ kind: "menu" })} />
      </React.Suspense>
    );
  }

  if (screen.kind === "info") {
    return (
      <InfoScreen title="About" body={CREDITS_TEXT} onBack={() => setScreen({ kind: "menu" })} />
    );
  }

  if (screen.kind === "select" || screen.kind === "create") {
    const cap = capFor(mode);
    return (
      <>
        {/* One stage for both screens. Rendered here rather than inside either,
            because React reconciles by tree position: a stage owned by the
            select screen would be torn down and rebuilt (engine, wardrobe fetch,
            idle restart) the moment CREATE swapped one screen for the other.
            It layers by z-index, not by document order — see menu/MenuStage. */}
        {/* No fallback worth drawing: the hall is painted art and the stage only
            adds the figure standing in it. A spinner over a backdrop would be a
            worse wait than an empty hall that fills in. */}
        <React.Suspense fallback={null}>
          <MenuStage classId={screen.kind === "create" ? newClassId : selectedClassId} />
        </React.Suspense>
        {screen.kind === "select" ? (
          <CharacterSelect
            characters={rows}
            selectedId={selectedId}
            cap={cap}
            onSelect={setSelectedId}
            onPlay={(id) => setScreen({ kind: "game", characterId: id })}
            onCreate={() => setScreen({ kind: "create" })}
            onDelete={(id) => {
              void deleteCharacter(roster, id).then((next) => {
                setRoster(next);
                setSelectedId(next.lastPlayedId ?? next.characters[0]?.id ?? null);
              });
            }}
            onBack={() => setScreen({ kind: "menu" })}
            onOptions={() => setOptionsOpen(true)}
            onExport={() => {
              const blob = new Blob([exportRoster(roster)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `exiled-casual-save-${new Date().toISOString().slice(0, 10)}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
            onImport={(file) => {
              void file.text().then((text) => {
                if (!window.confirm("Importing replaces the current local save. Continue?")) return;
                return importRoster(text).then((next) => {
                  setRoster(next);
                  setSettings(settingsOf(next));
                  setSelectedId(next.lastPlayedId ?? next.characters[0]?.id ?? null);
                });
              }).catch((e: unknown) => setError(String(e instanceof Error ? e.message : e)));
            }}
          />
        ) : (
          <CreateCharacter
            roster={roster}
            classId={newClassId}
            onClassChange={setNewClassId}
            onCancel={() => setScreen({ kind: "select" })}
            onCreate={(name, classId) => {
              void createCharacter(roster, { name, classId }, mode)
                .then(({ roster: next, record }) => {
                  setRoster(next);
                  setSelectedId(record.id);
                  setScreen({ kind: "select" });
                })
                // A failed write must not look like a created character. The only
                // ways here are a full roster or storage the browser refused.
                .catch((e: unknown) => setError(String(e instanceof Error ? e.message : e)));
            }}
          />
        )}
        {error !== null && <Toast text={error} onDismiss={() => setError(null)} />}
        {optionsOpen && (
          <OptionsPanel
            settings={settings}
            onChange={changeSettings}
            onClose={() => setOptionsOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <MainMenu
        characterCount={rows.length}
        onPlay={() => setScreen({ kind: "mode" })}
        onOptions={() => setOptionsOpen(true)}
        onAbout={() => setScreen({ kind: "info", which: "about" })}
      />
      {/* A corner tab, not a menu entry: the main menu is painted art with a
          fixed set of plates, and a sixth one that only exists in dev would
          change the composition of a screen we judge against a reference. */}
      {DEV && (
        <button
          type="button"
          data-testid="dev-viewer"
          onClick={() => setScreen({ kind: "viewer" })}
          style={{
            position: "absolute", right: 8, bottom: 8, zIndex: 40,
            padding: "3px 9px", cursor: "pointer",
            background: "rgba(10,10,12,0.8)", border: "1px solid #2b2b31",
            color: "#8a8a95", font: '11px ui-monospace, "Cascadia Mono", monospace',
          }}
        >
          assets
        </button>
      )}
      {screen.kind === "mode" && (
        <ModeDialog
          onCancel={() => setScreen({ kind: "menu" })}
          onPick={(picked) => {
            setMode(picked);
            setScreen({ kind: "select" });
          }}
        />
      )}
      {optionsOpen && (
        <OptionsPanel
          settings={settings}
          onChange={changeSettings}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </>
  );
}

/** A write that failed has to say so somewhere the player is already looking. */
function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }): React.ReactElement {
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div
      role="alert"
      data-testid="menu-toast"
      onClick={onDismiss}
      style={{
        position: "absolute",
        left: "50%",
        bottom: "6vh",
        transform: "translateX(-50%)",
        padding: "10px 18px",
        background: "rgba(24,8,6,0.94)",
        border: "1px solid #7a3524",
        color: "#e8b7a2",
        fontFamily: '"Cinzel", Georgia, serif',
        fontSize: 13,
        letterSpacing: 1.2,
      }}
    >
      {text}
    </div>
  );
}
