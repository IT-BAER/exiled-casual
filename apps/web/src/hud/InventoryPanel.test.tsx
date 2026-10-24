// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ITEM_POOLS, baseOf, WISDOM_SCROLL_BASE_ID } from "@exiled/content-runtime";
import { Profiler } from "react";
import { InventoryPanel } from "./InventoryPanel";
import { VENDOR_NAME, VENDOR_TITLE } from "../npc";
import { playSfx } from "../audio/sfx";

vi.mock("../audio/sfx", async (orig) => ({ ...(await orig<typeof import("../audio/sfx")>()), playSfx: vi.fn() }));
const heard = () => vi.mocked(playSfx).mock.calls.map((c) => c[0]);

afterEach(() => { cleanup(); vi.mocked(playSfx).mockClear(); });

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
  it("sizes a one-cell slot's label to the cell, not to the 9px of the wide ones", () => {
    // At 1280x720 "AMULET" was 41.6px of text in a 26.2px slot and read "AMULE";
    // its capitals are still 29.9px at 7.6px type, mixed case is 24.9.
    render(<InventoryPanel inventory={inv} flaskKeys={{ life: "1", mana: "2" }} onClose={() => {}} />);
    for (const slot of ["amulet", "ring1", "ring2"]) {
      const style = screen.getByTestId(`equip-slot-${slot}`).style;
      expect(style.letterSpacing).toBe("0px");
      expect(style.textTransform).toBe("none");
      expect(style.fontSize).toContain("vw");
    }
    expect(screen.getByTestId("equip-slot-helmet").style.fontSize).toBe("9px");
  });

  it("captions the flasks with the keys the HUD drinks them on", () => {
    render(<InventoryPanel inventory={inv} flaskKeys={{ life: "1", mana: "2" }} onClose={() => {}} />);
    expect(screen.getByTestId("inventory-flask-life").textContent).toBe("1");
    expect(screen.getByTestId("inventory-flask-mana").textContent).toBe("2");
  });

  it("hovering a belt flask shows the same flask box as the HUD, with its charges", () => {
    render(<InventoryPanel inventory={inv} flaskKeys={{ life: "1", mana: "2" }} flasks={{ lifeCharges: 7, lifeMax: 7, manaCharges: 3, manaMax: 7 }} onClose={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("inventory-flask-mana-socket"), { clientX: 100, clientY: 100 });
    const tip = screen.getByTestId("item-tooltip");
    expect(tip.textContent).toContain("Mana Flask");
    expect(tip.textContent).toContain("Recovers 30% of maximum Mana instantly");
    expect(tip.textContent).toContain("Currently has 3 Charges");
    expect(screen.getByTestId("item-help").textContent).toBe("Press 2 to drink. Gains 1 Charge per kill. Refills in your hideout.");
    fireEvent.mouseLeave(screen.getByTestId("inventory-flask-mana-socket"));
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });

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
    const withIcon = { ...inv, items: [{ ...inv.items[0]!, icon: "/textures/items/ember_wand.webp" }] };
    const { rerender } = render(<InventoryPanel inventory={withIcon} onClose={() => {}} />);
    const img = screen.getByTestId("inventory-item-0").querySelector("img");
    expect(img?.getAttribute("src")).toBe("/textures/items/ember_wand.webp");

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

  it("refuses a drop on the slot while the character is below the item's level, like the sim does", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} equipment={{}} level={7} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("equip-slot-weapon1"));
    expect(intents).toEqual([]);
    cleanup();
    render(<InventoryPanel inventory={inv} equipment={{}} level={8} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("equip-slot-weapon1"));
    expect(intents).toEqual([{ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }]);
  });

  it("a held drag released before the panel re-rendered its travel still drops, not lifts", async () => {
    // A slow frame (the atlas behind the panel) can deliver the moves and the
    // release before React commits the moved position, so the release must not
    // read travel from the last render.
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} equipment={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    press(screen.getByTestId("inventory-item-0"), 10, 10);
    const slot = screen.getByTestId("equip-slot-weapon1");
    slot.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 50 }));
    slot.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 50 }));
    await act(async () => {});
    expect(intents).toEqual([{ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }]);
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
  });

  it("a carried waystone placed on the map-device socket by a click stays seated", () => {
    // The socket's own click takes a stone back out, and the click that places
    // one is a click on the socket too.
    const stone = { ...inv.items[0]!, name: "Waystone", baseId: "map.waystone", itemClass: "waystone", w: 1, h: 1 };
    const seated: unknown[] = [];
    let ejected = 0;
    render(
      <>
        <button data-drop-socket="" data-testid="socket" onClick={() => { ejected++; }} />
        <InventoryPanel inventory={{ ...inv, items: [stone] }} equipment={{}} onSocketWaystone={(x, y) => seated.push([x, y])} onClose={() => {}} />
      </>,
    );
    fireEvent.pointerDown(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerDown(screen.getByTestId("socket"));
    fireEvent.pointerUp(screen.getByTestId("socket"));
    fireEvent.click(screen.getByTestId("socket"));
    expect(seated).toEqual([[0, 0]]);
    expect(ejected).toBe(0);
    // The guard is one-shot: the next click on the socket still takes it out.
    fireEvent.click(screen.getByTestId("socket"));
    expect(ejected).toBe(1);
  });

  it("drags an equipped item back to the grid to unequip it", () => {
    const intents: unknown[] = [];
    const equipped = { weapon1: { rarity: "magic" as const, name: "Ember Wand", itemClass: "wand", lines: [] } };
    render(<InventoryPanel inventory={{ ...inv, items: [] }} equipment={equipped} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    dragFrom(screen.getByTestId("equip-slot-weapon1"));
    fireEvent.pointerUp(document.querySelector("[data-drop-grid]")!);
    expect(intents).toEqual([{ kind: "unequipItem", slot: "weapon1" }]);
  });

  it("drops an equipped item to the ground when released outside the panel", () => {
    const intents: unknown[] = [];
    const equipped = { weapon1: { rarity: "magic" as const, name: "Ember Wand", itemClass: "wand", lines: [] } };
    render(<InventoryPanel inventory={{ ...inv, items: [] }} equipment={equipped} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    dragFrom(screen.getByTestId("equip-slot-weapon1"));
    fireEvent.pointerUp(screen.getByTestId("inventory-panel"));
    expect(intents).toEqual([{ kind: "dropItem", slot: "weapon1" }]);
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


  it("carries a piece without re-rendering the panel on every pointer move", () => {
    // A mouse reports hundreds of moves a second, and each one used to re-render
    // the whole panel: frame time doubled on a desktop while a waystone rode the cursor.
    const CELL = 43.008;
    let commits = 0;
    render(
      <Profiler id="inv" onRender={() => { commits++; }}>
        <InventoryPanel inventory={inv} onClose={() => {}} />
      </Profiler>,
    );
    const grid = document.querySelector("[data-drop-grid]") as HTMLElement;
    grid.getBoundingClientRect = () =>
      ({ left: 1000, top: 500, width: 12 * CELL, height: 5 * CELL, right: 1000 + 12 * CELL, bottom: 500 + 5 * CELL }) as DOMRect;
    press(screen.getByTestId("inventory-item-0"), 1000 + 10 * CELL, 500 + 4 * CELL);
    moveTo(grid, 1000 + 10 * CELL + 1, 500 + 4 * CELL);
    const before = commits;
    // Ten moves that keep the piece over the same cells.
    for (let i = 2; i < 12; i++) moveTo(grid, 1000 + 10 * CELL + i, 500 + 4 * CELL + i / 2);
    expect(commits).toBe(before);
    // The ghost still follows the pointer: its left edge is hung off the last x.
    expect(screen.getByTestId("drag-ghost").style.left).toContain(`${1000 + 10 * CELL + 11}px`);
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

  it("pours a currency pile onto the same currency in the stash rather than refusing the cell", () => {
    const CELL = 43.008;
    const intents: unknown[] = [];
    const scroll = { w: 1, h: 1, rarity: "normal" as const, name: "Portal Scroll", itemClass: "currency", baseId: "currency.portal", lines: [] };
    const pack = { cols: 12, rows: 5, items: [{ ...scroll, x: 0, y: 0, count: 2 }] };
    const stash = { cols: 12, rows: 12, items: [{ ...scroll, x: 5, y: 5, count: 3 }] };
    render(<InventoryPanel inventory={pack} stash={stash} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    const [stashGrid, packGrid] = Array.from(document.querySelectorAll("[data-drop-grid]")) as HTMLElement[];
    stashGrid!.getBoundingClientRect = () =>
      ({ left: 0, top: 100, width: 12 * CELL, height: 12 * CELL, right: 12 * CELL, bottom: 100 + 12 * CELL }) as DOMRect;
    packGrid!.getBoundingClientRect = () =>
      ({ left: 1000, top: 500, width: 12 * CELL, height: 5 * CELL, right: 1000 + 12 * CELL, bottom: 500 + 5 * CELL }) as DOMRect;

    press(screen.getByTestId("inventory-item-0"), 10, 10);
    fireEvent(stashGrid!, new MouseEvent("pointermove", { bubbles: true, clientX: 5.5 * CELL, clientY: 100 + 5.5 * CELL }));
    fireEvent.pointerUp(stashGrid!);
    expect(intents).toEqual([{ kind: "moveItem", x: 0, y: 0, toX: 5, toY: 5, to: "stash" }]);
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

  it("the stone seated in the map device fades in the backpack, so it does not read as a second stone", () => {
    render(<InventoryPanel inventory={inv} socketedCell={{ x: 0, y: 0 }} onClose={() => {}} />);
    expect(screen.getByTestId("inventory-item-0").style.opacity).toBe("0.3");
  });

  it("ctrl-click on an unread item sells nothing and says why in the vendor window", () => {
    const intents: unknown[] = [];
    const unread = { ...inv, items: [{ ...inv.items[0]!, unidentified: true }] };
    render(<InventoryPanel inventory={unread} vendorOpen shards={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent(screen.getByTestId("inventory-item-0"), new MouseEvent("pointerdown", { bubbles: true, ctrlKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([]);
    expect(screen.getByTestId("vendor-sell-note").textContent).toMatch(/unidentified/i);
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

  it("drags a backpack item onto the shelf grid to sell it; the rest of the window is not a counter", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={500} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("vendor-panel"));
    expect(intents).toEqual([]);
    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("vendor-cell-5-5"));
    // A stocked cell is still the counter: the sale is never a buy or a swap.
    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("vendor-item-0"));
    expect(intents).toEqual([{ kind: "sellItem", x: 0, y: 0 }, { kind: "sellItem", x: 0, y: 0 }]);
  });

  it("drags a stash item onto the shelf grid with the container named", () => {
    const intents: unknown[] = [];
    const stash = { cols: 12, rows: 12, items: [{ x: 4, y: 4, w: 1, h: 1, rarity: "rare" as const, name: "Old Wand", lines: [] }] };
    render(<InventoryPanel inventory={inv} stash={stash} vendorOpen onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    dragFrom(screen.getByTestId("stash-item-0"));
    fireEvent.pointerUp(screen.getByTestId("vendor-cell-0-0"));
    expect(intents).toEqual([{ kind: "sellItem", x: 4, y: 4, from: "stash" }]);
  });

  it("an equipped piece or one the counter refuses dropped on the shelf sells nothing and stays put", () => {
    const intents: unknown[] = [];
    const equipped = { weapon1: { rarity: "magic" as const, name: "Ember Wand", itemClass: "wand", lines: [] } };
    const unread = { ...inv, items: [{ ...inv.items[0]!, unidentified: true }] };
    render(<InventoryPanel inventory={unread} equipment={equipped} vendorOpen onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    dragFrom(screen.getByTestId("equip-slot-weapon1"));
    fireEvent.pointerUp(screen.getByTestId("vendor-cell-0-0"));
    dragFrom(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerUp(screen.getByTestId("vendor-cell-0-0"));
    expect(intents).toEqual([]);
  });

  it("the shelf grid shows whether it will take the piece held over it", () => {
    const orb = { ...inv.items[0]!, x: 4, y: 0, w: 1, h: 1, name: "Orb", itemClass: "currency", baseId: "currency.transmutation" };
    render(<InventoryPanel inventory={{ ...inv, items: [inv.items[0]!, orb] }} vendorOpen onClose={() => {}} />);
    const grid = document.querySelector('[data-drop-grid="vendor"]') as HTMLElement;
    expect(grid.dataset["sell"]).toBeUndefined();

    press(screen.getByTestId("inventory-item-0"), 10, 10);
    moveTo(screen.getByTestId("vendor-cell-3-3"), 60, 60);
    expect(grid.dataset["sell"]).toBe("ok");
    moveTo(screen.getByTestId("vendor-panel"), 70, 70);
    expect(grid.dataset["sell"]).toBeUndefined();
    fireEvent.pointerUp(screen.getByTestId("inventory-panel"));

    press(screen.getByTestId("inventory-item-1"), 10, 10);
    moveTo(screen.getByTestId("vendor-cell-3-3"), 60, 60);
    expect(grid.dataset["sell"]).toBe("refused");
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

  it("ctrl-clicks an item into the stash too, PoE's own transfer gesture", () => {
    const intents: unknown[] = [];
    const stash = { cols: 12, rows: 12, items: [] };
    render(<InventoryPanel inventory={inv} stash={stash} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent(screen.getByTestId("inventory-item-0"), new MouseEvent("pointerdown", { bubbles: true, ctrlKey: true, clientX: 10, clientY: 10 }));
    expect(intents).toEqual([{ kind: "moveItem", x: 0, y: 0, toX: 0, toY: 0, to: "stash" }]);
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

  describe("holding shift keeps the armed orb on the cursor, as in PoE", () => {
    const twoUnread = {
      ...withScroll,
      items: [...withScroll.items, { ...withScroll.items[1]!, x: 6, y: 0 }],
    };
    const shiftPress = (el: Element) =>
      fireEvent(el, new MouseEvent("pointerdown", { bubbles: true, shiftKey: true, clientX: 10, clientY: 10 }));
    const applied = (seen: unknown[]) => seen.filter((i) => (i as { kind: string }).kind === "applyCurrency");

    it("a shift-click spends one and stays armed; a plain click spends one and lets go", () => {
      const seen: unknown[] = [];
      render(<InventoryPanel inventory={twoUnread} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
      fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
      shiftPress(screen.getByTestId("inventory-item-1"));
      fireEvent.pointerDown(screen.getByTestId("inventory-item-2"));
      fireEvent.pointerDown(screen.getByTestId("inventory-item-1"));
      expect(applied(seen)).toEqual([
        { kind: "applyCurrency", fromX: 0, fromY: 0, x: 4, y: 0 },
        { kind: "applyCurrency", fromX: 0, fromY: 0, x: 6, y: 0 },
      ]);
    });

    it("a shift-click with an orb on the cursor spends it, never transfers to the stash", () => {
      const seen: unknown[] = [];
      const stash = { cols: 12, rows: 12, items: [] };
      render(<InventoryPanel inventory={twoUnread} stash={stash} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
      fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
      shiftPress(screen.getByTestId("inventory-item-1"));
      expect(seen).toEqual([{ kind: "applyCurrency", fromX: 0, fromY: 0, x: 4, y: 0 }]);
    });

    it("releasing Shift after a shift-click spend lets the orb go", () => {
      const seen: unknown[] = [];
      render(<InventoryPanel inventory={twoUnread} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
      fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
      shiftPress(screen.getByTestId("inventory-item-1"));
      fireEvent.keyUp(window, { key: "Shift" });
      fireEvent.pointerDown(screen.getByTestId("inventory-item-2"));
      expect(applied(seen)).toHaveLength(1);
    });

    it("tapping Shift without spending keeps the orb armed", () => {
      const seen: unknown[] = [];
      render(<InventoryPanel inventory={twoUnread} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
      fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
      fireEvent.keyDown(window, { key: "Shift" });
      fireEvent.keyUp(window, { key: "Shift" });
      fireEvent.pointerDown(screen.getByTestId("inventory-item-1"));
      expect(applied(seen)).toHaveLength(1);
    });

    it("lets go once the stack it was holding is gone from its cell", () => {
      const seen: unknown[] = [];
      const { rerender } = render(<InventoryPanel inventory={twoUnread} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
      fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
      shiftPress(screen.getByTestId("inventory-item-1"));
      // The last scroll was spent: the sim's next snapshot no longer has the stack.
      rerender(<InventoryPanel inventory={{ ...twoUnread, items: twoUnread.items.slice(1) }} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
      shiftPress(screen.getByTestId("inventory-item-1"));
      expect(applied(seen)).toHaveLength(1);
    });
  });

  it("shift+right-click spends the stack on every item it accepts, without arming", () => {
    const seen: unknown[] = [];
    render(<InventoryPanel inventory={withScroll} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"), { shiftKey: true });
    expect(seen).toEqual([{ kind: "applyCurrencyAll", fromX: 0, fromY: 0 }]);
    expect(screen.queryByTestId("armed-icon")).toBeNull();
  });

  it("shift+right-click sends nothing when no item accepts the currency", () => {
    const seen: unknown[] = [];
    const nothingToRead = { ...withScroll, items: [withScroll.items[0]!] };
    render(<InventoryPanel inventory={nothingToRead} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"), { shiftKey: true });
    expect(seen).toEqual([]);
  });

  /**
   * The payoff of an orb is the lines it wrote, and the click that spends it is
   * also the click that would close the tooltip reading them. It stays, and it
   * re-reads the item out of the snapshot the sim just sent rather than the copy
   * the mouse was over — a frozen tooltip is a worse lie than none.
   */
  it("keeps the tooltip open on the identified item and shows what the scroll wrote", () => {
    const { rerender } = render(<InventoryPanel inventory={withScroll} onClose={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("inventory-item-1"), { clientX: 40, clientY: 40 });
    expect(screen.getByTestId("item-tooltip").textContent).toContain("Ember Wand");

    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerDown(screen.getByTestId("inventory-item-1"));

    const identified = {
      ...withScroll,
      items: [
        withScroll.items[0]!,
        { ...withScroll.items[1]!, unidentified: false, lines: ["+12 to maximum Life"] },
      ],
    };
    rerender(<InventoryPanel inventory={identified} onClose={() => {}} />);
    const tip = screen.getByTestId("item-tooltip");
    expect(tip.textContent).toContain("Ember Wand");
    expect(tip.textContent).toContain("+12 to maximum Life");
  });

  it("right-click arms without grabbing: bare icon on the cursor, no drag ghost", () => {
    const withIconScroll = {
      ...withScroll,
      items: [{ ...withScroll.items[0]!, icon: "/textures/currency/wisdom.png" }, withScroll.items[1]!],
    };
    render(<InventoryPanel inventory={withIconScroll} onClose={() => {}} />);
    // The press half of a right-click must not start a drag on the way to contextmenu.
    fireEvent(
      screen.getByTestId("inventory-item-0"),
      new MouseEvent("pointerdown", { bubbles: true, button: 2, clientX: 10, clientY: 10 }),
    );
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    fireEvent.pointerMove(window, { clientX: 100, clientY: 120 });
    expect(screen.getByTestId("armed-icon").getAttribute("src")).toBe("/textures/currency/wisdom.png");
  });

  it("an armed orb follows the pointer without re-rendering the panel", () => {
    const withIcon = {
      ...withScroll,
      items: [{ ...withScroll.items[0]!, icon: "/textures/currency/wisdom.png" }, withScroll.items[1]!],
    };
    let commits = 0;
    render(
      <Profiler id="inv" onRender={() => { commits++; }}>
        <InventoryPanel inventory={withIcon} onClose={() => {}} />
      </Profiler>,
    );
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent(window, new MouseEvent("pointermove", { clientX: 50, clientY: 50 }));
    const before = commits;
    for (let i = 1; i <= 10; i++) fireEvent(window, new MouseEvent("pointermove", { clientX: 50 + i, clientY: 50 + i }));
    expect(commits).toBe(before);
    expect(screen.getByTestId("armed-icon").style.left).toBe("70px");
  });

  it("a second right-click dismisses the armed orb and never reaches the browser menu", () => {
    const withIcon = {
      ...withScroll,
      items: [{ ...withScroll.items[0]!, icon: "/textures/currency/wisdom.png" }, withScroll.items[1]!],
    };
    render(<InventoryPanel inventory={withIcon} onClose={() => {}} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    expect(screen.queryByTestId("armed-icon")).not.toBeNull();
    const ctx = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId("inventory-panel"), ctx);
    expect(ctx.defaultPrevented).toBe(true);
    expect(screen.queryByTestId("armed-icon")).toBeNull();
  });

  it("an armed click on an illegal target does nothing, and never picks the target up", () => {
    render(<InventoryPanel inventory={withScroll} onClose={() => {}} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    // The wand is unidentified, so wisdom accepts it — use the scroll itself
    // (its own cell) as the illegal target instead.
    fireEvent.pointerDown(screen.getByTestId("inventory-item-0"));
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
  });

  it("an armed click on a worn piece never takes it off", () => {
    // The grab is the first step of losing it: the next click on the world drops it.
    const seen: unknown[] = [];
    const worn = { gloves: { rarity: "rare" as const, name: "Stalker Gloves", itemClass: "gloves", lines: [], unidentified: true } };
    render(<InventoryPanel inventory={withScroll} equipment={worn} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerDown(screen.getByTestId("equip-slot-gloves"));
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    fireEvent.pointerUp(screen.getByTestId("inventory-panel"));
    expect(seen.filter((i) => (i as { kind: string }).kind !== "applyCurrency")).toEqual([]);
  });

  it("an armed scroll clicked on a worn unread piece reads it where it is worn", () => {
    const seen: unknown[] = [];
    const worn = { gloves: { rarity: "rare" as const, name: "Stalker Gloves", itemClass: "gloves", lines: [], unidentified: true } };
    render(<InventoryPanel inventory={withScroll} equipment={worn} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerDown(screen.getByTestId("equip-slot-gloves"));
    expect(seen).toEqual([{ kind: "applyCurrency", fromX: 0, fromY: 0, slot: "gloves" }]);
  });

  it("an armed orb on a worn piece it cannot change sends nothing", () => {
    const seen: unknown[] = [];
    const worn = { gloves: { rarity: "rare" as const, name: "Stalker Gloves", itemClass: "gloves", lines: ["+10 to maximum Life"] } };
    render(<InventoryPanel inventory={withScroll} equipment={worn} onClose={() => {}} onIntent={(i) => seen.push(i)} />);
    fireEvent.contextMenu(screen.getByTestId("inventory-item-0"));
    fireEvent.pointerDown(screen.getByTestId("equip-slot-gloves"));
    expect(seen).toEqual([]);
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

const page = {
  cols: 12,
  rows: 8,
  items: [
    { x: 0, y: 0, w: 1, h: 2, rarity: "rare" as const, name: "Sold Wand", itemClass: "wand", lines: [], price: 67, refused: false },
    { x: 1, y: 0, w: 1, h: 2, rarity: "rare" as const, name: "Spent Wand", itemClass: "wand", lines: [], price: 67, refused: true },
    { x: 2, y: 0, w: 2, h: 2, rarity: "unique" as const, name: "Dear Shroud", itemClass: "body", lines: [], price: 900, refused: false },
  ],
};

describe("InventoryPanel - buyback page", () => {
  const open = (intents: unknown[] = []) => render(
    <InventoryPanel inventory={inv} vendorOpen vendor={shelf} buyback={page} gold={500} onIntent={(i) => intents.push(i)} onClose={() => {}} />,
  );

  it("opens on the shelf and turns to the buyback page from its tab", () => {
    open();
    expect(screen.getByTestId("vendor-item-0")).toBeTruthy();
    expect(screen.queryByTestId("buyback-item-0")).toBeNull();
    fireEvent.click(screen.getByTestId("buyback-tab"));
    expect(screen.queryByTestId("vendor-item-0")).toBeNull();
    expect(screen.getByTestId("buyback-price-0").textContent).toBe("67");
    fireEvent.click(screen.getByTestId("vendor-tab"));
    expect(screen.getByTestId("vendor-item-0")).toBeTruthy();
  });

  it("buys back the piece that was clicked", () => {
    const intents: unknown[] = [];
    open(intents);
    fireEvent.click(screen.getByTestId("buyback-tab"));
    fireEvent.pointerDown(screen.getByTestId("buyback-item-0"));
    expect(intents).toEqual([{ kind: "buybackItem", x: 0, y: 0 }]);
  });

  it("sends nothing for a sale the purse or a spent orb cannot undo", () => {
    const intents: unknown[] = [];
    open(intents);
    fireEvent.click(screen.getByTestId("buyback-tab"));
    fireEvent.pointerDown(screen.getByTestId("buyback-item-1"));
    fireEvent.pointerDown(screen.getByTestId("buyback-item-2"));
    expect(intents).toEqual([]);
    expect(screen.getByTestId("buyback-item-1").style.opacity).toBe("0.45");
  });

  it("still takes a sale dropped on the buyback page", () => {
    open();
    fireEvent.click(screen.getByTestId("buyback-tab"));
    expect(document.querySelector('[data-drop-grid="buyback"]')!.hasAttribute("data-drop-sell")).toBe(true);
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

describe("InventoryPanel sort", () => {
  it("each pane's Sort sends a sort for its own grid", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} stash={{ cols: 12, rows: 12, items: [] }} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("inventory-sort"));
    fireEvent.click(screen.getByTestId("stash-sort"));
    expect(intents).toEqual([{ kind: "sortItems", mode: "type" }, { kind: "sortItems", container: "stash", mode: "type" }]);
  });

  it("each click sorts by the next mode, and the button names the one it will use", () => {
    const intents: { mode?: string }[] = [];
    render(<InventoryPanel inventory={inv} onIntent={(i) => intents.push(i as { mode?: string })} onClose={() => {}} />);
    const btn = screen.getByTestId("inventory-sort");
    const titles: (string | null)[] = [];
    for (let i = 0; i < 4; i++) { titles.push(btn.getAttribute("title")); fireEvent.click(btn); }
    expect(intents.map((i) => i.mode)).toEqual(["type", "rarity", "size", "type"]);
    expect(titles).toEqual(["Sort by type", "Sort by rarity", "Sort by size", "Sort by type"]);
  });
});

describe("InventoryPanel sounds", () => {
  it("lifts a piece onto the cursor with a sound of its own", () => {
    render(<InventoryPanel inventory={inv} onClose={() => {}} />);
    press(screen.getByTestId("inventory-item-0"), 10, 10);
    expect(heard()).toEqual(["item-lift"]);
  });

  it("a banked shard is left to the soundscape's sale cue; ten becoming an orb still rings", () => {
    const { rerender } = render(<InventoryPanel inventory={inv} vendorOpen shards={{ "currency.elevation": 3 }} onClose={() => {}} />);
    rerender(<InventoryPanel inventory={inv} vendorOpen shards={{ "currency.elevation": 4 }} onClose={() => {}} />);
    rerender(<InventoryPanel inventory={inv} vendorOpen shards={{ "currency.elevation": 0 }} onClose={() => {}} />);
    expect(heard()).toEqual(["drop-unique"]);
  });

  it("a purchase is not heard at the click; the purse and the bag say whether it happened", () => {
    render(<InventoryPanel inventory={inv} vendorOpen vendor={shelf} gold={500} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("vendor-item-0"));
    expect(heard()).toEqual([]);
  });
});

describe("comparing with what is worn", () => {
  const helm = (name: string) => ({ rarity: "rare" as const, name, itemClass: "helmet", lines: [] as string[] });
  const bag = { cols: 12, rows: 5, items: [{ x: 0, y: 0, w: 2, h: 2, ...helm("Dread Crown") }] };
  const worn = { helmet: helm("Old Cowl") };
  const hoverBagHelm = () => fireEvent.mouseEnter(screen.getByTestId("inventory-item-0"), { clientX: 100, clientY: 100 });
  const tips = () => screen.queryAllByTestId("item-tooltip").map((t) => t.textContent ?? "");

  it("holding Ctrl over a bag item shows the worn one beside it, marked Equipped", () => {
    render(<InventoryPanel inventory={bag} equipment={worn} onClose={() => {}} />);
    hoverBagHelm();
    expect(tips()).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Control" });
    expect(tips()).toHaveLength(2);
    expect(tips().find((t) => t.includes("Old Cowl"))).toContain("Equipped");
    expect(tips().find((t) => t.includes("Dread Crown"))).not.toContain("Equipped");
  });

  it("letting go of the key, or leaving the window, puts it back to one", () => {
    render(<InventoryPanel inventory={bag} equipment={worn} onClose={() => {}} />);
    hoverBagHelm();
    fireEvent.keyDown(window, { key: "Control" });
    fireEvent.keyUp(window, { key: "Control" });
    expect(tips()).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Control" });
    fireEvent.blur(window);
    expect(tips()).toHaveLength(1);
  });

  it("answers to Shift instead when that is the chosen key", () => {
    render(<InventoryPanel inventory={bag} equipment={worn} compareKey="shift" onClose={() => {}} />);
    hoverBagHelm();
    fireEvent.keyDown(window, { key: "Control" });
    expect(tips()).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Shift" });
    expect(tips()).toHaveLength(2);
  });

  it("shows one tooltip when the slot is empty, or when the hover is the worn piece itself", () => {
    const { rerender } = render(<InventoryPanel inventory={bag} equipment={{}} onClose={() => {}} />);
    hoverBagHelm();
    fireEvent.keyDown(window, { key: "Control" });
    expect(tips()).toHaveLength(1);
    rerender(<InventoryPanel inventory={bag} equipment={worn} onClose={() => {}} />);
    fireEvent.mouseLeave(screen.getByTestId("inventory-item-0"));
    fireEvent.mouseEnter(screen.getByTestId("equip-slot-helmet"), { clientX: 100, clientY: 100 });
    expect(tips()).toEqual([expect.stringContaining("Old Cowl")]);
  });
});
