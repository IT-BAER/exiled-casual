/**
 * The one audio graph in the page: context, master gain, and a dry/wet pair.
 *
 * Extracted out of drop-sound.ts when sampled effects arrived. Everything that
 * makes noise has to share a context (browsers cap them, and two contexts cannot
 * be mixed against each other) and has to share the master gain, or the Options
 * volume slider only turns down whichever half of the game happens to own it.
 *
 * The level exists as a NUMBER before it exists as a node: the menu sets a volume
 * long before the first click creates a context.
 */

let ctx: AudioContext | null = null;
let dryBus: GainNode | null = null;
let wetBus: GainNode | null = null;
let master: GainNode | null = null;
/**
 * `?volume=N` (percent) scales the whole mix without touching the saved setting;
 * a `?bot` run defaults to 10% so a watched playtest is not at full volume.
 */
export function urlVolumeScale(search: string): number {
  const q = new URLSearchParams(search);
  const v = q.get("volume");
  if (v !== null && v !== "" && Number.isFinite(Number(v))) return unit(Number(v) / 100);
  return q.has("bot") ? 0.1 : 1;
}
const URL_SCALE = typeof location !== "undefined" ? urlVolumeScale(location.search) : 1;
let level = 0.8 * URL_SCALE;

/**
 * The acoustics of the place being stood in. `amount` multiplies every voice's own
 * `wet`; `seconds`/`decay`/`preDelay`/`reflections` shape the impulse; `wetFloor` is
 * the least reverb a world cue gets; `airHz`/`airDb` are a high shelf on the world's
 * dry path, so a close sound is not in the ear.
 */
export interface RoomProfile {
  amount: number;
  seconds: number;
  decay: number;
  preDelay: number;
  reflections: number;
  wetFloor: number;
  airHz: number;
  airDb: number;
}

const NEUTRAL_ROOM: RoomProfile = {
  amount: 1, seconds: 1.6, decay: 2.2, preDelay: 0, reflections: 0,
  wetFloor: 0, airHz: 20000, airDb: 0,
};
let room: RoomProfile = NEUTRAL_ROOM;
/** Both convolvers, each behind a gain; `activeVerb` is the one faded in. */
const verbs: { conv: ConvolverNode; gain: GainNode }[] = [];
let activeVerb = 0;
let airFilter: BiquadFilterNode | null = null;
/** Time constant: three of them is the ~0.4 s an area change takes to settle. */
const ROOM_FADE = 0.4 / 3;

export type SoundCategory = "music" | "interface" | "skills" | "loot" | "environment";
export type SoundPreviewCategory = SoundCategory | "master";
export type SoundMix = Record<SoundCategory, number>;
export interface SoundLevels extends SoundMix {
  master: number;
  muted: boolean;
}

const CATEGORIES: readonly SoundCategory[] = [
  "music", "interface", "skills", "loot", "environment",
];
let mix: SoundMix = {
  music: 1,
  interface: 1,
  skills: 1,
  loot: 1,
  environment: 1,
};
const categoryDry = new Map<SoundCategory, GainNode>();
const categoryWet = new Map<SoundCategory, GainNode>();
const WORLD: ReadonlySet<SoundCategory | null> = new Set(["skills", "loot", "environment"]);

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Set the room the player is standing in. A cue keeps its relative room (a wisp is
 * always wetter than a boot) while the whole mix moves with the walls. Safe before
 * any AudioContext exists; the next impulse crossfades in so no tail is cut.
 */
export function setRoom(profile: RoomProfile): void {
  room = profile;
  if (!ctx || !airFilter) return;
  const now = ctx.currentTime;
  airFilter.frequency.setTargetAtTime(profile.airHz, now, ROOM_FADE);
  airFilter.gain.setTargetAtTime(profile.airDb, now, ROOM_FADE);
  const next = 1 - activeVerb;
  verbs[next]!.conv.buffer = impulse(ctx, profile);
  verbs[next]!.gain.gain.setTargetAtTime(1, now, ROOM_FADE);
  verbs[activeVerb]!.gain.gain.setTargetAtTime(0, now, ROOM_FADE);
  activeVerb = next;
}

/** The reverb send a voice actually gets: world cues never fall under the floor. */
export function effectiveWet(
  voiceWet: number,
  category: SoundCategory | null,
  profile: RoomProfile,
): number {
  const scaled = voiceWet * profile.amount;
  return Math.min(1, WORLD.has(category) ? Math.max(profile.wetFloor, scaled) : scaled);
}

/** The gain actually being applied. Muted is zero, and the volume is remembered. */
export function soundLevel(): number {
  return level;
}

/** Set the output volume. Safe before any AudioContext exists. */
export function setSoundLevel(volume: number, muted: boolean): void {
  const clamped = unit(volume);
  level = muted ? 0 : clamped * URL_SCALE;
  if (master && ctx) master.gain.setTargetAtTime(level, ctx.currentTime, 0.01);
}

/** Category levels currently applied, copied so callers cannot mutate the mixer. */
export function soundMix(): SoundMix {
  return { ...mix };
}

/** Apply the complete persisted mix, including sounds that are already looping. */
export function setSoundMix(next: SoundLevels): void {
  setSoundLevel(next.master, next.muted);
  mix = {
    music: unit(next.music),
    interface: unit(next.interface),
    skills: unit(next.skills),
    loot: unit(next.loot),
    environment: unit(next.environment),
  };
  if (!ctx) return;
  for (const category of CATEGORIES) {
    categoryDry.get(category)?.gain.setTargetAtTime(mix[category], ctx.currentTime, 0.01);
    categoryWet.get(category)?.gain.setTargetAtTime(mix[category], ctx.currentTime, 0.01);
  }
}

