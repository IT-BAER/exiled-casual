/**
 * The air in the room.
 *
 * A static matte painting behind a static button column is a screenshot, not a
 * menu — the eye settles on it in half a second and then there is nothing left
 * to look at. These layers exist so the hall keeps moving without ever asking
 * for attention: fog drifts across it, dust turns in the light, the braziers
 * breathe, and the whole thing leans a few pixels against the pointer.
 *
 * Everything here is cheap by construction. The dust is one canvas of ~80
 * specks; the fog is one tiling sheet translated at two speeds; the flicker is
 * two sines that do not share a period, so it never lands on a beat the eye can
 * count. Nothing here is on the sim's clock and nothing here is saved.
 */
import React from "react";
import { MENU_ART } from "./frames";

/** Where the pointer is, as -1..1 from the centre. Drives every parallax layer. */
export function usePointerLean(): { x: number; y: number } {
  const [lean, setLean] = React.useState({ x: 0, y: 0 });
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      setLean({ x: (e.clientX / w) * 2 - 1, y: (e.clientY / h) * 2 - 1 });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
  return lean;
}

/**
 * The matte painting, leaning against the pointer.
 *
 * Scaled up a touch so the lean never exposes an edge: translate a
 * `background-size: cover` image by 8px and you get an 8px seam of nothing
 * unless it was already oversized.
 */
export function Backdrop({
  src,
  lean,
  strength = 8,
}: {
  src: string;
  lean: { x: number; y: number };
  strength?: number;
}): React.ReactElement {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: -strength * 2,
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        transform: `translate(${-lean.x * strength}px, ${-lean.y * strength * 0.5}px)`,
        transition: "transform 220ms cubic-bezier(0.22,1,0.36,1)",
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
export function Fog({ lean }: { lean: { x: number; y: number } }): React.ReactElement {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>{FOG_KEYFRAMES}</style>
      <div
        style={{
          position: "absolute",
          inset: "-20%",
          backgroundImage: `url(${MENU_ART}/fog_sheet.png)`,
          backgroundRepeat: "repeat",
          backgroundSize: "56% auto",
          mixBlendMode: "screen",
          opacity: 0.26,
          animation: "menu-fog-far 121s linear infinite",
          transform: `translateX(${-lean.x * 14}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-30%",
          backgroundImage: `url(${MENU_ART}/fog_sheet.png)`,
          backgroundRepeat: "repeat",
          backgroundSize: "104% auto",
          mixBlendMode: "screen",
          opacity: 0.16,
          animation: "menu-fog-near 67s linear infinite reverse",
          transform: `translateX(${-lean.x * 30}px)`,
        }}
      />
    </div>
  );
}

const FOG_KEYFRAMES = `
@keyframes menu-fog-far  { from { background-position: 0 0; }   to { background-position: 1000px -60px; } }
@keyframes menu-fog-near { from { background-position: 0 0; }   to { background-position: 1400px 40px; } }
@media (prefers-reduced-motion: reduce) {
  [data-atmos] * { animation: none !important; }
}
`;

/**
 * Warm light over the braziers the backdrop already has painted in it.
 *
 * Positions are fractions of the viewport, tuned per backdrop, because the
 * glow has to sit on the fire that is in THAT painting — a flicker two hundred
 * pixels from its flame is a lamp with no bulb.
 */
export interface BrazierSpot {
  /** 0..1 across the viewport. */
  x: number;
  /** 0..1 down the viewport. */
  y: number;
  /** Radius as a fraction of viewport width. */
  r: number;
  /** Phase offset in seconds, so two braziers never pulse together. */
  phase: number;
}

export function Braziers({ spots }: { spots: readonly BrazierSpot[] }): React.ReactElement {
  const t = useClock();
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "screen" }}>
      {spots.map((s, i) => {
        // Two sines whose periods share no small common multiple: the flame
        // never repeats on a count, which is what separates fire from a blinker.
        const p = t + s.phase;
        const flicker = 0.72 + 0.2 * Math.sin(p * 5.3) + 0.1 * Math.sin(p * 2.11 + 1.7);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${s.x * 100}%`,
              top: `${s.y * 100}%`,
              width: `${s.r * 200}vw`,
              height: `${s.r * 200}vw`,
              marginLeft: `${-s.r * 100}vw`,
              marginTop: `${-s.r * 100}vw`,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,158,66,0.34) 0%, rgba(217,118,47,0.16) 34%, rgba(120,50,10,0.05) 62%, transparent 74%)",
              opacity: flicker,
            }}
          />
        );
      })}
    </div>
  );
}

/** Seconds since mount, ticked on rAF. Paused by the browser when the tab is hidden. */
function useClock(): number {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
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
      rise: 3 + rnd() * 9,          // px/s upward
      swayAmp: 4 + rnd() * 16,
      swayHz: 0.05 + rnd() * 0.15,
      phase: rnd() * Math.PI * 2,
      alpha: 0.08 + rnd() * 0.3,
    }));

    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        // Wrap in normalised space so a resize never strands a mote off-screen.
        const y = ((m.y - (t * m.rise) / Math.max(h, 1)) % 1 + 1) % 1;
        const x = m.x * w + Math.sin(t * m.swayHz * Math.PI * 2 + m.phase) * m.swayAmp;
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
 * Takes no children on purpose. The pointer lean and the flicker clock live in
 * here and change every frame the pointer moves; anything rendered as a child
 * would re-render with them, and the 3D stage is one of the things that would
 * have been a child. Screens draw this as a sibling behind their own UI.
 */
export function Atmosphere({
  backdrop,
  braziers,
}: {
  backdrop: string;
  braziers: readonly BrazierSpot[];
}): React.ReactElement {
  const lean = usePointerLean();
  return (
    <div
      data-atmos
      data-testid="menu-atmosphere"
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#05060a", zIndex: 0 }}
    >
      <Backdrop src={backdrop} lean={lean} />
      <Fog lean={lean} />
      <Braziers spots={braziers} />
      <Dust />
      <Vignette />
    </div>
  );
}
