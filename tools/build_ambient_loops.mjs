import { readFile, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const ROOT = resolve("audio-libs/extracted");
const OUT = resolve("apps/web/public/audio");
const SECONDS = 14;
const FADE = 0.75;
const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const SOURCES = {
  "ambient-hideout": "Doex Studio - Qantum UI/UI_BACKGROUND_LOW_DarkDrone_01.wav",
  "ambient-cave": "InMotionAudio - Cave Design/AMBUndr_CaveDesign01_InMotionAudio_CaveDesign.wav",
  "ambient-wind": "Epic Stock Media - Synthesized Nature Loops and Sounds/WINDInt_Loop Weather Wind Whipping Constricted Flow Turbulent 01_ESM_SNLS.wav",
  "ambient-swamp": "Epic Stock Media - Synthesized Nature Loops and Sounds/AMBTrop_Loop Ambience Jungle Night Humid Birds Bug Chirps 01_ESM_SNLS.wav",
  "ambient-forest": "Justsoundeffects - Forest Ambiences/BIRDPrey_Spring Night Deciduous Forest Many Tawny Owls Wind Leaves Rustling_JSE_FA.wav",
  "ambient-shore": "Just Sound Effects - Rocky Coast of Norway/WATRWave_Medium Waves at Pebble Beach_JSE_RCoN_Stereo.wav",
  "portal-close": "Justsoundeffects - Futuristic Interface/UIMvmt_Resonant Electric Whoosh 01_JSE_FI.wav",
};

function chunks(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const found = {};
  for (let at = 12; at + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", at, at + 4);
    const size = view.getUint32(at + 4, true);
    found[id] = { at: at + 8, size };
    at += 8 + size + (size & 1);
  }
  return { view, found };
}

function decode(buffer) {
  const { view, found } = chunks(buffer);
  const fmt = found["fmt "], data = found.data;
  if (!fmt || !data) throw new Error("source is not a RIFF WAV");
  const format = view.getUint16(fmt.at, true);
  const channels = view.getUint16(fmt.at + 2, true);
  const rate = view.getUint32(fmt.at + 4, true);
  const bits = view.getUint16(fmt.at + 14, true);
  const bytes = bits / 8;
  const frames = Math.floor(data.size / (channels * bytes));
  // The source's own channels, anything wider than stereo folded onto two.
  const out = Array.from({ length: Math.min(channels, 2) }, () => new Float32Array(frames));
  const sample = (at) => {
    if (format === 3 && bits === 32) return view.getFloat32(at, true);
    if (format !== 1) throw new Error(`unsupported WAV format ${format}`);
    if (bits === 16) return view.getInt16(at, true) / 32768;
    if (bits === 24) {
      let n = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
      if (n & 0x800000) n |= ~0xffffff;
      return n / 8388608;
    }
    if (bits === 32) return view.getInt32(at, true) / 2147483648;
    throw new Error(`unsupported ${bits}-bit WAV`);
  };
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) out[Math.min(c, out.length - 1)][i] += sample(data.at + (i * channels + c) * bytes);
  }
  for (let c = 0; c < out.length; c++) {
    const share = c === out.length - 1 ? channels - c : 1;
    if (share > 1) for (let i = 0; i < frames; i++) out[c][i] /= share;
  }
  return { rate, chans: out };
}

function loop({ rate, chans }) {
  const frames = chans[0].length;
  const length = Math.min(Math.floor(rate * SECONDS), frames - Math.floor(rate * FADE));
  const fade = Math.min(Math.floor(rate * FADE), Math.floor(length / 4));
  return {
    rate,
    // The body starts where the head that was folded under the tail ends, so the last
    // sample runs straight into the first and the seam is not a step.
    chans: chans.map((ch) => {
      const out = ch.slice(fade, length);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        out[out.length - fade + i] = ch[length - fade + i] * (1 - t) + ch[i] * t;
      }
      return out;
    }),
  };
}

/**
 * Subsonic cut, run over the loop twice and kept from the second pass so the filter is
 * as settled at the head as at the tail. Opus rejects near-DC itself with a filter that
 * starts at rest, so a drone's slow drift otherwise comes back as a step at the seam.
 */
function circularHighpass({ rate, chans }, hz = 20) {
  const w = (2 * Math.PI * hz) / rate, q = Math.SQRT1_2;
  const alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0, b1 = -(1 + cos) / a0, b2 = b0;
  const a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  return {
    rate,
    chans: chans.map((ch) => {
      const out = new Float32Array(ch.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < ch.length; i++) {
          const x = ch[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
          if (pass === 1) out[i] = y;
        }
      }
      return out;
    }),
  };
}

function event({ rate, chans }) {
  const frames = chans[0].length;
  const window = Math.max(1, Math.floor(rate * 0.1));
  let best = 0, bestEnergy = -1;
  for (let at = 0; at + window < frames; at += window) {
    let energy = 0;
    for (const ch of chans) for (let i = 0; i < window; i++) energy += ch[at + i] ** 2;
    if (energy > bestEnergy) { bestEnergy = energy; best = at; }
  }
  const length = Math.min(Math.floor(rate * 2.5), frames);
  const start = Math.max(0, Math.min(frames - length, best - Math.floor(length * 0.35)));
  const fade = Math.floor(rate * 0.04);
  return {
    rate,
    chans: chans.map((ch) => {
      const out = ch.slice(start, start + length);
      for (let i = 0; i < fade; i++) {
        out[i] *= i / fade;
        out[out.length - 1 - i] *= i / fade;
      }
      return out;
    }),
  };
}

function encode({ rate, chans }) {
  const n = chans.length, frames = chans[0].length;
  const out = Buffer.alloc(44 + frames * n * 2);
  out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(n, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * n * 2, 28);
  out.writeUInt16LE(n * 2, 32); out.writeUInt16LE(16, 34); out.write("data", 36);
  out.writeUInt32LE(frames * n * 2, 40);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++) {
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767))), 44 + (i * n + c) * 2);
    }
  }
  return out;
}

for (const [name, source] of Object.entries(SOURCES)) {
  const decoded = decode(await readFile(resolve(ROOT, source)));
  const wav = resolve(OUT, `${name}.wav`);
  const webm = resolve(OUT, `${name}.webm`);
  await writeFile(wav, encode(name.startsWith("ambient-") ? circularHighpass(loop(decoded)) : event(decoded)));
  await run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-c:a", "libopus", "-b:a", "160k", "-vbr", "on", "-application", "audio", "-ar", "48000", webm]);
  await unlink(wav);
}
