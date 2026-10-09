import { bus, send, type Bus, type SoundCategory } from "./bus";

/**
 * Sampled sound effects: skills, monsters, portals, flasks, footsteps and the UI.
 *
 * Every master is a commercial library recording, curated rather than generated:
 * `tools/import_sfx.py` names the source file per cue and runs it through
 * `tools/trim_sfx.py` to Opus in WebM; the reward cues are layered from several
 * library parts by `tools/build_reward_sfx.py` — 192 files in all. They share one
 * bus, so the Options volume covers everything and nothing fights it for a context.
 *
 * The monster cues and Varkis's voice are ElevenLabs-generated masters, a take pool per
 * material so a stone construct and a bog thing never die the same way; everything else
 * is a library recording. The library also fixes the
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
interface Voice {
  gain: number; wet: number; vary: number;
  /** Files `<cue>-1..N` the cue draws from; absent means the one file `<cue>.webm`. */
  takes?: number;
}

const VOICES: Record<string, Voice> = {
  "ambient-hideout":          { gain: 0.156, wet: 0.08, vary: 0 },
  "ambient-cave":             { gain: 0.082, wet: 0.24, vary: 0 },
  "ambient-wind":             { gain: 0.088, wet: 0.04, vary: 0 },
  "ambient-swamp":            { gain: 0.08, wet: 0.10, vary: 0 },
  "ambient-forest":           { gain: 0.07, wet: 0.08, vary: 0 },
  // Open coast: almost no reverb, because there is nothing out there to reflect.
  "ambient-shore":            { gain: 0.071, wet: 0.03, vary: 0 },
  "skill-ember-bolt-cast":    { gain: 0.183, wet: 0.14, vary: 0.06, takes: 3 },
  "skill-ember-bolt-impact":  { gain: 0.295, wet: 0.18, vary: 0.08, takes: 3 },
  "skill-cinder-ground-cast": { gain: 0.247, wet: 0.22, vary: 0.04, takes: 3 },
  // The two sustained voices (`startSfxLoop`). These numbers are MEASURED against
  // the one-shot they play under, not guessed: the masters are levelled apart (a
  // bed is normalised to -23 LUFS, an event by the trimmer to far louder), so equal
  // gains are not equal loudness. At 0.11 the flight bed landed 18.3 dB under the
  // cast, which is inaudible beside it — the cast ended at 0.90s, the bolt flew for
  // 1.7s, and what that sounds like is the sound stopping mid-flight. The cast is
  // now deliberately quieter than the travelling bed, so direction follows the
  // projectile instead of the transient masking it. `vary` is per voice and set
  // once, so two bolts in the air are not one doubled bolt.
  "skill-ember-bolt-flight":  { gain: 0.389, wet: 0.10, vary: 0.05, takes: 3 },
  // Higher still: the burning ground IS the skill for its whole duration, so its
  // bed is the event and the cast is only the whoomp that opens it. Held down by
  // the master's peaks, which are cracks rather than body.
  "skill-cinder-ground-loop": { gain: 0.45, wet: 0.24, vary: 0.03, takes: 3 },
  "skill-blink":              { gain: 0.282, wet: 0.12, vary: 0.05, takes: 3 },
  "skill-bow-release":        { gain: 0.202, wet: 0.08, vary: 0.08, takes: 3 },
  "skill-arrow-impact":       { gain: 0.293, wet: 0.12, vary: 0.10, takes: 3 },
  "skill-strike-swing":       { gain: 0.144, wet: 0.08, vary: 0.08, takes: 3 },
  "skill-strike-impact":      { gain: 0.189, wet: 0.12, vary: 0.10, takes: 3 },
  "skill-heavy-strike-impact": { gain: 0.273, wet: 0.14, vary: 0.08, takes: 3 },
  "skill-ground-slam-impact": { gain: 0.337, wet: 0.22, vary: 0.05, takes: 3 },
  // The free attack: smaller than the bolt in level as in looks, and no flight bed.
  "skill-ember-spark-cast":   { gain: 0.171, wet: 0.10, vary: 0.08, takes: 3 },
  "skill-ember-spark-impact": { gain: 0.288, wet: 0.14, vary: 0.10, takes: 3 },
  "monster-melee-hit":        { gain: 0.113, wet: 0.16, vary: 0.10, takes: 3 },
  // The generic pair is the fallback for a species with no material (soundscape.ts),
  // never the cue a known monster gets. The six below are the ones actually heard.
  "monster-hurt":             { gain: 0.103, wet: 0.12, vary: 0.12, takes: 3 },
  "monster-death":            { gain: 0.270, wet: 0.24, vary: 0.09, takes: 3 },
  "monster-hurt-stone":       { gain: 0.099, wet: 0.14, vary: 0.12, takes: 3 },
  "monster-death-stone":      { gain: 0.267, wet: 0.26, vary: 0.09, takes: 3 },
  // Clicks with no body: mean -30 dB against the other hurts' -16, peak -2.5. Lifted
  // 11.5 dB, short of a mean match, because a transient reads louder than its mean.
  "monster-hurt-husk":        { gain: 0.385, wet: 0.10, vary: 0.12, takes: 3 },
  "monster-death-husk":       { gain: 0.280, wet: 0.18, vary: 0.09, takes: 3 },
  "monster-hurt-bog":         { gain: 0.104, wet: 0.14, vary: 0.12, takes: 3 },
  "monster-death-bog":        { gain: 0.267, wet: 0.24, vary: 0.09, takes: 3 },
  "monster-hurt-beast":       { gain: 0.105, wet: 0.12, vary: 0.12, takes: 3 },
  "monster-death-beast":      { gain: 0.272, wet: 0.22, vary: 0.09, takes: 3 },
  "monster-hurt-ember":       { gain: 0.105, wet: 0.12, vary: 0.12, takes: 3 },
  "monster-death-ember":      { gain: 0.270, wet: 0.22, vary: 0.09, takes: 3 },
  // A wisp has no body, so it gets the most room of the six.
  "monster-hurt-spirit":      { gain: 0.100, wet: 0.20, vary: 0.12, takes: 3 },
  "monster-death-spirit":     { gain: 0.270, wet: 0.32, vary: 0.09, takes: 3 },
  "monster-spit":             { gain: 0.222, wet: 0.14, vary: 0.10, takes: 3 },
  "monster-slam-windup":      { gain: 0.222, wet: 0.20, vary: 0.03, takes: 3 },
  "monster-slam-impact":      { gain: 0.325, wet: 0.30, vary: 0.04, takes: 3 },
  "player-hurt":              { gain: 0.194, wet: 0.10, vary: 0.08, takes: 3 },
  "player-death":             { gain: 0.36, wet: 0.20, vary: 0.03, takes: 3 },
  // Varkis (varkis-voice.ts). A voice never wanders in pitch: that is a different man.
  "npc-varkis-greet-1":       { gain: 0.5, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-greet-2":       { gain: 0.5, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-greet-3":       { gain: 0.512, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-greet-4":       { gain: 0.497, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-shop-1":        { gain: 0.53, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-shop-2":        { gain: 0.509, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-shop-3":        { gain: 0.506, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-shop-4":        { gain: 0.518, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-bye-1":         { gain: 0.503, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-bye-2":         { gain: 0.506, wet: 0.06, vary: 0, takes: 2 },
  "npc-varkis-bye-3":         { gain: 0.518, wet: 0.06, vary: 0, takes: 2 },
  // Down 3.5 dB from the tonal vortex this replaced. Both masters measure the
  // same integrated loudness; a broadband gust simply reads louder than a
  // narrow pitched band does at that level, and this one lands beside the
  // crossing whoosh when a map arrives.
  "portal-open":              { gain: 0.171, wet: 0.34, vary: 0, takes: 3 },
  "portal-close":             { gain: 0.202, wet: 0.30, vary: 0, takes: 3 },
  "portal-enter":             { gain: 0.233, wet: 0.24, vary: 0, takes: 3 },
  "waystone-activate":        { gain: 0.361, wet: 0.28, vary: 0, takes: 3 },
  "flask-drink":              { gain: 0.339, wet: 0.08, vary: 0.05, takes: 3 },
  // Feet are meant to be felt, not listened to: PoE barely gives the player any, and
  // 0.045 was still the loudest thing in a quiet hideout. This is a third of that —
  // under a fight it disappears, which is the point.
  //
  // One ground per biome, three takes each (`takes`). `vary` is nearly
  // twice what the rest of the table uses, because a footstep fires every third of a
  // second for the whole game and is the one cue with no headroom for repetition;
  // level jitter comes from the caller, since only it knows a step from a hit.
  // `wet` is the ROOM the ground implies: a flagstone hall rings, a bog swallows.
  "footstep-stone":          { gain: 0.016, wet: 0.14, vary: 0.16, takes: 3 },
  "footstep-dirt":           { gain: 0.013, wet: 0.06, vary: 0.16, takes: 3 },
  "footstep-grass":          { gain: 0.014, wet: 0.05, vary: 0.16, takes: 3 },
  "footstep-mud":            { gain: 0.014, wet: 0.04, vary: 0.16, takes: 3 },
  // Twelve dB under where they started, in two passes of six, because the first
  // pass was still audibly the loudest thing on the screen. A UI cue is a
  // confirmation that a press landed, not an event in its own right.
  "ui-click":                 { gain: 0.063, wet: 0.05, vary: 0.03, takes: 3 },
  // A hover fires on every pixel of travel across a menu, so it sits under the click
  // by a lot. Anything that competes with the click is a menu that buzzes.
  "ui-hover":                 { gain: 0.011, wet: 0.04, vary: 0.05, takes: 3 },
  "ui-panel-open":            { gain: 0.229, wet: 0.10, vary: 0.04, takes: 3 },
  // Reward cues. Mean volume (ffmpeg volumedetect): monster-death -16.0 dB, drop-unique -17.37 dB,
  // so drop-unique's gain is 0.34 * 10^(1.37/20) = 0.398; the rest keep their balance against it.
  // Tonal cues never vary: the pitch is the signal.
  "drop-normal":              { gain: 0.392, wet: 0.10, vary: 0, takes: 3 },
  "drop-magic":               { gain: 0.377, wet: 0.22, vary: 0 },
  "drop-rare":                { gain: 0.398, wet: 0.34, vary: 0, takes: 3 },
  "drop-unique":              { gain: 0.398, wet: 0.50, vary: 0, takes: 3 },
  "drop-currency":            { gain: 0.377, wet: 0.20, vary: 0, takes: 3 },
  "drop-gold":                { gain: 0.188, wet: 0.12, vary: 0.06, takes: 3 },
  "drop-gold-jackpot":        { gain: 0.39, wet: 0.30, vary: 0, takes: 3 },
  "coin-pickup":              { gain: 0.38, wet: 0.08, vary: 0.08, takes: 3 },
  "level-up":                 { gain: 0.36, wet: 0.30, vary: 0 },
  "container-open":           { gain: 0.368, wet: 0.16, vary: 0.04, takes: 3 },
};

export type SfxName = keyof typeof VOICES & string;

export function sfxCategory(name: string): SoundCategory {
  if (name.startsWith("ambient-")) return "music";
  if (name.startsWith("skill-")) return "skills";
  if (name.startsWith("ui-")) return "interface";
  if (/^(drop|coin|level|container)-/.test(name)) return "loot";
  // Monsters and Varkis (`npc-`): a voice standing in the room gets the room.
  return "environment";
}

/** Decoded buffers, and the in-flight fetches, keyed by file (one per take). */
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<void>>();
/** Files that failed once. Never retried: a 404 is not going to change. */
const dead = new Set<string>();
/** The file each cue played last, so a pool never repeats itself back to back. */
const lastTake = new Map<string, string>();

/** The files of a cue: itself, or `<cue>-1..N` for a pool. */
function files(name: string): string[] {
  const n = VOICES[name]?.takes ?? 1;
  return n < 2 ? [name] : Array.from({ length: n }, (_, i) => `${name}-${i + 1}`);
}

/**
 * A loaded, live take of the cue, uniform over them but for the one it played last.
 * Null when none is ready, after starting the loads for the ones that are not.
 */
function pickTake(name: string): AudioBuffer | null {
  const live = files(name).filter((f) => !dead.has(f));
  const ready = live.filter((f) => buffers.has(f));
  if (ready.length === 0) { for (const f of live) void load(f); return null; }
  const last = lastTake.get(name);
  const pool = ready.length > 1 ? ready.filter((f) => f !== last) : ready;
  const file = pool[Math.floor(Math.random() * pool.length)]!;
  lastTake.set(name, file);
  return buffers.get(file)!;
}

function load(name: string): Promise<void> {
  const already = loading.get(name);
  if (already) return already;
  const v = import.meta.env?.VITE_AUDIO_VERSION;
  // A content hash of public/audio (vite.config.ts): files keep their names across
  // rebuilds, so without it a 4 h browser cache plays the old sound.
  const p = fetch(`${DIR}/${name}.webm${v ? `?v=${v}` : ""}`)
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
  return Promise.all(names.flatMap(files).filter((f) => !buffers.has(f) && !dead.has(f)).map(load))
    .then(() => undefined);
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
  "skill-bow-release", "skill-arrow-impact", "skill-strike-swing", "skill-strike-impact",
  "skill-heavy-strike-impact", "skill-ground-slam-impact",
  "skill-ember-spark-cast", "skill-ember-spark-impact", "player-death",
  // The sustained pair especially: a loop that arrives after the bolt has landed is
  // a loop that never plays, because `startSfxLoop` will not start what it cannot
  // hear now — there is no queue, the flight is over.
  "skill-ember-bolt-flight", "skill-cinder-ground-loop",
  "monster-melee-hit", "monster-hurt", "monster-death", "player-hurt",
  "footstep-stone", "flask-drink",
  // A drop must never be a silent first play.
  "drop-normal", "drop-magic", "drop-rare", "drop-unique", "drop-currency", "drop-gold",
  "drop-gold-jackpot", "coin-pickup", "level-up", "container-open",
];

/**
 * Every voice there is, for the loading screen to swallow whole.
 *
 * The whole library is 5.5 MB of Opus across 192 files: less than one of
 * the character's textures, and cheaper to fetch all of than to reason about
 * which biome needs which. `CORE_SFX` still exists and still goes first, because
 * ordering is the only thing that matters once cost stops mattering — the first
 * click must not wait behind a swamp ambience nobody is standing in.
 */
export const ALL_SFX: readonly string[] = Object.keys(VOICES);

/** Per-play level wander of a one-shot, in dB either way. Loops hold their level. */
const LEVEL_JITTER_DB = 1.0;

/** A point in simulation units. */
interface At { x: number; y: number }

/**
 * Where the ear is: the player, in simulation units, set every snapshot. World
 * voices are placed absolutely, so a line already sounding pans and fades as he walks.
 */
const listener: At = { x: 0, y: 0 };
/** The context the listener node was last written to; a new context starts unplaced. */
let listenerCtx: BaseAudioContext | null = null;
/** Glide for every position write: a 30 Hz step written raw is a zipper. */
const GLIDE = 0.05;

/**
 * Sim (x, y) into WebAudio listener space, as [x, z] on the ground y = 0. The camera (engine.ts,
 * alpha -PI/4) shows sim (+1,+1) as screen-right and (-1,+1) as screen-up (intents.ts
 * WASD); the listener looks down with -Z as its up, so +X is its right. Distance holds.
 */
export function toListenerSpace(x: number, y: number): [number, number] {
  return [(x + y) / Math.SQRT2, (x - y) / Math.SQRT2];
}

function glide(ctx: BaseAudioContext, p: AudioParam, v: number, smooth: boolean): void {
  if (smooth) p.setTargetAtTime(v, ctx.currentTime, GLIDE);
  else p.value = v;
}

function placeListener(ctx: BaseAudioContext, smooth: boolean): void {
  const [x, z] = toListenerSpace(listener.x, listener.y);
  const l = ctx.listener;
  try {
    if (l.positionX) {
      glide(ctx, l.positionX, x, smooth);
      glide(ctx, l.positionY, LISTENER_HEIGHT, smooth);
      glide(ctx, l.positionZ, z, smooth);
      if (!smooth) {
        l.forwardX.value = 0; l.forwardY.value = -1; l.forwardZ.value = 0;
        l.upX.value = 0; l.upY.value = 0; l.upZ.value = -1;
      }
    } else {
      // Firefox: no AudioParams on the listener, so no glide either.
      l.setPosition(x, LISTENER_HEIGHT, z);
      if (!smooth) l.setOrientation(0, -1, 0, 0, 0, -1);
    }
  } catch { /* a listener we cannot place leaves every voice centred */ }
}

/** First world voice on a context: put the listener where the player already is. */
function syncListener(b: Bus): void {
  if (listenerCtx === b.ctx) return;
  listenerCtx = b.ctx;
  placeListener(b.ctx, false);
}

/** Move the ear to the player. Sim units; call once per snapshot. Safe without WebAudio. */
export function setSfxListener(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  listener.x = x;
  listener.y = y;
  if (listenerCtx) placeListener(listenerCtx, true);
}

function distanceTo(at: At): number {
  return Math.hypot(at.x - listener.x, at.y - listener.y);
}

function placePanner(ctx: BaseAudioContext, p: PannerNode, at: At, smooth: boolean): void {
  const [x, z] = toListenerSpace(at.x, at.y);
  try {
    if (p.positionX) {
      glide(ctx, p.positionX, x, smooth);
      glide(ctx, p.positionY, 0, smooth);
      glide(ctx, p.positionZ, z, smooth);
    } else {
      p.setPosition(x, 0, z);
    }
  } catch { /* unplaced reads as centred, which is still a sound */ }
}

/**
 * The panner a world voice sounds through, or null where WebAudio has none (the
 * caller then applies `distanceRolloff` itself). Its model is `distanceRolloff`'s.
 */
function pannerAt(b: Bus, at: At): PannerNode | null {
  if (typeof b.ctx.createPanner !== "function") return null;
  const p = b.ctx.createPanner();
  p.panningModel = "equalpower";
  p.distanceModel = "inverse";
  p.refDistance = REF_DISTANCE;
  p.rolloffFactor = ROLLOFF;
  p.coneInnerAngle = 360;
  p.coneOuterAngle = 360;
  placePanner(b.ctx, p, at, false);
  return p;
}

/**
 * Play one sound. First call for a name starts the fetch and returns silently, so
 * an unpreloaded sound costs its first occurrence and nothing after it.
 *
 * For cues on the player or the UI: centred, unmuffled. `volume` scales the voice's
 * own gain. Returns how many seconds it will sound, 0 when nothing started.
 */
export function playSfx(name: string, volume = 1): number {
  return playVoice(name, volume, null);
}

/**
 * Play a world cue at sim (x, y): panned and attenuated against the listener as it
 * moves, muffled and given more room by its distance at the start. A source at or
 * past `AUDIBLE` from the player does not start. Returns seconds, like `playSfx`.
 */
export function playSfxAt(name: string, x: number, y: number, volume = 1): number {
  return playVoice(name, volume, { x, y });
}

function playVoice(name: string, volume: number, at: At | null): number {
  const voice = VOICES[name];
  if (!voice) return 0;
  const distance = at ? distanceTo(at) : 0;
  if (!(distance < AUDIBLE)) return 0;
  const b = bus();
  if (!b) return 0;
  const buf = pickTake(name);
  if (!buf) return 0;
  if (at) syncListener(b);
  const panner = at ? pannerAt(b, at) : null;
  const roll = distanceRolloff(distance);

  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  if (voice.vary > 0) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * voice.vary;
  const g = b.ctx.createGain();
  g.gain.value = voice.gain * clamp(volume) * 10 ** (((Math.random() * 2 - 1) * LEVEL_JITTER_DB) / 20)
    * (at && !panner ? roll : 1);
  src.connect(g);
  // Room grows with distance: what reaches the ear from across a hall is mostly the
  // hall. The send is taken before the panner, so it carries the rolloff itself.
  const wet = send(
    b,
    muffle(b, g, distance),
    voice.wet * (1 + (2 * distance) / AUDIBLE),
    sfxCategory(name),
    panner,
  );
  if (panner && wet) wet.gain.value *= roll;
  src.start();
  return buf.duration / src.playbackRate.value;
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
  /** World loops only: the panner it sounds through and its reverb send, whose
   *  level at no distance is `wetBase`. */
  panner: PannerNode | null;
  wet: GainNode | null;
  wetBase: number;
  world: boolean;
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
 * This one is centred (the ambience); a loop with a source is `startSfxLoopAt`.
 */
export function startSfxLoop(name: string, key: string, volume = 1): void {
  startLoop(name, key, volume, null);
}

/** A loop at sim (x, y), followed by `moveSfxLoop`. Silent while past `AUDIBLE`. */
export function startSfxLoopAt(name: string, key: string, x: number, y: number, volume = 1): void {
  startLoop(name, key, volume, { x, y });
}

/** The level a world loop's gain holds: nothing past the edge, rolloff by hand without a panner. */
function loopLevel(peak: number, volume: number, distance: number, panner: PannerNode | null): number {
  if (!(distance < AUDIBLE)) return 0;
  return peak * clamp(volume) * (panner ? 1 : distanceRolloff(distance));
}

function startLoop(name: string, key: string, volume: number, at: At | null): void {
  if (loops.has(key)) return;
  const voice = VOICES[name];
  if (!voice || files(name).every((f) => dead.has(f))) { note(`novoice:${name}`); publish(); return; }
  const b = bus();
  if (!b) { note("nobus"); publish(); return; }
  const buf = pickTake(name);
  // The flight is over before a fetch lands, so this one is a miss, not a wait.
  if (!buf) { note(`unloaded:${name}`); publish(); return; }
  if (at) syncListener(b);
  const distance = at ? distanceTo(at) : 0;
  const panner = at ? pannerAt(b, at) : null;

  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  // Pitch is set once and held: a rate that wandered mid-loop is a siren.
  if (voice.vary > 0) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * voice.vary;
  const g = b.ctx.createGain();
  const peak = voice.gain;
  g.gain.value = 0;
  g.gain.setTargetAtTime(loopLevel(peak, volume, distance, panner), b.ctx.currentTime, LOOP_FADE_IN);
  src.connect(g);
  const lp = b.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = distanceCutoff(distance);
  g.connect(lp);
  const wet = send(b, lp, voice.wet, sfxCategory(name), panner);
  const wetBase = wet ? wet.gain.value : 0;
  if (panner && wet) wet.gain.value = wetBase * distanceRolloff(distance);
  src.start();
  loops.set(key, { src, gain: g, peak, lp, panner, wet, wetBase, world: at !== null });
  debug.started++;
  publish();
}

/**
 * Follow a world loop's source to sim (x, y), against wherever the listener is now.
 * Unknown keys, and centred loops, are ignored.
 */
export function moveSfxLoop(key: string, x: number, y: number, volume = 1): void {
  const live = loops.get(key);
  if (!live?.world) return;
  const b = bus();
  if (!b) return;
  const now = b.ctx.currentTime;
  const distance = distanceTo({ x, y });
  live.gain.gain.setTargetAtTime(loopLevel(live.peak, volume, distance, live.panner), now, LOOP_FADE_IN);
  // Same constant as the level: a filter that jumped per snapshot is a zipper.
  live.lp.frequency.setTargetAtTime(distanceCutoff(distance), now, LOOP_FADE_IN);
  if (live.panner) {
    placePanner(b.ctx, live.panner, { x, y }, true);
    live.wet?.gain.setTargetAtTime(live.wetBase * distanceRolloff(distance), now, LOOP_FADE_IN);
  }
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

/** One per biome, and it must stay that way: the fallback below answers for any
 *  id, so a biome that is simply missing plays a cave and nothing complains. */
export const AMBIENT_BY_BIOME: Record<string, string> = {
  vaal_stone: "ambient-cave",
  desert: "ambient-wind",
  swamp: "ambient-swamp",
  forest: "ambient-forest",
  coast: "ambient-shore",
};

export function ambientCue(biomeId: string | null): string {
  return biomeId === null ? "ambient-hideout" : (AMBIENT_BY_BIOME[biomeId] ?? "ambient-cave");
}

let wantedAmbient: string | null = null;
export function setAmbient(biomeId: string | null): void {
  const cue = ambientCue(biomeId);
  if (wantedAmbient === cue && loops.has("ambient")) return;
  wantedAmbient = cue;
  stopSfxLoop("ambient");
  void preloadSfx([cue]).then(() => {
    if (wantedAmbient === cue) startSfxLoop(cue, "ambient");
  });
}

export function stopAmbient(): void {
  wantedAmbient = null;
  stopSfxLoop("ambient");
}

/**
 * The ear hangs this far above the player, looking down like the camera. On the ground
 * a source half a unit aside is 90 degrees off and equal-power pans it hard; from up
 * here only the screen edge pans hard (atan(1.5/5) = 17 degrees for a man beside you).
 */
const LISTENER_HEIGHT = 5;
/** Inverse model from the listener: nothing nearer than the player's own spot is cut. */
const REF_DISTANCE = LISTENER_HEIGHT;
const ROLLOFF = 3;

/**
 * How loud something `distance` ground units from the player is: WebAudio's "inverse"
 * model as every world panner is built, heard from LISTENER_HEIGHT up
 * (-1.8 dB at 2 units, -10.0 at 7, -15.3 at 12). Used by hand where there is no panner.
 */
export function distanceRolloff(distance: number): number {
  const d = Math.max(Math.hypot(distance, LISTENER_HEIGHT), REF_DISTANCE);
  return REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (d - REF_DISTANCE));
}

/** Past this a world one-shot does not start and a world loop is silent: the frame is
 *  about 19 units across, and a map's worth of monsters must not mix into mud. */
const AUDIBLE = 14;
/** Inside this, air has taken nothing off the top yet: about a third of the frame. */
const NEAR = 6;
const OPEN_HZ = 20000;
const FAR_HZ = 4000;

/**
 * Corner frequency for something `distance` units away: full band to NEAR, then
 * geometric down to FAR_HZ at AUDIBLE (8.9 kHz at 10 units).
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
  lastTake.clear();
  listenerCtx = null;
}
