// Pack assets/characters/wardrobe{,-female}.glb (Blender's output, one body each)
// into the served apps/web/public/models/: WebP textures, meshopt geometry.
// Run after tools/build_wardrobe.py: `node tools/pack_wardrobe.mjs`.
//
// POSITION stays float32 on purpose. Quantizing it moves each mesh's scale into
// its node and inverse bind matrices, which splits the shared skin into one skin
// per mesh; the rig drives one skeleton per body.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { quantize, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const NAMES = ["wardrobe", "wardrobe-female"];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const shape = (d) => {
  const r = d.getRoot();
  return { skins: r.listSkins().length, meshes: r.listMeshes().length, nodes: r.listNodes().length };
};

for (const name of NAMES) {
  const SRC = `${root}assets/characters/${name}.glb`;
  const OUT = `${root}apps/web/public/models/${name}.glb`;
  const doc = await io.read(SRC);
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
  console.log(`${name}.glb packed, ${JSON.stringify(after)}`);
}
