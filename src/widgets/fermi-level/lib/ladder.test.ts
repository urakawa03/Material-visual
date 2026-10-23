/**
 * ladder.test.ts — 図1 の席のはしごの単体テスト(仕様書 12 §5.8 T1)
 *
 * T = 0 の化学ポテンシャルの極限: 偶数個で最上位が満席なら HOMO と LUMO の
 * 中間、奇数個なら半分埋まった準位の高さ。隙間ありで下の帯をちょうど
 * 埋めきると、E_F は席のない禁制帯の中央(3.0 eV)に来る。
 */

import { describe, expect, it } from "vitest";
import { fillLadder, ladderBands, ladderLevels } from "./ladder";

describe("T1: 席のはしごと T = 0 の E_F", () => {
  it("準位の配置が仕様どおり(隙間なし 24 準位・隙間あり 12 + 12 準位)", () => {
    const gapless = ladderLevels("gapless");
    expect(gapless).toHaveLength(24);
    expect(gapless[0].e).toBeCloseTo(0.25, 12);
    expect(gapless[23].e).toBeCloseTo(5.75, 12);
    const gapped = ladderLevels("gapped");
    expect(gapped).toHaveLength(24);
    expect(gapped[11].e).toBeCloseTo(2.4, 12);
    expect(gapped[12].e).toBeCloseTo(3.6, 12);
    expect(ladderBands("gapped")).toHaveLength(2);
  });

  it("偶数個で HOMO が満席なら E_F = (E_HOMO + E_LUMO)/2", () => {
    for (const material of ["gapless", "gapped"] as const) {
      const levels = ladderLevels(material);
      for (let n = 2; n < 48; n += 2) {
        const f = fillLadder(levels, n);
        const homo = levels[n / 2 - 1].e;
        const lumo = levels[n / 2].e;
        expect(f.halfFilled).toBe(false);
        expect(f.lastFilled).toBeCloseTo(homo, 12);
        expect(f.firstEmpty).toBeCloseTo(lumo, 12);
        expect(f.eF).toBeCloseTo((homo + lumo) / 2, 12);
      }
    }
  });

  it("奇数個なら E_F は半分埋まった準位の高さ(席がある)", () => {
    for (const material of ["gapless", "gapped"] as const) {
      const levels = ladderLevels(material);
      for (let n = 1; n < 48; n += 2) {
        const f = fillLadder(levels, n);
        const level = levels[(n - 1) / 2].e;
        expect(f.halfFilled).toBe(true);
        expect(f.eF).toBeCloseTo(level, 12);
        expect(f.lastFilled).toBeCloseTo(level, 12);
        expect(f.firstEmpty).toBeCloseTo(level, 12);
        expect(f.seatAtEF).toBe(true);
      }
    }
  });

  it("隙間ありで 24 個なら E_F = 3.0 eV(禁制帯の中央)で、そこに席はない", () => {
    const f = fillLadder(ladderLevels("gapped"), 24);
    expect(f.eF).toBeCloseTo(3.0, 12);
    expect(f.lastFilled).toBeCloseTo(2.4, 12);
    expect(f.firstEmpty).toBeCloseTo(3.6, 12);
    expect(f.seatAtEF).toBe(false);
  });

  it("隙間なしでは E_F はいつも帯の中(席がある)", () => {
    const levels = ladderLevels("gapless");
    for (let n = 1; n < 48; n++) {
      expect(fillLadder(levels, n).seatAtEF).toBe(true);
    }
  });

  it("0 個・48 個の両端では E_F が定まらない(NaN と null)", () => {
    for (const material of ["gapless", "gapped"] as const) {
      const levels = ladderLevels(material);
      const empty = fillLadder(levels, 0);
      expect(Number.isNaN(empty.eF)).toBe(true);
      expect(Number.isNaN(empty.lastFilled)).toBe(true);
      expect(empty.seatAtEF).toBeNull();
      const full = fillLadder(levels, 48);
      expect(Number.isNaN(full.eF)).toBe(true);
      expect(Number.isNaN(full.firstEmpty)).toBe(true);
      expect(full.seatAtEF).toBeNull();
      // 範囲外は丸める
      expect(fillLadder(levels, -3).fullLevels).toBe(0);
      expect(fillLadder(levels, 99).fullLevels).toBe(24);
    }
  });

  it("電子を 1 個足すごとに E_F は下がらない(単調)", () => {
    for (const material of ["gapless", "gapped"] as const) {
      const levels = ladderLevels(material);
      let prev = -Infinity;
      for (let n = 1; n < 48; n++) {
        const eF = fillLadder(levels, n).eF;
        expect(eF).toBeGreaterThanOrEqual(prev);
        prev = eF;
      }
    }
  });
});
