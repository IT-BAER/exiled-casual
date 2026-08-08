// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { Mesh, NullEngine, PBRMaterial, Scene, StandardMaterial } from "@babylonjs/core";
import type { SubMesh, UniformBuffer } from "@babylonjs/core";
import { addRim } from "./rim";
import { setHitFlash } from "./meshes";

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

/**
 * The hit flash rides the rim plugin, not Babylon's `renderOverlay`: the extra
 * overlay pass mis-renders on skinned PBR materials carrying this plugin (a
 * data texture drawn as colour — green hatch rows on every hit tick). The
 * material stays shared per species, so the flash value lives on the MESH
 * (metadata) and is read per submesh at bind time.
 */
describe("hit flash through the rim plugin", () => {
  function fakeUbo(): { floats: Record<string, number>; ubo: UniformBuffer } {
    const floats: Record<string, number> = {};
    const ubo = {
      updateFloat: (name: string, v: number) => { floats[name] = v; },
      updateColor3: () => {},
    } as unknown as UniformBuffer;
    return { floats, ubo };
  }

  it("declares the hitFlash uniform and mixes it after tone mapping", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;
    expect(plugin.getUniforms().ubo!.some((u) => u.name === "hitFlash")).toBe(true);
    expect(plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("hitFlash");
  });

  it("binds the struck mesh's flash and 0 for an untouched one", () => {
    const s = scene();
    const material = new PBRMaterial("hide", s);
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;

    const struck = { getMesh: () => ({ metadata: { hitFlash: 0.5 } }) } as unknown as SubMesh;
    const idle = { getMesh: () => ({ metadata: null }) } as unknown as SubMesh;

    const a = fakeUbo();
    plugin.bindForSubMesh(a.ubo, s, engine!, struck);
    expect(a.floats["hitFlash"]).toBe(0.5);

    const b = fakeUbo();
    plugin.bindForSubMesh(b.ubo, s, engine!, idle);
    expect(b.floats["hitFlash"]).toBe(0);
  });

  it("setHitFlash writes metadata on plugin meshes and overlays the rest", () => {
    const s = scene();
    const root = new Mesh("actor", s);
    const skinned = new Mesh("body", s);
    skinned.parent = root;
    const hide = new PBRMaterial("hide", s);
    addRim(hide);
    skinned.material = hide;
    const greybox = new Mesh("box", s);
    greybox.parent = root;
    greybox.material = new StandardMaterial("grey", s);

    setHitFlash(root, 0.7);
    expect((skinned.metadata as { hitFlash?: number }).hitFlash).toBeCloseTo(0.7);
    expect(skinned.renderOverlay).toBe(false);
    expect(greybox.renderOverlay).toBe(true);

    setHitFlash(root, 0);
    expect((skinned.metadata as { hitFlash?: number }).hitFlash).toBe(0);
    expect(greybox.renderOverlay).toBe(false);
  });
});
