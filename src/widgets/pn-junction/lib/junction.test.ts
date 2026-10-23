/**
 * junction.test.ts — 空乏層近似とダイオード式の単体テスト(仕様書 13 §5.7)
 *
 * T1〜T5・T8・T9 を担保する。とくに T1(空乏層の電荷中性 N_A x_p = N_D x_n)は
 * 図2 の主張そのもの。代表値(§2.3: V_bi = 0.710 V、W = 0.429 μm、
 * 𝓔_max = 33.1 kV/cm、J₀ = 1.76 × 10⁻¹¹ A/cm²)も表示桁で確かめる。
 */

import { describe, expect, it } from "vitest";
import {
  intrinsicDensity,
  SILICON,
  solveFermiLevel,
  thermalEnergy,
} from "../../_shared/semiconductor";
import { J_LIGHT_ONE_SUN, ROOM_T, SI_LIFETIMES } from "./constants";
import {
  bandEdges,
  builtInPotential,
  chargeDensity,
  depletion,
  diffusionCoefficients,
  diffusionLengths,
  diodeCurrent,
  displayHalfRange,
  electricField,
  emissionWavelengthNm,
  maxPowerPoint,
  openCircuitVoltage,
  potential,
  quasiFermiLevels,
  saturationCurrent,
  voltsPerDecade,
} from "./junction";

const T = ROOM_T;
const kT = thermalEnergy(T);
const DOPINGS = [1e14, 1e15, 1e16, 1e17, 1e18];
/** 1 kV/cm × 1 μm = 0.1 V */
const VOLT_PER_KVCM_UM = 0.1;

/** 区間 [a, b] の台形則(n 区間) */
function trapezoid(f: (x: number) => number, a: number, b: number, n: number) {
  const h = (b - a) / n;
  let s = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) s += f(a + i * h);
  return s * h;
}

describe("T1: 空乏層の電荷中性 N_A x_p = N_D x_n", () => {
  it("5 × 5 のドーピングの組み合わせ・複数のバイアスで相対 1e-12 以内", () => {
    for (const nA of DOPINGS) {
      for (const nD of DOPINGS) {
        for (const V of [0, -5, 0.3]) {
          const d = depletion(SILICON, nA, nD, V, T);
          const left = nA * d.xp;
          const right = nD * d.xn;
          expect(Math.abs(left - right) / left).toBeLessThan(1e-12);
          expect(d.xp + d.xn).toBeCloseTo(d.w, 12);
        }
      }
    }
  });

  it("電荷密度の積分(矩形の面積)が左右で等しく、総電荷はゼロ", () => {
    const d = depletion(SILICON, 1e17, 1e15, 0, T);
    const f = (x: number) => chargeDensity(d, x);
    const neg = trapezoid(f, -d.xp, 0, 4000);
    const pos = trapezoid(f, 0, d.xn, 4000);
    expect(Math.abs(neg + pos) / pos).toBeLessThan(2e-3);
    expect(chargeDensity(d, -2 * d.xp - 1)).toBe(0);
    expect(chargeDensity(d, d.xn + 1)).toBe(0);
  });
});

