/**
 * units.test.ts — 物理定数と時間の書式の単体テスト(docs/specs/90_remaining_work.md §3.1・§3.5)
 */

import { describe, expect, it } from "vitest";
import {
  EV_TO_KJ_PER_MOL,
  HBAR2_OVER_2ME,
  HBAR_EV_FS,
  KB_EV,
  Q_E,
  R_GAS,
  UNIVERSE_AGE_S,
  YEAR_S,
  formatDuration,
} from "./units";

/** アボガドロ定数 [1/mol](定数どうしの整合の確認にだけ使う) */
const N_A = 6.02214076e23;
/** ħc [eV·nm] と電子の静止エネルギー mₑc² [eV] */
const HBAR_C_EV_NM = 197.3269804;
const ME_C2_EV = 510998.95;
/** 光速 [nm/fs] */
const C_NM_PER_FS = 299.792458;

describe("物理定数の整合", () => {
  it("室温の k_BT は 25.85 meV", () => {
    expect(KB_EV * 300).toBeCloseTo(0.025852, 6);
  });

  it("R = k_B·q·N_A、eV → kJ/mol の換算 = q·N_A/1000", () => {
    expect(KB_EV * Q_E * N_A).toBeCloseTo(R_GAS, 6);
    expect((Q_E * N_A) / 1000).toBeCloseTo(EV_TO_KJ_PER_MOL, 6);
  });

  it("ħ²/2mₑ と ħ が ħc・mₑc² と矛盾しない", () => {
    expect(HBAR_C_EV_NM ** 2 / (2 * ME_C2_EV)).toBeCloseTo(HBAR2_OVER_2ME, 6);
    expect(HBAR_C_EV_NM / C_NM_PER_FS).toBeCloseTo(HBAR_EV_FS, 8);
  });

  it("宇宙の年齢は 138 億年 ≒ 4.35 × 10¹⁷ 秒", () => {
    expect(UNIVERSE_AGE_S / YEAR_S).toBeCloseTo(1.38e10, -6);
    expect(UNIVERSE_AGE_S).toBeCloseTo(4.355e17, -14);
  });
});

describe("formatDuration — 単位の選び方", () => {
  it("設計図に挙げた例のとおりに表示する", () => {
    expect(formatDuration(1.4e-4)).toBe("0.14 ミリ秒");
    expect(formatDuration(0.3)).toBe("0.3 秒");
    expect(formatDuration(720)).toBe("12 分");
    expect(formatDuration(3.5 * 3600)).toBe("3.5 時間");
    expect(formatDuration(4.2 * 86400)).toBe("4.2 日");
    expect(formatDuration(2.4e11)).toBe("7600 年");
    expect(formatDuration(3e15)).toBe("9500 万年");
  });

  it("秒未満は値が 0.1 以上になる単位を使う", () => {
    expect(formatDuration(5e-10)).toBe("0.5 ナノ秒");
    expect(formatDuration(5e-8)).toBe("50 ナノ秒");
    expect(formatDuration(1e-7)).toBe("0.1 マイクロ秒");
    expect(formatDuration(2e-5)).toBe("20 マイクロ秒");
    expect(formatDuration(1e-4)).toBe("0.1 ミリ秒");
    expect(formatDuration(0.05)).toBe("50 ミリ秒");
    expect(formatDuration(0.1)).toBe("0.1 秒");
  });

  it("0.1 ナノ秒未満は指数表示の秒", () => {
    expect(formatDuration(3e-11)).toBe("3 × 10⁻¹¹ 秒");
  });

  it("丸めた値が単位の上限に届いたら次の単位へ繰り上げる", () => {
    expect(formatDuration(59.96)).toBe("1 分");
    expect(formatDuration(59.4)).toBe("59 秒");
    expect(formatDuration(3599)).toBe("1 時間");
    expect(formatDuration(0.0999)).toBe("0.1 秒");
    expect(formatDuration(9999 * YEAR_S)).toBe("1 万年");
  });

  it("1 億年以上は億年、宇宙の年齢以上は宇宙の年齢との比", () => {
    expect(formatDuration(3.2e9 * YEAR_S)).toBe("32 億年");
    expect(formatDuration(2.5 * UNIVERSE_AGE_S)).toBe("宇宙の年齢の 2.5 倍");
    expect(formatDuration(4e26)).toBe("宇宙の年齢の 9.2 × 10⁸ 倍");
  });

  it("フラッシュメモリ(仕様書 14 図7)の保持時間を人の単位に直せる", () => {
    expect(formatDuration(0.14e-3)).toBe("0.14 ミリ秒");
    expect(formatDuration(17)).toBe("17 秒");
    expect(formatDuration(2.4e11)).toBe("7600 年");
  });

  it("有効数字の桁数を指定できる", () => {
    expect(formatDuration(2.4e11, 3)).toBe("7610 年");
    expect(formatDuration(12.345, 3)).toBe("12.3 秒");
  });

  it("0 は「0 秒」、非有限・負の値は「—」", () => {
    expect(formatDuration(0)).toBe("0 秒");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});
