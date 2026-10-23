/**
 * dos.test.ts — 図3 の状態密度と数値積分の単体テスト(仕様書 12 §5.8 T5)
 *
 * 状態密度の規格化と図の整合: 図3 の数値積分 ∫g_c f dE が、解析式
 * electronDensity = N_c·F_{1/2}(η) と一致することを図の全操作範囲で確かめる。
 *
 * 許容誤差について: 仕様書は 0.5% としているが、electronDensity が使う
 * Aymerich-Humet の近似そのものの最大誤差が 0.53%(η ≈ 2.06 の縮退域)あり、
 * 数値積分がほぼ厳密でもこの近傍だけは 0.5% を超える。そこで全域では 0.6%、
 * 近似式が厳密に近い非縮退域(η < −5。近似の誤差は 3 × 10⁻⁴ 程度)では
 * 0.1% で検証する。
 */

import { describe, expect, it } from "vitest";
import {
  electronDensity,
  holeDensity,
  intrinsicDensity,
  intrinsicLevel,
  SILICON,
  thermalEnergy,
} from "../../_shared/semiconductor";
import {
  dosConduction,
  dosValence,
  integrateElectrons,
  integrateHoles,
} from "./dos";

describe("T5: 図3 の数値積分と electronDensity の整合", () => {
  it("図の全範囲(E_F −0.20〜1.32 eV・100〜1000 K)で 0.6% 以内、非縮退域(η < −5)では 0.1% 以内", () => {
    let worst = 0;
    for (let T = 100; T <= 1000; T += 50) {
      const kT = thermalEnergy(T);
      for (let eF = -0.2; eF <= 1.32 + 1e-9; eF += 0.02) {
        const n = integrateElectrons(SILICON, eF, T).density;
        const p = integrateHoles(SILICON, eF, T).density;
        const relN = Math.abs(n / electronDensity(SILICON, eF, T) - 1);
        const relP = Math.abs(p / holeDensity(SILICON, eF, T) - 1);
        worst = Math.max(worst, relN, relP);
        expect(relN).toBeLessThan(0.006);
        expect(relP).toBeLessThan(0.006);
        if ((eF - SILICON.eg) / kT < -5) expect(relN).toBeLessThan(1e-3);
        if (-eF / kT < -5) expect(relP).toBeLessThan(1e-3);
      }
    }
    expect(worst).toBeGreaterThan(0); // 実際に比べている
  });

  it("E_F = E_i(≈ 0.559 eV)・300 K で n ≈ p ≈ 1.1 × 10¹⁰ cm⁻³", () => {
    const eI = intrinsicLevel(SILICON, 300);
    const n = integrateElectrons(SILICON, eI, 300).density;
    const p = integrateHoles(SILICON, eI, 300).density;
    expect(n).toBeGreaterThan(1.05e10);
    expect(n).toBeLessThan(1.12e10);
    expect(p / n).toBeCloseTo(1, 3);
    expect(n / intrinsicDensity(SILICON, 300)).toBeCloseTo(1, 3);
  });

  it("E_F を k_BT ln 10 上げると n が 10 倍・p が 1/10(非縮退域)", () => {
    const T = 300;
    const step = thermalEnergy(T) * Math.log(10);
    const n0 = integrateElectrons(SILICON, 0.56, T).density;
    const n1 = integrateElectrons(SILICON, 0.56 + step, T).density;
    const p0 = integrateHoles(SILICON, 0.56, T).density;
    const p1 = integrateHoles(SILICON, 0.56 + step, T).density;
    expect(n1 / n0).toBeCloseTo(10, 3);
    expect(p1 / p0).toBeCloseTo(0.1, 4);
  });

  it("電子の山の 90% は伝導帯の底から約 3.1 k_BT 以内(非縮退域)、縮退すると広がる", () => {
    const w = integrateElectrons(SILICON, 0.56, 300).width90;
    // 非縮退域の分布 √ε·e^{−ε} の 90% 点(ガンマ分布 Γ(3/2) の 90 パーセント点)
    expect(w).toBeCloseTo(3.13, 1);
    const degenerate = integrateElectrons(SILICON, 1.3, 300).width90;
    expect(degenerate).toBeGreaterThan(w);
  });
});

describe("状態密度の形", () => {
  it("g_c は √(E − E_c) に比例し、ギャップの中では 0", () => {
    const T = 300;
    expect(dosConduction(SILICON, 1.0, T)).toBe(0);
    expect(dosValence(SILICON, 0.5, T)).toBe(0);
    const g1 = dosConduction(SILICON, SILICON.eg + 0.01, T);
    const g4 = dosConduction(SILICON, SILICON.eg + 0.04, T);
    expect(g4 / g1).toBeCloseTo(2, 10);
    const v1 = dosValence(SILICON, -0.01, T);
    const v4 = dosValence(SILICON, -0.04, T);
    expect(v4 / v1).toBeCloseTo(2, 10);
  });

  it("g_c は温度によらない(席の数は温度で変わらない)", () => {
    const e = SILICON.eg + 0.1;
    expect(dosConduction(SILICON, e, 600)).toBeCloseTo(
      dosConduction(SILICON, e, 300),
      -10,
    );
    expect(
      dosConduction(SILICON, e, 600) / dosConduction(SILICON, e, 300),
    ).toBeCloseTo(1, 10);
  });
});
