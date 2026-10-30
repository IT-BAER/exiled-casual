// `window.__dev`, the release playtest's console handle: put the world into any
// state (level, gold, items, currency, waystones, any map) and hold it still for a
// screenshot. GameView installs it in a dev build only.
import type { DevOp, ToWorker } from "@exiled/protocol";

type GrantItem = Omit<Extract<DevOp, { op: "grantItem" }>, "op">;

export interface DevApiDeps {
  post(msg: ToWorker): void;
  stopLoop(): void;
  startLoop(): void;
  /** Draw one frame now and return it as a PNG, read in the same task it was drawn. */
  grab(): Promise<Blob>;
  send?(url: string, body: Blob): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export function createDevApi(d: DevApiDeps) {
  const waiters: ((dump: unknown) => void)[] = [];
  let frozen = false;
  const op = (o: DevOp) => d.post({ type: "dev", op: o });
  const send = d.send ?? ((url, body) => fetch(url, { method: "POST", body }));
  const api = {
    level: (level: number) => op({ op: "setLevel", level }),
    gold: (gold: number) => op({ op: "setGold", gold }),
    item: (spec: GrantItem) => op({ op: "grantItem", ...spec }),
    currency: (baseId: string, count = 1) => op({ op: "grantCurrency", baseId, count }),
    waystone: (tier: number, seed?: number) => op({ op: "grantWaystone", tier, ...(seed !== undefined ? { seed } : {}) }),
    atlas: () => op({ op: "openAtlas" }),
    teleport: (node: string, tier = 1, seed?: number) => op({
      op: "teleport", atlasNodeId: node.startsWith("node.") ? node : `node.${node}`, tier, ...(seed !== undefined ? { seed } : {}),
    }),
    hideout: () => op({ op: "toHideout" }),
    /** The area's boss ready to show `phase` (its life just under the line), the player 7 units off it. */
    boss: (phase: 1 | 2 | 3 = 1) => op({ op: "boss", phase }),
    dump: () => new Promise<unknown>((resolve) => { waiters.push(resolve); op({ op: "dump" }); }),
    /** Stops the sim clock and the render loop: the canvas keeps its last frame, nothing moves. */
    freeze: () => {
      if (frozen) return;
      frozen = true;
      d.post({ type: "pause", paused: true });
      d.stopLoop();
    },
    unfreeze: () => {
      if (!frozen) return;
      frozen = false;
      d.post({ type: "pause", paused: false });
      d.startLoop();
    },
    get frozen() { return frozen; },
    /** PNG of the canvas into docs/todo/playtest/<dir>/<name>.png; resolves to the written path. */
    capture: async (name: string, dir: "shots" | "baselines" = "shots") => {
      const res = await send(`/__capture?dir=${dir}&name=${encodeURIComponent(name)}`, await d.grab());
      if (!res.ok) throw new Error(`capture failed: HTTP ${res.status}`);
      return res.text();
    },
  };
  return { api, onDump: (dump: unknown) => { waiters.shift()?.(dump); } };
}
