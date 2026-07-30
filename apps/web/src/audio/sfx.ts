import { bus, send, type Bus } from "./bus";

/**
 * Sampled sound effects: skills, monsters, portals, flasks, footsteps and the UI.
 *
 * Every master is a commercial library recording, curated rather than generated:
 * `tools/import_sfx.py` names the source file per cue and runs it through
 * `tools/trim_sfx.py` to Opus in WebM — 43 sounds in 490 KB. They share the bus with
 * the synthesised drop cue, so the Options volume covers everything and nothing
 * fights it for a context.
 *
 * Nothing here is model-rendered any more. The first two passes were, and generation
 * is what made everything sound like the same soft object: a stone construct and a bog
 * thing died the same way, and no prompt separated them. The library also fixes the
 * level problem outright — a 24-bit recording peaking 23 dB down still has 70+ dB
 * under it, so bringing it to the loudness target lifts nothing audible with it.
 *
 * Every one of them is loudness-matched by the trimmer and opens on its own transient,
 * which is what makes the gain table below the ONLY thing setting level.
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
  // The two sustained voices (`startSfxLoop`). These numbers are MEASURED against
  // the one-shot they play under, not guessed: the masters are levelled apart (a
  // bed is normalised to -23 LUFS, an event by the trimmer to far louder), so equal
  // gains are not equal loudness. At 0.11 the flight bed landed 18.3 dB under the
  // cast, which is inaudible beside it — the cast ended at 0.90s, the bolt flew for
  // 1.7s, and what that sounds like is the sound stopping mid-flight. About 7 dB
  // under the cast is a bed you hear without it competing. `vary` is per voice and
  // set once, so two bolts in the air are not one doubled bolt.
  "skill-ember-bolt-flight":  { gain: 0.40, wet: 0.10, vary: 0.05 },
  // Higher still: the burning ground IS the skill for its whole duration, so its
  // bed is the event and the cast is only the whoomp that opens it. Held down by
  // the master's peaks, which are cracks rather than body.
  "skill-cinder-ground-loop": { gain: 0.45, wet: 0.24, vary: 0.03 },
  "skill-blink":              { gain: 0.30, wet: 0.12, vary: 0.05 },
  "monster-melee-hit":        { gain: 0.17, wet: 0.16, vary: 0.10 },
  // The generic pair is the fallback for a species with no material (soundscape.ts),
  // never the cue a known monster gets. The six below are the ones actually heard.
  "monster-hurt":             { gain: 0.13, wet: 0.12, vary: 0.12 },
  "monster-death":            { gain: 0.34, wet: 0.24, vary: 0.09 },
  "monster-hurt-stone":       { gain: 0.13, wet: 0.14, vary: 0.12 },
  "monster-death-stone":      { gain: 0.34, wet: 0.26, vary: 0.09 },
  "monster-hurt-husk":        { gain: 0.13, wet: 0.10, vary: 0.12 },
  "monster-death-husk":       { gain: 0.34, wet: 0.18, vary: 0.09 },
  "monster-hurt-bog":         { gain: 0.13, wet: 0.14, vary: 0.12 },
  "monster-death-bog":        { gain: 0.34, wet: 0.24, vary: 0.09 },
  "monster-hurt-beast":       { gain: 0.13, wet: 0.12, vary: 0.12 },
  "monster-death-beast":      { gain: 0.34, wet: 0.22, vary: 0.09 },
  "monster-hurt-ember":       { gain: 0.13, wet: 0.12, vary: 0.12 },
  "monster-death-ember":      { gain: 0.34, wet: 0.22, vary: 0.09 },
  // A wisp has no body, so it gets the most room of the six.
  "monster-hurt-spirit":      { gain: 0.13, wet: 0.20, vary: 0.12 },
  "monster-death-spirit":     { gain: 0.34, wet: 0.32, vary: 0.09 },
  "monster-spit":             { gain: 0.26, wet: 0.14, vary: 0.10 },
  "monster-slam-windup":      { gain: 0.30, wet: 0.20, vary: 0.03 },
  "monster-slam-impact":      { gain: 0.42, wet: 0.30, vary: 0.04 },
  "player-hurt":              { gain: 0.19, wet: 0.10, vary: 0.08 },
  "portal-open":              { gain: 0.34, wet: 0.34, vary: 0 },
  "portal-close":             { gain: 0.28, wet: 0.30, vary: 0 },
  "portal-enter":             { gain: 0.34, wet: 0.24, vary: 0 },
  "waystone-activate":        { gain: 0.36, wet: 0.28, vary: 0 },
  "flask-drink":              { gain: 0.30, wet: 0.08, vary: 0.05 },
  // Feet are meant to be felt, not listened to: PoE barely gives the player any, and
  // 0.045 was still the loudest thing in a quiet hideout. This is a third of that —
  // under a fight it disappears, which is the point.
  //
  // One ground per biome, three falls each (soundscape.ts picks). `vary` is nearly
  // twice what the rest of the table uses, because a footstep fires every third of a
  // second for the whole game and is the one cue with no headroom for repetition;
  // level jitter comes from the caller, since only it knows a step from a hit.
  // `wet` is the ROOM the ground implies: a flagstone hall rings, a bog swallows.
  "footstep-stone-1":         { gain: 0.014, wet: 0.14, vary: 0.16 },
  "footstep-stone-2":         { gain: 0.014, wet: 0.14, vary: 0.16 },
  "footstep-stone-3":         { gain: 0.014, wet: 0.14, vary: 0.16 },
  "footstep-dirt-1":          { gain: 0.014, wet: 0.06, vary: 0.16 },
  "footstep-dirt-2":          { gain: 0.014, wet: 0.06, vary: 0.16 },
  "footstep-dirt-3":          { gain: 0.014, wet: 0.06, vary: 0.16 },
  "footstep-grass-1":         { gain: 0.014, wet: 0.05, vary: 0.16 },
  "footstep-grass-2":         { gain: 0.014, wet: 0.05, vary: 0.16 },
  "footstep-grass-3":         { gain: 0.014, wet: 0.05, vary: 0.16 },
  "footstep-mud-1":           { gain: 0.014, wet: 0.04, vary: 0.16 },
  "footstep-mud-2":           { gain: 0.014, wet: 0.04, vary: 0.16 },
  "footstep-mud-3":           { gain: 0.014, wet: 0.04, vary: 0.16 },
  // Twelve dB under where they started, in two passes of six, because the first
  // pass was still audibly the loudest thing on the screen. A UI cue is a
  // confirmation that a press landed, not an event in its own right.
  "ui-click":                 { gain: 0.075, wet: 0.05, vary: 0.03 },
  // A hover fires on every pixel of travel across a menu, so it sits under the click
  // by a lot. Anything that competes with the click is a menu that buzzes.
  "ui-hover":                 { gain: 0.012, wet: 0.04, vary: 0.05 },
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

/**
 * Everything that has to be ready before the player's first click.
 *
 * Stone is here and the other three grounds are not: the hideout is where every
 * session starts, and the soundscape preloads a biome's ground when its area
 * arrives, which is earlier than the first step in it either way.
 */
