/**
 * A model's URL with its content version (`vite.config.ts` hashes public/models at build).
 * The service worker answers a stable name cache-first, so an unversioned model can be last release's.
 */
export function modelUrl(path: string): string {
  const v = (import.meta.env?.VITE_MODEL_VERSIONS as Record<string, string> | undefined)?.[path.split("/").pop() ?? ""];
  return v ? `${path}?v=${v}` : path;
}
