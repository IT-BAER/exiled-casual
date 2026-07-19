import { describe, expect, test } from "vitest";
import {
  FP_SCALE, fp, toNumber, fpAdd, fpSub, fpMul, fpDiv, fpClamp, fpAbs, fpSign,
} from "./index";

describe("fixed-point", () => {
  test("fp scales to integers and toNumber inverts", () => {
    expect(fp(1.5)).toBe(1500);
    expect(FP_SCALE).toBe(1000);
    expect(Number.isInteger(fp(3.14159))).toBe(true);
    expect(toNumber(fp(2.5))).toBe(2.5);
  });

  test("add/sub are exact", () => {
    expect(fpAdd(fp(2), fp(3))).toBe(fp(5));
    expect(fpSub(fp(3), fp(5))).toBe(fp(-2));
  });

  test("mul/div stay integer and round toward zero", () => {
    expect(fpMul(fp(2), fp(3))).toBe(fp(6));
    expect(fpDiv(fp(6), fp(2))).toBe(fp(3));
    expect(Number.isInteger(fpMul(fp(1.234), fp(5.678)))).toBe(true);
    expect(fpMul(fp(-0.001), fp(1.5))).toBe(-1); // trunc toward zero, not floor's -2
  });

  test("clamp, abs, sign", () => {
    expect(fpClamp(fp(5), fp(0), fp(3))).toBe(fp(3));
    expect(fpClamp(fp(-1), fp(0), fp(3))).toBe(fp(0));
    expect(fpAbs(fp(-4))).toBe(fp(4));
    expect(fpSign(fp(-4))).toBe(-1);
    expect(fpSign(fp(0))).toBe(0);
    expect(fpSign(fp(4))).toBe(1);
  });
});
