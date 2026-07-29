/// <reference lib="webworker" />
import { WorkerCore } from "./worker-core";
import { isToWorker, validateIntent } from "@exiled/protocol";
import type { FromWorker } from "@exiled/protocol";

// ponytail: thin glue only — no logic lives here; all sim logic is in WorkerCore
const MS_PER_TICK = 1000 / 30;

let core: WorkerCore | null = null;

self.onmessage = (e: MessageEvent) => {
  const raw: unknown = e.data;
  // Structural guard at the trust boundary — postMessage payloads are untrusted.
  if (!isToWorker(raw)) return;
  const msg = raw;
  if (msg.type === "init") {
    const c = new WorkerCore(msg.seed, undefined, msg.characterId);
    core = c;
    // Restore any saved run first, THEN send the (possibly restored) layout once
    // so the renderer builds floor + walls, then ready.
    void c.hydrate().then(() => {
      const area: FromWorker = { type: "area", area: c.getArea(), layout: c.getAreaLayout(), mapBaseId: c.getMapBaseId() };
      self.postMessage(area);
      const ready: FromWorker = { type: "ready" };
      self.postMessage(ready);
    });
  } else if (msg.type === "intent" && core) {
    // isToWorker only checks intent is a non-null object — deep-validate its fields.
    core.pushIntent(validateIntent(msg.intent));
  } else if (msg.type === "spawn" && core) {
    core.spawn(msg.what);
  } else if (msg.type === "reset") {
    // seed preserved across reset is not in the protocol — recreate with seed 42
    // (lab default). Full seed-carry requires a ToWorker_Reset extension in M3+.
    // ponytail: hard-coded lab seed; parameterise reset in M3 when needed
    core = new WorkerCore(42);
  }
};

// Drive the sim at MS_PER_TICK regardless of message rate.
setInterval(() => {
  if (!core) return;
  const snaps = core.advance(MS_PER_TICK);
  // A portal transition swaps the level; re-send `area` before the snapshots so
  // the renderer rebuilds (or clears) walls before drawing the new positions.
  if (core.consumeAreaChange()) {
    const area: FromWorker = { type: "area", area: core.getArea(), layout: core.getAreaLayout(), mapBaseId: core.getMapBaseId() };
    self.postMessage(area);
  }
  for (const snapshot of snaps) {
    const msg: FromWorker = { type: "snapshot", snapshot };
    self.postMessage(msg);
  }
}, MS_PER_TICK);
