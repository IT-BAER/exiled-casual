import type { AuditRow } from "@exiled/telemetry";
import { useApi } from "../use-api";
import { EmptyRow, Loaded, PageHead, Time } from "../ui";

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="scroll">
      <table className="stack">
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={4}>Nothing has been changed yet.</EmptyRow>}
          {rows.map((r, i) => (
            <tr key={`${r.t}-${i}`}>
              <td className="t" data-label="Time"><Time ms={r.t} /></td>
              <td className="strong" data-label="User">{r.user}</td>
              <td className="mono" data-label="Action">{r.action}</td>
              <td className="key" data-label="Detail">{r.detail || <span className="faint">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Audit() {
  const st = useApi("GET /admin/api/audit");
  return (
    <div className="page">
      <PageHead title="Audit" lede="What was done from this console and by whom, newest first." />
      <Loaded state={st}>{(rows) => <AuditTable rows={rows} />}</Loaded>
    </div>
  );
}
