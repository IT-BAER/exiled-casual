import { useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Point, Rarity } from "@exiled/telemetry";
import { formatClock, formatDay, formatNumber } from "./format";

export type ChartTone = "text" | "muted" | "faint" | "gilt" | "info" | "ok" | "warn" | "fail" | Rarity;

/** Width of the element, following resizes; `fallback` where layout is not measured (tests). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setW(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** The smallest 1, 2, 2.5 or 5 times a power of ten at or above `v`. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

const CHAR_W = 6.7;

/** Tooltip drawn inside the SVG: attributes only, so nothing needs an inline style. */
function Tip({ x, y, width, title, lines }: { x: number; y: number; width: number; title: string; lines: { label: string; value: string; tone?: ChartTone }[] }) {
  const longest = Math.max(title.length, ...lines.map((l) => l.label.length + l.value.length + 2));
  const bw = Math.ceil(longest * CHAR_W) + 20;
  const bh = 22 + lines.length * 16;
  const bx = x + 12 + bw > width ? x - 12 - bw : x + 12;
  return (
    <g className="tip" pointerEvents="none">
      <rect x={bx} y={y} width={bw} height={bh} rx={5} />
      <text className="tip-t" x={bx + 10} y={y + 16}>
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l.label} x={bx + 10} y={y + 33 + i * 16}>
          <tspan className={l.tone ? `t-${l.tone}` : undefined}>{l.label}</tspan>
          <tspan dx={6}>{l.value}</tspan>
        </text>
      ))}
    </g>
  );
}

function NoData({ children = "No data in this range." }: { children?: ReactNode }) {
  return (
    <div className="idle">
      <span>{children}</span>
    </div>
  );
}

export interface Series {
  label: string;
  points: Point[];
  tone: ChartTone;
}

const M = { l: 46, r: 12, t: 10, b: 24 };

