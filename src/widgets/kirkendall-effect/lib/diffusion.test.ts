/**
 * diffusion.test.ts — 拡散モデルの単体テスト(記事仕様 §5.0・付記 1)
 *
 * 本記事最大のリスクは「符号」と「桁」なので、次を必ず検証する:
 * - 誤差関数の精度
 * - D̃ の端点(X_A = 0 で D_A、X_A = 1 で D_B)
 * - J_V = −(J_A + J_B)
 * - v の符号(D_A > D_B かつ ∂X_A/∂x > 0 → v > 0 = 真鍮側)
 * - 拡散対ソルバの質量保存、マーカー移動量が √t に乗ること、解析予測との一致
 */

import { describe, expect, it } from "vitest";
import {
  CELSIUS_OFFSET,
  T_ANNEAL_C,
  T_ANNEAL_S,
  X_BRASS,
  dCu,
  dInterstitial,
  dZn,
  formatDuration,
  formatSci,
  vacancyHopRate,
} from "./constants";
import {
  DiffusionCouple,
  HollowParticleModel,
  VoidGrowthModel,
  coupleGradientAnalytic,
  dPairAtFixedDTilde,
  coupleProfileAnalytic,
  dPairFromRatio,
  erf,
  erfc,
  fluxes,
  interdiffusionD,
  markerShiftAnalytic,
  markerVelocity,
  meanSquareDisplacement1D,
  radiusOfVolume,
  sphereVolume,
  stepProfile,
  walkDiffusivity,
} from "./diffusion";

const T_ANNEAL_K = T_ANNEAL_C + CELSIUS_OFFSET;

describe("erf / erfc", () => {
  it("既知の値に一致する(絶対誤差 < 2×10⁻⁷)", () => {
    expect(erf(0)).toBeCloseTo(0, 8);
    expect(erf(0.5)).toBeCloseTo(0.5204999, 6);
    expect(erf(1)).toBeCloseTo(0.8427008, 6);
    expect(erf(2)).toBeCloseTo(0.9953223, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6);
  });

  it("erfc = 1 − erf、単調減少", () => {
    expect(erfc(1)).toBeCloseTo(1 - erf(1), 12);
    expect(erfc(-2)).toBeGreaterThan(erfc(2));
  });
});

describe("ランダムウォークの統計(§5.1)", () => {
  it("D = ℓ²Γ/4、⟨x²⟩ = 2Dt = ℓ²n/2", () => {
    const stepLen = 0.02;
    const rate = 50;
    const d = walkDiffusivity(stepLen, rate);
    expect(d).toBeCloseTo((0.02 * 0.02 * 50) / 4, 12);
    const t = 3;
    expect(meanSquareDisplacement1D(stepLen, rate * t)).toBeCloseTo(
      2 * d * t,
      12,
    );
  });

  it("段差初期条件は界面で 0.5、遠方で 1 と 0", () => {
    expect(stepProfile(0, 1e-4)).toBeCloseTo(0.5, 6);
    expect(stepProfile(-1, 1e-4)).toBeGreaterThan(0.99);
    expect(stepProfile(1, 1e-4)).toBeLessThan(0.01);
  });

  it("t = 0 では段差そのもの", () => {
    expect(stepProfile(-0.1, 0)).toBe(1);
    expect(stepProfile(0.1, 0)).toBe(0);
  });
});

