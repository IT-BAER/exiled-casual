import type { LoadPhase, Perf, PerfRow } from "@exiled/telemetry";
import { LineChart } from "../charts";
import { formatDay, formatNumber } from "../format";
import { useApi } from "../use-api";
import { EmptyRow, Figure, Loaded, N, PageHead, Panel, RangePicker, Reading, rangeDays } from "../ui";

/** Below 30 fps play feels heavy; below 15 it is broken. */
function fpsTone(fps: number | null): "fail" | "warn" | null {
  if (fps === null) return null;
  if (fps < 15) return "fail";
  if (fps < 30) return "warn";
  return null;
}

const fps = (v: number | null) => (v === null ? <span className="faint">-</span> : <N v={Math.round(v)} tone={fpsTone(v)} />);
const secs = (ms: number | null) => (ms === null ? "-" : (ms / 1000).toFixed(1));

/** Name and span of each load phase (apps/web/src/load-phases.ts). Models and worker run side by side. */
const PHASE: Record<LoadPhase, [string, string]> = {
  chunk: ["Code", "Play pressed to the game's code running"],
  models: ["Models", "characters, props and monsters downloaded and parsed"],
  worker: ["Simulation", "the sim worker started and the save restored"],
  shaders: ["Shaders", "everything in, until frames come at a playable pace"],
  frame: ["Total", "Play pressed to the loading screen lifting"],
};

function PerfTable({ rows, keyLabel }: { rows: PerfRow[]; keyLabel: string }) {
  return (
    <div className="scroll">
      <table className="stack">
        <thead>
          <tr>
            <th>{keyLabel}</th>
            <th className="num">Sessions</th>
            <th className="num">FPS p50</th>
            <th className="num">FPS p5</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={4}>No frame rates reported in this range.</EmptyRow>}
          {[...rows].sort((a, b) => b.sessions - a.sessions).map((r) => (
            <tr key={r.key}>
              <td className="key" data-label={keyLabel}>{r.key}</td>
              <td className="num" data-label="Sessions">{formatNumber(r.sessions)}</td>
              <td className="num" data-label="FPS p50">{fps(r.fpsP50)}</td>
              <td className="num" data-label="FPS p5">{fps(r.fpsP5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PerformanceView({ p, days }: { p: Perf; days: number }) {
  return (
    <>
      <section className="readings" aria-label="Load times">
        <Reading icon="clock" label="Menu load" proofIcon="chart" proof={<>p90 <span className="mono">{secs(p.menuLoadMs.p90)} s</span>, navigation to first menu paint</>}>
          {p.menuLoadMs.p50 === null ? <span className="figure none">no loads</span> : <Figure><N v={secs(p.menuLoadMs.p50)} /><small>s p50</small></Figure>}
        </Reading>
        <Reading icon="gameplay" label="Game load" proofIcon="chart" proof={<>p90 <span className="mono">{secs(p.gameLoadMs.p90)} s</span>, to the first game frame</>}>
          {p.gameLoadMs.p50 === null ? <span className="figure none">no loads</span> : <Figure><N v={secs(p.gameLoadMs.p50)} /><small>s p50</small></Figure>}
        </Reading>
        <Reading icon="performance" label="Median FPS" proofIcon="sessions" proof="latest bucket of the series below">
          {p.fpsSeries.length === 0 ? <span className="figure none">no frames</span> : <Figure>{fps(p.fpsSeries[p.fpsSeries.length - 1]!.v)}<small>fps</small></Figure>}
        </Reading>
      </section>
      <Panel icon="clock" title="Game load by phase" meta="median and p90, seconds">
        <div className="scroll">
          <table className="stack">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Spans</th>
                <th className="num">Loads</th>
                <th className="num">p50</th>
                <th className="num">p90</th>
              </tr>
            </thead>
            <tbody>
              {p.loadPhases.map((l) => (
                <tr key={l.phase}>
                  <td className="key" data-label="Phase">{PHASE[l.phase][0]}</td>
                  <td data-label="Spans">{PHASE[l.phase][1]}</td>
                  <td className="num" data-label="Loads">{formatNumber(l.n)}</td>
                  <td className="num" data-label="p50">{secs(l.p50)}</td>
                  <td className="num" data-label="p90">{secs(l.p90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel icon="chart" title="Frame rate over time">
        <LineChart label="Median frame rate over time" series={[{ label: "FPS", points: p.fpsSeries, tone: "text" }]} format={(v) => String(Math.round(v))} timeFormat={days > 1 ? formatDay : undefined} />
      </Panel>
      <div className="duo">
        <Panel icon="performance" title="By GPU">
          <PerfTable rows={p.byGpu} keyLabel="GPU" />
        </Panel>
        <Panel icon="exiles" title="By browser">
          <PerfTable rows={p.byBrowser} keyLabel="Browser" />
        </Panel>
      </div>
    </>
  );
}

export function Performance({ query }: { query: Record<string, string> }) {
  const days = rangeDays(query, [1, 7, 30, 90], 7);
  const st = useApi("GET /api/perf", { query: { days } });
  return (
    <div className="page">
      <PageHead title="Performance" lede="Frame rates by hardware and browser, and how long the menu and the game take to appear." />
      <div className="toolbar">
        <RangePicker page="performance" query={query} days={days} />
      </div>
      <Loaded state={st}>{(p) => <PerformanceView p={p} days={days} />}</Loaded>
    </div>
  );
}
