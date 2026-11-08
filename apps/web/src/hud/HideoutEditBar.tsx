import React from "react";
import { decorById } from "@exiled/content-runtime";
import { DISPLAY, FramedPanel, GOLD, GOLD_DIM, MenuButton, PARCHMENT, SERIF } from "../menu/frames";
import { CARTOGRAPHER_NAME, VENDOR_NAME } from "../npc";
import { playSfx } from "../audio/sfx";

/** What a piece is called on the banner while it is in hand. */
const SERVICE_NAMES: Record<string, string> = {
  mapDevice: "Map Device", stash: "Stash", vendor: VENDOR_NAME, cartographer: CARTOGRAPHER_NAME,
};
const DECOR_NAMES: Record<string, string> = {
  "carto-table": "Atlas Table", "vendor-counter": `${VENDOR_NAME}'s Counter`,
};
const KIND_NAMES: Record<string, string> = {
  rug: "Rug", table: "Table", bench: "Bench", crate: "Crate", barrel: "Barrel", pillar: "Broken Column",
  brazier: "Brazier", bookshelf: "Bookshelf", cauldron: "Cauldron", grainSack: "Grain Sack", pot: "Amphora",
};

/**
 * The banner's two buttons hug their label with an icon in front: at the menu's
 * 180 px minimum the label sat off-centre with an empty band beside it.
 */
const BANNER_BUTTON: React.CSSProperties = { minWidth: 0, padding: "0 20px" };

export function pieceName(id: string): string {
  return SERVICE_NAMES[id] ?? DECOR_NAMES[id] ?? KIND_NAMES[decorById(id)?.kind ?? ""] ?? id;
}

/**
 * PoE's hideout menu: a small arrow above the right end of the experience line
 * opens it, and its one entry is Edit Hideout. While editing, a banner at the top
 * of the screen says how the mode works and carries Reset and Done.
 */
export function HideoutEditBar({
  right, bottom, active, hovered, carrying, valid, onToggle, onReset,
}: {
  /** px from the viewport's right edge to the end of the experience line. */
  right: number;
  /** px from the bottom to just above the experience line. */
  bottom: number;
  active: boolean;
  hovered: string | null;
  carrying: string | null;
  valid: boolean;
  onToggle: (on: boolean) => void;
  onReset: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  // Reset throws away the whole arrangement, so it asks twice.
  const [confirmReset, setConfirmReset] = React.useState(false);
  React.useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  const status = carrying
    ? valid ? `Placing ${pieceName(carrying)}` : `${pieceName(carrying)} cannot stand here`
    : hovered ? pieceName(hovered) : "Click a piece to pick it up";
  return (
    <>
      <button
        type="button"
        data-testid="hideout-menu-arrow"
        aria-label="Hideout menu"
        aria-expanded={open}
        onClick={() => { playSfx("ui-click"); setOpen((v) => !v); }}
        style={{
          position: "absolute",
          right: right + 6,
          bottom,
          width: 30,
          height: 18,
          padding: 0,
          border: `1px solid ${GOLD_DIM}`,
          borderBottom: "none",
          borderRadius: "5px 5px 0 0",
          background: "linear-gradient(180deg,#1b1610,#0b0907)",
          color: GOLD,
          fontSize: 11,
          lineHeight: "16px",
          cursor: "pointer",
          pointerEvents: "auto",
          zIndex: 3,
          boxShadow: "0 0 8px rgba(0,0,0,0.8)",
        }}
      >
        {open ? "▼" : "▲"}
      </button>
      {open && (
        <div
          data-testid="hideout-menu"
          style={{ position: "absolute", right: right + 6, bottom: bottom + 24, pointerEvents: "auto", zIndex: 4 }}
        >
          <MenuButton
            data-testid="edit-hideout-button"
            height={36}
            tone={active ? "primary" : "normal"}
            onClick={() => { onToggle(!active); setOpen(false); }}
          >
            {active ? "Stop Editing" : "Edit Hideout"}
          </MenuButton>
        </div>
      )}
      {active && (
        <FramedPanel
          data-testid="hideout-edit-banner"
          border={16}
          style={{
            position: "absolute",
            // At the very top: the map device and its portal arc stand just under it.
            top: 6,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 18px 10px",
            pointerEvents: "auto",
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            gap: 18,
            whiteSpace: "nowrap",
          }}
        >
          <div>
            <div style={{ fontFamily: DISPLAY, color: GOLD, fontSize: 18, letterSpacing: 3 }}>Edit Hideout</div>
            <div
              data-testid="hideout-edit-status"
              style={{ fontFamily: SERIF, fontSize: 14, color: carrying && !valid ? "#e08a7a" : PARCHMENT, marginTop: 2 }}
            >
              {status}
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, marginTop: 2 }}>
              Left click: pick up / place · Wheel: rotate · Right click or Esc: put back
            </div>
          </div>
          <MenuButton
            data-testid="hideout-edit-reset"
            height={34}
            tone={confirmReset ? "danger" : "normal"}
            style={BANNER_BUTTON}
            onClick={() => { if (confirmReset) { onReset(); setConfirmReset(false); } else setConfirmReset(true); }}
          >
            {confirmReset ? "Confirm?" : "↺ Reset"}
          </MenuButton>
          <MenuButton data-testid="hideout-edit-done" height={34} tone="primary" style={BANNER_BUTTON} onClick={() => onToggle(false)}>
            {"✓ Done"}
          </MenuButton>
        </FramedPanel>
      )}
    </>
  );
}
