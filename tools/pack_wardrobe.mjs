// Pack assets/characters/wardrobe.glb (Blender's output) into the served
// apps/web/public/models/wardrobe.glb: WebP textures, meshopt geometry.
// Run after tools/build_wardrobe.py: `node tools/pack_wardrobe.mjs`.
//
// POSITION stays float32 on purpose. Quantizing it moves each mesh's scale into
// its node and inverse bind matrices, which splits the two shared skins into one
// skin per mesh; the rig drives one skeleton per body.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { quantize, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = `${root}assets/characters/wardrobe.glb`;
const OUT = `${root}apps/web/public/models/wardrobe.glb`;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const doc = await io.read(SRC);
const shape = (d) => {
  const r = d.getRoot();
  return { skins: r.listSkins().length, meshes: r.listMeshes().length, nodes: r.listNodes().length };
};
const before = shape(doc);

await doc.transform(
  // Lossy WebP blocks a normal map into faceted shading; near-lossless does not.
  textureCompress({ encoder: sharp, targetFormat: "webp", slots: /normalTexture/, nearLossless: true }),
  textureCompress({ encoder: sharp, targetFormat: "webp", slots: /^(?!normalTexture).*/, quality: 90 }),
  reorder({ encoder: MeshoptEncoder, target: "size" }),
  quantize({ pattern: /^(NORMAL|WEIGHTS_\d|COLOR_\d)$/, quantizeNormal: 10, quantizeWeight: 8, quantizeColor: 8 }),
);
doc.createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

const after = shape(doc);
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error(`pack changed the asset's shape: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
}
await io.write(OUT, doc);
console.log(`wardrobe.glb packed, ${JSON.stringify(after)}`);
