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
let level = 0.8;
let room = 1;

/**
 * How reverberant the place the player is standing in is, as a multiplier on every
 * voice's own `wet`. A cue keeps its relative room (a wisp is always wetter than a
 * boot) while the whole mix moves with the walls: a cave rings, a desert does not.
 */
export function setRoom(amount: number): void {
  room = Number.isFinite(amount) ? Math.min(3, Math.max(0, amount)) : 1;
}

/** The gain actually being applied. Muted is zero, and the volume is remembered. */
export function soundLevel(): number {
  return level;
}

/** Set the output volume. Safe before any AudioContext exists. */
export function setSoundLevel(volume: number, muted: boolean): void {
  const clamped = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  level = muted ? 0 : clamped;
  if (master && ctx) master.gain.setTargetAtTime(level, ctx.currentTime, 0.01);
}

/** Small room, built from decaying noise — cheaper and more controllable than
 *  shipping an impulse response file. */
function impulse(ac: AudioContext): AudioBuffer {
  const len = Math.floor(ac.sampleRate * 1.6);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      // ^2.2 keeps the early reflections dense and the tail smooth.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
  }
  return buf;
}

export interface Bus {
  ctx: AudioContext;
  /** Straight to the master gain. */
  dry: GainNode;
  /** Through the convolver, then the master gain. */
  wet: GainNode;
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
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  wetBus.connect(verb).connect(master);
  dryBus.connect(master);
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
): StereoPannerNode | null {
  const wet = Math.min(1, wetAmount * room);
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
    node.connect(panner).connect(d).connect(b.dry);
  } else {
    node.connect(d).connect(b.dry);
  }
  const w = b.ctx.createGain();
  w.gain.value = wet;
  node.connect(w).connect(b.wet);
  return panner;
}
