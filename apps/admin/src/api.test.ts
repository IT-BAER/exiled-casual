import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, UnauthorizedError, call, setUnauthorizedHandler } from "./api";

function respond(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe("api client", () => {
  it("GETs same-origin with query and no CSRF header", async () => {
    const fetch = respond(200, []);
    vi.stubGlobal("fetch", fetch);
    await call("GET /admin/api/geo", { query: { days: 7, empty: undefined } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/admin/api/geo?days=7");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).has("X-EC-Admin")).toBe(false);
  });

  it("fills path params and sends the CSRF header and JSON body on mutations", async () => {
    const fetch = respond(200, { fingerprint: "f/1" });
    vi.stubGlobal("fetch", fetch);
    await call("POST /admin/api/errors/:fp", { params: { fp: "f/1" }, body: { status: "resolved" } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/admin/api/errors/f%2F1");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-EC-Admin")).toBe("1");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ status: "resolved" }));
  });

  it("sends the CSRF header on PUT too", async () => {
    const fetch = respond(200, { flags: {}, telemetry: true });
    vi.stubGlobal("fetch", fetch);
    await call("PUT /admin/api/liveops", { body: { flags: {}, telemetry: true } });
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("X-EC-Admin")).toBe("1");
  });

  it("returns to the gate on 401", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "session expired" }));
    const gate = vi.fn();
    setUnauthorizedHandler(gate);
    await expect(call("GET /admin/api/overview")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it("throws the server's error text on other failures without leaving the console", async () => {
    vi.stubGlobal("fetch", respond(500, { error: "database is locked" }));
    const gate = vi.fn();
    setUnauthorizedHandler(gate);
    const err = await call("GET /admin/api/health").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe("database is locked");
    expect(gate).not.toHaveBeenCalled();
  });

  it("refuses a path param it was not given", async () => {
    vi.stubGlobal("fetch", respond(200, {}));
    await expect(call("GET /admin/api/sessions/:sid")).rejects.toThrow(/sid/);
  });
});
