import { describe, expect, test } from "vitest";
import { isqrt, fpDist2, fpStepToward, fp } from "./index.js";

describe("isqrt", () => {
  test("isqrt(0) === 0", () => {
    expect(isqrt(0)).toBe(0);
  });
  test("isqrt(1) === 1", () => {
    expect(isqrt(1)).toBe(1);
  });
  test("isqrt(4) === 2", () => {
    expect(isqrt(4)).toBe(2);
  });
  test("isqrt(15) === 3 (floor)", () => {
    expect(isqrt(15)).toBe(3);
  });
  test("isqrt(16) === 4", () => {
    expect(isqrt(16)).toBe(4);
  });
  test("isqrt(25000000) === 5000", () => {
    expect(isqrt(25000000)).toBe(5000);
  });
  test("isqrt is deterministic (same input → same output twice)", () => {
    expect(isqrt(123456789)).toBe(isqrt(123456789));
  });
});

describe("fpDist2", () => {
  test("(0,0)→(3,4) === 25000000", () => {
    // fp(3)=3000, fp(4)=4000; 3000²+4000²=9000000+16000000=25000000
    expect(fpDist2(fp(0), fp(0), fp(3), fp(4))).toBe(25000000);
  });
  test("same point → 0", () => {
    expect(fpDist2(fp(5), fp(7), fp(5), fp(7))).toBe(0);
  });
});

describe("fpStepToward", () => {
  test("zero distance returns {dx:0, dy:0}", () => {
    expect(fpStepToward(fp(0), fp(0), fp(0), fp(0), fp(0.4))).toEqual({ dx: 0, dy: 0 });
  });

  test("snaps when remaining ≤ speed: (0,0)→(0,0.05) speed 0.1 → {dx:0, dy:fp(0.05)}", () => {
    // dx=0, dy=fp(0.05)=50; d2=2500; len=isqrt(2500)=50; 50<=100 → snap
    expect(fpStepToward(fp(0), fp(0), fp(0), fp(0.05), fp(0.1))).toEqual({
      dx: 0,
      dy: fp(0.05), // 50
    });
  });

  test("long axis: (0,0)→(10,0) speed 0.4 → {dx:400, dy:0}", () => {
    // dx=10000, dy=0; d2=100000000; len=10000; 10000>400 → trunc(10000*400/10000)=400
    expect(fpStepToward(fp(0), fp(0), fp(10), fp(0), fp(0.4))).toEqual({
      dx: 400,
      dy: 0,
    });
  });

  test("diagonal: (0,0)→(10,10) speed 0.4 → {dx:282, dy:282}", () => {
    // dx=10000, dy=10000; d2=200000000; len=isqrt(200000000)=14142
    // trunc(10000*400/14142) = trunc(282.84...) = 282
    expect(fpStepToward(fp(0), fp(0), fp(10), fp(10), fp(0.4))).toEqual({
      dx: 282,
      dy: 282,
    });
  });

  test("isqrt(200000000) === 14142 (diagonal magnitude pre-check)", () => {
    expect(isqrt(200000000)).toBe(14142);
  });
});