describe("アレニウス型の拡散係数(§5.2)", () => {
  it("785 °C で Zn は Cu より速い(比は 3〜6 倍)", () => {
    const ratio = dZn(T_ANNEAL_K) / dCu(T_ANNEAL_K);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(6);
  });

  it("785 °C の D̃ は 10⁻¹⁵〜10⁻¹⁴ m²/s のオーダー", () => {
    const d = interdiffusionD(X_BRASS / 2, dZn(T_ANNEAL_K), dCu(T_ANNEAL_K));
    expect(d).toBeGreaterThan(1e-15);
    expect(d).toBeLessThan(1e-13);
  });

  it("温度を 100 °C 下げると 1 桁近く遅くなる", () => {
    expect(dZn(T_ANNEAL_K) / dZn(T_ANNEAL_K - 100)).toBeGreaterThan(8);
  });

  it("侵入型(C)は置換型より桁違いに速い", () => {
    expect(dInterstitial(T_ANNEAL_K) / dZn(T_ANNEAL_K)).toBeGreaterThan(1e3);
  });

  it("空孔の跳躍頻度は高温で 10⁹ 1/s 級", () => {
    expect(vacancyHopRate(T_ANNEAL_K)).toBeGreaterThan(1e9);
    expect(vacancyHopRate(1300) / vacancyHopRate(600)).toBeGreaterThan(1e3);
  });
});

describe("ダルケンの関係(§5.4・§5.5)", () => {
  const dA = 4e-15; // Zn
  const dB = 1e-15; // Cu

  it("D̃ の端点: X_A = 0 で D_A、X_A = 1 で D_B", () => {
    expect(interdiffusionD(0, dA, dB)).toBeCloseTo(dA, 20);
    expect(interdiffusionD(1, dA, dB)).toBeCloseTo(dB, 20);
    expect(interdiffusionD(0.5, dA, dB)).toBeCloseTo((dA + dB) / 2, 20);
  });

  it("v の符号: D_A > D_B かつ ∂X_A/∂x > 0 で v > 0(真鍮側へ)", () => {
    expect(markerVelocity(dA, dB, 100)).toBeGreaterThan(0);
    expect(markerVelocity(dB, dA, 100)).toBeLessThan(0);
    expect(markerVelocity(dA, dA, 100)).toBe(0);
  });

  it("J_V = −(J_A + J_B) が常に成り立つ", () => {
    for (const g of [-50, -1, 0, 1, 200]) {
      const f = fluxes(dA, dB, g);
      expect(f.jV).toBeCloseTo(-(f.jA + f.jB), 20);
      expect(f.jNet).toBeCloseTo(f.jA + f.jB, 20);
    }
  });

  it("J_A と J_B は逆向き、D_A = D_B なら差し引きゼロ", () => {
    const f = fluxes(dA, dB, 100);
    expect(f.jA).toBeLessThan(0); // Zn は勾配を下って左(純 Cu 側)へ
    expect(f.jB).toBeGreaterThan(0); // Cu は右(真鍮側)へ
    expect(f.jNet).toBeLessThan(0); // 差し引きは左向き
    expect(f.jV).toBeGreaterThan(0); // 空孔は逆向き = 右(真鍮側)へ
    const even = fluxes(dA, dA, 100);
    expect(even.jNet).toBeCloseTo(0, 20);
    expect(even.jV).toBeCloseTo(0, 20);
  });

  it("dPairAtFixedDTilde は比を保ちつつ D̃ を一定にする", () => {
    const target = 9e-15;
    for (const r of [0.5, 1, 4, 8]) {
      const { dA: a, dB: b } = dPairAtFixedDTilde(r, target, 0.15);
      expect(a / b).toBeCloseTo(r, 10);
      expect(interdiffusionD(0.15, a, b)).toBeCloseTo(target, 20);
    }
  });

  it("D̃ 固定なら マーカー移動量は D_A − D_B に正比例する", () => {
    const target = 9e-15;
    const shifts = [2, 4, 8].map((r) => {
      const { dA: a, dB: b } = dPairAtFixedDTilde(r, target, X_BRASS / 2);
      return { diff: a - b, shift: markerShiftAnalytic(a, b, T_ANNEAL_S) };
    });
    // Δ / (D_A − D_B) が一定 = 原点を通る直線(図5 の「法則発見」の前提)
    const slopes = shifts.map((s) => s.shift / s.diff);
    expect(Math.abs(slopes[1] / slopes[0] - 1)).toBeLessThan(1e-12);
    expect(Math.abs(slopes[2] / slopes[0] - 1)).toBeLessThan(1e-12);
  });

  it("dPairFromRatio は比と和を保つ", () => {
    const { dA: a, dB: b } = dPairFromRatio(4, 5e-15);
    expect(a / b).toBeCloseTo(4, 10);
    expect(a + b).toBeCloseTo(5e-15, 20);
    const even = dPairFromRatio(1, 5e-15);
    expect(even.dA).toBeCloseTo(even.dB, 20);
  });
});

