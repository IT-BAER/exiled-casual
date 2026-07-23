// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
});
