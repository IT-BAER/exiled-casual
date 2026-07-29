// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, PBRMaterial, Scene } from "@babylonjs/core";
import { addRim } from "./rim";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

describe("creature rim light", () => {
  it("attaches to a material and injects the term after tone mapping", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);

    const plugin = material.pluginManager?.getPlugin("ExiledRim");
    expect(plugin, "the plugin is on the material").toBeTruthy();

    const code = plugin!.getCustomCode("fragment")!;
    // After `finalColor` exists, or the rim is an albedo the lights then get to
    // multiply — which is a paler creature, not a lit edge.
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("finalColor.rgb +=");
    // Guarded: a mesh with no normals compiles rather than takes every creature
    // sharing the material down with it.
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("#ifdef NORMAL");
    expect(plugin!.getCustomCode("vertex")).toBeNull();
  });

  /**
   * `loadMonsters` walks the container's materials on every load, and a scene
   * that reloads them would otherwise stack a second term on the same surface —
   * twice the rim, at no point visible as a bug rather than as a bright monster.
   */
  it("is idempotent", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);
    const first = material.pluginManager!.getPlugin("ExiledRim");
    addRim(material);
    expect(material.pluginManager!.getPlugin("ExiledRim")).toBe(first);
  });
});
