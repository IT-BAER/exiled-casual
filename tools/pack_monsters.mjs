// Pack assets/monsters/monsters.glb (Blender's output) into the served
// apps/web/public/models/monsters.glb: meshopt geometry, the JPEG hides as built.
// Run after tools/build_monsters.py: `node tools/pack_monsters.mjs`.
//
// No WebP pass: it measured larger than the JPEG hides. POSITION stays float32,
// or quantizing splits each shared skin (see pack_wardrobe.mjs).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { quantize, reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = `${root}assets/monsters/monsters.glb`;
const OUT = `${root}apps/web/public/models/monsters.glb`;

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
console.log(`monsters.glb packed, ${statSync(SRC).size} -> ${statSync(OUT).size} bytes, ${JSON.stringify(after)}`);
