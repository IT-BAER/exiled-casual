/**
 * How far the current load has come, in whole percent, from real signals only:
 * bytes of the game's models received (`menu/warm-stage`), the models parsed,
 * the worker's first area, and the share of the scene's meshes whose materials
 * are ready. Never a clock (`docs/09` rule 8): a bar that moves on a timer is a
 * promise the game has not made.
 *
 * A game entry weighs all four; an area change downloads nothing and waits only
 * on its new materials. Within one load the number never goes backwards.
 */
import React from "react";

type Part = "models" | "worker" | "ready";
type Weights = { download: number } & Record<Part, number>;

const ENTRY: Weights = { download: 0.5, models: 0.15, worker: 0.1, ready: 0.25 };
const AREA: Weights = { download: 0, models: 0, worker: 0, ready: 1 };

let downloaded = 0;
let weights = ENTRY;
let parts: Record<Part, number> = { models: 0, worker: 0, ready: 0 };
let shown = 0;
const listeners = new Set<() => void>();

function update(): void {
  const download = parts.models >= 1 ? 1 : downloaded;
  const p = weights.download * download + weights.models * parts.models + weights.worker * parts.worker + weights.ready * parts.ready;
  const next = Math.max(shown, Math.min(100, Math.round(p * 100)));
  if (next === shown) return;
  shown = next;
  for (const l of listeners) l();
}

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/** A new plate goes up: the entry from the roster, or the walk into another area. */
export function beginLoad(kind: "entry" | "area"): void {
  weights = kind === "entry" ? ENTRY : AREA;
  parts = { models: 0, worker: 0, ready: 0 };
  shown = 0;
  for (const l of listeners) l();
  update();
}

/** Share of the game's model bytes received, across page life. */
export function setDownloaded(fraction: number): void {
  downloaded = Math.max(downloaded, clamp(fraction));
  update();
}

export function setLoadPart(part: Part, fraction: number): void {
  parts[part] = clamp(fraction);
  update();
}

export const loadProgress = (): number => shown;

export function subscribeLoadProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useLoadProgress(): number {
  return React.useSyncExternalStore(subscribeLoadProgress, loadProgress, loadProgress);
}

/** Tests only. */
export function resetLoadProgress(): void {
  downloaded = 0;
  weights = ENTRY;
  parts = { models: 0, worker: 0, ready: 0 };
  shown = 0;
}
