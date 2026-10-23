/**
 * tempering.test.ts — 焼戻しの単体テスト(記事仕様書 10 §5.8 T6)
 *
 * 同じホロモン・ジャッフェのパラメータなら同じ硬さ。硬さは P の単調減少で、
 * 両端が図1・図6 の値(焼入れまま 820 HV・十分な焼戻しで 250 HV)と一致する。
 */

import { describe, expect, it } from "vitest";
import { HV_AS_QUENCHED, HV_FULLY_TEMPERED } from "./constants";
import { martensiteHardness } from "./hardness";
import {
  P_MAX,
  P_MIN,
  hollomonJaffe,
  temperProgress,
  temperedHardness,
  tempForP,
  timeForP,
  toughness,
} from "./tempering";

describe("T6: ホロモン・ジャッフェのパラメータ(§5.7)", () => {
  it("600 ℃ × 1 時間 ≈ 550 ℃ × 約 16 時間", () => {
    const p = hollomonJaffe(600, 1);
    expect(p).toBeCloseTo(873.15 * 20, 6);
    const t550 = timeForP(p, 550);
    expect(t550).toBeGreaterThan(15);
    expect(t550).toBeLessThan(17.5);
  });

  it("同じ P を与える温度・時間の組で硬さが一致する", () => {
    for (const [tC, tH] of [
      [600, 1],
      [400, 1],
      [300, 10],
      [500, 0.1],
    ] as const) {
      const p = hollomonJaffe(tC, tH);
      const h = temperedHardness(p);
      const other = temperedHardness(
        hollomonJaffe(tC - 50, timeForP(p, tC - 50)),
      );
      expect(other).toBeCloseTo(h, 9);
      // 温度から逆算しても同じ P に戻る
      expect(hollomonJaffe(tempForP(p, 2), 2)).toBeCloseTo(p, 6);
    }
  });

  it("硬さは P に対して単調に減少する", () => {
    let prev = Infinity;
    for (let p = P_MIN; p <= P_MAX; p += 25) {
      const h = temperedHardness(p);
      expect(h).toBeLessThan(prev);
      prev = h;
    }
  });

  it("両端が焼入れまま(820 HV = 図6 の 0.8 C)と十分な焼戻し(250 HV)", () => {
    expect(temperedHardness(P_MIN)).toBeCloseTo(HV_AS_QUENCHED, 9);
    expect(temperedHardness(P_MAX)).toBeCloseTo(HV_FULLY_TEMPERED, 9);
    expect(HV_AS_QUENCHED).toBeCloseTo(martensiteHardness(0.8), 6);
    expect(temperProgress(P_MIN)).toBeCloseTo(0, 9);
    expect(temperProgress(P_MAX)).toBeCloseTo(1, 9);
  });
});

describe("靭性の模式曲線(§5.7)", () => {
  it("焼入れままより十分に焼き戻したほうがずっと粘り強い", () => {
    expect(toughness(P_MAX)).toBeGreaterThan(0.9);
    expect(toughness(P_MIN)).toBeLessThan(0.15);
  });

  it("260〜370 ℃ × 1 時間の付近に焼戻し脆性のくぼみ(極小)がある", () => {
    const pLo = hollomonJaffe(200, 1);
    const pHi = hollomonJaffe(450, 1);
    let localMin = -1;
    const step = 20;
    for (let p = pLo + step; p < pHi - step; p += step) {
      if (
        toughness(p) < toughness(p - step) &&
        toughness(p) < toughness(p + step)
      ) {
        localMin = p;
      }
    }
    expect(localMin).toBeGreaterThan(hollomonJaffe(260, 1));
    expect(localMin).toBeLessThan(hollomonJaffe(370, 1));
  });
});
