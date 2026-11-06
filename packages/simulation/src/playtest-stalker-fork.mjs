// One child of `runJobs()` (playtest-stalker.ts): plays one Stalker variant campaign per
// message until the parent disconnects. Plain Node with --experimental-transform-types.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
const { runVariant } = await import("./playtest-stalker.ts");

process.on("message", ({ id, variant, seed }) => {
  process.send({ id, result: runVariant(variant, seed) });
});
process.send({ ready: true });
