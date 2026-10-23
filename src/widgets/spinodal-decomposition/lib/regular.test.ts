/**
 * regular.test.ts — 正則溶体の単体テスト(記事仕様書 09 §5.8 T1・T2)
 *
 * T1: χ = 3 でスピノーダル 0.2113・バイノーダル 0.0707、χ = 2 で両者が 0.5 で
 *     一致、全温度でバイノーダルがスピノーダルの外側
 * T2: 共通接線 — バイノーダルで両相の g' が一致し、その間の組成でのみ
 *     「分かれたほうが得」
 * あわせて、図5 の線形安定性(λ_m = 12.6 格子、κ を 4 倍で λ_m が 2 倍)と
 * てこの原理を確かめる。
 */

import { describe, expect, it } from "vitest";
import {
  T_REP,
  binodal,
  chiFromT,
  commonTangent,
  cutoffK,
  d2gdc2,
  dgdc,
  fastestK,
  gMix,
  growthRate,
  leverFraction,
  maxGrowthRate,
  regionAt,
  separationGain,
  sliderToTOverTc,
  spinodal,
} from "./regular";

describe("T1 — バイノーダルとスピノーダル", () => {
  it("χ = 3(T/Tc = 2/3)でスピノーダル 0.2113・バイノーダル 0.0707", () => {
    expect(spinodal(3)).toBeCloseTo(0.2113, 4);
    expect(binodal(3)).toBeCloseTo(0.0707, 4);
    expect(Math.abs(spinodal(3) - 0.21132)).toBeLessThan(1e-4);
    expect(Math.abs(binodal(3) - 0.07072)).toBeLessThan(1e-4);
  });

  it("χ = 2(臨界温度)で両者が 0.5 で一致し、それより高温では存在しない", () => {
    expect(spinodal(2)).toBeNaN();
    expect(binodal(2)).toBeNaN();
    expect(spinodal(2 + 1e-9)).toBeCloseTo(0.5, 4);
    expect(binodal(2 + 1e-9)).toBeCloseTo(0.5, 3);
    expect(spinodal(chiFromT(1.1))).toBeNaN();
  });

  it("どの温度でもバイノーダルはスピノーダルの外側にある", () => {
    for (let t = 0.3; t < 0.999; t += 0.01) {
      const chi = chiFromT(t);
      const cb = binodal(chi);
      const cs = spinodal(chi);
      expect(cb).toBeGreaterThan(0);
      expect(cb).toBeLessThan(cs);
      expect(cs).toBeLessThan(0.5);
    }
  });

  it("スピノーダルでは曲率 g'' が 0、内側で負・外側で正", () => {
    const chi = 3;
    const cs = spinodal(chi);
    expect(d2gdc2(cs, chi)).toBeCloseTo(0, 9);
    expect(d2gdc2(0.3, chi)).toBeLessThan(0);
    expect(d2gdc2(0.1, chi)).toBeGreaterThan(0);
  });

  it("領域の判定: 安定 / 準安定 / 不安定", () => {
    expect(regionAt(0.05, 3)).toBe("stable");
    expect(regionAt(0.15, 3)).toBe("metastable");
    expect(regionAt(0.5, 3)).toBe("unstable");
    expect(regionAt(0.85, 3)).toBe("metastable");
    expect(regionAt(0.5, chiFromT(1.05))).toBe("stable");
  });

  it("スライダーの 0.67 は代表値 2/3(χ = 3)を表し、ほかの目盛りはそのまま", () => {
    expect(sliderToTOverTc(0.67)).toBe(T_REP);
    expect(chiFromT(sliderToTOverTc(0.67))).toBeCloseTo(3, 12);
    expect(sliderToTOverTc(0.66)).toBe(0.66);
    expect(sliderToTOverTc(0.68)).toBe(0.68);
  });
});

