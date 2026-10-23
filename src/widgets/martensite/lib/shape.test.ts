/**
 * shape.test.ts — 表面起伏と自己調整の模式の単体テスト(記事仕様書 10 §5.5)
 *
 * 受け入れ基準: 交互の並びで全体のせん断がほぼ 0、ひずみエネルギーが
 * 1 種類のときより大幅に小さい。
 */

import { describe, expect, it } from "vitest";
import { ALTERNATING_PLATES, PLATE_SHEAR } from "./constants";
import {
  netOffset,
  overallShear,
  plateStack,
  strainEnergyRel,
  surfaceReliefRatio,
} from "./shape";

const single = plateStack("single");
const alt = plateStack("alternating");

describe("§5.5 バリアント 1 種類と交互の並び", () => {
  it("1 種類: 全体のせん断は γ × 層の割合、ひずみエネルギーは 1", () => {
    expect(overallShear(single, 0.25)).toBeCloseTo(PLATE_SHEAR * 0.25, 12);
    expect(strainEnergyRel(single)).toBeCloseTo(1, 12);
  });

  it("交互: 全体のせん断がほぼ 0(偶数枚で打ち消す)", () => {
    expect(alt.n).toBe(ALTERNATING_PLATES);
    expect(Math.abs(netOffset(alt))).toBeLessThan(1e-12);
    expect(Math.abs(overallShear(alt, 0.25))).toBeLessThan(1e-12);
  });

  it("交互: ひずみエネルギーが 1 種類の 1 割未満", () => {
    expect(strainEnergyRel(alt)).toBeLessThan(0.1);
    expect(strainEnergyRel(alt)).toBeGreaterThan(0);
  });

  it("表面の起伏は交互にすると 1/n になる", () => {
    const s = Math.sin((60 * Math.PI) / 180);
    expect(surfaceReliefRatio(single, s)).toBeCloseTo(PLATE_SHEAR * s, 12);
    expect(surfaceReliefRatio(alt, s)).toBeCloseTo(
      (PLATE_SHEAR * s) / ALTERNATING_PLATES,
      12,
    );
  });
});
