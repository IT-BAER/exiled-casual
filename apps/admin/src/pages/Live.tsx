import { useEffect, useState } from "react";
import type { LiveSession } from "@exiled/telemetry";
import { formatClock, formatDuration } from "../format";
import { hrefFor } from "../router";
import { useApi } from "../use-api";
import { Badge, Country, Loaded, N, PageHead } from "../ui";

const titleCase = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** Below 30 fps play feels heavy; below 15 it is broken. */
function fpsTone(fps: number): "fail" | "warn" | null {
  if (fps < 15) return "fail";
  if (fps < 30) return "warn";
  return null;
}

function where(s: LiveSession): string {
  if (s.area === "map") return [s.biome ? titleCase(s.biome) : "Map", s.tier !== null ? `tier ${s.tier}` : null].filter(Boolean).join(", ");
  if (s.area === "hideout") return "Hideout";
  return `In the ${s.view}`;
}

function PartyCard({ s, now }: { s: LiveSession; now: number }) {
  const name = s.classId ? titleCase(s.classId) : "No character yet";
  return (
    <article className="panel party-card" aria-label={`${name}, ${where(s)}`}>
      <div className="party-head">
        <span className="avatar" aria-hidden="true">
          {s.classId ? s.classId.slice(0, 1).toUpperCase() : "?"}
        </span>
        <span className="party-name">
          <strong>{name}</strong>
          <span>{where(s)}</span>
        </span>
        {s.level !== null && (
          <span className="party-lv">
            <small>Lv</small>
            {s.level}
          </span>
        )}
      </div>
      <dl className="facts">
        <dt>From</dt>
        <dd>
          <Country code={s.country} city={s.city} />
        </dd>
        <dt>In session</dt>
        <dd className="mono">
          {formatDuration((now - s.startedAt) / 1000)} <span className="muted">({formatDuration(s.playSeconds)} played)</span>
        </dd>
        <dt>FPS</dt>
        <dd className="mono">{s.fps === null ? <span className="faint">-</span> : <N v={Math.round(s.fps)} tone={fpsTone(s.fps)} />}</dd>
        <dt>Client</dt>
        <dd>
          {s.browser} on {s.os} {s.mobile && <Badge>mobile</Badge>}
        </dd>
        <dt>Build</dt>
        <dd className="mono">{s.build}</dd>
        <dt>Session</dt>
        <dd className="mono">
          <a href={hrefFor({ page: "sessions", id: s.sid })}>{s.sid.slice(0, 8)}</a> <span className="muted">beat {formatClock(s.lastBeat)}</span>
        </dd>
      </dl>
    </article>
  );
}

export function LiveView({ sessions, now }: { sessions: LiveSession[]; now: number }) {
  if (sessions.length === 0) {
    return (
      <div className="idle">
        <span>No exile is in the world right now.</span>
      </div>
    );
  }
  const sorted = [...sessions].sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || a.startedAt - b.startedAt);
  return (
    <div className="party">
      {sorted.map((s) => (
        <PartyCard key={s.sid} s={s} now={now} />
      ))}
    </div>
  );
}

export function Live() {
  const st = useApi("GET /admin/api/live", {}, 10_000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const n = st.data?.length;
  return (
    <div className="page">
      <PageHead
        title="Exiles online now"
        lede={
          n === undefined ? "Every session the server counts as live, refreshed every 10 seconds." : <><span className="mono">{n}</span> {n === 1 ? "exile" : "exiles"} in the world, refreshed every 10 seconds.</>
        }
      />
      <Loaded state={st}>{(sessions) => <LiveView sessions={sessions} now={now} />}</Loaded>
    </div>
  );
}
