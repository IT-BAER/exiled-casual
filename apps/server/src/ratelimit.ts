/** Token bucket per key: `capacity` burst, refilled at `perMs` tokens per millisecond. */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();
  constructor(
    private readonly capacity: number,
    private readonly perMs: number,
    private readonly now: () => number,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: t };
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.last) * this.perMs);
    b.last = t;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Drops buckets that have refilled completely, so idle keys do not accumulate. */
  prune(): void {
    const t = this.now();
    for (const [k, b] of this.buckets) {
      if (b.tokens + (t - b.last) * this.perMs >= this.capacity) this.buckets.delete(k);
    }
  }
}

/** Failures per key in a sliding window. */
export class FailureWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly now: () => number) {}

  private live(key: string): number[] {
    const cut = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cut);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  blocked(key: string): boolean {
    return this.live(key).length >= this.max;
  }

  fail(key: string): void {
    this.hits.set(key, [...this.live(key), this.now()]);
  }

  /** Takes back the newest failure: a login reserves one before its slow check and returns it on success. */
  forgive(key: string): void {
    const list = this.live(key);
    list.pop();
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
  }

  prune(): void {
    for (const k of [...this.hits.keys()]) this.live(k);
  }
}
