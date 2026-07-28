import { describe, it, expect } from "vitest";
import { createStream } from "./rng";
import { AREA_TILES, UNREACHED, generateSkeleton, type Skeleton } from "./skeleton";
import { DIR_VEC } from "./chunks";

function build(seed: number, branches = 3): Skeleton | null {
  return generateSkeleton(createStream(seed, "test.skeleton"), branches);
}

/** Tiles covered by the 2x2 boss block. */
function bossTiles(s: Skeleton): number[] {
  const out: number[] = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) out.push((s.bossTile.ty + dy) * AREA_TILES + (s.bossTile.tx + dx));
  }
  return out;
}

describe("generateSkeleton", () => {
  it("succeeds for the overwhelming majority of seeds", () => {
    let ok = 0;
    for (let seed = 0; seed < 200; seed++) if (build(seed)) ok++;
    expect(ok).toBeGreaterThan(190);
  });

  it("is deterministic for a given stream", () => {
    const a = build(42)!, b = build(42)!;
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    expect(a.startTile).toEqual(b.startTile);
    expect(a.bossTile).toEqual(b.bossTile);
    expect(a.bossPort).toEqual(b.bossPort);
  });

  it("produces masks that agree across every shared edge", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = build(seed);
      if (!s) continue;
      const boss = bossTiles(s);
      for (let ty = 0; ty < AREA_TILES; ty++) {
        for (let tx = 0; tx < AREA_TILES; tx++) {
          const m = s.masks[ty * AREA_TILES + tx]!;
          for (let d = 0; d < 4; d++) {
            if (!(m & (1 << d))) continue;
            const nx = tx + DIR_VEC[d]![0], ny = ty + DIR_VEC[d]![1];
            expect(nx >= 0 && ny >= 0 && nx < AREA_TILES && ny < AREA_TILES,
              `seed ${seed}: tile ${tx},${ty} opens off-grid on side ${d}`).toBe(true);
            const back = (d + 2) % 4;
            const nm = s.masks[ny * AREA_TILES + nx]!;
            if (!boss.includes(ny * AREA_TILES + nx)) {
              expect(nm & (1 << back),
                `seed ${seed}: ${tx},${ty} opens to ${nx},${ny} but not back`).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it("leaves the reserved boss block without masks of its own", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = build(seed);
      if (!s) continue;
      // The boss block's own tiles carry no mask: the 2x2 chunk covers them.
      for (const i of bossTiles(s)) expect(s.masks[i]).toBe(0);
    }
  });

  it("puts the start on the outermost ring the loop reaches", () => {
    // Spurs (exactly one open edge) can poke further out than the loop; the
    // start is a loop tile, so measure against tiles with two or more edges.
    const rim = (t: { tx: number; ty: number }) => Math.max(Math.abs(t.tx - 3), Math.abs(t.ty - 3));
    for (let seed = 0; seed < 50; seed++) {
      const s = build(seed);
      if (!s) continue;
      let best = 0;
      for (let ty = 0; ty < AREA_TILES; ty++) {
        for (let tx = 0; tx < AREA_TILES; tx++) {
          const m = s.masks[ty * AREA_TILES + tx]!;
          const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
          if (bits >= 2) best = Math.max(best, rim({ tx, ty }));
        }
      }
      expect(rim(s.startTile), `seed ${seed}`).toBe(best);
    }
  });

  it("reaches every routed tile from the start", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = build(seed);
      if (!s) continue;
      for (let i = 0; i < s.masks.length; i++) {
        if (s.masks[i] === 0) continue;
        expect(s.routeDist[i], `seed ${seed}: tile ${i} is stranded`).not.toBe(UNREACHED);
      }
    }
  });

  it("hangs the requested number of dead-end spurs off the loop", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = build(seed, 3);
      if (!s) continue;
      let caps = 0;
      for (const m of s.masks) {
        const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
        if (bits === 1) caps++;
      }
      // Each spur is a cap. The boss never hangs off a spur, so caps count
      // the spurs exactly.
      expect(caps, `seed ${seed}`).toBe(3);
    }
  });

  it("places the boss farther by route than the start", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = build(seed);
      if (!s) continue;
      const bossDist = s.routeDist[s.bossTile.ty * AREA_TILES + s.bossTile.tx];
      expect(bossDist, `seed ${seed}`).toBeGreaterThan(2);
    }
  });
});
