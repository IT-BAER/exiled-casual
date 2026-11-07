import { describe, it, expect } from "vitest";
import { parseAccessLine } from "./nginx";

const PERSON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const line = (ip: string) => `${ip} - - [06/Nov/2026:04:01:00 +0000] "GET / HTTP/1.1" 200 10 "-" "${PERSON}"`;

describe("parseAccessLine", () => {
  it("never counts a private address as a visitor, whatever agent it sends", () => {
    // 6 Nov: 446 page loads with 900 browser agents from the DMZ in 12 minutes.
    expect(parseAccessLine(line("10.10.50.1"))!.bot).toBe(true);
    expect(parseAccessLine(line("192.168.1.20"))!.bot).toBe(true);
    expect(parseAccessLine(line("203.0.113.7"))!.bot).toBe(false);
  });
});
