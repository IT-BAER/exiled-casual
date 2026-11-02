// Pack the served apps/web/public/models/props.glb in place: meshopt geometry, the JPEGs
// as built. `tools/build_props.py` runs this after its export; safe on a packed file.
//
// POSITION stays float32: quantizing it adds a dequantize transform per prop node that
// the hideout's placement code would have to know about. Normals, UVs and colours are
// the bytes worth taking: 5.86 MB -> 4.38 MB served, measured 3 Nov 2026.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { quantize, reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const FILE = `${root}apps/web/public/models/props.glb`;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const before = statSync(FILE).size;
const doc = await io.read(FILE);
const shape = (d) => {
  const r = d.getRoot();
  return { meshes: r.listMeshes().length, nodes: r.listNodes().length, materials: r.listMaterials().length, textures: r.listTextures().length };
};
const was = shape(doc);
await doc.transform(
  reorder({ encoder: MeshoptEncoder, target: "size" }),
  quantize({ pattern: /^(NORMAL|TEXCOORD_\d|COLOR_\d)$/, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }),
);
doc.createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const now = shape(doc);
if (JSON.stringify(was) !== JSON.stringify(now)) {
  throw new Error(`pack changed the asset's shape: ${JSON.stringify(was)} -> ${JSON.stringify(now)}`);
}
await io.write(FILE, doc);
console.log(`props.glb packed, ${before} -> ${statSync(FILE).size} bytes, ${JSON.stringify(now)}`);
