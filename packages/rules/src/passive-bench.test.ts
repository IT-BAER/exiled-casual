import { describe, it, expect } from "vitest";
import {
  PASSIVE_BENCH_BUDGETS, PASSIVE_BENCH_STATS, cheapestPassivePath, passiveAxisValue, passiveBench,
} from "./passive-bench";
import { PASSIVE_TREE, canAllocate, passiveTheme } from "./passives";
import { CLASS_IDS } from "./classes";

/**
 * The passive tree, measured from each door. Points are allocations from nothing
 * with every step legal (a notable's majority of minors included); a unit is one
 * minor of the stat's own theme (`PASSIVE_BENCH_STATS`).
 *
 *   points to          ironsworn  stalker  emberbound
 *   notable  spell          6        16         7
 *            cast          10         7        11
 *            crit           4        11        15
 *            life          11        13         4
 *            brawn          6        16        21
 *            armour         4        11        22
 *            ward          16         4        17
 *            fire/cold/lightning res  17/20/21  11/14/4  7/14/14
 *            chaos res     13        14        25
 *            mana          12         7        11
 *   spoke    ember/ash/cinder/stone    15/10/4/4    16/21/21/16   4/11/16/21
 *            bulwark/veil/storm/hearth 9/14/19/20   11/4/4/11     22/17/12/4
 *   keystone ashen heart   12        21        17
 *            rooted        15        15        22
 *            glass ward    19        13        18
 *            live wire     20        14        16
 *
 *   axis totals at 10 / 20 / 50 / 99 points
 *   offence  ironsworn   13.42 / 33.33 / 75.33 / 110.42
 *            stalker      8.67 / 29.75 / 66.92 / 110.42
 *            emberbound   7.67 / 22.83 / 66.58 / 110.42
 *   defence  ironsworn   16.01 / 38.80 / 86.57 / 142.78
 *            stalker     15.19 / 32.19 / 82.55 / 142.31
 *            emberbound  14.25 / 25.08 / 77.01 / 145.03
 *   min/max  offence      0.57 /  0.68 /  0.88 /   1.00
 *            defence      0.89 /  0.65 /  0.89 /   0.98
 *
 *   travel share at 99   offence 2% / 5% / 2%   defence 0% / 6% / 4%
 *
 * At 99 points the offence walk runs out of offence before it runs out of points
 * (84 / 87 / 89 spent), so the column is the whole tree's offence for every door.
 *
 * Against `PASSIVE_BENCH_TARGET` (measured here, not asserted): every keystone is
 * within 60 of every door and every door reaches an offence notable and a defence
 * notable within 12 points (offence 4 / 7 / 7, defence 4 / 4 / 4), but the 0.90
 * axis ratio holds only at 99 points, on both axes.
 */

const BENCH = passiveBench();

