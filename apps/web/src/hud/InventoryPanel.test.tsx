// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ITEM_POOLS, baseOf, WISDOM_SCROLL_BASE_ID } from "@exiled/content-runtime";
import { InventoryPanel } from "./InventoryPanel";
import { VENDOR_NAME, VENDOR_TITLE } from "../npc";

afterEach(cleanup);

// jsdom has no PointerEvent, so `fireEvent.pointerDown` drops clientX/clientY and the
// press lands at undefined. A MouseEvent under the pointer event's name carries them,
// which is what the panel needs to tell a hold-drag from a click that picks the piece
// up: without real coordinates on BOTH the press and the move, travel is NaN and every
// gesture reads as a click.
const press = (el: Element, x: number, y: number) =>
  fireEvent(el, new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
const moveTo = (el: Element, x: number, y: number) =>
  fireEvent(el, new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
/** Press on `el`, travel well past `CARRY_SLOP`, so the release resolves as a drag. */
const dragFrom = (el: Element, x = 10, y = 10) => {
  press(el, x, y);
  moveTo(el, x + 40, y + 40);
};

const inv = {
  cols: 12,
  rows: 5,
  items: [
    {
      x: 0, y: 0, w: 2, h: 2, rarity: "magic" as const, name: "Ember Wand", itemClass: "wand",
      statLines: [{ label: "Physical Damage", value: "5-10" }, { label: "Attacks per Second", value: "1.20" }],
      reqLevel: 8, reqAttrValue: 29, reqAttr: "Int",
      lines: ["+12 to maximum Life"],
    },
  ],
};

describe("InventoryPanel", () => {
  it("shows the PoE2 item tooltip on hover with name, class, base stats, requirements and affixes", () => {
    render(<InventoryPanel inventory={inv} onClose={() => {}} />);
    expect(screen.getByTestId("inventory-panel")).toBeTruthy();
    const item = screen.getByTestId("inventory-item-0");
    expect(screen.queryByTestId("item-tooltip")).toBeNull();

    fireEvent.mouseEnter(item, { clientX: 100, clientY: 100 });
    const tip = screen.getByTestId("item-tooltip");
    expect(tip.textContent).toContain("Ember Wand");
    expect(tip.textContent).toContain("wand");
    expect(tip.textContent).toContain("Physical Damage");
    expect(tip.textContent).toContain("5-10");
    expect(tip.textContent).toContain("Requires Level");
    expect(tip.textContent).toContain("29");
    expect(tip.textContent).toContain("Int");
    expect(tip.textContent).toContain("+12 to maximum Life");

    fireEvent.mouseLeave(item);
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });

  it("lets go of the tooltip after a snapshot rebuilt the item under the cursor", () => {
    // The sim sends a whole new inventory 30 times a second, so the object the
    // tooltip is holding stops being the object the cell was drawn with while
    // the cursor has not moved at all. Leaving has to clear it anyway — this is
    // the tooltip that used to stick to the screen until something else opened.
    const { rerender } = render(<InventoryPanel inventory={inv} onClose={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("inventory-item-0"), { clientX: 100, clientY: 100 });
    expect(screen.queryByTestId("item-tooltip")).not.toBeNull();

    const rebuilt = { ...inv, items: inv.items.map((i) => ({ ...i })) };
    rerender(<InventoryPanel inventory={rebuilt} onClose={() => {}} />);
    fireEvent.mouseLeave(screen.getByTestId("inventory-item-0"));
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });

  it("renders base art in the cell when the item has an icon, and the name when it does not", () => {
    const withIcon = { ...inv, items: [{ ...inv.items[0]!, icon: "/textures/items/emberwand.png" }] };
    const { rerender } = render(<InventoryPanel inventory={withIcon} onClose={() => {}} />);
    const img = screen.getByTestId("inventory-item-0").querySelector("img");
    expect(img?.getAttribute("src")).toBe("/textures/items/emberwand.png");

    rerender(<InventoryPanel inventory={inv} onClose={() => {}} />);
    const cell = screen.getByTestId("inventory-item-0");
    expect(cell.querySelector("img")).toBeNull();
    expect(cell.textContent).toBe("Ember Wand");
  });

  it("a click lifts the piece onto the cursor and holds it there, and the next click places it", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} equipment={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    // Press and release without moving: PoE reads that as picking the piece up,
    // not as a drag that ended where it started. Nothing has been decided yet.
    fireEvent.pointerDown(screen.getByTestId("inventory-item-0"), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId("equip-slot-weapon1"));
    expect(intents).toEqual([]);
    expect(screen.getByTestId("drag-ghost")).toBeTruthy();

    // Still on the cursor a release later, and the SECOND click is the one that
    // commits it.
    fireEvent.pointerUp(screen.getByTestId("equip-slot-weapon1"));
    expect(intents).toEqual([{ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }]);
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
  });

  it("a click on another item while one is already carried does not swap what is on the cursor", () => {
    const two = {
      ...inv,
      items: [inv.items[0]!, { ...inv.items[0]!, x: 4, y: 0, name: "Second Wand" }],
    };
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={two} equipment={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    fireEvent.pointerDown(screen.getByTestId("inventory-item-0"), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId("inventory-item-0"));
    expect(screen.getByTestId("drag-ghost").textContent).toContain("Ember Wand");

    // Pressing on the other item must not grab it: the hand is full, and this
    // press belongs to the release that places what is already held.
    fireEvent.pointerDown(screen.getByTestId("inventory-item-1"), { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("drag-ghost").textContent).toContain("Ember Wand");
  });

  it("drags a backpack item onto a legal slot, ignores an illegal one, and drops to the ground outside the panel", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} equipment={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    const item = screen.getByTestId("inventory-item-0");

    // wand -> weapon1 is legal
    dragFrom(item);
    expect(screen.getByTestId("drag-ghost")).toBeTruthy();
    fireEvent.pointerUp(screen.getByTestId("equip-slot-weapon1"));
    expect(intents).toEqual([{ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }]);

    // wand -> boots is not
    dragFrom(item);
    fireEvent.pointerUp(screen.getByTestId("equip-slot-boots"));
    expect(intents).toHaveLength(1);

    // released on the backdrop, i.e. over the world behind the panel
    dragFrom(item);
    fireEvent.pointerUp(screen.getByTestId("inventory-panel"));
    expect(intents[1]).toEqual({ kind: "dropItem", x: 0, y: 0 });
  });

  it("drags an equipped item back to the grid to unequip it", () => {
    const intents: unknown[] = [];
    const equipped = { weapon1: { rarity: "magic" as const, name: "Ember Wand", itemClass: "wand", lines: [] } };
    render(<InventoryPanel inventory={{ ...inv, items: [] }} equipment={equipped} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    dragFrom(screen.getByTestId("equip-slot-weapon1"));
    fireEvent.pointerUp(document.querySelector("[data-drop-grid]")!);
    expect(intents).toEqual([{ kind: "unequipItem", slot: "weapon1" }]);
  });

  it("releasing a drag over another open HUD panel is a no-op, not a drop to the floor", () => {
    const intents: unknown[] = [];
    const sheet = document.createElement("div");
    sheet.setAttribute("data-hud-panel", "");
    document.body.appendChild(sheet);
    render(<InventoryPanel inventory={inv} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(sheet);
    expect(intents).toEqual([]);

    sheet.remove();
  });

  it("lands a dragged item on the cell under its centre, at whatever size the grid renders", () => {
    // The cell is a vw fraction now, so the drag math divides the grid's measured width by
    // the column count instead of trusting a px constant. jsdom hands out zero rects, so the
    // grid gets a real one: 12 columns of 43.008px, which is what 2.1vw is on a 2048 window.
    const CELL = 43.008;
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    const grid = document.querySelector("[data-drop-grid]") as HTMLElement;
    grid.getBoundingClientRect = () =>
      ({ left: 1000, top: 500, width: 12 * CELL, height: 5 * CELL, right: 1000 + 12 * CELL, bottom: 500 + 5 * CELL }) as DOMRect;

    // PoE carries a piece by its centre: the 2x2 wand's centre goes on the corner cells
    // (9,3)..(10,4) share, so its top-left has to land on (9,3), not on the cursor's cell.
    // Far along the row on purpose — near the origin a wrong cell size still rounds to the
    // right cell, and the old hardcoded 48 would pass.
    press(screen.getByTestId("inventory-item-0"), 10, 10);
    fireEvent(grid, new MouseEvent("pointermove", { bubbles: true, clientX: 1000 + 10 * CELL, clientY: 500 + 4 * CELL }));
    fireEvent.pointerUp(grid);
    expect(intents).toEqual([{ kind: "moveItem", x: 0, y: 0, toX: 9, toY: 3 }]);
  });


  it("drags an item across into the stash, resolving the cell against the stash's own grid", () => {
    // The two grids have different column counts, so the drop must be measured on
    // whichever grid the cursor is over. A shared cell size lands a cell out.
    const CELL = 43.008;
    const intents: unknown[] = [];
    const stash = { cols: 12, rows: 12, items: [] };
    render(<InventoryPanel inventory={inv} stash={stash} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    const [stashGrid, packGrid] = Array.from(document.querySelectorAll("[data-drop-grid]")) as HTMLElement[];
    // jsdom hands out zero rects; give each grid a real one, side by side.
    stashGrid!.getBoundingClientRect = () =>
      ({ left: 0, top: 100, width: 12 * CELL, height: 12 * CELL, right: 12 * CELL, bottom: 100 + 12 * CELL }) as DOMRect;
    packGrid!.getBoundingClientRect = () =>
      ({ left: 1000, top: 500, width: 12 * CELL, height: 5 * CELL, right: 1000 + 12 * CELL, bottom: 500 + 5 * CELL }) as DOMRect;

    press(screen.getByTestId("inventory-item-0"), 10, 10);
    // Centre of the 2x2 piece over the stash's (3,6)..(4,7) corner.
    fireEvent(stashGrid!, new MouseEvent("pointermove", { bubbles: true, clientX: 4 * CELL, clientY: 100 + 7 * CELL }));
    fireEvent.pointerUp(stashGrid!);
    expect(intents).toEqual([{ kind: "moveItem", x: 0, y: 0, toX: 3, toY: 6, to: "stash" }]);
  });

  it("does not drop an item on the floor when it is released over the stash panel", () => {
    const intents: unknown[] = [];
    const stash = { cols: 12, rows: 12, items: [] };
    render(<InventoryPanel inventory={inv} stash={stash} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("stash-panel"));
    expect(intents).toEqual([]);
  });


  it("ctrl-clicks an item onto the bench once it is open", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} vendorOpen shards={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent(screen.getByTestId("inventory-item-0"), new MouseEvent("pointerdown", { bubbles: true, ctrlKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([{ kind: "sellItem", x: 0, y: 0 }]);
  });

  it("ignores ctrl-click while the bench is closed, so nothing is destroyed by a stray modifier", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent(screen.getByTestId("inventory-item-0"), new MouseEvent("pointerdown", { bubbles: true, ctrlKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([]);
  });

  it("ctrl-clicks a stash item to the bench with the container named", () => {
    const intents: unknown[] = [];
    const stash = { cols: 12, rows: 12, items: [{ x: 4, y: 4, w: 1, h: 1, rarity: "rare" as const, name: "Old Wand", lines: [] }] };
    render(<InventoryPanel inventory={inv} stash={stash} vendorOpen shards={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent(screen.getByTestId("stash-item-0"), new MouseEvent("pointerdown", { bubbles: true, ctrlKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([{ kind: "sellItem", x: 4, y: 4, from: "stash" }]);
  });

  it("shows the banked shards as a count out of ten", () => {
    render(<InventoryPanel inventory={inv} vendorOpen shards={{ "currency.elevation": 7 }} onClose={() => {}} />);
    expect(screen.getByTestId("shard-currency.elevation").textContent).toContain("7 / 10");
    expect(screen.getByTestId("shard-currency.transmutation").textContent).toContain("0 / 10");
  });

  it("shift-clicks an item straight into the stash's first free cell", () => {
    const intents: unknown[] = [];
    // (0,0) is taken, so a 2x2 piece first fits at (2,0).
    const stash = { cols: 12, rows: 12, items: [{ x: 0, y: 0, w: 2, h: 2, rarity: "normal" as const, name: "Old Wand", lines: [] }] };
    render(<InventoryPanel inventory={inv} stash={stash} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    // jsdom has no PointerEvent, so fireEvent.pointerDown drops shiftKey; a MouseEvent
    // named pointerdown carries it, the way the browser's real pointer event does.
    fireEvent(screen.getByTestId("inventory-item-0"), new MouseEvent("pointerdown", { bubbles: true, shiftKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([{ kind: "moveItem", x: 0, y: 0, toX: 2, toY: 0, to: "stash" }]);
  });

  it("shift-clicks a stash item back into the backpack", () => {
    const intents: unknown[] = [];
    const stash = { cols: 12, rows: 12, items: [{ x: 4, y: 4, w: 1, h: 1, rarity: "normal" as const, name: "Old Wand", lines: [] }] };
    render(<InventoryPanel inventory={inv} stash={stash} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    // The backpack's 2x2 item sits at (0,0), so a 1x1 first fits at (2,0).
    fireEvent(screen.getByTestId("stash-item-0"), new MouseEvent("pointerdown", { bubbles: true, shiftKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([{ kind: "moveItem", x: 4, y: 4, toX: 2, toY: 0, from: "stash" }]);
  });

  it("shift-clicks a currency onto the stack it should merge with, not onto an empty cell", () => {
    const intents: unknown[] = [];
    const currency = {
      cols: 12, rows: 5,
      items: [{ x: 0, y: 0, w: 1, h: 1, rarity: "normal" as const, name: "Scroll of Wisdom", itemClass: "currency", baseId: "currency.wisdom", count: 3, lines: [] }],
    };
    const stash = {
      cols: 12, rows: 12,
      items: [{ x: 5, y: 6, w: 1, h: 1, rarity: "normal" as const, name: "Scroll of Wisdom", itemClass: "currency", baseId: "currency.wisdom", count: 4, lines: [] }],
    };
    render(<InventoryPanel inventory={currency} stash={stash} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    // jsdom has no PointerEvent, so fireEvent.pointerDown drops shiftKey; a MouseEvent
    // named pointerdown carries it, the way the browser's real pointer event does.
    fireEvent(screen.getByTestId("inventory-item-0"), new MouseEvent("pointerdown", { bubbles: true, shiftKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([{ kind: "moveItem", x: 0, y: 0, toX: 5, toY: 6, to: "stash" }]);
  });

  it("does nothing on a shift-click while the stash is closed", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    // jsdom has no PointerEvent, so fireEvent.pointerDown drops shiftKey; a MouseEvent
    // named pointerdown carries it, the way the browser's real pointer event does.
    fireEvent(screen.getByTestId("inventory-item-0"), new MouseEvent("pointerdown", { bubbles: true, shiftKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([]);
  });

  it("hovers an equipped slot to read what that item is actually granting", () => {
    const equipped = {
      body: {
        rarity: "rare" as const, name: "Cinderveil", baseName: "Emberweave Robe", itemClass: "body",
        implicit: "45% increased Mana Regeneration Rate",
        lines: ["+40 to maximum Life", "+20% to Fire Resistance"],
      },
    };
    render(<InventoryPanel inventory={{ ...inv, items: [] }} equipment={equipped} onClose={() => {}} />);
    const slot = screen.getByTestId("equip-slot-body");
    expect(screen.queryByTestId("item-tooltip")).toBeNull();

    fireEvent.mouseEnter(slot, { clientX: 40, clientY: 40 });
    const tip = screen.getByTestId("item-tooltip");
    expect(tip.textContent).toContain("Cinderveil");
    expect(tip.textContent).toContain("Emberweave Robe");
    expect(tip.textContent).toContain("45% increased Mana Regeneration Rate");
    expect(tip.textContent).toContain("+40 to maximum Life");

    fireEvent.mouseLeave(slot);
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });

  it("does not show a tooltip for an empty equipment slot", () => {
    render(<InventoryPanel inventory={{ ...inv, items: [] }} equipment={{}} onClose={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("equip-slot-body"), { clientX: 40, clientY: 40 });
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });

  it("ships an art file for every base and unique icon path", () => {
    for (const src of [...ITEM_POOLS.bases, ...(ITEM_POOLS.uniques ?? []), baseOf(WISDOM_SCROLL_BASE_ID)]) {
      if (!src.icon) continue;
      const file = resolve(__dirname, "../../public", src.icon.replace(/^\//, ""));
      expect(existsSync(file), `${src.id} icon missing: ${file}`).toBe(true);
    }
  });
});

describe("spending currency on an item", () => {
  const withScroll = {
    cols: 12, rows: 5,
    items: [
      { x: 0, y: 0, w: 1, h: 1, rarity: "normal" as const, name: "Scroll of Wisdom", itemClass: "currency", baseId: "currency.wisdom", lines: [], count: 4 },
      { x: 4, y: 0, w: 1, h: 2, rarity: "rare" as const, name: "Ember Wand", itemClass: "wand", lines: [], unidentified: true },
    ],
  };

  it("shows the stack size and marks the unread item", () => {
    render(<InventoryPanel inventory={withScroll} onClose={() => {}} />);
    expect(screen.getByTestId("inventory-count-0").textContent).toBe("4");
    expect(screen.getByTestId("inventory-unread-1")).toBeTruthy();
  });

  it("spends an armed scroll on the item the next click lands on", () => {
    const seen: unknown[] = [];
    render(<InventoryPanel inventory={withScroll} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerDown(screen.getByTestId("inventory-item-1"));
    expect(seen).toEqual([{ kind: "applyCurrency", fromX: 0, fromY: 0, x: 4, y: 0 }]);
  });

  it("refuses a target the armed orb cannot legally change", () => {
    const seen: unknown[] = [];
    const withOrb = {
      cols: 12, rows: 5,
      items: [
        { x: 0, y: 0, w: 1, h: 1, rarity: "normal" as const, name: "Orb of Embers", itemClass: "currency", baseId: "currency.embers", lines: [], count: 1 },
        // Embers adds to a rare; a normal item is not something it can touch.
        { x: 4, y: 0, w: 1, h: 2, rarity: "normal" as const, name: "Ember Wand", itemClass: "wand", lines: [] },
      ],
    };
    render(<InventoryPanel inventory={withOrb} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerDown(screen.getByTestId("inventory-item-1"));
    expect(seen.some((i) => (i as { kind: string }).kind === "applyCurrency")).toBe(false);
  });

  /**
   * The Portal Scroll has no target to be armed at, so right-clicking it IS the
   * use. Nothing here checks whether that is legal: the sim refuses it outside a
   * map and keeps the scroll, and a client that guessed would be guessing twice.
   */
  it("right-clicking a Portal Scroll spends it instead of arming it", () => {
    const seen: unknown[] = [];
    const withPortal = {
      cols: 12, rows: 5,
      items: [
        { x: 0, y: 0, w: 1, h: 1, rarity: "normal" as const, name: "Portal Scroll", itemClass: "currency", baseId: "currency.portal", lines: [], count: 3 },
        { x: 4, y: 0, w: 1, h: 2, rarity: "rare" as const, name: "Ember Wand", itemClass: "wand", lines: [] },
      ],
    };
    render(<InventoryPanel inventory={withPortal} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    expect(seen).toEqual([{ kind: "usePortalScroll" }]);
    // Nothing was armed, so the next click is an ordinary grab, not an application.
    fireEvent.pointerDown(screen.getByTestId("inventory-item-1"));
    expect(seen).toEqual([{ kind: "usePortalScroll" }]);
  });

  it("does not arm off an ordinary item, so a click still picks it up", () => {
    const seen: unknown[] = [];
    render(<InventoryPanel inventory={withScroll} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-1"));
    fireEvent.pointerDown(screen.getByTestId("inventory-item-1"));
    expect(seen).toEqual([]);
  });
});

const shelf = {
  cols: 12,
  rows: 12,
  items: [
    { x: 0, y: 0, w: 1, h: 2, rarity: "normal" as const, name: "Iron Hat", itemClass: "helmet", lines: [], price: 40 },
    { x: 2, y: 0, w: 2, h: 2, rarity: "rare" as const, name: "Doom Shroud", itemClass: "body", lines: ["+50 to maximum Life"], price: 900 },
  ],
};

describe("InventoryPanel - purchase window", () => {
  it("shows the shelf with a price in every cell", () => {
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={500} onClose={() => {}} />);
    // His name on the band, his trade under it: the window belongs to a person.
    expect(screen.getByTestId("vendor-panel").textContent).toContain(VENDOR_NAME);
    expect(screen.getByTestId("vendor-panel").textContent).toContain(VENDOR_TITLE);
    expect(screen.getByTestId("vendor-price-0").textContent).toBe("40");
    expect(screen.getByTestId("vendor-price-1").textContent).toBe("900");
  });

  it("buys the piece that was clicked", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={500} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("vendor-item-0"));
    expect(intents).toEqual([{ kind: "buyItem", x: 0, y: 0 }]);
  });

  it("refuses to send a purchase the purse cannot cover", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={500} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("vendor-item-1"));
    expect(intents).toEqual([]);
  });

  it("never drags a piece off the shelf, because that would be taking it", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={5000} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("vendor-item-0"), { clientX: 10, clientY: 10 });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    expect(intents).toEqual([{ kind: "buyItem", x: 0, y: 0 }]);
  });

  it("dims the shelf down to what the keyword box names", () => {
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={5000} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("vendor-highlight"), { target: { value: "maximum life" } });
    expect(screen.getByTestId("vendor-item-0").style.opacity).toBe("0.18");
    expect(screen.getByTestId("vendor-item-1").style.opacity).toBe("1");
  });

  it("clears the keyword box back to the whole shelf", () => {
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={5000} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("vendor-highlight"), { target: { value: "nothing matches this" } });
    fireEvent.click(screen.getByTestId("vendor-highlight-clear"));
    expect(screen.getByTestId("vendor-item-0").style.opacity).toBe("1");
  });

  it("shows the gold the purse is actually carrying, where PoE1 keeps it", () => {
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={1234} onClose={() => {}} />);
    expect(screen.getByTestId("currency-strip").textContent).toContain("1234");
  });
});

describe("InventoryPanel - panels that close take their tooltip with them", () => {
  it("drops the tooltip when the shelf closes under it", () => {
    const { rerender } = render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={5000} onClose={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("vendor-item-0"), { clientX: 100, clientY: 100 });
    expect(screen.getByTestId("item-tooltip")).toBeTruthy();

    rerender(<InventoryPanel inventory={inv} vendorOpen={false} gold={5000} onClose={() => {}} />);
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });

  it("drops the tooltip when the stash closes under it", () => {
    const stash = { cols: 12, rows: 12, items: [{ x: 4, y: 4, w: 1, h: 1, rarity: "rare" as const, name: "Old Wand", lines: [] }] };
    const { rerender } = render(<InventoryPanel inventory={inv} stash={stash} onClose={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("stash-item-0"), { clientX: 100, clientY: 100 });
    expect(screen.getByTestId("item-tooltip")).toBeTruthy();

    rerender(<InventoryPanel inventory={inv} onClose={() => {}} />);
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });
});
