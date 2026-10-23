/**
 * cahnhilliard.test.ts — 半陰的スペクトル法のカーン・ヒリアードの単体テスト
 * (記事仕様書 09 §5.8 T3〜T7)
 *
 * T3: 平均組成が 1000 ステップで相対 1e−12 以内に保存される(最重要)
 * T4: 自由エネルギーが全ステップで単調に減る(A = 8・Δt = 0.5)
 * T5: 単一の波の数値の増幅率が離散スキームの増幅率と 1e−6 以内、
 *     Δt = 0.005 では連続の R(k) と 2% 以内
 * T6: 準安定(χ = 3)— c0 = 0.15 でゆらぎが 1e−6 未満に減衰。置いた核は
 *     臨界半径より小さいと溶け、大きいと育つ
 * T7: 初期の S(k) のピークが k_m = 0.5 と 15% 以内
 *
 * 計算の重いテストは 1 本 5 秒以内に収まるよう格子を選んでいる。
 */

import { describe, expect, it } from "vitest";
import {
  A_BASE,
  CahnHilliard,
  DT,
  earlyDt,
  linearStageDuration,
  stabilizationFor,
} from "./cahnhilliard";
import { binodal, chiFromT, d2gdc2, growthRate } from "./regular";

const CHI = 3;
const SEED = 20261023;

/** c > 1/2(B リッチ)の格子点の数 */
function bRichCount(sim: CahnHilliard): number {
  let n = 0;
  for (let i = 0; i < sim.size; i++) if (sim.c[i] > 0.5) n++;
  return n;
}

/** 線形段階を細かく刻む時間刻みの規則(図版と同じ) */
function scheduledDt(sim: CahnHilliard, tLinear: number): number {
  return sim.time < tLinear - 1e-9 ? earlyDt(sim.A) : DT;
}

describe("T3 — 平均組成の保存", () => {
  it("1000 ステップで平均組成が相対 1e−12 以内に保たれる(64²・c0 = 0.4)", () => {
    const sim = new CahnHilliard({ nx: 64, ny: 64, chi: CHI });
    sim.initUniform(0.4, 0.01, SEED);
    const m0 = sim.mean();
    const spectral0 = sim.meanFromSpectrum();
    expect(m0).toBeCloseTo(0.4, 14);
    let worst = 0;
    for (let s = 0; s < 1000; s++) {
      sim.step(1);
      worst = Math.max(worst, Math.abs(sim.mean() - m0) / m0);
    }
    expect(worst).toBeLessThan(1e-12);
    // スペクトルの k = 0 成分はステップで 1 ビットも変わらない
    expect(sim.meanFromSpectrum()).toBe(spectral0);
  });

  it("核を置いても(保存のモード)平均組成は変わらない", () => {
    const sim = new CahnHilliard({ nx: 64, ny: 64, chi: CHI });
    sim.initUniform(0.12, 0.01, SEED);
    const m0 = sim.mean();
    const placed = sim.addDisk(10.5, 60, 6, 1 - binodal(CHI), true);
    expect(placed).toBeGreaterThan(100);
    expect(Math.abs(sim.mean() - m0)).toBeLessThan(1e-14);
    sim.step(200);
    expect(Math.abs(sim.mean() - m0) / m0).toBeLessThan(1e-12);
  });

  it("同じシードからは完全に同じ場になる(reset の再現性)", () => {
    const a = new CahnHilliard({ nx: 32, ny: 32, chi: CHI });
    const b = new CahnHilliard({ nx: 32, ny: 32, chi: CHI });
    a.initUniform(0.5, 0.01, SEED);
    b.initUniform(0.5, 0.01, SEED);
    a.step(100);
    b.step(100);
    expect(Array.from(a.c)).toEqual(Array.from(b.c));
    a.initUniform(0.5, 0.01, SEED);
    a.step(100);
    expect(Array.from(a.c)).toEqual(Array.from(b.c));
  });
});

describe("T4 — 自由エネルギーの単調減少", () => {
  it("A = 8・Δt = 0.5 で全ステップ単調に減る(T/Tc = 2/3、64²、2000 ステップ)", () => {
    const sim = new CahnHilliard({ nx: 64, ny: 64, chi: CHI, A: 8, dt: 0.5 });
    expect(stabilizationFor(CHI)).toBe(A_BASE);
    sim.initUniform(0.5, 0.01, SEED);
    let prev = sim.freeEnergy();
    for (let s = 0; s < 2000; s++) {
      sim.step(1);
      const f = sim.freeEnergy();
      expect(f).toBeLessThanOrEqual(prev + 1e-13);
      prev = f;
    }
  });

  it("既定の温度範囲(T/Tc = 0.63〜0.9)でも A = 8・Δt = 0.5 で単調に減る", () => {
    for (const t of [0.63, 0.75, 0.9]) {
      const chi = chiFromT(t);
      const sim = new CahnHilliard({ nx: 32, ny: 32, chi, A: 8, dt: 0.5 });
      sim.initUniform(0.45, 0.02, SEED);
      let prev = sim.freeEnergy();
      for (let s = 0; s < 800; s++) {
        sim.step(1);
        const f = sim.freeEnergy();
        expect(f).toBeLessThanOrEqual(prev + 1e-13);
        prev = f;
      }
    }
  });

  it("低温(T/Tc = 0.5)は温度に応じた A(χ) で安定し、単調に減る", () => {
    const chi = chiFromT(0.5);
    const A = stabilizationFor(chi);
    expect(A).toBeGreaterThan(20);
    const sim = new CahnHilliard({ nx: 32, ny: 32, chi });
    expect(sim.A).toBe(A);
    sim.initUniform(0.5, 0.01, SEED);
    const tLin = linearStageDuration(0.5, chi);
    let prev = sim.freeEnergy();
    for (let s = 0; s < 1500; s++) {
      sim.setDt(scheduledDt(sim, tLin));
      sim.step(1);
      const f = sim.freeEnergy();
      expect(f).toBeLessThanOrEqual(prev + 1e-13);
      prev = f;
    }
    const cb = binodal(chi);
    for (let i = 0; i < sim.size; i++) {
      expect(sim.c[i]).toBeGreaterThan(0.85 * cb);
      expect(sim.c[i]).toBeLessThan(1 - 0.85 * cb);
    }
  });
});

