/**
 * Character select.
 *
 * Composed from PoE1's own (reference-screenshots/character-selection.png): the
 * hall on the left with the characters standing in it, a tall framed roster on
 * the right, one row per character carrying a portrait, a name, a level and a
 * class, and CREATE / DELETE / PLAY along the foot.
 *
 * Two departures, both deliberate. The reference's LOG OUT goes back to an
 * account; ours goes back to the main menu, because there is no account to
 * leave. And CREATE is capped in local mode, with the cap's reason on the
 * button, because one save file is one character until there is a server to
 * arbitrate more.
 *
 * Deleting a character is the only irreversible thing in these screens, so it
 * asks for the name to be typed. The save is a single atomic blob: once it is
 * written, the character is gone with it.
 */
import React from "react";
import type { CharacterHeader } from "@exiled/persistence";
import { characterClass } from "@exiled/content-runtime";
import { Atmosphere, type BrazierSpot } from "./atmos";
import { Divider, FramedPanel, GOLD, GOLD_DIM, MENU_ART, MenuButton, PARCHMENT, DISPLAY, SERIF } from "./frames";

/** The braziers painted into `select_backdrop.jpg`, as fractions of the viewport. */
/**
 * The hall's two braziers, as fractions of `select_backdrop.jpg`. `flame: 0`:
 * the painting draws its own fire and these two are thirty pixels tall across
 * the room, so all this layer owes them is the flicker.
 */
const BRAZIERS: readonly BrazierSpot[] = [
  { x: 0.224, y: 0.611, r: 0.052, flame: 0, phase: 0 },
  { x: 0.776, y: 0.615, r: 0.052, flame: 0, phase: 3.1 },
];

export interface CharacterSelectProps {
  characters: readonly CharacterHeader[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onBack: () => void;
  onOptions: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  /** How many characters this world holds. Local is one; online is uncapped. */
  cap: number;
}

export function CharacterSelect({
  characters,
  selectedId,
  onSelect,
  onPlay,
  onCreate,
  onDelete,
  onBack,
  onOptions,
  onExport,
  onImport,
  cap,
}: CharacterSelectProps): React.ReactElement {
  const [confirming, setConfirming] = React.useState<CharacterHeader | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const selected = characters.find((c) => c.id === selectedId) ?? null;
  const full = characters.length >= cap;

  // Arrow keys walk the roster, Enter plays it, Escape backs out. A list you can
  // only reach with the mouse is a list, not a menu.
  React.useEffect(() => {
    if (confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onBack(); return; }
      if (characters.length === 0) return;
      const at = characters.findIndex((c) => c.id === selectedId);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = characters[(at + step + characters.length) % characters.length];
        if (next) onSelect(next.id);
      } else if (e.key === "Enter" && selectedId !== null) {
        onPlay(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [characters, selectedId, confirming, onBack, onSelect, onPlay]);

  return (
    <div data-testid="character-select" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Atmosphere backdrop={`${MENU_ART}/select_backdrop.jpg`} braziers={BRAZIERS} />

      <FramedPanel
        style={{
          position: "absolute",
          right: "2vw",
          top: "3vh",
          bottom: "3vh",
          width: "min(30vw, 460px)",
          display: "flex",
          flexDirection: "column",
          padding: 14,
          gap: 10,
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <MenuButton height={36} style={{ flex: 1, minWidth: 0 }} onClick={onBack}>
            Back
          </MenuButton>
          <MenuButton height={36} style={{ flex: 1, minWidth: 0 }} onClick={onOptions}>
            Options
          </MenuButton>
        </div>

        <Divider />

        <div style={{ display: "flex", gap: 8 }}>
          <MenuButton height={34} style={{ flex: 1, minWidth: 0 }} onClick={onExport}>Export</MenuButton>
          <MenuButton height={34} style={{ flex: 1, minWidth: 0 }} onClick={() => importRef.current?.click()}>Import</MenuButton>
          <input
            ref={importRef}
            aria-label="Import save"
            type="file"
            accept="application/json,.json"
            onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) onImport(file); e.currentTarget.value = ""; }}
            style={{ display: "none" }}
          />
        </div>

        <Divider />

        <div
          data-testid="roster"
          role="listbox"
          aria-label="Characters"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}
        >
          {characters.length === 0 ? (
            <EmptyRoster />
          ) : (
            characters.map((c) => (
              <Row
                key={c.id}
                character={c}
                selected={c.id === selectedId}
                onSelect={() => onSelect(c.id)}
                onPlay={() => onPlay(c.id)}
              />
            ))
          )}
        </div>

        <Divider />

        <div style={{ display: "flex", gap: 8 }}>
          <MenuButton
            height={40}
            style={{ flex: 1, minWidth: 0 }}
            onClick={onCreate}
            disabled={full}
            title={
              full
                ? `This world holds ${cap === 1 ? "one character" : `${cap} characters`}. Several characters arrive with online mode.`
                : undefined
            }
          >
            Create
          </MenuButton>
          <MenuButton
            height={40}
            tone="danger"
            style={{ flex: 1, minWidth: 0 }}
            disabled={selected === null}
            onClick={() => setConfirming(selected)}
          >
            Delete
          </MenuButton>
          <MenuButton
            height={40}
            tone="primary"
            style={{ flex: 1, minWidth: 0 }}
            disabled={selected === null}
            onClick={() => selected && onPlay(selected.id)}
          >
            Play
          </MenuButton>
        </div>
      </FramedPanel>

      {confirming && (
        <ConfirmDelete
          character={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const id = confirming.id;
            setConfirming(null);
            onDelete(id);
          }}
        />
      )}
    </div>
  );
}

