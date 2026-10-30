// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { FreeCamera, Mesh, MeshBuilder, NullEngine, PBRMaterial, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { SubMesh, UniformBuffer } from "@babylonjs/core";
import { addRim } from "./rim";
import { setDangerGlow, setHitFlash, setHovered, setTier } from "./meshes";

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

  // Outside every light a dark hide is the void's colour; the floor keeps a body
  // there, and a lit creature, already brighter, is left as it was.
  it("never lets the body fall below a floor of its own albedo", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);
    const code = material.pluginManager!.getPlugin("ExiledRim")!.getCustomCode("fragment")!;
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toMatch(/max\(finalColor\.rgb, .*surfaceAlbedo/);
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

/**
 * PoE's rarity shimmer: magic blue, rare yellow, hugging the silhouette. It rides
 * the same per-mesh metadata as the hit flash, so a species keeps one material
 * and a magic imp beside a plain one still draws plain.
 */
describe("rarity glow through the rim plugin", () => {
  function fakeUbo(): { floats: Record<string, number>; colors: Record<string, [number, number, number]>; ubo: UniformBuffer } {
    const floats: Record<string, number> = {};
    const colors: Record<string, [number, number, number]> = {};
    const ubo = {
      updateFloat: (name: string, v: number) => { floats[name] = v; },
      updateColor3: (name: string, c: { r: number; g: number; b: number }) => { colors[name] = [c.r, c.g, c.b]; },
    } as unknown as UniformBuffer;
    return { floats, colors, ubo };
  }

  it("shimmers in the tier colour after tone mapping, along the outline", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;
    const names = plugin.getUniforms().ubo!.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(["tierGlow", "tierColor", "glowTime"]));
    const code = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR!;
    expect(code).toContain("glowTime");
  });

  // Added yellow cannot show on a pale hide: it is already near the top of the
  // range, and on sand the yellow it reaches is the floor's. Mixed toward the
  // tier colour, a cream body turns gold where a dark one still lightens
  // (measured: brightest hide ΔE 6.5 added, 12.1 mixed at the new strength).
  it("pulls the outline toward the tier colour rather than adding to it", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);
    const code = material.pluginManager!.getPlugin("ExiledRim")!.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR!;
    expect(code).toMatch(/finalColor\.rgb = mix\(finalColor\.rgb, tierColor, .*rimFacing/);
    expect(code).not.toMatch(/\+= tierColor/);
  });

  it("binds magic blue, rare yellow and nothing for a plain mesh", () => {
    const s = scene();
    const material = new PBRMaterial("hide", s);
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;
    const sub = (metadata: unknown) => ({ getMesh: () => ({ metadata }) }) as unknown as SubMesh;

    const magic = fakeUbo();
    plugin.hardBindForSubMesh(magic.ubo, s, engine!, sub({ tier: "magic" }));
    expect(magic.floats["tierGlow"]).toBeGreaterThan(0);
    const [mr, , mb] = magic.colors["tierColor"]!;
    expect(mb).toBeGreaterThan(mr);

    const rare = fakeUbo();
    plugin.hardBindForSubMesh(rare.ubo, s, engine!, sub({ tier: "rare" }));
    const [rr, , rb] = rare.colors["tierColor"]!;
    expect(rr).toBeGreaterThan(rb);

    const plain = fakeUbo();
    plugin.hardBindForSubMesh(plain.ubo, s, engine!, sub(null));
    expect(plain.floats["tierGlow"]).toBe(0);
  });

  it("setTier marks the body meshes only, never the ground blob or the aura ring", () => {
    const s = scene();
    const root = new Mesh("actor", s);
    const body = new Mesh("body", s);
    body.parent = root;
    const hide = new PBRMaterial("hide", s);
    addRim(hide);
    body.material = hide;
    const blob = new Mesh("groundblob-actor", s);
    blob.parent = root;
    blob.material = hide;

    setTier(root, "rare");
    expect((body.metadata as { tier?: string }).tier).toBe("rare");
    expect((blob.metadata as { tier?: string } | null)?.tier).toBeUndefined();
  });
});

