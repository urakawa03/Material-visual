/**
 * formfactors.test.ts — 原子散乱因子・中性子散乱長の表の単体テスト
 * (仕様書 08 §5.8 T5)
 *
 * Cromer–Mann 係数の転記ミスを、f(0) = Σa_i + c が原子番号 Z と 0.1 以内で
 * 一致すること、f(s) が s に対して単調に減ることで検出する。
 */

import { describe, expect, it } from "vitest";
import {
  DEUTERIUM_B_FM,
  ELEMENTS,
  ELEMENT_IDS,
  halfFormFactorS,
  neutronLength,
  scatteringAmplitude,
  xrayFormFactor,
} from "./formfactors";

describe("Cromer–Mann の原子散乱因子(T5)", () => {
  it("全元素で f(0) が原子番号 Z と 0.1 以内で一致する(転記ミスの検出)", () => {
    for (const el of ELEMENT_IDS) {
      const { Z, cm } = ELEMENTS[el];
      const f0 = xrayFormFactor(el, 0);
      expect(Math.abs(f0 - Z), el).toBeLessThan(0.1);
      // f(0) は係数の和そのもの
      expect(f0).toBeCloseTo(cm.a[0] + cm.a[1] + cm.a[2] + cm.a[3] + cm.c, 12);
    }
  });

  it("全元素で f(s) は s に対して単調に減る(0〜20 nm⁻¹)", () => {
    for (const el of ELEMENT_IDS) {
      let prev = xrayFormFactor(el, 0);
      for (let i = 1; i <= 400; i++) {
        const f = xrayFormFactor(el, i * 0.05);
        expect(f, `${el} s=${i * 0.05}`).toBeLessThan(prev);
        prev = f;
      }
    }
  });

  it("s は nm⁻¹ で受け取り、内部で Å⁻¹ に直している", () => {
    // Si: s = 5 nm⁻¹ = 0.5 Å⁻¹ を係数から直接計算した値と一致する
    const { a, b, c } = ELEMENTS.Si.cm;
    const s2 = 0.5 * 0.5;
    const direct =
      a[0] * Math.exp(-b[0] * s2) +
      a[1] * Math.exp(-b[1] * s2) +
      a[2] * Math.exp(-b[2] * s2) +
      a[3] * Math.exp(-b[3] * s2) +
      c;
    expect(xrayFormFactor("Si", 5)).toBeCloseTo(direct, 12);
  });

  it("表の代表値と合う(sinθ/λ = 0.3 Å⁻¹ で Cu 約 19.9、Si 約 8.2)", () => {
    // International Tables Vol. C の f(sinθ/λ) の表の値と Cromer–Mann 近似の一致
    expect(xrayFormFactor("Cu", 3)).toBeGreaterThan(19.5);
    expect(xrayFormFactor("Cu", 3)).toBeLessThan(20.3);
    expect(xrayFormFactor("Si", 3)).toBeGreaterThan(7.9);
    expect(xrayFormFactor("Si", 3)).toBeLessThan(8.5);
  });

  it("水素は角度が増えるとすぐ散乱しなくなる(f が半分になる s は約 2.3 nm⁻¹)", () => {
    const half = halfFormFactorS("H");
    expect(half).not.toBeNull();
    expect(half as number).toBeGreaterThan(2);
    expect(half as number).toBeLessThan(2.6);
    expect(xrayFormFactor("H", half as number)).toBeCloseTo(
      xrayFormFactor("H", 0) / 2,
      9,
    );
    // 重い原子ほど電子雲が締まっていて、f は角度に対して相対的にゆっくり減る
    expect(halfFormFactorS("Au") as number).toBeGreaterThan(
      halfFormFactorS("Cu") as number,
    );
  });
});

describe("中性子散乱長(NIST)", () => {
  it("仕様書の値と一致し、H だけが負", () => {
    const expected: Record<string, number> = {
      H: -3.74,
      Na: 3.63,
      Si: 4.15,
      Cl: 9.58,
      K: 3.67,
      Fe: 9.45,
      Cu: 7.72,
      Zn: 5.68,
      Cs: 5.42,
      Au: 7.63,
    };
    for (const el of ELEMENT_IDS) {
      expect(neutronLength(el), el).toBeCloseTo(expected[el], 2);
      expect(neutronLength(el) < 0, el).toBe(el === "H");
    }
    expect(DEUTERIUM_B_FM).toBeCloseTo(6.67, 2);
  });

  it("中性子の散乱の強さは角度によらず、電子数の順にも並ばない", () => {
    expect(scatteringAmplitude("Cu", 0, "neutron")).toBe(
      scatteringAmplitude("Cu", 6, "neutron"),
    );
    // X 線では Au ≫ Cu だが、中性子ではほぼ等しい(図7 の逆転の理由)
    expect(neutronLength("Au") / neutronLength("Cu")).toBeCloseTo(0.99, 2);
    // Z の順(Cu < Zn)と b の順(Cu > Zn)が逆
    expect(neutronLength("Cu")).toBeGreaterThan(neutronLength("Zn"));
  });
});