describe("拡散対の解析解(§5.4)", () => {
  const dTilde = 5e-15;
  const t = T_ANNEAL_S;

  it("界面で X_brass/2、左端で 0、右端で X_brass", () => {
    expect(coupleProfileAnalytic(0, t, dTilde)).toBeCloseTo(X_BRASS / 2, 6);
    expect(coupleProfileAnalytic(-2e-3, t, dTilde)).toBeCloseTo(0, 5);
    expect(coupleProfileAnalytic(2e-3, t, dTilde)).toBeCloseTo(X_BRASS, 5);
  });

  it("勾配は界面で最大・正、遠方でほぼ 0", () => {
    const g0 = coupleGradientAnalytic(0, t, dTilde);
    expect(g0).toBeGreaterThan(0);
    expect(coupleGradientAnalytic(300e-6, t, dTilde)).toBeLessThan(g0);
    expect(coupleGradientAnalytic(2e-3, t, dTilde)).toBeLessThan(g0 * 1e-3);
  });

  it("勾配はプロファイルの数値微分と一致する", () => {
    const h = 1e-7;
    const num =
      (coupleProfileAnalytic(50e-6 + h, t, dTilde) -
        coupleProfileAnalytic(50e-6 - h, t, dTilde)) /
      (2 * h);
    // erf の近似誤差(絶対 1.5×10⁻⁷)ぶんだけずれるので相対誤差で比べる
    expect(
      Math.abs(coupleGradientAnalytic(50e-6, t, dTilde) / num - 1),
    ).toBeLessThan(1e-4);
  });

  it("マーカー移動量は √t に比例し、D_A = D_B で 0", () => {
    const dA = 4e-15;
    const dB = 1e-15;
    const d1 = markerShiftAnalytic(dA, dB, t);
    const d4 = markerShiftAnalytic(dA, dB, 4 * t);
    expect(d1).toBeGreaterThan(0);
    expect(d4 / d1).toBeCloseTo(2, 6);
    expect(markerShiftAnalytic(dA, dA, t)).toBe(0);
    expect(markerShiftAnalytic(dB, dA, t)).toBeLessThan(0);
  });

  it("史実の桁: 785 °C・56 日で数十 μm", () => {
    const shift = markerShiftAnalytic(
      dZn(T_ANNEAL_K),
      dCu(T_ANNEAL_K),
      T_ANNEAL_S,
    );
    expect(shift * 1e6).toBeGreaterThan(5);
    expect(shift * 1e6).toBeLessThan(200);
  });
});