describe("hover outline through the rim plugin", () => {
  function fakeUbo(): { floats: Record<string, number>; colors: Record<string, [number, number, number]>; ubo: UniformBuffer } {
    const floats: Record<string, number> = {};
    const colors: Record<string, [number, number, number]> = {};
    const ubo = {
      updateFloat: (name: string, v: number) => { floats[name] = v; },
      updateColor3: (name: string, c: { r: number; g: number; b: number }) => { colors[name] = [c.r, c.g, c.b]; },
    } as unknown as UniformBuffer;
    return { floats, colors, ubo };
  }

  it("draws a tight red edge along the outline after tone mapping", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;
    expect(plugin.getUniforms().ubo!.map((u) => u.name)).toContain("hoverGlow");
    const code = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR!;
    expect(code).toMatch(/vec3\(0\.900, 0\.120, 0\.080\) \* pow\(rimFacing, 2\.50\) \* hoverGlow/);
  });

  it("binds the hovered mesh's outline and none for any other", () => {
    const s = scene();
    const material = new PBRMaterial("hide", s);
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;
    const sub = (metadata: unknown) => ({ getMesh: () => ({ metadata }) }) as unknown as SubMesh;

    const hovered = fakeUbo();
    plugin.hardBindForSubMesh(hovered.ubo, s, engine!, sub({ hovered: true }));
    expect(hovered.floats["hoverGlow"]).toBeCloseTo(0.9, 5);

    const plain = fakeUbo();
    plugin.hardBindForSubMesh(plain.ubo, s, engine!, sub({ tier: "rare" }));
    expect(plain.floats["hoverGlow"]).toBe(0);
  });

  it("setHovered marks the body meshes only and clears again", () => {
    const s = scene();
    const root = new Mesh("actor", s);
    const body = new Mesh("body", s);
    body.parent = root;
    const hide = new PBRMaterial("hide", s);
    addRim(hide);
    body.material = hide;
    const aura = new Mesh("rare-aura", s);
    aura.parent = root;
    aura.material = hide;

    setHovered(root, true);
    expect((body.metadata as { hovered?: boolean }).hovered).toBe(true);
    expect((aura.metadata as { hovered?: boolean } | null)?.hovered).toBeUndefined();
    setHovered(root, false);
    expect((body.metadata as { hovered?: boolean }).hovered).toBeUndefined();
  });
});

/**
 * PoE2's tell for an attack that must be dodged: the boss glows red through the
 * wind-up. It rides per-mesh metadata like the flash, so one Warden winding up
 * leaves another standing beside it dark.
 */
describe("danger glow through the rim plugin", () => {
  function fakeUbo(): { floats: Record<string, number>; ubo: UniformBuffer } {
    const floats: Record<string, number> = {};
    const ubo = {
      updateFloat: (name: string, v: number) => { floats[name] = v; },
      updateColor3: () => {},
    } as unknown as UniformBuffer;
    return { floats, ubo };
  }

  it("declares the dangerGlow uniform and applies it after tone mapping", () => {
    const material = new PBRMaterial("hide", scene());
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;
    expect(plugin.getUniforms().ubo!.map((u) => u.name)).toContain("dangerGlow");
    expect(plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("dangerGlow");
  });

  it("binds the winding-up mesh's glow and none for any other", () => {
    const s = scene();
    const material = new PBRMaterial("hide", s);
    addRim(material);
    const plugin = material.pluginManager!.getPlugin("ExiledRim")!;
    const sub = (metadata: unknown) => ({ getMesh: () => ({ metadata }) }) as unknown as SubMesh;

    const lit = fakeUbo();
    plugin.hardBindForSubMesh(lit.ubo, s, engine!, sub({ dangerGlow: 0.6 }));
    expect(lit.floats["dangerGlow"]).toBeCloseTo(0.6, 5);

    const plain = fakeUbo();
    plugin.hardBindForSubMesh(plain.ubo, s, engine!, sub({ hovered: true }));
    expect(plain.floats["dangerGlow"]).toBe(0);
  });

  it("setDangerGlow marks the body meshes only and clears again", () => {
    const s = scene();
    const root = new Mesh("actor", s);
    const body = new Mesh("body", s);
    body.parent = root;
    const hide = new PBRMaterial("hide", s);
    addRim(hide);
    body.material = hide;
    const blob = new Mesh("groundblob-actor", s);
    blob.parent = root;
    blob.material = hide;

    setDangerGlow(root, 0.8);
    expect((body.metadata as { dangerGlow?: number }).dangerGlow).toBeCloseTo(0.8, 5);
    expect((blob.metadata as { dangerGlow?: number } | null)?.dangerGlow).toBeUndefined();
    setDangerGlow(root, 0);
    expect((body.metadata as { dangerGlow?: number }).dangerGlow).toBeUndefined();
  });
});
