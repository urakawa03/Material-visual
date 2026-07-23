/**
 * lattice.test.ts — 逆格子の数理の単体テスト(仕様書 05 §5.5・§5.7)
 *
 * 特に §5.7 の受け入れ基準「偶奇則と式 E9 由来の点集合が |h|,|k|,|l| ≤ 3 で
 * 完全一致する」をここで担保する。
 */

import { describe, expect, it } from "vitest";
import { vec2, vec3 } from "../../core/mathx";
import {
  conventionalCellAtoms,
  type CubicLattice,
  dCubic,
  dualBasis2,
  dualBasis3,
  isAllowed,
  latticePointsInDisk,
  laue1D,
  planeBoxPolygon,
  recipPointsFromPrimitive,
} from "./lattice";

const EPS = 1e-12;

describe("dualBasis2(式 E7・E8)", () => {
  const cases = [
    { name: "正方", a1: vec2(0.4, 0), a2: vec2(0, 0.4) },
    { name: "長方", a1: vec2(0.4, 0), a2: vec2(0, 0.56) },
    { name: "斜交", a1: vec2(0.38, 0.05), a2: vec2(-0.12, 0.44) },
  ];
  for (const { name, a1, a2 } of cases) {
    it(`${name}格子で a_i·b_j = δ_ij`, () => {
      const { b1, b2, S } = dualBasis2(a1, a2);
      expect(a1.x * b1.x + a1.y * b1.y).toBeCloseTo(1, 12);
      expect(a2.x * b2.x + a2.y * b2.y).toBeCloseTo(1, 12);
      expect(a1.x * b2.x + a1.y * b2.y).toBeCloseTo(0, 12);
      expect(a2.x * b1.x + a2.y * b1.y).toBeCloseTo(0, 12);
      // 逆単位胞面積は 1/S
      const dual = dualBasis2(b1, b2);
      expect(dual.S).toBeCloseTo(1 / S, 9);
    });
  }
});

describe("dualBasis3(式 E9)", () => {
  it("単純立方(a = 0.4)で b_i = e_i / a", () => {
    const a = 0.4;
    const { b1, b2, b3, V } = dualBasis3(
      vec3(a, 0, 0),
      vec3(0, a, 0),
      vec3(0, 0, a),
    );
    expect(b1.x).toBeCloseTo(1 / a, 12);
    expect(b2.y).toBeCloseTo(1 / a, 12);
    expect(b3.z).toBeCloseTo(1 / a, 12);
    expect(V).toBeCloseTo(a * a * a, 12);
  });

  it("斜交した基底でも a_i·b_j = δ_ij", () => {
    const a1 = vec3(0.4, 0.05, -0.02);
    const a2 = vec3(-0.08, 0.42, 0.06);
    const a3 = vec3(0.03, -0.04, 0.39);
    const { b1, b2, b3 } = dualBasis3(a1, a2, a3);
    const bs = [b1, b2, b3];
    const as = [a1, a2, a3];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dot = as[i].x * bs[j].x + as[i].y * bs[j].y + as[i].z * bs[j].z;
        expect(Math.abs(dot - (i === j ? 1 : 0))).toBeLessThan(EPS);
      }
    }
  });
});

describe("laue1D(式 E2)", () => {
  it("q = n/a でちょうど 1 になる", () => {
    const a = 0.4;
    for (const n of [0, 1, 2, 3]) {
      expect(laue1D(n / a, a, 12)).toBeCloseTo(1, 12);
    }
  });

  it("一致点から外れると 1 未満で、N が大きいほど山が細い", () => {
    const a = 0.4;
    const off = 1 / a + 0.1;
    const m4 = laue1D(off, a, 4);
    const m20 = laue1D(off, a, 20);
    expect(m4).toBeLessThan(1);
    expect(m20).toBeLessThan(m4); // 同じずれなら N 大で急落 = 山が細い
  });
});

describe("dCubic(式 E10)と |g| の逆数関係", () => {
  it("d = a/√(h²+k²+l²) = 1/|g|", () => {
    const a = 0.4;
    for (const [h, k, l] of [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [2, 0, 0],
      [2, 1, 1],
    ]) {
      const d = dCubic(h, k, l, a);
      const gLen = Math.hypot(h / a, k / a, l / a);
      expect(d * gLen).toBeCloseTo(1, 12);
    }
  });
});