/** mulberry32: a stable noise source, so an impulse is the same every build. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stereo impulse from decaying noise, cheaper and more controllable than shipping a
 * file: `preDelay` of silence, `reflections` discrete early taps over the next 60 ms,
 * then a tail of noise * (1 - i/len)^decay.
 */
export function roomImpulse(
  sampleRate: number,
  profile: RoomProfile,
  rng: () => number = seeded(0x5eed),
): Float32Array[] {
  const pre = Math.round(profile.preDelay * sampleRate);
  const len = Math.round((profile.preDelay + profile.seconds) * sampleRate);
  const tailLen = Math.max(1, len - pre);
  const tapSpan = Math.min(tailLen, Math.round(0.06 * sampleRate));
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const data = new Float32Array(len);
    for (let i = pre; i < len; i++) {
      data[i] = (rng() * 2 - 1) * Math.pow(1 - (i - pre) / tailLen, profile.decay);
    }
    for (let k = 0; k < profile.reflections; k++) {
      const at = pre + Math.floor(((k + rng()) / profile.reflections) * tapSpan);
      if (at < len) data[at] = (data[at] ?? 0) + (rng() < 0.5 ? -1 : 1) * 0.9 * Math.pow(0.8, k);
    }
    out.push(data);
  }
  return out;
}

function impulse(ac: AudioContext, profile: RoomProfile): AudioBuffer {
  const data = roomImpulse(ac.sampleRate, profile);
  const buf = ac.createBuffer(2, data[0]!.length, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) buf.copyToChannel(data[ch]! as Float32Array<ArrayBuffer>, ch);
  return buf;
}

export interface Bus {
  ctx: AudioContext;
  /** Straight to the master gain. */
  dry: GainNode;
  /** Through the convolver, then the master gain. */
  wet: GainNode;
}

/** A short generated chime, always ready and routed through the slider it previews. */
export function playSoundPreview(category: SoundPreviewCategory): void {
  const b = bus();
  if (!b) return;
  const at = b.ctx.currentTime;
  const osc = b.ctx.createOscillator();
  const gain = b.ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.12, at + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  osc.connect(gain);
  send(b, gain, 0.05, 0, false, category === "master" ? null : category);
  osc.start(at);
  osc.stop(at + 0.13);
}

/** DEV console: `__room({ seconds: 2 })` merges into the current room and re-applies it. */
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { __room?: (p: Partial<RoomProfile>) => RoomProfile }).__room = (p) => {
    setRoom({ ...room, ...p });
    return room;
  };
}

/** The shared graph, built on first use. Null in jsdom and without WebAudio. */
export function bus(): Bus | null {
  if (ctx && dryBus && wetBus) {
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, dry: dryBus, wet: wetBus };
  }
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null; // jsdom, or a browser without WebAudio
  ctx = new Ctor();
  dryBus = ctx.createGain();
  wetBus = ctx.createGain();
  master = ctx.createGain();
  master.gain.value = level;
  master.connect(ctx.destination);
  verbs.length = 0;
  for (let i = 0; i < 2; i++) {
    const conv = ctx.createConvolver();
    const gain = ctx.createGain();
    gain.gain.value = i === 0 ? 1 : 0;
    wetBus.connect(conv).connect(gain).connect(master);
    verbs.push({ conv, gain });
  }
  verbs[0]!.conv.buffer = impulse(ctx, room);
  activeVerb = 0;
  airFilter = ctx.createBiquadFilter();
  airFilter.type = "highshelf";
  airFilter.frequency.value = room.airHz;
  airFilter.gain.value = room.airDb;
  airFilter.connect(dryBus);
  dryBus.connect(master);
  for (const category of CATEGORIES) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = mix[category];
    wet.gain.value = mix[category];
    dry.connect(WORLD.has(category) ? airFilter : dryBus);
    wet.connect(wetBus);
    categoryDry.set(category, dry);
    categoryWet.set(category, wet);
  }
  // Autoplay policy parks the context until a gesture; the game is click-driven,
  // so resuming on the first sound is enough.
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, dry: dryBus, wet: wetBus };
}

/** Route one voice into the direct and reverb paths. The direct sound keeps its
 * bearing while the room return stays diffuse and centered. */
export function send(
  b: Bus,
  node: AudioNode,
  wetAmount: number,
  panAmount = 0,
  moving = false,
  category: SoundCategory | null = "environment",
): StereoPannerNode | null {
  const wet = effectiveWet(wetAmount, category, room);
  const d = b.ctx.createGain();
  d.gain.value = 1 - wet * 0.5;
  const pan = Number.isFinite(panAmount) ? Math.max(-1, Math.min(1, panAmount)) : 0;
  const create = (b.ctx as AudioContext & {
    createStereoPanner?: () => StereoPannerNode;
  }).createStereoPanner;
  let panner: StereoPannerNode | null = null;
  if ((moving || pan !== 0) && typeof create === "function") {
    panner = create.call(b.ctx);
    panner.pan.value = pan;
    node.connect(panner).connect(d).connect(category ? categoryDry.get(category) ?? b.dry : b.dry);
  } else {
    node.connect(d).connect(category ? categoryDry.get(category) ?? b.dry : b.dry);
  }
  const w = b.ctx.createGain();
  w.gain.value = wet;
  node.connect(w).connect(category ? categoryWet.get(category) ?? b.wet : b.wet);
  return panner;
}
