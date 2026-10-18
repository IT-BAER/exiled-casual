import { createHmac, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=]/g, "");
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

const STEP = 30;

export function totpStep(step: number, key: Uint8Array): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const code = (h.readUInt32BE(off) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** RFC 6238 code for a unix time in seconds (SHA1, 6 digits, 30 s). */
export function totpAt(key: Uint8Array, unixSeconds: number): string {
  return totpStep(Math.floor(unixSeconds / STEP), key);
}

/** Returns the matching step within +-1 of now, or null. The caller rejects a step already used. */
export function verifyTotp(key: Uint8Array, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(nowMs / 1000 / STEP);
  let hit: number | null = null;
  for (const s of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(totpStep(s, key)), Buffer.from(code)) && hit === null) hit = s;
  }
  return hit;
}