function EmptyRoster(): React.ReactElement {
  return (
    <div
      style={{
        margin: "auto",
        textAlign: "center",
        fontFamily: SERIF,
        color: GOLD_DIM,
        fontSize: 14,
        lineHeight: 1.6,
        padding: "0 18px",
      }}
    >
      No one here yet.
      <br />
      Create a character to begin.
    </div>
  );
}

function Row({
  character,
  selected,
  onSelect,
  onPlay,
}: {
  character: CharacterHeader;
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
}): React.ReactElement {
  const klass = characterClass(character.classId);
  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid={`row-${character.id}`}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onPlay}
      onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); onSelect(); } }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 58,
        padding: "0 10px 0 0",
        cursor: "pointer",
        backgroundImage: `url(${MENU_ART}/row_plate.png)`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        // The plate carries the row; selection is light on it plus a gilt edge,
        // never a second plate, so nothing shifts when the selection moves.
        filter: selected ? "brightness(1.5) saturate(1.15)" : "brightness(0.92)",
        outline: selected ? `1px solid ${GOLD}` : "1px solid transparent",
        outlineOffset: -2,
      }}
    >
      <img
        src={klass.portrait}
        alt=""
        style={{ width: 46, height: 46, margin: "0 0 0 6px", objectFit: "cover", flex: "0 0 auto" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 15,
            letterSpacing: 1.2,
            color: selected ? "#f6e6bd" : PARCHMENT,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {character.name}
        </div>
        <div style={{ fontFamily: DISPLAY, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: GOLD_DIM }}>
          Level {character.level} {klass.name}
        </div>
      </div>
      <div style={{ fontFamily: DISPLAY, fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase", color: GOLD_DIM }}>
        {character.league}
      </div>
    </div>
  );
}

/**
 * Typing the name is the gate, as PoE has it. A yes/no on a single atomic blob
 * write is one misclick away from someone's whole save.
 */
function ConfirmDelete({
  character,
  onCancel,
  onConfirm,
}: {
  character: CharacterHeader;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const [typed, setTyped] = React.useState("");
  const matches = typed.trim().toLowerCase() === character.name.toLowerCase();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="confirm-delete"
      role="dialog"
      aria-modal="true"
      aria-label={`Delete ${character.name}`}
      style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,4,6,0.76)", zIndex: 3 }}
    >
      <FramedPanel style={{ width: "min(44vw, 560px)", padding: "16px 22px 18px" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: 3, textTransform: "uppercase", color: "#e8b7a2", textAlign: "center" }}>
          Delete {character.name}
        </div>
        <Divider style={{ margin: "10px 0 14px" }} />
        <div style={{ fontFamily: SERIF, fontSize: 13, color: "#a9a290", lineHeight: 1.55 }}>
          Level {character.level} and everything carried. This cannot be undone.
          Type the name to confirm.
        </div>
        <input
          data-testid="confirm-name"
          value={typed}
          autoFocus
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && matches) onConfirm(); }}
          aria-label="Type the character name"
          style={INPUT_STYLE}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <MenuButton height={38} style={{ minWidth: 130 }} onClick={onCancel}>
            Cancel
          </MenuButton>
          <MenuButton height={38} style={{ minWidth: 130 }} tone="danger" disabled={!matches} onClick={onConfirm}>
            Delete
          </MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}

/**
 * The client had no text input at all until this screen (see index.html), so
 * every inherited rule that assumed that has to be undone here: selection is
 * turned back on and the caret has to be allowed to appear.
 */
export const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "9px 12px",
  background: "rgba(0,0,0,0.55)",
  border: `1px solid ${GOLD_DIM}`,
  color: PARCHMENT,
  fontFamily: SERIF,
  fontSize: 15,
  letterSpacing: 1.4,
  outline: "none",
  userSelect: "text",
  WebkitUserSelect: "text",
};
