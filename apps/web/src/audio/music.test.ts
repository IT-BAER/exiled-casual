import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BIOMES } from "@exiled/content-runtime";
import { DEATH_MUSIC, HIDEOUT_MOODS, MENU_MUSIC, MUSIC_BY_BIOME, MUSIC_TAKES, pickTrack, trackPool } from "./music";

/** `fake.ctx` is null until a test installs a stand-in context, as in headless jsdom. */
const fake = vi.hoisted(() => ({ ctx: null as unknown, categories: [] as unknown[] }));
vi.mock("./bus", async (orig) => ({
  ...(await orig<typeof import("./bus")>()),
  bus: () => (fake.ctx ? { ctx: fake.ctx } : null),
  send: (_b: unknown, _node: unknown, _wet: number, category: unknown) => {
    fake.categories.push(category);
    return { gain: { value: 0 } };
  },
}));

describe("trackPool", () => {
  it("gives every biome its own pool of takes, shared with no other biome", () => {
    const all = new Set<string>();
    for (const biome of Object.keys(BIOMES)) {
      const pool = trackPool(biome);
      expect(pool, biome).toEqual(
        Array.from({ length: MUSIC_TAKES }, (_, i) => `${MUSIC_BY_BIOME[biome]}-${i + 1}`));
      for (const t of pool) all.add(t);
    }
    expect(all.size).toBe(Object.keys(BIOMES).length * MUSIC_TAKES);
  });

  it("gives the hideout every take of every mood", () => {
    expect(trackPool(null)).toHaveLength(HIDEOUT_MOODS.length * MUSIC_TAKES);
    expect(trackPool(null)).toContain("hideout-2-3");
  });

  it("gives the menus their own takes, shared with no area", () => {
    expect(trackPool(MENU_MUSIC)).toEqual(["menu-1", "menu-2", "menu-3"]);
    const areas = [null, ...Object.keys(BIOMES)].flatMap(trackPool);
    for (const t of trackPool(MENU_MUSIC)) expect(areas).not.toContain(t);
  });

  it("gives the death screen its own takes, shared with no area", () => {
    expect(trackPool(DEATH_MUSIC)).toEqual(["death-1", "death-2", "death-3"]);
    const areas = [null, MENU_MUSIC, ...Object.keys(BIOMES)].flatMap(trackPool);
    for (const t of trackPool(DEATH_MUSIC)) expect(areas).not.toContain(t);
  });

  it("is empty for a biome it has no music for", () => {
    expect(trackPool("no_such_biome")).toEqual([]);
    expect(pickTrack("no_such_biome", null)).toBeNull();
  });
});

describe("pickTrack", () => {
  it("draws from the whole pool, but never the track that just played", () => {
    const rolls = Array.from({ length: 40 }, (_, i) => i / 40);
    for (const area of ["forest", null]) {
      const pool = trackPool(area);
      expect(new Set(rolls.map((r) => pickTrack(area, null, () => r)))).toEqual(new Set(pool));
      for (const last of pool) {
        const seen = new Set(rolls.map((r) => pickTrack(area, last, () => r)));
        expect(seen.has(last)).toBe(false);
        expect(seen.size).toBe(pool.length - 1);
      }
    }
  });
});

interface Ramp { to: number; at: number }
interface Source { url: string; loop: boolean; started: boolean; stopAt: number | null; ramps: Ramp[] }

