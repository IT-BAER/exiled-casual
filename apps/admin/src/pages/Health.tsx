import type { Health as HealthData, HealthSummary } from "@exiled/telemetry";
import { Orb, Sparkline } from "../charts";
import { formatBytes, formatClock, formatDuration, formatNumber, formatPct } from "../format";
import { useApi } from "../use-api";
import { Badge, Loaded, N, PageHead, Panel } from "../ui";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export function ChecksList({ summary }: { summary: HealthSummary }) {
  const bad = summary.checks.filter((c) => c.state !== "ok");
  if (summary.checks.length === 0) {
    return (
      <div className="idle">
        <span>No checks reported.</span>
      </div>
    );
  }
  if (bad.length === 0) {
    return (
      <div className="all-pass">
        <Badge tone="ok">ok</Badge>
        <span>
          All <span className="mono">{summary.checks.length}</span> checks pass.
        </span>
      </div>
    );
  }
  return (
    <ul className="checks">
      {bad.map((c) => (
        <li key={c.id}>
          <Badge tone={c.state === "fail" ? "fail" : "warn"}>{c.state}</Badge>
          <span className="check-name">{c.label}</span>
          <span className="check-reason">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function AllChecks({ summary }: { summary: HealthSummary }) {
  if (summary.checks.length === 0) return <ChecksList summary={summary} />;
  const order = { fail: 0, warn: 1, ok: 2 } as const;
  return (
    <ul className="checks">
      {[...summary.checks]
        .sort((a, b) => order[a.state] - order[b.state])
        .map((c) => (
          <li key={c.id}>
            <Badge tone={c.state === "ok" ? "ok" : c.state}>{c.state}</Badge>
            <span className="check-name">{c.label}</span>
            <span className="check-reason">{c.detail}</span>
          </li>
        ))}
    </ul>
  );
}

const last = (ps: { v: number }[]) => (ps.length ? ps[ps.length - 1]!.v : null);

export function HealthView({ h, at }: { h: HealthData; at: number | null }) {
  const checks = h.summary.checks;
  const failing = checks.filter((c) => c.state === "fail").length;
  const life = checks.length ? 1 - failing / checks.length : 1;
  const memFree = h.host.memTotalMb > 0 ? 1 - h.host.memUsedMb / h.host.memTotalMb : 0;
  const pct0 = (v: number) => `${Math.round(v)} %`;
  const sparks = [
    { key: "cpu", label: "CPU", points: h.series.cpu, fmt: pct0 },
    { key: "mem", label: "Memory used", points: h.series.mem, fmt: (v: number) => formatBytes(v * MB) },
    { key: "reqs", label: "Requests", points: h.series.reqs, fmt: formatNumber },
    { key: "live", label: "Exiles online", points: h.series.live, fmt: formatNumber },
  ];
  return (
    <>
      <div className="duo">
        <Panel icon="health" title="Vitals" meta={at ? <>updated <span className="mono">{formatClock(at)}</span></> : undefined}>
          <div className="orbs">
            <Orb kind="life" level={life} value={formatPct(life)} caption="Life" sub={`${failing} of ${checks.length} checks failing`} />
            <Orb kind="mana" level={memFree} value={formatPct(memFree)} caption="Mana" sub={`${formatBytes((h.host.memTotalMb - h.host.memUsedMb) * MB)} of ${formatBytes(h.host.memTotalMb * MB)} memory free`} />
          </div>
        </Panel>
        <Panel icon="errors" title="Checks" meta={<Badge tone={h.summary.state === "ok" ? "ok" : h.summary.state}>{h.summary.state}</Badge>}>
          <AllChecks summary={h.summary} />
        </Panel>
      </div>
      <div className="trio">
        <Panel icon="builds" title="Host">
          <dl className="facts">
            <dt>CPU</dt>
            <dd className="mono">{pct0(h.host.cpuPct)} of {h.host.cores} cores</dd>
            <dt>Load</dt>
            <dd className="mono">{h.host.load.map((l) => l.toFixed(2)).join("  ")}</dd>
            <dt>Memory</dt>
            <dd className="mono">{formatBytes(h.host.memUsedMb * MB)} / {formatBytes(h.host.memTotalMb * MB)}</dd>
            <dt>Disk</dt>
            <dd className="mono">{formatBytes(h.host.diskUsedGb * GB)} / {formatBytes(h.host.diskTotalGb * GB)}</dd>
            <dt>Uptime</dt>
            <dd className="mono">{formatDuration(h.host.uptimeSeconds)}</dd>
          </dl>
        </Panel>
        <Panel icon="traffic" title="nginx" meta={<Badge tone={h.nginx.up ? "ok" : "fail"}>{h.nginx.up ? "up" : "down"}</Badge>}>
          <dl className="facts">
            <dt>Active</dt>
            <dd className="mono">{h.nginx.active ?? "-"}</dd>
            <dt>Requests/s</dt>
            <dd className="mono">{h.nginx.reqPerSec === null ? "-" : h.nginx.reqPerSec.toFixed(1)}</dd>
            <dt>5xx last hour</dt>
            <dd className="mono">
              <N v={formatNumber(h.nginx.status5xxLastHour)} tone={h.nginx.status5xxLastHour > 0 ? "fail" : null} />
            </dd>
            <dt>4xx last hour</dt>
            <dd className="mono">{formatNumber(h.nginx.status4xxLastHour)}</dd>
          </dl>
        </Panel>
        <Panel icon="operations" title="Server">
          <dl className="facts">
            <dt>Uptime</dt>
            <dd className="mono">{formatDuration(h.server.uptimeSeconds)}</dd>
            <dt>Memory</dt>
            <dd className="mono">{formatBytes(h.server.rssMb * MB)}</dd>
            <dt>Database</dt>
            <dd className="mono">{formatBytes(h.server.dbMb * MB)}</dd>
            <dt>Ingest</dt>
            <dd className="mono">{formatNumber(h.server.ingestPerMin)} batches/min</dd>
            <dt>Rejected last hour</dt>
            <dd className="mono">
              <N v={formatNumber(h.server.rejectedLastHour)} tone={h.server.rejectedLastHour > 0 ? "warn" : null} />
            </dd>
            <dt>Node</dt>
            <dd className="mono">{h.server.node}</dd>
          </dl>
        </Panel>
      </div>
      <Panel icon="chart" title="Last 24 hours" meta="every 5 min">
        <div className="sparks">
          {sparks.map((s) => {
            const v = last(s.points);
            return (
              <div key={s.key}>
                <div className="head">
                  <span>{s.label}</span>
                  <span className="mono">{v === null ? "-" : s.fmt(v)}</span>
                </div>
                <Sparkline points={s.points} label={s.label} format={s.fmt} />
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

export function Health() {
  const st = useApi("GET /admin/api/health", {}, 15_000);
  return (
    <div className="page">
      <PageHead title="Health" lede="Host, nginx and the telemetry server, refreshed every 15 seconds." />
      <Loaded state={st}>{(h) => <HealthView h={h} at={st.at} />}</Loaded>
    </div>
  );
}
