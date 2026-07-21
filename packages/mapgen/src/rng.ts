// Deterministic, integer-only PRNG (Mulberry32) + FNV-1a hash.
// Copied from @pact/simulation rather than imported: @pact/simulation will
// depend on @pact/mapgen (Phase C4), so a back-dependency here would be circular.
// Keep the two copies behaviourally identical — they are both determinism-critical.

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
}

export function createStream(masterSeed: number, name: string): RandomStream {
  let state = (masterSeed ^ fnv1a32(name)) >>> 0;

  const nextU32 = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  // ponytail: modulo bias is negligible for these small ranges.
  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + (nextU32() % span);
  };

  return { nextU32, nextInt };
}
