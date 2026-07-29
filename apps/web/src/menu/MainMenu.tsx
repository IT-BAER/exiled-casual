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
import { CONTENT_VERSION } from "@exiled/content-runtime";
import { Atmosphere, type BrazierSpot } from "./atmos";
import { Divider, FramedPanel, GOLD, GOLD_DIM, MENU_ART, MenuButton, PARCHMENT, SERIF } from "./frames";

/**
 * The two braziers painted into `menu_backdrop.jpg`, as fractions of THAT IMAGE
 * (see `BrazierSpot`). Found by thresholding the art for warm pixels rather than
 * by eye, and the reflection in the flood water had to be excluded from the
 * cluster or every flame sat half a bowl too low.
 */
const BRAZIERS: readonly BrazierSpot[] = [
  { x: 0.525, y: 0.819, r: 0.045, flame: 0.024, phase: 0 },
  { x: 0.750, y: 0.816, r: 0.075, flame: 0.048, phase: 2.4 },
];

export interface MainMenuProps {
  /** How many characters the save holds. Shown in the boot log, like PoE's login log. */
  characterCount: number;
  onPlay: () => void;
  onOptions: () => void;
  onCredits: () => void;
}

export function MainMenu({
  characterCount,
  onPlay,
  onOptions,
  onCredits,
}: MainMenuProps): React.ReactElement {
  return (
    <div data-testid="main-menu" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Atmosphere backdrop={`${MENU_ART}/menu_backdrop.jpg`} braziers={BRAZIERS} />

      <img
        src={`${MENU_ART}/logo.png`}
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
          <MenuButton tone="primary" onClick={onPlay} autoFocus>
            Play
          </MenuButton>
          <MenuButton onClick={onOptions}>Options</MenuButton>
          <MenuButton onClick={onCredits}>Credits</MenuButton>
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
        Exiled Casual {CONTENT_VERSION}
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
          fontFamily: SERIF,
          fontSize: 13,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: GOLD,
        }}
      >
        Latest
      </div>
      <Divider style={{ margin: "2px 0 6px" }} />
      <div style={{ fontFamily: SERIF, fontSize: 14, color: PARCHMENT, lineHeight: 1.45 }}>
        Characters have names now, and a hall to be chosen in.
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, lineHeight: 1.5 }}>
        Maps are assembled from authored chunks across four biomes. Loot rolls
        prefixes and suffixes, and the stash is shared by everyone you make.
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
