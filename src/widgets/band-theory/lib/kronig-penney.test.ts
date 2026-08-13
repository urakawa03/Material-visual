/**
 * kronig-penney.test.ts — バンド計算の単体テスト(仕様書 11 §5.8)
 *
 * 最重要は T1「ポテンシャル → 0 で自由電子 E = ħ²k²/2m に収束すること」で、
 * 物理の正しさを直接担保する。次いで T2(ギャップの単調性)と
 * T3(弱いポテンシャルで縮退摂動論 2|V₁| に一致すること)で、S3 の説明
 * (2 つの定在波)と S4 の厳密解が同じ物理であることを確かめる。
 */

import { describe, expect, it } from "vitest";
import { freeElectronEnergy, HBAR2_OVER_2M } from "./constants";
import {
  bandEnergyAt,
  extendedZoneBandIndex,
  fillingForValence,
  findBands,
  firstFourierComponent,
  kpDiscriminant,
  reduceToFirstZone,
  standingWaveEnergies,
  type KPParams,
} from "./kronig-penney";

const A = 0.5;
const E_MAX = 40;

/** 拡張ゾーン表示のエネルギー(第 n バンドを (n−1)π/a〜nπ/a に展開) */
function extendedEnergy(
  k: number,
  p: KPParams,
  bands: ReturnType<typeof findBands>,
): number {
  const n = extendedZoneBandIndex(k, p.a);
  return bandEnergyAt(k, bands[n - 1], p);
}

describe("T1: ポテンシャル → 0 で自由電子に収束する(最重要)", () => {
  const cases = [
    { name: "U₀ = 0", p: { a: A, b: 0.15, u0: 0 } },
    { name: "b = 0", p: { a: A, b: 0, u0: 6 } },
    { name: "U₀ = 1e-6 eV", p: { a: A, b: 0.15, u0: 1e-6 } },
  ];
  for (const { name, p } of cases) {
    it(`${name}: 拡張ゾーンのバンドが E = ħ²k²/2m に一致する`, () => {
      const bands = findBands(p, 5, E_MAX);
      expect(bands.length).toBe(5);
      const boundary = Math.PI / p.a;
      // 各バンドの内部を等間隔に確かめる(バンド端は接触点なので少し内側)
      for (let n = 1; n <= 4; n++) {
        for (let j = 1; j <= 9; j++) {
          const k = boundary * (n - 1 + j / 10);
          const e = extendedEnergy(k, p, bands);
          expect(e).toBeCloseTo(freeElectronEnergy(k), 6);
        }
      }
    });
  }

  it("U₀ = 0 のバンド端が (nπ/a) の自由電子エネルギーに一致する", () => {
    const p: KPParams = { a: A, b: 0.15, u0: 0 };
    const bands = findBands(p, 4, E_MAX);
    for (let n = 1; n <= 4; n++) {
      const kTop = (n * Math.PI) / p.a;
      const kBottom = ((n - 1) * Math.PI) / p.a;
      expect(bands[n - 1].eHigh).toBeCloseTo(freeElectronEnergy(kTop), 4);
      expect(bands[n - 1].eLow).toBeCloseTo(freeElectronEnergy(kBottom), 4);
    }
  });
});

describe("T2: ギャップ幅は U₀ とともに単調に増える", () => {
  it("第 1 ギャップが単調増加する", () => {
    let prev = -1;
    for (let u0 = 0; u0 <= 10.001; u0 += 0.5) {
      const p: KPParams = { a: A, b: 0.15, u0 };
      const bands = findBands(p, 2, E_MAX);
      const gap = bands[1].eLow - bands[0].eHigh;
      expect(gap).toBeGreaterThan(prev - 1e-9);
      prev = gap;
    }
    expect(prev).toBeGreaterThan(0.5); // U₀ = 10 eV では十分に開いている
  });

  it("第 1 バンド幅は U₀ とともに単調に減る", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let u0 = 0; u0 <= 10.001; u0 += 0.5) {
      const bands = findBands({ a: A, b: 0.15, u0 }, 1, E_MAX);
      const width = bands[0].eHigh - bands[0].eLow;
      expect(width).toBeLessThan(prev + 1e-9);
      prev = width;
    }
  });
});

describe("T3: 弱いポテンシャルで縮退摂動論(2|V₁|)に一致する", () => {
  for (const u0 of [0.1, 0.2, 0.3]) {
    it(`U₀ = ${u0} eV で第 1 ギャップが 2|V₁| と 5% 以内で一致する`, () => {
      const p: KPParams = { a: A, b: 0.15, u0 };
      const bands = findBands(p, 2, E_MAX);
      const gap = bands[1].eLow - bands[0].eHigh;
      const perturbative = 2 * Math.abs(firstFourierComponent(p));
      expect(Math.abs(gap - perturbative) / perturbative).toBeLessThan(0.05);
    });
  }

  it("V₁ は負(cos 型の定在波が低エネルギー側になる)", () => {
    const p: KPParams = { a: A, b: 0.15, u0: 4 };
    expect(firstFourierComponent(p)).toBeLessThan(0);
    const { eCos, eSin, gap } = standingWaveEnergies(p);
    expect(eCos).toBeLessThan(eSin);
    expect(eSin - eCos).toBeCloseTo(gap, 12);
    // 2 つの準位は自由電子のゾーン境界エネルギーを挟む
    const e0 = HBAR2_OVER_2M * (Math.PI / p.a) ** 2;
    expect((eCos + eSin) / 2).toBeCloseTo(e0, 12);
  });
});

