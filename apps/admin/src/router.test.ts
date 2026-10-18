import { describe, expect, it } from "vitest";
import { hrefFor, parseHash } from "./router";

describe("hash router", () => {
  it("opens the dashboard on an empty or bare hash", () => {
    expect(parseHash("")).toEqual({ page: "dashboard", query: {} });
    expect(parseHash("#")).toEqual({ page: "dashboard", query: {} });
    expect(parseHash("#/")).toEqual({ page: "dashboard", query: {} });
  });

  it("reads a page, a detail id and the query", () => {
    expect(parseHash("#/errors/ab%2Fcd?status=open")).toEqual({ page: "errors", id: "ab/cd", query: { status: "open" } });
    expect(parseHash("#/sessions?q=firefox&page=3")).toEqual({ page: "sessions", query: { q: "firefox", page: "3" } });
    expect(parseHash("#/atlas?days=30")).toEqual({ page: "atlas", query: { days: "30" } });
  });

  it("refuses unknown pages and ids on pages without a detail view", () => {
    expect(parseHash("#/nowhere")).toEqual({ page: "notfound", query: {} });
    expect(parseHash("#/live/abc")).toEqual({ page: "notfound", query: {} });
    expect(parseHash("#/errors/a/b")).toEqual({ page: "notfound", query: {} });
  });

  it("builds hrefs that parse back to the same route", () => {
    const route = { page: "errors" as const, id: "x y/z", query: { status: "ignored" } };
    const href = hrefFor(route);
    expect(href).toBe("#/errors/x%20y%2Fz?status=ignored");
    expect(parseHash(href)).toEqual(route);
    expect(hrefFor({ page: "dashboard", query: {} })).toBe("#/");
    expect(hrefFor({ page: "logs", query: { source: "access", q: "" } })).toBe("#/logs?source=access");
  });
});
