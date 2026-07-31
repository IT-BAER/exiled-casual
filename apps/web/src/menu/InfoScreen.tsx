/**
 * About: what this is, what it is built on, and where it lives.
 *
 * It was "Credits" and it was three paragraphs of attribution. A player who
 * opens this wants to know what they are playing and where to find it as much
 * as who made the animation pack, so the page carries the build, the licence
 * position and a link to the repository as well.
 *
 * Options used to live here too, as prose saying there was nothing to set. There
 * is now: it moved to `OptionsPanel`, which draws over what is behind it rather
 * than replacing the screen, so this is the one plain page left.
 */
import React from "react";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import { GAME_VERSION } from "../version";
import { Atmosphere, type BrazierSpot } from "./atmos";
import { Divider, FramedPanel, GOLD, MENU_ART, MenuButton, PARCHMENT, DISPLAY, SERIF } from "./frames";

/** Same painting as the main menu, so the same two fires. */
const BRAZIERS: readonly BrazierSpot[] = [
  { x: 0.525, y: 0.819, r: 0.045, flame: 0.024, phase: 0 },
  { x: 0.750, y: 0.816, r: 0.075, flame: 0.048, phase: 2.4 },
];

/** Where the source lives. The one link on the page, and it opens in a tab. */
export const REPO_URL = "https://github.com/IT-BAER/exiled-casual";

export const CREDITS_TEXT = [
  "Exiled Casual is a browser ARPG: you take a waystone, open a map, kill what is in it and come home richer. It is an original fan project, built in the open with Claude Code.",
  "It draws on Path of Exile 1 and 2 for its shape and its feel, and takes the better of the two wherever they differ. No game data, art or branding from either is used or shipped.",
  "The character's body and its animation are CC0 packs by Quaternius: Modular Character Outfits and the Universal Animation Library. The wardrobe is rebuilt from them here, and its head, coat and hood are generated.",
  "The brazier flames are baked from Matthew Ames's royalty-free Animated Fire Sprite on Blendkit. The environments, props, interface, item art and maps are made for this project.",
  `This build is ${GAME_VERSION}, on content ${CONTENT_VERSION}. Alpha means a save may not survive an update.`,
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
          <div style={{ fontFamily: DISPLAY, fontSize: 20, letterSpacing: 4, textTransform: "uppercase", color: GOLD, textAlign: "center" }}>
            {title}
          </div>
          <Divider style={{ margin: "10px 0 16px" }} />
          {body.map((p) => (
            <p key={p} style={{ fontFamily: SERIF, fontSize: 14, color: PARCHMENT, lineHeight: 1.6, marginBottom: 12 }}>
              {p}
            </p>
          ))}
          {/* The source, and the place to report anything the game does wrong. */}
          <p style={{ fontFamily: SERIF, fontSize: 14, color: PARCHMENT, lineHeight: 1.6, marginBottom: 12 }}>
            {"Source, issues and releases: "}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: GOLD, textDecoration: "none", borderBottom: `1px solid ${GOLD}` }}
            >
              github.com/IT-BAER/exiled-casual
            </a>
          </p>
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
