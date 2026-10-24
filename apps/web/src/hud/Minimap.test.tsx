// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { assembleArea, LOOP_GRAMMAR, type AreaLayout } from "@exiled/mapgen";
import { Minimap, MINIMAP_WATER, paintTerrain, toCanvas } from "./Minimap";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("centres and fades as the Tab overlay, doubling its resolution", () => {
    render(<Minimap layout={layout} player={start} overlay overlayOpacity={0.4} />);
    const box = screen.getByTestId("minimap");
    expect(box.style.transform).toBe("translate(-50%, -50%)");
    expect(box.style.opacity).toBe("0.4");
    expect(box.querySelector("canvas")!.width).toBe(768);
  });

  it("redraws when Tab switches between corner and overlay while the player stands still", () => {
    // The switch resizes the canvas, which clears it; a player who stops to read
    // the map would otherwise get an empty overlay until he takes a step.
    const draws = new Map<HTMLCanvasElement, number>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this;
      return new Proxy({}, {
        get: (_t, k) => k === "drawImage"
          ? () => draws.set(canvas, (draws.get(canvas) ?? 0) + 1)
          : k === "createRadialGradient" ? () => ({ addColorStop: () => {} })
          : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) })
          : () => {},
        set: () => true,
      }) as unknown as CanvasRenderingContext2D;
    });
    const still = { x: start.x, y: start.y };
    const { rerender } = render(<Minimap layout={layout} player={still} />);
    const shown = screen.getByTestId("minimap").querySelector("canvas")!;
    const before = draws.get(shown) ?? 0;
    expect(before).toBeGreaterThan(0);
    rerender(<Minimap layout={layout} player={still} overlay />);
    expect(draws.get(shown) ?? 0).toBeGreaterThan(before);
    const atOverlay = draws.get(shown)!;
    rerender(<Minimap layout={layout} player={still} />);
    expect(draws.get(shown)!).toBeGreaterThan(atOverlay);
  });

  it("survives a player standing outside the grid", () => {
    // Defensive: a stale snapshot from the previous area can carry a position
    // that is off this grid entirely. It must not throw.
    expect(() =>
      render(<Minimap layout={layout} player={{ x: 9999, y: 9999 }} />),
    ).not.toThrow();
  });

  it("leans 45°, as the camera does", () => {
    // The camera is yawed (engine.ts, alpha = -PI/4), so world +y runs UP-RIGHT
    // the screen and world +x DOWN-RIGHT. Canvas y counts down, which is the
    // flip the marker gets wrong when it walks backwards on the minimap.
    const g = layout.grid;
    const mid = { x: g.originX + 20, y: g.originY + 20 };
    const [ox, oy] = toCanvas(g, mid.x, mid.y, 100, 100);
    const [nx, ny] = toCanvas(g, mid.x, mid.y + 8, 100, 100);
    expect(ny).toBeLessThan(oy);
    expect(nx).toBeGreaterThan(ox);
    const [ex, ey] = toCanvas(g, mid.x + 8, mid.y, 100, 100);
    expect(ex).toBeGreaterThan(ox);
    expect(ey).toBeGreaterThan(oy);
  });

  it("keeps its own explored state per area, not across areas", () => {
    // Two different seeds are two different areas; the second must not inherit
    // the first one's revealed shape. Re-rendering with a new layout hash is
    // the signal, so the hashes have to actually differ.
    const other = assembleArea(4, "content.test.v1", LOOP_GRAMMAR);
    expect(other.hash).not.toBe(layout.hash);
  });

  it("paints a fen's pools as water inside the walkable silhouette, with no contour round them", () => {
    // jsdom has no 2D canvas: a stand-in records what each canvas is filled with.
    const rects = new Map<HTMLCanvasElement, { style: string; x: number; y: number }[]>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this;
      const log: { style: string; x: number; y: number }[] = [];
      rects.set(canvas, log);
      const ctx = {
        fillStyle: "", filter: "", globalCompositeOperation: "",
        fillRect: (x: number, y: number) => log.push({ style: String(ctx.fillStyle), x, y }),
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }),
        putImageData: () => {},
      };
      return ctx as unknown as CanvasRenderingContext2D;
    });
    const g = layout.grid;
    const water = new Uint8Array(g.cells.length);
    const pool: number[] = [];
    for (let i = 0; i < g.cells.length && pool.length < 6; i++) if (g.cells[i] === 1) { water[i] = 1; pool.push(i); }
    paintTerrain({ ...g, water });
    const at = (i: number): string => `${(i % g.cols) * 4 - 0.5},${Math.floor(i / g.cols) * 4 - 0.5}`;
    const masks = [...rects.values()].map((log) => new Set(log.filter((r) => r.style === "#fff").map((r) => `${r.x},${r.y}`)));
    // The walkable silhouette takes the pool in, so the contour cannot run between them.
    const floor = masks.find((m) => m.size > pool.length)!;
    for (const i of pool) expect(floor.has(at(i))).toBe(true);
    // And the pool is its own mask, painted in water.
    const wet = masks.find((m) => m.size === pool.length)!;
    expect([...wet].sort()).toEqual(pool.map(at).sort());
    expect([...rects.values()].flat().some((r) => r.style === MINIMAP_WATER)).toBe(true);

    rects.clear();
    paintTerrain(g);
    expect([...rects.values()].flat().some((r) => r.style === MINIMAP_WATER)).toBe(false);
  });
});
