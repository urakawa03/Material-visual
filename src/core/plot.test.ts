/**
 * plot.test.ts — 目盛りと数値の書式の単体テスト(docs/specs/90_remaining_work.md §3.2・§3.5)
 */

import { describe, expect, it } from "vitest";
import {
  FONT_SANS,
  font,
  fmtPow10,
  fmtSci,
  fmtSig,
  linTicks,
  logTicks,
  pow10Label,
} from "./plot";

describe("font", () => {
  it("太さ 400 は省略し、それ以外は先頭に付ける", () => {
    expect(font(12)).toBe(`12px ${FONT_SANS}`);
    expect(font(11.5, 600)).toBe(`600 11.5px ${FONT_SANS}`);
  });
});

describe("linTicks", () => {
  it("1/2/5 刻みのきりのよい目盛りを返す", () => {
    const ticks = linTicks(0, 1);
    expect(ticks).toHaveLength(6);
    ticks.forEach((v, i) => expect(v).toBeCloseTo(i * 0.2, 12));
    expect(linTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(linTicks(-3, 7, 5)).toEqual([-2, 0, 2, 4, 6]);
  });

  it("幅が 0 以下なら最小値だけを返す", () => {
    expect(linTicks(5, 5)).toEqual([5]);
    expect(linTicks(5, 1)).toEqual([5]);
  });
});

describe("logTicks", () => {
  it("範囲に含まれる 10 の冪を返す(端の冪も含む)", () => {
    expect(logTicks(1, 1000)).toEqual([1, 10, 100, 1000]);
    expect(logTicks(1e-3, 1e-3)).toEqual([1e-3]);
  });

  it("端が冪でないときは内側の冪だけ", () => {
    expect(logTicks(0.5, 50)).toEqual([1, 10]);
    expect(logTicks(2, 9)).toEqual([]);
  });

  it("0 以下・逆順の範囲は空配列(log10(0) の発散を防ぐ)", () => {
    expect(logTicks(0, 10)).toEqual([]);
    expect(logTicks(-1, 10)).toEqual([]);
    expect(logTicks(10, 1)).toEqual([]);
  });
});

describe("fmtPow10 / pow10Label", () => {
  it("上付き数字で「10³」「10⁻⁵」と書く", () => {
    expect(fmtPow10(1000)).toBe("10³");
    expect(fmtPow10(1e-5)).toBe("10⁻⁵");
    expect(fmtPow10(1e12)).toBe("10¹²");
    expect(fmtPow10(1)).toBe("10⁰");
    expect(pow10Label(-41)).toBe("10⁻⁴¹");
  });
});

describe("fmtSig", () => {
  it("既定は有効数字 3 桁、100 以上は整数に丸める", () => {
    expect(fmtSig(0)).toBe("0");
    expect(fmtSig(12.345)).toBe("12.3");
    expect(fmtSig(0.012345)).toBe("0.0123");
    expect(fmtSig(1234.5)).toBe("1235");
    expect(fmtSig(-12.345)).toBe("-12.3");
  });

  it("桁数を指定できる", () => {
    expect(fmtSig(12.345, 2)).toBe("12");
    expect(fmtSig(1.2345, 2)).toBe("1.2");
  });

  it("非有限の値は「—」", () => {
    expect(fmtSig(Number.NaN)).toBe("—");
    expect(fmtSig(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("fmtSci", () => {
  it("「1.2 × 10⁴」の形で書く", () => {
    expect(fmtSci(12000)).toBe("1.2 × 10⁴");
    expect(fmtSci(1.08e10)).toBe("1.1 × 10¹⁰");
    expect(fmtSci(1.08e10, 3)).toBe("1.08 × 10¹⁰");
    expect(fmtSci(3e-11)).toBe("3 × 10⁻¹¹");
  });

  it("仮数が 1 なら冪だけ、丸めの繰り上がりは指数に送る", () => {
    expect(fmtSci(1e4)).toBe("10⁴");
    expect(fmtSci(9.96e3)).toBe("10⁴");
    expect(fmtSci(999.9999999999999)).toBe("10³");
  });

  it("負の値は「−」、0 は「0」、非有限は「—」", () => {
    expect(fmtSci(-2.5e-3)).toBe("−2.5 × 10⁻³");
    expect(fmtSci(0)).toBe("0");
    expect(fmtSci(Number.NaN)).toBe("—");
  });
});
