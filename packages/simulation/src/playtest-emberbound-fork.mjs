// One child of the Emberbound coverage pool (playtest-coverage-emberbound.test.ts): runs a
// job or a bench batch per message until the parent disconnects. Plain Node with
// --experimental-transform-types, not Vite, like playtest-fork.mjs.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
const { runJob, benchSkill } = await import("./playtest-emberbound.ts");

process.on("message", ({ id, job, bench }) => {
  const out = bench ? bench.map((b) => benchSkill(...b)) : runJob(job);
  process.send({ id, out });
});
process.send({ ready: true });
