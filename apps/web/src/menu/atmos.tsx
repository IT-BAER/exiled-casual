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
 * specks; the fog is one tiling sheet translated at two speeds; the fire is one
 * canvas of a few dozen embers per brazier. Nothing here is on the sim's clock
 * and nothing here is saved.
 */
import React from "react";
import { MENU_ART } from "./frames";

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
          backgroundImage: `url(${MENU_ART}/fog_sheet.png)`,
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
          backgroundImage: `url(${MENU_ART}/fog_sheet.png)`,
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
 * Live embers per brazier, and how wide each one is against the flame's height.
 *
 * These two trade against each other and only one pairing looks like fire. Few
 * and fat (44 at 0.20) is a cluster of orange bubbles: every particle is legible
 * as a disc, and a flame is never legible as anything. Many and thin, each one
 * faint enough that only the pile-up is bright, is a tongue.
 */
const EMBERS = 120;
const EMBER_WIDTH = 0.1;
/**
 * The sparks that leave the flame altogether.
 *
 * A fire is two populations, not one: the body of it, which is the parcels of
 * burning gas above, and the few specks that break off the top and travel until
 * they cool. The body alone reads as a lamp with a shape. These are deliberately
 * few, small and slow — a dozen per bowl, rising two flame-heights, drifting
 * sideways as they go out.
 */
const SPARKS = 14;
const SPARK_RISE = 2.4;
/** Embers are drawn as ellipses this much taller than wide: rising stretches a
 *  parcel of flame vertically, and round ones read as sparks instead. */
const EMBER_STRETCH = 2.1;

/** Colour of an ember at `u` of its life, white-hot at the bowl to soot at the tip. */
function emberColour(u: number): [number, number, number] {
  if (u < 0.22) {
    const k = u / 0.22;
    return [255, 246 - 60 * k, 214 - 96 * k];
  }
  if (u < 0.6) {
    const k = (u - 0.22) / 0.38;
    return [255, 186 - 70 * k, 118 - 90 * k];
  }
  const k = (u - 0.6) / 0.4;
  return [255 - 80 * k, 116 - 76 * k, 28 - 20 * k];
}

/**
 * A real flame, drawn rather than pulsed.
 *
 * The braziers used to be a radial gradient with two sines on its opacity, and
 * a breathing circle is not fire: the eye reads the glow of a fire long before
 * it reads the shape, but it only believes the fire once something is moving
 * UPWARD out of the bowl. So the glow stays, and embers now climb out of it —
 * born wide and white-hot at the lip, drawn inward and cooling as they rise,
 * gone by the top of the flame.
 *
 * One canvas for every brazier on the screen, additively blended, which is what
 * fire does to whatever is behind it. It sits ON the painted flame rather than
 * replacing it: the painting supplies the bowl and the coals, this supplies the
 * only part of a fire that was ever going to look wrong standing still.
 */
