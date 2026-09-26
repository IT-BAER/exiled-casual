// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { LoadAssetContainerAsync, Mesh, NullEngine, VertexBuffer } from "@babylonjs/core";
import { CURRENCY_DROPS, ITEM_POOLS, PORTAL_SCROLL_BASE_ID, WAYSTONE_BASE_ID } from "@exiled/content-runtime";
import { createScene } from "./engine";
import { GEAR_LOOKS } from "./gear-looks";
import { floorParts, groundLookFor } from "./ground-looks";

let engine: InstanceType<typeof NullEngine> | undefined;
afterEach(() => engine?.dispose());

describe("groundLookFor", () => {
  it("gives every gear base the model it is worn as", () => {
    for (const base of ITEM_POOLS.bases) {
      const gear = GEAR_LOOKS[base.id];
      if (gear) expect(groundLookFor(base.id), base.id).toEqual({ gear });
    }
  });

  it("gives every base that can drop a model to lie on the floor", () => {
    const droppable = new Set([
      ...ITEM_POOLS.bases.map((b) => b.id),
      ...CURRENCY_DROPS.map((c) => c.baseId),
      PORTAL_SCROLL_BASE_ID,
      WAYSTONE_BASE_ID,
    ]);
    for (const id of droppable) expect(groundLookFor(id), id).not.toBeNull();
  });

  it("lays a base under an id content has since renamed as the base it became", () => {
    for (const [old, now] of [
      ["base.ashen_focus", "base.ember_focus"],
      ["base.emberwand", "base.ember_wand"],
      ["base.wisdom_scroll", "currency.wisdom"],
    ] as const) {
      expect(groundLookFor(old), old).toEqual(groundLookFor(now));
      expect(groundLookFor(old), old).not.toBeNull();
    }
  });

  it("answers null for no base at all", () => {
    expect(groundLookFor(undefined)).toBeNull();
  });
});

/** Babylon reads a File through FileReader, which node does not ship. */
class NodeFileReader {
  result: unknown;
  onload?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  onerror?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then((r) => {
      this.result = r;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }, () => this.onerror?.({ target: this }));
  }
}

describe("floorParts against the real wardrobe", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

  it("lays every gear base on the floor as a static copy, leaving the worn parts skinned", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    engine = new NullEngine();
    const { scene } = createScene(engine);
    try {
      const file = new File([readFileSync(`${MODELS}wardrobe.glb`)], "wardrobe.glb", { type: "model/gltf-binary" });
      const wardrobe = await LoadAssetContainerAsync(file, scene);
      for (const [baseId, gear] of Object.entries(GEAR_LOOKS)) {
        const parts = floorParts(wardrobe, baseId, gear);
        expect(parts.length, baseId).toBeGreaterThan(0);
        let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of parts) {
          // No skeleton: a floor copy must never be skinned, or clothed by the cloth solver.
          expect(p.skeleton, p.name).toBeNull();
          expect(p.isVerticesDataPresent(VertexBuffer.MatricesIndicesKind), p.name).toBe(false);
          expect(p.name.startsWith("floor."), p.name).toBe(true);
          const b = p.getBoundingInfo().boundingBox;
          minY = Math.min(minY, b.minimum.y); maxY = Math.max(maxY, b.maximum.y);
          minX = Math.min(minX, b.minimum.x); maxX = Math.max(maxX, b.maximum.x);
          minZ = Math.min(minZ, b.minimum.z); maxZ = Math.max(maxZ, b.maximum.z);
        }
        // Resting on the floor, centred on the drop.
        expect(minY, baseId).toBeCloseTo(0, 4);
        expect((minX + maxX) / 2, baseId).toBeCloseTo(0, 4);
        expect((minZ + maxZ) / 2, baseId).toBeCloseTo(0, 4);
        // Nothing lies on the floor wider than a man is tall.
        expect(Math.max(maxX - minX, maxZ - minZ), baseId).toBeLessThan(1.8);
        if (gear.slot !== "helmet" && gear.slot !== "boots") {
          // Laid down on its flattest side.
          expect(maxY - minY, baseId).toBeLessThanOrEqual(Math.min(maxX - minX, maxZ - minZ) + 1e-4);
        }
      }
      // The copies own their geometry: the worn part is still skinned.
      const robe = wardrobe.meshes.find((m) => m.name === "chest.ember.robe") as Mesh;
      expect(robe.skeleton).not.toBeNull();
      expect(robe.isVerticesDataPresent(VertexBuffer.MatricesIndicesKind)).toBe(true);
      // Fillers under the cloth and the leg pieces are not the item.
      expect(floorParts(wardrobe, "base.ember_robe", GEAR_LOOKS["base.ember_robe"]!)
        .some((p) => /backing|gorget|greave/.test(p.name))).toBe(false);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 60_000);
});
