// One child of a forced-tier sweep: a prep job (natural campaign, saved) or a forced job
// (maps at one stone tier from a saved character), per message until the parent disconnects.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
const { preppedCharacter, forcedTierRuns } = await import("./playtest-tier-sweep.ts");

process.on("message", ({ id, job }) => {
  if (job.kind === "prep") process.send({ id, state: preppedCharacter(job.classId, job.seed, job.maps, job.opts) });
  else process.send({ id, runs: forcedTierRuns(job.state, job.simSeed, job.tier, job.maps, job.opts) });
});
process.send({ ready: true });
