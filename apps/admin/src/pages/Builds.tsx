import type { BuildRow } from "@exiled/telemetry";
import { formatNumber } from "../format";
import { hrefFor } from "../router";
import { useApi } from "../use-api";
import { EmptyRow, Loaded, N, PageHead, Time } from "../ui";

export function BuildsTable({ rows }: { rows: BuildRow[] }) {
  const sorted = [...rows].sort((a, b) => b.builtAt - a.builtAt);
  return (
    <div className="scroll">
      <table className="stack">
        <thead>
          <tr>
            <th>Build</th>
            <th>Built</th>
            <th>First seen</th>
            <th>Last seen</th>
            <th className="num">Sessions</th>
            <th className="num">Errors</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <EmptyRow cols={6}>No build has reported yet.</EmptyRow>}
          {sorted.map((b) => (
            <tr key={b.build}>
              <td className="mono strong" data-label="Build">{b.build}</td>
              <td className="t" data-label="Built"><Time ms={b.builtAt} /></td>
              <td className="t" data-label="First seen"><Time ms={b.firstSeen} /></td>
              <td className="t" data-label="Last seen"><Time ms={b.lastSeen} /></td>
              <td className="num" data-label="Sessions">{formatNumber(b.sessions)}</td>
              <td className="num" data-label="Errors">
                {b.errors > 0 ? <a href={hrefFor({ page: "errors", query: { status: "all" } })}><N v={formatNumber(b.errors)} tone="fail" /></a> : 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Builds() {
  const st = useApi("GET /admin/api/builds");
  return (
    <div className="page">
      <PageHead title="Builds" lede="Every client build that has sent telemetry. Live ops can tell builds older than one of these to reload." />
      <Loaded state={st}>{(rows) => <BuildsTable rows={rows} />}</Loaded>
    </div>
  );
}
