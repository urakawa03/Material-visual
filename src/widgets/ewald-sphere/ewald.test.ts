/**
 * ewald.test.ts — エヴァルト球の数理の単体テスト(仕様書 04 §5)
 *
 * 特に次の受け入れ基準をここで担保する。
 * - ブラッグ則とラウエ条件の等価性(§5.1)
 * - 弾性散乱の拘束と |Δk| = 2 sinθ/λ(§5.2)
 * - 球面判定・励起誤差・限界球(§5.3・§5.5)
 * - 存在則にもとづく粉末環と、2θ から測った d の一致(§5.6)
 * - 相対論補正込みの電子線波長とサジッタ(§5.7)
 */

import { describe, expect, it } from "vitest";
import { vec3 } from "../../core/mathx";
import {
  braggAngleDeg,
  cubicReciprocalPoints,
  dFromTwoThetaDeg,
  electronWavelengthNm,
  excitationError,
  lambdaForReflection,
  limitingRadius,
  powderRings,
  ringRadiusOverL,
  rotateOrientation,
  sagitta,
  scatteringVectorLength,
  twoThetaDeg,
  waveNumber,
} from "./ewald";

/** 記事全体で使う格子定数(§5.0) */
const A = 0.4;
/** Cu Kα(§5.1 の初期値) */
const CU_KA = 0.154;

describe("波数と球の半径(式 E1・E11)", () => {
  it("|k| = 1/λ、限界球は 2/λ", () => {
    expect(waveNumber(CU_KA)).toBeCloseTo(6.4935, 4);
    expect(limitingRadius(CU_KA)).toBeCloseTo(2 * waveNumber(CU_KA), 12);
  });
});

describe("ブラッグ則とラウエ条件の等価性(式 E2・E6・E7・E8)", () => {
  it("ブラッグ角では |Δk| = |g| = 1/d になる", () => {
    for (const d of [0.4, 0.2, 0.15, 0.12]) {
      const theta = braggAngleDeg(d, CU_KA);
      expect(theta).not.toBeNull();
      // |Δk| = 2 sinθ/λ が 1/d に一致する
      expect(scatteringVectorLength(theta as number, CU_KA)).toBeCloseTo(
        1 / d,
        10,
      );
    }
  });

  it("λ > 2d では解が存在しない(限界球の裏返し)", () => {
    // d = 0.07 nm、λ = 0.154 nm → λ > 2d
    expect(braggAngleDeg(0.07, CU_KA)).toBeNull();
    expect(twoThetaDeg(0.07, CU_KA)).toBeNull();
    // 限界球の条件 d ≥ λ/2 とちょうど同値
    expect(braggAngleDeg(CU_KA / 2, CU_KA)).toBeCloseTo(90, 6);
  });

  it("2θ から測り直した d が元の d に戻る(図6 の答え合わせ)", () => {
    for (const d of [0.4, 0.2828, 0.2309, 0.2]) {
      const tt = twoThetaDeg(d, CU_KA) as number;
      expect(dFromTwoThetaDeg(tt, CU_KA)).toBeCloseTo(d, 10);
    }
  });
});

