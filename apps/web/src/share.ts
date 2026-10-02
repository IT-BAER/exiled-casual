/**
 * Structural sharing: `next`, but every branch deep-equal to the same branch of
 * `prev` is `prev`'s object. A snapshot crosses `postMessage` as a fresh clone,
 * so without this no `memo` can ever see an unchanged prop.
 */
export function share<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const out = (Array.isArray(next) ? [] : {}) as Record<string, unknown>;
  let same = Object.keys(p).length === Object.keys(n).length;
  for (const k of Object.keys(n)) {
    out[k] = share(p[k], n[k]);
    if (out[k] !== p[k] || !(k in p)) same = false;
  }
  return same ? prev : (out as T);
}
