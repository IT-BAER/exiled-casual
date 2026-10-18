import { useEffect, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { GeoRow } from "@exiled/telemetry";
import { countryName, formatDuration, formatNumber } from "../format";
import { geometryPath, graticule, nodeRadius, project, type LandGeometry } from "../geo";
import { useApi } from "../use-api";
import { Country, EmptyRow, Loaded, PageHead, Panel, RangePicker, rangeDays, sum } from "../ui";

const W = 960;
const H = 480;
const NORTH = 84;
const SOUTH = -58;

/** Land outline, loaded once per page life (the topology is 55 KB). */
let landCache: Promise<string> | null = null;
export function loadLand(): Promise<string> {
  landCache ??= import("world-atlas/land-110m.json").then((m) => {
    const topo = (m.default ?? m) as unknown as Topology<{ land: GeometryCollection }>;
    const fc = feature(topo, topo.objects.land);
    const feats = "features" in fc ? fc.features : [fc];
    return feats.map((f) => geometryPath(f.geometry as LandGeometry, W, H)).join("");
  });
  return landCache;
}

export function AtlasMap({ rows }: { rows: GeoRow[] }) {
  const [land, setLand] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadLand().then((d) => alive && setLand(d), () => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const placed = rows.filter((r) => r.lat !== null && r.lon !== null).sort((a, b) => b.sessions - a.sessions);
  const max = Math.max(0, ...placed.map((r) => r.sessions));
  const top = project(0, NORTH, W, H)[1];
  const bottom = project(0, SOUTH, W, H)[1];
  return (
    <svg className="atlas-map" viewBox={`0 ${top} ${W} ${bottom - top}`} role="img" aria-label={`Atlas of ${placed.length} places with sessions`}>
      <title>{`Atlas of ${placed.length} places with sessions`}</title>
      {graticule(15, W, H).map((g) => (
        <path key={`${g.kind}${g.deg}`} className={g.kind === "parallel" && g.deg === 0 ? "grat eq" : "grat"} d={g.d} />
      ))}
      {land && <path className="land" d={land} />}
      {[...placed].reverse().map((r) => {
        const [x, y] = project(r.lon!, r.lat!, W, H);
        const rad = nodeRadius(r.sessions, max);
        const name = `${r.city ?? "Unknown city"}, ${countryName(r.country)}`;
        const text = `${name}: ${formatNumber(r.sessions)} sessions, ${formatNumber(r.visitors)} visitors, ${formatDuration(r.playSeconds)} played`;
        return (
          <g key={`${r.country}/${r.city}`} className="city" tabIndex={0} aria-label={text}>
            <title>{text}</title>
            <circle className="node-glow" cx={x} cy={y} r={rad * 2.2} />
            <circle className="node" cx={x} cy={y} r={rad} />
          </g>
        );
      })}
      <rect className="sea-frame" x={0.5} y={top + 0.5} width={W - 1} height={bottom - top - 1} />
    </svg>
  );
}

interface CountryAgg {
  country: string;
  sessions: number;
  visitors: number;
  playSeconds: number;
  cities: number;
}

export function byCountry(rows: GeoRow[]): CountryAgg[] {
  const m = new Map<string, CountryAgg>();
  for (const r of rows) {
    const a = m.get(r.country) ?? { country: r.country, sessions: 0, visitors: 0, playSeconds: 0, cities: 0 };
    a.sessions += r.sessions;
    a.visitors += r.visitors;
    a.playSeconds += r.playSeconds;
    if (r.city) a.cities++;
    m.set(r.country, a);
  }
  return [...m.values()].sort((a, b) => b.sessions - a.sessions);
}

export function AtlasView({ rows }: { rows: GeoRow[] }) {
  const countries = byCountry(rows);
  const cities = [...rows].sort((a, b) => b.sessions - a.sessions);
  const unplaced = rows.filter((r) => r.lat === null || r.lon === null).length;
  return (
    <>
      <Panel icon="atlas" title="Where the exiles play" meta={<><span className="mono">{formatNumber(sum(rows.map((r) => r.sessions)))}</span> sessions from <span className="mono">{countries.length}</span> countries{unplaced ? <>, <span className="mono">{unplaced}</span> without coordinates</> : null}</>}>
        <AtlasMap rows={rows} />
      </Panel>
      <div className="duo">
        <Panel icon="globe" title="By country">
          <div className="scroll">
            <table className="stack">
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="num">Sessions</th>
                  <th className="num">Visitors</th>
                  <th className="num">Played</th>
                  <th className="num">Cities</th>
                </tr>
              </thead>
              <tbody>
                {countries.length === 0 && <EmptyRow cols={5}>No sessions in this range.</EmptyRow>}
                {countries.map((c) => (
                  <tr key={c.country}>
                    <td data-label="Country"><Country code={c.country} /></td>
                    <td className="num" data-label="Sessions">{formatNumber(c.sessions)}</td>
                    <td className="num" data-label="Visitors">{formatNumber(c.visitors)}</td>
                    <td className="num" data-label="Played">{formatDuration(c.playSeconds)}</td>
                    <td className="num" data-label="Cities">{c.cities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel icon="atlas" title="By city">
          <div className="scroll">
            <table className="stack">
              <thead>
                <tr>
                  <th>City</th>
                  <th className="num">Sessions</th>
                  <th className="num">Visitors</th>
                  <th className="num">Played</th>
                </tr>
              </thead>
              <tbody>
                {cities.length === 0 && <EmptyRow cols={4}>No sessions in this range.</EmptyRow>}
                {cities.map((r) => (
                  <tr key={`${r.country}/${r.city}`}>
                    <td data-label="City"><Country code={r.country} city={r.city ?? "unknown city"} /></td>
                    <td className="num" data-label="Sessions">{formatNumber(r.sessions)}</td>
                    <td className="num" data-label="Visitors">{formatNumber(r.visitors)}</td>
                    <td className="num" data-label="Played">{formatDuration(r.playSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function Atlas({ query }: { query: Record<string, string> }) {
  const days = rangeDays(query, [1, 7, 30, 90], 7);
  const st = useApi("GET /admin/api/geo", { query: { days } });
  return (
    <div className="page">
      <PageHead title="Atlas" lede="Sessions by place, from the country and city Cloudflare reports. Places without coordinates appear in the tables only." />
      <div className="toolbar">
        <RangePicker page="atlas" query={query} days={days} />
      </div>
      <Loaded state={st}>{(rows) => <AtlasView rows={rows} />}</Loaded>
    </div>
  );
}
