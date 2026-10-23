/**
 * tunneling.test.ts — 矩形障壁の解析解と傾いた壁の単体テスト(仕様書 14 §5.8)
 *
 * T1: 透過率の解析解の正しさ(0 ≤ T ≤ 1、V → 0 で 1、E = V で連続、共鳴で 1)
 * T2: 厚い壁で ln T の傾きが −2κ になる(最重要 — 記事の「指数関数」の担保)
 * T8: フラッシュメモリの保持時間と書き込みの指数(図7 の数値)
 * T9: 定常解の壁の境界での連続性と、右側の |ψ|² = T(図2 の担保)
 */

import { describe, expect, it } from "vitest";
import {
  ATTEMPT_FREQUENCY_HZ,
  HBAR2_OVER_2ME,
  MV_PER_CM_TO_V_PER_NM,
  SIO2_BARRIER_EV,
  SIO2_MASS_RATIO,
} from "./constants";
import {
  decayingAmplitude,
  evalWave,
  fowlerNordheimTime,
  kappa,
  logTransmission,
  logTransmissionApprox,
  retentionTime,
  solveBarrier,
  stationaryWave,
  thickBarrierPrefactor,
  tiltedBarrierExponent,
  transmission,
  triangularExponent,
  type Complex,
} from "./tunneling";

const C = HBAR2_OVER_2ME;

