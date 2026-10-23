/**
 * format.test.ts — 読み取り値の書式の単体テスト
 *
 * 仕様書 12 §5.5 の受け入れ基準「不純物の割合が 10¹⁶ で『500 万分の 1』、
 * 導電率が『約 70 万倍』」の書式を担保する。
 */

import { describe, expect, it } from "vitest";
import {
  formatDensity,
  formatEvFixed,
  formatEvSigned,
  formatOneIn,
  formatPercent,
  formatTimesRough,
  japaneseNumber,
} from "./format";

describe("密度と eV の書式", () => {
  it("密度は有効数字 2 桁の「1.2 × 10⁴ cm⁻³」", () => {
    expect(formatDensity(1.169e4)).toBe("1.2 × 10⁴ cm⁻³");
    expect(formatDensity(1e16)).toBe("10¹⁶ cm⁻³");
    expect(formatDensity(9.96e15)).toBe("10¹⁶ cm⁻³");
    expect(formatDensity(Number.NaN)).toBe("—");
  });

  it("eV は負号に「−」を使い、符号つきは「+」も付ける", () => {
    expect(formatEvSigned(0.3551)).toBe("+0.355 eV");
    expect(formatEvSigned(-0.3549)).toBe("−0.355 eV");
    expect(formatEvSigned(-0.0001)).toBe("0.000 eV");
    expect(formatEvFixed(-0.71)).toBe("−0.710 eV");
    expect(formatEvFixed(0.0004)).toBe("0.000 eV");
  });
});

describe("万・億・兆の書式", () => {
  it("不純物の割合: 10¹⁶ で「Si 原子の 500 万分の 1」", () => {
    expect(formatOneIn(5e22 / 1e16)).toBe("Si 原子の 500 万分の 1");
    expect(formatOneIn(5e22 / 1e13)).toBe("Si 原子の 50 億分の 1");
    expect(formatOneIn(5e22 / 1e20)).toBe("Si 原子の 500 分の 1");
    expect(formatOneIn(5e22 / 3.16e16)).toBe("Si 原子の 160 万分の 1");
  });

  it("導電率の倍率: 6.8 × 10⁵ で「約 70 万倍」", () => {
    expect(formatTimesRough(6.81e5)).toBe("約 70 万倍");
    expect(formatTimesRough(683)).toBe("約 700 倍");
    expect(formatTimesRough(1.0004)).toBe("約 1 倍");
    expect(formatTimesRough(0.88)).toBe("約 0.9 倍");
    expect(formatTimesRough(2.4e9)).toBe("約 20 億倍");
  });

  it("japaneseNumber は桁の区切りを選ぶ", () => {
    expect(japaneseNumber(42000, 2)).toEqual({ num: "4.2", unit: "万" });
    expect(japaneseNumber(3.3e12, 2)).toEqual({ num: "3.3", unit: "兆" });
    expect(japaneseNumber(9999, 2)).toEqual({ num: "1", unit: "万" });
  });

  it("割合の百分率", () => {
    expect(formatPercent(0.996)).toBe("99.6 %");
    expect(formatPercent(0.0518)).toBe("5.2 %");
    expect(formatPercent(0.9999)).toBe("> 99.9 %");
    expect(formatPercent(0.004)).toBe("0.40 %");
  });
});
