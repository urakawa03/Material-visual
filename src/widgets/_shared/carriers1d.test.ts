/**
 * carriers1d.test.ts — 1 次元キャリア粒子の集合の単体テスト(仕様書 12 §5.8 T11)
 *
 * pn 接合の記事も使う共有モジュールなので、入れ替え削除で粒子の組が崩れない
 * こと、熱運動が区間の中に留まること、速度の分散が設定値に収束すること、
 * シード固定で同じ軌跡になることを担保する。
 */

import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../core/mathx";
import {
  addDrift,
  CarrierSet,
  nearestWithin,
  thermalStep,
  type NearestResult,
} from "./carriers1d";

const BOUNDS = { min: 0, max: 1 };
const PARAMS = { speed: 0.4, tau: 0.2 };
const DT = 1 / 60;

function filled(n: number, seed: number, aux = 0): CarrierSet {
  const set = new CarrierSet(n, aux);
  const rand = mulberry32(seed);
  for (let i = 0; i < n; i++) set.add(rand(), (rand() - 0.5) * 0.8);
  return set;
}

describe("T11: CarrierSet", () => {
  it("add は容量まで。満杯なら −1 を返して何もしない", () => {
    const set = new CarrierSet(3);
    expect(set.add(0.1, 0)).toBe(0);
    expect(set.add(0.2, 0)).toBe(1);
    expect(set.add(0.3, 0)).toBe(2);
    expect(set.add(0.4, 0)).toBe(-1);
    expect(set.count).toBe(3);
  });

  it("removeAt の後も、残りの粒子の(位置・速度・aux)の組が保たれる", () => {
    const set = new CarrierSet(50, 2);
    for (let i = 0; i < 50; i++) {
      const j = set.add(i / 50, -i);
      set.aux[0][j] = i * 10;
      set.aux[1][j] = i * 100;
    }
    const rand = mulberry32(7);
    const removed = new Set<number>();
    for (let k = 0; k < 30; k++) {
      const i = Math.floor(rand() * set.count);
      removed.add(-set.v[i]); // v = −(元の番号)
      set.removeAt(i);
    }
    expect(set.count).toBe(20);
    const seen = new Set<number>();
    for (let i = 0; i < set.count; i++) {
      const id = -set.v[i];
      expect(removed.has(id)).toBe(false);
      expect(set.x[i]).toBeCloseTo(id / 50, 12);
      expect(set.aux[0][i]).toBe(id * 10);
      expect(set.aux[1][i]).toBe(id * 100);
      seen.add(id);
    }
    expect(seen.size).toBe(20);
  });

  it("範囲外の添字の removeAt は何もしない", () => {
    const set = filled(5, 3);
    set.removeAt(-1);
    set.removeAt(5);
    expect(set.count).toBe(5);
  });
});

describe("T11: thermalStep", () => {
  it("何ステップ進めても位置は常に区間内", () => {
    const set = filled(301, 11);
    const rand = mulberry32(12);
    // 狭い区間・速い粒子(反射が頻繁に起きる条件)でも外に出ない
    const fast = { speed: 3, tau: 0.5 };
    const bounds = { min: -0.2, max: 0.3 };
    for (let i = 0; i < set.count; i++) set.x[i] = -0.2 + 0.5 * rand();
    let outside = 0;
    let reflections = 0;
    for (let s = 0; s < 3000; s++) {
      thermalStep(set, DT, fast, rand, bounds);
      for (let i = 0; i < set.count; i++) {
        const x = set.x[i];
        if (x < bounds.min || x > bounds.max) outside++;
        if (x - bounds.min < 0.01 || bounds.max - x < 0.01) reflections++;
      }
    }
    expect(outside).toBe(0);
    expect(reflections).toBeGreaterThan(1000); // 端に当たる条件を実際に試している
  });

  it("速度の分散が speed² に収束する(10% 以内)", () => {
    const set = new CarrierSet(400);
    for (let i = 0; i < 400; i++) set.add(i / 400, 0); // 初速 0 から
    const rand = mulberry32(2024);
    let acc = 0;
    let samples = 0;
    for (let s = 0; s < 2400; s++) {
      thermalStep(set, DT, PARAMS, rand, BOUNDS);
      if (s >= 600) {
        for (let i = 0; i < set.count; i++) acc += set.v[i] * set.v[i];
        samples += set.count;
      }
    }
    const variance = acc / samples;
    expect(Math.abs(variance / PARAMS.speed ** 2 - 1)).toBeLessThan(0.1);
  });

  it("1 ステップの移動量の目安は約 0.007(速さ 0.4/秒・dt = 1/60)", () => {
    const set = filled(400, 5);
    const rand = mulberry32(6);
    for (let s = 0; s < 120; s++) thermalStep(set, DT, PARAMS, rand, BOUNDS);
    const before = Float64Array.from(set.x);
    thermalStep(set, DT, PARAMS, rand, BOUNDS);
    let sum = 0;
    for (let i = 0; i < set.count; i++) sum += Math.abs(set.x[i] - before[i]);
    const mean = sum / set.count;
    expect(mean).toBeGreaterThan(0.003);
    expect(mean).toBeLessThan(0.008);
  });

  it("同じシードなら同じ軌跡", () => {
    const a = filled(57, 99);
    const b = filled(57, 99);
    const ra = mulberry32(5);
    const rb = mulberry32(5);
    for (let s = 0; s < 500; s++) {
      thermalStep(a, DT, PARAMS, ra, BOUNDS);
      thermalStep(b, DT, PARAMS, rb, BOUNDS);
    }
    for (let i = 0; i < a.count; i++) {
      expect(a.x[i]).toBe(b.x[i]);
      expect(a.v[i]).toBe(b.v[i]);
    }
  });
});

describe("addDrift / nearestWithin", () => {
  it("addDrift は位置に応じた加速度 × dt を速度に足す", () => {
    const set = new CarrierSet(3);
    set.add(0.25, 0);
    set.add(0.5, 1);
    set.add(0.75, -1);
    addDrift(set, 0.1, (x) => (x < 0.5 ? 2 : -2));
    expect(set.v[0]).toBeCloseTo(0.2, 12);
    expect(set.v[1]).toBeCloseTo(0.8, 12);
    expect(set.v[2]).toBeCloseTo(-1.2, 12);
  });

  it("nearestWithin は w 以内の最も近い粒子と個数を返し、exclude を除外する", () => {
    const set = new CarrierSet(5);
    for (const x of [0.1, 0.205, 0.198, 0.5, 0.21]) set.add(x, 0);
    const out: NearestResult = { index: -1, count: 0 };
    nearestWithin(set, 0.2, 0.01, -1, out);
    expect(out.index).toBe(2); // 0.198(距離 0.002)
    expect(out.count).toBe(3); // 0.205, 0.198, 0.21
    nearestWithin(set, 0.2, 0.01, 2, out);
    expect(out.index).toBe(1);
    expect(out.count).toBe(2);
    const none = nearestWithin(set, 0.8, 0.01);
    expect(none.index).toBe(-1);
    expect(none.count).toBe(0);
  });
});
