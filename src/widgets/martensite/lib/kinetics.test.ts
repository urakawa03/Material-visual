/**
 * kinetics.test.ts — 冷却・変態の速さの単体テスト(記事仕様書 10 §5.8)
 *
 * T1: C 曲線とシャイルの加算則(図1 の主張の担保 — 最重要)
 * T2: 炭素の跳躍頻度(図2 の読み取り)
 * T3: 冷却中に炭素が動ける距離(図2 の比較)
 * T5: コイスティネン=マールブルガー式と残留オーステナイト(図4)
 */

import { describe, expect, it } from "vitest";
import {
  A1_C,
  COOLING_MEDIA,
  C_EUTECTOID,
  KELVIN_OFFSET,
  NOSE_TIME_S,
  NOSE_T_C,
  coolingMedium,
  toK,
} from "./constants";
import {
  C_CURVE_K,
  C_CURVE_LN_C1,
  avramiFraction,
  coolingOutcome,
  coolingRateAt,
  createDiffusionTable,
  criticalTauS,
  diffusionLengthCooling,
  diffusionalFraction,
  diffusionalT0,
  fastPearliteWindowC,
  hopFrequency,
  martensiteFraction,
  mfCelsius,
  msCelsius,
  newtonTempC,
  newtonTimeS,
  pearliteStartRate,
  pearliteStartTime,
  retainedAustenite,
} from "./kinetics";

/** 有効数字 2 桁に丸める(読み取りの表示桁) */
const sig2 = (v: number): number => Number(v.toPrecision(2));

describe("T1: C 曲線(§5.0)", () => {
  it("定数は仕様書の値(K ≈ 6.72 × 10⁷ K³、C₁ ≈ 2.4 × 10⁻¹¹ 秒)", () => {
    expect(C_CURVE_K / 1e7).toBeCloseTo(6.72, 1);
    expect(Math.exp(C_CURVE_LN_C1) / 1e-11).toBeCloseTo(2.4, 1);
  });

  it("数値探索で求めた鼻が 550 ℃・0.8 秒(0.5 ℃・1% 以内)", () => {
    let bestT = 0;
    let bestTime = Infinity;
    for (let tC = 300; tC < A1_C; tC += 0.05) {
      const ts = pearliteStartTime(toK(tC));
      if (ts < bestTime) {
        bestTime = ts;
        bestT = tC;
      }
    }
    expect(Math.abs(bestT - NOSE_T_C)).toBeLessThan(0.5);
    expect(Math.abs(bestTime / NOSE_TIME_S - 1)).toBeLessThan(0.01);
  });

  it("A₁ の近く・上で例外も NaN も出ず、変態は始まらない(1/t_s = 0)", () => {
    const a1K = toK(A1_C);
    for (const tK of [a1K - 1, a1K - 1e-3, a1K - 1e-9, a1K, a1K + 50]) {
      const r = pearliteStartRate(tK);
      expect(Number.isNaN(r)).toBe(false);
      expect(r).toBeGreaterThanOrEqual(0);
    }
    expect(pearliteStartRate(a1K - 1e-9)).toBe(0);
    expect(pearliteStartTime(a1K)).toBe(Infinity);
    // 0.01 K 刻みで A₁ の手前まで走査しても有限か 0
    for (let tK = a1K - 30; tK < a1K; tK += 0.01) {
      expect(Number.isFinite(pearliteStartRate(tK))).toBe(true);
    }
  });

  it("鼻から離れるほど遅い(C の形)", () => {
    expect(pearliteStartTime(toK(650))).toBeGreaterThan(100);
    expect(pearliteStartTime(toK(300))).toBeGreaterThan(100);
    expect(pearliteStartTime(toK(500))).toBeLessThan(2);
  });
});