describe("エヴァルト球面の判定(式 E9・E10・E12)", () => {
  const R = waveNumber(CU_KA);

  it("原点は常に球面上にある(s = 0)", () => {
    expect(excitationError(vec3(0, 0, 0), R)).toBeCloseTo(0, 12);
  });

  it("lambdaForReflection の波長では s = 0 になる", () => {
    // 逆格子点 (−1 1 0)/a は g_x < 0 なので、ある波長で球面に乗る
    const g = vec3(-1 / A, 1 / A, 0);
    const lambda = lambdaForReflection(g);
    expect(lambda).not.toBeNull();
    expect(excitationError(g, waveNumber(lambda as number))).toBeCloseTo(0, 10);
  });

  it("g_x ≥ 0 の点はどんな波長でも球面に乗らない", () => {
    expect(lambdaForReflection(vec3(1 / A, 0, 0))).toBeNull();
    expect(lambdaForReflection(vec3(0, 1 / A, 0))).toBeNull();
    expect(lambdaForReflection(vec3(0, 0, 0))).toBeNull();
  });

  it("球面上の点では |Δk| = |g| が成り立つ(ラウエ条件)", () => {
    const g = vec3(-1 / A, 1 / A, 0);
    const lambda = lambdaForReflection(g) as number;
    const R2 = waveNumber(lambda);
    // k = (R, 0, 0)、k' = k + g。弾性散乱なら |k'| = |k|
    const kx = R2 + g.x;
    expect(Math.hypot(kx, g.y, g.z)).toBeCloseTo(R2, 10);
    // そのときのブラッグ角は d = 1/|g| と整合する
    const gLen = Math.hypot(g.x, g.y, g.z);
    const theta = braggAngleDeg(1 / gLen, lambda) as number;
    expect(scatteringVectorLength(theta, lambda)).toBeCloseTo(gLen, 10);
  });

  it("初期状態(φ = χ = 0、λ = 0.154 nm)では 1 点も球面に乗らない", () => {
    // 図3 の受け入れ基準: 許容幅 1/t(t = 12 nm)で点灯 0 個
    const sMax = 1 / 12;
    const points = cubicReciprocalPoints("sc", A, 4);
    const lit = points.filter(
      (p) => p.n2 > 0 && Math.abs(excitationError(p.g, R)) <= sMax,
    );
    expect(lit).toHaveLength(0);
  });

  it("限界球の外の点はどの方位でも球面に乗らない", () => {
    const rLimit = limitingRadius(CU_KA);
    const outside = vec3(0, 0, rLimit * 1.2);
    const out = vec3();
    for (let deg = 0; deg < 360; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      rotateOrientation(out, outside, rad, 0.3);
      // 球面上なら s = 0。|g| > 2R では最小でも |g| − 2R > 0 の余りが残る
      expect(Math.abs(excitationError(out, R))).toBeGreaterThan(0);
    }
    // 解析的にも: |g| > 2R の点は λ を固定するかぎり条件を満たせない
    expect(Math.hypot(outside.x, outside.y, outside.z)).toBeGreaterThan(2 * R);
  });
});

describe("結晶方位の回転", () => {
  it("長さを保ち、φ = χ = 0 では恒等変換", () => {
    const g = vec3(2.5, -1.25, 0.75);
    const out = vec3();
    rotateOrientation(out, g, 0, 0);
    expect(out).toEqual(g);
    rotateOrientation(out, g, 0.7, -0.4);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(
      Math.hypot(g.x, g.y, g.z),
      12,
    );
  });

  it("R = R_z(χ)·R_y(φ) の順で適用される", () => {
    // φ = 90° は x 軸を −z へ、χ = 90° は x 軸を +y へ送る
    const out = vec3();
    rotateOrientation(out, vec3(1, 0, 0), Math.PI / 2, 0);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(-1, 12);
    rotateOrientation(out, vec3(1, 0, 0), 0, Math.PI / 2);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(1, 12);
  });
});

describe("逆格子点の列挙と存在則", () => {
  it("単純立方は全整数点、体心・面心は存在則どおりに間引かれる", () => {
    expect(cubicReciprocalPoints("sc", A, 2)).toHaveLength(5 ** 3);
    for (const p of cubicReciprocalPoints("bcc", A, 3)) {
      expect(Math.abs((p.h + p.k + p.l) % 2)).toBe(0);
    }
    for (const p of cubicReciprocalPoints("fcc", A, 3)) {
      const parity = [p.h, p.k, p.l].map((v) => Math.abs(v) % 2);
      expect(parity[0]).toBe(parity[1]);
      expect(parity[1]).toBe(parity[2]);
    }
  });

  it("座標と長さが (hkl)/a と整合する", () => {
    const p = cubicReciprocalPoints("sc", A, 2).find(
      (q) => q.h === 1 && q.k === 1 && q.l === 0,
    );
    expect(p).toBeDefined();
    expect(p?.g.x).toBeCloseTo(2.5, 12);
    expect(p?.len).toBeCloseTo(Math.SQRT2 / A, 12);
  });
});

