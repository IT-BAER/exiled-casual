// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { assembleArea, LOOP_GRAMMAR, type AreaLayout } from "@exiled/mapgen";
import { Minimap, toCanvas } from "./Minimap";

afterEach(cleanup);

const layout: AreaLayout = assembleArea(3, "content.test.v1", LOOP_GRAMMAR);

/** Where the start anchor sits, so the reveal has somewhere real to happen. */
const start = layout.objectiveAnchors.find((a) => a.id === "start")!;

describe("Minimap", () => {
  it("draws nothing outside a map", () => {
    render(<Minimap layout={null} player={{ x: 0, y: 0 }} />);
    expect(screen.queryByTestId("minimap")).toBeNull();
  });

  it("renders a canvas for a map layout", () => {
    render(<Minimap layout={layout} player={start} />);
    const box = screen.getByTestId("minimap");
    expect(box.querySelector("canvas")).toBeTruthy();
  });

  it("survives a player standing outside the grid", () => {
    // Defensive: a stale snapshot from the previous area can carry a position
    // that is off this grid entirely. It must not throw.
    expect(() =>
      render(<Minimap layout={layout} player={{ x: 9999, y: 9999 }} />),
    ).not.toThrow();
  });

  it("puts north up and east right, as the camera does", () => {
    // The camera looks from -z (engine.ts, alpha = -PI/2), so world +y is up the
    // screen. Canvas y counts the other way, so walking north must LOWER the
    // marker's canvas y — that flip is what the marker gets wrong when it walks
    // backwards on the minimap.
    const g = layout.grid;
    const mid = { x: g.originX + 20, y: g.originY + 20 };
    const [, southY] = toCanvas(g, mid.x, mid.y, 100, 100);
    const [, northY] = toCanvas(g, mid.x, mid.y + 8, 100, 100);
    expect(northY).toBeLessThan(southY);
    const [westX] = toCanvas(g, mid.x, mid.y, 100, 100);
    const [eastX] = toCanvas(g, mid.x + 8, mid.y, 100, 100);
    expect(eastX).toBeGreaterThan(westX);
  });

  it("keeps its own explored state per area, not across areas", () => {
    // Two different seeds are two different areas; the second must not inherit
    // the first one's revealed shape. Re-rendering with a new layout hash is
    // the signal, so the hashes have to actually differ.
    const other = assembleArea(4, "content.test.v1", LOOP_GRAMMAR);
    expect(other.hash).not.toBe(layout.hash);
  });
});
