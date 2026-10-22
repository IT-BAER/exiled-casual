/**
 * The air in the room.
 *
 * A static matte painting behind a static button column is a screenshot, not a
 * menu — the eye settles on it in half a second and then there is nothing left
 * to look at. These layers exist so the hall keeps moving without ever asking
 * for attention: fog drifts across it, dust turns in the light, and the braziers
 * burn.
 *
 * What it deliberately does NOT do is move with the pointer. Every layer here
 * used to lean a few pixels against the mouse; it looked like a parallax and
 * felt like a wobble, because a hall painted from one fixed viewpoint cannot
 * actually be looked around, and sliding it only ever slides the painting.
 * A menu is a place you stand in, not a thing you tilt.
 *
 * Everything here is cheap by construction. The dust is one canvas of ~80
 * specks; the fog is one tiling sheet translated at two speeds; the fire is the
 * game's flame on one small WebGL pass per bowl. Nothing here is on the sim's clock
 * and nothing here is saved.
 */
import React from "react";
import { MENU_ART } from "./frames";
import {
  COAL_Y,
  FLAME_GLSL,
  FLAME_H,
  SPARKS,
  TONGUE_BRIGHT,
  TONGUE_H,
  TONGUE_W,
  fireFlicker,
  sparkPose,
  sparkRgb,
  sparkTable,
  type SparkPose,
} from "../render/flame-field";

/**
 * One clock for the whole menu, started when the module is first loaded.
 *
 * Every layer here is timed against THIS rather than against its own mount, and
 * that is the whole reason it exists: the menu screens are separate components
 * over the same painting, so opening Credits unmounts one Atmosphere and mounts
 * another. Timed per mount, the fog jumped back to its first frame and the dust
 * teleported to its seeded start — the "abrupt shift" on the Credits click. On a
 * shared clock the air simply carries on behind the new screen.
 */
const MENU_CLOCK_START = typeof performance !== "undefined" ? performance.now() : 0;

function menuElapsed(): number {
  return ((typeof performance !== "undefined" ? performance.now() : 0) - MENU_CLOCK_START) / 1000;
}

/** The matte painting. */
export function Backdrop({ src }: { src: string }): React.ReactElement {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}

/**
 * Two sheets of fog crossing at different speeds.
 *
 * One sheet reads as a moving texture; two at different speeds and scales read
 * as depth, which is the whole trick. Screen blending, so the sheet's black is
 * nothing and only the vapour lands.
 */
export function Fog(): React.ReactElement {
  // Read ONCE per mount: a delay that changed on a re-render would restart the
  // phase, which is the jump this is here to remove.
  const [phase] = React.useState(() => menuElapsed());
  const resume = { animationDelay: `-${phase.toFixed(2)}s` };
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>{FOG_KEYFRAMES}</style>
      <div
        style={{
          position: "absolute",
          inset: "-20%",
          backgroundImage: `url(${MENU_ART}/fog_sheet.webp)`,
          backgroundRepeat: "repeat",
          // Sized in PIXELS, not in a percentage of the element.
          //
          // The loop is only seamless if the sheet travels a whole number of
          // tiles, and with a percentage size the tile is however many pixels
          // the window happens to make it — so the 1000px the keyframe travelled
          // landed mid-tile at nearly every width, and the sheet snapped back at
          // the end of every cycle. A fixed tile also keeps the fog's grain the
          // same on a laptop and on a 4K panel, which is what grain should do.
          backgroundSize: `${FOG_FAR_TILE}px auto`,
          mixBlendMode: "screen",
          opacity: 0.26,
          animation: "menu-fog-far 121s linear infinite",
          ...resume,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-30%",
          backgroundImage: `url(${MENU_ART}/fog_sheet.webp)`,
          backgroundRepeat: "repeat",
          backgroundSize: `${FOG_NEAR_TILE}px auto`,
          mixBlendMode: "screen",
          opacity: 0.16,
          animation: "menu-fog-near 67s linear infinite reverse",
          ...resume,
        }}
      />
    </div>
  );
}

/** Tile size of each sheet, in CSS pixels. The keyframes travel exactly one. */
const FOG_FAR_TILE = 760;
const FOG_NEAR_TILE = 1180;

