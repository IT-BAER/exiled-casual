import React, { useEffect, useRef } from "react";
import type { AreaLayout, WalkableGrid } from "@exiled/mapgen";
import { SERIF } from "./ItemTooltip";

/**
 * Top-right minimap, the instrument that makes the layout variation legible: a
 * player who cannot see the route cannot tell one assembly from another.
 *
 * Reference: `reference-screenshots/minimap-poe1.png` (PoE1) for the drawing itself —
 * the explored area is ONE smooth dark silhouette under a thin lavender contour,
 * over a square of dimmed world, with no panel or border. Drawing the cells
 * as walls and floor instead (as `minimap.png`, PoE2, does at its much closer
 * zoom) turns into masonry noise at this size.
 *
 * Layers: the terrain is painted once per area, the fog is an opaque sheet that
 * the player punches holes in, and only the icons are redrawn per frame.
 */

/** Minimap box, a fraction of the viewport as the rest of the HUD is. */
const MAP_VW = 13;
/**
 * Gap to the top-right corner, in the same viewport units.
 *
 * Tight on purpose. The minimap is the one HUD element with nothing outboard of
 * it, so a generous inset just floats it in the middle of a corner instead of
 * anchoring it to one, and the space it leaves is world the player cannot use.
 */
const MAP_INSET_VW = 0.6;
/** World units the player reveals around themselves. */
const REVEAL_RADIUS = 9;
/**
 * Terrain pixels per grid cell. The terrain layer is drawn at this resolution
 * and downscaled smoothly into the box, which is what keeps the walls looking
 * like geometry instead of like upscaled pixel art.
 */
const CELL_PX = 4;
const FLOOR = "rgba(38,41,54,0.88)";
/** The contour, PoE1's lavender rather than PoE2's cyan. */
const WALL = "#8b8fb8";
/** Contour thickness and corner rounding, in terrain pixels. */
const EDGE_PX = 3;
const ROUNDING = 3;

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

/**
 * Paint the walkable area once, as one silhouette: the cells are stamped into a
 * mask, blurred and thresholded, so corners come out rounded and organic rather
 * than as a staircase of 0.5-unit squares. The rounding is the blur radius, so
 * a tight corner rounds harder than a long wall — which is what makes it read
 * as a drawn map instead of a grid.
 *
 * The contour is the same silhouette minus itself nudged one step each way. A
 * marching-squares outline would be exact; this is two blits and looks the same
 * at 384px.
 */
function paintTerrain(grid: WalkableGrid): HTMLCanvasElement {
  const w = grid.cols * CELL_PX, h = grid.rows * CELL_PX;
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext("2d");
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!mctx || !ctx) return c;

  mctx.fillStyle = "#fff";
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    if (grid.cells[i] !== 1) continue;
    const x = i % grid.cols, y = (i - (i % grid.cols)) / grid.cols;
    mctx.fillRect(x * CELL_PX - 0.5, y * CELL_PX - 0.5, CELL_PX + 1, CELL_PX + 1);
  }

  // Blur, then cut at half alpha: the blur is what rounds the corners and the
  // cut is what stops the shape fading out into a smudge.
  const blurred = document.createElement("canvas");
  blurred.width = w;
  blurred.height = h;
  const bctx = blurred.getContext("2d");
  if (!bctx) return c;
  bctx.filter = `blur(${ROUNDING}px)`;
  bctx.drawImage(mask, 0, 0);
  bctx.filter = "none";
  const img = bctx.getImageData(0, 0, w, h);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = (img.data[i] ?? 0) > 128 ? 255 : 0;
  bctx.putImageData(img, 0, 0);

  // Floor, then the contour on top of it.
  ctx.drawImage(blurred, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  // Erode the silhouette — the INTERSECTION of it nudged each way, which is
  // `destination-in`; the union (`destination-out`, the obvious spelling) eats
  // the whole shape, because a pixel on the left edge is covered by the copy
  // nudged left and no contour survives at all.
  const eroded = document.createElement("canvas");
  eroded.width = w;
  eroded.height = h;
  const rctx = eroded.getContext("2d");
  const outline = document.createElement("canvas");
  outline.width = w;
  outline.height = h;
  const octx = outline.getContext("2d");
  if (rctx && octx) {
    rctx.drawImage(blurred, 0, 0);
    rctx.globalCompositeOperation = "destination-in";
    for (const [dx, dy] of [[EDGE_PX, 0], [-EDGE_PX, 0], [0, EDGE_PX], [0, -EDGE_PX]] as const) {
      rctx.drawImage(blurred, dx, dy);
    }
    octx.drawImage(blurred, 0, 0);
    octx.globalCompositeOperation = "destination-out";
    octx.drawImage(eroded, 0, 0);
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = WALL;
    octx.fillRect(0, 0, w, h);
    ctx.drawImage(outline, 0, 0);
  }
  return c;
}

/** An opaque sheet the player erases by walking. Same cell resolution as the grid. */
/**
 * Fog pixels per map cell.
 *
 * One pixel per cell is what made the reveal edge steppy: the disc is only a
 * few cells across, so its feather had three pixels to happen in and the
 * upscale to the widget smeared those three into bands. Four times the cells
 * costs a 448x448 alpha canvas per area and gives the gradient room to be one.
 */
const FOG_SS = 4;

