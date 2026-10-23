/**
 * latticegas.test.ts — 格子気体(カワサキ動力学)の単体テスト
 * (記事仕様書 09 §5.8 T8)
 *
 * - 組成(B の総数)が全試行で保存される
 * - T/Tc = 0.6 で 300 掃引後に波の振幅が初期の 1.4 倍以上(上り坂拡散)、
 *   T/Tc = 1.5 で半分以下(シード固定で決定的)
 * - メトロポリスの受け入れ確率が min(1, e^{−ΔE/k_BT})
 * - 試行の向きに偏りがない(受け入れた入れ替えは 4 方向にほぼ均等)
 */

import { describe, expect, it } from "vitest";
import { ATOM_A, ATOM_B, LatticeGas, TC_ISING } from "./latticegas";

/** 図4 と同じ構成(64 × 32、平均 0.5、波長 16・振幅 0.15、同じシード) */
const COLS = 64;
const ROWS = 32;
const WAVELENGTH = 16;
const SEED = 20261023;

function make(tOverTc: number): LatticeGas {
  const lg = new LatticeGas(COLS, ROWS);
  lg.setTemperature(tOverTc);
  lg.initWave(0.5, 0.15, WAVELENGTH, SEED);
  return lg;
}

function amplitude(lg: LatticeGas): number {
  const profile = new Float64Array(lg.cols);
  lg.columnProfile(profile);
  return lg.waveComponent(profile, WAVELENGTH, { a: 0, b: 0 });
}

describe("T8 — 格子気体の上り坂拡散", () => {
  it("2 次元イジング模型の臨界温度 k_BT_c/J = 2.269", () => {
    expect(TC_ISING).toBeCloseTo(2.269185, 6);
  });

  it("初期の波: 列ごとの B の割合が 0.5 + 0.15 sin(2πx/16) に丸めた値", () => {
    const lg = make(0.6);
    const profile = new Float64Array(COLS);
    lg.columnProfile(profile);
    for (let x = 0; x < COLS; x++) {
      const p = 0.5 + 0.15 * Math.sin((2 * Math.PI * x) / WAVELENGTH);
      expect(profile[x]).toBeCloseTo(Math.round(p * ROWS) / ROWS, 12);
    }
    const a0 = amplitude(lg);
    expect(a0).toBeGreaterThan(0.13);
    expect(a0).toBeLessThan(0.16);
  });

  it("B の総数が全試行で保存される", () => {
    const lg = make(0.9);
    const n0 = lg.countB();
    for (let t = 0; t < 4000; t++) {
      lg.attemptSwap(t % lg.size, t % 4);
      if (t % 97 === 0) expect(lg.countB()).toBe(n0);
    }
    lg.sweep(50);
    expect(lg.countB()).toBe(n0);
  });

  it("T/Tc = 0.6: 300 掃引後に波の振幅が初期の 1.4 倍以上に育つ", () => {
    const lg = make(0.6);
    const a0 = amplitude(lg);
    lg.sweep(300);
    expect(amplitude(lg) / a0).toBeGreaterThanOrEqual(1.4);
  });

  it("T/Tc = 1.5: 同じ跳び方で、300 掃引後に波の振幅が半分以下に均される", () => {
    const lg = make(1.5);
    const a0 = amplitude(lg);
    lg.sweep(300);
    expect(amplitude(lg) / a0).toBeLessThanOrEqual(0.5);
  });

  it("同じシードからは同じ配置・同じ時間発展になる(reset の再現性)", () => {
    const a = make(0.6);
    const b = make(0.6);
    a.sweep(20);
    b.sweep(20);
    expect(Array.from(a.occ)).toEqual(Array.from(b.occ));
  });
});

describe("メトロポリスの受け入れ確率", () => {
  it("表の値が min(1, e^{−ΔE/k_BT})", () => {
    for (const t of [0.4, 0.6, 1, 1.5, 2]) {
      const lg = new LatticeGas(8, 8);
      lg.setTemperature(t);
      const kT = t * TC_ISING;
      for (let dE = -12; dE <= 12; dE += 4) {
        expect(lg.acceptanceProbability(dE)).toBeCloseTo(
          Math.min(1, Math.exp(-dE / kT)),
          14,
        );
      }
    }
  });

  it("ΔE = +4J の入れ替えは e^{−4J/k_BT} の頻度で受け入れられる(統計)", () => {
    // 8 × 8 の A の海に B を 2 個並べ、右の B を右隣の A と入れ替える試行を
    // 繰り返す。B どうしの結合が切れて異種の結合が 2 本増える: ΔE = +4J
    const t = 1.2;
    const kT = t * TC_ISING;
    const expected = Math.exp(-4 / kT);
    const trials = 20000;
    let accepted = 0;
    const lg = new LatticeGas(8, 8);
    lg.setTemperature(t);
    lg.initWave(0, 0, 8, 7); // 全部 A
    const site = 3 * 8 + 3;
    for (let k = 0; k < trials; k++) {
      lg.occ.fill(ATOM_A);
      lg.occ[site] = ATOM_B;
      lg.occ[site - 1] = ATOM_B;
      if (lg.attemptSwap(site, 0)) accepted++;
    }
    const freq = accepted / trials;
    const sigma = Math.sqrt((expected * (1 - expected)) / trials);
    expect(Math.abs(freq - expected)).toBeLessThan(4 * sigma);
  });

  it("試行の向きに偏りはない: 受け入れた入れ替えは横・縦にほぼ均等", () => {
    const lg = make(1.5);
    const before = new Uint8Array(lg.occ);
    let horizontal = 0;
    let vertical = 0;
    lg.swapLogStride = 1;
    lg.sweep(5);
    const n = Math.min(lg.swapLogCount, lg.swapSiteA.length);
    for (let i = 0; i < n; i++) {
      const a = lg.swapSiteA[i];
      const b = lg.swapSiteB[i];
      if (Math.floor(a / COLS) === Math.floor(b / COLS)) horizontal++;
      else vertical++;
    }
    expect(n).toBeGreaterThan(400);
    expect(Math.abs(horizontal - vertical) / n).toBeLessThan(0.1);
    expect(before.length).toBe(lg.size);
  });

  it("列の境界を横切った B の正味の数が、列の組成の変化と一致する", () => {
    const lg = make(0.8);
    const p0 = new Float64Array(COLS);
    const p1 = new Float64Array(COLS);
    lg.columnProfile(p0);
    lg.resetFlux();
    lg.sweep(10);
    lg.columnProfile(p1);
    for (let x = 0; x < COLS; x++) {
      const left = (x - 1 + COLS) % COLS;
      // 列 x の B の増分 = 左の境界から入った数 − 右の境界から出た数
      const gain = lg.netFlux[left] - lg.netFlux[x];
      expect((p1[x] - p0[x]) * ROWS).toBeCloseTo(gain, 9);
    }
  });
});