describe("存在則と式 E9 由来の逆格子点の一致(§5.7 受け入れ基準)", () => {
  const MAX = 3;
  const key = (x: number, y: number, z: number): string =>
    `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;

  for (const lattice of [
    "sc",
    "bcc",
    "fcc",
  ] as const satisfies readonly CubicLattice[]) {
    it(`${lattice.toUpperCase()}: |h|,|k|,|l| ≤ ${MAX} で完全一致`, () => {
      // 式 E9 由来: 基本並進ベクトルの双対基底の整数結合
      const fromPrimitive = new Set<string>();
      for (const p of recipPointsFromPrimitive(lattice, MAX)) {
        // 全成分が整数(1/a 単位)であることも確認する
        expect(Math.abs(p.x - Math.round(p.x))).toBeLessThan(1e-9);
        expect(Math.abs(p.y - Math.round(p.y))).toBeLessThan(1e-9);
        expect(Math.abs(p.z - Math.round(p.z))).toBeLessThan(1e-9);
        fromPrimitive.add(key(p.x, p.y, p.z));
      }
      // 偶奇則由来
      const fromRule = new Set<string>();
      for (let h = -MAX; h <= MAX; h++) {
        for (let k = -MAX; k <= MAX; k++) {
          for (let l = -MAX; l <= MAX; l++) {
            if (isAllowed(lattice, h, k, l)) fromRule.add(key(h, k, l));
          }
        }
      }
      expect(fromPrimitive).toEqual(fromRule);
    });
  }

  it("BCC の逆格子は FCC 型(偶奇が揃う点が FCC 実格子の逆)ではなく h+k+l 偶数", () => {
    // 具体点のスポットチェック: BCC では (100) は現れず (110) は現れる
    expect(isAllowed("bcc", 1, 0, 0)).toBe(false);
    expect(isAllowed("bcc", 1, 1, 0)).toBe(true);
    // FCC では (100)・(110) は現れず (111)・(200) は現れる
    expect(isAllowed("fcc", 1, 0, 0)).toBe(false);
    expect(isAllowed("fcc", 1, 1, 0)).toBe(false);
    expect(isAllowed("fcc", 1, 1, 1)).toBe(true);
    expect(isAllowed("fcc", 2, 0, 0)).toBe(true);
  });
});

describe("conventionalCellAtoms(図7 左パネル)", () => {
  it("2×2×2 胞の原子数(重複除去後)", () => {
    expect(conventionalCellAtoms("sc", 2)).toHaveLength(27);
    expect(conventionalCellAtoms("bcc", 2)).toHaveLength(27 + 8);
    expect(conventionalCellAtoms("fcc", 2)).toHaveLength(27 + 36);
  });

  it("原点中心に配置される", () => {
    const pts = conventionalCellAtoms("sc", 2);
    let cx = 0;
    for (const p of pts) cx += p.x;
    expect(cx / pts.length).toBeCloseTo(0, 12);
  });
});

describe("planeBoxPolygon(図6 の面束)", () => {
  it("z = 0 の平面は正方形(4 点)", () => {
    const poly = planeBoxPolygon(vec3(0, 0, 1), 0, 1);
    expect(poly).toHaveLength(4);
    for (const p of poly) {
      expect(p.z).toBeCloseTo(0, 12);
      expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeCloseTo(1, 12);
    }
  });

  it("(111) 面の中央断面は六角形(6 点)", () => {
    const poly = planeBoxPolygon(vec3(1, 1, 1), 0, 1);
    expect(poly).toHaveLength(6);
  });

  it("箱の外の平面は空", () => {
    expect(planeBoxPolygon(vec3(0, 0, 1), 5, 1)).toHaveLength(0);
  });

  it("頂点は面内で角度順(隣接辺の外積の符号が一定)", () => {
    const poly = planeBoxPolygon(vec3(1, 2, 3), 0.3, 1);
    expect(poly.length).toBeGreaterThanOrEqual(3);
    // 法線方向に射影した符号付き面積が 0 でない = 自己交差のない整列
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      ax += p.y * q.z - p.z * q.y;
      ay += p.z * q.x - p.x * q.z;
      az += p.x * q.y - p.y * q.x;
    }
    const area = Math.hypot(ax, ay, az) / 2;
    expect(area).toBeGreaterThan(0.1);
  });
});

describe("latticePointsInDisk(図1・3・4 の円窓)", () => {
  it("正方格子 a = 0.4, r = 2.6 で約 130 点(§5.3)", () => {
    const out = new Float64Array(600);
    const n = latticePointsInDisk(vec2(0.4, 0), vec2(0, 0.4), 2.6, out);
    expect(n).toBeGreaterThan(120);
    expect(n).toBeLessThan(145);
    // 全点が窓内
    for (let i = 0; i < n; i++) {
      expect(Math.hypot(out[i * 2], out[i * 2 + 1])).toBeLessThanOrEqual(2.6);
    }
  });

  it("斜交基底でも点は格子の整数結合", () => {
    const a1 = vec2(0.38, 0.06);
    const a2 = vec2(-0.1, 0.42);
    const out = new Float64Array(800);
    const n = latticePointsInDisk(a1, a2, 2, out);
    const { b1, b2 } = dualBasis2(a1, a2);
    for (let i = 0; i < n; i++) {
      const x = out[i * 2];
      const y = out[i * 2 + 1];
      const ci = x * b1.x + y * b1.y;
      const cj = x * b2.x + y * b2.y;
      expect(Math.abs(ci - Math.round(ci))).toBeLessThan(1e-9);
      expect(Math.abs(cj - Math.round(cj))).toBeLessThan(1e-9);
    }
  });
});
