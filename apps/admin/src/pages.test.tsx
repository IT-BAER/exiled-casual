// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AuditRow, BuildRow, ErrorDetail, ErrorGroup, GeoRow, Gameplay as GameplayData, Health as HealthData, LiveConfig,
  LiveSession, LogLine, Overview, Page, Perf, Retention as RetentionData, SessionDetail, SessionRow, Traffic as TrafficData,
} from "@exiled/telemetry";
import { App } from "./App";
import { Dashboard } from "./pages/Dashboard";
import { Live } from "./pages/Live";
import { SessionDetailPage, Sessions } from "./pages/Sessions";
import { Retention } from "./pages/Retention";
import { Atlas } from "./pages/Atlas";
import { Gameplay } from "./pages/Gameplay";
import { Performance } from "./pages/Performance";
import { ErrorDetailPage, Errors } from "./pages/Errors";
import { Health } from "./pages/Health";
import { Logs } from "./pages/Logs";
import { Traffic } from "./pages/Traffic";
import { Builds } from "./pages/Builds";
import { LiveOps } from "./pages/LiveOps";
import { Audit } from "./pages/Audit";

const T = 1_800_000_000_000;
const pts = (vs: number[]) => vs.map((v, i) => ({ t: T + i * 3_600_000, v }));

const health: HealthData = {
  summary: { state: "warn", checks: [{ id: "disk", label: "Disk space", state: "warn", detail: "82 % used" }, { id: "db", label: "Database", state: "ok", detail: "fine" }] },
  host: { cpuPct: 12, load: [0.1, 0.2, 0.3], cores: 4, memUsedMb: 1024, memTotalMb: 4096, diskUsedGb: 20, diskTotalGb: 40, uptimeSeconds: 90000 },
  nginx: { up: true, active: 3, reqPerSec: 1.5, status5xxLastHour: 2, status4xxLastHour: 9 },
  server: { uptimeSeconds: 3600, rssMb: 80, dbMb: 12, ingestPerMin: 30, rejectedLastHour: 0, node: "v22.16.0" },
  series: { cpu: pts([10, 20]), mem: pts([1000, 1024]), reqs: pts([5, 6]), live: pts([1, 2]) },
};

const overview: Overview = {
  liveNow: 3, peakToday: 7, peakAllTime: { v: 21, t: T }, sessionsToday: 42, visitorsToday: 30, playSecondsToday: 5400,
  avgSessionSeconds7d: 754, returningShare7d: 0.4, errorsLastHour: 2, newErrorGroups24h: 1,
  sessionsSeries: pts([1, 4, 2]), liveSeries: pts([0, 2, 1]), topCountries: [{ country: "DE", sessions: 20 }],
  health: health.summary,
  milestones: [
    { id: "a", title: "First Steps", desc: "One session", rarity: "normal", progress: 1, target: 1, unlockedAt: T },
    { id: "b", title: "The Hundred", desc: "100 exiles", rarity: "unique", progress: 40, target: 100, unlockedAt: null },
  ],
};

const live: LiveSession[] = [{
  sid: "11111111-2222-3333-4444-555555555555", startedAt: T - 600_000, lastBeat: T, country: "DE", city: "Berlin", browser: "Chrome", os: "Windows",
  mobile: false, build: "0.3.1+abc", view: "game", area: "map", biome: "strand", tier: 3, level: 12, classId: "ironsworn", fps: 22, playSeconds: 500,
}];

