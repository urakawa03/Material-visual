/**
 * formation.test.ts — 図1 の接合形成モデルの単体テスト(仕様書 13 §5.7 T6)
 *
 * 拡散・再結合・ガウスの法則だけで空乏層が自然にでき、自己停止することを、
 * シード固定の決定的なシミュレーションで担保する。仕様書の試作(約 5 秒で
 * 17 対、10 秒以降は 20〜23 対で停止、接合面付近は 0〜3 個、坂は熱エネルギーの
 * 7〜10 倍)から大きく外れたら規則の転記ミスを疑う。
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  BULK_NEAR_COUNT,
  CARRIERS_PER_SIDE,
  CHARGE_BINS,
  FIELD_BINS,
  FORMATION_DT,
  FormationSim,
} from "./formation";

const STEPS_PER_SECOND = Math.round(1 / FORMATION_DT);

describe("T6: 接触後の空乏層の形成と自己停止", () => {
  const sim = new FormationSim();
  const exposed = { left: 0, right: 0 };
  let invariantsHeld = true;
  let exposedEqual = true;
  let recombinedAt5 = 0;
  let recombinedAt20 = 0;
  let recombinedAt40 = 0;
  let nearAt20 = 0;
  let nearMean = 0;
  let barrierMean = 0;

  beforeAll(() => {
    sim.contact();
    let nearSum = 0;
    let barrierSum = 0;
    let samples = 0;
    for (let s = 1; s <= 40 * STEPS_PER_SECOND; s++) {
      sim.step();
      // 総電荷ゼロ・両端の電場ゼロ・電子数 = 正孔数(全ステップ)
      if (
        sim.totalCharge !== 0 ||
        sim.field[0] !== 0 ||
        sim.field[FIELD_BINS] !== 0 ||
        sim.holes.count !== sim.electrons.count
      ) {
        invariantsHeld = false;
      }
      sim.exposedIons(exposed);
      if (exposed.left !== exposed.right) exposedEqual = false;
      if (s === 5 * STEPS_PER_SECOND) recombinedAt5 = sim.recombined;
      if (s === 20 * STEPS_PER_SECOND) {
        recombinedAt20 = sim.recombined;
        nearAt20 = sim.nearJunctionCount();
      }
      if (s >= 20 * STEPS_PER_SECOND) {
        nearSum += sim.nearJunctionCount();
        barrierSum += sim.barrierInThermal();
        samples++;
      }
    }
    recombinedAt40 = sim.recombined;
    nearMean = nearSum / samples;
    barrierMean = barrierSum / samples;
  });

  it("総電荷ゼロ・両端の電場ゼロが全ステップで成り立つ", () => {
    expect(invariantsHeld).toBe(true);
  });

  it("左右のむき出しのイオンの数が全ステップで等しい", () => {
    expect(exposedEqual).toBe(true);
  });

  it("20 秒後、接合面付近のキャリアがバルク換算の 20% 未満(空乏層の形成)", () => {
    expect(BULK_NEAR_COUNT).toBe(24);
    expect(nearAt20).toBeLessThan(0.2 * BULK_NEAR_COUNT);
    // 1 時点の値は揺らぐので、20〜40 秒の平均でも確かめる
    expect(nearMean).toBeLessThan(0.2 * BULK_NEAR_COUNT);
  });

  it("20〜40 秒で再結合数の増加は 5 以下(自己停止)", () => {
    expect(recombinedAt40 - recombinedAt20).toBeLessThanOrEqual(5);
  });

  it("仕様書の試作と同程度: 5 秒で十数対、停止時 20 対前後、坂は熱エネルギーの 5〜12 倍", () => {
    expect(recombinedAt5).toBeGreaterThanOrEqual(12);
    expect(recombinedAt5).toBeLessThanOrEqual(22);
    expect(recombinedAt40).toBeGreaterThanOrEqual(16);
    expect(recombinedAt40).toBeLessThanOrEqual(28);
    expect(barrierMean).toBeGreaterThan(5);
    expect(barrierMean).toBeLessThan(12);
  });
});

describe("FormationSim の接触前と再現性", () => {
  it("接触前はキャリアが自分の側に閉じ込められ、再結合しない", () => {
    const sim = new FormationSim();
    for (let s = 0; s < 10 * STEPS_PER_SECOND; s++) sim.step();
    expect(sim.recombined).toBe(0);
    for (let i = 0; i < sim.holes.count; i++) {
      expect(sim.holes.x[i]).toBeLessThanOrEqual(0);
    }
    for (let i = 0; i < sim.electrons.count; i++) {
      expect(sim.electrons.x[i]).toBeGreaterThanOrEqual(0);
    }
    expect(sim.holes.count).toBe(CARRIERS_PER_SIDE);
    // 接合面付近にはバルクと同程度のキャリアがいる
    expect(sim.nearJunctionCount()).toBeGreaterThan(0.6 * BULK_NEAR_COUNT);
  });

  it("reset で接触前・同じ乱数列に戻る", () => {
    const a = new FormationSim(7);
    const b = new FormationSim(7);
    a.contact();
    a.advance(600);
    a.reset();
    expect(a.contacted).toBe(false);
    expect(a.recombined).toBe(0);
    a.contact();
    b.contact();
    a.advance(900);
    b.advance(900);
    expect(a.recombined).toBe(b.recombined);
    expect(a.holes.count).toBe(b.holes.count);
    for (let i = 0; i < a.holes.count; i++) {
      expect(a.holes.x[i]).toBe(b.holes.x[i]);
    }
    for (let i = 0; i < a.electrons.count; i++) {
      expect(a.electrons.x[i]).toBe(b.electrons.x[i]);
    }
  });

  it("電荷のヒストグラムの合計は 0", () => {
    const sim = new FormationSim();
    sim.contact();
    sim.advance(1200);
    const hist = new Float64Array(CHARGE_BINS);
    sim.chargeHistogram(hist);
    let s = 0;
    for (let j = 0; j < CHARGE_BINS; j++) s += hist[j];
    expect(s).toBe(0);
    // 空乏層: 接合面のすぐ左は負、すぐ右は正(時間平均しなくても符号は出る)
    let left = 0;
    let right = 0;
    for (let j = CHARGE_BINS / 2 - 4; j < CHARGE_BINS / 2; j++) left += hist[j];
    for (let j = CHARGE_BINS / 2; j < CHARGE_BINS / 2 + 4; j++) {
      right += hist[j];
    }
    expect(left).toBeLessThan(0);
    expect(right).toBeGreaterThan(0);
  });
});
