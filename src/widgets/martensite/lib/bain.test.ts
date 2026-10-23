/**
 * bain.test.ts — ベイン対応と正方性の単体テスト(記事仕様書 10 §5.8)
 *
 * T4: 図3 の「無拡散」の担保 — 原子は隣どうしの関係を保ったまま一斉に動き、
 *     変形前の最近接 12 組が s = 1 で 8 組(最近接)+ 4 組(第 2 近接)に分かれる
 * T7(前半): 正方性 c/a = 1 + 0.045 C
 */

import { describe, expect, it } from "vitest";
import { A_ALPHA_NM } from "./constants";
import {
  BAIN_A_GAMMA_NM,
  BOND_IN_PLANE,
  BOND_OUT_OF_PLANE,
  bainStrain,
  bctParams,
  bondLengths,
  buildBainBlock,
  deformInto,
  martensiteLattice,
  tetragonality,
} from "./bain";

const block = buildBainBlock();

describe("T4: ベイン対応の格子定数とひずみ(§5.3)", () => {
  it("s = 0 で c/a = √2(面心立方の中の体心正方)、s = 1 で 1(体心立方)", () => {
    expect(bainStrain(0, false).cOverA).toBeCloseTo(Math.SQRT2, 12);
    expect(bainStrain(1, false).cOverA).toBeCloseTo(1, 12);
  });

  it("ベインひずみは c 方向 −20.2%、a 方向 +12.9%(表示桁で)", () => {
    const st = bainStrain(1, false);
    expect((st.epsC * 100).toFixed(1)).toBe("-20.2");
    expect((st.epsA * 100).toFixed(1)).toBe("12.9");
    expect(BAIN_A_GAMMA_NM).toBeCloseTo(0.359, 3);
  });

  it("s = 0 でひずみも体積変化も 0", () => {
    const st = bainStrain(0, false);
    expect(st.epsC).toBeCloseTo(0, 12);
    expect(st.epsA).toBeCloseTo(0, 12);
    expect(st.dVol).toBeCloseTo(0, 12);
  });

  it("炭素を入れると s = 1 で c/a = 1.036 の体心正方が残る", () => {
    expect(bainStrain(1, true).cOverA).toBeCloseTo(1.036, 3);
    const p = bctParams(1, true);
    expect(p.c / p.a).toBeCloseTo(tetragonality(0.8), 12);
  });
});

