/**
 * semiconductor.test.ts — キャリア統計の単体テスト(仕様書 12 §5.8)
 *
 * 物理の正しさを直接担保する: 分布関数の定義と数値安全性(T2・T3)、
 * フェルミ・ディラック積分の近似式(T4 — 係数の転記ミスを捕まえる)、
 * 質量作用の法則とその成立条件(T6)、電荷中性の二分法(T8)、
 * Si の定数と図5 の読み取り値の整合(T9)、擬フェルミ準位(T10)。
 * T5(図3 の数値積分)は fermi-level/lib/dos.test.ts にある。
 */

import { describe, expect, it } from "vitest";
import {
  conductivity,
  effectiveDos,
  electronDensity,
  fdHalf,
  fermiDirac,
  fermiLevelForElectrons,
  fermiLevelForHoles,
  holeDensity,
  intrinsicDensity,
  intrinsicLevel,
  ionizedAcceptors,
  ionizedDonors,
  isDegenerate,
  quasiFermiSplit,
  SILICON,
  solveFermiLevel,
  thermalEnergy,
} from "./semiconductor";

/** 規格化 F_{1/2}(η) の数値積分(ε = u² と置いて被積分関数を滑らかにした台形則) */
function fdHalfNumeric(eta: number, steps = 4000): number {
  const uMax = Math.sqrt(Math.max(eta, 0) + 50);
  const h = uMax / steps;
  let s = 0;
  for (let i = 0; i <= steps; i++) {
    const u = i * h;
    const f = fermiDirac(u * u, eta, 1 / 8.617333262e-5); // k_BT = 1 の分布
    const w = i === 0 || i === steps ? 0.5 : 1;
    s += w * 2 * u * u * f;
  }
  return (s * h * 2) / Math.sqrt(Math.PI);
}

const TEMPS = [1, 10, 50, 77, 100, 300, 500, 700, 1000, 2000];

