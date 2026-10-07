let cached: string | undefined;

/**
 * The WebGL renderer string ("ANGLE (Intel, Intel(R) Arc(TM) 140T GPU ...)"),
 * read once off a throwaway context that is released straight away. Empty when
 * there is no WebGL, which `presetForRenderer` reads as unknown.
 */
export function gpuRenderer(): string {
  if (cached !== undefined) return cached;
  cached = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (!gl) return cached;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    cached = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* no DOM or no GL: unknown GPU */
  }
  return cached;
}
