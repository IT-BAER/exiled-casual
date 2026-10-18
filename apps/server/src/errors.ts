import { createHash } from "node:crypto";

const CHUNK_NOISE = /\/assets\/(vendor|index)-/;

/** Message with URLs, content hashes, hex ids and numbers made generic, so one bug is one group. */
export function normaliseMessage(msg: string): string {
  return msg
    .replace(/(https?:\/\/[^\s?#)'"]+)[?#][^\s)'"]*/g, "$1")
    .replace(/-[A-Za-z0-9_]{6,}\.(m?js|css|wasm|glb|webp|png|webm)\b/g, "-*.$1")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\d+/g, "<n>")
    .trim();
}

function frames(stack: string): string[] {
  return stack.split("\n").map((l) => l.trim()).filter((l) => /^at\s|@/.test(l));
}

/** First frame that is not a vendor/index chunk; the first frame when nothing better exists. */
export function topFrame(stack: string | undefined): string | null {
  if (!stack) return null;
  const f = frames(stack);
  return f.find((l) => !CHUNK_NOISE.test(l)) ?? f[0] ?? null;
}

export function fingerprintError(src: string, msg: string, stack: string | undefined): string {
  const frame = topFrame(stack);
  const stable = frame ? normaliseMessage(frame.replace(/:\d+(:\d+)?\)?$/, "")) : "";
  return createHash("sha1").update(`${src}\n${normaliseMessage(msg)}\n${stable}`).digest("hex");
}
