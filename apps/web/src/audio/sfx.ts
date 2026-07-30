import { bus, send } from "./bus";

/**
 * Sampled sound effects: skills, monsters, portals, flasks, footsteps and the UI.
 *
 * The masters are 48 kHz mono WAVs generated locally with MOSS-SoundEffect v2 (see
 * `.claude/skills/generate-game-audio`), cut down by `tools/trim_sfx.py`, and shipped
 * as Opus in WebM — 21 sounds in 360 KB. They share the bus with the synthesised drop
 * cue, so the Options volume covers everything and nothing fights it for a context.
 *
 * Every one of them is peak-normalised by the trimmer and opens on its own transient,
 * which is what makes the gain table below the ONLY thing setting level. The first
 * pass shipped without that step: ten cues were silent or near-silent, and the ones
 * that were not started up to a second late and were cut off. See trim_sfx.py.
 *
 * Every path here is silent-on-failure by design. A missing file, a browser with no
 * WebAudio, a jsdom test: all of them end with nothing playing and nothing thrown,
 * because a sound is feedback and feedback must never be able to break the game it
 * is describing.
 */

const DIR = "/audio";

/**
 * Per-sound mix. `gain` is where the level lives (the masters are normalised near
 * full scale, so most of them need pulling down), `wet` is how much room it gets,
 * and `vary` is how far the pitch is allowed to wander per play.
 *
 * Pitch variation is not decoration: a footstep, a claw and a bolt all fire many
 * times a second, and a sample replayed at exactly one rate is heard as a loop
 * rather than as an event. Anything that only fires once a minute (a portal, a
 * waystone) is left alone, because there is nothing to compare it against.
 */
interface Voice { gain: number; wet: number; vary: number }

const VOICES: Record<string, Voice> = {
  "skill-ember-bolt-cast":    { gain: 0.28, wet: 0.14, vary: 0.06 },
  "skill-ember-bolt-impact":  { gain: 0.34, wet: 0.18, vary: 0.08 },
  "skill-cinder-ground-cast": { gain: 0.32, wet: 0.22, vary: 0.04 },
  "skill-blink":              { gain: 0.30, wet: 0.12, vary: 0.05 },
  "monster-melee-hit":        { gain: 0.30, wet: 0.16, vary: 0.10 },
  "monster-hurt":             { gain: 0.22, wet: 0.12, vary: 0.12 },
  "monster-death":            { gain: 0.34, wet: 0.24, vary: 0.09 },
  "monster-spit":             { gain: 0.26, wet: 0.14, vary: 0.10 },
  "monster-slam-windup":      { gain: 0.30, wet: 0.20, vary: 0.03 },
  "monster-slam-impact":      { gain: 0.42, wet: 0.30, vary: 0.04 },
  "player-hurt":              { gain: 0.34, wet: 0.10, vary: 0.08 },
  "portal-open":              { gain: 0.34, wet: 0.34, vary: 0 },
  "portal-close":             { gain: 0.28, wet: 0.30, vary: 0 },
  "portal-enter":             { gain: 0.34, wet: 0.24, vary: 0 },
  "waystone-activate":        { gain: 0.36, wet: 0.28, vary: 0 },
  "flask-drink":              { gain: 0.30, wet: 0.08, vary: 0.05 },
  "footstep-dirt-a":          { gain: 0.13, wet: 0.06, vary: 0.09 },
  "footstep-dirt-b":          { gain: 0.13, wet: 0.06, vary: 0.09 },
  "ui-click":                 { gain: 0.26, wet: 0.05, vary: 0.03 },
  "ui-hover":                 { gain: 0.14, wet: 0.04, vary: 0.05 },
  "ui-panel-open":            { gain: 0.24, wet: 0.10, vary: 0.04 },
};

export type SfxName = keyof typeof VOICES & string;

/** Decoded buffers, and the in-flight fetches, keyed by name. */
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<void>>();
/** Names that failed once. Never retried: a 404 is not going to change. */
const dead = new Set<string>();

function load(name: string): Promise<void> {
  const already = loading.get(name);
  if (already) return already;
  const p = fetch(`${DIR}/${name}.webm`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((bytes) => {
      const b = bus();
      if (!b) return;
      // Promise form rather than the callback one: Safari only grew the promise
      // overload late, but every browser that can decode Opus has it.
      return b.ctx.decodeAudioData(bytes).then((buf) => { buffers.set(name, buf); });
    })
    .catch(() => { dead.add(name); })
    .finally(() => { loading.delete(name); });
  loading.set(name, p);
  return p;
}

/**
 * Fetch and decode ahead of time.
 *
 * Worth doing for anything whose first play is also the moment it matters: the
 * first ember bolt of a session would otherwise fire in silence while its sample
 * is still on the wire. Returns a promise only so a test can await it; nothing in
 * the game does.
 */
export function preloadSfx(names: readonly string[]): Promise<void> {
  if (!bus()) return Promise.resolve();
  return Promise.all(names.filter((n) => !buffers.has(n) && !dead.has(n)).map(load)).then(() => undefined);
}

/** Everything that has to be ready before the player's first click. */
export const CORE_SFX: readonly string[] = [
  "ui-click", "ui-hover", "ui-panel-open",
  "skill-ember-bolt-cast", "skill-ember-bolt-impact", "skill-cinder-ground-cast", "skill-blink",
  "monster-melee-hit", "monster-hurt", "monster-death", "player-hurt",
  "footstep-dirt-a", "footstep-dirt-b", "flask-drink",
];

/**
 * Play one sound. First call for a name starts the fetch and returns silently, so
 * an unpreloaded sound costs its first occurrence and nothing after it.
 *
 * `volume` scales the voice's own gain, which is how a distant monster is quieter
 * than one at the player's feet without a spatial graph nobody asked for.
 */
export function playSfx(name: string, volume = 1): void {
  const voice = VOICES[name];
  if (!voice || dead.has(name)) return;
  const b = bus();
  if (!b) return;
  const buf = buffers.get(name);
  if (!buf) { void load(name); return; }

  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  if (voice.vary > 0) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * voice.vary;
  const g = b.ctx.createGain();
  g.gain.value = voice.gain * Math.max(0, Math.min(1, volume));
  src.connect(g);
  send(b, g, voice.wet);
  src.start();
}

/**
 * How loud something at `distance` world units from the player should be.
 *
 * Linear rolloff to a floor rather than inverse-square: the camera only shows
 * about 19 units across, so everything audible is close, and true attenuation over
 * that range is inaudible at one end and a cliff at the other. Past the frame it is
 * silent, which is also what stops a map's worth of monsters mixing into mud.
 */
export function distanceGain(distance: number): number {
  const AUDIBLE = 14;
  if (distance >= AUDIBLE) return 0;
  return 1 - (distance / AUDIBLE) * 0.8;
}

/** Test seam: forget every decoded buffer and failure. */
export function resetSfx(): void {
  buffers.clear();
  loading.clear();
  dead.clear();
}