describe("T5 — 線形成長率", () => {
  const n = 128;
  const m = 10; // k = 2π·10/128 ≈ 0.491(k_m = 0.5 のすぐ下)
  const k = (2 * Math.PI * m) / n;
  const c0 = 0.5;
  const amp = 1e-6;

  function singleWave(dt: number): CahnHilliard {
    const sim = new CahnHilliard({ nx: n, ny: 1, chi: CHI, A: 8, dt });
    for (let x = 0; x < n; x++) sim.c[x] = c0 + amp * Math.cos(k * x);
    sim.syncSpectrum();
    return sim;
  }

  it("Δt = 0.5: 1 ステップの増幅率が離散スキームの式と 1e−6 以内", () => {
    const dt = 0.5;
    const sim = singleWave(dt);
    const g2 = d2gdc2(c0, CHI);
    const A = 8;
    const kappa = sim.kappa;
    const expected =
      (1 - dt * k * k * (g2 - A)) / (1 + dt * A * k * k + dt * kappa * k ** 4);
    const a0 = sim.modeAmplitude(m, 0);
    expect(a0).toBeCloseTo(amp, 15);
    const steps = 20;
    sim.step(steps);
    const perStep = (sim.modeAmplitude(m, 0) / a0) ** (1 / steps);
    expect(Math.abs(perStep - expected) / expected).toBeLessThan(1e-6);
    // 安定化のため、Δt = 0.5 の増幅率は連続の R(k) より小さい
    expect(Math.log(perStep) / dt).toBeLessThan(growthRate(k, c0, CHI, kappa));
  });

  it("Δt = 0.005 では連続の R(k) = −k²(g'' + κk²) と 2% 以内", () => {
    const dt = 0.005;
    const sim = singleWave(dt);
    const a0 = sim.modeAmplitude(m, 0);
    sim.step(400); // t = 2
    const rate = Math.log(sim.modeAmplitude(m, 0) / a0) / sim.time;
    const R = growthRate(k, c0, CHI, sim.kappa);
    expect(R).toBeCloseTo(0.2497, 3);
    expect(Math.abs(rate - R) / R).toBeLessThan(0.02);
  });
});

describe("T6 — 準安定の領域", () => {
  it("c0 = 0.15 では微小なゆらぎが 1e−6 未満に減衰する(64²)", () => {
    const sim = new CahnHilliard({ nx: 64, ny: 64, chi: CHI });
    sim.initUniform(0.15, 0.01, SEED);
    expect(Math.sqrt(sim.variance())).toBeGreaterThan(5e-3);
    sim.step(1000);
    expect(Math.sqrt(sim.variance())).toBeLessThan(1e-6);
    expect(bRichCount(sim)).toBe(0);
  });

  it("c0 = 0.10(128²)では半径 3 の核は溶けて消え、半径 5 の核は育つ", () => {
    const cBeta = 1 - binodal(CHI);
    const small = new CahnHilliard({ nx: 128, ny: 128, chi: CHI });
    small.initUniform(0.1, 0.01, SEED);
    small.addDisk(64, 64, 3, cBeta, true);
    small.step(500); // t = 250
    expect(bRichCount(small)).toBe(0);

    const large = new CahnHilliard({ nx: 128, ny: 128, chi: CHI });
    large.initUniform(0.1, 0.01, SEED);
    const area0 = large.addDisk(64, 64, 5, cBeta, true);
    large.step(1000); // t = 500
    expect(bRichCount(large)).toBeGreaterThan(2 * area0);
  });
});

describe("T7 — 初期の散乱強度のピーク", () => {
  it("c0 = 0.5・χ = 3・κ = 4 で、初期の S(k) のピークが k_m = 0.5 と 15% 以内(128²)", () => {
    const n = 128;
    const sim = new CahnHilliard({ nx: n, ny: n, chi: CHI });
    sim.initUniform(0.5, 0.01, SEED);
    const tLin = linearStageDuration(0.5, CHI);
    expect(tLin).toBeCloseTo(32, 9);
    while (sim.time < 30 - 1e-9) {
      sim.setDt(scheduledDt(sim, tLin));
      sim.step(1);
    }
    const s = new Float64Array(n / 2);
    const counts = new Float64Array(n / 2);
    sim.radialStructureFactor(s, counts);
    let best = 1;
    for (let b = 1; b < s.length; b++) if (s[b] > s[best]) best = b;
    const kPeak = (2 * Math.PI * best) / n;
    expect(Math.abs(kPeak - 0.5) / 0.5).toBeLessThan(0.15);
    // 代表長さからの波数(一次のモーメント)も同じ範囲
    const kL = (2 * Math.PI) / sim.characteristicLength();
    expect(Math.abs(kL - 0.5) / 0.5).toBeLessThan(0.15);
  });
});
