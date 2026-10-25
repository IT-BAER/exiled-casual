// Read PoE1's Celestial Cat rig out of a local PoE install into
// assets/pets/source/poe/ (gitignored): rig.ast (bones and clip table) and
// anim.bin (its keyframes, decompressed). build_pet.py retargets the clips.
//
//   npm i --no-save pathofexile-dat@16.0.1
//   node tools/extract_poe_pet.mjs "<Path of Exile>/Bundles2"
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileLoader, decompressSliceInBundle, decompressedBundleSize } from 'pathofexile-dat/bundles.js';

const RIG = 'art/models/pet/cat/rig.ast';
// The keyframes are a GGG bundle embedded in rig.ast at this byte.
const ANIM_AT = 2578;
const OUT = fileURLToPath(new URL('../assets/pets/source/poe/', import.meta.url));

const game = process.argv[2];
if (!game) throw new Error('usage: node tools/extract_poe_pet.mjs "<Path of Exile>/Bundles2"');
const loader = await FileLoader.create({ fetchFile: (n) => fs.readFile(path.join(game, n)) });
const rig = await loader.tryGetFileContents(RIG);
if (!rig) throw new Error(`${RIG} not in ${game}`);
const blob = new Uint8Array(rig.subarray(ANIM_AT));
const anim = new Uint8Array(decompressedBundleSize(blob));
decompressSliceInBundle(blob, 0, anim);
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'rig.ast'), rig);
await fs.writeFile(path.join(OUT, 'anim.bin'), anim);
console.log(`rig.ast ${rig.length} bytes, anim.bin ${anim.length} bytes -> ${OUT}`);
