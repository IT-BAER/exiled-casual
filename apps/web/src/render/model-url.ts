/**
 * A model's URL with its content version (`vite.config.ts` hashes each file in
 * public/models at build time).
 *
 * The files keep their names across deploys, and the service worker answers a
 * stable name from its cache first: after 0.7.6 the new code met last release's
 * `wardrobe-female.glb`, asked for Maren's gown and hair, found neither, and hid
 * her body under them. A new hash is a new URL, which no cache can answer stale.
 */
export function modelUrl(path: string): string {
  const v = (import.meta.env?.VITE_MODEL_VERSIONS as Record<string, string> | undefined)?.[path.split("/").pop() ?? ""];
  return v ? `${path}?v=${v}` : path;
}