describe("T1: 矩形障壁の透過率の解析解", () => {
  it("どんな条件でも 0 ≤ T ≤ 1 で、NaN にならない", () => {
    for (let E = 0.05; E <= 10; E += 0.35) {
      for (let V = -3; V <= 10; V += 0.7) {
        for (let d = 0; d <= 3; d += 0.13) {
          const T = transmission(E, V, d);
          expect(Number.isNaN(T)).toBe(false);
          expect(T).toBeGreaterThanOrEqual(0);
          expect(T).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("壁の高さ V → 0 で T → 1", () => {
    for (const E of [0.2, 1, 4]) {
      for (const d of [0.1, 0.5, 2]) {
        expect(transmission(E, 0, d)).toBe(1);
        expect(transmission(E, 1e-6, d)).toBeCloseTo(1, 9);
        expect(transmission(E, 1e-3, d)).toBeGreaterThan(0.999);
      }
    }
  });

  it("厚さ d → 0 でも T → 1", () => {
    expect(transmission(1, 5, 0)).toBe(1);
    expect(transmission(1, 5, 1e-6)).toBeCloseTo(1, 9);
  });

  it("E = V の前後で連続(差 1e-4 未満)で、極限の値 1/(1 + Vd²/4C) に一致する", () => {
    for (const V of [1, 4, 8]) {
      for (const d of [0.2, 0.5, 1.5]) {
        const below = transmission(V - 1e-7, V, d);
        const at = transmission(V, V, d);
        const above = transmission(V + 1e-7, V, d);
        expect(Math.abs(below - above)).toBeLessThan(1e-4);
        expect(Math.abs(at - below)).toBeLessThan(1e-4);
        expect(at).toBeCloseTo(1 / (1 + (V * d * d) / (4 * C)), 10);
      }
    }
  });

  it("E > V で壁の中の波数 k' が k'd = nπ を満たすと共鳴して T = 1", () => {
    const V = 4;
    const d = 0.5;
    for (let n = 1; n <= 4; n++) {
      const kp = (n * Math.PI) / d;
      const E = V + C * kp * kp;
      expect(transmission(E, V, d)).toBeCloseTo(1, 12);
      // 共鳴の間では T < 1(E > V でも反射が残る)
      const kMid = ((n + 0.5) * Math.PI) / d;
      expect(transmission(V + C * kMid * kMid, V, d)).toBeLessThan(0.999);
    }
  });

  it("E > V でも反射が残る(図1 の受け入れ基準: 越えられるのに跳ね返る)", () => {
    expect(transmission(6, 4, 0.5)).toBeLessThan(1);
    expect(transmission(4.8, 4, 0.5)).toBeLessThan(0.9);
  });

  it("厳密な式 E5 の sinh² の形と、小さな κd で一致する", () => {
    const E = 1;
    const V = 5;
    for (const d of [0.05, 0.1, 0.3, 0.6]) {
      const k = kappa(V - E);
      const sinh = Math.sinh(k * d);
      const direct = 1 / (1 + (V * V * sinh * sinh) / (4 * E * (V - E)));
      expect(transmission(E, V, d)).toBeCloseTo(direct, 12);
    }
  });

  it("ln T はどんなに厚い壁でも有限(10⁻³⁰⁰ を下回っても 0 や NaN にしない)", () => {
    for (const d of [10, 50, 100, 1000]) {
      const lnT = logTransmission(1, 5, d);
      expect(Number.isFinite(lnT)).toBe(true);
      // 厚い壁では ln T = ln(16E(V−E)/V²) − 2κd
      const expected = Math.log(thickBarrierPrefactor(1, 5)) - 2 * kappa(4) * d;
      expect(lnT).toBeCloseTo(expected, 8);
    }
    expect(logTransmission(1, 5, 100) / Math.LN10).toBeLessThan(-300);
    expect(Number.isNaN(transmission(1, 5, 1000))).toBe(false);
  });
});

describe("T2: 厚い壁で ln T の d に対する傾きが −2κ(最重要)", () => {
  it("V − E = 4 eV で κ = 10.25 nm⁻¹、−2κ = −20.49 nm⁻¹", () => {
    expect(kappa(4)).toBeCloseTo(10.2463, 3);
    expect(-2 * kappa(4)).toBeCloseTo(-20.49, 2);
  });

  /** 中心差分による局所の傾き d(ln T)/dd */
  function localSlope(E: number, V: number, d: number): number {
    const h = 1e-5;
    return (
      (logTransmission(E, V, d + h) - logTransmission(E, V, d - h)) / (2 * h)
    );
  }

  /** κd ∈ [kd0, kd1] の区間で最小二乗した ln T の傾き */
  function fittedSlope(E: number, V: number, kd0: number, kd1: number): number {
    const k = kappa(V - E);
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      const d = (kd0 + ((kd1 - kd0) * i) / (n - 1)) / k;
      const y = logTransmission(E, V, d);
      sx += d;
      sy += y;
      sxx += d * d;
      sxy += d * y;
    }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  }

  it("V − E = 4 eV(図3 の既定): κd > 2 の範囲の傾きが −2κ と 1% 以内", () => {
    const E = 1;
    const V = 5;
    const k = kappa(4);
    // 図3 の横軸の範囲(κd = 2〜15)で直線を当てはめた傾き
    expect(Math.abs(fittedSlope(E, V, 2, 15) / (-2 * k) - 1)).toBeLessThan(
      0.01,
    );
    // 局所の傾きも κd = 2.5 からは 1% 以内(κd = 2 ちょうどでは 1.1%)
    for (let kd = 2.5; kd <= 15; kd += 0.5) {
      expect(Math.abs(localSlope(E, V, kd / k) / (-2 * k) - 1)).toBeLessThan(
        0.01,
      );
    }
  });

  for (const barrier of [0.5, 2, 4, 6]) {
    it(`V − E = ${barrier} eV: κd ≥ 3 で局所の傾きが −2κ と 1% 以内`, () => {
      // 局所の傾きは −2κ·coth(κd)·X/(1 + X)(X は式 E5 の第 2 項)。
      // 壁の低いところでは X が小さいので、κd = 2 ちょうどでは最大 2.8% ずれる
      const E = 1;
      const V = E + barrier;
      const k = kappa(barrier);
      for (let kd = 3; kd <= 15; kd += 0.5) {
        expect(Math.abs(localSlope(E, V, kd / k) / (-2 * k) - 1)).toBeLessThan(
          0.01,
        );
      }
      expect(Math.abs(fittedSlope(E, V, 3, 15) / (-2 * k) - 1)).toBeLessThan(
        0.01,
      );
    });
  }

  it("十分厚い壁では傾きが −2κ にほぼ完全に一致する(相対 1e-6)", () => {
    const E = 1;
    const V = 5;
    const k = kappa(4);
    const slope =
      (logTransmission(E, V, 1.5) - logTransmission(E, V, 1.4)) / 0.1;
    expect(slope).toBeCloseTo(-20.4926, 3);
    expect(Math.abs(slope / (-2 * k) - 1)).toBeLessThan(1e-6);
  });

  it("近似 e^{−2κd} は厳密解と平行で、差は前の係数 16E(V−E)/V² だけ", () => {
    const E = 1;
    const V = 5;
    const diff = logTransmission(E, V, 1.2) - logTransmissionApprox(4, 1.2);
    expect(diff).toBeCloseTo(Math.log(thickBarrierPrefactor(E, V)), 6);
  });

  it("「2 倍の厚さでの比」T(2d)/T(d) が e^{−2κd} の桁で落ちる", () => {
    const E = 1;
    const V = 5;
    const d = 0.4;
    const ratio = Math.exp(
      logTransmission(E, V, 2 * d) - logTransmission(E, V, d),
    );
    // 厚い壁の極限では ratio ≈ e^{−2κd}(2 分の 1 ではなく桁で落ちる)
    expect(ratio).toBeLessThan(1e-3);
    expect(Math.log(ratio) / (-2 * kappa(4) * d)).toBeCloseTo(1, 1);
  });
});

describe("T8: フラッシュメモリの保持時間と書き込みの指数(図7)", () => {
  it("SiO₂(3.1 eV、0.42 m)の κ = 5.85 nm⁻¹", () => {
    expect(kappa(SIO2_BARRIER_EV, SIO2_MASS_RATIO)).toBeCloseTo(5.846, 3);
  });

  const cases = [
    { d: 2, tau: 1.4e-4 },
    { d: 5, tau: 2.4e11 },
    { d: 8, tau: 4e26 },
  ];
  for (const { d, tau } of cases) {
    it(`厚さ ${d} nm で電子 1 個が抜け出す平均時間 ≈ ${tau} 秒(10% 以内)`, () => {
      const t = retentionTime(d);
      expect(Math.abs(t / tau - 1)).toBeLessThan(0.1);
      // τ = 1/(νT)、T ≈ e^{−2κd}
      const lnT = logTransmissionApprox(SIO2_BARRIER_EV, d, SIO2_MASS_RATIO);
      expect(Math.log(t)).toBeCloseTo(-lnT - Math.log(ATTEMPT_FREQUENCY_HZ), 9);
    });
  }

  it("10 nm の端でも透過率・時間が有限(NaN・0・Infinity が出ない)", () => {
    const lnT = logTransmissionApprox(SIO2_BARRIER_EV, 10, SIO2_MASS_RATIO);
    expect(Number.isFinite(lnT)).toBe(true);
    expect(Math.exp(lnT)).toBeGreaterThan(0);
    const t = retentionTime(10);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(1e36);
  });

  it("10 MV/cm の書き込みで WKB 指数が 24.2、時間は 0.3 ms の桁", () => {
    const field = 10 * MV_PER_CM_TO_V_PER_NM;
    expect(
      triangularExponent(SIO2_BARRIER_EV, field, SIO2_MASS_RATIO),
    ).toBeCloseTo(24.2, 1);
    const t = fowlerNordheimTime(8, 10);
    expect(t).toBeGreaterThan(2e-4);
    expect(t).toBeLessThan(4e-4);
  });

  it("傾いた壁の指数: 電場 → 0 で 2κd、壁を傾けきると三角の式に連続につながる", () => {
    const phi = SIO2_BARRIER_EV;
    const m = SIO2_MASS_RATIO;
    const k = kappa(phi, m);
    expect(tiltedBarrierExponent(phi, 1e-9, 5, m)).toBeCloseTo(2 * k * 5, 6);
    const field = 1;
    const x0 = phi / field;
    const justBelow = tiltedBarrierExponent(phi, field, x0 * (1 - 1e-9), m);
    const triangle = triangularExponent(phi, field, m);
    expect(justBelow).toBeCloseTo(triangle, 6);
    expect(tiltedBarrierExponent(phi, field, 8, m)).toBe(triangle);
    // 電場を強くするほど指数が小さくなる(書き込みが速くなる)
    let prev = Infinity;
    for (let f = 0.6; f <= 1.4; f += 0.05) {
      const e = tiltedBarrierExponent(phi, f, 8, m);
      expect(e).toBeLessThan(prev);
      prev = e;
    }
  });
});

describe("T9: 定常解の連続性と右側の |ψ|² = T(図2)", () => {
  /** 2 次精度の片側差分で ψ'(x) を求める(境界をまたがない) */
  function derivative(
    E: number,
    V: number,
    d: number,
    x: number,
    side: -1 | 1,
  ): Complex {
    const h = 1e-5;
    const sol = solveBarrier(E, V, d);
    const f0 = evalWave(sol, x, { re: 0, im: 0 });
    const f1 = evalWave(sol, x + side * h, { re: 0, im: 0 });
    const f2 = evalWave(sol, x + side * 2 * h, { re: 0, im: 0 });
    return {
      re: (side * (-3 * f0.re + 4 * f1.re - f2.re)) / (2 * h),
      im: (side * (-3 * f0.im + 4 * f1.im - f2.im)) / (2 * h),
    };
  }

  const cases = [
    { E: 1, V: 5, d: 0.4 },
    { E: 1, V: 8, d: 1.5 },
    { E: 4.9, V: 5, d: 0.4 },
    { E: 5, V: 5, d: 0.4 },
    { E: 6, V: 5, d: 0.8 },
    { E: 0.2, V: 1, d: 0.1 },
  ];
  for (const { E, V, d } of cases) {
    it(`E = ${E}, V = ${V}, d = ${d}: x = 0, d で ψ と dψ/dx が連続`, () => {
      const sol = solveBarrier(E, V, d);
      for (const xb of [0, d]) {
        const left = evalWave(sol, xb - 1e-12, { re: 0, im: 0 });
        const right = evalWave(sol, xb + 1e-12, { re: 0, im: 0 });
        expect(left.re).toBeCloseTo(right.re, 9);
        expect(left.im).toBeCloseTo(right.im, 9);
        const dl = derivative(E, V, d, xb - 1e-9, -1);
        const dr = derivative(E, V, d, xb + 1e-9, 1);
        const scale = Math.max(1, Math.hypot(dl.re, dl.im));
        expect(Math.abs(dl.re - dr.re) / scale).toBeLessThan(1e-6);
        expect(Math.abs(dl.im - dr.im) / scale).toBeLessThan(1e-6);
      }
    });

    it(`E = ${E}, V = ${V}, d = ${d}: 壁の右側の |ψ|² が T に一致する`, () => {
      const T = transmission(E, V, d);
      for (const x of [d + 0.01, d + 0.7, d + 2]) {
        const psi = stationaryWave(E, V, d, x);
        expect((psi.re ** 2 + psi.im ** 2) / T).toBeCloseTo(1, 9);
      }
      // 確率の流れの保存: |r|² + T = 1
      const sol = solveBarrier(E, V, d);
      expect(sol.rRe ** 2 + sol.rIm ** 2 + T).toBeCloseTo(1, 10);
    });
  }

  it("壁の中でシュレーディンガー方程式 ψ'' = (V − E)/C ψ を満たす", () => {
    const E = 1;
    const V = 5;
    const d = 0.6;
    const sol = solveBarrier(E, V, d);
    const h = 1e-4;
    for (const x of [0.1, 0.3, 0.5]) {
      const f0 = evalWave(sol, x, { re: 0, im: 0 });
      const fp = evalWave(sol, x + h, { re: 0, im: 0 });
      const fm = evalWave(sol, x - h, { re: 0, im: 0 });
      const d2 = (fp.re - 2 * f0.re + fm.re) / (h * h);
      expect(d2 / (((V - E) / C) * f0.re)).toBeCloseTo(1, 4);
    }
  });

  it("厚い壁の中では |ψ| が減る成分 |α|e^{−κx} に沿って減る(包絡線の傾き −κ)", () => {
    const E = 1;
    const V = 5;
    const d = 1.2;
    const sol = solveBarrier(E, V, d);
    const k = kappa(V - E);
    const alpha = decayingAmplitude(sol);
    for (const x of [0, 0.2, 0.4, 0.6]) {
      const psi = evalWave(sol, x, { re: 0, im: 0 });
      expect(
        Math.hypot(psi.re, psi.im) / (alpha * Math.exp(-k * x)),
      ).toBeCloseTo(1, 3);
    }
  });

  it("極端に厚い壁でも ψ が NaN にならない", () => {
    const sol = solveBarrier(0.2, 8, 50);
    for (const x of [-1, 0, 1, 25, 50, 51]) {
      const psi = evalWave(sol, x, { re: 0, im: 0 });
      expect(Number.isFinite(psi.re)).toBe(true);
      expect(Number.isFinite(psi.im)).toBe(true);
    }
  });
});
