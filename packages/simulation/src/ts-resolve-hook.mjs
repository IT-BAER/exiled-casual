// Node strips types but resolves like Node: the sources import `./x` and `./x.js` for
// `x.ts`, which only Vite understands. This module hook tries the .ts file beside them.
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx);
  } catch (e) {
    if (!spec.startsWith(".") || e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    const base = spec.endsWith(".js") ? spec.slice(0, -3) : spec;
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try { return await next(base + ext, ctx); } catch { /* next candidate */ }
    }
    throw e;
  }
}
