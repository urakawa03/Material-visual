/**
 * brillouin.test.ts — 第 1 ブリルアンゾーンの幾何の単体テスト(仕様書 11 §5.5)
 *
 * 図5 の立体が「FCC の逆格子(= BCC 配列)のウィグナー・ザイツ胞」に
 * なっていることを、格子点との距離関係から確かめる。
 */

import { describe, expect, it } from "vitest";
import {
  bzEdgePositions,
  bzFaces,
  bzVertices,
  fccReciprocalPoints,
  SYMMETRY_POINTS,
  type Vec3Lit,
} from "./brillouin";

const len = (v: Vec3Lit): number => Math.hypot(v.x, v.y, v.z);
const sub = (a: Vec3Lit, b: Vec3Lit): Vec3Lit => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

describe("切頂八面体の形", () => {
  it("頂点が 24 個あり、すべて原点から等距離", () => {
    const vs = bzVertices();
    expect(vs.length).toBe(24);
    for (const v of vs) {
      expect(len(v)).toBeCloseTo(Math.hypot(1, 0.5, 0), 12);
    }
  });

  it("面が 14 枚(正方形 6 + 六角形 8)", () => {
    const faces = bzFaces();
    expect(faces.length).toBe(14);
    expect(faces.filter((f) => f.length === 4).length).toBe(6);
    expect(faces.filter((f) => f.length === 6).length).toBe(8);
  });

  it("稜線は 36 本(オイラーの多面体定理 24 − 36 + 14 = 2)", () => {
    expect(bzEdgePositions().length / 6).toBe(36);
  });

  it("面の頂点は隣どうしが等間隔に並んでいる(扇状分割が破綻しない)", () => {
    for (const face of bzFaces()) {
      const edges = face.map((v, i) =>
        len(sub(face[(i + 1) % face.length], v)),
      );
      for (const e of edges) expect(e).toBeCloseTo(edges[0], 9);
    }
  });
});

describe("FCC の逆格子(BCC 配列)", () => {
  const points = fccReciprocalPoints(2);

  it("偶奇のそろった整数点だけを返す", () => {
    expect(points).toContainEqual({ x: 0, y: 0, z: 0 });
    expect(points).toContainEqual({ x: 1, y: 1, z: 1 });
    expect(points).toContainEqual({ x: 1, y: -1, z: 1 });
    expect(points).toContainEqual({ x: 2, y: 0, z: 0 });
    expect(points).not.toContainEqual({ x: 1, y: 1, z: 0 });
    expect(points).not.toContainEqual({ x: 1, y: 0, z: 0 });
    expect(points).not.toContainEqual({ x: 2, y: 1, z: 0 });
  });

  it("原点以外の格子点は第 1 ブリルアンゾーンの中に入らない", () => {
    // ウィグナー・ザイツ胞の定義: |k| < |k − G|(すべての G ≠ 0)
    const inside = (p: Vec3Lit): boolean =>
      points.every(
        (g) =>
          (g.x === 0 && g.y === 0 && g.z === 0) ||
          len(p) < len(sub(p, g)) - 1e-9,
      );
    for (const p of points) {
      const isOrigin = p.x === 0 && p.y === 0 && p.z === 0;
      expect(inside(p)).toBe(isOrigin);
    }
  });

  it("頂点 W は原点と 3 個の格子点から等距離(3 面が交わる)", () => {
    for (const v of bzVertices()) {
      const equidistant = points.filter(
        (g) =>
          !(g.x === 0 && g.y === 0 && g.z === 0) &&
          Math.abs(len(sub(v, g)) - len(v)) < 1e-9,
      );
      expect(equidistant.length).toBe(3);
    }
  });

  it("対称点 X・L は面の中心(格子点の中点)にある", () => {
    const x = SYMMETRY_POINTS.find((s) => s.label === "X");
    const l = SYMMETRY_POINTS.find((s) => s.label === "L");
    expect(x).toBeDefined();
    expect(l).toBeDefined();
    // X = (2,0,0)/2、L = (1,1,1)/2
    expect(x?.p).toEqual({ x: 1, y: 0, z: 0 });
    expect(l?.p).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
  });
});