describe("DiffusionCouple — 数値解(§5.3)", () => {
  const dA = 4e-15;
  const dB = 1e-15;

  it("初期状態は段差、質量 Σ X Δx は保存する", () => {
    const c = new DiffusionCouple(dA, dB);
    const m0 = c.totalSolute();
    expect(c.compositionAt(-300e-6)).toBe(0);
    expect(c.compositionAt(300e-6)).toBeCloseTo(X_BRASS, 12);
    c.step(T_ANNEAL_S);
    expect(Math.abs(c.totalSolute() / m0 - 1)).toBeLessThan(1e-9);
  });

  it("組成は 0〜X_brass に収まり、単調増加のまま", () => {
    const c = new DiffusionCouple(dA, dB);
    c.step(T_ANNEAL_S);
    for (let i = 0; i < c.n; i++) {
      expect(c.xZn[i]).toBeGreaterThanOrEqual(-1e-12);
      expect(c.xZn[i]).toBeLessThanOrEqual(X_BRASS + 1e-12);
    }
    for (let i = 1; i < c.n; i++) {
      expect(c.xZn[i]).toBeGreaterThanOrEqual(c.xZn[i - 1] - 1e-12);
    }
  });

  it("マーカーは真鍮側(右)へ動き、移動量は解析予測とおおむね一致する", () => {
    const c = new DiffusionCouple(dA, dB);
    c.step(T_ANNEAL_S);
    const analytic = markerShiftAnalytic(dA, dB, T_ANNEAL_S);
    expect(c.markerX).toBeGreaterThan(0);
    expect(Math.abs(c.markerX / analytic - 1)).toBeLessThan(0.2);
  });

  it("マーカー移動量は √t に乗る(4 倍の時間で約 2 倍)", () => {
    const c1 = new DiffusionCouple(dA, dB);
    c1.step(T_ANNEAL_S);
    const c4 = new DiffusionCouple(dA, dB);
    c4.step(4 * T_ANNEAL_S);
    expect(c4.markerX / c1.markerX).toBeGreaterThan(1.8);
    expect(c4.markerX / c1.markerX).toBeLessThan(2.2);
  });

  it("D_A = D_B ではマーカーが動かない(§5.5 の要点)", () => {
    const c = new DiffusionCouple(2.5e-15, 2.5e-15);
    c.step(T_ANNEAL_S);
    expect(Math.abs(c.markerX)).toBeLessThan(1e-12);
  });

  it("D_A < D_B ではマーカーが銅側(左)へ動く", () => {
    const c = new DiffusionCouple(dB, dA);
    c.step(T_ANNEAL_S);
    expect(c.markerX).toBeLessThan(0);
  });

  it("数値解のプロファイルは解析解に近い(界面近傍)", () => {
    const c = new DiffusionCouple(2.5e-15, 2.5e-15); // 定数 D̃ なら解析解と厳密対応
    c.step(T_ANNEAL_S);
    for (const x of [-100e-6, -20e-6, 0, 20e-6, 100e-6]) {
      const num = c.compositionAt(x);
      const ana = coupleProfileAnalytic(x, T_ANNEAL_S, 2.5e-15);
      expect(Math.abs(num - ana)).toBeLessThan(0.005);
    }
  });

  it("reset で初期状態へ完全に戻る", () => {
    const c = new DiffusionCouple(dA, dB);
    c.step(T_ANNEAL_S);
    c.reset();
    expect(c.time).toBe(0);
    expect(c.markerX).toBe(0);
    expect(c.compositionAt(100e-6)).toBeCloseTo(X_BRASS, 12);
  });
});

describe("VoidGrowthModel(§5.6)", () => {
  it("供給が強く吸収源が弱いと過飽和が上がりボイドが出る", () => {
    const m = new VoidGrowthModel(1.2, 0.3, 3);
    for (let i = 0; i < 4000; i++) m.step(0.01);
    expect(m.s).toBeGreaterThan(1);
    expect(m.count).toBeGreaterThan(0);
    expect(m.totalArea()).toBeGreaterThan(0);
  });

  it("吸収源が強いと過飽和がしきい値に届かずボイドが出ない", () => {
    const m = new VoidGrowthModel(0.4, 1.0, 3);
    for (let i = 0; i < 4000; i++) m.step(0.01);
    expect(m.s).toBeLessThan(3);
    expect(m.count).toBe(0);
  });

  it("供給ゼロでは S = 1 のまま(過飽和にならない)", () => {
    const m = new VoidGrowthModel(0, 0.3, 3);
    for (let i = 0; i < 500; i++) m.step(0.01);
    expect(m.s).toBeCloseTo(1, 6);
    expect(m.count).toBe(0);
  });

  it("ボイドが育つと過飽和が下がる(過飽和を消費している)", () => {
    const m = new VoidGrowthModel(1.5, 0.2, 2.5);
    let peak = 1;
    let afterPeak = 1;
    for (let i = 0; i < 6000; i++) {
      m.step(0.01);
      if (m.s > peak) peak = m.s;
      afterPeak = m.s;
    }
    expect(m.count).toBeGreaterThan(1);
    expect(afterPeak).toBeLessThan(peak);
  });

  it("reset で初期状態へ戻る", () => {
    const m = new VoidGrowthModel(1.2, 0.3, 3);
    for (let i = 0; i < 2000; i++) m.step(0.01);
    m.reset();
    expect(m.s).toBe(1);
    expect(m.count).toBe(0);
    expect(m.totalArea()).toBe(0);
  });
});