describe("T1: 連続冷却の結果(§5.0 の表)", () => {
  const ms = msCelsius(C_EUTECTOID);

  it("塩水・水はマルテンサイト(加算和 0.08・0.17)", () => {
    const brine = coolingOutcome(coolingMedium("brine").tauS, ms);
    const water = coolingOutcome(coolingMedium("water").tauS, ms);
    expect(brine.product).toBe("martensite");
    expect(water.product).toBe("martensite");
    expect(brine.scheilSum.toFixed(2)).toBe("0.08");
    expect(water.scheilSum.toFixed(2)).toBe("0.17");
  });

  it("油・空気・炉はパーライト(521・602・632 ℃ で開始、±5 ℃)", () => {
    const expected: Record<string, number> = {
      oil: 521,
      air: 602,
      furnace: 632,
    };
    for (const [id, tC] of Object.entries(expected)) {
      const m = COOLING_MEDIA.find((c) => c.id === id);
      if (!m) throw new Error(id);
      const out = coolingOutcome(m.tauS, ms);
      expect(out.product).toBe("pearlite");
      expect(Math.abs(out.startTempC - tC)).toBeLessThan(5);
      // 時刻はニュートン冷却の逆関数と整合する
      expect(newtonTempC(out.startTimeS, m.tauS)).toBeCloseTo(
        out.startTempC,
        6,
      );
    }
  });

  it("遅いほど高い温度でパーライトになる(炉 > 空気 > 油)", () => {
    const t = (id: "furnace" | "air" | "oil"): number =>
      coolingOutcome(coolingMedium(id).tauS, ms).startTempC;
    expect(t("furnace")).toBeGreaterThan(t("air"));
    expect(t("air")).toBeGreaterThan(t("oil"));
  });

  it("臨界の τ ≈ 3.5 秒(550 ℃ で約 150 ℃/秒)", () => {
    const tauC = criticalTauS(ms);
    expect(Math.abs(tauC - 3.5)).toBeLessThan(0.2);
    expect(Math.abs(coolingRateAt(550, tauC) - 150)).toBeLessThan(10);
    // 境目のすぐ両側で結果が入れ替わる
    expect(coolingOutcome(tauC * 0.98, ms).product).toBe("martensite");
    expect(coolingOutcome(tauC * 1.02, ms).product).toBe("pearlite");
  });

  it("550 ℃ での冷却速度は表のとおり(水 875・油 88・空気 5 ℃/秒)", () => {
    expect(coolingRateAt(550, 0.6)).toBeCloseTo(875, 6);
    expect(Math.round(coolingRateAt(550, 6))).toBe(88);
    expect(Math.round(coolingRateAt(550, 100))).toBe(5);
  });

  it("ニュートン冷却の往復(時刻 → 温度 → 時刻)", () => {
    for (const tau of [0.3, 6, 3600]) {
      for (const tC of [800, 550, 100]) {
        expect(newtonTempC(newtonTimeS(tC, tau), tau)).toBeCloseTo(tC, 8);
      }
    }
    expect(newtonTimeS(20, 1)).toBe(Infinity);
  });
});

describe("T2: 炭素の跳躍頻度(§5.2)", () => {
  it("900・500・300・100 ℃ で 2.6×10⁶・1.0×10³・0.32・1.9×10⁻⁸ 回/秒", () => {
    expect(sig2(hopFrequency(toK(900)))).toBe(2.6e6);
    expect(sig2(hopFrequency(toK(500)))).toBe(1.0e3);
    expect(sig2(hopFrequency(toK(100)))).toBe(1.9e-8);
    // 300 ℃ は 0.3252 で丸めの境目にある(仕様書の 0.32 は R = 8.314 での値。
    // CODATA の R_GAS では 2 桁表示が 0.33 になる)ので 2% 以内で比べる
    expect(Math.abs(hopFrequency(toK(300)) / 0.32 - 1)).toBeLessThan(0.02);
  });

  it("温度が下がると単調に減る", () => {
    let prev = Infinity;
    for (let tC = 1000; tC >= 0; tC -= 5) {
      const g = hopFrequency(tC + KELVIN_OFFSET);
      expect(g).toBeLessThan(prev);
      prev = g;
    }
  });
});

