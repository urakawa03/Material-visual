/**
 * precipitate-strength.test.ts — 析出強化の共有モジュールの単体テスト
 *
 * 昇格(GPゾーン仕様書 07 §5.0)にあたり、オストワルド成長記事の
 * 既存の校正値・表示が一切変わらないことも合わせて確認する。
 */

import { describe, expect, it } from "vitest";
import { orowanMPa, spacingNm } from "./precipitate-strength";
import {
  BETA,
  B_NM,
  F_VOLUME,
  MU_GPA,
} from "../ostwald-ripening/lib/constants";
import {
  SIGMA0_MPA,
  displayStrengthMPa,
  orowanMPa as ostwaldOrowan,
  spacingNm as ostwaldSpacing,
} from "../ostwald-ripening/lib/strength";

describe("共有モジュール", () => {
  it("L = β r / √f", () => {
    expect(spacingNm(5, 0.08, 1.2)).toBeCloseTo((1.2 * 5) / Math.sqrt(0.08), 9);
  });

  it("Δτ = μb/L", () => {
    const r = 12;
    const f = 0.05;
    expect(orowanMPa(r, f, 4, 26, 0.286)).toBeCloseTo(
      (26e3 * 0.286) / spacingNm(r, f, 4),
      9,
    );
  });

  it("r を 2 倍にすると Δτ は半分になる(1/r 依存)", () => {
    const a = orowanMPa(4, 0.07, 4, 26, 0.286);
    const b = orowanMPa(8, 0.07, 4, 26, 0.286);
    expect(a / b).toBeCloseTo(2, 9);
  });
});

describe("オストワルド成長記事のラッパ(既存の値が変わらないこと)", () => {
  it("spacingNm / orowanMPa が自記事の定数を既定値として使う", () => {
    expect(ostwaldSpacing(15)).toBeCloseTo(
      (BETA * 15) / Math.sqrt(F_VOLUME),
      9,
    );
    expect(ostwaldOrowan(15)).toBeCloseTo(
      (MU_GPA * 1e3 * B_NM) / ostwaldSpacing(15),
      9,
    );
  });

  it("表示強度の校正(t = 10³ s・200 °C で約 350 MPa)が保たれている", () => {
    // constants.ts の校正式と同じ半径(§5.7)
    const rNm = Math.cbrt(5 ** 3 + ((15 ** 3 - 5 ** 3) / (10 * 3600)) * 1e3);
    expect(displayStrengthMPa(rNm)).toBeCloseTo(350, 6);
    expect(displayStrengthMPa(rNm)).toBeGreaterThan(SIGMA0_MPA);
  });
});
