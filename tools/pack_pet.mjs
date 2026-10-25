// Pack assets/pets/pet.glb (Blender's output) into the served
// apps/web/public/models/pet.glb: WebP textures, meshopt geometry.
// Run after tools/build_pet.py: `node tools/pack_pet.mjs`.
//
// POSITION stays float32 as in pack_wardrobe.mjs: quantizing it moves a scale
// into the node and inverse bind matrices and splits the one shared skin.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { quantize, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = `${root}assets/pets/pet.glb`;
const OUT = `${root}apps/web/public/models/pet.glb`;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const doc = await io.read(SRC);
const shape = (d) => {
  const r = d.getRoot();
  return {
    skins: r.listSkins().length,
    meshes: r.listMeshes().length,
    nodes: r.listNodes().length,
    animations: r.listAnimations().length,
  };
};
const before = shape(doc);

await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 88 }),
  reorder({ encoder: MeshoptEncoder, target: "size" }),
  quantize({ pattern: /^(NORMAL|WEIGHTS_\d)$/, quantizeNormal: 10, quantizeWeight: 8 }),
);
doc.createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

const after = shape(doc);
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error(`pack changed the asset's shape: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
}
await io.write(OUT, doc);
console.log(`pet.glb packed, ${statSync(SRC).size} -> ${statSync(OUT).size} bytes, ${JSON.stringify(after)}`);
