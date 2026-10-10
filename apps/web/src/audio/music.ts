/**
 * Area music: a pool of quiet takes per biome, every mood's takes in the hideout. A take
 * plays to its end and crossfades into another from the same pool, never itself.
 *
 * Not a voice in sfx.ts: the loading screen preloads every voice, and a 90 s track
 * decodes to ~35 MB. A track is fetched when it is due and dropped when the next one
 * fades in, so at most two are resident, and only during a crossfade.
 */
import { bus, send, type Bus } from "./bus";

/** Takes per slot in public/music: `<slot>-1..N.webm`. */
export const MUSIC_TAKES = 3;
export const HIDEOUT_MOODS = ["hideout-1", "hideout-2", "hideout-3"] as const;

/** One slot per biome, pinned against BIOMES by the test. */
export const MUSIC_BY_BIOME: Record<string, string> = {
  vaal_stone: "vaal_stone",
  desert: "desert",
  swamp: "swamp",
  forest: "forest",
  coast: "coast",
};

const takes = (slot: string) => Array.from({ length: MUSIC_TAKES }, (_, i) => `${slot}-${i + 1}`);

/** Every track an area (`biomeId` null is the hideout) can play. */
export function trackPool(biomeId: string | null): string[] {
  if (biomeId === null) return HIDEOUT_MOODS.flatMap(takes);
  const slot = MUSIC_BY_BIOME[biomeId];
  return slot ? takes(slot) : [];
}

/** A random track from the area's pool, never `last`. */
export function pickTrack(
  biomeId: string | null,
  last: string | null,
  rng: () => number = Math.random,
): string | null {
  const pool = trackPool(biomeId).filter((t) => t !== last);
  return pool[Math.floor(rng() * pool.length)] ?? pool[0] ?? null;
}

/** Peak gain on the music slider; the loop builder brings every track to -18 LUFS, so
 *  this is -38: about 10 dB under a skill cast, level with the beds. */
export const MUSIC_GAIN = 0.1;
/** Seconds. Linear ramps, so the new track is fully in exactly when it says. */
const FADE_IN = 3;
const FADE_OUT = 2;

/** The area playing: its biome id, null for the hideout, undefined for none. */
let area: string | null | undefined;
let wanted: string | null = null;
/** Per area, the track it played last, so a return visit starts on another. */
const lastByArea = new Map<string | null, string>();
let playing: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let rotation: ReturnType<typeof setTimeout> | null = null;

/** Called on every area change, beside `setAmbient`. The same area twice is a no-op. */
export function setMusic(biomeId: string | null): void {
  if (area === biomeId && wanted !== null) return;
  stopMusic();
  area = biomeId;
  play(pickTrack(biomeId, lastByArea.get(biomeId) ?? null), false);
}

/**
 * Fetch and start `track`. An area change fades the old track out at once; a rotation
 * keeps it until the new one starts, so the two crossfade with no gap.
 */
function play(track: string | null, crossfade: boolean): void {
  wanted = track;
  const b = bus();
  if (track === null || !b) return;
  lastByArea.set(area ?? null, track);
  const v = import.meta.env?.VITE_AUDIO_VERSION;
  void fetch(`/music/${track}.webm${v ? `?v=${v}` : ""}`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((bytes) => b.ctx.decodeAudioData(bytes))
    // A track that lands after the player has moved on is dropped, not started late.
    .then((buf) => {
      if (wanted !== track) return;
      if (crossfade) fadeOut(b);
      start(b, buf);
      const here = area;
      rotation = setTimeout(() => {
        rotation = null;
        if (wanted === track && area === here) play(pickTrack(here ?? null, track), true);
      }, Math.max(0, buf.duration - FADE_IN) * 1000);
    })
    .catch(() => {});
}

function start(b: Bus, buf: AudioBuffer): void {
  const now = b.ctx.currentTime;
  const gain = b.ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(MUSIC_GAIN, now + FADE_IN);
  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  // Loops if the next take never arrives, so a failed fetch is a repeat, not silence.
  src.loop = true;
  src.connect(gain);
  send(b, gain, 0, "music");
  src.start();
  playing = { src, gain };
}

function fadeOut(b: Bus | null): void {
  const live = playing;
  playing = null;
  if (!live) return;
  if (!b) { try { live.src.stop(); } catch { /* already stopped */ } return; }
  const now = b.ctx.currentTime;
  live.gain.gain.cancelScheduledValues(now);
  live.gain.gain.setValueAtTime(live.gain.gain.value, now);
  live.gain.gain.linearRampToValueAtTime(0, now + FADE_OUT);
  try { live.src.stop(now + FADE_OUT); } catch { /* already stopped */ }
}

/** Fade the current track out and stop rotating; it is released once stopped. */
export function stopMusic(): void {
  area = undefined;
  wanted = null;
  if (rotation !== null) clearTimeout(rotation);
  rotation = null;
  fadeOut(bus());
}
