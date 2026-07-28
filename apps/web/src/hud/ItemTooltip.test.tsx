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

  it("renders the implicit in its own block above the rolled mods", () => {
    render(<ItemTooltip name="Ember Wand" rarity="normal" implicit="12% increased Spell Damage" lines={["+24 to maximum Mana"]} x={0} y={0} />);
    // Own block, not folded into the mod list: reference-screenshots/item-rare.png sets the
    // implicit off from the explicits with its own gap.
    const block = screen.getByTestId("item-implicit");
    expect(block.textContent).toBe("12% increased Spell Damage");
    expect(block.compareDocumentPosition(screen.getByText("+24 to maximum Mana")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    render(<ItemTooltip name="Cinder Cap" rarity="normal" lines={[]} x={0} y={0} />);
    expect(screen.queryByTestId("item-implicit")).toBeNull();
  });

  it("does not repeat the name when baseName equals name (normal item)", () => {
    render(<ItemTooltip name="Ember Wand" baseName="Ember Wand" rarity="normal" lines={[]} x={0} y={0} />);
    expect(screen.getAllByText("Ember Wand").length).toBe(1);
  });
});

describe("unidentified items", () => {
  it("marks an unread drop with a red Unidentified line", () => {
    render(<ItemTooltip name="Ember Wand" rarity="rare" lines={[]} unidentified x={0} y={0} />);
    expect(screen.getByTestId("item-unidentified").textContent).toBe("Unidentified");
  });

  it("says nothing on an identified item", () => {
    render(<ItemTooltip name="Corpse Husk" rarity="rare" lines={["+33 to maximum Life"]} x={0} y={0} />);
    expect(screen.queryByTestId("item-unidentified")).toBeNull();
  });
});