/** Line chart over time with optional area fill; hovering shows every series' exact value at that bucket. */
export function LineChart({
  label,
  series,
  height = 190,
  area = true,
  format = formatNumber,
  timeFormat,
}: {
  label: string;
  series: Series[];
  height?: number;
  area?: boolean;
  format?: (v: number) => string;
  timeFormat?: (t: number) => string;
}) {
  const [ref, w] = useWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  const base = series.reduce<Point[]>((a, s) => (s.points.length > a.length ? s.points : a), []);
  if (base.length === 0) return <NoData />;

  const all = series.flatMap((s) => s.points);
  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  const yMax = niceMax(Math.max(...all.map((p) => p.v)));
  // Past a day the clock alone repeats itself on every tick.
  const fmtT = timeFormat ?? (tMax - tMin > 20 * 3_600_000 ? (t: number) => `${formatDay(t)} ${formatClock(t)}` : formatClock);
  const pw = Math.max(1, w - M.l - M.r);
  const ph = height - M.t - M.b;
  const x = (t: number) => M.l + (tMax > tMin ? ((t - tMin) / (tMax - tMin)) * pw : pw / 2);
  const y = (v: number) => M.t + (1 - v / yMax) * ph;
  const line = (ps: Point[]) => ps.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const xTicks = base.length > 2 ? [base[0]!, base[Math.floor(base.length / 2)]!, base[base.length - 1]!] : base;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < base.length; i++) if (Math.abs(x(base[i]!.t) - px) < Math.abs(x(base[best]!.t) - px)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? base[hover] : undefined;

  return (
    <div className="chart-wrap">
      <div ref={ref}>
        <svg className="chart" width={w} height={height} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <title>{label}</title>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line className="grid" x1={M.l} x2={w - M.r} y1={y(yMax * f)} y2={y(yMax * f)} />
              <text className="axis" x={M.l - 8} y={y(yMax * f) + 4} textAnchor="end">
                {format(yMax * f)}
              </text>
            </g>
          ))}
          {xTicks.map((p, i) => (
            <text key={p.t} className="axis" x={x(p.t)} y={height - 6} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
              {fmtT(p.t)}
            </text>
          ))}
          {series.map((s) => (
            <g key={s.label} className={`t-${s.tone}`}>
              {area && s.points.length > 1 && (
                <path className="area" d={`${line(s.points)}L${x(s.points[s.points.length - 1]!.t).toFixed(1)} ${y(0)}L${x(s.points[0]!.t).toFixed(1)} ${y(0)}Z`} />
              )}
              <path className="line" d={line(s.points)} />
            </g>
          ))}
          <rect className="hit" x={M.l} y={M.t} width={pw} height={ph} />
          {hp && (
            <>
              <line className="hover-rule" x1={x(hp.t)} x2={x(hp.t)} y1={M.t} y2={M.t + ph} />
              {series.map((s) => {
                const p = s.points.find((q) => q.t === hp.t);
                return p ? <circle key={s.label} className={`dot t-${s.tone}`} cx={x(p.t)} cy={y(p.v)} r={3.5} /> : null;
              })}
              <Tip
                x={x(hp.t)}
                y={M.t}
                width={w}
                title={fmtT(hp.t)}
                lines={series.map((s) => {
                  const p = s.points.find((q) => q.t === hp.t);
                  return { label: s.label, value: p ? format(p.v) : "-", tone: s.tone };
                })}
              />
            </>
          )}
        </svg>
      </div>
      {series.length > 1 && (
        <ul className="legend" aria-hidden="true">
          {series.map((s) => (
            <li key={s.label} className={`t-${s.tone}`}>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ColumnKey {
  label: string;
  tone: ChartTone;
}

/** Vertical columns, stacked when there is more than one key; a histogram is one key. */
export function ColumnChart({
  label,
  columns,
  keys,
  height = 190,
  format = formatNumber,
}: {
  label: string;
  columns: { label: string; values: number[] }[];
  keys: ColumnKey[];
  height?: number;
  format?: (v: number) => string;
}) {
  const [ref, w] = useWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (columns.length === 0) return <NoData />;
  const totals = columns.map((c) => c.values.reduce((a, b) => a + b, 0));
  const yMax = niceMax(Math.max(...totals));
  const pw = Math.max(1, w - M.l - M.r);
  const ph = height - M.t - M.b;
  const slot = pw / columns.length;
  const bw = Math.max(2, Math.min(42, slot * 0.72));
  const y = (v: number) => M.t + (1 - v / yMax) * ph;
  const labelStep = Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor(pw / 64))));
  const hc = hover !== null ? columns[hover] : undefined;

  return (
    <div className="chart-wrap">
      <div ref={ref}>
        <svg className="chart" width={w} height={height} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
          <title>{label}</title>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line className="grid" x1={M.l} x2={w - M.r} y1={y(yMax * f)} y2={y(yMax * f)} />
              <text className="axis" x={M.l - 8} y={y(yMax * f) + 4} textAnchor="end">
                {format(yMax * f)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const cx = M.l + slot * i + slot / 2;
            let acc = 0;
            return (
              <g key={`${c.label}-${i}`} className={hover === i ? "col on" : "col"} onPointerEnter={() => setHover(i)}>
                <rect className="hit" x={M.l + slot * i} y={M.t} width={slot} height={ph} />
                {c.values.map((v, k) => {
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  return v > 0 ? <rect key={k} className={`rect t-${keys[k]?.tone ?? "muted"}`} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)} /> : null;
                })}
                {i % labelStep === 0 && (
                  <text className="axis" x={cx} y={height - 6} textAnchor="middle">
                    {c.label}
                  </text>
                )}
              </g>
            );
          })}
          {hc && hover !== null && (
            <Tip
              x={M.l + slot * hover + slot / 2}
              y={M.t}
              width={w}
              title={keys.length > 1 ? `${hc.label}  total ${format(totals[hover]!)}` : hc.label}
              lines={keys.map((k, i) => ({ label: k.label, value: format(hc.values[i] ?? 0), tone: k.tone }))}
            />
          )}
        </svg>
      </div>
      {keys.length > 1 && (
        <ul className="legend" aria-hidden="true">
          {keys.map((k) => (
            <li key={k.label} className={`t-${k.tone}`}>
              {k.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  tone?: ChartTone;
  /** Shown after the figure, e.g. a share. */
  note?: string;
}

/** Horizontal bars in a list: label, bar, exact figure. */
export function HBars({ items, format = formatNumber, max, empty }: { items: BarItem[]; format?: (v: number) => string; max?: number; empty?: ReactNode }) {
  if (items.length === 0) return <NoData>{empty}</NoData>;
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="hbars">
      {items.map((it) => (
        <li key={it.key}>
          <span className="hb-label">{it.label}</span>
          <svg className={`hb-track t-${it.tone ?? "muted"}`} viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
            <rect className="bg" width={100} height={8} rx={2} />
            <rect className="rect" width={Math.max(0, Math.min(100, (it.value / top) * 100))} height={8} rx={2} />
          </svg>
          <span className="hb-value">
            <strong>{format(it.value)}</strong>
            {it.note ? ` ${it.note}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Tiny trend line; the title carries the exact last, min and max. */
export function Sparkline({ points, tone = "muted", label, format = formatNumber }: { points: Point[]; tone?: ChartTone; label: string; format?: (v: number) => string }) {
  const W = 120, H = 28;
  if (points.length === 0) {
    return (
      <svg className={`spark t-${tone}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: no data`}>
        <title>{`${label}: no data`}</title>
        <line className="line" x1={0} x2={W} y1={H - 1} y2={H - 1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const vs = points.map((p) => p.v);
  const max = Math.max(...vs), min = Math.min(...vs);
  const top = max > 0 ? max : 1;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W / 2);
  const y = (v: number) => H - 2 - (v / top) * (H - 4);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const title = `${label}: last ${format(vs[vs.length - 1]!)}, min ${format(min)}, max ${format(max)}`;
  return (
    <svg className={`spark t-${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title}>
      <title>{title}</title>
      <path className="area" d={`${d}L${x(points.length - 1).toFixed(1)} ${H}L0 ${H}Z`} />
      <path className="line" d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** One period of the surface wave, repeated so a 120-unit slide loops seamlessly. */
function wavePath(top: number, amp: number): string {
  let d = `M0 ${top}`;
  for (let x = 0; x < 300; x += 60) d += `Q${x + 15} ${top - amp} ${x + 30} ${top}T${x + 60} ${top}`;
  return `${d}V140H0Z`;
}

/** A life or mana globe like the game's: `level` 0..1 fills it. */
export function Orb({ kind, level, value, caption, sub }: { kind: "life" | "mana"; level: number; value: string; caption: string; sub: string }) {
  const clip = `orb-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const l = Math.max(0, Math.min(1, level));
  const top = 6 + (1 - l) * 128;
  return (
    <figure className={`orb ${kind}`}>
      <svg viewBox="0 0 140 140" role="img" aria-label={`${caption}: ${value}`}>
        <title>{`${caption}: ${value}`}</title>
        <defs>
          <clipPath id={clip}>
            <circle cx={70} cy={70} r={64} />
          </clipPath>
        </defs>
        <circle className="glass" cx={70} cy={70} r={64} />
        <g clipPath={`url(#${clip})`}>
          <rect className="liquid" x={0} y={top + 3} width={140} height={140} />
          {l > 0 && l < 1 && (
            <>
              <path className="wave back" d={wavePath(top + 1, 3)} />
              <path className="wave" d={wavePath(top, 4)} />
            </>
          )}
          <ellipse className="shine" cx={52} cy={40} rx={30} ry={16} />
        </g>
        <circle className="rim-in" cx={70} cy={70} r={63} />
        <circle className="rim" cx={70} cy={70} r={66} />
        <text className="orb-n" x={70} y={78}>
          {value}
        </text>
      </svg>
      <figcaption>
        {caption}
        <span>{sub}</span>
      </figcaption>
    </figure>
  );
}
