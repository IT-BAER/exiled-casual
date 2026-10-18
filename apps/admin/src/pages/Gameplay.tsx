import { RARITIES, type Gameplay as GameplayData } from "@exiled/telemetry";
import { ColumnChart, HBars } from "../charts";
import { formatDuration, formatNumber, formatPct } from "../format";
import { useApi } from "../use-api";
import { EmptyRow, Loaded, PageHead, Panel, RangePicker, rangeDays, sum } from "../ui";

const titleCase = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

export function GameplayView({ g }: { g: GameplayData }) {
  const entries = sum(g.classes.map((c) => c.entries));
  const lootTotal = sum(RARITIES.map((r) => g.loot[r] ?? 0));
  const first = g.funnel[0]?.sessions ?? 0;
  const maps = [...g.maps].sort((a, b) => a.biome.localeCompare(b.biome) || a.tier - b.tier);
  const levels = [...g.levels].sort((a, b) => a.level - b.level);
  return (
    <>
      <div className="duo">
        <Panel icon="exiles" title="Class picks" meta="game entries">
          <HBars
            items={[...g.classes].sort((a, b) => b.entries - a.entries).map((c) => ({
              key: c.classId,
              label: titleCase(c.classId),
              value: c.entries,
              note: `${formatPct(entries ? c.entries / entries : null)}, ${formatDuration(c.playSeconds)}`,
            }))}
            empty="No game entries in this range."
          />
        </Panel>
        <Panel icon="chart" title="Funnel" meta="sessions reaching each step">
          <HBars
            items={g.funnel.map((f) => ({ key: f.step, label: f.step, value: f.sessions, note: first ? formatPct(f.sessions / first) : undefined }))}
            max={first || undefined}
            empty="No sessions in this range."
          />
        </Panel>
      </div>
      <div className="duo">
        <Panel icon="trophy" title="Level distribution" meta="characters by highest level">
          <ColumnChart label="Characters by level" columns={levels.map((l) => ({ label: String(l.level), values: [l.characters] }))} keys={[{ label: "Characters", tone: "text" }]} />
        </Panel>
        <Panel icon="loot" title="Loot by rarity" meta={<><span className="mono">{formatNumber(lootTotal)}</span> drops</>}>
          <HBars
            items={RARITIES.map((r) => ({ key: r, label: <span className={`rc r-${r}`}>{titleCase(r)}</span>, value: g.loot[r] ?? 0, tone: r, note: lootTotal ? formatPct((g.loot[r] ?? 0) / lootTotal, 1) : undefined }))}
          />
        </Panel>
      </div>
      <div className="duo">
        <Panel icon="atlas" title="Maps" meta="by biome and tier">
          <div className="scroll">
            <table className="stack">
              <thead>
                <tr>
                  <th>Biome</th>
                  <th className="num">Tier</th>
                  <th className="num">Opened</th>
                  <th className="num">Completed</th>
                  <th className="num">Rate</th>
                  <th className="num">Deaths</th>
                </tr>
              </thead>
              <tbody>
                {maps.length === 0 && <EmptyRow cols={6}>No maps opened in this range.</EmptyRow>}
                {maps.map((m) => (
                  <tr key={`${m.biome}/${m.tier}`}>
                    <td data-label="Biome">{titleCase(m.biome)}</td>
                    <td className="num" data-label="Tier">{m.tier}</td>
                    <td className="num" data-label="Opened">{formatNumber(m.opened)}</td>
                    <td className="num" data-label="Completed">{formatNumber(m.completed)}</td>
                    <td className="num" data-label="Rate">{formatPct(m.opened ? m.completed / m.opened : null)}</td>
                    <td className="num" data-label="Deaths">{formatNumber(m.deaths)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel icon="skull" title="Top killers" meta="rare monsters in rare colour">
          <div className="scroll">
            <table className="stack">
              <thead>
                <tr>
                  <th>Killer</th>
                  <th>Element</th>
                  <th className="num">Deaths</th>
                </tr>
              </thead>
              <tbody>
                {g.killers.length === 0 && <EmptyRow cols={3}>Nobody died in this range.</EmptyRow>}
                {[...g.killers].sort((a, b) => b.deaths - a.deaths).map((k) => (
                  <tr key={`${k.killer}/${k.element}/${k.rare}`}>
                    <td className="strong" data-label="Killer">
                      <span className={k.rare ? "rc r-rare" : undefined}>{k.killer}</span>
                    </td>
                    <td data-label="Element">{k.element ?? <span className="faint">-</span>}</td>
                    <td className="num" data-label="Deaths">{formatNumber(k.deaths)}</td>
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

export function Gameplay({ query }: { query: Record<string, string> }) {
  const days = rangeDays(query, [1, 7, 30, 90], 7);
  const st = useApi("GET /api/gameplay", { query: { days } });
  return (
    <div className="page">
      <PageHead title="Gameplay" lede="What exiles pick, how far they get, what kills them and what drops." />
      <div className="toolbar">
        <RangePicker page="gameplay" query={query} days={days} />
      </div>
      <Loaded state={st}>{(g) => <GameplayView g={g} />}</Loaded>
    </div>
  );
}
