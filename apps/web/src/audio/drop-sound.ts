import { bus, send, type Bus } from "./bus";

/**
 * Drop sound, synthesised at runtime (no audio assets in the repo).
 *
 * Not a beep: each drop is built the way a struck-metal sample is, from three
 * layers. A noise transient (the item touching stone), a modal body using the
 * inharmonic ratios of a real struck plate, and a convolution tail so the hit
 * lands in a room instead of in a vacuum.
 *
 * Tiering follows NeverSink's filter alerts rather than PoE's stock drop noises:
 * junk barely clicks, the good stuff announces itself, and the top tier gets a
 * deep gong you hear before you read the plate.
 */

/** Struck-plate mode ratios. Inharmonic, which is what reads as metal and not organ. */
const MODES = [1, 2.76, 5.4, 8.93, 13.34];

type Voice = {
  /** Fundamental of the modal body, Hz. */
  base: number;
  /** How many modes ring. More modes = brighter, more "expensive". */
  modes: number;
  /** Body decay at the fundamental, seconds. */
  decay: number;
  gain: number;
  /** Bandpass centre of the noise transient, Hz. */
  strike: number;
  /** Sub thump [Hz, decay] under the good drops, felt more than heard. */
  sub?: [number, number];
  /** Wet share of the reverb tail. */
  wet: number;
};

const VOICES: Record<string, Voice> = {
  normal: { base: 430, modes: 2, decay: 0.22, gain: 0.16, strike: 2600, wet: 0.1 },
  magic: { base: 540, modes: 3, decay: 0.8, gain: 0.26, strike: 3200, sub: [96, 0.5], wet: 0.22 },
  rare: { base: 620, modes: 4, decay: 1.5, gain: 0.32, strike: 3800, sub: [82, 1.0], wet: 0.34 },
  unique: { base: 305, modes: 5, decay: 2.6, gain: 0.4, strike: 4400, sub: [55, 2.4], wet: 0.5 },
};

/** One ringing mode: a sine with its own decay, detuned a touch so stacked modes
 *  beat against each other instead of phasing into a pure tone. */
function mode(b: Bus, freq: number, at: number, peak: number, decay: number, wetAmount: number) {
  const ac = b.ctx;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq * (1 + (Math.random() - 0.5) * 0.004), at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.004); // near-instant attack = struck, not bowed
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(g);
  send(b, g, wetAmount);
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

/** The contact click: 25 ms of bandpassed noise. Without it a modal body sounds
 *  synthetic, because nothing ever starts ringing from silence. */
function strike(b: Bus, centre: number, at: number, peak: number, wetAmount: number) {
  const ac = b.ctx;
  const len = Math.floor(ac.sampleRate * 0.025);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(centre, at);
  bp.frequency.exponentialRampToValueAtTime(centre * 0.45, at + 0.025); // the click darkens as it dies
  bp.Q.value = 1.1;
  const g = ac.createGain();
  g.gain.value = peak;
  src.connect(bp).connect(g);
  send(b, g, wetAmount);
  src.start(at);
}

/** Play the drop sound for one item. Silent (and safe) without WebAudio. */
export function playDropSound(rarity: string | undefined): void {
  const b = bus();
  if (!b) return;
  const v = VOICES[rarity ?? "normal"] ?? VOICES["normal"]!;
  const now = b.ctx.currentTime + 0.01;
  strike(b, v.strike, now, v.gain * 0.9, v.wet);
  for (let i = 0; i < v.modes; i++) {
    // Higher modes are quieter and die sooner, which is what stops a stack of
    // sines reading as a chord.
    mode(
      b,
      v.base * MODES[i]!,
      now + i * 0.0015,
      (v.gain / (i * 1.5 + 1)) * 0.8,
      v.decay / (i * 0.8 + 1),
      v.wet,
    );
  }
  if (v.sub) mode(b, v.sub[0], now, 0.34, v.sub[1], v.wet * 0.6);
}

// Re-exported so App.tsx and the tests keep one import for "the game's volume",
// even though the gain itself now lives on the shared bus.
export { soundLevel, setSoundLevel } from "./bus";