describe("the passive bench", () => {
  it("prices every theme's minor at one unit of its own stat", () => {
    for (const n of PASSIVE_TREE) {
      if (n.kind !== "minor" || passiveTheme(n.id) === "travel") continue;
      for (const m of n.mods) expect(PASSIVE_BENCH_STATS[m.stat]?.unit, n.id).toBe(m.value);
    }
  });

  it("walks only legal steps, inside the budget", () => {
    for (const c of BENCH) {
      for (const axis of ["offence", "defence"] as const) {
        for (const budget of PASSIVE_BENCH_BUDGETS) {
          const walk = c.walks[axis][budget]!;
          expect(walk.nodes.length).toBeLessThanOrEqual(budget);
          const taken: string[] = [];
          for (const id of walk.nodes) {
            expect(canAllocate(c.classId, taken, id), `${c.classId} ${axis} ${budget}: ${id}`).toBe(true);
            taken.push(id);
          }
          const total = walk.nodes.reduce((s, id) => s + passiveAxisValue(id, axis), 0);
          expect(walk.total).toBeCloseTo(total, 2);
        }
      }
    }
  });

  it("prices a path by a legal walk of exactly that many steps", () => {
    for (const classId of CLASS_IDS) {
      for (const id of ["p.ember.0.hub", "p.keystone.rooted"]) {
        const path = cheapestPassivePath(classId, id)!;
        const taken: string[] = [];
        for (const step of path) {
          expect(canAllocate(classId, taken, step)).toBe(true);
          taken.push(step);
        }
        expect(taken.at(-1)).toBe(id);
      }
    }
  });

  it("is deterministic", () => {
    expect(passiveBench()).toEqual(BENCH);
  });

  it("measures the current tree", () => {
    const summary = BENCH.map((c) => ({
      classId: c.classId,
      notableByTheme: c.notableByTheme,
      notableBySpoke: c.notableBySpoke,
      keystone: c.keystone,
      offence: PASSIVE_BENCH_BUDGETS.map((b) => c.walks.offence[b]!.total),
      defence: PASSIVE_BENCH_BUDGETS.map((b) => c.walks.defence[b]!.total),
      travelShare: c.travelShare,
    }));
    expect(summary).toMatchInlineSnapshot(`
      [
        {
          "classId": "class.ironsworn",
          "defence": [
            16.01,
            38.8,
            86.57,
            142.78,
          ],
          "keystone": {
            "p.keystone.ashen_heart": 12,
            "p.keystone.glass_ward": 19,
            "p.keystone.live_wire": 20,
            "p.keystone.rooted": 15,
          },
          "notableBySpoke": {
            "ash": 10,
            "bulwark": 9,
            "cinder": 4,
            "ember": 15,
            "hearth": 20,
            "stone": 4,
            "storm": 19,
            "veil": 14,
          },
          "notableByTheme": {
            "armour": 4,
            "brawn": 6,
            "cast": 10,
            "chaosRes": 13,
            "coldRes": 20,
            "crit": 4,
            "fireRes": 17,
            "life": 11,
            "lightRes": 21,
            "mana": 12,
            "spell": 6,
            "ward": 16,
          },
          "offence": [
            13.42,
            33.33,
            75.33,
            110.42,
          ],
          "travelShare": {
            "defence": 0,
            "offence": 0.02,
          },
        },
        {
          "classId": "class.stalker",
          "defence": [
            15.19,
            32.19,
            82.55,
            142.31,
          ],
          "keystone": {
            "p.keystone.ashen_heart": 21,
            "p.keystone.glass_ward": 13,
            "p.keystone.live_wire": 14,
            "p.keystone.rooted": 15,
          },
          "notableBySpoke": {
            "ash": 21,
            "bulwark": 11,
            "cinder": 21,
            "ember": 16,
            "hearth": 11,
            "stone": 16,
            "storm": 4,
            "veil": 4,
          },
          "notableByTheme": {
            "armour": 11,
            "brawn": 16,
            "cast": 7,
            "chaosRes": 14,
            "coldRes": 14,
            "crit": 11,
            "fireRes": 11,
            "life": 13,
            "lightRes": 4,
            "mana": 7,
            "spell": 16,
            "ward": 4,
          },
          "offence": [
            8.67,
            29.75,
            66.92,
            110.42,
          ],
          "travelShare": {
            "defence": 0.06,
            "offence": 0.05,
          },
        },
        {
          "classId": "class.emberbound",
          "defence": [
            14.25,
            25.08,
            77.01,
            145.03,
          ],
          "keystone": {
            "p.keystone.ashen_heart": 17,
            "p.keystone.glass_ward": 18,
            "p.keystone.live_wire": 16,
            "p.keystone.rooted": 22,
          },
          "notableBySpoke": {
            "ash": 11,
            "bulwark": 22,
            "cinder": 16,
            "ember": 4,
            "hearth": 4,
            "stone": 21,
            "storm": 12,
            "veil": 17,
          },
          "notableByTheme": {
            "armour": 22,
            "brawn": 21,
            "cast": 11,
            "chaosRes": 25,
            "coldRes": 14,
            "crit": 15,
            "fireRes": 7,
            "life": 4,
            "lightRes": 14,
            "mana": 11,
            "spell": 7,
            "ward": 17,
          },
          "offence": [
            7.67,
            22.83,
            66.58,
            110.42,
          ],
          "travelShare": {
            "defence": 0.04,
            "offence": 0.02,
          },
        },
      ]
    `);
  });
});