export const CORE_SFX: readonly string[] = [
  "ui-click", "ui-hover", "ui-panel-open",
  "skill-ember-bolt-cast", "skill-ember-bolt-impact", "skill-cinder-ground-cast", "skill-blink",
  // The sustained pair especially: a loop that arrives after the bolt has landed is
  // a loop that never plays, because `startSfxLoop` will not start what it cannot
  // hear now — there is no queue, the flight is over.
  "skill-ember-bolt-flight", "skill-cinder-ground-loop",
  "monster-melee-hit", "monster-hurt", "monster-death", "player-hurt",
  "footstep-stone-1", "footstep-stone-2", "footstep-stone-3", "flask-drink",
];

/**
 * Play one sound. First call for a name starts the fetch and returns silently, so
 * an unpreloaded sound costs its first occurrence and nothing after it.
 *
 * `volume` scales the voice's own gain, which is how a distant monster is quieter
 * than one at the player's feet without a spatial graph nobody asked for.
 */
export function playSfx(name: string, volume = 1, distance = 0): void {
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
  g.gain.value = voice.gain * clamp(volume);
  src.connect(g);
  // Room grows with distance as well: what reaches the ear from across a hall is
  // mostly the hall.
  send(b, muffle(b, g, distance), voice.wet * (1 + distance / AUDIBLE));
  src.start();
}

/**
 * Sustained voices, keyed by whatever the caller uses to say "this one again":
 * the entity id of the bolt in the air or the patch of ground still burning.
 */
const loops = new Map<string, {
  src: AudioBufferSourceNode; gain: GainNode; peak: number;
  /** Always present, unlike a one-shot's: a bolt crosses the screen while it
   *  sounds, so its muffling has to be swept and not decided at the start. */
  lp: BiquadFilterNode;
}>();

/**
 * What the sustained voices are doing, for the console. DEV only, like
 * `window.__scene`: a loop is inaudible to a test and unhearable from a driven
 * page (Chrome parks the context until a real gesture), so the only way to see
 * one start or refuse to start is to ask.
 */
const debug = { started: 0, refused: {} as Record<string, number>, live: [] as string[] };
function note(reason: string): void {
  debug.refused[reason] = (debug.refused[reason] ?? 0) + 1;
}
function publish(): void {
  if (typeof window === "undefined" || !import.meta.env?.DEV) return;
  debug.live = [...loops.keys()];
  (window as unknown as { __sfx?: typeof debug }).__sfx = debug;
}

