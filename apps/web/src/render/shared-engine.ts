/**
 * One canvas, one Engine, one GL context for the page's life.
 *
 * The menu stage, the menu's game warm-up and the game draw on it in turn, so a
 * program linked in the menu is the game's program: Babylon keys its effect cache
 * per engine, and `Effect.PersistentMode` keeps an effect after its scene goes.
 * Two engines meant every first visit compiled the hideout's ~100 programs under
 * the loading plate. Never disposed; a screen moves the canvas into its own host.
 */
import { Engine } from "@babylonjs/core";
import { paceShaderLinks, type LinkPacing } from "./link-pacing";

export interface SharedGl {
  canvas: HTMLCanvasElement;
  engine: Engine;
  links: LinkPacing;
}

let shared: SharedGl | null = null;

export function sharedGl(): SharedGl {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  // Alpha for the menu, whose painted hall shows through; the game clears opaque.
  // The discrete GPU on dual-GPU laptops. Context loss is a reload (GameView), so
  // Babylon's restore bookkeeping is skipped.
  const engine = new Engine(canvas, true, {
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
    doNotHandleContextLost: true,
  });
  // Before any material: first-visit shader finalizes in link order (link-pacing.ts).
  shared = { canvas, engine, links: paceShaderLinks(engine) };
  if (import.meta.env?.DEV) (globalThis as { __sharedGl?: SharedGl }).__sharedGl = shared;
  return shared;
}

let mounts = 0;

/**
 * Puts the shared canvas in `host` and sizes the engine to it. Returns the
 * detach, which does nothing once a later mount has taken the canvas: StrictMode's
 * discarded first stage disposes AFTER the second one mounted.
 */
export function mountSharedCanvas(host: HTMLElement): () => void {
  const { canvas, engine } = sharedGl();
  const mine = ++mounts;
  host.appendChild(canvas);
  engine.resize();
  return () => { if (mounts === mine && canvas.parentElement === host) host.removeChild(canvas); };
}
