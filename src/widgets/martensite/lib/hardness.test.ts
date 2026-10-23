/**
 * hardness.test.ts — 硬さの目安の単体テスト(記事仕様書 10 §5.8 T7 後半・§5.1)
 */

import { describe, expect, it } from "vitest";
import { C_EUTECTOID, MARTENSITE_HV_TABLE, coolingMedium } from "./constants";
import { coolingOutcome, msCelsius } from "./kinetics";
import {
  martensiteHardness,
  pearliteHardness,
  pearliteSpacingRel,
  slowCooledHardness,
} from "./hardness";
import { monotoneCubic } from "./interp";

describe("T7: 100% マルテンサイトの硬さの補間(§5.6)", () => {
  it("単調非減少で、表の点を通る", () => {
    let prev = -Infinity;
    for (let c = 0; c <= 1.2 + 1e-9; c += 0.005) {
      const h = martensiteHardness(c);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = h;
    }
    for (const [c, hv] of MARTENSITE_HV_TABLE) {
      expect(martensiteHardness(c)).toBeCloseTo(hv, 9);
    }
  });

  it("炭素 0 で 200 HV 以下(150〜200 HV — 焼入れても硬くならない)", () => {
    expect(martensiteHardness(0)).toBeLessThanOrEqual(200);
    expect(martensiteHardness(0)).toBeGreaterThanOrEqual(150);
  });

  it("0.7 C 以上はほぼ一定(820 HV)", () => {
    expect(martensiteHardness(0.8)).toBeCloseTo(820, 6);
    expect(martensiteHardness(1.2)).toBeCloseTo(820, 6);
  });

  it("徐冷した鋼の硬さはどの炭素量でもマルテンサイトより低い(0 C を除けば大差)", () => {
    for (let c = 0.1; c <= 1.2; c += 0.05) {
      expect(slowCooledHardness(c)).toBeLessThan(martensiteHardness(c) * 0.6);
    }
  });
});

describe("図1 の硬さの目安(§5.1)", () => {
  const ms = msCelsius(C_EUTECTOID);
  const furnace = coolingOutcome(coolingMedium("furnace").tauS, ms);
  const oil = coolingOutcome(coolingMedium("oil").tauS, ms);

  it("パーライトは 632 ℃ で約 220 HV、521 ℃ で約 350 HV(単調)", () => {
    expect(pearliteHardness(632)).toBeCloseTo(220, 6);
    expect(pearliteHardness(521)).toBeCloseTo(350, 6);
    expect(pearliteHardness(600)).toBeGreaterThan(pearliteHardness(632));
    expect(Math.round(pearliteHardness(furnace.startTempC) / 10)).toBe(22);
    expect(Math.round(pearliteHardness(oil.startTempC) / 10)).toBe(35);
  });

  it("水冷(マルテンサイト)は炉冷の 3〜4 倍硬い", () => {
    const ratio =
      martensiteHardness(C_EUTECTOID) / pearliteHardness(furnace.startTempC);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4);
  });

  it("低い温度でできたパーライトほど縞が細かい", () => {
    expect(pearliteSpacingRel(521, 632)).toBeLessThan(1);
    expect(pearliteSpacingRel(632, 632)).toBeCloseTo(1, 12);
  });
});

describe("単調 3 次補間(interp.ts)", () => {
  it("単調な表から行き過ぎ(オーバーシュート)のない曲線を作る", () => {
    const f = monotoneCubic([
      [0, 0],
      [1, 10],
      [2, 10.5],
      [3, 30],
    ]);
    let prev = -Infinity;
    for (let x = -1; x <= 4; x += 0.01) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(30);
      prev = y;
    }
  });

  it("同じ値が続く区間は水平", () => {
    const f = monotoneCubic([
      [0, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(f(1.5)).toBe(2);
  });
});
