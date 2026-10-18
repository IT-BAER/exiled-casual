import { useState, type FormEvent } from "react";
import type { BuildRow, LiveConfig } from "@exiled/telemetry";
import { call } from "../api";
import { Icon } from "../icons";
import { formatTime } from "../format";
import { configFromForm, formFromConfig, sameConfig, type FlagRow, type FlagType, type LiveOpsForm } from "../liveops";
import { useApi } from "../use-api";
import { ErrorCallout, Loaded, PageHead } from "../ui";

const TYPES: FlagType[] = ["boolean", "number", "string"];

export function LiveOpsEditor({ initial, builds, onPublished }: { initial: LiveConfig; builds: BuildRow[]; onPublished?: (c: LiveConfig) => void }) {
  const [prev, setPrev] = useState(initial);
  const [form, setForm] = useState<LiveOpsForm>(() => formFromConfig(initial));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  const result = configFromForm(form, prev, Date.now());
  const changed = !result.ok || !sameConfig(result.config, prev);
  const set = (patch: Partial<LiveOpsForm>) => {
    setDone(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const setFlag = (i: number, patch: Partial<FlagRow>) =>
    set({
      flags: form.flags.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if (patch.type === "boolean" && next.value !== "true" && next.value !== "false") next.value = "false";
        return next;
      }),
    });

  const publish = async (e: FormEvent) => {
    e.preventDefault();
    const res = configFromForm(form, prev, Date.now());
    if (!res.ok) return;
    setBusy(true);
    setFail(null);
    try {
      const saved = await call("PUT /admin/api/liveops", { body: res.config });
      setPrev(saved);
      setForm(formFromConfig(saved));
      setDone("Published. Clients pick it up from /api/config.");
      onPublished?.(saved);
    } catch (err) {
      setFail(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sortedBuilds = [...builds].sort((a, b) => b.builtAt - a.builtAt);
  const knownMin = form.minBuiltAt === "" || sortedBuilds.some((b) => String(b.builtAt) === form.minBuiltAt);

  return (
    <form className="panel" onSubmit={publish} aria-label="Live ops">
      <div className="panel-head">
        <span className="icon-box" aria-hidden="true"><Icon name="liveops" /></span>
        <h2>Message of the day</h2>
        <span className="meta">banner in the main menu</span>
      </div>
      <div className="fields">
        <label className="span">
          Text
          <textarea value={form.motdText} placeholder="No message" onChange={(e) => set({ motdText: e.target.value })} />
        </label>
        <label>
          Level
          <select value={form.motdLevel} onChange={(e) => set({ motdLevel: e.target.value as "info" | "warn" })}>
            <option value="info">info</option>
            <option value="warn">warn</option>
          </select>
        </label>
        <div className="span">
          <button type="button" className="small" disabled={!form.motdText} onClick={() => set({ motdText: "" })}>Clear message</button>
        </div>
      </div>

      <div className="panel-head sub">
        <span className="icon-box" aria-hidden="true"><Icon name="operations" /></span>
        <h2>Maintenance</h2>
        <span className="meta">disables PLAY and shows the text</span>
      </div>
      <div className="fields">
        <label className="check span">
          <input type="checkbox" checked={form.maintenanceOn} onChange={(e) => set({ maintenanceOn: e.target.checked })} />
          Maintenance on
        </label>
        <label className="span">
          Text
          <input value={form.maintenanceText} disabled={!form.maintenanceOn} placeholder="Back in 30 minutes" onChange={(e) => set({ maintenanceText: e.target.value })} />
        </label>
      </div>

      <div className="panel-head sub">
        <span className="icon-box" aria-hidden="true"><Icon name="builds" /></span>
        <h2>Minimum build</h2>
        <span className="meta">older clients are told to reload</span>
      </div>
      <div className="fields">
        <label>
          Build
          <select value={form.minBuiltAt} onChange={(e) => set({ minBuiltAt: e.target.value })}>
            <option value="">No minimum</option>
            {!knownMin && <option value={form.minBuiltAt}>built {formatTime(Number(form.minBuiltAt))}</option>}
            {sortedBuilds.map((b) => (
              <option key={b.build} value={String(b.builtAt)}>
                {b.build}, built {formatTime(b.builtAt)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel-head sub">
        <span className="icon-box" aria-hidden="true"><Icon name="liveops" /></span>
        <h2>Flags</h2>
        <span className="meta">read once at client start</span>
      </div>
      {form.flags.length === 0 && (
        <div className="idle">
          <span>No flags set.</span>
        </div>
      )}
      {form.flags.length > 0 && (
        <ul className="flag-rows">
          {form.flags.map((r, i) => (
            <li key={i}>
              <input aria-label="Flag key" placeholder="key" className="mono" value={r.key} onChange={(e) => setFlag(i, { key: e.target.value })} />
              <select aria-label="Flag type" value={r.type} onChange={(e) => setFlag(i, { type: e.target.value as FlagType })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {r.type === "boolean" ? (
                <select aria-label="Flag value" value={r.value} onChange={(e) => setFlag(i, { value: e.target.value })}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input aria-label="Flag value" inputMode={r.type === "number" ? "decimal" : undefined} value={r.value} onChange={(e) => setFlag(i, { value: e.target.value })} />
              )}
              <button type="button" className="quiet small remove" aria-label={`Remove flag ${r.key}`} onClick={() => set({ flags: form.flags.filter((_, j) => j !== i) })}>
                <Icon name="x" />
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="fields">
        <div>
          <button type="button" className="small" onClick={() => set({ flags: [...form.flags, { key: "", type: "boolean", value: "false" }] })}>
            <Icon name="plus" />
            Add flag
          </button>
        </div>
      </div>

      <div className="panel-head sub">
        <span className="icon-box" aria-hidden="true"><Icon name="health" /></span>
        <h2>Telemetry</h2>
        <span className="meta">kill switch for every client</span>
      </div>
      <div className="fields">
        <label className="check span">
          <input type="checkbox" checked={form.telemetry} onChange={(e) => set({ telemetry: e.target.checked })} />
          Clients send telemetry
        </label>
      </div>

      <div className="panel-foot">
        {!result.ok && (
          <div className="callout error" role="alert">
            <ul>
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {fail && <ErrorCallout>Nothing was published: {fail}</ErrorCallout>}
        {done && <p className="callout done" role="status">{done}</p>}
        <button type="submit" className="primary" disabled={busy || !result.ok || !changed} aria-busy={busy}>
          Publish changes
        </button>
        <span className="meta">{changed ? "unpublished changes" : "matches what is live"}</span>
      </div>
    </form>
  );
}

export function LiveOps() {
  const cfg = useApi("GET /admin/api/liveops");
  const builds = useApi("GET /admin/api/builds");
  return (
    <div className="page">
      <PageHead title="Live ops" lede="What every client reads from /api/config: the menu banner, maintenance, the minimum build, remote flags and the telemetry switch." />
      {builds.error && <ErrorCallout>Builds could not be loaded: {builds.error}</ErrorCallout>}
      <Loaded state={cfg}>{(c) => <LiveOpsEditor initial={c} builds={builds.data ?? []} />}</Loaded>
    </div>
  );
}
