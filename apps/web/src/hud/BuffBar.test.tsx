// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    expect(bar.querySelector("img")!.getAttribute("src")).toBe("/textures/buffs/grace.png");
  });

  it("splits debuffs into a second row", () => {
    render(<BuffBar snapshot={snap([
      { id: "grace", kind: "buff", remainingSec: 3 },
      { id: "burning", kind: "debuff", remainingSec: 2 },
    ])} />);
    const bar = screen.getByTestId("buff-bar");
    expect(bar.children.length).toBe(2);
  });
});