describe("T3: 冷却中に炭素が動ける距離 √(2∫D dt)(§5.2)", () => {
  const water = coolingMedium("water").tauS;
  const air = coolingMedium("air").tauS;
  const win = fastPearliteWindowC();

  it("鼻のまわり(C 曲線が 10 秒より左)は約 420〜620 ℃", () => {
    expect(win.loC).toBeGreaterThan(400);
    expect(win.loC).toBeLessThan(440);
    expect(win.hiC).toBeGreaterThan(600);
    expect(win.hiC).toBeLessThan(640);
    expect(win.loC).toBeLessThan(NOSE_T_C);
    expect(win.hiC).toBeGreaterThan(NOSE_T_C);
  });

  it("水冷: A₁ 以下の合計は約 0.2 μm、鼻のまわりでは 0.1 μm に届かない", () => {
    const total = diffusionLengthCooling(water, 25);
    expect(total * 1e6).toBeGreaterThan(0.15);
    expect(total * 1e6).toBeLessThan(0.25);
    const nose = diffusionLengthCooling(water, win.loC, win.hiC);
    expect(nose * 1e6).toBeLessThan(0.1);
  });

  it("空冷: 鼻のまわりで 0.1 μm を大きく超え、合計は 1 μm を超える", () => {
    expect(diffusionLengthCooling(air, win.loC, win.hiC) * 1e6).toBeGreaterThan(
      0.5,
    );
    expect(diffusionLengthCooling(air, 25) * 1e6).toBeGreaterThan(1);
  });

  it("距離は √τ に比例する(ニュートン冷却では加算和と同じく τ に比例する積分)", () => {
    const ratio =
      diffusionLengthCooling(air, 25) / diffusionLengthCooling(water, 25);
    expect(ratio).toBeCloseTo(Math.sqrt(air / water), 6);
  });

  it("A₁ より上は数えない(範囲が A₁ 以上なら 0)", () => {
    expect(diffusionLengthCooling(water, A1_C, 900)).toBe(0);
  });

  it("図2 の毎フレーム用の表は直接の積分と 0.5% 以内で一致する", () => {
    const table = createDiffusionTable(150);
    for (const lo of [150, 300, 450, 600, 700]) {
      const direct = diffusionLengthCooling(water, lo);
      expect(Math.abs(table.length(water, lo) / direct - 1)).toBeLessThan(
        0.005,
      );
    }
    const nose = diffusionLengthCooling(air, win.loC, win.hiC);
    expect(
      Math.abs(table.length(air, win.loC, win.hiC) / nose - 1),
    ).toBeLessThan(0.005);
  });
});

describe("T5: コイスティネン=マールブルガー式(§5.4)", () => {
  const ms = msCelsius(C_EUTECTOID);

  it("M_s で 0、M_s − 420 ℃ で 99%", () => {
    expect(martensiteFraction(ms, ms)).toBe(0);
    expect(martensiteFraction(ms + 30, ms)).toBe(0);
    expect(martensiteFraction(ms - 420, ms)).toBeCloseTo(0.99, 2);
    expect(mfCelsius(ms)).toBeCloseTo(ms - 418.7, 0);
  });

  it("保持時間に依存しない(関数の引数に時間がない — 非熱的)", () => {
    // 引数は (温度, M_s) の 2 つだけ。保持時間を渡す口がない
    expect(martensiteFraction.length).toBe(2);
  });

  it("0.8 C の室温の残留オーステナイトは 10〜15%、1.2 C ではさらに多い", () => {
    const ra08 = retainedAustenite(0.8);
    expect(ra08).toBeGreaterThan(0.1);
    expect(ra08).toBeLessThan(0.15);
    expect(retainedAustenite(1.2)).toBeGreaterThan(ra08 + 0.1);
  });

  it("M_s は炭素とともに下がり、仕様書の目安と 10 ℃ 以内", () => {
    const guide: Array<[number, number]> = [
      [0.2, 430],
      [0.4, 350],
      [0.6, 280],
      [0.8, 220],
      [1.0, 180],
      [1.2, 140],
    ];
    let prev = Infinity;
    for (const [c, ms0] of guide) {
      const v = msCelsius(c);
      expect(Math.abs(v - ms0)).toBeLessThanOrEqual(10);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    expect(Math.round(msCelsius(0.8))).toBe(220);
  });
});

describe("比較: 拡散変態のアブラミ式(§5.4 図4 右)", () => {
  it("同じ温度に保てば時間とともに単調に増える", () => {
    let prev = -1;
    for (let lg = 0; lg <= 5; lg += 0.25) {
      const f = diffusionalFraction(500, 10 ** lg);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(diffusionalFraction(500, 1e5)).toBeGreaterThan(0.99);
  });

  it("C 曲線の開始時間で 1% になる", () => {
    for (const tC of [300, 450, 600]) {
      const ts = pearliteStartTime(toK(tC));
      expect(avramiFraction(ts, diffusionalT0(tC))).toBeCloseTo(0.01, 6);
    }
  });

  it("A₁ 以上では進まない", () => {
    expect(diffusionalFraction(800, 1e5)).toBe(0);
  });
});
