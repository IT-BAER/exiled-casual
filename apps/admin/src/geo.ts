/** Equirectangular: longitude and latitude scale linearly onto x and y. */
export function project(lon: number, lat: number, width: number, height: number): [number, number] {
  return [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];
}

type Ring = number[][];
export type LandGeometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] }
  | { type: string; coordinates?: unknown };

const r = (n: number) => Math.round(n * 10) / 10;

function ringPath(ring: Ring, w: number, h: number): string {
  let d = "";
  let prevLon: number | null = null;
  for (const p of ring) {
    const lon = p[0]!, lat = p[1]!;
    const [x, y] = project(lon, lat, w, h);
    // A step longer than half the world is a wrap across the antimeridian, not a line.
    const cmd = prevLon === null || Math.abs(lon - prevLon) > 180 ? "M" : "L";
    d += `${cmd}${r(x)} ${r(y)}`;
    prevLon = lon;
  }
  return d ? `${d}Z` : "";
}

export function geometryPath(g: LandGeometry, w: number, h: number): string {
  if (g.type === "Polygon") return (g.coordinates as Ring[]).map((ring) => ringPath(ring, w, h)).join("");
  if (g.type === "MultiPolygon") return (g.coordinates as Ring[][]).flatMap((poly) => poly.map((ring) => ringPath(ring, w, h))).join("");
  return "";
}

export interface GratLine {
  kind: "meridian" | "parallel";
  deg: number;
  d: string;
}

/** Meridians every `step` degrees from -180 to 180, parallels strictly between the poles. */
export function graticule(step: number, w: number, h: number): GratLine[] {
  const out: GratLine[] = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const [x] = project(lon, 0, w, h);
    out.push({ kind: "meridian", deg: lon, d: `M${r(x)} 0V${h}` });
  }
  for (let lat = -90 + step; lat < 90; lat += step) {
    const [, y] = project(0, lat, w, h);
    out.push({ kind: "parallel", deg: lat, d: `M0 ${r(y)}H${w}` });
  }
  return out;
}

/** Area-true node size: radius grows with the square root of sessions, 3 to 12 units. */
export function nodeRadius(sessions: number, max: number): number {
  if (max <= 0 || sessions <= 0) return 3;
  return 3 + 9 * Math.sqrt(Math.min(1, sessions / max));
}
