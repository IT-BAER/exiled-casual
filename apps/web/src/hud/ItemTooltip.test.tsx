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

describe("placement around the cursor", () => {
  // jsdom's window is 1024x768. `x`/`y` are the pointer itself, which is the tip
  // of the arrow: every edge of the panel is measured off that one point.
  const at = (x: number, y: number) => {
    cleanup();
    render(<ItemTooltip name="Ember Wand" rarity="normal" lines={[]} x={x} y={y} />);
    return screen.getByTestId("item-tooltip").style;
  };

  it("opens down and right of the tip, clear of the arrow", () => {
    const s = at(100, 100);
    expect(parseFloat(s.left)).toBeGreaterThan(100);
    expect(parseFloat(s.top)).toBeGreaterThan(100);
  });

  it("clears the tip upward when it opens upward", () => {
    // The panel grows up from a low cursor, so the same gap has to be measured
    // from its BOTTOM edge. Anchoring bottom at the cursor drew it over the arrow.
    const s = at(100, 700);
    expect(s.top).toBe("");
    expect(768 - parseFloat(s.bottom)).toBeLessThan(700);
  });

  it("opens to the left of the tip rather than under it at the right edge", () => {
    const s = at(1000, 100);
    const left = parseFloat(s.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + 300).toBeLessThan(1000);
  });

  it("stays on screen in the corner it cannot fit either way", () => {
    const s = at(1020, 760);
    expect(parseFloat(s.left)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(s.bottom)).toBeGreaterThanOrEqual(0);
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
