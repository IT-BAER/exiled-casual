import React from "react";

/** Panel enter/exit. Short enough that a key spammed open-shut never queues. */
const PANEL_MS = 140;
/** The black lifted off a new menu screen. */
const SCREEN_MS = 200;
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
// `scale`, not `transform`: it composes with a panel's own translate(-50%) centring.
const SHOWN: Keyframe = { opacity: 1, scale: "1" };
const HIDDEN: Keyframe = { opacity: 0, scale: "0.96" };

function stillMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Animates every direct child of `host`; null where there is nothing to animate with. */
function animateChildren(host: HTMLElement | null, frames: Keyframe[], fill: FillMode): Animation[] | null {
  const els = host ? (Array.from(host.children) as HTMLElement[]) : [];
  if (els.length === 0 || typeof els[0]!.animate !== "function" || stillMotion()) return null;
  return els.map((el) => el.animate(frames, { duration: PANEL_MS, easing: EASE_OUT, fill }));
}

/**
 * Mounts `children` while `open`, fading and scaling them in, and keeps the last
 * open render on screen, inert, until the fade out finishes. The wrapper is
 * `display: contents`, so panels keep positioning against the same parent.
 */
export function Presence({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement | null {
  const [shown, setShown] = React.useState(open);
  if (open && !shown) setShown(true);
  const last = React.useRef(children);
  if (open) last.current = children;
  const host = React.useRef<HTMLDivElement>(null);
  const running = React.useRef<Animation[]>([]);
  const epoch = React.useRef(0);
  const shownRef = React.useRef(shown);
  shownRef.current = shown;

  React.useLayoutEffect(() => {
    const mine = ++epoch.current;
    for (const a of running.current) a.cancel();
    running.current = [];
    if (open) {
      running.current = animateChildren(host.current, [HIDDEN, SHOWN], "none") ?? [];
      return;
    }
    if (!shownRef.current) return;
    const out = animateChildren(host.current, [SHOWN, HIDDEN], "forwards");
    if (!out) {
      setShown(false);
      return;
    }
    running.current = out;
    void Promise.all(out.map((a) => a.finished)).then(
      () => { if (epoch.current === mine) setShown(false); },
      () => {},
    );
  }, [open]);

  if (!shown) return null;
  return (
    <div ref={host} style={{ display: "contents" }} inert={!open}>
      {open ? children : last.current}
    </div>
  );
}

/** A black veil lifted off each new screen, so the router never hard-cuts. */
export function ScreenFade({ screen }: { screen: string }): React.ReactElement {
  const veil = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = veil.current;
    if (!el || typeof el.animate !== "function" || stillMotion()) return;
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SCREEN_MS, easing: "ease-out", fill: "forwards" });
    return () => a.cancel();
  }, [screen]);
  return (
    <div
      ref={veil}
      aria-hidden
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#000", opacity: 0, pointerEvents: "none" }}
    />
  );
}
