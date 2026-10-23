/**
 * wavepacket.test.ts — 図1 の波束の数値計算の単体テスト(仕様書 14 §5.8 T3)
 *
 * T3: クランク=ニコルソン法で確率の総和が 1000 ステップで 1 ± 1e-9 に保たれ、
 *     透過した割合が「波束のエネルギー分布で平均した T」と 5% 以内で一致する
 *     (E/V = 0.5・0.8・1.2、d = 0.5 nm)。
 * あわせて、古典の玉が E < V で必ず戻り E > V で必ず越えること(図1 の受け入れ基準)。
 */

import { describe, expect, it } from "vitest";
import {
  averagedTransmission,
  ballPosition,
  classicalOutcome,
  hillHeight,
  relativeEnergySpread,
  WavePacket,
  type Hill,
} from "./wavepacket";
import { transmission } from "./tunneling";

const V = 4;
const START = 9.5;

function runToEnd(
  eOverV: number,
  d: number,
): { packet: WavePacket; trans: number } {
  const packet = new WavePacket();
  packet.configure({
    energy: eOverV * V,
    barrierHeight: V,
    barrierStart: START,
    barrierWidth: d,
  });
  let guard = 0;
  while (!packet.isScatteringOver() && guard < 5000) {
    packet.step(2);
    guard++;
  }
  return { packet, trans: packet.probabilityRight() };
}

describe("T3: 波束の数値計算(クランク=ニコルソン法)", () => {
  it("確率の総和が 1000 ステップのあいだ常に 1 ± 1e-9", () => {
    const packet = new WavePacket();
    packet.configure({
      energy: 2,
      barrierHeight: V,
      barrierStart: START,
      barrierWidth: 0.5,
    });
    expect(packet.norm()).toBeCloseTo(1, 12);
    for (let i = 0; i < 1000; i++) {
      packet.step();
      if (i % 50 === 0 || i === 999) {
        expect(Math.abs(packet.norm() - 1)).toBeLessThan(1e-9);
      }
    }
    expect(packet.steps).toBe(1000);
    expect(packet.time).toBeCloseTo(50, 9);
  });

  it("壁がなければ波束は形を保ったまま速さ v₀ = √(2E/m) で進む", () => {
    const packet = new WavePacket();
    packet.configure({
      energy: 2,
      barrierHeight: 0,
      barrierStart: START,
      barrierWidth: 0.5,
    });
    packet.step(100); // 5 fs
    let p = 0;
    let xm = 0;
    for (let j = 0; j < packet.n; j++) {
      const d = packet.density(j);
      p += d;
      xm += d * packet.x(j);
    }
    // 中心は x₀ + v₀t(格子とクランク=ニコルソン法の分散で 1% 程度ずれてよい)
    expect(xm / p).toBeCloseTo(4 + packet.v0 * 5, 1);
  });

  const cases = [0.5, 0.8, 1.2];
  for (const eOverV of cases) {
    it(`E/V = ${eOverV}、d = 0.5 nm: 透過した割合がエネルギーで平均した T と 5% 以内`, () => {
      const { packet, trans } = runToEnd(eOverV, 0.5);
      const expected = averagedTransmission(eOverV * V, V, 0.5);
      expect(Math.abs(trans / expected - 1)).toBeLessThan(0.05);
      // 散乱が終わった時点で、確率はまだ保たれている
      expect(Math.abs(packet.norm() - 1)).toBeLessThan(1e-9);
      // 表示範囲の外(左の余白)へはほとんど出ていない
      let hidden = 0;
      for (let j = 0; j < packet.jView0; j++) hidden += packet.density(j);
      expect(hidden * packet.dx).toBeLessThan(0.01);
    });
  }

  it("トンネルの領域では、平面波の T(E₀) とは数割ずれる(波束はエネルギーに幅を持つ)", () => {
    // 図1 の既定(E/V = 0.5、d = 0.5 nm)
    const tAvg = averagedTransmission(2, V, 0.5);
    const t0 = transmission(2, V, 0.5);
    expect(tAvg / t0).toBeGreaterThan(1.05);
    expect(tAvg / t0).toBeLessThan(1.5);
    // エネルギーの幅は約 ±14%(§5.1)
    expect(relativeEnergySpread(2)).toBeCloseTo(0.138, 2);
  });

  it("厚い壁でも、にせの透過(初期波束の切り口から来る高いエネルギー成分)が出ない", () => {
    // E/V = 0.5、d = 1.2 nm では ⟨T⟩ ≈ 3e-7。初期波束を表示範囲の端で
    // 切ると、ここに 1e-5 の桁のにせの透過が現れていた
    const { trans } = runToEnd(0.5, 1.2);
    const expected = averagedTransmission(2, V, 1.2);
    expect(Math.abs(trans / expected - 1)).toBeLessThan(0.1);
  });

  it("E/V > 1 でも反射が残る(越えられるのに跳ね返ることがある)", () => {
    const { packet } = runToEnd(1.2, 0.5);
    expect(packet.probabilityLeft()).toBeGreaterThan(0.2);
  });
});

describe("古典の玉(図1 上段)", () => {
  const hill: Hill = { start: START, width: 0.5, slope: 1.2, height: V };

  it("坂の高さは頂上で V、裾で 0", () => {
    expect(hillHeight(START + 0.25, hill)).toBe(V);
    expect(hillHeight(START - 1.2, hill)).toBe(0);
    expect(hillHeight(START - 0.6, hill)).toBeCloseTo(V / 2, 12);
    expect(hillHeight(20, hill)).toBe(0);
  });

  it("E < V では必ず坂の途中で止まって戻る(登れる高さはちょうど E)", () => {
    for (const eOverV of [0.3, 0.5, 0.8, 0.95]) {
      const E = eOverV * V;
      expect(classicalOutcome(E, V)).toBe("bounce");
      let xMax = -Infinity;
      for (let t = 0; t <= 60; t += 0.01) {
        xMax = Math.max(xMax, ballPosition(t, E, 4, hill));
      }
      expect(hillHeight(xMax, hill)).toBeCloseTo(E, 2);
      expect(xMax).toBeLessThan(START);
      expect(ballPosition(60, E, 4, hill)).toBeLessThan(4);
    }
  });

  it("E > V では必ず越えて、向こう側を元の速さで進む", () => {
    for (const eOverV of [1.05, 1.2, 1.5]) {
      const E = eOverV * V;
      expect(classicalOutcome(E, V)).toBe("cross");
      const late = ballPosition(30, E, 4, hill);
      expect(late).toBeGreaterThan(START + 0.5 + 1.2);
      const v0 = Math.sqrt((2 * E) / 5.686);
      const v = (ballPosition(31, E, 4, hill) - late) / 1;
      expect(v).toBeCloseTo(v0, 2);
    }
  });

  it("E = V ちょうどでは頂上で止まる", () => {
    expect(classicalOutcome(V, V)).toBe("stall");
    expect(ballPosition(100, V, 4, hill)).toBe(START);
  });

  it("位置は時間について連続(区間の継ぎ目で飛ばない)", () => {
    for (const E of [2, 4, 5]) {
      let prev = ballPosition(0, E, 4, hill);
      for (let t = 0.002; t <= 30; t += 0.002) {
        const x = ballPosition(t, E, 4, hill);
        expect(Math.abs(x - prev)).toBeLessThan(0.01);
        prev = x;
      }
    }
  });
});