export function Braziers({
  spots,
  backdrop,
}: {
  spots: readonly BrazierSpot[];
  backdrop: string;
}): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

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

    // Seeded: the fire is decorative, but a deterministic one renders the same
    // in a captured frame twice running, which is the difference between a
    // devlog shot you can retake and one you cannot.
    let seed = 0x6d2b79f5;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    /** Each ember carries its whole trajectory, so a frame is a pure function of `t`. */
    const embers = spots.map((_, i) =>
      Array.from({ length: EMBERS }, (_, k) => ({
        // Spread births evenly over one lifetime, or the flame pulses as a whole
        // cohort dies together.
        born: (k / EMBERS) * 0.8 + i * 0.13,
        // Slower than it was (0.42 + up to 0.5): a parcel of flame that lives
        // twice as long climbs at half the pace for the same height, and the
        // eye reads the pace, not the particle.
        life: 0.95 + rnd() * 0.8,
        lane: rnd() * 2 - 1, // -1..1 across the bowl's lip
        sway: rnd() * Math.PI * 2,
        size: 0.7 + rnd() * 0.6,
        lean: (rnd() * 2 - 1) * 0.35,
      })),
    );

    /** The specks that leave the top. Same shape as an ember, longer lived. */
    const sparks = spots.map((_, i) =>
      Array.from({ length: SPARKS }, (_, k) => ({
        born: (k / SPARKS) * 1.6 + i * 0.21,
        life: 1.7 + rnd() * 1.6,
        lane: rnd() * 2 - 1,
        sway: rnd() * Math.PI * 2,
        drift: (rnd() * 2 - 1) * 0.5,
        size: 0.5 + rnd() * 0.7,
        twinkle: 6 + rnd() * 7,
      })),
    );

    let raf = 0;
    const draw = (now: number) => {
      // Shared clock again: a fire that restarts on a navigation is a fire that
      // gutters exactly when the screen changes.
      const t = still ? 1.7 : (now - MENU_CLOCK_START) / 1000;
      ctx.clearRect(0, 0, w, h);
      const fit = cover();
      if (!fit) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.globalCompositeOperation = "lighter";

      for (const [i, s] of spots.entries()) {
        const p = t + s.phase;
        // Two sines whose periods share no small common multiple: the light
        // never repeats on a count, which is what separates fire from a blinker.
        // Slower than it was (5.3 and 2.11): a real fire breathes at a couple of
        // hertz and only its sparks are quick. Still two periods with no small
        // common multiple, so the light never repeats on a count.
        const flicker = 0.72 + 0.2 * Math.sin(p * 3.1) + 0.1 * Math.sin(p * 1.27 + 1.7);
        const cx = fit.ox + s.x * fit.dw;
        const cy = fit.oy + s.y * fit.dh;
        const glow = s.r * fit.dw;
        const flame = (s.flame ?? s.r * FLAME_OF_GLOW) * fit.dw;

        // The light the fire throws. Same falloff the CSS gradient had.
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

        for (const e of embers[i]!) {
          const u = (((t - e.born) / e.life) % 1 + 1) % 1;
          // Fast off the coals, slowing as it cools and spreads.
          const rise = u * (1.55 - 0.55 * u);
          const y = base - flame * rise;
          // Drawn toward the centre line as it climbs: that convergence is the
          // whole silhouette of a flame, and without it this is a smoke plume.
          const x =
            cx +
            e.lane * flame * 0.3 * (1 - u * 0.8) +
            Math.sin(u * 5.5 + e.sway) * flame * 0.07 +
            e.lean * flame * u * 0.25;
          const rad = flame * EMBER_WIDTH * e.size * (1 - 0.3 * u);
          const [r, gg, b] = emberColour(u);
          const a = (1 - u) ** 1.4 * 0.34;
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(1, EMBER_STRETCH);
          const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
          gr.addColorStop(0, `rgba(${r | 0},${gg | 0},${b | 0},${a})`);
          gr.addColorStop(1, `rgba(${r | 0},${(gg * 0.5) | 0},0,0)`);
          ctx.fillStyle = gr;
          ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
          ctx.restore();
        }

        // ...and the few that get away, over the top of the flame.
        for (const k of sparks[i]!) {
          const u = (((t - k.born) / k.life) % 1 + 1) % 1;
          const rise = u * (1.35 - 0.35 * u);
          const y = base - flame * SPARK_RISE * rise;
          const x = cx
            + k.lane * flame * 0.26
            + k.drift * flame * u
            + Math.sin(u * 3.1 + k.sway) * flame * 0.05;
          // A spark is a point of light that gutters, not a parcel that fades:
          // the twinkle is the whole reason it reads as a spark and not as dust.
          const gutter = 0.55 + 0.45 * Math.sin(t * k.twinkle + k.sway);
          const a = (1 - u) ** 2 * 0.5 * gutter;
          const rad = flame * 0.013 * k.size * (1 - 0.35 * u);
          const [r, gg, b] = emberColour(Math.min(1, 0.35 + u * 0.65));
          const gr = ctx.createRadialGradient(x, y, 0, x, y, rad * 3);
          gr.addColorStop(0, `rgba(${r | 0},${gg | 0},${b | 0},${a})`);
          gr.addColorStop(1, `rgba(${r | 0},${(gg * 0.4) | 0},0,0)`);
          ctx.fillStyle = gr;
          ctx.fillRect(x - rad * 3, y - rad * 3, rad * 6, rad * 6);
        }
      }

      ctx.globalCompositeOperation = "source-over";
      if (still) return; // one frame, then hold it
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [spots, backdrop]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      data-testid="menu-braziers"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        mixBlendMode: "screen",
      }}
    />
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
