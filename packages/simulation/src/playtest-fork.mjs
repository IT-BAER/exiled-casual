// One child of `campaigns()` (playtest-parallel.ts): plays a campaign per message until
// the parent disconnects. Plain Node with --experimental-transform-types, not Vite.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
const { campaign } = await import("./playtest.ts");

process.on("message", ({ id, classId, seed, maps, level }) => {
  process.send({ id, runs: campaign(classId, seed, maps, {}, level ?? 1) });
});
process.send({ ready: true });
