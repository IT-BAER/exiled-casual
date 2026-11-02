// Pack assets/characters/anim-library.glb (the master the Blender clip tools read and
// write) into the served apps/web/public/models/anim-library.glb: meshopt, lossless, no
// quantizing, since rig.ts re-expresses the pelvis curve and the keys must arrive exact.
// Run after any tool that writes the master; rig.test.ts fails while the two disagree.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = `${root}assets/characters/anim-library.glb`;
const OUT = `${root}apps/web/public/models/anim-library.glb`;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const doc = await io.read(SRC);
const clips = doc.getRoot().listAnimations().length;
doc.createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(OUT, doc);
console.log(`anim-library.glb packed, ${statSync(SRC).size} -> ${statSync(OUT).size} bytes, ${clips} clips`);
