/**
 * Creating a character: a name and a class.
 *
 * The class is cosmetic (see `@exiled/content-runtime/classes`), and the screen
 * says so rather than implying a build choice that does not exist yet. What it
 * does do is show the character: picking a class dresses the live rig on the
 * left in that class's starting gear, which is the only honest preview, because
 * it is the same wardrobe code the game runs.
 */
import React from "react";
import { CLASS_LIST } from "@exiled/content-runtime";
import { NAME_MAX, nameError, type RosterBlob } from "@exiled/persistence";
import { Atmosphere, type BrazierSpot } from "./atmos";
import { INPUT_STYLE } from "./CharacterSelect";
import { Divider, FramedPanel, GOLD, GOLD_DIM, MENU_ART, MenuButton, PARCHMENT, DISPLAY, SERIF } from "./frames";

/**
 * The hall's two braziers, as fractions of `select_backdrop.jpg`. `flame: 0`:
 * the painting draws its own fire and these two are thirty pixels tall across
 * the room, so all this layer owes them is the flicker.
 */
const BRAZIERS: readonly BrazierSpot[] = [
  { x: 0.224, y: 0.611, r: 0.052, flame: 0, phase: 0 },
  { x: 0.776, y: 0.615, r: 0.052, flame: 0, phase: 3.1 },
];

export interface CreateCharacterProps {
  roster: RosterBlob;
  classId: string;
  onClassChange: (id: string) => void;
  onCreate: (name: string, classId: string) => void;
  onCancel: () => void;
}

export function CreateCharacter({
  roster,
  classId,
  onClassChange,
  onCreate,
  onCancel,
}: CreateCharacterProps): React.ReactElement {
  const [name, setName] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const error = nameError(roster, name);
  const chosen = CLASS_LIST.find((c) => c.id === classId) ?? CLASS_LIST[0]!;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    setTouched(true);
    if (error === null) onCreate(name.trim(), chosen.id);
  };

  return (
    <div data-testid="create-character" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
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
        <div style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: 3.5, textTransform: "uppercase", color: GOLD, textAlign: "center" }}>
          New character
        </div>
        <Divider />

        <div
          role="radiogroup"
          aria-label="Class"
          data-testid="class-picker"
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          {CLASS_LIST.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === chosen.id}
              data-testid={`class-${c.id}`}
              onClick={() => onClassChange(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0 10px 0 0",
                height: 58,
                cursor: "pointer",
                border: c.id === chosen.id ? `1px solid ${GOLD}` : "1px solid transparent",
                background: `url(${MENU_ART}/row_plate.png) 0 0 / 100% 100% no-repeat`,
                filter: c.id === chosen.id ? "brightness(1.5) saturate(1.15)" : "brightness(0.92)",
                textAlign: "left",
              }}
            >
              <img src={c.portrait} alt="" style={{ width: 46, height: 46, marginLeft: 6, objectFit: "cover", flex: "0 0 auto" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: SERIF, fontSize: 15, letterSpacing: 1.4, color: PARCHMENT }}>{c.name}</div>
                <div style={{ fontFamily: DISPLAY, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: GOLD_DIM }}>
                  {c.archetype}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div style={{ fontFamily: SERIF, fontSize: 13, color: "#a9a290", lineHeight: 1.55, minHeight: 40 }}>
          {chosen.blurb}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 11, color: GOLD_DIM, lineHeight: 1.5 }}>
          Class picks how you look and what you start in. It does not change your
          numbers yet.
        </div>

        <div style={{ flex: 1 }} />

        <label style={{ fontFamily: DISPLAY, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: GOLD_DIM }}>
          Name
          <input
            data-testid="name-input"
            value={name}
            autoFocus
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={INPUT_STYLE}
          />
        </label>
        <div
          data-testid="name-error"
          style={{ minHeight: 18, fontFamily: SERIF, fontSize: 12, color: "#d08a6c" }}
        >
          {touched && error !== null ? error : ""}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <MenuButton height={40} style={{ flex: 1, minWidth: 0 }} onClick={onCancel}>
            Cancel
          </MenuButton>
          <MenuButton
            height={40}
            tone="primary"
            style={{ flex: 1, minWidth: 0 }}
            onClick={submit}
            disabled={error !== null}
          >
            Create
          </MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}