describe("T4: 原子の対応は連続で、入れ替わらない(無拡散)", () => {
  it("2×2×1 個分の原子は 38 個、中心の原子は 12 本の結合をすべて持つ", () => {
    expect(block.count).toBe(38);
    let n = 0;
    for (let k = 0; k < block.bonds.length; k += 2) {
      if (
        block.bonds[k] === block.center ||
        block.bonds[k + 1] === block.center
      )
        n++;
    }
    expect(n).toBe(12);
  });

  it("体心正方の 8 頂点は中心の原子の最近接で、いずれも傾いた結合", () => {
    const corners = new Set(Array.from(block.bctCorners));
    let tilted = 0;
    for (let k = 0; k < block.bonds.length; k += 2) {
      const i = block.bonds[k];
      const j = block.bonds[k + 1];
      const other = i === block.center ? j : j === block.center ? i : -1;
      if (other >= 0 && corners.has(other)) {
        expect(block.bondKind[k / 2]).toBe(BOND_OUT_OF_PLANE);
        tilted++;
      }
    }
    expect(tilted).toBe(8);
  });

  it("どの原子も、変形の各段階で最寄りの格子点を入れ替えない", () => {
    const steps = 100;
    const prev = new Float64Array(block.ref.length);
    const next = new Float64Array(block.ref.length);
    for (const carbon of [false, true]) {
      deformInto(block.ref, 0, carbon, prev);
      for (let k = 1; k <= steps; k++) {
        deformInto(block.ref, k / steps, carbon, next);
        for (let i = 0; i < block.count; i++) {
          // 前の段階の原子 i の位置に最も近い「次の段階の原子」は i 自身
          let best = -1;
          let bestD = Infinity;
          for (let j = 0; j < block.count; j++) {
            const dx = next[j * 3] - prev[i * 3];
            const dy = next[j * 3 + 1] - prev[i * 3 + 1];
            const dz = next[j * 3 + 2] - prev[i * 3 + 2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) {
              bestD = d;
              best = j;
            }
          }
          expect(best).toBe(i);
        }
        prev.set(next);
      }
    }
  });

  it("結合の長さは s に対して連続に変わる(付け替えがない)", () => {
    const pos = new Float64Array(block.ref.length);
    const lenAt = (s: number, k: number): number => {
      deformInto(block.ref, s, false, pos);
      const i = block.bonds[2 * k];
      const j = block.bonds[2 * k + 1];
      return Math.hypot(
        pos[j * 3] - pos[i * 3],
        pos[j * 3 + 1] - pos[i * 3 + 1],
        pos[j * 3 + 2] - pos[i * 3 + 2],
      );
    };
    const nb = block.bonds.length / 2;
    for (let k = 0; k < nb; k++) {
      for (let step = 0; step < 50; step++) {
        const d = Math.abs(lenAt((step + 1) / 50, k) - lenAt(step / 50, k));
        expect(d).toBeLessThan(0.01); // nm。1 段 2% の変形で 0.01 nm 未満
      }
    }
  });

  it("s = 1 で 12 本が (√3/2)a_α の 8 本と a_α の 4 本に分かれる", () => {
    const pos = new Float64Array(block.ref.length);
    deformInto(block.ref, 1, false, pos);
    const near: number[] = [];
    const far: number[] = [];
    for (let k = 0; k < block.bonds.length; k += 2) {
      const i = block.bonds[k];
      const j = block.bonds[k + 1];
      if (i !== block.center && j !== block.center) continue;
      const len = Math.hypot(
        pos[j * 3] - pos[i * 3],
        pos[j * 3 + 1] - pos[i * 3 + 1],
        pos[j * 3 + 2] - pos[i * 3 + 2],
      );
      if (block.bondKind[k / 2] === BOND_IN_PLANE) far.push(len);
      else near.push(len);
    }
    expect(near).toHaveLength(8);
    expect(far).toHaveLength(4);
    for (const l of near)
      expect(l).toBeCloseTo((Math.sqrt(3) / 2) * A_ALPHA_NM, 9);
    for (const l of far) expect(l).toBeCloseTo(A_ALPHA_NM, 9);
    const bl = bondLengths(1, false);
    expect(bl.outOfPlane).toBeCloseTo((Math.sqrt(3) / 2) * A_ALPHA_NM, 12);
    expect(bl.inPlane).toBeCloseTo(A_ALPHA_NM, 12);
  });

  it("s = 0 では 12 本とも面心立方の最近接距離 a_γ/√2", () => {
    const bl = bondLengths(0, false);
    expect(bl.inPlane).toBeCloseTo(BAIN_A_GAMMA_NM / Math.SQRT2, 12);
    expect(bl.outOfPlane).toBeCloseTo(BAIN_A_GAMMA_NM / Math.SQRT2, 12);
  });

  it("炭素の位置は面心立方の八面体位置(最寄りの鉄まで a_γ/2)", () => {
    const n = block.carbonSites.length / 3;
    expect(n).toBeGreaterThan(0);
    for (let c = 0; c < n; c++) {
      let best = Infinity;
      for (let i = 0; i < block.count; i++) {
        best = Math.min(
          best,
          Math.hypot(
            block.ref[i * 3] - block.carbonSites[c * 3],
            block.ref[i * 3 + 1] - block.carbonSites[c * 3 + 1],
            block.ref[i * 3 + 2] - block.carbonSites[c * 3 + 2],
          ),
        );
      }
      expect(best).toBeCloseTo(0.5, 9);
    }
  });
});

describe("T7: 正方性(§5.6)", () => {
  it("c/a = 1 + 0.045 C(0 C で 1.000、0.8 C で 1.036)", () => {
    expect(tetragonality(0).toFixed(3)).toBe("1.000");
    expect(tetragonality(0.8).toFixed(3)).toBe("1.036");
    for (const c of [0.2, 0.5, 1.2]) {
      expect(tetragonality(c)).toBeCloseTo(1 + 0.045 * c, 12);
    }
  });

  it("マルテンサイトの格子定数の比も同じ正方性になる", () => {
    const m = martensiteLattice(0.8);
    expect(m.c / m.a).toBeCloseTo(tetragonality(0.8), 12);
    expect(martensiteLattice(0).a).toBeCloseTo(A_ALPHA_NM, 12);
  });
});
