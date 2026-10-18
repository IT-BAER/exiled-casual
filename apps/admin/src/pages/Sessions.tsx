import { useState, type FormEvent } from "react";
import type { SessionDetail, SessionEvent, SessionRow, Page } from "@exiled/telemetry";
import { formatClock, formatDuration, formatNumber } from "../format";
import { hrefFor, navigate } from "../router";
import { useApi } from "../use-api";
import { Badge, Country, EmptyRow, Loaded, N, PageHead, Panel, Time } from "../ui";

const PAGE_SIZE = 50;

const titleCase = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

function Exile({ s }: { s: SessionRow }) {
  if (!s.classId) return <span className="faint">-</span>;
  return (
    <div>
      {titleCase(s.classId)}
      {s.maxLevel !== null && <span className="mono"> {s.maxLevel}</span>}
      {s.ageDays !== null && <span className="cell-sub">character {s.ageDays} d old</span>}
    </div>
  );
}

export function SessionsTable({ page, query }: { page: Page<SessionRow>; query: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(page.total / Math.max(1, page.pageSize)));
  const go = (p: number) => hrefFor({ page: "sessions", query: { ...query, page: String(p) } });
  return (
    <section className="panel" aria-label="Sessions">
      <div className="scroll">
        <table className="stack">
          <thead>
            <tr>
              <th>Started</th>
              <th>Exile</th>
              <th>From</th>
              <th>Furthest</th>
              <th className="num">Played</th>
              <th className="num">Maps</th>
              <th className="num">Deaths</th>
              <th className="num">Errors</th>
              <th>Client</th>
              <th>Build</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.length === 0 && <EmptyRow cols={10}>{query.q ? "No session matches this search." : "No sessions recorded yet."}</EmptyRow>}
            {page.rows.map((s) => (
              <tr key={s.sid} className="link" onClick={(e) => (e.target as HTMLElement).closest("a") || navigate(hrefFor({ page: "sessions", id: s.sid }))}>
                <td className="t" data-label="Started">
                  <a href={hrefFor({ page: "sessions", id: s.sid })}>
                    <Time ms={s.startedAt} />
                  </a>
                </td>
                <td data-label="Exile">
                  <Exile s={s} />
                </td>
                <td data-label="From">
                  <Country code={s.country} city={s.city} />
                </td>
                <td data-label="Furthest">
                  <Badge tone={s.furthest === "game" ? "ok" : "plain"}>{s.furthest}</Badge>
                </td>
                <td className="num" data-label="Played">{formatDuration(s.playSeconds)}</td>
                <td className="num" data-label="Maps">{s.maps}</td>
                <td className="num" data-label="Deaths">{s.deaths}</td>
                <td className="num" data-label="Errors">
                  <N v={s.errors} tone={s.errors > 0 ? "fail" : null} />
                </td>
                <td data-label="Client">
                  <div>
                    {s.browser} on {s.os}
                    {s.mobile && <> <Badge>mobile</Badge></>}
                    <span className="cell-sub">{s.gpu}</span>
                  </div>
                </td>
                <td className="mono" data-label="Build">{s.build}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-foot pager">
        <span className="meta">
          page <span className="mono">{page.page}</span> of <span className="mono">{pages}</span>, <span className="mono">{formatNumber(page.total)}</span> sessions
        </span>
        {page.page > 1 && (
          <a className="btn small" href={go(page.page - 1)}>
            Newer
          </a>
        )}
        {page.page < pages && (
          <a className="btn small" href={go(page.page + 1)}>
            Older
          </a>
        )}
      </div>
    </section>
  );
}

export function Sessions({ query }: { query: Record<string, string> }) {
  const q = query.q ?? "";
  const pageNo = Math.max(1, Number(query.page) || 1);
  const st = useApi("GET /api/sessions", { query: { q, page: pageNo, pageSize: PAGE_SIZE } });
  const [text, setText] = useState(q);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(hrefFor({ page: "sessions", query: { q: text.trim() } }));
  };
  return (
    <div className="page">
      <PageHead title="Sessions" lede="One row per page load that sent telemetry. Visitor keys rotate daily, so nothing here links a person across days." />
      <div className="toolbar">
        <form className="search" role="search" onSubmit={submit}>
          <input type="search" name="q" aria-label="Search sessions" placeholder="Session id, country, class, browser, build" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit">Search</button>
        </form>
      </div>
      <Loaded state={st}>{(page) => <SessionsTable page={page} query={{ q }} />}</Loaded>
    </div>
  );
}

function eventData(e: SessionEvent): string {
  return Object.entries(e.data)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("  ");
}

export function SessionDetailView({ d }: { d: SessionDetail }) {
  const s = d.session;
  return (
    <>
      <div className="duo">
        <Panel icon="sessions" title="Session">
          <dl className="facts">
            <dt>Started</dt>
            <dd className="mono"><Time ms={s.startedAt} /></dd>
            <dt>Last seen</dt>
            <dd className="mono"><Time ms={s.lastSeen} /></dd>
            <dt>Played</dt>
            <dd className="mono">{formatDuration(s.playSeconds)}</dd>
            <dt>Furthest view</dt>
            <dd><Badge tone={s.furthest === "game" ? "ok" : "plain"}>{s.furthest}</Badge></dd>
            <dt>Exile</dt>
            <dd>{s.classId ? <>{titleCase(s.classId)}{s.maxLevel !== null && <span className="mono"> level {s.maxLevel}</span>}{s.ageDays !== null && <span className="muted">, character {s.ageDays} d old</span>}</> : <span className="faint">-</span>}</dd>
            <dt>Maps, deaths</dt>
            <dd className="mono">{s.maps}, {s.deaths}</dd>
            <dt>Errors</dt>
            <dd className="mono"><N v={s.errors} tone={s.errors > 0 ? "fail" : null} /></dd>
            <dt>Build</dt>
            <dd className="mono">{s.build}</dd>
            <dt>Referrer</dt>
            <dd className="mono">{s.referrer || <span className="faint">-</span>}</dd>
            <dt>Visitor</dt>
            <dd className="mono">{s.visitor}</dd>
          </dl>
        </Panel>
        <Panel icon="exiles" title="Client">
          <dl className="facts">
            <dt>From</dt>
            <dd><Country code={s.country} city={s.city} /></dd>
            <dt>Network</dt>
            <dd className="mono">{d.ipPrefix ?? <span className="faint">-</span>}</dd>
            <dt>Browser</dt>
            <dd>{s.browser} on {s.os}{s.mobile && <> <Badge>mobile</Badge></>}</dd>
            <dt>GPU</dt>
            <dd className="mono">{s.gpu}</dd>
            <dt>Screen</dt>
            <dd className="mono">{s.screen} @{d.dpr}x</dd>
            <dt>Cores, memory</dt>
            <dd className="mono">{d.cores}, {d.memGb} GB</dd>
            <dt>Language</dt>
            <dd className="mono">{d.lang}</dd>
            <dt>Touch, PWA</dt>
            <dd className="mono">{d.touch ? "yes" : "no"}, {d.pwa ? "yes" : "no"}</dd>
          </dl>
          <div className="panel-head sub">
            <h2>Same day</h2>
            <span className="meta">same visitor key</span>
          </div>
          {d.sameDay.length ? (
            <ul className="checks">
              {d.sameDay.map((sid) => (
                <li key={sid}>
                  <span className="badge">session</span>
                  <a className="mono" href={hrefFor({ page: "sessions", id: sid })}>{sid}</a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="idle"><span>No other session that day.</span></div>
          )}
        </Panel>
      </div>
      <Panel icon="clock" title="Timeline" meta={<><span className="mono">{d.events.length}</span> events</>}>
        <div className="scroll">
          <table className="stack">
            <thead>
              <tr>
                <th>Time</th>
                <th className="num">After</th>
                <th>Event</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {d.events.length === 0 && <EmptyRow cols={4}>No events stored for this session.</EmptyRow>}
              {[...d.events].sort((a, b) => a.t - b.t).map((e, i) => (
                <tr key={`${e.t}-${i}`}>
                  <td className="t" data-label="Time">{formatClock(e.t)}</td>
                  <td className="num" data-label="After">{formatDuration((e.t - s.startedAt) / 1000)}</td>
                  <td data-label="Event"><Badge tone={e.k === "error" ? "fail" : "plain"}>{e.k}</Badge></td>
                  <td className="key" data-label="Data">{eventData(e) || <span className="faint">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function SessionDetailPage({ sid }: { sid: string }) {
  const st = useApi("GET /api/sessions/:sid", { params: { sid } });
  return (
    <div className="page">
      <PageHead title="Session" id={sid} lede={<a href={hrefFor({ page: "sessions" })}>All sessions</a>} />
      <Loaded state={st}>{(d) => <SessionDetailView d={d} />}</Loaded>
    </div>
  );
}
