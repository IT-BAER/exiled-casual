// `window.__dev`, the release playtest's console handle: put the world into any
// state (level, gold, items, currency, waystones, any map) and hold it still for a
// screenshot. GameView installs it in a dev build only.
import type { DevOp, Snapshot, SpawnKind, ToWorker } from "@exiled/protocol";
import { fp } from "@exiled/fixed-point";

/** How far out the dummy arc's middle stands (`dummySpots`: rows at 5 and 7 units). */
const DUMMY_ARC_CENTRE = 6;
/** What `record` writes: the frame width and JPEG quality. */
const RECORD_WIDTH = 960;
const RECORD_QUALITY = 0.8;

type GrantItem = Omit<Extract<DevOp, { op: "grantItem" }>, "op">;

export interface DevApiDeps {
  post(msg: ToWorker): void;
  stopLoop(): void;
  startLoop(): void;
  /** Draw one frame now and return it as a PNG, read in the same task it was drawn. */
  grab(): Promise<Blob>;
  send?(url: string, body: Blob): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** The newest snapshot, for aiming a cast where the dummies stand. */
  snapshot?(): Snapshot | null;
  /** The next `n` drawn frames as JPEGs (`frame-recorder.ts`); `onFirst` runs before the first. */
  frames?(n: number, width: number, quality: number, onFirst: () => void): Promise<Blob[]>;
}

export interface RecordOptions {
  width?: number;
  quality?: number;
  /** Cast this as the recording starts; x/y default to the dummy arc's middle. */
  cast?: { skillId: string; x?: number; y?: number };
  /** First file number, for a recording continued in parts. */
  start?: number;
}

export function createDevApi(d: DevApiDeps) {
  const waiters: ((dump: unknown) => void)[] = [];
  let frozen = false;
  const op = (o: DevOp) => d.post({ type: "dev", op: o });
  const send = d.send ?? ((url, body) => fetch(url, { method: "POST", body }));
  /** World units in front of him, the way `dummySpots` faces (+y before he has faced anywhere). */
  const arcCentre = (): { x: number; y: number } => {
    const p = d.snapshot?.()?.player;
    const h = p?.heading && (p.heading.x !== 0 || p.heading.y !== 0) ? p.heading : { x: 0, y: 1 };
    return { x: (p?.x ?? 0) + h.x * DUMMY_ARC_CENTRE, y: (p?.y ?? 0) + h.y * DUMMY_ARC_CENTRE };
  };
  const cast = (skillId: string, x?: number, y?: number) => {
    const at = x !== undefined && y !== undefined ? { x, y } : arcCentre();
    d.post({ type: "intent", intent: { kind: "useSkill", skillId, tx: fp(at.x), ty: fp(at.y) } });
  };
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
    /** Inert 10x-life imps in a two-row arc in front of him (default 7, at most 40). */
    dummies: (n = 7) => d.post({ type: "spawn", what: "dummy", count: n }),
    /** Any lab spawn (imp, pack, magic, rare, boss, dummy, clear...), as the F4 menu sends it; `count` is read by `dummy`. */
    spawn: (what: SpawnKind, count?: number) => d.post({ type: "spawn", what, ...(count !== undefined ? { count } : {}) }),
    /** Every monster gone (the lab's Numpad0, which a headless page cannot press). */
    clear: () => d.post({ type: "spawn", what: "clear" }),
    /** Cast a skill at world (x, y), default the dummy arc's middle; the sim's own rules apply. */
    cast,
    /** Every cooldown ready, life and mana full (mana up to what auras leave free). */
    refill: () => op({ op: "refill" }),
    /** Back at the lab start facing +y: monsters cleared, seven fresh dummies, refilled. */
    home: () => op({ op: "home" }),
    /** The same op: the sim's refill readies every cooldown too. */
    cooldowns: () => op({ op: "refill" }),
    /**
     * `frames` consecutive drawn frames into review/skills/<label>/<NNN>.jpg, 960 px wide
     * at q0.8; resolves with how many were written.
     */
    record: async (frames: number, label: string, opts: RecordOptions = {}): Promise<number> => {
      if (!d.frames) throw new Error("record: no frame source in this build");
      const onFirst = () => { if (opts.cast) cast(opts.cast.skillId, opts.cast.x, opts.cast.y); };
      const blobs = await d.frames(frames, opts.width ?? RECORD_WIDTH, opts.quality ?? RECORD_QUALITY, onFirst);
      let written = 0;
      for (const [i, blob] of blobs.entries()) {
        const name = String((opts.start ?? 0) + i).padStart(3, "0");
        const res = await send(`/__capture?dir=skills&label=${encodeURIComponent(label)}&name=${name}`, blob);
        if (!res.ok) throw new Error(`record failed at frame ${name}: HTTP ${res.status}`);
        written++;
      }
      return written;
    },
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
