/// <reference lib="webworker" />
import { WorkerCore } from "./worker-core";
import { isToWorker, validateIntent } from "@pact/protocol";
import type { FromWorker } from "@pact/protocol";

// ponytail: thin glue only — no logic lives here; all sim logic is in WorkerCore
const MS_PER_TICK = 1000 / 30;

let core: WorkerCore | null = null;

self.onmessage = (e: MessageEvent) => {
  const raw: unknown = e.data;
  // Structural guard at the trust boundary — postMessage payloads are untrusted.
  if (!isToWorker(raw)) return;
  const msg = raw;
  if (msg.type === "init") {
    core = new WorkerCore(msg.seed);
    const ready: FromWorker = { type: "ready" };
    self.postMessage(ready);
  } else if (msg.type === "intent" && core) {
    // isToWorker only checks intent is a non-null object — deep-validate its fields.
    core.pushIntent(validateIntent(msg.intent));
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
  for (const snapshot of snaps) {
    const msg: FromWorker = { type: "snapshot", snapshot };
    self.postMessage(msg);
  }
}, MS_PER_TICK);
