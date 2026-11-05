import { fork } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import type { MapRun, BotOptions } from "./playtest";

/** `opts` crosses a process boundary, so only its plain fields (no `trace`). */
export interface CampaignJob { classId: string; seed: number; maps: number; level?: number; opts?: Omit<BotOptions, "trace"> }

/**
 * Each job's `campaign()`, played across child processes and returned in job order.
 *
 * Vitest gives a file one worker, so the level-10 sweep's 270 maps ran serially and held
 * the whole suite open for twelve minutes after every other file had finished. The sim
 * is deterministic, so splitting the jobs changes the wall time and nothing else;
 * playtest-parallel.test.ts holds a forked campaign to the in-process one.
 */
// One child per physical core (half the logical ones): hyperthreads add little to the bot,
// and the rest of the suite is running beside it.
export function campaigns(jobs: readonly CampaignJob[], procs = Math.max(1, availableParallelism() >> 1)): Promise<MapRun[][]> {
  const script = fileURLToPath(new URL("./playtest-fork.mjs", import.meta.url));
  const out: MapRun[][] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  return new Promise((resolve, reject) => {
    if (jobs.length === 0) return resolve(out);
    for (let p = 0; p < Math.min(procs, jobs.length); p++) {
      const child = fork(script, [], {
        execArgv: ["--experimental-transform-types", "--no-warnings"],
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      // A child asks for work by answering: its ready message, then each result.
      child.on("message", (m: { id?: number; runs?: MapRun[] }) => {
        if (m.runs) {
          out[m.id!] = m.runs;
          if (++done === jobs.length) resolve(out);
        }
        if (next < jobs.length) child.send({ id: next, ...jobs[next++] });
        else child.disconnect();
      });
      child.on("error", reject);
      child.on("exit", (code) => { if (code !== 0) reject(new Error(`playtest child exited with ${code}`)); });
    }
  });
}
