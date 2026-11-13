import { fork, type ChildProcess } from "node:child_process";
import { availableParallelism, constants, setPriority } from "node:os";
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

export interface TierSweepJob { classId: string; seed: number }

/**
 * Forced-stone maps for each job (playtest-tier-sweep.ts): a natural campaign of
 * `prepMaps` maps, then `maps` maps at each of `tiers` from that same saved
 * character, sim seed `seed * 1000 + tier`. Returned per job, per tier.
 *
 * The children live for the whole sweep (an hour at 3 of them) and run below normal
 * priority, so the machine stays usable; they load the sources once, at the start.
 */
export function tierSweep(
  jobs: readonly TierSweepJob[], tiers: readonly number[], maps: number, prepMaps: number,
  opts: CampaignJob["opts"] = {}, procs = Math.max(1, availableParallelism() >> 1),
): Promise<Record<number, MapRun[]>[]> {
  const script = fileURLToPath(new URL("./playtest-tier-sweep-fork.mjs", import.meta.url));
  const out: Record<number, MapRun[]>[] = jobs.map(() => ({}));
  type Work = { kind: "prep"; at: number } | { kind: "forced"; at: number; tier: number; state: unknown };
  const queue: Work[] = jobs.map((_, at) => ({ kind: "prep", at }));
  let pending = queue.length + jobs.length * tiers.length;
  const kids: ChildProcess[] = [];
  return new Promise((resolve, reject) => {
    const next = (child: ChildProcess) => {
      const w = queue.shift();
      if (!w) return;
      const j = jobs[w.at]!;
      const job = w.kind === "prep"
        ? { kind: "prep", classId: j.classId, seed: j.seed, maps: prepMaps, opts }
        : { kind: "forced", state: w.state, simSeed: j.seed * 1000 + w.tier, tier: w.tier, maps, opts };
      busy.set(child, w);
      child.send({ id: w.at, job });
    };
    const busy = new Map<ChildProcess, Work>();
    const idle: ChildProcess[] = [];
    const done = () => {
      if (--pending > 0) return;
      for (const k of kids) k.disconnect();
      resolve(out);
    };
    for (let p = 0; p < Math.min(procs, jobs.length); p++) {
      const child = fork(script, [], {
        execArgv: ["--experimental-transform-types", "--no-warnings"],
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      kids.push(child);
      try { setPriority(child.pid!, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not ours to lower */ }
      child.on("message", (m: { ready?: boolean; state?: unknown; runs?: MapRun[] }) => {
        const w = busy.get(child);
        busy.delete(child);
        if (w?.kind === "prep") {
          for (const tier of tiers) queue.push({ kind: "forced", at: w.at, tier, state: m.state });
          // A prep job's tiers can start at once on any child that was left waiting.
          while (idle.length > 0 && queue.length > 0) next(idle.pop()!);
          done();
        } else if (w?.kind === "forced") {
          out[w.at]![w.tier] = m.runs!;
          done();
        }
        if (queue.length > 0) next(child);
        else if (pending > 0) idle.push(child);
      });
      child.on("error", reject);
      child.on("exit", (code) => { if (code !== 0 && pending > 0) reject(new Error(`tier sweep child exited with ${code}`)); });
    }
  });
}
