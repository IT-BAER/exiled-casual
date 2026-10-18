import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./ua";
import { ipPrefix, geoFromHeaders } from "./ip";
import { fingerprintError, normaliseMessage, topFrame } from "./errors";
import { base32Decode, base32Encode, totpAt, verifyTotp } from "./totp";
import { isBot, parseAccessLine, parseErrorLine } from "./nginx";
import { TokenBucket } from "./ratelimit";

describe("user agent", () => {
  it("parses the common browsers and platforms", () => {
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"))
      .toEqual({ family: "Chrome", browser: "Chrome 141", os: "Windows", mobile: false });
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0").browser).toBe("Edge 141");
    expect(parseUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0")).toEqual({ family: "Firefox", browser: "Firefox 143", os: "Linux", mobile: false });
    expect(parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"))
      .toEqual({ family: "Safari", browser: "Safari 18", os: "iOS", mobile: true });
    expect(parseUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36"))
      .toEqual({ family: "Samsung", browser: "Samsung 25", os: "Android", mobile: true });
    expect(parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0").browser).toBe("Opera 120");
    expect(parseUserAgent("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36").os).toBe("ChromeOS");
    expect(parseUserAgent("")).toEqual({ family: "other", browser: "other", os: "other", mobile: false });
  });
});

describe("ip", () => {
  it("truncates v4 to /24 and v6 to /48", () => {
    expect(ipPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefix("::ffff:198.51.100.9")).toBe("198.51.100.0/24");
    expect(ipPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipPrefix("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(ipPrefix("garbage")).toBeNull();
  });
  it("reads Cloudflare location headers", () => {
    expect(geoFromHeaders({ "cf-ipcountry": "de", "cf-ipcity": "Berlin", "cf-region": "Land Berlin", "cf-iplatitude": "52.5200", "cf-iplongitude": "13.4050" }))
      .toEqual({ country: "DE", city: "Berlin", region: "Land Berlin", lat: 52.5, lon: 13.4 });
    expect(geoFromHeaders({ "cf-ipcountry": "XX" }).country).toBeNull();
    expect(geoFromHeaders({ "cf-ipcountry": "T1" }).country).toBeNull();
    expect(geoFromHeaders({})).toEqual({ country: null, city: null, region: null, lat: null, lon: null });
  });
});

describe("error fingerprint", () => {
  const vendor = "    at r (https://x.example/assets/vendor-AbC123xy.js:1:2345)";
  const own = "    at castSkill (https://x.example/assets/game-Zz99Yy88.js:10:20)";
  it("strips numbers, hex ids and hashed urls from the message", () => {
    expect(normaliseMessage("Failed to load https://x.example/assets/foo-AbCdEf12.js?v=3 after 3 tries (id 0xdeadbeef, 9f8e7d6c5b4a)"))
      .toBe(normaliseMessage("Failed to load https://x.example/assets/foo-ZZzz9999.js after 7 tries (id 0x1234, 0011223344556677)"));
  });
  it("skips vendor chunk frames only when a better one exists", () => {
    expect(topFrame(`Error: x\n${vendor}\n${own}`)).toBe(own.trim());
    expect(topFrame(`Error: x\n${vendor}`)).toBe(vendor.trim());
    expect(topFrame(undefined)).toBeNull();
  });
  it("is stable across builds and differs by source", () => {
    const a = fingerprintError("window", "boom 12", `Error\n${own}`);
    const b = fingerprintError("window", "boom 99", `Error\n${own.replace("Zz99Yy88", "Qq11Ww22").replace(":10:20", ":11:5")}`);
    expect(a).toBe(b);
    expect(fingerprintError("worker", "boom 12", `Error\n${own}`)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("totp", () => {
  it("round-trips base32", () => {
    const bytes = Buffer.from("12345678901234567890");
    expect(base32Encode(bytes)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(Buffer.from(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).equals(bytes)).toBe(true);
  });
  it("matches the RFC 6238 SHA1 vectors (6 digits)", () => {
    const key = Buffer.from("12345678901234567890");
    expect(totpAt(key, 59)).toBe("287082");
    expect(totpAt(key, 1111111109)).toBe("081804");
    expect(totpAt(key, 1234567890)).toBe("005924");
  });
  it("accepts one step either side and returns the step used", () => {
    const key = Buffer.from("12345678901234567890");
    const t = 1_700_000_000;
    expect(verifyTotp(key, totpAt(key, t - 30), t * 1000)).toBe(Math.floor(t / 30) - 1);
    expect(verifyTotp(key, totpAt(key, t + 30), t * 1000)).toBe(Math.floor(t / 30) + 1);
    expect(verifyTotp(key, totpAt(key, t + 90), t * 1000)).toBeNull();
    expect(verifyTotp(key, "abc", t * 1000)).toBeNull();
  });
});

describe("nginx logs", () => {
  it("parses a combined access line without keeping the full ip", () => {
    const hit = parseAccessLine('203.0.113.7 - - [18/Oct/2026:13:55:36 +0200] "GET /play?x=1 HTTP/1.1" 200 5123 "https://www.reddit.com/r/x" "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36"');
    expect(hit).toEqual({
      t: Date.UTC(2026, 9, 18, 11, 55, 36), ipPrefix: "203.0.113.0/24", method: "GET", path: "/play", status: 200, bytes: 5123,
      referrer: "www.reddit.com", ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36", bot: false,
    });
    expect(JSON.stringify(hit)).not.toContain("203.0.113.7");
    expect(parseAccessLine("nonsense")).toBeNull();
  });
  it("flags bots by agent and by probe path", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)", "/")).toBe(true);
    expect(isBot("curl/8.4.0", "/")).toBe(true);
    expect(isBot("python-requests/2.31", "/")).toBe(true);
    expect(isBot("Mozilla/5.0 zgrab/0.x", "/")).toBe(true);
    expect(isBot("-", "/")).toBe(true);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0", "/.env")).toBe(true);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0", "/wp-login.php")).toBe(true);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0", "/cgi-bin/x")).toBe(true);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0", "/")).toBe(false);
  });
  it("parses an error line and masks client addresses", () => {
    const l = parseErrorLine("2026/10/18 13:55:36 [error] 1234#1234: *5 open() failed, client: 203.0.113.7, server: x");
    expect(l).toEqual({ t: Date.UTC(2026, 9, 18, 13, 55, 36), level: "error", text: "1234#1234: *5 open() failed, client: 203.0.113.0/24, server: x" });
  });
});

describe("token bucket", () => {
  it("allows a burst, then refills at the rate", () => {
    let now = 0;
    const b = new TokenBucket(10, 30 / 60_000, () => now);
    for (let i = 0; i < 10; i++) expect(b.take("a")).toBe(true);
    expect(b.take("a")).toBe(false);
    expect(b.take("b")).toBe(true);
    now += 2000;
    expect(b.take("a")).toBe(true);
    expect(b.take("a")).toBe(false);
  });
});
