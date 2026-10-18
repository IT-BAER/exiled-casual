import type { Milestone, Overview } from "@exiled/telemetry";
import { HBars, LineChart } from "../charts";
import { formatDuration, formatHours, formatNumber, formatPct, formatTime } from "../format";
import { orderMilestones } from "../milestones";
import { hrefFor } from "../router";
import { useApi } from "../use-api";
import { Country, Figure, Loaded, N, PageHead, Panel, Reading } from "../ui";
import { ChecksList } from "./Health";

function Plaque({ m }: { m: Milestone }) {
  const locked = m.unlockedAt === null;
  return (
    <article className={`plaque framed r-${m.rarity}${locked ? " locked" : ""}`} aria-label={`${m.title}, ${locked ? "locked" : "unlocked"}`}>
      <div className={`plaque-band r-${m.rarity}`}>
        <h3>{m.title}</h3>
      </div>
      <p className="plaque-desc">{m.desc}</p>
      <meter min={0} max={Math.max(1, m.target)} value={Math.min(m.progress, m.target)} aria-label={`${m.title} progress`} />
      <div className="plaque-figs">
        <span>
          <strong>{formatNumber(m.progress)}</strong> / {formatNumber(m.target)}
        </span>
        <span>{locked ? "locked" : <time dateTime={new Date(m.unlockedAt!).toISOString()}>{formatTime(m.unlockedAt!)}</time>}</span>
      </div>
    </article>
  );
}

function status(o: Overview): { tone: "ok" | "warn" | "fail"; text: string } {
  if (o.health.state === "fail") return { tone: "fail", text: "A health check is failing." };
  if (o.errorsLastHour > 0) return { tone: "warn", text: `${formatNumber(o.errorsLastHour)} client errors in the last hour.` };
  if (o.health.state === "warn") return { tone: "warn", text: "A health check is near its limit." };
  return { tone: "ok", text: "Nothing needs your attention." };
}

export function DashboardView({ o }: { o: Overview }) {
  const s = status(o);
  const milestones = orderMilestones(o.milestones);
  const unlocked = milestones.filter((m) => m.unlockedAt !== null).length;
  return (
    <>
      <PageHead title="Dashboard" lede={s.text} status={s.tone} />
      <section className="readings" aria-label="Today">
        <Reading icon="live" label="Exiles online" proofIcon="peak" proof={<>peak today <span className="mono">{formatNumber(o.peakToday)}</span>, all-time <span className="mono">{formatNumber(o.peakAllTime.v)}</span></>}>
          <Figure>
            <N v={formatNumber(o.liveNow)} />
            <small>in the world</small>
          </Figure>
        </Reading>
        <Reading icon="sessions" label="Sessions today" proofIcon="exiles" proof={<><span className="mono">{formatNumber(o.visitorsToday)}</span> distinct visitors today</>}>
          <Figure>
            <N v={formatNumber(o.sessionsToday)} />
            <small>sessions</small>
          </Figure>
        </Reading>
        <Reading icon="hourglass" label="Hours played today" proofIcon="clock" proof="visible play time, summed over every session">
          <Figure>
            <N v={formatHours(o.playSecondsToday)} />
            <small>hours</small>
          </Figure>
        </Reading>
      </section>
      <section className="readings" aria-label="This week">
        <Reading icon="retention" label="Returning exiles (7 d)" proofIcon="exiles" proof="game entries with a character older than a day">
          <Figure>
            <N v={formatPct(o.returningShare7d)} />
          </Figure>
        </Reading>
        <Reading icon="clock" label="Avg session" proofIcon="chart" proof="last 7 days, sessions that reached the menu">
          <Figure>
            <N v={formatDuration(o.avgSessionSeconds7d)} />
          </Figure>
        </Reading>
        <Reading
          icon="errors"
          label="Errors last hour"
          proofIcon="errors"
          proof={
            <>
              <a href={hrefFor({ page: "errors" })}>
                <span className="mono">{formatNumber(o.newErrorGroups24h)}</span> new groups in 24 h
              </a>
            </>
          }
        >
          <Figure>
            <N v={formatNumber(o.errorsLastHour)} tone={o.errorsLastHour > 0 ? "fail" : null} />
            <small>errors</small>
          </Figure>
        </Reading>
      </section>
      <div className="duo wide-left">
        <Panel icon="chart" title="Last 48 hours" meta="hourly">
          <LineChart
            label="Sessions started and exiles online per hour, last 48 hours"
            series={[
              { label: "Sessions", points: o.sessionsSeries, tone: "text" },
              { label: "Online", points: o.liveSeries, tone: "muted" },
            ]}
          />
        </Panel>
        <Panel icon="globe" title="Top countries" meta={<a href={hrefFor({ page: "atlas" })}>Atlas</a>}>
          <HBars
            items={o.topCountries.map((c) => ({ key: c.country, label: <Country code={c.country} />, value: c.sessions }))}
            empty="No sessions with a country yet."
          />
        </Panel>
      </div>
      <div className="duo wide-left">
        <Panel icon="trophy" title="Milestones" meta={<><span className="mono">{unlocked}</span> of <span className="mono">{milestones.length}</span> unlocked</>}>
          {milestones.length ? (
            <div className="plaques">
              {milestones.map((m) => (
                <Plaque key={m.id} m={m} />
              ))}
            </div>
          ) : (
            <div className="idle">
              <span>No milestones defined.</span>
            </div>
          )}
        </Panel>
        <Panel icon="health" title="Health" meta={<a href={hrefFor({ page: "health" })}>Details</a>}>
          <ChecksList summary={o.health} />
        </Panel>
      </div>
    </>
  );
}

export function Dashboard() {
  const st = useApi("GET /admin/api/overview", {}, 30_000);
  return (
    <div className="page">
      <Loaded state={st}>{(o) => <DashboardView o={o} />}</Loaded>
    </div>
  );
}
