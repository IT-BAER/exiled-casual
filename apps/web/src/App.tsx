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
import { GameView } from "./GameView";
import { MainMenu } from "./menu/MainMenu";
import { ModeDialog } from "./menu/ModeDialog";
import { CharacterSelect } from "./menu/CharacterSelect";
import { CreateCharacter } from "./menu/CreateCharacter";
import { MenuStage } from "./menu/MenuStage";
import { InfoScreen, OPTIONS_TEXT, CREDITS_TEXT } from "./menu/InfoScreen";
import { capFor, createCharacter, deleteCharacter, readRoster, type Mode } from "./save/roster";

type Screen =
  | { kind: "menu" }
  | { kind: "mode" }
  | { kind: "select" }
  | { kind: "create" }
  | { kind: "info"; which: "options" | "credits" }
  | { kind: "game"; characterId: string };

export function App(): React.ReactElement {
  const [screen, setScreen] = React.useState<Screen>({ kind: "menu" });
  const [roster, setRoster] = React.useState<RosterBlob>(emptyRoster);
  const [mode, setMode] = React.useState<Mode>("local");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [newClassId, setNewClassId] = React.useState<string>(DEFAULT_CLASS_ID);
  const [error, setError] = React.useState<string | null>(null);

  // One read at boot. Migration of a pre-roster save happens inside openRoster,
  // but it is not COMMITTED here: the first save writes the new shape, so a
  // player who only looks at the menu still has their old blob intact.
  React.useEffect(() => {
    let live = true;
    void readRoster().then((r) => {
      if (!live) return;
      setRoster(r);
      setSelectedId(r.lastPlayedId ?? r.characters[0]?.id ?? null);
    });
    return () => { live = false; };
  }, []);

  const rows = React.useMemo(() => headers(roster), [roster]);
  const selectedClassId =
    rows.find((c) => c.id === selectedId)?.classId ?? DEFAULT_CLASS_ID;

  if (screen.kind === "game") {
    return <GameView characterId={screen.characterId} onExit={() => setScreen({ kind: "select" })} />;
  }

  if (screen.kind === "info") {
    return (
      <InfoScreen
        title={screen.which === "options" ? "Options" : "Credits"}
        body={screen.which === "options" ? OPTIONS_TEXT : CREDITS_TEXT}
        onBack={() => setScreen({ kind: "menu" })}
      />
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
        <MenuStage classId={screen.kind === "create" ? newClassId : selectedClassId} />
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
      </>
    );
  }

  return (
    <>
      <MainMenu
        characterCount={rows.length}
        onPlay={() => setScreen({ kind: "mode" })}
        onOptions={() => setScreen({ kind: "info", which: "options" })}
        onCredits={() => setScreen({ kind: "info", which: "credits" })}
      />
      {screen.kind === "mode" && (
        <ModeDialog
          onCancel={() => setScreen({ kind: "menu" })}
          onPick={(picked) => {
            setMode(picked);
            setScreen({ kind: "select" });
          }}
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
