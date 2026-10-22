// What bodies do to the shallows: rings off every footfall, a bow wave and a
// trailing V behind anything running. Not drawn shapes but a damped 2D wave
// equation, so interference, the V's angle and the bounce off the beach come
// out of the physics. It runs on the CPU over a small window that follows the
// player and goes to the water shader as one RGBA8 texture; asleep, it costs
// nothing at all.
import type { Shoreline } from "@exiled/mapgen";

/** Cells per side of the window, and metres per cell: 20 m, the camera's width. */
export const WAKE_CELLS = 160;
export const WAKE_CELL = 0.125;
/** Metres per second: sqrt(g * depth) for water ten to twenty-five centimetres deep. */
export const WAKE_SPEED = 1.5;

const STEP = 1 / 60;
/** Share of the surface's velocity kept per step: a ring is gone in about two seconds. */
const DAMP = 0.985;
/** The window's edge is not a wall: rings fade out over this many cells and
 *  never come back, down to this share kept per step at the very border. */
const SPONGE_CELLS = 16;
const SPONGE_FLOOR = 0.82;

function sponge(): Float32Array {
  const N = WAKE_CELLS;
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const edge = Math.min(i, j, N - 1 - i, N - 1 - j);
      const t = Math.min(1, edge / SPONGE_CELLS);
      out[j * N + i] = SPONGE_FLOOR + (1 - SPONGE_FLOOR) * t * t * (3 - 2 * t);
    }
  return out;
}

/** Below this everywhere (metres; a tenth of one packed step), the surface is at
 *  rest and the field stops. */
const REST = 1e-4;

/** Packed ranges: metres of height and units of slope at a byte's full swing.
 *  The shader decodes with the same numbers. */
export const WAKE_HEIGHT_RANGE = 0.06;
export const WAKE_SLOPE_RANGE = 0.6;
/** Foam: share kept per step, and how fast the surface must move (m per step)
 *  before it breaks white at all. A ripple never foams; a bow wave does. */
const FOAM_KEEP = 0.965;
const FOAM_FROM = 0.0012;
const FOAM_GAIN = 60;

/** How far inland the last wash reaches (the sea strip's first band): sand past
 *  it never carries water, so a wave reflects there. */
const DRY_BEYOND = -2.4;

/** Metres out to sea from the shore curve at a world point; negative inland.
 *  World z is the generator's y. */
export function seaDepth(shore: Shoreline, x: number, z: number): number {
  const a = shore.along === "x" ? x : z;
  const c = shore.along === "x" ? z : x;
  const n = shore.cross.length;
  const t = Math.min(n - 1, Math.max(0, (a - shore.start) / shore.step));
  const i = Math.min(n - 2, Math.floor(t));
  const line = shore.cross[i]! + (shore.cross[i + 1]! - shore.cross[i]!) * (t - i);
  return (c - line) * shore.seaSide;
}

export class WakeField {
  /** World x/z of cell (0, 0)'s lower corner. */
  originX = 0;
  originZ = 0;
  private cur: Float32Array = new Float32Array(WAKE_CELLS * WAKE_CELLS);
  private prev: Float32Array = new Float32Array(WAKE_CELLS * WAKE_CELLS);
  private foam: Float32Array = new Float32Array(WAKE_CELLS * WAKE_CELLS);
  private readonly sponge = sponge();
  private scratch: Float32Array = new Float32Array(WAKE_CELLS * WAKE_CELLS);
  /** The last upload was the field at rest. */
  private packedRest = true;
  /** 1 where the cell is beach the water never reaches; held at rest. */
  private dry = new Uint8Array(WAKE_CELLS * WAKE_CELLS);
  private shore: Shoreline | null = null;
  private acc = 0;
  private stirred = false;
  /** Nothing moving and nothing stirring it: no steps, nothing to upload. */
  asleep = true;

  /** Centre the window on a world point. The window moves in whole cells and
   *  its contents move the other way, so a ring stays where it was made. */
  follow(x: number, z: number): void {
    const half = (WAKE_CELLS / 2) * WAKE_CELL;
    const ox = Math.floor(x / WAKE_CELL) * WAKE_CELL - half;
    const oz = Math.floor(z / WAKE_CELL) * WAKE_CELL - half;
    const di = Math.round((ox - this.originX) / WAKE_CELL);
    const dj = Math.round((oz - this.originZ) / WAKE_CELL);
    this.originX = ox;
    this.originZ = oz;
    if (di === 0 && dj === 0) return;
    this.markDry();
    if (this.asleep) return;
    this.cur = this.shift(this.cur, di, dj);
    this.prev = this.shift(this.prev, di, dj);
    this.foam = this.shift(this.foam, di, dj);
  }

