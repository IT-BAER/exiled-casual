// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InventoryPanel } from "./InventoryPanel";

afterEach(cleanup);

const inv = {
  cols: 12,
  rows: 5,
  items: [{ x: 0, y: 0, w: 2, h: 2, rarity: "magic" as const, name: "Ember Wand", lines: ["+12 to maximum Life"] }],
};

describe("InventoryPanel", () => {
  it("renders the grid and a placed item with its tooltip text", () => {
    render(<InventoryPanel inventory={inv} onClose={() => {}} />);
    expect(screen.getByTestId("inventory-panel")).toBeTruthy();
    const item = screen.getByTestId("inventory-item-0");
    expect(item.getAttribute("title")).toContain("Ember Wand");
    expect(item.getAttribute("title")).toContain("+12 to maximum Life");
  });
});