describe("T2: フェルミ・ディラック分布の定義と数値安全性", () => {
  it("どの温度でも f(E_F) = 1/2", () => {
    for (const T of TEMPS) {
      for (const eF of [-0.5, 0, 0.56, 1.3]) {
        expect(fermiDirac(eF, eF, T)).toBe(0.5);
      }
    }
  });

  it("T → 0 で階段関数に収束する", () => {
    expect(fermiDirac(-0.001, 0, 0)).toBe(1);
    expect(fermiDirac(0.001, 0, 0)).toBe(0);
    expect(fermiDirac(0, 0, 0)).toBe(0.5);
    // 有限の温度でも、k_BT よりずっと離れた点はほぼ 0 か 1
    for (const de of [0.01, 0.05]) {
      expect(fermiDirac(de, 0, 1)).toBeLessThan(1e-40);
      expect(fermiDirac(-de, 0, 1)).toBeGreaterThan(1 - 1e-12);
    }
    // 温度を下げるほど、同じ点での値は 0 に近づく(単調)
    let prev = 1;
    for (const T of [1000, 300, 100, 30, 10]) {
      const f = fermiDirac(0.02, 0, T);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });

  it("|E − E_F| = 10 eV・T = 1 K でも NaN・Infinity を出さない", () => {
    for (const de of [-10, -1, 1, 10]) {
      for (const T of [0, 1e-6, 1, 2000]) {
        const f = fermiDirac(de, 0, T);
        expect(Number.isFinite(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it("f(E) は E について単調減少し、E_F について対称(f(E_F + x) + f(E_F − x) = 1)", () => {
    for (const T of [77, 300, 1000]) {
      let prev = 1;
      for (let e = -0.5; e <= 0.5; e += 0.01) {
        const f = fermiDirac(e, 0, T);
        expect(f).toBeLessThanOrEqual(prev);
        prev = f;
        expect(f + fermiDirac(-e, 0, T)).toBeCloseTo(1, 12);
      }
    }
  });
});

describe("T3: 裾の幅(10%〜90%)は 2 ln 9 · k_BT(= 4.39 k_BT)", () => {
  /** fermiDirac(e) = target となる e を二分法で求める(f は単調減少) */
  function crossing(target: number, T: number): number {
    let lo = -2;
    let hi = 2;
    for (let i = 0; i < 100; i++) {
      const mid = 0.5 * (lo + hi);
      if (fermiDirac(mid, 0, T) > target) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  it("数値で求めた 0.9 → 0.1 の幅が 2 ln 9 · k_BT に一致する", () => {
    for (const T of [50, 300, 1000, 2000]) {
      const width = crossing(0.1, T) - crossing(0.9, T);
      const expected = 2 * Math.log(9) * thermalEnergy(T);
      expect(width).toBeCloseTo(expected, 10);
      expect(width / thermalEnergy(T)).toBeCloseTo(4.394, 3);
    }
  });

  it("300 K の裾の幅は 0.114 ± 0.002 eV、伝導帯の底(E_F + 0.56 eV)での f は 3.9 × 10⁻¹⁰", () => {
    const width = 2 * Math.log(9) * thermalEnergy(300);
    expect(Math.abs(width - 0.114)).toBeLessThan(0.002);
    const fEdge = fermiDirac(0.56, 0, 300);
    expect(fEdge).toBeGreaterThan(3.85e-10);
    expect(fEdge).toBeLessThan(3.95e-10);
  });
});

describe("T4: フェルミ・ディラック積分の近似 fdHalf(最重要 — 係数の転記ミスを捕まえる)", () => {
  it("η = −10〜20 で数値積分と 1% 以内で一致する", () => {
    let worst = 0;
    for (let eta = -10; eta <= 20 + 1e-9; eta += 0.25) {
      const exact = fdHalfNumeric(eta);
      const rel = Math.abs(fdHalf(eta) / exact - 1);
      worst = Math.max(worst, rel);
      expect(rel).toBeLessThan(0.01);
    }
    // 原典の最大誤差は 0.53%(η ≈ 2)。それより大きくずれたら係数を疑う
    expect(worst).toBeLessThan(0.0055);
  });

  it("η = −10 で e^η と 1e-4 以内(非縮退の極限 = ボルツマン近似)", () => {
    expect(Math.abs(fdHalf(-10) / Math.exp(-10) - 1)).toBeLessThan(1e-4);
  });

  it("縮退の極限で (4/3√π)·η^{3/2} に近づき、極端な η でも有限", () => {
    const eta = 200;
    const asym = (4 / (3 * Math.sqrt(Math.PI))) * Math.pow(eta, 1.5);
    expect(Math.abs(fdHalf(eta) / asym - 1)).toBeLessThan(1e-3);
    for (const e of [-1e4, -800, -700, 0, 700, 1e4]) {
      expect(Number.isFinite(fdHalf(e))).toBe(true);
      expect(fdHalf(e)).toBeGreaterThanOrEqual(0);
    }
    expect(fdHalf(-1e4)).toBe(0);
  });

  it("η について単調増加", () => {
    let prev = 0;
    for (let eta = -20; eta <= 40; eta += 0.1) {
      const f = fdHalf(eta);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });
});

describe("T6: 質量作用の法則 np = n_i² とその成立条件", () => {
  it("非縮退域(E_F がバンド端から 6k_BT 以上)で np = n_i²(相対 1e-2 以内)", () => {
    for (const T of [200, 300, 400, 500, 700]) {
      const kT = thermalEnergy(T);
      const ni2 = intrinsicDensity(SILICON, T) ** 2;
      for (let eF = 6 * kT; eF <= SILICON.eg - 6 * kT; eF += 0.01) {
        const np =
          electronDensity(SILICON, eF, T) * holeDensity(SILICON, eF, T);
        expect(Math.abs(np / ni2 - 1)).toBeLessThan(1e-2);
      }
    }
  });

  it("縮退域(E_F がバンドの中)では np < n_i²", () => {
    for (const T of [100, 300, 500]) {
      const ni2 = intrinsicDensity(SILICON, T) ** 2;
      for (const eF of [SILICON.eg + 0.05, SILICON.eg + 0.2, -0.05, -0.2]) {
        const np =
          electronDensity(SILICON, eF, T) * holeDensity(SILICON, eF, T);
        expect(np / ni2).toBeLessThan(1);
      }
    }
  });

  it("図6 の範囲(E_F − E_i = ±0.40 eV・200〜500 K)で np/n_i² = 1.00 ± 0.01", () => {
    for (let T = 200; T <= 500; T += 10) {
      const ei = intrinsicLevel(SILICON, T);
      const ni2 = intrinsicDensity(SILICON, T) ** 2;
      for (let d = -0.4; d <= 0.4 + 1e-9; d += 0.005) {
        const eF = ei + d;
        const r =
          (electronDensity(SILICON, eF, T) * holeDensity(SILICON, eF, T)) / ni2;
        expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it("E_F = E_i で n = p = n_i", () => {
    for (const T of [200, 300, 500]) {
      const ei = intrinsicLevel(SILICON, T);
      const ni = intrinsicDensity(SILICON, T);
      expect(electronDensity(SILICON, ei, T) / ni).toBeCloseTo(1, 4);
      expect(holeDensity(SILICON, ei, T) / ni).toBeCloseTo(1, 4);
    }
  });
});

describe("T8: solveFermiLevel(電荷中性の区間二分法)", () => {
  const DENSITIES = [0, 1e12, 1e14, 1e16, 1e18, 1e20];

  it("電荷中性の残差が相対 1e-6 未満(N_D, N_A = 10¹²〜10²⁰、T = 50〜700 K)", () => {
    for (let T = 50; T <= 700; T += 50) {
      for (const nD of DENSITIES) {
        for (const nA of DENSITIES) {
          const eF = solveFermiLevel(SILICON, nD, nA, T);
          expect(Number.isFinite(eF)).toBe(true);
          const n = electronDensity(SILICON, eF, T);
          const p = holeDensity(SILICON, eF, T);
          const dP = ionizedDonors(SILICON, nD, eF, T);
          const aM = ionizedAcceptors(SILICON, nA, eF, T);
          const scale = Math.max(n, p, dP, aM);
          expect(Math.abs(p + dP - n - aM) / scale).toBeLessThan(1e-6);
        }
      }
    }
  });

  it("E_F は N_D に対して単調増加(N_A に対して単調減少)", () => {
    for (const T of [50, 300, 700]) {
      let prev = -Infinity;
      for (let lg = 10; lg <= 20; lg += 0.25) {
        const eF = solveFermiLevel(SILICON, 10 ** lg, 0, T);
        expect(eF).toBeGreaterThan(prev);
        prev = eF;
      }
      prev = Infinity;
      for (let lg = 10; lg <= 20; lg += 0.25) {
        const eF = solveFermiLevel(SILICON, 0, 10 ** lg, T);
        expect(eF).toBeLessThan(prev);
        prev = eF;
      }
    }
  });

  it("ドーピングなしなら E_F = E_i", () => {
    for (const T of [100, 300, 700]) {
      expect(solveFermiLevel(SILICON, 0, 0, T)).toBeCloseTo(
        intrinsicLevel(SILICON, T),
        6,
      );
    }
  });
});

describe("T9: Si の定数と図5 の読み取り値の整合", () => {
  it("300 K で n_i = (1.08 ± 0.05) × 10¹⁰ cm⁻³", () => {
    const ni = intrinsicDensity(SILICON, 300);
    expect(Math.abs(ni - 1.08e10)).toBeLessThan(0.05e10);
  });

  it("300 K の k_BT = 25.85 meV、E_g/k_BT = 43.3、E_i ≈ 0.559 eV", () => {
    expect(thermalEnergy(300) * 1000).toBeCloseTo(25.85, 2);
    expect(SILICON.eg / thermalEnergy(300)).toBeCloseTo(43.3, 1);
    expect(intrinsicLevel(SILICON, 300)).toBeCloseTo(0.559, 3);
  });

  it("P 10¹⁶・300 K: n = 1.0 × 10¹⁶(±2%)、イオン化率 > 99%、p ≈ 1.2 × 10⁴、E_F − E_i ≈ +0.355 eV", () => {
    const nD = 1e16;
    const eF = solveFermiLevel(SILICON, nD, 0, 300);
    const n = electronDensity(SILICON, eF, 300);
    expect(Math.abs(n / nD - 1)).toBeLessThan(0.02);
    expect(ionizedDonors(SILICON, nD, eF, 300) / nD).toBeGreaterThan(0.99);
    const p = holeDensity(SILICON, eF, 300);
    expect(p).toBeGreaterThan(1.15e4);
    expect(p).toBeLessThan(1.25e4);
    expect(eF - intrinsicLevel(SILICON, 300)).toBeCloseTo(0.355, 3);
  });

  it("B 10¹⁶・300 K は符号が反転した対称な結果(E_F − E_i ≈ −0.35 eV)", () => {
    const nA = 1e16;
    const eF = solveFermiLevel(SILICON, 0, nA, 300);
    expect(eF - intrinsicLevel(SILICON, 300)).toBeCloseTo(-0.355, 2);
    expect(ionizedAcceptors(SILICON, nA, eF, 300) / nA).toBeGreaterThan(0.99);
    expect(
      Math.abs(holeDensity(SILICON, eF, 300) / nA - 1),
    ).toBeLessThanOrEqual(0.02);
  });

  it("50 K でイオン化率 < 20%(凍結)、700 K で n > 1.3 N_D(真性領域の始まり)", () => {
    const nD = 1e16;
    const e50 = solveFermiLevel(SILICON, nD, 0, 50);
    const ion50 = ionizedDonors(SILICON, nD, e50, 50) / nD;
    expect(ion50).toBeLessThan(0.2);
    expect(ion50).toBeGreaterThan(0.03); // 試作の 5.2% 付近
    const e700 = solveFermiLevel(SILICON, nD, 0, 700);
    expect(electronDensity(SILICON, e700, 700)).toBeGreaterThan(1.3 * nD);
  });

  it("10¹⁶ の導電率は真性の約 70 万倍、不純物は Si 原子の 500 万分の 1", () => {
    const nD = 1e16;
    const eF = solveFermiLevel(SILICON, nD, 0, 300);
    const sigma = conductivity(
      SILICON,
      electronDensity(SILICON, eF, 300),
      holeDensity(SILICON, eF, 300),
    );
    const ni = intrinsicDensity(SILICON, 300);
    const ratio = sigma / conductivity(SILICON, ni, ni);
    expect(Number(ratio.toPrecision(1))).toBe(7e5);
    expect(SILICON.atomDensity / nD).toBe(5e6);
  });

  it("10¹⁹ cm⁻³ 以上は縮退、10¹⁶ は非縮退。10²⁰ の端まで NaN が出ない", () => {
    for (const T of [50, 300, 700]) {
      for (const nD of [1e19, 3e19, 1e20]) {
        const eF = solveFermiLevel(SILICON, nD, 0, T);
        expect(Number.isFinite(eF)).toBe(true);
        expect(Number.isFinite(electronDensity(SILICON, eF, T))).toBe(true);
        if (T === 300) expect(isDegenerate(SILICON, eF, T)).toBe(true);
      }
    }
    expect(
      isDegenerate(SILICON, solveFermiLevel(SILICON, 1e16, 0, 300), 300),
    ).toBe(false);
  });

  it("有効状態密度は T^{3/2} に比例する", () => {
    const a = effectiveDos(SILICON, 300);
    const b = effectiveDos(SILICON, 600);
    expect(b.nc / a.nc).toBeCloseTo(2 ** 1.5, 10);
    expect(b.nv / a.nv).toBeCloseTo(2 ** 1.5, 10);
    expect(a.nc).toBe(SILICON.nc300);
  });
});

describe("T10: 擬フェルミ準位", () => {
  it("熱平衡では E_Fn = E_Fp = E_F(逆関数で元の E_F に戻る)", () => {
    for (const T of [200, 300, 500]) {
      for (const eF of [0.15, 0.4, 0.56, 0.8, 1.0, 1.2, -0.05]) {
        const n = electronDensity(SILICON, eF, T);
        const p = holeDensity(SILICON, eF, T);
        expect(fermiLevelForElectrons(SILICON, n, T)).toBeCloseTo(eF, 9);
        expect(fermiLevelForHoles(SILICON, p, T)).toBeCloseTo(eF, 9);
      }
    }
  });

  it("過剰キャリアありで E_Fn − E_Fp = k_BT ln(np/n_i²)(非縮退域で 1e-6 eV 以内)", () => {
    // 非縮退域 = 擬フェルミ準位が両方のバンド端から 10k_BT 以上離れている条件。
    // 式 E13 はボルツマン近似の式なので、縮退に近づくと F_{1/2} との差
    // (相対 e^η/2^{3/2})の分だけずれる(η = −9 で約 1.5 μeV)
    let tested = 0;
    for (const T of [250, 300, 400]) {
      const kT = thermalEnergy(T);
      const ei = intrinsicLevel(SILICON, T);
      for (const d of [-0.2, -0.1, 0, 0.1, 0.2]) {
        const eF = ei + d;
        for (const excess of [1e10, 1e12, 1e14]) {
          const n = electronDensity(SILICON, eF, T) + excess;
          const p = holeDensity(SILICON, eF, T) + excess;
          const eFn = fermiLevelForElectrons(SILICON, n, T);
          const eFp = fermiLevelForHoles(SILICON, p, T);
          expect(SILICON.eg - eFn).toBeGreaterThan(10 * kT);
          expect(eFp).toBeGreaterThan(10 * kT);
          const split = eFn - eFp;
          expect(split).toBeGreaterThan(0);
          expect(
            Math.abs(split - quasiFermiSplit(SILICON, n, p, T)),
          ).toBeLessThan(1e-6);
          tested++;
        }
      }
    }
    expect(tested).toBe(45);
  });

  it("熱平衡なら quasiFermiSplit は 0(非縮退域)", () => {
    const T = 300;
    for (const d of [-0.3, 0, 0.3]) {
      const eF = intrinsicLevel(SILICON, T) + d;
      const split = quasiFermiSplit(
        SILICON,
        electronDensity(SILICON, eF, T),
        holeDensity(SILICON, eF, T),
        T,
      );
      expect(Math.abs(split)).toBeLessThan(1e-4);
    }
  });
});

describe("密度関数の数値安全性(スライダーの端)", () => {
  it("T = 0 や極端な E_F でも NaN・Infinity を出さない", () => {
    for (const T of [0, 1, 50, 2000]) {
      for (const eF of [-1, 0, 0.56, 1.12, 2.12]) {
        for (const v of [
          electronDensity(SILICON, eF, T),
          holeDensity(SILICON, eF, T),
          intrinsicDensity(SILICON, T),
          intrinsicLevel(SILICON, T),
          ionizedDonors(SILICON, 1e16, eF, T),
          ionizedAcceptors(SILICON, 1e16, eF, T),
        ]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });
});
