/**
 * aging.test.ts — 時効モデルの単体テスト(記事仕様書 07 §5.0)
 *
 * 本記事の主張がモデルの上で成り立っていることを検証する:
 * 状態図(固溶限)・過剰空孔・2 機構の交点・時効曲線の温度依存。
 */

import { describe, expect, it } from "vitest";
import {
  BETA,
  C0_WT,
  C_EUT_WT,
  HV0,
  HV_PEAK,
  KELVIN,
  MU_B_MPA_NM,
  R_CROSS_NM,
  T_EUT_C,
  coarseningK,
  precipitationTime,
  solubilityWt,
  solvusTemperatureK,
  supersaturation,
  vacancyEq,
} from "./constants";
import {
  agingStateAt,
  bowingMPa,
  equilibriumFraction,
  findPeak,
  hardnessHV,
  mechanismAt,
  shearingMPa,
  spacing,
  strengtheningMPa,
} from "./aging";

const C = (celsius: number): number => celsius + KELVIN;

describe("Al–Cu の固溶限(§5.2 図2)", () => {
  it("共晶温度で最大固溶量 5.65 wt% に達し、それ以上では頭打ち", () => {
    expect(solubilityWt(C(T_EUT_C))).toBeCloseTo(C_EUT_WT, 2);
    expect(solubilityWt(C(700))).toBe(C_EUT_WT);
  });

  it("300 °C で約 0.5 wt%(フィットの第 2 点)", () => {
    expect(solubilityWt(C(300))).toBeGreaterThan(0.45);
    expect(solubilityWt(C(300))).toBeLessThan(0.55);
  });

  it("室温の固溶限はほぼゼロ(0.01 wt% 未満)", () => {
    expect(solubilityWt(C(20))).toBeLessThan(0.01);
  });

  it("solvus の逆関数が往復で一致する", () => {
    for (const c of [0.5, 1, 2, 4]) {
      expect(solubilityWt(solvusTemperatureK(c))).toBeCloseTo(c, 6);
    }
  });

  it("4 wt% の合金は約 500 °C で単相 α になる(溶体化温度の目安)", () => {
    const tC = solvusTemperatureK(C0_WT) - KELVIN;
    expect(tC).toBeGreaterThan(480);
    expect(tC).toBeLessThan(520);
  });

  it("室温では過飽和度が 1000 倍を大きく超える", () => {
    expect(supersaturation(C(20))).toBeGreaterThan(1e3);
  });
});

