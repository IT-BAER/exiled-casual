/**
 * Options and Credits.
 *
 * The reference has both as buttons on the main menu, so both exist here rather
 * than as buttons that do nothing. Options is honest about holding nothing yet:
 * every setting the client has is currently a constant in the source, and a
 * screen of sliders that write to nowhere is worse than a screen that says so.
 */
import React from "react";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import { Atmosphere, type BrazierSpot } from "./atmos";
import { Divider, FramedPanel, GOLD, MENU_ART, MenuButton, PARCHMENT, SERIF } from "./frames";

/** Same painting as the main menu, so the same two fires. */
const BRAZIERS: readonly BrazierSpot[] = [
  { x: 0.525, y: 0.819, r: 0.045, flame: 0.024, phase: 0 },
  { x: 0.750, y: 0.816, r: 0.075, flame: 0.048, phase: 2.4 },
];

export const OPTIONS_TEXT = [
  "There is nothing to set yet.",
  "Resolution follows the window, and the camera keeps its own zoom between runs. Audio is a single drop cue and no bed to balance it against.",
  "When there are settings worth keeping, they will be saved beside the characters, not in a separate file.",
];

export const CREDITS_TEXT = [
  "Exiled Casual is an original fan project, built in the open with Claude Code.",
  "It draws on Path of Exile 1 and 2 for its shape and its feel, and takes the better of the two wherever they differ. No game data, art or branding from either is used or shipped.",
  "The character's body and its animation are CC0 packs by Quaternius: Modular Character Outfits and the Universal Animation Library. The wardrobe is rebuilt from them here, and its head, coat and hood are generated.",
  "Everything else is made for this project: the environments, the props, the interface, the item art and the maps.",
  `Content version ${CONTENT_VERSION}.`,
];

export function InfoScreen({
  title,
  body,
  onBack,
}: {
  title: string;
  body: readonly string[];
  onBack: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div data-testid="info-screen" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Atmosphere backdrop={`${MENU_ART}/menu_backdrop.jpg`} braziers={BRAZIERS} />
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 2 }}>
        <FramedPanel style={{ width: "min(52vw, 700px)", padding: "18px 26px 20px" }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, letterSpacing: 4, textTransform: "uppercase", color: GOLD, textAlign: "center" }}>
            {title}
          </div>
          <Divider style={{ margin: "10px 0 16px" }} />
          {body.map((p) => (
            <p key={p} style={{ fontFamily: SERIF, fontSize: 14, color: PARCHMENT, lineHeight: 1.6, marginBottom: 12 }}>
              {p}
            </p>
          ))}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
            <MenuButton height={40} style={{ minWidth: 160 }} onClick={onBack} autoFocus>
              Back
            </MenuButton>
          </div>
        </FramedPanel>
      </div>
    </div>
  );
}
