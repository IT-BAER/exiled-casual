// One child of the Ironsworn balance sweep (playtest-coverage-ironsworn.test.ts): plays one
// job per message until the parent disconnects. Plain Node with --experimental-transform-types.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
const { campaignIron } = await import("./playtest-ironsworn.ts");
const { campaign } = await import("./playtest.ts");

process.on("message", ({ id, job }) => {
  const runs = job.harness
    ? campaign(job.classId, job.seed, job.maps, {}, job.level ?? 1)
    : campaignIron(job);
  process.send({ id, runs });
});
process.send({ ready: true });