/** Seconds to reach level on start and to reach silence on stop. A loop that
 *  begins or ends on a step is heard as a click, which is worse than no loop. */
const LOOP_FADE_IN = 0.05;
const LOOP_FADE_OUT = 0.14;

/**
 * Start a sound and hold it until `stopSfxLoop(key)`.
 *
 * This is what makes a skill last as long as it is running: a one-shot at the cast
 * is over while the bolt is still in the air and long over while the ground burns.
 * The sample loops, so its master has to be a texture (fire, air) and not an event
 * with a decay — a transient looped is a stutter, which is the failure this is
 * meant to avoid rather than cause.
 *
 * Calling it twice for one key is a no-op, so a caller may say it every tick.
 */
export function startSfxLoop(name: string, key: string, volume = 1, distance = 0): void {
  if (loops.has(key)) return;
  const voice = VOICES[name];
  if (!voice || dead.has(name)) { note(`novoice:${name}`); publish(); return; }
  const b = bus();
  if (!b) { note("nobus"); publish(); return; }
  const buf = buffers.get(name);
  // The flight is over before a fetch lands, so this one is a miss, not a wait.
  if (!buf) { note(`unloaded:${name}`); publish(); void load(name); return; }

  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  // Pitch is set once and held: a rate that wandered mid-loop is a siren.
  if (voice.vary > 0) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * voice.vary;
  const g = b.ctx.createGain();
  const peak = voice.gain;
  g.gain.value = 0;
  g.gain.setTargetAtTime(peak * clamp(volume), b.ctx.currentTime, LOOP_FADE_IN);
  src.connect(g);
  const lp = b.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = distanceCutoff(distance);
  g.connect(lp);
  send(b, lp, voice.wet);
  src.start();
  loops.set(key, { src, gain: g, peak, lp });
  debug.started++;
  publish();
}

/** Follow a live loop's source as it moves relative to the player. */
export function setSfxLoopVolume(key: string, volume: number, distance = 0): void {
  const live = loops.get(key);
  const b = bus();
  if (!live || !b) return;
  live.gain.gain.setTargetAtTime(live.peak * clamp(volume), b.ctx.currentTime, LOOP_FADE_IN);
  // Same constant as the level: a filter that jumped per snapshot is a zipper.
  live.lp.frequency.setTargetAtTime(distanceCutoff(distance), b.ctx.currentTime, LOOP_FADE_IN);
}

/** Fade a loop out and let it go. Unknown keys are silently ignored. */
export function stopSfxLoop(key: string): void {
  const live = loops.get(key);
  if (!live) return;
  loops.delete(key);
  publish();
  const b = bus();
  if (!b) { try { live.src.stop(); } catch { /* already stopped */ } return; }
  const now = b.ctx.currentTime;
  live.gain.gain.setTargetAtTime(0, now, LOOP_FADE_OUT);
  // setTargetAtTime is asymptotic, so the stop is scheduled past several time
  // constants rather than at one: cutting at the constant is still audible.
  try { live.src.stop(now + LOOP_FADE_OUT * 5); } catch { /* already stopped */ }
}

/** Every sustained voice, gone. What a new area needs: the next world does not
 *  inherit this one's fire, and its entity ids are about to be reused. */
export function stopAllSfxLoops(): void {
  for (const key of [...loops.keys()]) stopSfxLoop(key);
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
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
  if (distance >= AUDIBLE) return 0;
  return 1 - (distance / AUDIBLE) * 0.8;
}

const AUDIBLE = 14;
/** Inside this, air has taken nothing off the top yet. */
const NEAR = 2.5;
const OPEN_HZ = 20000;
const FAR_HZ = 900;

/**
 * Corner frequency for something `distance` units away.
 *
 * Distance does not only make a thing quieter, it makes it duller: air and
 * everything in the way eat the top octaves first, which is the cue the ear
 * actually reads as far. Geometric between the two ends, because pitch is.
 */
export function distanceCutoff(distance: number): number {
  if (distance <= NEAR) return OPEN_HZ;
  const t = Math.min(1, (distance - NEAR) / (AUDIBLE - NEAR));
  return OPEN_HZ * Math.pow(FAR_HZ / OPEN_HZ, t);
}

/**
 * The muffling filter for a voice, or the voice itself when it is close enough
 * that a filter would be a node per sound for nothing.
 */
function muffle(b: Bus, node: AudioNode, distance: number): AudioNode {
  const hz = distanceCutoff(distance);
  if (hz >= OPEN_HZ) return node;
  const f = b.ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = hz;
  node.connect(f);
  return f;
}

/** Test seam: forget every decoded buffer and failure. */
export function resetSfx(): void {
  buffers.clear();
  loading.clear();
  dead.clear();
}
