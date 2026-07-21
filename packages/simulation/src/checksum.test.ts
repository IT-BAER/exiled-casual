import { describe, expect, test } from "vitest";
import { World, serializeWorld, checksumWorld } from "./index";

describe("checksum", () => {
  test("serialization is canonical regardless of insertion order", () => {
    const a = new World();
    const e1 = a.create();
    const e2 = a.create();
    a.set(e1, "position", { y: 2, x: 1 });
    a.set(e2, "position", { x: 3, y: 4 });

    const b = new World();
    const f1 = b.create();
    const f2 = b.create();
    b.set(f2, "position", { x: 3, y: 4 });
    b.set(f1, "position", { x: 1, y: 2 });

    expect(serializeWorld(a)).toBe(serializeWorld(b));
    expect(checksumWorld(a)).toBe(checksumWorld(b));
  });

  test("different state produces a different checksum", () => {
    const a = new World();
    const e = a.create();
    a.set(e, "position", { x: 1, y: 2 });

    const b = new World();
    const f = b.create();
    b.set(f, "position", { x: 1, y: 3 });

    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
  });

  test("throws on a non-integer (float-leakage) numeric value", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "position", { x: 1.5, y: 2 });
    expect(() => checksumWorld(w)).toThrow(/non-integer/);
  });

  test("a live entity with no components changes the checksum", () => {
    const a = new World();
    a.create();

    const b = new World();
    b.create();
    b.create(); // second entity is alive but carries no components

    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
  });

  test("allocator history (next id) affects the checksum independently of the alive set", () => {
    // Both worlds end with the identical alive set {1}, but different next id,
    // so the next create() would diverge — the checksum must catch that.
    const a = new World();
    a.create(); // id 1
    a.create(); // id 2
    a.destroy(2); // alive={1}, next=3

    const b = new World();
    b.create(); // alive={1}, next=2

    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
  });

  test("serializes an array-valued field (e.g. SessionC.completedNodes), order-sensitive", () => {
    // completedNodes is an ordered string[]; the checksum must hash it (it gates
    // sim behaviour) rather than throw, and element order must matter.
    const a = new World();
    const e = a.create();
    a.set(e, "session", { area: "map", completedNodes: ["node.a", "node.b"] });

    const b = new World();
    const f = b.create();
    b.set(f, "session", { area: "map", completedNodes: ["node.b", "node.a"] });

    expect(() => checksumWorld(a)).not.toThrow();
    expect(checksumWorld(a)).not.toBe(checksumWorld(b));

    const c = new World();
    const g = c.create();
    c.set(g, "session", { area: "map", completedNodes: ["node.a", "node.b"] });
    expect(checksumWorld(a)).toBe(checksumWorld(c));
  });

  test("checksum is an unsigned 32-bit integer", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "position", { x: 1, y: 2 });
    const c = checksumWorld(w);
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(0xffffffff);
  });
});
