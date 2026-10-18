import type { Traffic as TrafficData } from "@exiled/telemetry";
import { ColumnChart, HBars } from "../charts";
import { formatNumber, formatPct } from "../format";
import { useApi } from "../use-api";
import { EmptyRow, Figure, Loaded, N, PageHead, Panel, RangePicker, Reading, rangeDays, sum } from "../ui";

export function TrafficView({ t }: { t: TrafficData }) {
  const loads = sum(t.days.map((d) => d.pageLoads));
  const humans = sum(t.days.map((d) => d.humans));
  const bots = sum(t.days.map((d) => d.bots));
  const sessions = sum(t.days.map((d) => d.sessions));
  const statuses = [...t.statuses].sort((a, b) => a.status - b.status);
  return (
    <>
      <section className="readings" aria-label="Totals">
        <Reading icon="traffic" label="Human page loads" proofIcon="operations" proof={<><span className="mono">{formatNumber(bots)}</span> bot loads, <span className="mono">{formatNumber(loads)}</span> in all</>}>
          <Figure><N v={formatNumber(humans)} /></Figure>
        </Reading>
        <Reading icon="sessions" label="Sessions" proofIcon="chart" proof={<><span className="mono">{formatPct(humans ? sessions / humans : null)}</span> of human loads</>}>
          <Figure><N v={formatNumber(sessions)} /></Figure>
        </Reading>
        <Reading icon="errors" label="Bounced before boot" proofIcon="clock" proof="human loads of / that sent no telemetry (approximate)">
          <Figure><N v={formatNumber(t.bouncedBeforeBoot)} /><small>{formatPct(humans ? t.bouncedBeforeBoot / humans : null)}</small></Figure>
        </Reading>
      </section>
      <Panel icon="chart" title="Per day" meta="UTC">
        <ColumnChart
          label="Human page loads, bot loads per day"
          columns={[...t.days].reverse().map((d) => ({ label: d.date.slice(5), values: [d.humans, d.bots] }))}
          keys={[
            { label: "Humans", tone: "text" },
            { label: "Bots", tone: "faint" },
          ]}
        />
        <div className="scroll">
          <table className="stack">
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Page loads</th>
                <th className="num">Humans</th>
                <th className="num">Bots</th>
                <th className="num">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {t.days.length === 0 && <EmptyRow cols={5}>No traffic in this range.</EmptyRow>}
              {t.days.map((d) => (
                <tr key={d.date}>
                  <td className="t" data-label="Day">{d.date}</td>
                  <td className="num" data-label="Page loads">{formatNumber(d.pageLoads)}</td>
                  <td className="num" data-label="Humans">{formatNumber(d.humans)}</td>
                  <td className="num" data-label="Bots">{formatNumber(d.bots)}</td>
                  <td className="num" data-label="Sessions">{formatNumber(d.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="duo">
        <Panel icon="atlas" title="Referrers">
          <HBars items={t.referrers.map((r) => ({ key: r.referrer, label: r.referrer || "(direct)", value: r.visits }))} empty="No referrers in this range." />
        </Panel>
        <Panel icon="logs" title="Paths">
          <HBars items={t.paths.map((p) => ({ key: p.path, label: <span className="mono">{p.path}</span>, value: p.hits }))} empty="No requests in this range." />
        </Panel>
      </div>
      <div className="duo">
        <Panel icon="health" title="Statuses">
          <HBars
            items={statuses.map((s) => ({ key: String(s.status), label: <N v={s.status} tone={s.status >= 500 ? "fail" : s.status >= 400 ? "warn" : null} />, value: s.hits, tone: s.status >= 500 ? "fail" : s.status >= 400 ? "warn" : "muted" }))}
            empty="No requests in this range."
          />
        </Panel>
        <Panel icon="operations" title="Bots" meta="by user agent">
          <HBars items={t.bots.map((b) => ({ key: b.agent, label: b.agent, value: b.hits, tone: "faint" }))} empty="No bots in this range." />
        </Panel>
      </div>
    </>
  );
}

export function Traffic({ query }: { query: Record<string, string> }) {
  const days = rangeDays(query, [1, 7, 30, 90], 7);
  const st = useApi("GET /admin/api/traffic", { query: { days } });
  return (
    <div className="page">
      <PageHead title="Traffic" lede="Page loads from nginx against sessions from telemetry: who arrives, who is a bot, who leaves before the game boots." />
      <div className="toolbar">
        <RangePicker page="traffic" query={query} days={days} />
      </div>
      <Loaded state={st}>{(t) => <TrafficView t={t} />}</Loaded>
    </div>
  );
}