function makeFog(grid: WalkableGrid): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = grid.cols * FOG_SS;
  c.height = grid.rows * FOG_SS;
  const ctx = c.getContext("2d");
  // `?revealed` opens the whole map at once. A dev-only harness switch, and the
  // only way to judge a LAYOUT from inside the game: walking a map to see its
  // shape takes minutes and shows it a disc at a time.
  const revealed = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("revealed");
  if (ctx && !revealed) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/**
 * The camera yaw, in canvas terms. `engine.ts` sits at `alpha = -PI/4`, so the
 * map has to lean the same 45° or it stops agreeing with the view. A square
 * turned 45° needs sqrt(2) more room, so `FIT` gives it back.
 */
const YAW = Math.PI / 4;
const YAW_COS = Math.cos(YAW);
const YAW_SIN = Math.sin(YAW);
const FIT = Math.SQRT1_2;

/**
 * World point to canvas pixel: flip, then yaw. World +y is up the screen while
 * canvas y counts down, and without that flip the marker walks south when the
 * player walks north.
 */
export function toCanvas(
  grid: WalkableGrid,
  wx: number,
  wy: number,
  w: number,
  h: number,
): [number, number] {
  const x = ((wx - grid.originX) / grid.cellSize / grid.cols) * w;
  const y = h - ((wy - grid.originY) / grid.cellSize / grid.rows) * h;
  const dx = (x - w / 2) * FIT;
  const dy = (y - h / 2) * FIT;
  return [
    w / 2 + dx * YAW_COS - dy * YAW_SIN,
    h / 2 + dx * YAW_SIN + dy * YAW_COS,
  ];
}

export interface MinimapProps {
  /** Null outside a map — the hideout has no minimap. */
  layout: AreaLayout | null;
  player: { x: number; y: number } | null;
  /**
   * Tab's big centred map. The SAME component instance switching container
   * style, never a second mount: the fog and seen layers live in refs, and a
   * second instance would start fully fogged.
   */
  overlay?: boolean;
  /** Opacity of the overlay, `settings.ui.overlayMapOpacity`. */
  overlayOpacity?: number;
}

export function Minimap(
  { layout, player, overlay = false, overlayOpacity = 0.6 }: MinimapProps,
): React.JSX.Element | null {
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
      // Feathered, not a hard disc: an unexplored edge that is a clean arc reads
      // as the map having been sliced. The partial erase compounds frame over
      // frame, so ground the player stays near firms up anyway.
      //
      // The feather starts at 40% of the radius and eases rather than ramps: a
      // linear alpha over a short distance still reads as an edge, because the
      // eye finds the discontinuity in the SLOPE, not in the value.
      const fx = cx * FOG_SS, fy = cy * FOG_SS, fr = rCells * FOG_SS;
      const g = fogCtx.createRadialGradient(fx, fy, fr * 0.4, fx, fy, fr);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.35, "rgba(0,0,0,0.82)");
      g.addColorStop(0.7, "rgba(0,0,0,0.38)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      fogCtx.globalCompositeOperation = "destination-out";
      fogCtx.fillStyle = g;
      fogCtx.beginPath();
      fogCtx.arc(fx, fy, fr, 0, Math.PI * 2);
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

    // Smoothed on purpose: the terrain layer is drawn oversized and comes down
    // to the box, and the fog comes up, so neither edge shows its cells. Both
    // are flipped, for the reason `toCanvas` gives.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(YAW);
    ctx.scale(FIT, FIT);
    ctx.translate(-w / 2, -h / 2);
    ctx.translate(0, h);
    ctx.scale(1, -1);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrain, 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(fog, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    const toScreen = (wx: number, wy: number): [number, number] =>
      toCanvas(grid, wx, wy, w, h);
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
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // The player last, so nothing paints over them.
    // The player is a diamond, as PoE2's is, so it reads apart from the round
    // objective pips at this size.
    const [px, py] = toScreen(player.x, player.y);
    ctx.fillStyle = "#f5d34a";
    ctx.beginPath();
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 6, py);
    ctx.lineTo(px, py + 6);
    ctx.lineTo(px - 6, py);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [grid, layout, player]);

  if (!layout || !grid) return null;

  // The overlay is the same map centred and blown up, PoE's Tab map: sized to
  // the short screen edge so it never crops, and faded as a whole so the world
  // stays playable through it. Resolution doubles with the size or the upscale
  // smears the contour.
  const box = overlay
    ? {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(86vh, 86vw)",
        height: "min(86vh, 86vw)",
        opacity: overlayOpacity,
        // No tinted square at this size: the corner map's backdrop, blown up,
        // reads as a panel dimming the whole screen. The contour holds up
        // against bright ground because the overlay is fading as a whole anyway.
        background: "none",
      }
    : {
        top: `${MAP_INSET_VW}vw`,
        right: `${MAP_INSET_VW}vw`,
        width: `${MAP_VW}vw`,
        height: `${MAP_VW}vw`,
      };

  return (
    <div
      data-testid="minimap"
      data-overlay={overlay || undefined}
      style={{
        position: "absolute",
        pointerEvents: "none",
        // A tinted square, still no border. PoE darkens the world under the map
        // so the contour has something to read against over bright ground, but
        // it is a tint and not a panel: no frame line, no rounding, and the
        // world stays visible through it.
        background: "rgba(0,0,0,0.34)",
        filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.75))",
        fontFamily: SERIF,
        ...box,
      }}
    >
      <canvas
        ref={canvasRef}
        width={overlay ? 768 : 384}
        height={overlay ? 768 : 384}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
