import { useState, type FormEvent } from "react";
import type { LogLine, LogSource } from "@exiled/telemetry";
import { formatBytes } from "../format";
import { hrefFor, navigate } from "../router";
import { useApi } from "../use-api";
import { Loaded, N, PageHead, Panel, Seg } from "../ui";

const SOURCES: LogSource[] = ["access", "error", "server"];
const STATUS_CLASSES = ["", "2xx", "3xx", "4xx", "5xx"] as const;
const LIMIT = 200;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function stamp(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function statusTone(s: number | undefined): "fail" | "warn" | null {
  if (s === undefined) return null;
  if (s >= 500) return "fail";
  if (s >= 400) return "warn";
  return null;
}

function levelTone(l: string | undefined): "fail" | "warn" | null {
  const v = (l ?? "").toLowerCase();
  if (["error", "fatal", "crit", "alert", "emerg"].includes(v)) return "fail";
  if (["warn", "warning"].includes(v)) return "warn";
  return null;
}

export function LogRows({ lines }: { lines: LogLine[] }) {
  if (lines.length === 0) {
    return (
      <div className="idle">
        <span>No log lines match.</span>
      </div>
    );
  }
  return (
    <ol className="log" aria-label="Log lines">
      {lines.map((l, i) => (
        <li key={`${l.t}-${i}`} className={l.bot ? "bot" : undefined}>
          <span className="lt">{stamp(l.t)}</span>
          {l.source === "access" ? (
            <>
              <span>{l.status !== undefined ? <N v={l.status} tone={statusTone(l.status)} /> : "-"}</span>
              <span className="lx">
                {l.method} {l.path}
                <span className="muted">
                  {"  "}
                  {l.ip}
                  {l.bytes !== undefined ? `  ${formatBytes(l.bytes)}` : ""}
                  {l.referrer ? `  from ${l.referrer}` : ""}
                  {l.ua ? `  ${l.ua}` : ""}
                </span>
                {!l.method && !l.path && l.text}
              </span>
            </>
          ) : (
            <>
              <span>
                <N v={l.level ?? "-"} tone={levelTone(l.level)} />
              </span>
              <span className="lx">{l.text}</span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Logs({ query }: { query: Record<string, string> }) {
  const source: LogSource = SOURCES.includes(query.source as LogSource) ? (query.source as LogSource) : "access";
  const q = query.q ?? "";
  const status = (STATUS_CLASSES as readonly string[]).includes(query.status ?? "") ? query.status! : "";
  const bots = query.bots === "1";
  const tail = query.tail === "1";
  const st = useApi(
    "GET /admin/api/logs",
    { query: { source, q, status: source === "access" ? status : undefined, bots: source === "access" ? (bots ? 1 : 0) : undefined, limit: LIMIT } },
    tail ? 5_000 : undefined,
  );
  const [text, setText] = useState(q);
  const set = (patch: Record<string, string>) => navigate(hrefFor({ page: "logs", query: { ...query, ...patch } }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ q: text.trim() });
  };
  return (
    <div className="page">
      <PageHead title="Logs" lede="The newest lines of nginx's access and error logs and the telemetry server's own log." />
      <div className="toolbar">
        <Seg label="Source" items={SOURCES.map((s) => ({ label: s, href: hrefFor({ page: "logs", query: { ...query, source: s } }), current: s === source }))} />
        <form className="search" role="search" onSubmit={submit}>
          <input type="search" aria-label="Filter lines" placeholder={source === "access" ? "Path, IP or agent" : "Text"} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit">Filter</button>
        </form>
        {source === "access" && (
          <>
            <label>
              Status
              <select value={status} onChange={(e) => set({ status: e.target.value })}>
                {STATUS_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c || "any"}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={bots} onChange={(e) => set({ bots: e.target.checked ? "1" : "" })} />
              Show bots
            </label>
          </>
        )}
        <label className="check end">
          <input type="checkbox" checked={tail} onChange={(e) => set({ tail: e.target.checked ? "1" : "" })} />
          Follow (every 5 s)
        </label>
      </div>
      <Panel icon="logs" title={`${source[0]!.toUpperCase()}${source.slice(1)} log`} meta={st.data ? <>newest <span className="mono">{st.data.length}</span> lines</> : undefined}>
        <Loaded state={st}>{(lines) => <LogRows lines={lines} />}</Loaded>
      </Panel>
    </div>
  );
}
