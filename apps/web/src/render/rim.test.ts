// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { FreeCamera, Mesh, MeshBuilder, NullEngine, PBRMaterial, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
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
    plugin.hardBindForSubMesh(a.ubo, s, engine!, struck);
    expect(a.floats["hitFlash"]).toBe(0.5);

    const b = fakeUbo();
    plugin.hardBindForSubMesh(b.ubo, s, engine!, idle);
    expect(b.floats["hitFlash"]).toBe(0);
  });

  /**
   * PBR skips a plugin's `bindForSubMesh` when the same material draws again
   * with the same effect, so every draw after the first kept the first mesh's
   * flash: one struck monster lit its whole species, or a struck one stayed dark.
   */
  it("draws each mesh sharing the material with its own flash", async () => {
    const s = scene();
    new FreeCamera("cam", new Vector3(0, 0, -10), s);
    const hide = new PBRMaterial("hide", s);
    addRim(hide);
    const meshes = ["a", "b", "c"].map((n, i) => {
      const m = MeshBuilder.CreateBox(n, {}, s);
      m.position.x = i * 2 - 2;
      m.material = hide;
      return m;
    });
    const drawn: Record<string, number[]> = {};
    let flash = -1;
    // Babylon's bind leaves the uniform in place until the next update: capture the
    // hitFlash in force when each mesh's bind finishes, which is what its draw reads.
    const ubo = (hide as unknown as { _uniformBuffer: UniformBuffer })._uniformBuffer;
    const update = ubo.updateFloat.bind(ubo);
    ubo.updateFloat = (name: string, v: number) => { if (name === "hitFlash") flash = v; update(name, v); };
    const bind = hide.bindForSubMesh.bind(hide);
    hide.bindForSubMesh = (world, mesh, sub) => { bind(world, mesh, sub); (drawn[mesh.name] ??= []).push(flash); };

    await s.whenReadyAsync();
    s.render();
    for (const k of Object.keys(drawn)) delete drawn[k];
    // Struck in the middle, so both draw orders put an unstruck mesh after it.
    setHitFlash(meshes[1]!, 1);
    s.render();
    expect(drawn).toEqual({ a: [0], b: [1], c: [0] });
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

  /**
   * The contact-shadow quad and the rare's aura ring hang under the same actor
   * root but are not the body: overlaying them draws a white square under every
   * struck monster (owner-reported after the plugin flash landed).
   */
  it("never flashes the ground blob or the aura ring", () => {
    const s = scene();
    const root = new Mesh("actor", s);
    const blob = new Mesh("groundblob-actor", s);
    blob.parent = root;
    blob.material = new StandardMaterial("blob", s);
    const aura = new Mesh("rare-aura", s);
    aura.parent = root;
    aura.material = new StandardMaterial("aura", s);

    setHitFlash(root, 1);
    expect(blob.renderOverlay).toBeFalsy();
    expect(aura.renderOverlay).toBeFalsy();
  });
});
