import type { AgeBucket, Behaviour as BehaviourData } from "@exiled/telemetry";
import { formatNumber, formatPct } from "../format";
import { useApi } from "../use-api";
import { EmptyRow, Figure, Loaded, N, PageHead, Panel, RangePicker, Reading, rangeDays, sum } from "../ui";

/** What each action means to a reader, by event kind and key. */
const LABEL: Record<string, (key: string) => string> = {
  device: (k) => ({ open: "Map device opened", select: "Atlas node picked", socket: "Waystone seated", activate: "Map opened", close: "Map device closed" })[k] ?? k,
  atlas: (k) => `Opened a tier ${k} map`,
  portal: (k) => (k === "map" ? "Portal into a map" : "Portal to the hideout"),
  rareSeen: () => "Rare monster seen",
  rareKill: () => "Rare monster killed",
  bossSeen: () => "Boss woke",
  bossFight: () => "Boss hit",
  respawn: (k) => (k === "checkpoint" ? "Came back at the checkpoint" : "Came back in the hideout"),
  createFail: (k) => ({ short: "Name refused: too short", long: "Name refused: too long", charset: "Name refused: letters", taken: "Name refused: taken" })[k] ?? k,
  reload: (k) => (k === "chunk" ? "Reloaded: stale deploy" : "Reloaded: WebGL lost"),
};

/** Panels in reading order: the hideout, then the map, then the ways out. */
const GROUPS: { title: string; kinds: string[] }[] = [
  { title: "Map device and Atlas", kinds: ["device", "atlas", "portal"] },
  { title: "In maps", kinds: ["rareSeen", "rareKill", "bossSeen", "bossFight"] },
  { title: "Deaths, names and reloads", kinds: ["respawn", "createFail", "reload"] },
];

const AGES: (AgeBucket | "none")[] = ["none", "0", "1", "2-6", "7-29", "30+"];
const AGE_LABEL: Record<AgeBucket | "none", string> = { none: "No character yet", "0": "Today", "1": "Yesterday", "2-6": "2 to 6 days", "7-29": "7 to 29 days", "30+": "30 days or more" };

function ActionTable({ rows }: { rows: BehaviourData["actions"] }) {
  return (
    <div className="scroll">
      <table className="stack">
        <thead>
          <tr>
            <th>What</th>
            <th className="num">Sessions</th>
            <th className="num">Times</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={3}>Nobody did this in this range.</EmptyRow>}
          {rows.map((a) => (
            <tr key={`${a.kind}:${a.key}`}>
              <td className="key" data-label="What">{LABEL[a.kind]?.(a.key) ?? `${a.kind} ${a.key}`}</td>
              <td className="num" data-label="Sessions">{formatNumber(a.sessions)}</td>
              <td className="num" data-label="Times">{formatNumber(a.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BehaviourView({ b }: { b: BehaviourData }) {
  const boots = sum(AGES.map((a) => b.rosters[a]));
  const returning = boots - b.rosters.none;
  return (
    <>
      <section className="readings" aria-label="Totals">
        <Reading icon="retention" label="Browsers with a character" proofIcon="sessions" proof={<>of <span className="mono">{formatNumber(boots)}</span> boots that sent telemetry</>}>
          <Figure><N v={formatPct(boots ? returning / boots : null)} /></Figure>
        </Reading>
        <Reading icon="loot" label="Caches opened" proofIcon="sessions" proof={<>in <span className="mono">{formatNumber(b.caches.sessions)}</span> sessions</>}>
          <Figure><N v={formatNumber(b.caches.opened)} /></Figure>
        </Reading>
      </section>
      {GROUPS.map((g) => (
        <Panel key={g.title} icon="gameplay" title={g.title}>
          <ActionTable rows={b.actions.filter((a) => g.kinds.includes(a.kind))} />
        </Panel>
      ))}
      <div className="duo">
        <Panel icon="clock" title="Where sessions ended">
          <div className="scroll">
            <table className="stack">
              <thead>
                <tr>
                  <th>Screen</th>
                  <th>State</th>
                  <th className="num">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {b.exits.length === 0 && <EmptyRow cols={3}>No session ended with its place reported in this range.</EmptyRow>}
                {b.exits.map((e) => (
                  <tr key={`${e.view}:${e.area}:${e.loading}`}>
                    <td className="key" data-label="Screen">{e.area ? `${e.view} (${e.area})` : e.view}</td>
                    <td data-label="State">{e.loading ? "on the loading screen" : "playing"}</td>
                    <td className="num" data-label="Sessions">{formatNumber(e.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel icon="retention" title="Boots by oldest character" meta="a return shows here without entering the game">
          <div className="scroll">
            <table className="stack">
              <thead>
                <tr>
                  <th>Oldest character</th>
                  <th className="num">Boots</th>
                </tr>
              </thead>
              <tbody>
                {AGES.map((a) => (
                  <tr key={a}>
                    <td className="key" data-label="Oldest character">{AGE_LABEL[a]}</td>
                    <td className="num" data-label="Boots">{formatNumber(b.rosters[a])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function Behaviour({ query }: { query: Record<string, string> }) {
  const days = rangeDays(query, [1, 7, 30, 90], 7);
  const st = useApi("GET /api/behaviour", { query: { days } });
  return (
    <div className="page">
      <PageHead title="Behaviour" lede="What players did that the funnel cannot show: the map device, rares and bosses, deaths, refused names, reloads, and where sessions ended." />
      <div className="toolbar">
        <RangePicker page="behaviour" query={query} days={days} />
      </div>
      <Loaded state={st}>{(b) => <BehaviourView b={b} />}</Loaded>
    </div>
  );
}