  /** The coast this field lies off; null for open water everywhere. */
  setShore(shore: Shoreline | null): void {
    this.shore = shore;
    this.markDry();
  }

  private markDry(): void {
    const N = WAKE_CELLS;
    const shore = this.shore;
    if (!shore) {
      this.dry.fill(0);
      return;
    }
    for (let j = 0; j < N; j++) {
      const z = this.originZ + (j + 0.5) * WAKE_CELL;
      for (let i = 0; i < N; i++)
        this.dry[j * N + i] = seaDepth(shore, this.originX + (i + 0.5) * WAKE_CELL, z) < DRY_BEYOND ? 1 : 0;
    }
  }

  /** `src` with cell (i + di, j + dj) moved to (i, j); returns the old scratch. */
  private shift(src: Float32Array, di: number, dj: number): Float32Array {
    const N = WAKE_CELLS;
    const out = this.scratch;
    out.fill(0);
    const i0 = Math.max(0, -di), i1 = Math.min(N, N - di);
    if (i0 < i1)
      for (let j = Math.max(0, -dj); j < Math.min(N, N - dj); j++)
        out.set(src.subarray((j + dj) * N + i0 + di, (j + dj) * N + i1 + di), j * N + i0);
    this.scratch = src;
    return out;
  }

  /** Raise (or with a negative amount, press down) the surface at a point, inside
   *  a trough that holds the same volume: water is moved, never added, so a long
   *  wade cannot lift the whole window. */
  push(x: number, z: number, radius: number, amount: number): void {
    const N = WAKE_CELLS;
    const ci = (x - this.originX) / WAKE_CELL - 0.5;
    const cj = (z - this.originZ) / WAKE_CELL - 0.5;
    const reach = Math.ceil((radius * 2.5) / WAKE_CELL);
    const inv = 1 / (radius * radius);
    for (let j = Math.max(1, Math.floor(cj) - reach); j <= Math.min(N - 2, Math.ceil(cj) + reach); j++)
      for (let i = Math.max(1, Math.floor(ci) - reach); i <= Math.min(N - 2, Math.ceil(ci) + reach); i++) {
        const dx = (i - ci) * WAKE_CELL, dz = (j - cj) * WAKE_CELL;
        if (this.dry[j * N + i]) continue;
        const q = (dx * dx + dz * dz) * inv;
        const w = amount * (1 - q) * Math.exp(-q);
        this.stirred = true;
        this.asleep = false;
        // Into both time levels: a displacement at rest, not a kick.
        const o = j * N + i;
        this.cur[o] = this.cur[o]! + w;
        this.prev[o] = this.prev[o]! + w;
      }
  }

  /** Advance by `dt` seconds in fixed steps. */
  step(dt: number): void {
    if (this.asleep) return;
    this.acc += dt;
    while (this.acc >= STEP && !this.asleep) {
      this.acc -= STEP;
      this.tick();
    }
  }

  /** Surface height at a world point, metres from rest. */
  height(x: number, z: number): number {
    const N = WAKE_CELLS;
    const fx = (x - this.originX) / WAKE_CELL - 0.5;
    const fz = (z - this.originZ) / WAKE_CELL - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return 0;
    const u = fx - i, v = fz - j;
    const c = this.cur;
    const a = c[j * N + i]! + (c[j * N + i + 1]! - c[j * N + i]!) * u;
    const b = c[(j + 1) * N + i]! + (c[(j + 1) * N + i + 1]! - c[(j + 1) * N + i]!) * u;
    return a + (b - a) * v;
  }

