// Deterministic, integer-only PRNG (Mulberry32) with named streams.
// Named streams derive independent state from a master seed so loot, movement,
// AI, etc. never share a sequence. Draw count (ordinal) is recorded for audit.

export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface RandomStream {
  nextU32(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
  ordinal(): number;
}

export function createStream(masterSeed: number, name: string): RandomStream {
  let state = (masterSeed ^ fnv1a32(name)) >>> 0;
  let count = 0;

  const nextU32 = (): number => {
    count++;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  // ponytail: modulo introduces negligible bias for small ranges; replace with
  // rejection sampling only if a fairness-sensitive system needs it.
  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + (nextU32() % span);
  };

  return { nextU32, nextInt, ordinal: () => count };
}
