// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ITEM_POOLS } from "@exiled/content-runtime";
import { InventoryPanel } from "./InventoryPanel";

afterEach(cleanup);

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

  it("drags a backpack item onto a legal slot, ignores an illegal one, and drops to the ground outside the panel", () => {
    const intents: unknown[] = [];
    render(<InventoryPanel inventory={inv} equipment={{}} onIntent={(i) => intents.push(i)} onClose={() => {}} />);
    const item = screen.getByTestId("inventory-item-0");

    // wand -> weapon1 is legal
    fireEvent.pointerDown(item, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("drag-ghost")).toBeTruthy();
    fireEvent.pointerUp(screen.getByTestId("equip-slot-weapon1"));
    expect(intents).toEqual([{ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }]);

    // wand -> boots is not
    fireEvent.pointerDown(item, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId("equip-slot-boots"));
    expect(intents).toHaveLength(1);

    // released on the backdrop, i.e. over the world behind the panel
    fireEvent.pointerDown(item, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId("inventory-panel"));
    expect(intents[1]).toEqual({ kind: "dropItem", x: 0, y: 0 });
  });

  it("drags an equipped item back to the grid to unequip it", () => {
    const intents: unknown[] = [];
    const equipped = { weapon1: { rarity: "magic" as const, name: "Ember Wand", itemClass: "wand", lines: [] } };
    render(<InventoryPanel inventory={{ ...inv, items: [] }} equipment={equipped} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    fireEvent.pointerDown(screen.getByTestId("equip-slot-weapon1"), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(document.querySelector("[data-drop-grid]")!);
    expect(intents).toEqual([{ kind: "unequipItem", slot: "weapon1" }]);
  });

  it("releasing a drag over another open HUD panel is a no-op, not a drop to the floor", () => {
    const intents: unknown[] = [];
    const sheet = document.createElement("div");
    sheet.setAttribute("data-hud-panel", "");
    document.body.appendChild(sheet);
    render(<InventoryPanel inventory={inv} onIntent={(i) => intents.push(i)} onClose={() => {}} />);

    fireEvent.pointerDown(screen.getByTestId("inventory-item-0"), { clientX: 10, clientY: 10 });
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
    fireEvent.pointerDown(screen.getByTestId("inventory-item-0"), { clientX: 10, clientY: 10 });
    // jsdom has no PointerEvent, so fireEvent.pointerMove would drop clientX/clientY and
    // the drag would sit at NaN. A MouseEvent named pointermove carries the coordinates.
    fireEvent(grid, new MouseEvent("pointermove", { bubbles: true, clientX: 1000 + 10 * CELL, clientY: 500 + 4 * CELL }));
    fireEvent.pointerUp(grid);
    expect(intents).toEqual([{ kind: "moveItem", x: 0, y: 0, toX: 9, toY: 3 }]);
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
    for (const src of [...ITEM_POOLS.bases, ...(ITEM_POOLS.uniques ?? [])]) {
      if (!src.icon) continue;
      const file = resolve(__dirname, "../../public", src.icon.replace(/^\//, ""));
      expect(existsSync(file), `${src.id} icon missing: ${file}`).toBe(true);
    }
  });
});