describe("空孔(§5.3 図3)", () => {
  it("500 °C の平衡空孔濃度は室温平衡の 10⁶ 倍を超える", () => {
    expect(vacancyEq(C(500)) / vacancyEq(C(20))).toBeGreaterThan(1e6);
  });

  it("平衡空孔濃度は温度とともに単調増加する", () => {
    let prev = 0;
    for (let t = 0; t <= 600; t += 50) {
      const v = vacancyEq(C(t));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe("2 機構と交点(§5.6 図6・§5.7 図7)", () => {
  it("せん断応力は半径の増加関数、オロワン応力は減少関数", () => {
    const f = 0.07;
    for (let r = 0.5; r < 20; r *= 1.4) {
      expect(shearingMPa(r * 1.1, f)).toBeGreaterThan(shearingMPa(r, f));
      expect(bowingMPa(r * 1.1, f)).toBeLessThan(bowingMPa(r, f));
    }
  });

  it("交点半径は体積分率によらず r× = 3 nm(モデルの構造)", () => {
    for (const f of [0.02, 0.05, 0.07, 0.12]) {
      expect(shearingMPa(R_CROSS_NM, f)).toBeCloseTo(
        bowingMPa(R_CROSS_NM, f),
        6,
      );
      expect(mechanismAt(R_CROSS_NM * 0.8, f)).toBe("cut");
      expect(mechanismAt(R_CROSS_NM * 1.25, f)).toBe("bow");
    }
  });

  it("体積分率を上げるとピークの高さだけが上がる(両機構とも √f 比例)", () => {
    const lo = strengtheningMPa(R_CROSS_NM, 0.03);
    const hi = strengtheningMPa(R_CROSS_NM, 0.12);
    expect(hi / lo).toBeCloseTo(Math.sqrt(0.12 / 0.03), 6);
  });

  it("オロワン応力は μb/L に一致する(フランク・リード源の式と同じ)", () => {
    const r = 5;
    const f = 0.07;
    expect(spacing(r, f)).toBeCloseTo((BETA * r) / Math.sqrt(f), 9);
    expect(bowingMPa(r, f)).toBeCloseTo(MU_B_MPA_NM / spacing(r, f), 9);
  });

  it("Δτ は常に 2 機構の小さい方", () => {
    for (const r of [0.5, 1, 3, 10, 50]) {
      const d = strengtheningMPa(r, 0.07);
      expect(d).toBeCloseTo(Math.min(shearingMPa(r, 0.07), bowingMPa(r, 0.07)));
    }
  });
});

describe("時効モデルの温度依存(§5.0・§5.1 図1)", () => {
  it("平衡体積分率は 7% 前後で、20〜250 °C ではほとんど変わらない", () => {
    const f20 = equilibriumFraction(C(20));
    const f250 = equilibriumFraction(C(250));
    expect(f20).toBeGreaterThan(0.06);
    expect(f20).toBeLessThan(0.09);
    expect(Math.abs(f250 - f20) / f20).toBeLessThan(0.1);
  });

  it("硬さの校正: Δτ = 0 で HV0、130 °C のピークで HV_PEAK", () => {
    expect(hardnessHV(0)).toBeCloseTo(HV0, 9);
    expect(findPeak(C(130)).hv).toBeCloseTo(HV_PEAK, 0);
  });

  it("高温ほどピークは早く、そして低い(記事の主要な主張)", () => {
    const p130 = findPeak(C(130));
    const p190 = findPeak(C(190));
    const p250 = findPeak(C(250));
    expect(p130.t).toBeGreaterThan(p190.t);
    expect(p190.t).toBeGreaterThan(p250.t);
    expect(p130.hv).toBeGreaterThan(p190.hv + 5);
    expect(p190.hv).toBeGreaterThan(p250.hv + 5);
  });

  it("ピーク時効の時間が古典的な熱処理条件の桁に収まる", () => {
    // 130 °C は数時間〜1 日、190 °C は 1 時間前後、250 °C は 1 時間未満
    const p130 = findPeak(C(130));
    expect(p130.t).toBeGreaterThan(3 * 3600);
    expect(p130.t).toBeLessThan(30 * 3600);
    expect(findPeak(C(190)).t).toBeLessThan(4 * 3600);
    expect(findPeak(C(250)).t).toBeLessThan(3600);
  });

  it("ピークは交点半径の近くで起きる(交点 = ピーク時効)", () => {
    const p = findPeak(C(130));
    expect(p.r).toBeGreaterThan(R_CROSS_NM * 0.8);
    expect(p.r).toBeLessThan(R_CROSS_NM * 1.25);
  });

  it("130 °C の曲線は 1 つの山(単調増加 → 単調減少)", () => {
    const hv: number[] = [];
    for (let i = 0; i <= 90; i++)
      hv.push(agingStateAt(10 ** (i / 10), C(130)).hv);
    let peak = 0;
    for (let i = 1; i < hv.length; i++) if (hv[i] > hv[peak]) peak = i;
    for (let i = 1; i <= peak; i++)
      expect(hv[i]).toBeGreaterThanOrEqual(hv[i - 1]);
    for (let i = peak + 1; i < hv.length; i++)
      expect(hv[i]).toBeLessThanOrEqual(hv[i - 1]);
  });

  it("ピークの前は切断、後は迂回", () => {
    const p = findPeak(C(130));
    expect(agingStateAt(p.t / 10, C(130)).mech).toBe("cut");
    expect(agingStateAt(p.t * 10, C(130)).mech).toBe("bow");
  });

  it("室温では数日でピークの 8 割に達し、そこから先は年オーダー", () => {
    const peak = findPeak(C(130)).hv;
    const days3 = agingStateAt(3 * 86400, C(20)).hv;
    expect(days3).toBeGreaterThan(HV0 + 0.75 * (peak - HV0));
    // 3 日から 100 日でもわずかしか進まない(頭打ちに見える)
    const days100 = agingStateAt(100 * 86400, C(20)).hv;
    expect(days100 - days3).toBeLessThan(0.15 * (peak - HV0));
  });

  it("焼入れ直後(t → 0)は析出がなく HV0", () => {
    const s = agingStateAt(0, C(130));
    expect(s.f).toBe(0);
    expect(s.hv).toBeCloseTo(HV0, 9);
  });

  it("速度定数は温度とともに単調に増える", () => {
    for (let t = 20; t < 250; t += 20) {
      expect(coarseningK(C(t + 20))).toBeGreaterThan(coarseningK(C(t)));
      expect(precipitationTime(C(t + 20))).toBeLessThan(
        precipitationTime(C(t)),
      );
    }
  });
});