const row: SessionRow = {
  sid: "11111111-2222-3333-4444-555555555555", visitor: "v1", startedAt: T, lastSeen: T + 1000, playSeconds: 65, country: "FR", city: "Paris",
  browser: "Firefox", os: "Linux", mobile: false, gpu: "RTX 4070", screen: "1920x1080", build: "0.3.1+abc", referrer: "", furthest: "game",
  classId: "ember", maxLevel: 5, ageDays: "2-6", maps: 2, deaths: 1, errors: 3,
};
const sessions: Page<SessionRow> = { rows: [row], total: 120, page: 1, pageSize: 50 };
const detail: SessionDetail = {
  session: row, ipPrefix: "203.0.113.0/24", lang: "fr", dpr: 1, cores: 8, memGb: 8, touch: false, pwa: false,
  events: [{ t: T + 5000, k: "death", data: { killer: "Sirrath", tier: 2 } }], sameDay: ["99999999-2222-3333-4444-555555555555"],
};
const retention: RetentionData = {
  days: [{ date: "2026-10-17", sessions: 10, visitors: 8, playSeconds: 7200, newCharacters: 2, byAge: { "0": 2, "1": 1, "2-6": 3, "7-29": 0, "30+": 1 } }],
  lengths: [{ from: 0, to: 60, count: 4 }, { from: 3600, to: null, count: 1 }],
  ageTotals: { "0": 2, "1": 1, "2-6": 3, "7-29": 0, "30+": 1 },
};
const geo: GeoRow[] = [
  { country: "DE", city: "Berlin", lat: 52.5, lon: 13.4, sessions: 9, visitors: 5, playSeconds: 3600 },
  { country: "JP", city: null, lat: null, lon: null, sessions: 1, visitors: 1, playSeconds: 60 },
];
const gameplay: GameplayData = {
  classes: [{ classId: "stalker", entries: 7, playSeconds: 3600 }],
  levels: [{ level: 1, characters: 4 }, { level: 2, characters: 2 }],
  maps: [{ biome: "desert", tier: 1, opened: 10, completed: 5, deaths: 3 }],
  killers: [{ killer: "Ghaltrek", element: "cold", rare: true, deaths: 4 }],
  loot: { normal: 100, magic: 30, rare: 5, unique: 1 },
  funnel: [{ step: "boot", sessions: 50 }, { step: "game", sessions: 20 }],
};
const perf: Perf = {
  byGpu: [{ key: "Intel UHD 620", sessions: 4, fpsP50: 24, fpsP5: 9 }],
  byBrowser: [{ key: "Chrome", sessions: 10, fpsP50: 58, fpsP5: 40 }],
  menuLoadMs: { p50: 1800, p90: 4200 }, gameLoadMs: { p50: null, p90: null }, fpsSeries: pts([55, 60]),
};
const group: ErrorGroup = {
  fingerprint: "fp1", src: "window", message: "TypeError: x is undefined", topFrame: "hud.ts:12", count: 80, sessions: 55,
  firstSeen: T - 86_400_000, lastSeen: T, builds: ["0.3.1+abc"], status: "open", series: pts([1, 3]),
};
const errDetail: ErrorDetail = { group, stack: "TypeError: x is undefined\n  at hud.ts:12", hits: [{ t: T, sid: row.sid, build: "0.3.1+abc", browser: "Chrome", os: "Windows", url: "/" }] };
const logs: LogLine[] = [
  { t: T, source: "access", ip: "203.0.113.4", method: "GET", path: "/api/config", status: 502, bytes: 200, ua: "curl", bot: false, text: "" },
];
const traffic: TrafficData = {
  days: [{ date: "2026-10-17", pageLoads: 100, humans: 80, bots: 20, sessions: 60 }],
  referrers: [{ referrer: "reddit.com", visits: 12 }], paths: [{ path: "/", hits: 90 }],
  statuses: [{ status: 200, hits: 90 }, { status: 404, hits: 3 }], bots: [{ agent: "Googlebot", hits: 20 }], bouncedBeforeBoot: 15,
};
const builds: BuildRow[] = [{ build: "0.3.1+abc", builtAt: 1_700_000_000_000, firstSeen: T, lastSeen: T, sessions: 40, errors: 2 }];
const audit: AuditRow[] = [{ t: T, user: "baer", action: "liveops.publish", detail: "motd" }];
const liveops: LiveConfig = { motd: { id: "m1", text: "Hello exiles", level: "info" }, flags: { newLoot: true }, telemetry: true };

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;

