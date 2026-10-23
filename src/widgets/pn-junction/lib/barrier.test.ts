/**
 * barrier.test.ts — 図4 の「坂を越える」モンテカルロの単体テスト(仕様書 13 §5.7 T7)
 *
 * 図4 の主張(坂を越える割合は exp(−B/k_BT) — 坂が 1 k_BT 低くなるたびに
 * e 倍)を、シード固定の決定的なシミュレーションで担保する。
 */

import { describe, expect, it } from "vitest";
import { SILICON, thermalEnergy } from "../../_shared/semiconductor";
import {
  BARRIER_DT,
  BarrierSim,
  CARRIERS_EACH,
  hitRatePerSide,
  theoryCrossingRate,
} from "./barrier";
import { ROOM_T } from "./constants";
import { builtInPotential } from "./junction";

const kT = thermalEnergy(ROOM_T);
const HITS_PER_CASE = 20000;
const MAX_STEPS = 200000;

describe("T7: 坂に当たったキャリアのうち越えた割合 = exp(−B/k_BT)", () => {
  for (const b of [2, 3, 4]) {
    it(`B = ${b} k_BT で 10% 以内(${HITS_PER_CASE} 回)`, () => {
      const sim = new BarrierSim(b * kT);
      let conserved = true;
      for (let s = 0; s < MAX_STEPS && sim.hits < HITS_PER_CASE; s++) {
        sim.step();
        if (
          sim.electrons.total !== CARRIERS_EACH ||
          sim.holes.total !== CARRIERS_EACH
        ) {
          conserved = false;
        }
      }
      expect(sim.hits).toBeGreaterThanOrEqual(HITS_PER_CASE);
      const fraction = sim.crossings / sim.hits;
      expect(Math.abs(fraction / Math.exp(-b) - 1)).toBeLessThan(0.1);
      // 補給により粒子の総数が保たれる
      expect(conserved).toBe(true);
    });
  }
});

describe("BarrierSim の当たる頻度・越える頻度", () => {
  it("当たる頻度が流束の理論値 2·N·σ/√(2π) と 10% 以内", () => {
    const sim = new BarrierSim(1); // 越えない高さ
    const seconds = 60;
    for (let s = 0; s < seconds / BARRIER_DT; s++) sim.step();
    const rate = sim.hits / seconds;
    expect(Math.abs(rate / (2 * hitRatePerSide()) - 1)).toBeLessThan(0.1);
  });

  it("V = 0(坂 = V_bi)では 1 分間回しても 1 個も越えない", () => {
    const vbi = builtInPotential(SILICON, 1e16, 1e16, ROOM_T);
    const sim = new BarrierSim(vbi);
    for (let s = 0; s < 60 / BARRIER_DT; s++) sim.step();
    expect(sim.crossings).toBe(0);
    expect(theoryCrossingRate(vbi)).toBeLessThan(1e-9);
  });

  it("0.05 V ごとに越える数が約 6.9 倍(理論の比)", () => {
    const vbi = builtInPotential(SILICON, 1e16, 1e16, ROOM_T);
    const r55 = theoryCrossingRate(vbi - 0.55);
    const r60 = theoryCrossingRate(vbi - 0.6);
    const r65 = theoryCrossingRate(vbi - 0.65);
    expect((r60 / r55).toFixed(1)).toBe("6.9");
    expect((r65 / r60).toFixed(1)).toBe("6.9");
  });

  it("測った越えた数 / 秒が理論曲線と 20% 以内(坂 0.06 eV、長時間)", () => {
    const b = 0.06;
    const sim = new BarrierSim(b);
    const seconds = 120;
    for (let s = 0; s < seconds / BARRIER_DT; s++) sim.step();
    const rate = sim.crossings / seconds;
    expect(Math.abs(rate / theoryCrossingRate(b) - 1)).toBeLessThan(0.2);
    // 直近 5 秒の移動平均も有限
    expect(Number.isFinite(sim.measuredRate)).toBe(true);
    expect(sim.rateSeconds).toBeCloseTo(5, 6);
  });

  it("同じシードなら同じ軌跡、reset で同じ初期状態に戻る", () => {
    const a = new BarrierSim(2 * kT, 11);
    const b = new BarrierSim(2 * kT, 11);
    for (let s = 0; s < 1500; s++) {
      a.step();
      b.step();
    }
    expect(a.crossings).toBe(b.crossings);
    for (let i = 0; i < a.electrons.majority.count; i++) {
      expect(a.electrons.majority.x[i]).toBe(b.electrons.majority.x[i]);
    }
    a.reset();
    const c = new BarrierSim(2 * kT, 11);
    for (let s = 0; s < 600; s++) {
      a.step();
      c.step();
    }
    expect(a.crossings).toBe(c.crossings);
    expect(a.holes.majority.x[5]).toBe(c.holes.majority.x[5]);
  });
});