describe("T2: 内蔵電位 V_bi(式 E1)", () => {
  it("solveFermiLevel で求めた両側の E_F の差に一致する", () => {
    for (const nA of DOPINGS) {
      for (const nD of DOPINGS) {
        const expected =
          solveFermiLevel(SILICON, nD, 0, T) -
          solveFermiLevel(SILICON, 0, nA, T);
        expect(builtInPotential(SILICON, nA, nD, T)).toBe(expected);
        expect(depletion(SILICON, nA, nD, 0, T).vbi).toBe(expected);
      }
    }
  });

  // 10¹⁷ cm⁻³ 以上ではドーパントのイオン化が 9 割台〜6 割台に下がる(B は
  // g_A = 4 で深め)ので、完全イオン化を仮定した k_BT·ln(N_A N_D/n_i²) から
  // 数 mV〜十数 mV 下にずれる。1 mV 以内を確かめるのはイオン化 99% 以上の
  // 10¹⁴〜10¹⁶ cm⁻³(非縮退・完全イオン化)の範囲
  it("非縮退・完全イオン化の範囲で k_BT ln(N_A N_D/n_i²) と 1 mV 以内", () => {
    const ni = intrinsicDensity(SILICON, T);
    for (const nA of [1e14, 1e15, 1e16]) {
      for (const nD of [1e14, 1e15, 1e16]) {
        const vbi = builtInPotential(SILICON, nA, nD, T);
        const simple = kT * Math.log((nA * nD) / (ni * ni));
        expect(Math.abs(vbi - simple)).toBeLessThan(1e-3);
      }
    }
  });

  it("片側のドーピングを 10 倍にすると約 k_BT ln10(59.5 mV)ずつ増える(対数的)", () => {
    for (const nA of [1e14, 1e15]) {
      const step =
        builtInPotential(SILICON, nA * 10, 1e16, T) -
        builtInPotential(SILICON, nA, 1e16, T);
      expect(Math.abs(step - kT * Math.LN10)).toBeLessThan(1e-3);
    }
    // 全範囲で単調に増え、1 桁あたりの増え方は k_BT ln10 を超えない
    let prev = -Infinity;
    for (let e = 14; e <= 18 + 1e-9; e += 0.25) {
      const v = builtInPotential(SILICON, 10 ** e, 1e16, T);
      expect(v).toBeGreaterThan(prev);
      if (Number.isFinite(prev)) {
        expect(v - prev).toBeLessThan(0.25 * kT * Math.LN10 + 1e-4);
      }
      prev = v;
    }
  });

  it("既定値(N_A = N_D = 10¹⁶)で V_bi = 0.710 V", () => {
    expect(builtInPotential(SILICON, 1e16, 1e16, T).toFixed(3)).toBe("0.710");
  });
});

describe("T3: ガウスの法則(電場の三角形と電位)", () => {
  const cases: Array<[number, number, number]> = [
    [1e16, 1e16, 0],
    [1e18, 1e15, 0],
    [1e15, 1e17, -2],
    [1e16, 1e16, 0.4],
    [1e14, 1e18, -5],
  ];

  it("電場の数値積分 = −(V_bi − V)(1e-6 V)、電位の段差と一致", () => {
    for (const [nA, nD, V] of cases) {
      const d = depletion(SILICON, nA, nD, V, T);
      const f = (x: number) => electricField(d, x);
      // 三角形は区分的に線形なので、0 を節点に含む台形則は厳密に近い
      const integral =
        trapezoid(f, -d.xp, 0, 2000) + trapezoid(f, 0, d.xn, 2000);
      expect(Math.abs(integral * VOLT_PER_KVCM_UM + (d.vbi - V))).toBeLessThan(
        1e-6,
      );
      expect(potential(d, d.xn) - potential(d, -d.xp)).toBeCloseTo(
        d.vbi - V,
        12,
      );
      // 接合面で電位がつながる
      expect(Math.abs(potential(d, -1e-12) - potential(d, 1e-12))).toBeLessThan(
        1e-9,
      );
      // 両端で電場はゼロ
      expect(electricField(d, -d.xp)).toBe(0);
      expect(electricField(d, d.xn)).toBe(0);
    }
  });

  it("𝓔 = −dψ/dx(数値微分)", () => {
    const d = depletion(SILICON, 1e16, 1e17, 0, T);
    const h = 1e-6; // μm
    for (const x of [-0.2, -0.05, 0.01, 0.03]) {
      const dpsi = (potential(d, x + h) - potential(d, x - h)) / (2 * h);
      // dψ/dx [V/μm] → kV/cm は × 10
      expect(-dpsi * 10).toBeCloseTo(electricField(d, x), 4);
    }
  });

  it("𝓔_max = 2(V_bi − V)/W(式 E5)、最大は接合面", () => {
    for (const [nA, nD, V] of cases) {
      const d = depletion(SILICON, nA, nD, V, T);
      // drop [V] / W [μm] → V/μm = 10 kV/cm
      const expected = ((2 * (d.vbi - V)) / d.w) * 10;
      expect(Math.abs(d.eMax - expected) / expected).toBeLessThan(1e-12);
      expect(Math.abs(electricField(d, 0) + d.eMax) / d.eMax).toBeLessThan(
        1e-12,
      );
    }
  });

  it("バンド端は中性領域で平ら、E_F は熱平衡で一直線", () => {
    const d = depletion(SILICON, 1e16, 1e16, 0, T);
    const R = displayHalfRange(d);
    const left = bandEdges(SILICON, d, -R, T);
    const right = bandEdges(SILICON, d, R, T);
    expect(left.ec).toBeCloseTo(SILICON.eg, 12);
    expect(left.ev).toBeCloseTo(0, 12);
    expect(right.ec).toBeCloseTo(SILICON.eg - d.vbi, 12);
    expect(left.ec - left.ev).toBeCloseTo(SILICON.eg, 12);
    // n 側の E_F(自分の E_v から efn)を共通の原点で測ると p 側の E_F と同じ
    expect(right.ev + d.efn).toBeCloseTo(d.efp, 12);
    const q = quasiFermiLevels(d);
    expect(q.eFn).toBe(q.eFp);
  });
});

