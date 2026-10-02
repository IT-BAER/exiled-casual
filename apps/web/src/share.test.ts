import { describe, expect, it } from "vitest";
import { share } from "./share";

describe("share", () => {
  it("hands back the previous value when nothing changed", () => {
    const prev = { a: 1, b: { c: [1, 2, { d: "x" }] } };
    expect(share(prev, structuredClone(prev))).toBe(prev);
  });

  it("keeps every unchanged branch and replaces only the changed path", () => {
    const prev = { player: { x: 1, flasks: { life: 3 } }, inventory: { items: [{ id: 1 }, { id: 2 }] } };
    const next = structuredClone(prev);
    next.player.x = 2;
    const out = share(prev, next);
    expect(out).not.toBe(prev);
    expect(out.player).not.toBe(prev.player);
    expect(out.player.x).toBe(2);
    expect(out.player.flasks).toBe(prev.player.flasks);
    expect(out.inventory).toBe(prev.inventory);
  });

  it("sees added, removed and resized members as changes", () => {
    expect(share({ a: 1 } as Record<string, number>, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    const prev = { a: 1, b: 2 } as Record<string, number>;
    expect(share(prev, { a: 1 })).not.toBe(prev);
    const arr = [1, 2];
    expect(share(arr, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(share(null as { a: number } | null, { a: 1 })).toEqual({ a: 1 });
  });
});
