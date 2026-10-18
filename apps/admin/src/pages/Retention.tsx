import { AGE_BUCKETS, type AgeBucket, type Retention as RetentionData } from "@exiled/telemetry";
import { ColumnChart, HBars, type ChartTone } from "../charts";
import { formatDuration, formatHours, formatNumber, formatPct } from "../format";
import { useApi } from "../use-api";
import { Figure, Loaded, N, PageHead, Panel, RangePicker, Reading, rangeDays, sum } from "../ui";

const OPTIONS = [7, 30, 90] as const;

/** Older characters wear rarer colours: loyalty is the rare drop. */
export const AGE_TONE: Record<AgeBucket, ChartTone> = { "0": "faint", "1": "normal", "2-6": "magic", "7-29": "rare", "30+": "unique" };
export const AGE_LABEL: Record<AgeBucket, string> = { "0": "new today", "1": "1 day", "2-6": "2-6 days", "7-29": "7-29 days", "30+": "30+ days" };

const short = (s: number) => formatDuration(s).replace(/ 0+[smh]$/, "");

export function RetentionView({ r }: { r: RetentionData }) {
  const sessions = sum(r.days.map((d) => d.sessions));
  const visitors = sum(r.days.map((d) => d.visitors));
  const play = sum(r.days.map((d) => d.playSeconds));
  const newChars = sum(r.days.map((d) => d.newCharacters));
  const entries = sum(AGE_BUCKETS.map((b) => r.ageTotals[b] ?? 0));
  const returning = entries ? (entries - (r.ageTotals["0"] ?? 0)) / entries : null;
  return (
    <>
      <section className="readings" aria-label="Totals">
        <Reading icon="sessions" label="Sessions" proofIcon="exiles" proof={<><span className="mono">{formatNumber(visitors)}</span> visitor-days</>}>
          <Figure><N v={formatNumber(sessions)} /></Figure>
        </Reading>
        <Reading icon="hourglass" label="Hours played" proofIcon="clock" proof={<><span className="mono">{sessions ? formatDuration(play / sessions) : "-"}</span> per session</>}>
          <Figure><N v={formatHours(play)} /><small>hours</small></Figure>
        </Reading>
        <Reading icon="retention" label="Returning entries" proofIcon="exiles" proof={<><span className="mono">{formatNumber(newChars)}</span> new characters</>}>
          {returning === null ? <span className="figure none">no entries</span> : <Figure><N v={formatPct(returning)} /></Figure>}
        </Reading>
      </section>
      <Panel icon="retention" title="Game entries by character age" meta="per day, UTC">
        <ColumnChart
          label="Game entries per day, stacked by character age"
          columns={[...r.days].reverse().map((d) => ({ label: d.date.slice(5), values: AGE_BUCKETS.map((b) => d.byAge[b] ?? 0) }))}
          keys={AGE_BUCKETS.map((b) => ({ label: AGE_LABEL[b], tone: AGE_TONE[b] }))}
        />
      </Panel>
      <div className="duo">
        <Panel icon="clock" title="Session length">
          <ColumnChart
            label="Sessions by length"
            columns={r.lengths.map((l) => ({ label: l.to === null ? `${short(l.from)}+` : `<${short(l.to)}`, values: [l.count] }))}
            keys={[{ label: "Sessions", tone: "text" }]}
          />
        </Panel>
        <Panel icon="exiles" title="Character age" meta="all game entries in range">
          <HBars items={AGE_BUCKETS.map((b) => ({ key: b, label: AGE_LABEL[b], value: r.ageTotals[b] ?? 0, tone: AGE_TONE[b], note: entries ? formatPct((r.ageTotals[b] ?? 0) / entries) : undefined }))} />
        </Panel>
      </div>
    </>
  );
}

export function Retention({ query }: { query: Record<string, string> }) {
  const days = rangeDays(query, OPTIONS, 30);
  const st = useApi("GET /api/retention", { query: { days } });
  return (
    <div className="page">
      <PageHead title="Retention" lede="Who comes back, read from the age of the character a save already holds, never from an id." />
      <div className="toolbar">
        <RangePicker page="retention" query={query} days={days} options={OPTIONS} />
      </div>
      <Loaded state={st}>{(r) => <RetentionView r={r} />}</Loaded>
    </div>
  );
}