describe("T4: 空乏層の幅と非対称", () => {
  it("W ∝ √(V_bi − V)", () => {
    const d0 = depletion(SILICON, 1e16, 1e16, 0, T);
    for (const V of [-5, -1, 0.3, 0.5]) {
      const d = depletion(SILICON, 1e16, 1e16, V, T);
      const ratio = d.w / d0.w;
      expect(ratio).toBeCloseTo(Math.sqrt((d0.vbi - V) / d0.vbi), 12);
    }
  });

  it("既定値で W = 0.429 μm、x_p = x_n = 214 nm、𝓔_max = 33.1 kV/cm", () => {
    const d = depletion(SILICON, 1e16, 1e16, 0, T);
    expect(d.w.toFixed(3)).toBe("0.429");
    expect(Math.round(d.xp * 1000)).toBe(214);
    expect(Math.round(d.xn * 1000)).toBe(214);
    expect(d.eMax.toFixed(1)).toBe("33.1");
  });

  it("−5 V で 1.215 μm、+0.5 V で 0.233 μm(図5)", () => {
    expect(depletion(SILICON, 1e16, 1e16, -5, T).w.toFixed(3)).toBe("1.215");
    expect(depletion(SILICON, 1e16, 1e16, 0.5, T).w.toFixed(3)).toBe("0.233");
  });

  it("N_A ≫ N_D で x_p/x_n = N_D/N_A、空乏層はほぼ n 側だけ", () => {
    const d = depletion(SILICON, 1e18, 1e15, 0, T);
    expect(d.xp / d.xn).toBeCloseTo(1e15 / 1e18, 15);
    // 読み取り: x_p ≈ 1 nm、x_n ≈ 1.0 μm
    expect(Math.round(d.xp * 1000)).toBe(1);
    expect(d.xn.toFixed(1)).toBe("1.0");
  });

  it("濃くドープした側ほど空乏層が薄い", () => {
    for (const nA of DOPINGS) {
      for (const nD of DOPINGS) {
        const d = depletion(SILICON, nA, nD, 0, T);
        if (nA > nD) expect(d.xp).toBeLessThan(d.xn);
        else if (nA < nD) expect(d.xp).toBeGreaterThan(d.xn);
        else expect(d.xp).toBeCloseTo(d.xn, 12);
      }
    }
  });

  it("V ≥ V_bi − 0.02 は空乏層近似の適用外としてクランプする", () => {
    const d = depletion(SILICON, 1e15, 1e15, 0.65, T);
    expect(d.clamped).toBe(true);
    expect(d.drop).toBeCloseTo(0.02, 12);
    expect(Number.isFinite(d.w) && d.w > 0).toBe(true);
    expect(depletion(SILICON, 1e16, 1e16, 0.65, T).clamped).toBe(false);
  });

  it("表示範囲は max(1.5W, 0.6 μm)", () => {
    expect(displayHalfRange(depletion(SILICON, 1e16, 1e16, 0, T))).toBeCloseTo(
      1.5 * depletion(SILICON, 1e16, 1e16, 0, T).w,
      12,
    );
    expect(displayHalfRange(depletion(SILICON, 1e18, 1e18, 0, T))).toBe(0.6);
  });
});