  /**
   * Write the field as RGBA8, row j = world z, column i = world x: height,
   * slope along x, slope along z (128 is zero), foam. Returns false when the
   * texture already holds this, so the caller can skip the upload.
   */
  pack(out: Uint8Array): boolean {
    if (this.asleep) {
      if (this.packedRest) return false;
      for (let k = 0; k < out.length; k += 4) {
        out[k] = out[k + 1] = out[k + 2] = 128;
        out[k + 3] = 0;
      }
      this.packedRest = true;
      return true;
    }
    this.packedRest = false;
    const N = WAKE_CELLS;
    const c = this.cur;
    const hs = 127 / WAKE_HEIGHT_RANGE;
    const ss = 127 / (WAKE_SLOPE_RANGE * 2 * WAKE_CELL);
    const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(128 + v)));
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const o = j * N + i;
        const k = o * 4;
        out[k] = byte(c[o]! * hs);
        out[k + 1] = i > 0 && i < N - 1 ? byte((c[o + 1]! - c[o - 1]!) * ss) : 128;
        out[k + 2] = j > 0 && j < N - 1 ? byte((c[o + N]! - c[o - N]!) * ss) : 128;
        out[k + 3] = Math.round(this.foam[o]! * 255);
      }
    return true;
  }

  private tick(): void {
    const N = WAKE_CELLS;
    const k = (WAKE_SPEED * STEP / WAKE_CELL) ** 2;
    const c = this.cur, p = this.prev;
    let peak = 0;
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        const o = j * N + i;
        if (this.dry[o]) {
          p[o] = 0;
          continue;
        }
        const h = c[o]!;
        const lap = c[o - 1]! + c[o + 1]! + c[o - N]! + c[o + N]! - 4 * h;
        // The previous level's buffer takes the next level: it is read only here.
        const n = (h + (h - p[o]!) * DAMP + k * lap) * this.sponge[o]!;
        p[o] = n;
        const churn = Math.abs(n - h) - FOAM_FROM;
        this.foam[o] = Math.min(1, this.foam[o]! * FOAM_KEEP + (churn > 0 ? churn * FOAM_GAIN : 0));
        peak = Math.max(peak, Math.abs(n), Math.abs(n - h));
      }
    this.cur = p;
    this.prev = c;
    if (peak < REST && !this.stirred) {
      this.cur.fill(0);
      this.prev.fill(0);
      this.foam.fill(0);
      this.acc = 0;
      this.asleep = true;
    }
    this.stirred = false;
  }
}

/** A body that can wade: the player or a monster, at its drawn position. */
export interface WakeBody {
  id: number;
  x: number;
  z: number;
  radius: number;
  player: boolean;
}

/** A foot coming down in water, for the splash the renderer throws. */
export interface Footfall {
  x: number;
  z: number;
  /** Metres out to sea: below zero it is the thin sheet of the last wash. */
  depth: number;
  /** Unit heading and speed (m/s) of the body it belongs to. */
  dirX: number;
  dirZ: number;
  speed: number;
  player: boolean;
}

/** Bodies landward of this (m) never touch water; seaward of the next, full depth. */
const WADE_FROM = DRY_BEYOND;
const WADE_FULL = 0.5;
/** Further than this in one frame is a portal or a respawn, not a stride. */
const JUMP = 2;
/** Depth of the trough a moving body drags along, per m/s of speed per second. */
const DRAG = 0.06;
/** Depth of the crater one foot punches, metres, and its radius. */
const STEP_DEPTH = 0.012;
const STEP_RADIUS = 0.12;

/** Feeds a WakeField from the bodies standing in it, one call per frame. */
export class WakeStirrer {
  private readonly last = new Map<number, { x: number; z: number; walked: number; left: boolean }>();

  constructor(private readonly field: WakeField, private readonly shore: Shoreline) {}

  /** Stir for this frame; `out` is cleared and receives the feet that came down in water. */
  stir(bodies: readonly WakeBody[], dt: number, out: Footfall[]): void {
    out.length = 0;
    const seen = new Set<number>();
    for (const b of bodies) {
      seen.add(b.id);
      const was = this.last.get(b.id);
      if (!was) {
        this.last.set(b.id, { x: b.x, z: b.z, walked: 0, left: false });
        continue;
      }
      const dx = b.x - was.x, dz = b.z - was.z;
      const moved = Math.hypot(dx, dz);
      was.x = b.x;
      was.z = b.z;
      if (moved > JUMP) {
        was.walked = 0;
        continue;
      }
      const depth = seaDepth(this.shore, b.x, b.z);
      if (depth < WADE_FROM || moved < 1e-4 || dt <= 0) continue;
      const t = Math.min(1, (depth - WADE_FROM) / (WADE_FULL - WADE_FROM));
      const wet = t * t * (3 - 2 * t);
      const speed = moved / dt;
      // A moving body is a moving trough: the bow wave and the V behind it are
      // what the wave equation makes of that, not something drawn.
      this.field.push(b.x, b.z, b.radius * 0.8, -DRAG * speed * dt * wet);
      was.walked += moved;
      const stride = Math.max(0.6, b.radius * 2.4);
      if (was.walked < stride) continue;
      was.walked -= stride;
      was.left = !was.left;
      const ux = dx / moved, uz = dz / moved;
      const side = (was.left ? 1 : -1) * b.radius * 0.4;
      const fx = b.x - uz * side, fz = b.z + ux * side;
      this.field.push(fx, fz, STEP_RADIUS, -STEP_DEPTH * wet);
      out.push({ x: fx, z: fz, depth, dirX: ux, dirZ: uz, speed, player: b.player });
    }
    for (const id of this.last.keys()) if (!seen.has(id)) this.last.delete(id);
  }
}
