// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Snapshot } from "@exiled/protocol";
import { BuffBar } from "./BuffBar";

afterEach(cleanup);

function snap(buffs: Snapshot["player"]["buffs"]): Snapshot {
  return { player: { buffs } } as unknown as Snapshot;
}

describe("BuffBar", () => {
  it("draws nothing with no effects, and nothing without a snapshot", () => {
    render(<BuffBar snapshot={null} />);
    expect(screen.queryByTestId("buff-bar")).toBeNull();
    render(<BuffBar snapshot={snap([])} />);
    expect(screen.queryByTestId("buff-bar")).toBeNull();
  });

  it("shows the grace buff with its seconds left", () => {
    render(<BuffBar snapshot={snap([{ id: "grace", kind: "buff", remainingSec: 7 }])} />);
    const bar = screen.getByTestId("buff-bar");
    expect(bar.textContent).toContain("7");
    expect(bar.querySelector("img")!.getAttribute("src")).toBe("/textures/buffs/grace.webp");
  });

  it("splits debuffs into a second row", () => {
    render(<BuffBar snapshot={snap([
      { id: "grace", kind: "buff", remainingSec: 3 },
      { id: "burning", kind: "debuff", remainingSec: 2 },
    ])} />);
    const bar = screen.getByTestId("buff-bar");
    expect(bar.children.length).toBe(2);
  });

  it("gives every ailment its own face and name, and a stacked one its count", () => {
    render(<BuffBar snapshot={snap([
      { id: "burning", kind: "debuff", remainingSec: 2, stacks: 4 },
      { id: "poison", kind: "debuff", remainingSec: 1 },
      { id: "bleeding", kind: "debuff", remainingSec: 5 },
    ])} />);
    for (const [id, name] of [["burning", "Burning"], ["poison", "Poisoned"], ["bleeding", "Bleeding"]]) {
      const tile = screen.getByLabelText(name!);
      expect(tile.querySelector("img")!.getAttribute("src")).toBe(`/textures/buffs/${id}.webp`);
    }
    expect(screen.getByTestId("buff-stacks").textContent).toBe("4");
    // One stack is no count at all: only burning stacks.
    expect(screen.getAllByTestId("buff-stacks")).toHaveLength(1);
  });

  it("lights an aura's frame and gives it no timer, and paints the class buffs", () => {
    render(<BuffBar snapshot={snap([
      { id: "haste", kind: "buff", remainingSec: 0, aura: true },
      { id: "blood_rage", kind: "buff", remainingSec: 6 },
    ])} />);
    const tiles = screen.getAllByTestId("buff-tile");
    expect(tiles.map((t) => t.getAttribute("data-aura"))).toEqual(["true", "false"]);
    expect(tiles[0]!.querySelector("[data-testid='buff-seconds']")).toBeNull();
    expect(tiles[1]!).toHaveTextContent("6");
    expect(tiles.map((t) => t.querySelector("img")!.getAttribute("src")))
      .toEqual(["/textures/buffs/haste.webp", "/textures/buffs/blood_rage.webp"]);
  });

  it("names the effect on hover with what it does: an aura its held mana, a timed one its seconds", () => {
    render(<BuffBar snapshot={snap([
      { id: "haste", kind: "buff", remainingSec: 0, aura: true, reserved: 50, lines: ["Aura: reserves 25% of maximum Mana", "10% increased Movement Speed"] },
      { id: "burning", kind: "debuff", remainingSec: 3, stacks: 2, lines: ["Takes 8 Fire Damage per second"] },
    ])} />);
    expect(screen.queryByTestId("item-tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByLabelText("Windstride"));
    const aura = screen.getByTestId("item-tooltip");
    expect(aura).toHaveTextContent("Windstride");
    expect(aura).toHaveTextContent("10% increased Movement Speed");
    expect(aura).toHaveTextContent("Holds 50 Mana");
    fireEvent.mouseLeave(screen.getByLabelText("Windstride"));
    fireEvent.mouseEnter(screen.getByLabelText("Burning"));
    const burn = screen.getByTestId("item-tooltip");
    expect(burn).toHaveTextContent("Takes 8 Fire Damage per second");
    expect(burn).toHaveTextContent("3 seconds remaining");
  });
});
