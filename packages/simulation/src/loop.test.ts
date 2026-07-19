import { describe, expect, test } from "vitest";
import { Simulation, type Command } from "./index";

describe("Simulation loop", () => {
  test("systems run in registration order every tick", () => {
    const sim = new Simulation();
    const log: string[] = [];
    sim.register("first", () => log.push("first"));
    sim.register("second", () => log.push("second"));
    sim.step();
    expect(log).toEqual(["first", "second"]);
    expect(sim.systemOrder()).toEqual(["first", "second"]);
  });

  test("tick increments after each step", () => {
    const sim = new Simulation();
    expect(sim.tick).toBe(0);
    sim.step();
    sim.step();
    expect(sim.tick).toBe(2);
  });

  test("commands are passed to systems for the current step", () => {
    const sim = new Simulation();
    const seen: Command[][] = [];
    sim.register("recorder", (_w, _t, cmds) => seen.push([...cmds]));
    const cmd: Command = { tick: 0, type: "impulse", data: { dvx: 5 } };
    sim.step([cmd]);
    expect(seen[0]).toEqual([cmd]);
  });
});