describe("setMusic", () => {
  let music: typeof import("./music");
  let fetched: string[];
  let sources: Source[];

  function install(): void {
    fetched = []; sources = []; fake.categories.length = 0;
    vi.stubGlobal("fetch", (url: string) => {
      fetched.push(url);
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(url) });
    });
    let pending: Ramp[] = [];
    fake.ctx = {
      currentTime: 10,
      decodeAudioData: (url: string) => Promise.resolve({ url, duration: 90 }),
      createGain: () => {
        const ramps: Ramp[] = [];
        pending = ramps;
        return {
          gain: {
            value: 1,
            setValueAtTime: () => {},
            cancelScheduledValues: () => {},
            linearRampToValueAtTime: (to: number, at: number) => { ramps.push({ to, at }); },
          },
          connect: () => {},
        };
      },
      createBufferSource: () => {
        const s = {
          url: "", loop: false, started: false, stopAt: null as number | null, ramps: [] as Ramp[],
          set buffer(b: { url: string }) { this.url = b.url; },
          connect() { s.ramps = pending; },
          start() { s.started = true; },
          stop(at: number) { s.stopAt = at; },
        };
        sources.push(s);
        return s;
      },
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const track = (url: string) => /\/music\/([\w-]+)\.webm/.exec(url)?.[1];
  /** The pool a fetched track belongs to: `forest-2` -> `forest`, `hideout-1-3` -> `hideout`. */
  const area = (url: string) => track(url)?.replace(/(-\d)+$/, "");

  beforeEach(async () => {
    vi.resetModules();
    music = await import("./music");
    install();
  });
  afterEach(() => { vi.useRealTimers(); fake.ctx = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("fetches only the track the area needs and fades it in over 3 s, looping, on the music slider", async () => {
    music.setMusic("forest");
    await flush();
    expect(fetched.map(area)).toEqual(["forest"]);
    expect(sources).toHaveLength(1);
    const s = sources[0]!;
    expect(s).toMatchObject({ loop: true, started: true, stopAt: null });
    expect(s.ramps.at(-1)).toEqual({ to: music.MUSIC_GAIN, at: 13 });
    expect(fake.categories).toEqual(["music"]);
  });

  it("fades the old track out over 2 s and stops it when the area changes", async () => {
    music.setMusic("forest");
    await flush();
    music.setMusic("desert");
    await flush();
    const [forest, desert] = sources;
    expect(forest!.ramps.at(-1)).toEqual({ to: 0, at: 12 });
    expect(forest!.stopAt).toBe(12);
    expect(desert!.url).toContain("desert");
    expect(desert!.started).toBe(true);
  });

  it("never starts a track that arrives after the area changed again", async () => {
    music.setMusic("forest");
    music.setMusic("desert");
    await flush();
    expect(sources.map((s) => area(s.url))).toEqual(["desert"]);
  });

  it("does nothing when told the same area twice", async () => {
    music.setMusic(null);
    await flush();
    music.setMusic(null);
    await flush();
    expect(fetched).toHaveLength(1);
    expect(sources[0]!.stopAt).toBeNull();
  });

  it("never replays the last hideout track on the next visit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    music.setMusic(null);
    await flush();
    music.setMusic("coast");
    await flush();
    music.setMusic(null);
    await flush();
    const [first, , second] = fetched.map(track);
    expect(trackPool(null)).toContain(first);
    expect(trackPool(null)).toContain(second);
    expect(second).not.toBe(first);
  });

  it("keeps no cache: an area entered again downloads its track again", async () => {
    for (const b of ["forest", "desert", "forest"]) { music.setMusic(b); await flush(); }
    expect(fetched.map(area)).toEqual(["forest", "desert", "forest"]);
  });

  it("versions the URL with the audio hash, like every sound", async () => {
    vi.stubEnv("VITE_AUDIO_VERSION", "abc123");
    vi.spyOn(Math, "random").mockReturnValue(0);
    music.setMusic("swamp");
    await flush();
    expect(fetched[0]).toBe("/music/swamp-1.webm?v=abc123");
    vi.unstubAllEnvs();
  });

  it("fades out on stopMusic, and stays silent for a biome without a track", async () => {
    music.setMusic("forest");
    await flush();
    music.stopMusic();
    expect(sources[0]!.stopAt).toBe(12);
    music.setMusic("no_such_biome");
    await flush();
    expect(fetched).toHaveLength(1);
  });

  it("crossfades into another take of the same area when a track reaches its end", async () => {
    vi.useFakeTimers();
    music.setMusic("forest");
    await vi.advanceTimersByTimeAsync(0);
    expect(sources).toHaveLength(1);
    // 90 s track: the next one is fully in exactly when the first would loop.
    await vi.advanceTimersByTimeAsync((90 - 3) * 1000 - 1);
    expect(sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const [first, next] = sources;
    expect(area(next!.url)).toBe("forest");
    expect(track(next!.url)).not.toBe(track(first!.url));
    expect(next!.started).toBe(true);
    expect(first!.ramps.at(-1)).toEqual({ to: 0, at: 12 });
    expect(first!.stopAt).toBe(12);
  });

  it("stops rotating once the music is stopped or the area changes", async () => {
    vi.useFakeTimers();
    music.setMusic("forest");
    await vi.advanceTimersByTimeAsync(0);
    music.stopMusic();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(fetched).toHaveLength(1);
    music.setMusic("forest");
    await vi.advanceTimersByTimeAsync(0);
    music.setMusic("desert");
    await vi.advanceTimersByTimeAsync(87_000);
    expect(fetched.map(area)).toEqual(["forest", "forest", "desert", "desert"]);
  });

  it("crossfades from the area take to a death take on death, and back on a same-area revive", async () => {
    music.setMusic("forest");
    await flush();
    music.setMusicDead(true);
    await flush();
    expect(fetched.map(area)).toEqual(["forest", "death"]);
    const [forest, death] = sources;
    expect(forest!.stopAt).toBe(12);
    expect(death).toMatchObject({ loop: true, started: true, stopAt: null });
    expect(death!.ramps.at(-1)).toEqual({ to: music.MUSIC_GAIN, at: 13 });
    music.setMusicDead(true);
    music.setMusic("forest");
    await flush();
    expect(fetched).toHaveLength(2);
    music.setMusicDead(false);
    await flush();
    expect(fetched.map(area)).toEqual(["forest", "death", "forest"]);
    expect(track(fetched[2]!)).not.toBe(track(fetched[0]!));
    expect(death!.stopAt).toBe(12);
    expect(sources[2]!.started).toBe(true);
  });

  it("keeps the death music while dead through an area change, and plays the new area on revive", async () => {
    music.setMusic("forest");
    await flush();
    music.setMusicDead(true);
    await flush();
    music.setMusic("desert");
    await flush();
    expect(fetched.map(area)).toEqual(["forest", "death"]);
    music.setMusicDead(false);
    await flush();
    expect(fetched.map(area)).toEqual(["forest", "death", "desert"]);
  });

  it("plays death music when the area is entered or loaded already dead", async () => {
    music.setMusicDead(true);
    music.setMusic("forest");
    await flush();
    expect(fetched.map(area)).toEqual(["death"]);
  });

  it("chains death takes without repeating one", async () => {
    vi.useFakeTimers();
    music.setMusic("forest");
    await vi.advanceTimersByTimeAsync(0);
    music.setMusicDead(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(87_000);
    await vi.advanceTimersByTimeAsync(87_000);
    const deaths = fetched.map(track).filter((t) => t?.startsWith("death"));
    expect(deaths).toHaveLength(3);
    expect(deaths[1]).not.toBe(deaths[0]);
    expect(deaths[2]).not.toBe(deaths[1]);
  });

  it("keeps the area music playing when the death takes are missing", async () => {
    vi.stubGlobal("fetch", (url: string) => {
      fetched.push(url);
      return Promise.resolve(url.includes("death")
        ? { ok: false, status: 404, arrayBuffer: () => Promise.resolve("") }
        : { ok: true, status: 200, arrayBuffer: () => Promise.resolve(url) });
    });
    music.setMusic("forest");
    await flush();
    expect(() => music.setMusicDead(true)).not.toThrow();
    await flush();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.stopAt).toBeNull();
  });

  it("is silent and fetches nothing without WebAudio", async () => {
    fake.ctx = null;
    expect(() => music.setMusic("forest")).not.toThrow();
    await flush();
    expect(fetched).toEqual([]);
  });
});
