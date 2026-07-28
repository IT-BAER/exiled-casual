import React, { useEffect, useRef } from "react";
import type { AreaLayout, WalkableGrid } from "@exiled/mapgen";
import { SERIF } from "./ItemTooltip";

/**
 * Top-right minimap, the instrument that makes the layout variation legible: a
 * player who cannot see the route cannot tell one assembly from another.
 *
 * NOTE: neither `poe2-screenshots/inside-map.jpg` nor `inside-map-battle.webp`
 * has the minimap on screen, so there is no in-repo reference for this one. It
 * follows PoE's own conventions — top-right, translucent, walkable area picked
 * out warm against near-black, unexplored ground hidden — and wants a real
 * reference shot before it is called finished.
 *
 * Drawing is split across three layers so a frame costs three blits and not
 * 12544 fills: the terrain is painted once per area, the fog is an opaque sheet
 * that the player punches holes in, and only the icons are redrawn per frame.
 */

/** Minimap box, a fraction of the viewport as the rest of the HUD is. */
const MAP_VW = 15;
/** World units the player reveals around themselves. */
const REVEAL_RADIUS = 9;
/** Screen pixels per world unit, before the box clamps it. */
const FLOOR = "#c9b48a";
const FLOOR_EDGE = "#6f6047";
const GROUND = "rgba(6,8,12,0.72)";

const ANCHOR_COLOR: Record<string, string> = {
  start: "#6fb2e8",
  boss: "#e05a4a",
  exit: "#63d08a",
};
const REWARD_COLOR = "#e0c060";

function anchorColor(id: string): string {
  if (id.startsWith("reward.")) return REWARD_COLOR;
  return ANCHOR_COLOR[id] ?? "#cfc6b0";
}

/** Paint the walkable cells once. Walls stay transparent so the ground shows. */
function paintTerrain(grid: WalkableGrid): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = grid.cols;
  c.height = grid.rows;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(grid.cols, grid.rows);
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    const walk = grid.cells[i] === 1;
    if (!walk) continue;
    // An edge cell — one with a wall neighbour — is drawn darker, which is what
    // gives the shape a readable outline at this size instead of a warm blob.
    const x = i % grid.cols, y = (i - (i % grid.cols)) / grid.cols;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) { edge = true; break; }
      if (grid.cells[ny * grid.cols + nx] !== 1) { edge = true; break; }
    }
    const hex = edge ? FLOOR_EDGE : FLOOR;
    img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** An opaque sheet the player erases by walking. Same cell resolution as the grid. */
function makeFog(grid: WalkableGrid): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = grid.cols;
  c.height = grid.rows;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

export interface MinimapProps {
  /** Null outside a map — the hideout has no minimap. */
  layout: AreaLayout | null;
  player: { x: number; y: number } | null;
}

export function Minimap({ layout, player }: MinimapProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const fogRef = useRef<HTMLCanvasElement | null>(null);
  // The same reveal, kept as cells so "has the player seen this?" is an array
  // lookup. Asking the fog canvas costs a getImageData per query per frame.
  const seenRef = useRef<Uint8Array | null>(null);
  // Identity of the area the layers belong to. A new area must start fully
  // fogged, or the player inherits the last map's explored shape.
  const builtFor = useRef<number | null>(null);

  const grid = layout?.grid ?? null;

  useEffect(() => {
    if (!grid || !layout) return;
    if (builtFor.current !== layout.hash) {
      terrainRef.current = paintTerrain(grid);
      fogRef.current = makeFog(grid);
      seenRef.current = new Uint8Array(grid.cols * grid.rows);
      builtFor.current = layout.hash;
    }
  }, [grid, layout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid || !layout || !player) return;
    if (builtFor.current !== layout.hash) return;
    const terrain = terrainRef.current, fog = fogRef.current, seen = seenRef.current;
    if (!terrain || !fog || !seen) return;

    // Erase the fog around the player, in cell space, and record the same disc
    // in the seen array so anchor visibility can be answered without a readback.
    const cx = (player.x - grid.originX) / grid.cellSize;
    const cy = (player.y - grid.originY) / grid.cellSize;
    const rCells = REVEAL_RADIUS / grid.cellSize;
    const fogCtx = fog.getContext("2d");
    if (fogCtx) {
      fogCtx.globalCompositeOperation = "destination-out";
      fogCtx.beginPath();
      fogCtx.arc(cx, cy, rCells, 0, Math.PI * 2);
      fogCtx.fill();
      fogCtx.globalCompositeOperation = "source-over";
    }
    const lo = (v: number) => Math.max(0, Math.floor(v - rCells));
    for (let y = lo(cy); y < Math.min(grid.rows, Math.ceil(cy + rCells)); y++) {
      for (let x = lo(cx); x < Math.min(grid.cols, Math.ceil(cx + rCells)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rCells * rCells) seen[y * grid.cols + x] = 1;
      }
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, w, h);

    // Nearest-neighbour: a cell grid scaled up smoothly turns to mush.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrain, 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(fog, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    const toScreen = (wx: number, wy: number): [number, number] => [
      ((wx - grid.originX) / grid.cellSize / grid.cols) * w,
      ((wy - grid.originY) / grid.cellSize / grid.rows) * h,
    ];
    const explored = (wx: number, wy: number): boolean => {
      const ax = Math.round((wx - grid.originX) / grid.cellSize);
      const ay = Math.round((wy - grid.originY) / grid.cellSize);
      if (ax < 0 || ay < 0 || ax >= grid.cols || ay >= grid.rows) return false;
      return seen[ay * grid.cols + ax] === 1;
    };

    // Objectives, but only once the player has actually been there. Showing the
    // boss through unexplored ground would hand over the route for free.
    for (const a of layout.objectiveAnchors) {
      if (!explored(a.x, a.y)) continue;
      const [sx, sy] = toScreen(a.x, a.y);
      ctx.fillStyle = anchorColor(a.id);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // The player last, so nothing paints over them.
    const [px, py] = toScreen(player.x, player.y);
    ctx.fillStyle = "#fff6e0";
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [grid, layout, player]);

  if (!layout || !grid) return null;

  return (
    <div
      data-testid="minimap"
      style={{
        position: "absolute",
        top: "1.2vw",
        right: "1.2vw",
        width: `${MAP_VW}vw`,
        height: `${MAP_VW}vw`,
        pointerEvents: "none",
        border: "1px solid rgba(140,120,84,0.55)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
        fontFamily: SERIF,
      }}
    >
      <canvas
        ref={canvasRef}
        width={256}
        height={256}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
