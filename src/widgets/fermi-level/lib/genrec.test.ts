/**
 * genrec.test.ts — 図4 の生成・再結合モンテカルロの単体テスト(仕様書 12 §5.8 T7)
 *
 * 図4 の主張(真性キャリアの数は e^{−E_g/2k_BT} に比例する = 指数の「2」)を、
 * シード固定の決定的なシミュレーションで担保する。仕様書の試作値
 * (x = 4, 6, 8 で 29.5・10.8・3.97 個)から大きく外れたら規則の転記ミスを疑う。
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  AVERAGE_STEPS,
  fitInterceptFixedSlope,
  fitLogSlope,
  G0,
  GenRecSim,
  R_EFF,
} from "./genrec";

const RUN_STEPS = 60000;

/** x で RUN_STEPS ステップ回した時間平均(全ステップで電子数 = 正孔数を確認) */
function timeAverage(x: number): { mean: number; balanced: boolean } {
  const sim = new GenRecSim(undefined, x);
  let sum = 0;
  let balanced = true;
  for (let s = 0; s < RUN_STEPS; s++) {
    sim.step();
    if (sim.electrons.count !== sim.holes.count) balanced = false;
    sum += sim.count;
  }
  return { mean: sum / RUN_STEPS, balanced };
}

describe("T7: 生成と再結合のつり合い(指数の「2」)", () => {
  const xs = [4, 6, 8];
  let results: Array<{ mean: number; balanced: boolean }> = [];
  let means: number[] = [];
  beforeAll(() => {
    results = xs.map((x) => timeAverage(x));
    means = results.map((r) => r.mean);
  });

  it("電子数 = 正孔数が全ステップで成り立つ(対で生まれ、対で消える)", () => {
    for (const r of results) expect(r.balanced).toBe(true);
  });

  it("ln(時間平均) の x に対する傾きが −0.5 ± 0.08", () => {
    const slope = fitLogSlope(xs, means, xs.length);
    expect(slope).toBeGreaterThan(-0.58);
    expect(slope).toBeLessThan(-0.42);
  });

  it("時間平均が仕様書の試作値(29.5・10.8・3.97 個)と 15% 以内", () => {
    const expected = [29.5, 10.8, 3.97];
    for (let i = 0; i < xs.length; i++) {
      expect(Math.abs(means[i] / expected[i] - 1)).toBeLessThan(0.15);
    }
  });

  it("理論 √(G₀/r_eff)·e^{−x/2} と比例定数まで 10% 以内(よく混ざった極限)", () => {
    for (let i = 0; i < xs.length; i++) {
      const theory = Math.sqrt(G0 / R_EFF) * Math.exp(-xs[i] / 2);
      expect(Math.abs(means[i] / theory - 1)).toBeLessThan(0.1);
    }
  });
});

describe("GenRecSim の再現性と記録", () => {
  it("同じシードなら同じ軌跡、reset で同じ初期状態に戻る", () => {
    const a = new GenRecSim(7, 5, 500);
    const b = new GenRecSim(7, 5, 500);
    for (let s = 0; s < 2000; s++) {
      a.step();
      b.step();
    }
    expect(a.count).toBe(b.count);
    for (let i = 0; i < a.electrons.count; i++) {
      expect(a.electrons.x[i]).toBe(b.electrons.x[i]);
      expect(a.electrons.v[i]).toBe(b.electrons.v[i]);
    }
    a.reset(5, 500);
    const c = new GenRecSim(7, 5, 500);
    expect(a.count).toBe(c.count);
    expect(a.time).toBeCloseTo(c.time, 12);
    for (let i = 0; i < a.holes.count; i++) {
      expect(a.holes.x[i]).toBe(c.holes.x[i]);
    }
  });

  it("初期化時に 3000 ステップ進めて定常に近い状態から始まる", () => {
    const sim = new GenRecSim();
    expect(sim.steps).toBe(3000);
    expect(sim.time).toBeCloseTo(50, 9);
    // x = 5 の理論値 √(G₀/r_eff)·e^{−2.5} ≈ 18 個のまわり
    expect(sim.average).toBeGreaterThan(10);
    expect(sim.average).toBeLessThan(28);
  });

  it("時間平均は直近 900 ステップの平均", () => {
    const sim = new GenRecSim(3, 5, 0);
    expect(Number.isNaN(sim.average)).toBe(true);
    const counts: number[] = [];
    for (let s = 0; s < 1200; s++) {
      sim.step();
      counts.push(sim.count);
    }
    const tail = counts.slice(-AVERAGE_STEPS);
    const mean = tail.reduce((p, q) => p + q, 0) / AVERAGE_STEPS;
    expect(sim.average).toBeCloseTo(mean, 9);
  });

  it("位置は常に結晶の中(0〜1)", () => {
    const sim = new GenRecSim(11, 4, 0);
    let outside = 0;
    for (let s = 0; s < 3000; s++) {
      sim.step();
      for (let i = 0; i < sim.electrons.count; i++) {
        const x = sim.electrons.x[i];
        if (x < 0 || x > 1) outside++;
      }
    }
    expect(outside).toBe(0);
  });
});

describe("当てはめ", () => {
  it("傾きを固定した直線の切片は ln y − slope·x の平均", () => {
    const xs = [4, 6, 8];
    const ys = [30, 11, 4].map((v) => v);
    const c = fitInterceptFixedSlope(xs, ys, 3, -0.5);
    const expected =
      (Math.log(30) + 2 + (Math.log(11) + 3) + (Math.log(4) + 4)) / 3;
    expect(c).toBeCloseTo(expected, 12);
    expect(Number.isNaN(fitInterceptFixedSlope(xs, [0, 0, 0], 3, -0.5))).toBe(
      true,
    );
  });

  it("厳密な指数関数なら最小二乗の傾きはその指数", () => {
    const xs = [4, 5.5, 7, 9];
    const ys = xs.map((x) => 12 * Math.exp(-0.5 * x));
    expect(fitLogSlope(xs, ys, 4)).toBeCloseTo(-0.5, 12);
    expect(Number.isNaN(fitLogSlope([4], [1], 1))).toBe(true);
    expect(Number.isNaN(fitLogSlope([4, 4], [1, 2], 2))).toBe(true);
  });
});
