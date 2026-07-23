// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { InventoryPanel } from "./InventoryPanel";

afterEach(cleanup);

const inv = {
  cols: 12,
  rows: 5,
  items: [{ x: 0, y: 0, w: 2, h: 2, rarity: "magic" as const, name: "Ember Wand", itemClass: "wand", lines: ["+12 to maximum Life"] }],
};

describe("InventoryPanel", () => {
  it("shows the PoE2 item tooltip on hover with name, class and affix lines", () => {
    render(<InventoryPanel inventory={inv} onClose={() => {}} />);
    expect(screen.getByTestId("inventory-panel")).toBeTruthy();
    const item = screen.getByTestId("inventory-item-0");
    expect(screen.queryByTestId("item-tooltip")).toBeNull();

    fireEvent.mouseEnter(item, { clientX: 100, clientY: 100 });
    const tip = screen.getByTestId("item-tooltip");
    expect(tip.textContent).toContain("Ember Wand");
    expect(tip.textContent).toContain("wand");
    expect(tip.textContent).toContain("+12 to maximum Life");

    fireEvent.mouseLeave(item);
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
  });
});
