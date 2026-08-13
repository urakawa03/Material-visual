/**
 * realbands.test.ts — 図7 の模式バンドの単体テスト(仕様書 11 §5.8 T8)
 *
 * 図の曲率から読み取った有効質量が、表に載せる値と一致すること
 * (= 読み取り値と絵が食い違わないこと)を担保する。
 */

import { describe, expect, it } from "vitest";
import {
  branchEnergy,
  branchWidth,
  conductionMinimumT,
  effectiveMassRatio,
  getMaterial,
  kX,
  MATERIALS,
  pathToK,
} from "./realbands";

describe("T8: 模式バンドの曲率が設定した有効質量に一致する", () => {
  for (const m of MATERIALS) {
    it(`${m.key}: 伝導帯・価電子帯の m*/m が 2% 以内で一致する`, () => {
      const me = effectiveMassRatio(m.conduction);
      const mh = effectiveMassRatio(m.valence);
      expect(Math.abs(me - m.conduction.mr) / m.conduction.mr).toBeLessThan(
        0.02,
      );
      expect(Math.abs(mh - m.valence.mr) / m.valence.mr).toBeLessThan(0.02);
    });

    it(`${m.key}: バンド端の差がバンドギャップに一致する`, () => {
      const ec = branchEnergy(m.conduction.kEdge, m.conduction);
      const ev = branchEnergy(m.valence.kEdge, m.valence);
      expect(ec - ev).toBeCloseTo(m.eg, 10);
    });

    it(`${m.key}: 価電子帯の頂上は曲率が負(負の有効質量)`, () => {
      const k0 = m.valence.kEdge;
      const h = branchWidth(m.valence) / 200;
      const second =
        (branchEnergy(k0 + h, m.valence) -
          2 * branchEnergy(k0, m.valence) +
          branchEnergy(k0 - h, m.valence)) /
        (h * h);
      expect(second).toBeLessThan(0);
    });

    it(`${m.key}: 極値が実際に極値になっている`, () => {
      const w = branchWidth(m.conduction);
      const e0 = branchEnergy(m.conduction.kEdge, m.conduction);
      expect(
        branchEnergy(m.conduction.kEdge + w / 3, m.conduction),
      ).toBeGreaterThan(e0);
      expect(
        branchEnergy(m.conduction.kEdge - w / 3, m.conduction),
      ).toBeGreaterThan(e0);
    });
  }
});

describe("直接遷移と間接遷移", () => {
  it("GaAs は伝導帯の底が Γ(t = 0)", () => {
    const gaAs = getMaterial("GaAs");
    expect(gaAs.direct).toBe(true);
    expect(conductionMinimumT(gaAs)).toBeCloseTo(0, 12);
  });

  it("Si は伝導帯の底が Γ→X 上の 0.85 付近", () => {
    const si = getMaterial("Si");
    expect(si.direct).toBe(false);
    expect(conductionMinimumT(si)).toBeCloseTo(0.85, 6);
  });

  it("パス座標 t = 1 が X 点(2π/a)に写る", () => {
    const si = getMaterial("Si");
    expect(pathToK(1, si)).toBeCloseTo(kX(si), 12);
    expect(pathToK(0, si)).toBe(0);
    expect(pathToK(-1, si)).toBeLessThan(0);
  });
});
