import { describe, expect, test } from "vitest";
import { World } from "./index";

describe("ecs World", () => {
  test("create assigns unique ids and tracks liveness", () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    expect(a).not.toBe(b);
    w.destroy(a);
    expect(w.has(a, "anything")).toBe(false);
  });

  test("set/get/has/remove components", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "position", { x: 1, y: 2 });
    expect(w.get<{ x: number; y: number }>(e, "position")).toEqual({ x: 1, y: 2 });
    expect(w.has(e, "position")).toBe(true);
    w.remove(e, "position");
    expect(w.has(e, "position")).toBe(false);
  });

  test("query returns entities with all components in ascending id order", () => {
    const w = new World();
    const e1 = w.create();
    const e2 = w.create();
    const e3 = w.create();
    w.set(e1, "position", { x: 0, y: 0 });
    w.set(e1, "motion", { vx: 0, vy: 0 });
    w.set(e2, "position", { x: 0, y: 0 });
    w.set(e3, "position", { x: 0, y: 0 });
    w.set(e3, "motion", { vx: 0, vy: 0 });
    expect(w.query("position", "motion")).toEqual([e1, e3]);
  });

  test("destroy clears the entity from every store", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "position", { x: 0, y: 0 });
    w.destroy(e);
    expect(w.entitiesWith("position")).toEqual([]);
  });

  test("componentNames is sorted", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "zeta", { a: 1 });
    w.set(e, "alpha", { a: 1 });
    expect(w.componentNames()).toEqual(["alpha", "zeta"]);
  });
});
