/**
 * banddiagram.test.ts — バンド図ヘルパの純関数部分の単体テスト
 *
 * 描画関数は Canvas を要するのでここでは扱わない(見た目はスクリーンショットで
 * 確認する)。対数軸の目盛り pow10Ticks(仕様書 12 §0-2)だけを検証する。
 */

import { describe, expect, it } from "vitest";
import { pow10Ticks } from "./banddiagram";

describe("pow10Ticks", () => {
  it("every の倍数の指数に、上付きの 10 の冪のラベルを付ける", () => {
    const ticks = pow10Ticks(8, 20, 4);
    expect(ticks.map((t) => t.value)).toEqual([8, 12, 16, 20]);
    expect(ticks.map((t) => t.label)).toEqual(["10⁸", "10¹²", "10¹⁶", "10²⁰"]);
  });

  it("負の指数・0 も正しく書く(−0 にならない)", () => {
    const ticks = pow10Ticks(-2, 1);
    expect(ticks.map((t) => t.value)).toEqual([-2, -1, 0, 1]);
    expect(ticks.map((t) => t.label)).toEqual(["10⁻²", "10⁻¹", "10⁰", "10¹"]);
    expect(Object.is(ticks[2].value, -0)).toBe(false);
  });

  it("端が every の倍数でなければ内側の倍数から始める", () => {
    expect(pow10Ticks(-1, 9, 4).map((t) => t.value)).toEqual([0, 4, 8]);
    expect(pow10Ticks(7.5, 12.2, 1).map((t) => t.value)).toEqual([
      8, 9, 10, 11, 12,
    ]);
  });

  it("逆順・非有限・不正な every は安全に扱う", () => {
    expect(pow10Ticks(5, 2)).toEqual([]);
    expect(pow10Ticks(Number.NaN, 2)).toEqual([]);
    expect(pow10Ticks(0, 2, 0).map((t) => t.value)).toEqual([0, 1, 2]);
  });
});