describe("粉末法の環(式 E13・E16)", () => {
  it("単純立方の環は h²+k²+l² = 1, 2, 3, 4, … の順に並ぶ", () => {
    const rings = powderRings("sc", A, 4);
    expect(rings.slice(0, 5).map((r) => r.n2)).toEqual([1, 2, 3, 4, 5]);
    // (100) の多重度は 6、(110) は 12、(111) は 8
    expect(rings[0].multiplicity).toBe(6);
    expect(rings[1].multiplicity).toBe(12);
    expect(rings[2].multiplicity).toBe(8);
  });

  it("体心立方は n2 が偶数の環だけ、面心立方は 3, 4, 8, 11, 12, … の環だけ", () => {
    expect(
      powderRings("bcc", A, 4)
        .slice(0, 5)
        .map((r) => r.n2),
    ).toEqual([2, 4, 6, 8, 10]);
    expect(
      powderRings("fcc", A, 4)
        .slice(0, 5)
        .map((r) => r.n2),
    ).toEqual([3, 4, 8, 11, 12]);
  });

  it("環の d と |g| は互いに逆数で、2θ から測り直すと一致する", () => {
    for (const ring of powderRings("fcc", A, 3)) {
      expect(ring.d * ring.g).toBeCloseTo(1, 12);
      const tt = twoThetaDeg(ring.d, CU_KA);
      if (tt === null) continue; // λ > 2d の環は測れない
      expect(dFromTwoThetaDeg(tt, CU_KA)).toBeCloseTo(ring.d, 10);
      expect(ringRadiusOverL(tt)).toBeCloseTo(
        Math.tan((tt * Math.PI) / 180),
        12,
      );
    }
  });

  it("代表指数は |h| ≥ |k| ≥ |l| の非負の組になる", () => {
    for (const ring of powderRings("sc", A, 3)) {
      expect(ring.h).toBeGreaterThanOrEqual(ring.k);
      expect(ring.k).toBeGreaterThanOrEqual(ring.l);
      expect(ring.l).toBeGreaterThanOrEqual(0);
      expect(ring.h ** 2 + ring.k ** 2 + ring.l ** 2).toBe(ring.n2);
    }
  });
});

describe("電子線の波長とサジッタ(式 E14・E15)", () => {
  it("相対論補正込みの波長が実測値と一致する", () => {
    // 教科書値: 100 kV → 3.70 pm、200 kV → 2.51 pm、300 kV → 1.97 pm
    expect(electronWavelengthNm(100) * 1000).toBeCloseTo(3.701, 2);
    expect(electronWavelengthNm(200) * 1000).toBeCloseTo(2.508, 2);
    expect(electronWavelengthNm(300) * 1000).toBeCloseTo(1.969, 2);
  });

  it("相対論補正を落とすと 200 kV で約 9% ずれる(補正が必要な理由)", () => {
    const nonRelativistic = 1.226426 / Math.sqrt(200000); // nm(古典式)
    const ratio = nonRelativistic / electronWavelengthNm(200);
    expect(ratio).toBeGreaterThan(1.08);
    expect(ratio).toBeLessThan(1.1);
  });

  it("サジッタは Δ = R − √(R²−g²) で、短波長ほど平らになる", () => {
    const g = 5;
    const rX = waveNumber(CU_KA);
    const rE = waveNumber(electronWavelengthNm(200));
    expect(sagitta(rX, g)).toBeCloseTo(rX - Math.sqrt(rX * rX - g * g), 12);
    // Cu Kα では逆格子間隔(1/a = 2.5 nm⁻¹)と同程度、電子線では 2 桁小さい
    expect(sagitta(rX, g)).toBeGreaterThan(1.5);
    expect(sagitta(rE, g)).toBeLessThan(0.05);
    // 近似 Δ ≈ g²λ/2 は電子線側でよく効く
    expect(sagitta(rE, g)).toBeCloseTo(
      (g * g * electronWavelengthNm(200)) / 2,
      5,
    );
  });

  it("g が球の半径を超えたら定義域の端(R)を返す", () => {
    expect(sagitta(4, 5)).toBe(4);
  });
});