const FOG_KEYFRAMES = `
@keyframes menu-fog-far  { from { background-position: 0 0; }   to { background-position: ${FOG_FAR_TILE}px 0; } }
@keyframes menu-fog-near { from { background-position: 0 0; }   to { background-position: ${FOG_NEAR_TILE}px 0; } }
@media (prefers-reduced-motion: reduce) {
  [data-atmos] * { animation: none !important; }
}
`;

/**
 * Fire in the braziers the backdrop already has painted in it.
 *
 * Coordinates are fractions of the BACKDROP IMAGE, not of the viewport, and the
 * difference is the whole reliability of this layer. The backdrop is drawn
 * `cover`, so a 16:9 painting in a 21:9 window loses a sixth of its height off
 * the top and the bottom and everything in it slides; anchors measured against
 * the window were right in exactly one window and put the flame on the statue's
 * cheek in any other. Measured against the art they are right everywhere, and
 * measuring them off the art is what one does anyway.
 */
export interface BrazierSpot {
  /** 0..1 across the backdrop image. */
  x: number;
  /** 0..1 down the backdrop image, at the middle of the painted flame. */
  y: number;
  /** Radius of the light it throws, as a fraction of the image's width. */
  r: number;
  /**
   * Height of the drawn flame, as a fraction of the image's width. Defaults to a
   * share of `r`, which is only ever right when the light matches the fire.
   *
   * **Zero means the painting keeps its own fire** and this layer contributes
   * only the flicker. That is the setting for any brazier the art already paints
   * a flame into: a drawn flame over a painted one is two fires in one bowl, and
   * it looks exactly as bad as that sounds. The other way out is to have the art
   * hold nothing but coals, which is what `menu_backdrop` does.
   */
  flame?: number;
  /** Phase offset in seconds, so two braziers never pulse together. */
  phase: number;
}

/**
 * How tall a flame stands when nothing says otherwise, against the radius of the
 * glow around it. Fire is far smaller than the light it throws, and a flame
 * scaled to its own glow covers half the painting.
 */
const FLAME_OF_GLOW = 0.62;
/**
 * How far the painting's eye looks down into the bowls, in radians. The hall is
 * painted from about standing height a few metres off, so the coal bed shows as
 * a thin ellipse: well under the game's 53 degrees.
 */
const PAINTED_TILT = 0.26;
const TILT_SIN = Math.sin(PAINTED_TILT);
const TILT_COS = Math.cos(PAINTED_TILT);
/** The painted bowls are wider for their flame than the game's prop, so the
 *  fire is stretched across to fill their coal beds. */
const BOWL_WIDEN = 1.4;

/**
 * How many colours of the spark ramp get their own pre-rendered dot, and how
 * many pixels one is drawn at. A spark is a `drawImage` of one of these, scaled;
 * every dot is built once per mount, never per spark per frame.
 */
const RAMP_STEPS = 16;
const DOT_PX = 64;

/**
 * The spark, drawn once per colour of the ramp. The falloff is deliberately not
 * linear: a straight ramp reads as a disc with a soft edge, and the steep tail
 * also means the sprite's own square never shows.
 */
