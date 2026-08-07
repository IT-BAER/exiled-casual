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
  const mono = new Float32Array(frames);
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
    let total = 0;
    for (let c = 0; c < channels; c++) total += sample(data.at + (i * channels + c) * bytes);
    mono[i] = total / channels;
  }
  return { rate, mono };
}

function loop({ rate, mono }) {
  const length = Math.min(Math.floor(rate * SECONDS), mono.length - Math.floor(rate * FADE));
  const fade = Math.min(Math.floor(rate * FADE), Math.floor(length / 4));
  const out = mono.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[length - fade + i] = out[length - fade + i] * (1 - t) + out[i] * t;
  }
  return { rate, mono: out };
}

function event({ rate, mono }) {
  const window = Math.max(1, Math.floor(rate * 0.1));
  let best = 0, bestEnergy = -1;
  for (let at = 0; at + window < mono.length; at += window) {
    let energy = 0;
    for (let i = 0; i < window; i++) energy += mono[at + i] ** 2;
    if (energy > bestEnergy) { bestEnergy = energy; best = at; }
  }
  const length = Math.min(Math.floor(rate * 2.5), mono.length);
  const start = Math.max(0, Math.min(mono.length - length, best - Math.floor(length * 0.35)));
  const out = mono.slice(start, start + length);
  const fade = Math.floor(rate * 0.04);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return { rate, mono: out };
}

function encode({ rate, mono }) {
  const out = Buffer.alloc(44 + mono.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36);
  out.writeUInt32LE(mono.length * 2, 40);
  for (let i = 0; i < mono.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767))), 44 + i * 2);
  return out;
}

for (const [name, source] of Object.entries(SOURCES)) {
  const decoded = decode(await readFile(resolve(ROOT, source)));
  const wav = resolve(OUT, `${name}.wav`);
  const webm = resolve(OUT, `${name}.webm`);
  await writeFile(wav, encode(name.startsWith("ambient-") ? loop(decoded) : event(decoded)));
  await run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-c:a", "libopus", "-b:a", "64k", webm]);
  await unlink(wav);
}