describe("T2 — 共通接線と「分かれたほうが得」", () => {
  it("接点で両相の化学ポテンシャル g' が一致し(1e-10)、接線の傾きにも等しい", () => {
    for (const chi of [2.2, 2.5, 3, 3.5, 4]) {
      const t = commonTangent(chi);
      expect(t).not.toBeNull();
      if (!t) continue;
      const muA = dgdc(t.cAlpha, chi);
      const muB = dgdc(t.cBeta, chi);
      expect(Math.abs(muA - muB)).toBeLessThan(1e-10);
      expect(Math.abs(muA - t.slope)).toBeLessThan(1e-10);
      // 接線は両方の接点で曲線に触れる
      expect(t.slope * t.cAlpha + t.intercept).toBeCloseTo(
        gMix(t.cAlpha, chi),
        12,
      );
      expect(t.slope * t.cBeta + t.intercept).toBeCloseTo(
        gMix(t.cBeta, chi),
        12,
      );
    }
  });

  it("接線は曲線の下にあり、接点の間でだけ曲線との差が正になる", () => {
    const chi = 3;
    const t = commonTangent(chi);
    if (!t) throw new Error("共通接線がない");
    for (let c = 0.005; c < 1; c += 0.005) {
      const gap = gMix(c, chi) - (t.slope * c + t.intercept);
      expect(gap).toBeGreaterThan(-1e-12);
      const gain = separationGain(c, chi);
      if (c > t.cAlpha + 1e-6 && c < t.cBeta - 1e-6) {
        expect(gain).toBeGreaterThan(0);
      } else {
        expect(gain).toBe(0);
      }
    }
  });

  it("臨界温度以上では共通接線がなく、どの組成でも「混ざったままが得」", () => {
    for (const t of [1, 1.05, 1.2]) {
      const chi = chiFromT(t);
      expect(commonTangent(chi)).toBeNull();
      for (let c = 0.02; c < 0.99; c += 0.04) {
        expect(separationGain(c, chi)).toBe(0);
      }
    }
  });

  it("てこの原理: 割合の和が 1、組成が接点に一致すると一方の相が 100%", () => {
    const t = commonTangent(3);
    if (!t) throw new Error("共通接線がない");
    const c0 = 0.35;
    const fB = leverFraction(c0, t.cAlpha, t.cBeta);
    const fA = (t.cBeta - c0) / (t.cBeta - t.cAlpha);
    expect(fA + fB).toBeCloseTo(1, 12);
    // 物質の収支: fα·cα + fβ·cβ = c0
    expect(fA * t.cAlpha + fB * t.cBeta).toBeCloseTo(c0, 12);
    expect(fB).toBeCloseTo((0.35 - 0.0707) / (0.9293 - 0.0707), 3);
    expect(leverFraction(t.cAlpha, t.cAlpha, t.cBeta)).toBe(0);
    expect(leverFraction(t.cBeta, t.cAlpha, t.cBeta)).toBe(1);
  });
});

describe("線形安定性(図5 — 式 E6・E7)", () => {
  const chi = 3;
  const kappa = 4;

  it("既定値(c0 = 0.5・χ = 3・κ = 4)で k_m = 0.5、λ_m = 2π/k_m = 12.6 格子", () => {
    const km = fastestK(0.5, chi, kappa);
    expect(km).toBeCloseTo(0.5, 12);
    expect((2 * Math.PI) / km).toBeCloseTo(12.566, 3);
    expect(maxGrowthRate(0.5, chi, kappa)).toBeCloseTo(0.25, 12);
    expect(growthRate(km, 0.5, chi, kappa)).toBeCloseTo(0.25, 12);
  });

  it("R(k) は k_m で最大、k_c = √2·k_m で 0、それより短い波は減衰", () => {
    const km = fastestK(0.5, chi, kappa);
    const kc = cutoffK(0.5, chi, kappa);
    expect(kc).toBeCloseTo(Math.SQRT2 * km, 12);
    expect(growthRate(kc, 0.5, chi, kappa)).toBeCloseTo(0, 12);
    expect(growthRate(1.2 * kc, 0.5, chi, kappa)).toBeLessThan(0);
    expect(growthRate(0.9 * km, 0.5, chi, kappa)).toBeLessThan(
      growthRate(km, 0.5, chi, kappa),
    );
    expect(growthRate(1.1 * km, 0.5, chi, kappa)).toBeLessThan(
      growthRate(km, 0.5, chi, kappa),
    );
  });

  it("κ を 4 倍にすると λ_m は 2 倍", () => {
    const l1 = (2 * Math.PI) / fastestK(0.5, chi, 4);
    const l4 = (2 * Math.PI) / fastestK(0.5, chi, 16);
    expect(l4 / l1).toBeCloseTo(2, 12);
  });

  it("スピノーダルの外では全ての波数で R(k) ≤ 0(どの波も育たない)", () => {
    for (const c0 of [0.1, 0.15, 0.2, 0.8]) {
      expect(fastestK(c0, chi, kappa)).toBeNaN();
      expect(maxGrowthRate(c0, chi, kappa)).toBe(0);
      for (let k = 0; k <= Math.PI; k += 0.01) {
        expect(growthRate(k, c0, chi, kappa)).toBeLessThanOrEqual(0);
      }
    }
  });
});
