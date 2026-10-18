import { useState } from "react";
import type { ErrorDetail, ErrorGroup, ErrorStatus } from "@exiled/telemetry";
import { call } from "../api";
import { Sparkline } from "../charts";
import { formatNumber, rarityTier } from "../format";
import { hrefFor, navigate } from "../router";
import { useApi } from "../use-api";
import { Badge, EmptyRow, ErrorCallout, Loaded, PageHead, Panel, Seg, Time } from "../ui";

const FILTERS = ["open", "resolved", "ignored", "all"] as const;
type Filter = (typeof FILTERS)[number];

export function StatusBadge({ status }: { status: ErrorStatus }) {
  return <Badge tone={status === "open" ? "warn" : status === "resolved" ? "ok" : "plain"}>{status}</Badge>;
}

/** Impact as an item rarity: how many sessions the error touched. */
export function Impact({ sessions }: { sessions: number }) {
  const tier = rarityTier(sessions);
  return (
    <span title={`${tier}: ${sessions} ${sessions === 1 ? "session" : "sessions"}`}>
      <Badge rarity={tier}>
        {tier} {formatNumber(sessions)}
      </Badge>
    </span>
  );
}

export function ErrorsTable({ groups, filter }: { groups: ErrorGroup[]; filter: Filter }) {
  const sorted = [...groups].sort((a, b) => b.sessions - a.sessions || b.lastSeen - a.lastSeen);
  return (
    <section className="panel" aria-label="Error groups">
      <div className="scroll">
        <table className="stack">
          <thead>
            <tr>
              <th>Impact</th>
              <th>Error</th>
              <th>Source</th>
              <th className="num">Hits</th>
              <th>Last seen</th>
              <th>48 h</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <EmptyRow cols={7}>{filter === "open" ? "No open errors. The world is quiet." : "No error groups here."}</EmptyRow>}
            {sorted.map((g) => (
              <tr key={g.fingerprint} className="link" onClick={(e) => (e.target as HTMLElement).closest("a") || navigate(hrefFor({ page: "errors", id: g.fingerprint }))}>
                <td data-label="Impact"><Impact sessions={g.sessions} /></td>
                <td data-label="Error">
                  <div>
                    <a className="strong" href={hrefFor({ page: "errors", id: g.fingerprint })}>{g.message || "(no message)"}</a>
                    {g.topFrame && <span className="cell-sub">{g.topFrame}</span>}
                  </div>
                </td>
                <td className="mono" data-label="Source">{g.src}</td>
                <td className="num" data-label="Hits">{formatNumber(g.count)}</td>
                <td className="t" data-label="Last seen"><Time ms={g.lastSeen} /></td>
                <td className="spark" data-label="48 h"><Sparkline points={g.series} label="Hits per hour, last 48 hours" tone={g.status === "open" ? "fail" : "muted"} /></td>
                <td data-label="Status"><StatusBadge status={g.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Errors({ query }: { query: Record<string, string> }) {
  const filter: Filter = (FILTERS as readonly string[]).includes(query.status ?? "") ? (query.status as Filter) : "open";
  const st = useApi("GET /admin/api/errors", { query: { status: filter === "all" ? undefined : filter } });
  return (
    <div className="page">
      <PageHead title="Errors" lede="Client errors grouped by fingerprint. Impact wears the rarity of how many sessions it touched: normal 1, magic 2-9, rare 10-49, unique 50+." />
      <div className="toolbar">
        <Seg label="Status" items={FILTERS.map((f) => ({ label: f[0]!.toUpperCase() + f.slice(1), href: hrefFor({ page: "errors", query: { status: f } }), current: f === filter }))} />
      </div>
      <Loaded state={st}>{(groups) => <ErrorsTable groups={groups} filter={filter} />}</Loaded>
    </div>
  );
}

export function ErrorDetailView({ d, onStatus, busy }: { d: ErrorDetail; onStatus: (s: ErrorStatus) => void; busy: ErrorStatus | null }) {
  const g = d.group;
  return (
    <>
      <div className="duo">
        <Panel
          icon="errors"
          title="Group"
          foot={
            g.status === "open" ? (
              <>
                <button type="button" className="primary" disabled={busy !== null} aria-busy={busy === "resolved"} onClick={() => onStatus("resolved")}>Resolve</button>
                <button type="button" disabled={busy !== null} aria-busy={busy === "ignored"} onClick={() => onStatus("ignored")}>Ignore</button>
              </>
            ) : (
              <button type="button" disabled={busy !== null} aria-busy={busy === "open"} onClick={() => onStatus("open")}>Reopen</button>
            )
          }
        >
          <dl className="facts">
            <dt>Message</dt>
            <dd className="strong">{g.message || "(no message)"}</dd>
            <dt>Status</dt>
            <dd><StatusBadge status={g.status} /></dd>
            <dt>Impact</dt>
            <dd><Impact sessions={g.sessions} /></dd>
            <dt>Source</dt>
            <dd className="mono">{g.src}</dd>
            <dt>Hits</dt>
            <dd className="mono">{formatNumber(g.count)}</dd>
            <dt>First seen</dt>
            <dd className="mono"><Time ms={g.firstSeen} /></dd>
            <dt>Last seen</dt>
            <dd className="mono"><Time ms={g.lastSeen} /></dd>
            <dt>Builds</dt>
            <dd className="mono">{g.builds.join(", ") || "-"}</dd>
            <dt>Top frame</dt>
            <dd className="mono">{g.topFrame ?? <span className="faint">-</span>}</dd>
          </dl>
        </Panel>
        <Panel icon="logs" title="Stack">
          {d.stack ? <pre className="stack">{d.stack}</pre> : <div className="idle"><span>The client sent no stack.</span></div>}
        </Panel>
      </div>
      <Panel icon="sessions" title="Hits" meta={<>latest <span className="mono">{d.hits.length}</span></>}>
        <div className="scroll">
          <table className="stack">
            <thead>
              <tr>
                <th>Time</th>
                <th>Session</th>
                <th>Build</th>
                <th>Client</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {d.hits.length === 0 && <EmptyRow cols={5}>No hits stored.</EmptyRow>}
              {d.hits.map((h, i) => (
                <tr key={`${h.t}-${h.sid}-${i}`}>
                  <td className="t" data-label="Time"><Time ms={h.t} /></td>
                  <td className="mono" data-label="Session"><a href={hrefFor({ page: "sessions", id: h.sid })}>{h.sid.slice(0, 8)}</a></td>
                  <td className="mono" data-label="Build">{h.build}</td>
                  <td data-label="Client">{h.browser} on {h.os}</td>
                  <td className="key" data-label="URL">{h.url ?? <span className="faint">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function ErrorDetailPage({ fp }: { fp: string }) {
  const st = useApi("GET /admin/api/errors/:fp", { params: { fp } });
  const [group, setGroup] = useState<ErrorGroup | null>(null);
  const [busy, setBusy] = useState<ErrorStatus | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  const setStatus = async (status: ErrorStatus) => {
    setBusy(status);
    setDone(null);
    setFail(null);
    try {
      const g = await call("POST /admin/api/errors/:fp", { params: { fp }, body: { status } });
      setGroup(g);
      setDone(status === "open" ? "Reopened." : status === "resolved" ? "Marked resolved." : "Ignored.");
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHead title="Error" id={fp.slice(0, 12)} lede={<a href={hrefFor({ page: "errors" })}>All errors</a>} />
      {done && <p className="callout done" role="status">{done}</p>}
      {fail && <ErrorCallout>Nothing changed: {fail}</ErrorCallout>}
      <Loaded state={st}>{(d) => <ErrorDetailView d={group ? { ...d, group } : d} onStatus={setStatus} busy={busy} />}</Loaded>
    </div>
  );
}
