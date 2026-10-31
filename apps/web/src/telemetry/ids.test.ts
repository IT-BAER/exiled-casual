import { describe, expect, it } from "vitest";
import { ATLAS_NODE_IDS, BIOME_IDS } from "@exiled/telemetry";
import { atlasGraph } from "@exiled/rules";
import { BIOMES } from "@exiled/content-runtime";

// @exiled/telemetry is a leaf and cannot import the ids it validates, so it holds copies:
// this is the test that fails the day the game and the parser disagree.
describe("the ids telemetry accepts", () => {
  it("are every Atlas node the game has", () => {
    expect([...ATLAS_NODE_IDS].sort()).toEqual(atlasGraph(1).map((n) => n.id).sort());
  });

  it("are every biome the game has", () => {
    expect([...BIOME_IDS].sort()).toEqual(Object.keys(BIOMES).sort());
  });
});