describe("T5: 理想ダイオード式(式 E9・E10)", () => {
  const j0 = saturationCurrent(SILICON, SI_LIFETIMES, 1e16, 1e16, T);

  it("拡散係数・拡散長・J₀ が §2.3 の代表値", () => {
    const { dn, dp } = diffusionCoefficients(SILICON, T);
    expect(dn.toFixed(1)).toBe("34.9");
    expect(dp.toFixed(1)).toBe("12.4");
    const { ln, lp } = diffusionLengths(SILICON, SI_LIFETIMES, T);
    expect(Math.round(ln * 1e4)).toBe(59);
    expect(Math.round(lp * 1e4)).toBe(35);
    expect(j0.toPrecision(3)).toBe("1.76e-11");
  });

  it("J(0) = 0、J(−5 V) ≈ −J₀", () => {
    expect(diodeCurrent(j0, 0, T)).toBe(0);
    expect(Math.abs(diodeCurrent(j0, -5, T) / -j0 - 1)).toBeLessThan(1e-12);
  });

  it("順方向で 1 桁あたり k_BT ln10(59.5 mV)、0.1 V で 47.9 倍", () => {
    expect((voltsPerDecade(T) * 1000).toFixed(1)).toBe("59.5");
    const dv = voltsPerDecade(T);
    for (const V of [0.3, 0.45, 0.6]) {
      const r = diodeCurrent(j0, V + dv, T) / diodeCurrent(j0, V, T);
      expect(Math.abs(r - 10)).toBeLessThan(1e-3);
    }
    const r01 = diodeCurrent(j0, 0.6, T) / diodeCurrent(j0, 0.5, T);
    expect(r01.toFixed(1)).toBe("47.9");
  });

  it("指数のクランプで NaN・Infinity が出ない", () => {
    for (const V of [-1e6, -5, -1e-9, 0, 1e-9, 0.65, 5, 1e6, NaN]) {
      for (const temp of [0, 1, 300, 700]) {
        expect(Number.isFinite(diodeCurrent(j0, V, temp))).toBe(true);
        expect(Number.isFinite(diodeCurrent(j0, V, temp, 0.035))).toBe(true);
      }
    }
  });
});

describe("T8: 太陽電池(式 E13・E14)", () => {
  const j0 = saturationCurrent(SILICON, SI_LIFETIMES, 1e16, 1e16, T);

  it("J(V_oc) = 0(1e-12)、J(0) = −J_L", () => {
    for (const suns of [0.05, 0.3, 1]) {
      const jL = J_LIGHT_ONE_SUN * suns;
      const voc = openCircuitVoltage(j0, jL, T);
      expect(Math.abs(diodeCurrent(j0, voc, T, jL))).toBeLessThan(1e-12);
      expect(diodeCurrent(j0, 0, T, jL)).toBe(-jL);
      expect(voc).toBeCloseTo(kT * Math.log(jL / j0 + 1), 12);
    }
  });

  it("1 太陽で V_oc ≈ 0.55 V、光がなければ 0", () => {
    const voc = openCircuitVoltage(j0, J_LIGHT_ONE_SUN, T);
    expect(voc).toBeGreaterThan(0.545);
    expect(voc).toBeLessThan(0.56);
    expect(openCircuitVoltage(j0, 0, T)).toBe(0);
  });

  it("最大電力点で電力が極大", () => {
    const jL = J_LIGHT_ONE_SUN;
    const mpp = maxPowerPoint(j0, jL, T);
    const voc = openCircuitVoltage(j0, jL, T);
    expect(mpp.v).toBeGreaterThan(0);
    expect(mpp.v).toBeLessThan(voc);
    for (let i = 0; i <= 200; i++) {
      const v = (voc * i) / 200;
      expect(-diodeCurrent(j0, v, T, jL) * v).toBeLessThanOrEqual(
        mpp.p + 1e-12,
      );
    }
    expect(maxPowerPoint(j0, 0, T).p).toBe(0);
  });
});

describe("T9: 発光波長 λ = 1239.84/E_g(式 E12)", () => {
  it("Si 1107 nm・GaAs 873 nm・InGaN(2.7 eV)459 nm", () => {
    expect(Math.round(emissionWavelengthNm(1.12))).toBe(1107);
    expect(Math.round(emissionWavelengthNm(1.42))).toBe(873);
    expect(Math.round(emissionWavelengthNm(2.7))).toBe(459);
    expect(Number.isNaN(emissionWavelengthNm(0))).toBe(true);
  });
});
