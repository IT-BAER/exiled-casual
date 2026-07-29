/**
 * Which world does this character live in.
 *
 * Asked once, before the roster is ever shown, because it is the one choice that
 * cannot be undone afterwards: local and online characters are separate pools
 * with no import in either direction (docs/specs/2026-07-28-accounts-and-online-
 * mode-design.md), and the reason is that a local save is a file the player owns
 * and the server has never seen a single command of.
 *
 * Online is offered and refused in the same breath. Hiding it would be tidier
 * and would also hide the shape of the game from the person deciding whether to
 * start a character at all.
 */
import React from "react";
import { LOCAL_CHARACTER_CAP } from "@exiled/persistence";
import type { Mode } from "../save/roster";
import { Divider, FramedPanel, GOLD, GOLD_DIM, MenuButton, PARCHMENT, SERIF } from "./frames";

export function ModeDialog({
  onPick,
  onCancel,
}: {
  onPick: (mode: Mode) => void;
  onCancel: () => void;
}): React.ReactElement {
  // Escape backs out of a dialog. Anywhere else in these screens it means the
  // same thing, so it has to mean it here too.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="mode-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a world"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(3,4,6,0.72)",
        backdropFilter: "blur(2px)",
        zIndex: 3,
      }}
    >
      <FramedPanel style={{ width: "min(52vw, 720px)", padding: "16px 22px 20px" }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 20,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: GOLD,
            textAlign: "center",
          }}
        >
          Choose a world
        </div>
        <Divider style={{ margin: "10px 0 16px" }} />

        <Choice
          title="Local"
          body={`Saved in this browser and nowhere else. Works with no connection. Holds ${
            LOCAL_CHARACTER_CAP === 1 ? "one character" : `${LOCAL_CHARACTER_CAP} characters`
          }.`}
          action={<MenuButton tone="primary" onClick={() => onPick("local")} autoFocus>Play local</MenuButton>}
        />

        <Choice
          title="Online"
          body="Not built yet. It brings an account, several characters and a stash the server keeps. A local character can never move across, so this is worth waiting for if you want one."
          dim
          action={
            <MenuButton
              disabled
              title="Online mode is not implemented yet."
              onClick={() => onPick("online")}
            >
              Coming soon
            </MenuButton>
          }
        />

        <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
          <MenuButton onClick={onCancel} height={38} style={{ minWidth: 140 }}>
            Back
          </MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}

function Choice({
  title,
  body,
  action,
  dim = false,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
  dim?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "12px 8px",
        borderTop: `1px solid ${GOLD_DIM}33`,
        opacity: dim ? 0.72 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 16,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: dim ? GOLD_DIM : PARCHMENT,
          }}
        >
          {title}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 13, color: "#a9a290", lineHeight: 1.5, marginTop: 4 }}>
          {body}
        </div>
      </div>
      {action}
    </div>
  );
}