describe("HollowParticleModel(§5.7)", () => {
  it("球の体積と半径は往復変換できる", () => {
    expect(radiusOfVolume(sphereVolume(15))).toBeCloseTo(15, 10);
    expect(radiusOfVolume(0)).toBe(0);
  });

  it("金属の方が速い(比 4)と中心に空洞ができ、殻が厚くなる", () => {
    const m = new HollowParticleModel(15, 4);
    for (let i = 0; i < 100000 && !m.done(); i++) m.step(0.01);
    expect(m.done()).toBe(true);
    expect(m.voidRadius()).toBeGreaterThan(1);
    expect(m.shellThickness()).toBeGreaterThan(1);
    expect(m.conversion()).toBeCloseTo(1, 6);
  });

  it("反応種の方が速い(比 < 1)と空洞ができない", () => {
    const m = new HollowParticleModel(15, 0.25);
    for (let i = 0; i < 100000 && !m.done(); i++) {
      m.step(0.01);
      expect(m.voidRadius()).toBe(0); // 途中でも一度も空洞ができない
    }
    expect(m.done()).toBe(true);
    expect(m.conversion()).toBeCloseTo(1, 6);
  });

  it("比を上げるほど空洞が大きくなる", () => {
    const sizes = [2, 4, 8].map((ratio) => {
      const m = new HollowParticleModel(15, ratio);
      for (let i = 0; i < 100000 && !m.done(); i++) m.step(0.01);
      return m.voidRadius();
    });
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
    expect(sizes[2]).toBeGreaterThan(sizes[1]);
  });

  it("反応中は 空洞 ≤ コア外径 ≤ 外径 の順序が保たれる", () => {
    const m = new HollowParticleModel(15, 4);
    for (let i = 0; i < 500; i++) {
      m.step(0.01);
      expect(m.voidRadius()).toBeLessThanOrEqual(m.coreRadius() + 1e-9);
      expect(m.coreRadius()).toBeLessThanOrEqual(m.outerRadius() + 1e-9);
    }
  });

  it("reset で未反応の状態へ戻る", () => {
    const m = new HollowParticleModel(15, 4);
    for (let i = 0; i < 1000; i++) m.step(0.01);
    m.reset();
    expect(m.conversion()).toBe(0);
    expect(m.voidRadius()).toBe(0);
    expect(m.outerRadius()).toBeCloseTo(15, 10);
  });
});

describe("表示の整形", () => {
  it("formatDuration は秒/分/時間/日/年で自動整形する", () => {
    expect(formatDuration(4.1)).toBe("4.1 秒");
    expect(formatDuration(90)).toBe("1.5 分");
    expect(formatDuration(7200)).toBe("2 時間");
    expect(formatDuration(86400 * 3)).toBe("3 日");
    expect(formatDuration(T_ANNEAL_S)).toBe("56 日");
    expect(formatDuration(86400 * 365 * 2.3)).toBe("2.3 年");
  });

  it("formatSci は指数表記に整形する", () => {
    expect(formatSci(1.2e-14)).toBe("1.2×10⁻¹⁴");
    expect(formatSci(3e5, 0)).toBe("3×10⁵");
  });
});
