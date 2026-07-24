// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ItemTooltip } from "./ItemTooltip";

afterEach(cleanup);

describe("ItemTooltip", () => {
  it("shows the base type as a second header line for a rare item", () => {
    render(<ItemTooltip name="Corpse Husk" baseName="Ember Wand" rarity="rare" lines={[]} x={0} y={0} />);
    expect(screen.getByText("Corpse Husk")).toBeTruthy();
    expect(screen.getByText("Ember Wand")).toBeTruthy();
  });

  it("renders a unique's flavour line and omits it when absent", () => {
    render(<ItemTooltip name="Ashmaw" baseName="Ember Wand" rarity="unique" lines={["+30 to Fire Damage"]} flavour="It was a torch, once." x={0} y={0} />);
    expect(screen.getByText("It was a torch, once.")).toBeTruthy();
    cleanup();
    render(<ItemTooltip name="Ember Wand" rarity="normal" lines={[]} x={0} y={0} />);
    expect(screen.queryByText("It was a torch, once.")).toBeNull();
  });

  it("does not repeat the name when baseName equals name (normal item)", () => {
    render(<ItemTooltip name="Ember Wand" baseName="Ember Wand" rarity="normal" lines={[]} x={0} y={0} />);
    expect(screen.getAllByText("Ember Wand").length).toBe(1);
  });
});