describe("T4: 二分法の解が超越方程式を満たす", () => {
  const p: KPParams = { a: A, b: 0.15, u0: 4 };
  const bands = findBands(p, 4, E_MAX);

  it("バンド端で |f(E)| = 1", () => {
    for (const band of bands) {
      expect(Math.abs(kpDiscriminant(band.eLow, p))).toBeCloseTo(1, 6);
      expect(Math.abs(kpDiscriminant(band.eHigh, p))).toBeCloseTo(1, 6);
    }
  });

  it("バンド内の E(k) が f(E) = cos(ka) を満たす", () => {
    for (const band of bands) {
      for (let j = 1; j < 10; j++) {
        const k = ((j / 10) * Math.PI) / p.a;
        const e = bandEnergyAt(k, band, p);
        expect(kpDiscriminant(e, p)).toBeCloseTo(Math.cos(k * p.a), 9);
      }
    }
  });

  it("バンド端(k = 0 と k = π/a)でバンドの下端・上端に一致する", () => {
    // cos(ka) = ±1 ちょうどのとき、二分法が反対側の端へ落ちないこと
    // (拡張ゾーン表示でバンドの継ぎ目に縦線が出る不具合の回帰テスト)
    for (const band of bands) {
      const atZero = bandEnergyAt(0, band, p);
      const atBoundary = bandEnergyAt(Math.PI / p.a, band, p);
      const lo = Math.min(atZero, atBoundary);
      const hi = Math.max(atZero, atBoundary);
      expect(lo).toBeCloseTo(band.eLow, 8);
      expect(hi).toBeCloseTo(band.eHigh, 8);
    }
  });

  it("禁制帯では |f(E)| > 1", () => {
    const mid = (bands[0].eHigh + bands[1].eLow) / 2;
    expect(Math.abs(kpDiscriminant(mid, p))).toBeGreaterThan(1);
  });
});

describe("T5: E(k) の周期性と偶関数性(図5 の折り返し)", () => {
  const p: KPParams = { a: A, b: 0.15, u0: 4 };
  const bands = findBands(p, 3, E_MAX);
  const g = (2 * Math.PI) / p.a;

  it("E(k + G) = E(k)", () => {
    for (const band of bands) {
      for (let j = 0; j <= 8; j++) {
        const k = (j / 8) * (Math.PI / p.a);
        expect(bandEnergyAt(k + g, band, p)).toBeCloseTo(
          bandEnergyAt(k, band, p),
          9,
        );
      }
    }
  });

  it("E(−k) = E(k)", () => {
    for (const band of bands) {
      const k = 2.7;
      expect(bandEnergyAt(-k, band, p)).toBeCloseTo(
        bandEnergyAt(k, band, p),
        9,
      );
    }
  });

  it("reduceToFirstZone が (−π/a, π/a] に収める", () => {
    for (let k = -25; k <= 25; k += 0.37) {
      const kr = reduceToFirstZone(k, p.a);
      expect(Math.abs(kr)).toBeLessThanOrEqual(Math.PI / p.a + 1e-12);
    }
  });

  it("extendedZoneBandIndex がゾーンごとに 1, 2, 3 … を返す", () => {
    const boundary = Math.PI / p.a;
    expect(extendedZoneBandIndex(0.5 * boundary, p.a)).toBe(1);
    expect(extendedZoneBandIndex(1.5 * boundary, p.a)).toBe(2);
    expect(extendedZoneBandIndex(-2.5 * boundary, p.a)).toBe(3);
    expect(extendedZoneBandIndex(0, p.a)).toBe(1);
  });
});

describe("T6: f(E) が特異点で有限(0/0 の回避)", () => {
  const p: KPParams = { a: A, b: 0.15, u0: 4 };
  it("E → 0⁺ で有限", () => {
    for (const e of [1e-12, 1e-9, 1e-6, 1e-3]) {
      expect(Number.isFinite(kpDiscriminant(e, p))).toBe(true);
    }
  });
  it("E → U₀ で連続(両側の枝がつながる)", () => {
    const below = kpDiscriminant(p.u0 - 1e-7, p);
    const above = kpDiscriminant(p.u0 + 1e-7, p);
    expect(Number.isFinite(below)).toBe(true);
    expect(below).toBeCloseTo(above, 6);
  });
});

describe("T7: 自由電子の詰め方(図1)", () => {
  it("k_F = πn/2、E_F = ħ²k_F²/2m", () => {
    const n = 4;
    const kF = (Math.PI * n) / 2;
    expect(freeElectronEnergy(kF)).toBeCloseTo(HBAR2_OVER_2M * kF * kF, 12);
    // 電子数を 2 倍にすると k_F は 2 倍、E_F は 4 倍
    const kF2 = (Math.PI * (2 * n)) / 2;
    expect(kF2 / kF).toBeCloseTo(2, 12);
    expect(freeElectronEnergy(kF2) / freeElectronEnergy(kF)).toBeCloseTo(4, 12);
  });

  it("価電子数からバンドの埋まり方が決まる(奇数 = 部分占有)", () => {
    expect(fillingForValence(1)).toEqual({
      fullBands: 0,
      partialBand: 0,
      partialFraction: 0.5,
    });
    expect(fillingForValence(2)).toEqual({
      fullBands: 1,
      partialBand: -1,
      partialFraction: 0,
    });
    expect(fillingForValence(3)).toEqual({
      fullBands: 1,
      partialBand: 1,
      partialFraction: 0.5,
    });
    expect(fillingForValence(4).fullBands).toBe(2);
  });
});
