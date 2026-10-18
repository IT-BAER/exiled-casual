import type { ReactNode } from "react";
import type { Rarity } from "@exiled/telemetry";
import { Icon, IconBox, type IconName } from "./icons";
import { hrefFor, type PageId } from "./router";
import { countryName, flagEmoji, formatTime } from "./format";
import type { ApiState } from "./use-api";

export function PageHead({ title, id, lede, status }: { title: string; id?: string; lede?: ReactNode; status?: "ok" | "warn" | "fail" | "idle" }) {
  return (
    <header className="page-head">
      <h1>
        {title}
        {id !== undefined && <> <span className="mono">{id}</span></>}
      </h1>
      {lede !== undefined && <p className={status ? `lede status is-${status}` : "lede"}>{lede}</p>}
    </header>
  );
}

export function Panel({
  icon,
  title,
  meta,
  foot,
  className,
  children,
}: {
  icon: IconName;
  title: string;
  meta?: ReactNode;
  foot?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const hid = `h-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className={className ? `panel ${className}` : "panel"} aria-labelledby={hid}>
      <div className="panel-head">
        <IconBox name={icon} />
        <h2 id={hid}>{title}</h2>
        {meta !== undefined && <span className="meta">{meta}</span>}
      </div>
      {children}
      {foot !== undefined && <div className="panel-foot">{foot}</div>}
    </section>
  );
}

export type Tone = "ok" | "warn" | "fail" | "pending" | "plain";

export function Badge({ tone = "plain", rarity, children }: { tone?: Tone; rarity?: Rarity; children: ReactNode }) {
  const cls = rarity ? `badge r-${rarity}` : tone === "plain" ? "badge" : `badge ${tone}`;
  return <span className={cls}>{children}</span>;
}

/** A display figure; `tone` colours it only when the caller decided the value means something. */
export function N({ v, tone }: { v: ReactNode; tone?: "fail" | "warn" | null }) {
  return <span className={tone ? `n ${tone}` : "n"}>{v}</span>;
}

export function Reading({ icon, label, children, proof, proofIcon }: { icon: IconName; label: string; children: ReactNode; proof: ReactNode; proofIcon?: IconName }) {
  return (
    <div className="panel reading">
      <div className="panel-head">
        <IconBox name={icon} />
        <span className="reading-label">{label}</span>
      </div>
      {children}
      <span className="proof">
        {proofIcon && <Icon name={proofIcon} />}
        {proof}
      </span>
    </div>
  );
}

export function Figure({ children }: { children: ReactNode }) {
  return <span className="figure">{children}</span>;
}

export function Idle({ children }: { children: ReactNode }) {
  return (
    <div className="idle">
      <span>{children}</span>
    </div>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr className="empty">
      <td colSpan={cols}>
        <Idle>{children}</Idle>
      </td>
    </tr>
  );
}

export function ErrorCallout({ children }: { children: ReactNode }) {
  return (
    <p className="callout error" role="alert">
      {children}
    </p>
  );
}

/** Renders a fetched value: an error callout, a loading line on first load, then the content. */
export function Loaded<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  return (
    <>
      {state.error && <ErrorCallout>Could not load: {state.error}</ErrorCallout>}
      {state.data !== undefined ? children(state.data) : !state.error && <p className="loading" aria-busy="true">Loading</p>}
    </>
  );
}

export function Seg({ label, items }: { label: string; items: { label: string; href: string; current: boolean }[] }) {
  return (
    <nav className="seg" aria-label={label}>
      {items.map((it) => (
        <a key={it.href} href={it.href} aria-current={it.current ? "true" : undefined}>
          {it.label}
        </a>
      ))}
    </nav>
  );
}

export const RANGES = [1, 7, 30, 90] as const;

/** Reads `?days=` with a fallback when it is missing or not one of the offered ranges. */
export function rangeDays(query: Record<string, string>, options: readonly number[], fallback: number): number {
  const d = Number(query.days);
  return options.includes(d) ? d : fallback;
}

export function RangePicker({ page, query, days, options = RANGES }: { page: PageId; query: Record<string, string>; days: number; options?: readonly number[] }) {
  return (
    <Seg
      label="Range"
      items={options.map((d) => ({
        label: d === 1 ? "24 h" : `${d} d`,
        href: hrefFor({ page, query: { ...query, days: String(d) } }),
        current: d === days,
      }))}
    />
  );
}

export function Country({ code, city }: { code: string | null; city?: string | null }) {
  const flag = flagEmoji(code);
  return (
    <span title={code ?? undefined}>
      {flag && (
        <span className="flag" aria-hidden="true">
          {flag}
        </span>
      )}
      {countryName(code)}
      {city ? `, ${city}` : ""}
    </span>
  );
}

export function Time({ ms }: { ms: number }) {
  return <time dateTime={new Date(ms).toISOString()}>{formatTime(ms)}</time>;
}

export function sum(ns: readonly number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}