function sparkDots(): HTMLCanvasElement[] {
  return Array.from({ length: RAMP_STEPS }, (_, i) => {
    const c = document.createElement("canvas");
    c.width = DOT_PX;
    c.height = DOT_PX;
    const g = c.getContext("2d");
    if (!g) return c;
    const [r, gg, b] = sparkRgb(i / (RAMP_STEPS - 1));
    const half = DOT_PX / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      grad.addColorStop(t, `rgba(${r! | 0},${gg! | 0},${b! | 0},${(1 - t) ** 2.6})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, DOT_PX, DOT_PX);
    return c;
  });
}

/**
 * The game's flame (`render/flame-field.ts`), marched over the painted bowls.
 *
 * The painting's eye is far enough off to call parallel, so every pixel's ray
 * has the same direction and starts on a plane through the coal face; where it
 * enters the flame's box is the slab test, and from there it is the game's march.
 */
const MENU_FLAME_VS = `
  attribute vec2 position;
  void main(void) { gl_Position = vec4(position, 0.0, 1.0); }`;
const MENU_FLAME_FS = `
  precision highp float;
  uniform vec2 uBase;
  uniform float uScale;
  uniform float uTime;
  uniform float uFlick;
  uniform vec3 uRd;
  uniform vec3 uUp;
  ${FLAME_GLSL}
  void main(void) {
    vec2 q = (gl_FragCoord.xy - uBase) / uScale / vec2(${BOWL_WIDEN.toFixed(4)}, 1.0);
    vec3 o = vec3(q.x, ${COAL_Y.toFixed(4)}, 0.0) + uUp * q.y - uRd * 2.0;
    vec3 t0 = (vec3(-HALF_W, 0.0, -HALF_W) - o) / uRd;
    vec3 t1 = (vec3(HALF_W, H, HALF_W) - o) / uRd;
    vec3 lo = min(t0, t1);
    vec3 hi = max(t0, t1);
    float tn = max(max(lo.x, lo.y), lo.z);
    float tf = min(min(hi.x, hi.y), hi.z);
    if (tn > tf) discard;
    vec3 light = marchFlame(o + uRd * tn, uRd, mod(uTime, 600.0)) * ${TONGUE_BRIGHT.toFixed(4)} * uFlick;
    gl_FragColor = vec4(light, max(light.r, max(light.g, light.b)));
  }`;

interface MenuFlame {
  gl: WebGLRenderingContext;
  base: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  flick: WebGLUniformLocation | null;
}

/** Per canvas: StrictMode runs the effect twice on one element, and a second
 *  compile on it would be wasted. */
const compiled = new WeakMap<HTMLCanvasElement, MenuFlame | null>();

/** Compile the march for one canvas, or null where WebGL is missing: the menu
 *  then keeps its glow and sparks and burns no body. */
function menuFlame(canvas: HTMLCanvasElement): MenuFlame | null {
  if (!compiled.has(canvas)) compiled.set(canvas, compileMenuFlame(canvas));
  return compiled.get(canvas)!;
}

function compileMenuFlame(canvas: HTMLCanvasElement): MenuFlame | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("menu flame:", gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, MENU_FLAME_VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, MENU_FLAME_FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  // One triangle over the whole canvas; the scissor cuts it to each bowl.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(prog, "position");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  // A hair of x keeps the slab test off a divide by zero.
  const rd = [1e-4, -TILT_SIN, TILT_COS];
  const n = Math.hypot(rd[0]!, rd[1]!, rd[2]!);
  gl.uniform3f(gl.getUniformLocation(prog, "uRd"), rd[0]! / n, rd[1]! / n, rd[2]! / n);
  gl.uniform3f(gl.getUniformLocation(prog, "uUp"), 0, TILT_COS, TILT_SIN);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.enable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  return {
    gl,
    base: gl.getUniformLocation(prog, "uBase"),
    scale: gl.getUniformLocation(prog, "uScale"),
    time: gl.getUniformLocation(prog, "uTime"),
    flick: gl.getUniformLocation(prog, "uFlick"),
  };
}

/**
 * Fire in the painted braziers: the game's own flame and sparks.
 *
 * Three layers per bowl, all light added onto the painting. The glow the fire
 * throws and the breathing coal bed are 2D gradients; the body of the flame is
 * the game's ray-marched field on a WebGL canvas; the sparks are the game's
 * forty a bowl, projected through the painting's eye. A frame is a pure
 * function of the clock, so the menu fire never restarts on a navigation.
 */
export function Braziers({
  spots,
  backdrop,
}: {
  spots: readonly BrazierSpot[];
  backdrop: string;
}): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const bodyRef = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bodyCanvas = bodyRef.current;
    const body = bodyCanvas ? menuFlame(bodyCanvas) : null;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (body) {
        body.gl.canvas.width = canvas.width;
        body.gl.canvas.height = canvas.height;
      }
    };
    resize();
    window.addEventListener("resize", resize);

    // The same `cover` + `center` the backdrop div is laid out with, solved here
    // so an image fraction becomes a pixel. Until the image reports its size
    // there is nothing honest to draw, so the fire waits — it is already in the
    // cache by then, the backdrop div asked for it first.
    const art = new Image();
    art.src = backdrop;
    /** Image fraction -> canvas pixels, plus the scale one image width covers. */
    const cover = () => {
      const iw = art.naturalWidth;
      const ih = art.naturalHeight;
      if (!iw || !ih) return null;
      const k = Math.max(w / iw, h / ih);
      const dw = iw * k;
      const dh = ih * k;
      return { ox: (w - dw) / 2, oy: (h - dh) / 2, dw, dh };
    };

    const dots = sparkDots();
    const sparks = sparkTable(spots.length);
    const pose: SparkPose = { x: 0, y: 0, z: 0, radius: 0, alpha: 0, u: 0 };

    let raf = 0;
    const draw = (now: number) => {
      // Shared clock again: a fire that restarts on a navigation is a fire that
      // gutters exactly when the screen changes.
      const t = still ? 1.7 : (now - MENU_CLOCK_START) / 1000;
      ctx.clearRect(0, 0, w, h);
      if (body) {
        body.gl.viewport(0, 0, body.gl.canvas.width, body.gl.canvas.height);
        body.gl.scissor(0, 0, body.gl.canvas.width, body.gl.canvas.height);
        body.gl.clear(body.gl.COLOR_BUFFER_BIT);
      }
      const fit = cover();
      if (!fit) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.globalCompositeOperation = "lighter";

      for (const [i, s] of spots.entries()) {
        const p = t + s.phase;
        const flicker = fireFlicker(p);
        const cx = fit.ox + s.x * fit.dw;
        const cy = fit.oy + s.y * fit.dh;
        const glow = s.r * fit.dw;
        const flame = (s.flame ?? s.r * FLAME_OF_GLOW) * fit.dw;

        // The light the fire throws.
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow);
        g.addColorStop(0, `rgba(255,158,66,${0.34 * flicker})`);
        g.addColorStop(0.34, `rgba(217,118,47,${0.16 * flicker})`);
        g.addColorStop(0.62, `rgba(120,50,10,${0.05 * flicker})`);
        g.addColorStop(1, "rgba(120,50,10,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - glow, cy - glow, glow * 2, glow * 2);
        if (flame <= 0) continue; // the painting keeps its own fire

        // The bowl of coals: always lit, only breathing.
        const base = cy + flame * 0.34;
        const coals = ctx.createRadialGradient(cx, base, 0, cx, base, flame * 0.42);
        coals.addColorStop(0, `rgba(255,224,164,${0.4 * flicker})`);
        coals.addColorStop(1, "rgba(255,120,30,0)");
        ctx.fillStyle = coals;
        ctx.fillRect(cx - flame, base - flame, flame * 2, flame * 2);

        // Pixels per metre: the drawn flame height is the game's flame height.
        const scale = flame / FLAME_H;
        if (body) {
          const { gl } = body;
          const half = TONGUE_W * scale * 0.65 * BOWL_WIDEN;
          const top = base - (TONGUE_H * TILT_COS + TONGUE_W * TILT_SIN) * scale;
          const bottom = base + TONGUE_W * TILT_SIN * scale;
          // Framebuffer pixels, y up.
          gl.scissor(
            Math.floor((cx - half) * dpr), Math.floor((h - bottom) * dpr),
            Math.ceil(half * 2 * dpr), Math.ceil((bottom - top) * dpr),
          );
          gl.uniform2f(body.base, cx * dpr, (h - base) * dpr);
          gl.uniform1f(body.scale, scale * dpr);
          gl.uniform1f(body.time, p);
          // Half the light's swing: the body is the steady part of a fire.
          gl.uniform1f(body.flick, 0.5 + 0.5 * flicker);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        for (let k = 0; k < SPARKS; k++) {
          sparkPose(sparks[i * SPARKS + k]!, p, pose);
          const x = cx + pose.x * scale * BOWL_WIDEN;
          // Seen from the painting's eye: height foreshortened, depth lifted.
          const y = base - (pose.y * TILT_COS + pose.z * TILT_SIN) * scale;
          const rad = pose.radius * scale * 3;
          ctx.globalAlpha = pose.alpha;
          ctx.drawImage(dots[Math.round(pose.u * (RAMP_STEPS - 1))]!, x - rad, y - rad, rad * 2, rad * 2);
        }
        ctx.globalAlpha = 1;
      }

      ctx.globalCompositeOperation = "source-over";
      if (still) return; // one frame, then hold it
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      // Screens mount and unmount the fire, and a browser holds only a few
      // contexts. Only once the canvas has left the page: StrictMode's re-run
      // reuses the element, and a lost context composites as white.
      setTimeout(() => {
        if (bodyCanvas && !bodyCanvas.isConnected) body?.gl.getExtension("WEBGL_lose_context")?.loseContext();
      }, 0);
    };
  }, [spots, backdrop]);

  const layer: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    mixBlendMode: "screen",
  };
  return (
    <>
      <canvas ref={bodyRef} aria-hidden style={layer} />
      <canvas ref={ref} aria-hidden data-testid="menu-braziers" style={layer} />
    </>
  );
}

/**
 * Dust turning in the light.
 *
 * Procedural rather than a texture: a tiling dust sheet shows its tile the
 * moment two specks line up, and at this density the canvas is cheaper than the
 * PNG would have been to download.
 */
export function Dust({ count = 80 }: { count?: number }): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Seeded so the field is the same every boot: a menu that reshuffles its
    // dust on every navigation reads as a page reload, not as a room.
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const motes = Array.from({ length: count }, () => ({
      x: rnd(), y: rnd(),
      r: 0.4 + rnd() * 1.5,
      // Signed, and one in three falls.
      //
      // Every speck rising at once is not air, it is a parallax layer: dust in a
      // real room is doing whatever the last person to walk through it left it
      // doing, so some of it settles, some hangs, and only the part near a fire
      // climbs. A third of them fall at about half the speed of the risers,
      // which is what dust does under its own weight.
      rise: (3 + rnd() * 9) * (rnd() < 0.34 ? -0.55 : 1),
      // ...and everything drifts sideways as well, at its own pace and its own
      // direction. The sway below is the wobble on top of this.
      drift: (rnd() * 2 - 1) * 7,
      swayAmp: 4 + rnd() * 16,
      swayHz: 0.05 + rnd() * 0.15,
      phase: rnd() * Math.PI * 2,
      alpha: 0.08 + rnd() * 0.3,
    }));


    let raf = 0;
    const draw = (now: number) => {
      // The shared menu clock, so a navigation does not rewind the dust.
      const t = (now - MENU_CLOCK_START) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        // Wrap in normalised space on BOTH axes so a resize never strands a mote
        // off-screen and a sideways drift never runs out of room.
        const y = ((m.y - (t * m.rise) / Math.max(h, 1)) % 1 + 1) % 1;
        const wrapX = ((m.x + (t * m.drift) / Math.max(w, 1)) % 1 + 1) % 1;
        const x = wrapX * w + Math.sin(t * m.swayHz * Math.PI * 2 + m.phase) * m.swayAmp;
        ctx.globalAlpha = m.alpha * (0.55 + 0.45 * Math.sin(t * 0.7 + m.phase));
        ctx.fillStyle = "#d8e2ea";
        ctx.beginPath();
        ctx.arc(x, y * h, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [count]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", mixBlendMode: "screen" }}
    />
  );
}

/** Vignette and a little grain, so the whole thing sits behind glass rather than on it. */
export function Vignette(): React.ReactElement {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background:
          "radial-gradient(ellipse at 50% 45%, transparent 38%, rgba(0,0,0,0.42) 78%, rgba(0,0,0,0.72) 100%)",
      }}
    />
  );
}

/**
 * The whole atmosphere stack for one screen, in layer order.
 *
 * Takes no children on purpose. The 3D stage is one of the things that would
 * have been a child, and it must not re-render with anything in here. Screens
 * draw this as a sibling behind their own UI.
 */
export function Atmosphere({
  backdrop,
  braziers,
}: {
  backdrop: string;
  braziers: readonly BrazierSpot[];
}): React.ReactElement {
  return (
    <div
      data-atmos
      data-testid="menu-atmosphere"
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#05060a", zIndex: 0 }}
    >
      <Backdrop src={backdrop} />
      <Fog />
      <Braziers spots={braziers} backdrop={backdrop} />
      <Dust />
      <Vignette />
    </div>
  );
}