function stubApi(routes: Record<string, unknown>, extra?: Handler) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const hit = extra?.(url, init);
    if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 });
    const path = url.split("?")[0]!;
    if (!(path in routes)) return new Response(JSON.stringify({ error: `no fixture for ${path}` }), { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("pages render typed data", () => {
  it("dashboard: readings, unlocked milestones first, error count in red", async () => {
    stubApi({ "/admin/api/overview": overview });
    const { container } = render(<Dashboard />);
    expect(await screen.findByText("Exiles online")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("40 %")).toBeTruthy();
    expect(screen.getByText("12m 34s")).toBeTruthy();
    const plaques = screen.getAllByRole("article");
    expect(plaques.map((p) => p.getAttribute("aria-label"))).toEqual(["First Steps, unlocked", "The Hundred, locked"]);
    expect([...container.querySelectorAll(".n.fail")].map((e) => e.textContent)).toEqual(["2"]);
    expect(screen.getByText("Disk space")).toBeTruthy();
  });

  it("live: party cards, warn fps, and the empty state", async () => {
    stubApi({ "/admin/api/live": live });
    render(<Live />);
    expect(await screen.findByText("Ironsworn")).toBeTruthy();
    expect(screen.getByText("Strand, tier 3")).toBeTruthy();
    expect(screen.getByText("22").className).toBe("n warn");
    expect(screen.getByText(/Berlin/)).toBeTruthy();
    cleanup();
    stubApi({ "/admin/api/live": [] });
    render(<Live />);
    expect(await screen.findByText("No exile is in the world right now.")).toBeTruthy();
  });

  it("sessions: table, paging and search query", async () => {
    const fetch = stubApi({ "/admin/api/sessions": sessions });
    const { container } = render(<Sessions query={{ q: "ember" }} />);
    expect(await screen.findByText("Firefox on Linux")).toBeTruthy();
    expect(String(fetch.mock.calls[0]![0])).toBe("/admin/api/sessions?q=ember&page=1&pageSize=50");
    expect(screen.getByText("Older").getAttribute("href")).toBe("#/sessions?q=ember&page=2");
    expect(screen.queryByText("Newer")).toBeNull();
    expect([...container.querySelectorAll(".n.fail")].map((e) => e.textContent)).toEqual(["3"]);
  });

  it("session detail: facts, timeline, same-day links", async () => {
    stubApi({ [`/admin/api/sessions/${row.sid}`]: detail });
    const { container } = render(<SessionDetailPage sid={row.sid} />);
    expect(await screen.findByText("203.0.113.0/24")).toBeTruthy();
    expect(container.querySelector("td.key")?.textContent).toBe("killer=Sirrath  tier=2");
    expect(screen.getByText(detail.sameDay[0]!).getAttribute("href")).toBe(`#/sessions/${detail.sameDay[0]}`);
  });

  it("retention: totals and age buckets", async () => {
    const fetch = stubApi({ "/admin/api/retention": retention });
    render(<Retention query={{ days: "7" }} />);
    expect(await screen.findByText("Game entries by character age")).toBeTruthy();
    expect(String(fetch.mock.calls[0]![0])).toBe("/admin/api/retention?days=7");
    expect(screen.getByText("71 %")).toBeTruthy();
    expect(screen.getAllByText("30+ days").length).toBeGreaterThan(0);
  });

  it("atlas: map nodes only for rows with coordinates, tables for all", async () => {
    stubApi({ "/admin/api/geo": geo });
    const { container } = render(<Atlas query={{}} />);
    expect(await screen.findByText("By country")).toBeTruthy();
    expect(container.querySelectorAll(".atlas-map .city")).toHaveLength(1);
    expect(screen.getAllByText(/Japan/).length).toBeGreaterThan(0);
    await waitFor(() => expect(container.querySelector(".atlas-map .land")).not.toBeNull());
  });

  it("gameplay: rare killer in rare colour, loot by rarity", async () => {
    stubApi({ "/admin/api/gameplay": gameplay });
    render(<Gameplay query={{ days: "30" }} />);
    expect((await screen.findByText("Ghaltrek")).className).toBe("rc r-rare");
    expect(screen.getByText("Unique").className).toBe("rc r-unique");
    expect(screen.getByText("50 %")).toBeTruthy();
  });

  it("performance: load readings, low fps flagged, empty game load hatched", async () => {
    stubApi({ "/admin/api/perf": perf });
    render(<Performance query={{}} />);
    expect(await screen.findByText("1.8")).toBeTruthy();
    expect(screen.getByText("9").className).toBe("n fail");
    expect(screen.getByText("24").className).toBe("n warn");
    expect(screen.getByText("no loads")).toBeTruthy();
  });

  it("errors: impact tier badge and status filter", async () => {
    const fetch = stubApi({ "/admin/api/errors": [group] });
    render(<Errors query={{ status: "all" }} />);
    expect((await screen.findByText("unique 55")).className).toBe("badge r-unique");
    expect(String(fetch.mock.calls[0]![0])).toBe("/admin/api/errors");
    expect(screen.getByText("All").getAttribute("aria-current")).toBe("true");
  });

  it("error detail: stack, hits, and Resolve posts with the CSRF header", async () => {
    const fetch = stubApi({ "/admin/api/errors/fp1": errDetail }, (_url, init) =>
      init?.method === "POST" ? { body: { ...group, status: "resolved" } } : undefined,
    );
    render(<ErrorDetailPage fp="fp1" />);
    expect(await screen.findByText(/at hud.ts:12/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(await screen.findByText("Marked resolved.")).toBeTruthy();
    const post = fetch.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(post[0]).toBe("/admin/api/errors/fp1");
    expect(new Headers(post[1]!.headers).get("X-EC-Admin")).toBe("1");
    expect(post[1]!.body).toBe(JSON.stringify({ status: "resolved" }));
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
  });

  it("health: orbs, facts and checks", async () => {
    stubApi({ "/admin/api/health": health });
    const { container } = render(<Health />);
    expect(await screen.findByRole("img", { name: "Life: 100 %" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Mana: 75 %" })).toBeTruthy();
    expect(screen.getByText("Disk space")).toBeTruthy();
    expect([...container.querySelectorAll(".n.fail")].map((e) => e.textContent)).toEqual(["2"]);
  });

  it("logs: access lines with status colour and bots toggle in the query", async () => {
    const fetch = stubApi({ "/admin/api/logs": logs });
    render(<Logs query={{ source: "access", bots: "1" }} />);
    expect((await screen.findByText("502")).className).toBe("n fail");
    expect(String(fetch.mock.calls[0]![0])).toBe("/admin/api/logs?source=access&bots=1&limit=200");
  });

  it("traffic: readings and tables", async () => {
    stubApi({ "/admin/api/traffic": traffic });
    render(<Traffic query={{}} />);
    expect(await screen.findByText("Bounced before boot")).toBeTruthy();
    expect(screen.getByText("reddit.com")).toBeTruthy();
    expect(screen.getByText("404").className).toBe("n warn");
  });

  it("builds and audit tables", async () => {
    stubApi({ "/admin/api/builds": builds, "/admin/api/audit": audit });
    render(<Builds />);
    expect(await screen.findByText("0.3.1+abc")).toBeTruthy();
    cleanup();
    render(<Audit />);
    expect(await screen.findByText("liveops.publish")).toBeTruthy();
  });

  it("live ops: publishes the edited form as LiveConfig with one PUT", async () => {
    const fetch = stubApi({ "/admin/api/liveops": liveops, "/admin/api/builds": builds }, (_url, init) =>
      init?.method === "PUT" ? { body: JSON.parse(String(init.body)) } : undefined,
    );
    render(<LiveOps />);
    const publish = await screen.findByRole("button", { name: "Publish changes" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Maintenance on"));
    fireEvent.change(screen.getByPlaceholderText("Back in 30 minutes"), { target: { value: "Patching" } });
    fireEvent.click(screen.getByLabelText("Clients send telemetry"));
    fireEvent.click(publish);
    await screen.findByText(/^Published/);
    const put = fetch.mock.calls.find((c) => c[1]?.method === "PUT")!;
    expect(new Headers(put[1]!.headers).get("X-EC-Admin")).toBe("1");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ motd: liveops.motd, maintenance: { text: "Patching" }, flags: { newLoot: true }, telemetry: false });
  });
});

describe("app shell", () => {
  it("shows the gate on 401 and enters the console after sign-in", async () => {
    let signedIn = false;
    stubApi({ "/admin/api/overview": overview }, (url, init) => {
      if (url === "/admin/api/me") return signedIn ? { body: { user: "baer", since: T } } : { status: 401, body: { error: "no session" } };
      if (url === "/admin/api/login" && init?.method === "POST") {
        signedIn = true;
        return { body: { user: "baer", since: T } };
      }
      return undefined;
    });
    render(<App />);
    const enter = await screen.findByRole("button", { name: "Enter" });
    expect(screen.getByLabelText("Code").getAttribute("autocomplete")).toBe("one-time-code");
    fireEvent.change(screen.getByLabelText("User"), { target: { value: "baer" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(enter);
    expect(await screen.findByText("Exiles online")).toBeTruthy();
    expect(screen.getByText("baer")).toBeTruthy();
  });

  it("returns to the gate when a page call gets 401", async () => {
    stubApi({ "/admin/api/me": { user: "baer", since: T } }, (url) =>
      url === "/admin/api/overview" ? { status: 401, body: { error: "expired" } } : undefined,
    );
    render(<App />);
    expect(await screen.findByRole("button", { name: "Enter" })).toBeTruthy();
  });
});
