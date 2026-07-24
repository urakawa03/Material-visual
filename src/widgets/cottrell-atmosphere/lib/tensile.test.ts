/**
 * tensile.test.ts — 応力ひずみ曲線モデルの単体テスト(記事仕様 §5.1)
 */

import { describe, expect, it } from "vitest";
import {
  AL_E_MPA,
  AL_SIGMA02,
  EPS_MAX,
  STEEL_PLATEAU_END,
  STEEL_SIGMA_AT_EPS_MAX,
  STEEL_SIGMA_LOWER,
  STEEL_SIGMA_UPPER,
  buildAluminumCurve,
  buildMildSteelCurve,
  curveStressAt,
  steelHardeningStress,
} from "./tensile";

describe("軟鋼の曲線(§5.1)", () => {
  const steel = buildMildSteelCurve();

  it("上降伏点 ≈ 270 MPa の歯がある", () => {
    let peak = 0;
    for (let i = 0; i < steel.n; i++) {
      if (steel.eps[i] < 0.005) peak = Math.max(peak, steel.sig[i]);
    }
    expect(peak).toBeGreaterThan(STEEL_SIGMA_UPPER - 2);
    expect(peak).toBeLessThanOrEqual(STEEL_SIGMA_UPPER + 0.01);
  });

  it("プラトーは 240 ± 3 MPa 程度", () => {
    for (let i = 0; i < steel.n; i++) {
      const e = steel.eps[i];
      if (e > 0.005 && e < STEEL_PLATEAU_END - 0.001) {
        expect(steel.sig[i]).toBeGreaterThan(STEEL_SIGMA_LOWER - 3.5);
        expect(steel.sig[i]).toBeLessThan(STEEL_SIGMA_LOWER + 3.5);
      }
    }
  });

  it("ε = 15% で σ ≈ 430 MPa(K の校正)", () => {
    expect(curveStressAt(steel, EPS_MAX)).toBeCloseTo(
      STEEL_SIGMA_AT_EPS_MAX,
      0,
    );
    expect(steelHardeningStress(EPS_MAX)).toBeCloseTo(
      STEEL_SIGMA_AT_EPS_MAX,
      6,
    );
  });

  it("シード固定で再現可能(§8.2)", () => {
    const again = buildMildSteelCurve();
    expect(again.sig).toEqual(steel.sig);
  });
});

describe("アルミニウム合金の曲線(§5.1)", () => {
  const al = buildAluminumCurve();

  it("0.2% 耐力 ≈ 100 MPa(Ramberg–Osgood)", () => {
    const eps02 = AL_SIGMA02 / AL_E_MPA + 0.002;
    expect(curveStressAt(al, eps02)).toBeCloseTo(AL_SIGMA02, 0);
  });

  it("歯がない(単調非減少)", () => {
    for (let i = 1; i < al.n; i++) {
      expect(al.sig[i]).toBeGreaterThanOrEqual(al.sig[i - 1] - 1e-9);
    }
  });
});
