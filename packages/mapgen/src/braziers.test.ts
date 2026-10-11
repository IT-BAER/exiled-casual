import { describe, it, expect } from "vitest";
import { generateArea, type GrammarId } from "./mapgen";
import { brazierSpotsFor, BRAZIER_RADIUS } from "./braziers";

describe("brazierSpotsFor", () => {
  it("never stands a bowl where it would pin the arriving player", () => {
    // Body 0.5 + bowl: a start inside that reach cannot take a single step.
    for (const g of ["loop", "open-field", "sunken-ruins", "coast"] as GrammarId[]) {
      for (let seed = 0; seed < 60; seed++) {
        const layout = generateArea(seed, "v", g);
        const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
        for (const s of brazierSpotsFor(layout)) {
          expect(Math.hypot(s.x - start.x, s.z - start.y), `${g} seed ${seed}`).toBeGreaterThan(0.5 + BRAZIER_RADIUS);
        }
      }
    }
  }, 30_000);
});
