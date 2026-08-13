/**
 * ewald.ts — エヴァルト球の数理(仕様書 04 §6.2 の式 E1〜E17 に対応する純粋関数群)
 *
 * 記事「エヴァルト球」の全図版が共有する計算をここに集約する。DOM・Canvas・
 * three.js に依存しない純粋関数のみを置き、単体テスト(ewald.test.ts)の
 * 対象とする。
 *
 * 慣習(仕様書 04 §2.3): 前提記事「逆格子空間」と同じ結晶学の慣習を採用する。
 * |k| = 1/λ、|g_hkl| = 1/d_hkl、エヴァルト球の半径 1/λ、限界球の半径 2/λ。
 * 2π は付けない。
 *
 * 座標系(§5.0): 逆空間 [nm⁻¹]。原点 O = 逆格子の 000。入射波は +x 方向に
 * 進むので k = (1/λ, 0, 0)、エヴァルト球の中心は C = −k = (−1/λ, 0, 0)。
 * 球は必ず原点を通る。
 */

import { vec3, type Vec3 } from "../../core/mathx";
import {
  dCubic,
  isAllowed,
  type CubicLattice,
} from "../reciprocal-lattice/lattice";

export type { CubicLattice };

/* ------------------------------------------------------------ 波と球の基本 */

/** 波数の大きさ |k| = 1/λ(式 E1)。λ [nm] → [nm⁻¹] */
export function waveNumber(lambdaNm: number): number {
  return 1 / lambdaNm;
}

/** 限界球の半径 2/λ(式 E11)。この外側の逆格子点は原理的に観測できない */
export function limitingRadius(lambdaNm: number): number {
  return 2 / lambdaNm;
}

/**
 * ブラッグ角 θ [度](式 E2: 2d sinθ = λ)。λ > 2d のとき解がないので null。
 */
export function braggAngleDeg(dNm: number, lambdaNm: number): number | null {
  const s = lambdaNm / (2 * dNm);
  if (s > 1) return null;
  return (Math.asin(s) * 180) / Math.PI;
}

/** 散乱ベクトルの大きさ |Δk| = 2 sinθ/λ(式 E6)。θ は度 */
export function scatteringVectorLength(
  thetaDeg: number,
  lambdaNm: number,
): number {
  return (2 * Math.sin((thetaDeg * Math.PI) / 180)) / lambdaNm;
}

/** 2θ [度] から面間隔 d を測る: d = λ/(2 sinθ)(式 E2 の変形。図6 の答え合わせ) */
export function dFromTwoThetaDeg(
  twoThetaDeg: number,
  lambdaNm: number,
): number {
  return lambdaNm / (2 * Math.sin((twoThetaDeg * Math.PI) / 360));
}

/**
 * 散乱角 2θ [度](図6 の環)。λ > 2d のとき条件を満たせないので null。
 */
export function twoThetaDeg(dNm: number, lambdaNm: number): number | null {
  const theta = braggAngleDeg(dNm, lambdaNm);
  return theta === null ? null : 2 * theta;
}

/**
 * 励起誤差 s = |g − C| − 1/λ(式 E12)。C = (−R, 0, 0)、R = 1/λ。
 * s = 0 が厳密な回折条件。厚さ t の結晶では |s| ≲ 1/t で回折が起きる。
 */
export function excitationError(g: Vec3, radius: number): number {
  const dx = g.x + radius;
  return Math.hypot(dx, g.y, g.z) - radius;
}

/**
 * 逆格子点 g がちょうど球面に乗る波長 λ_hkl(式 E17)。
 * 式 E10(|g|² + 2 k·g = 0)を λ について解いたもの: λ = −2 g_x/|g|²。
 * g_x ≥ 0 の点はどんな波長でも条件を満たせないので null を返す。
 */
export function lambdaForReflection(g: Vec3): number | null {
  const g2 = g.x * g.x + g.y * g.y + g.z * g.z;
  if (g2 === 0 || g.x >= 0) return null;
  return (-2 * g.x) / g2;
}

/**
 * 球面の落ち込み(サジッタ、式 E14)。半径 R の球面が、接平面上で原点から
 * g だけ離れた位置でどれだけ下がるか。Δ = R − √(R² − g²) ≈ g²λ/2。
 * g > R では球面が届かないので R を返す(定義域の端)。
 */
export function sagitta(radius: number, g: number): number {
  if (g >= radius) return radius;
  return radius - Math.sqrt(radius * radius - g * g);
}

/* ---------------------------------------------------------- 結晶方位の回転 */

/**
 * 結晶方位: 逆格子点を R = R_z(χ)·R_y(φ) で回す(§5.0)。角度はラジアン。
 * three.js 側では同じ順序のクォータニオン(q_z · q_y)で Group を回す。
 */
export function rotateOrientation(
  out: Vec3,
  g: Vec3,
  phi: number,
  chi: number,
): Vec3 {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const cc = Math.cos(chi);
  const sc = Math.sin(chi);
  // R_y(φ)
  const x1 = g.x * cp + g.z * sp;
  const y1 = g.y;
  const z1 = -g.x * sp + g.z * cp;
  // R_z(χ)
  out.x = x1 * cc - y1 * sc;
  out.y = x1 * sc + y1 * cc;
  out.z = z1;
  return out;
}

/* -------------------------------------------------------- 逆格子点の列挙 */

/** 立方格子の逆格子点 1 個(座標は nm⁻¹、結晶方位は未適用) */
export interface RecipPoint {
  h: number;
  k: number;
  l: number;
  /** 指数の二乗和 h²+k²+l²(環のグループ化に使う) */
  n2: number;
  /** 未回転の逆空間座標 (h, k, l)/a [nm⁻¹] */
  g: Vec3;
  /** |g| = √(h²+k²+l²)/a [nm⁻¹] */
  len: number;
}

/**
 * 立方格子(格子定数 a [nm])の逆格子点を |h|,|k|,|l| ≤ maxIndex の範囲で
 * 列挙する。存在則(`lattice.ts` の isAllowed)でフィルタする。000 も含む。
 */
export function cubicReciprocalPoints(
  lattice: CubicLattice,
  aNm: number,
  maxIndex: number,
): RecipPoint[] {
  const pts: RecipPoint[] = [];
  for (let h = -maxIndex; h <= maxIndex; h++) {
    for (let k = -maxIndex; k <= maxIndex; k++) {
      for (let l = -maxIndex; l <= maxIndex; l++) {
        if (!isAllowed(lattice, h, k, l)) continue;
        const n2 = h * h + k * k + l * l;
        pts.push({
          h,
          k,
          l,
          n2,
          g: vec3(h / aNm, k / aNm, l / aNm),
          len: Math.sqrt(n2) / aNm,
        });
      }
    }
  }
  return pts;
}

/* -------------------------------------------------- 点灯した反射の走査 */

export interface ReflectionScan {
  /** 全点の結晶方位適用後の座標([x0,y0,z0, x1,y1,z1, …]、nm⁻¹) */
  readonly rotated: Float64Array;
  /** 点灯した反射の points 内の添字(先頭 count 個が有効) */
  readonly indices: Int32Array;
  /** 点灯した反射の数 */
  readonly count: number;
  /**
   * 結晶方位 (φ, χ) を適用し、accept が true を返した点を「点灯」として
   * 集める。accept には回転後の座標と点の添字が渡される。
   * 毎フレーム呼ばれるので、新規割当てをしない(バッファを使い回す)。
   */
  update(
    phi: number,
    chi: number,
    accept: (x: number, y: number, z: number, index: number) => boolean,
  ): void;
}

/**
 * 逆格子点の集合に対して「いま球面に乗っている点」を毎フレーム求めるための
 * 走査器(§5.0 の性能規約: 1 フレームあたり O(N)、新規割当てなし)。
 */
export function createReflectionScan(
  points: readonly RecipPoint[],
): ReflectionScan {
  const n = points.length;
  const rotated = new Float64Array(n * 3);
  const indices = new Int32Array(n);
  const tmp = vec3();
  const scan = {
    rotated,
    indices,
    count: 0,
    update(
      phi: number,
      chi: number,
      accept: (x: number, y: number, z: number, index: number) => boolean,
    ): void {
      let lit = 0;
      for (let i = 0; i < n; i++) {
        rotateOrientation(tmp, points[i].g, phi, chi);
        rotated[i * 3] = tmp.x;
        rotated[i * 3 + 1] = tmp.y;
        rotated[i * 3 + 2] = tmp.z;
        if (accept(tmp.x, tmp.y, tmp.z, i)) indices[lit++] = i;
      }
      scan.count = lit;
    },
  };
  return scan;
}

/**
 * 走査結果のうち、原点 000 を除いて最も球面に近い点を返す(図3 の
 * 「最寄りの反射」表示と「いちばん近い反射に合わせる」に使う)。
 * 該当がなければ index = −1。
 */
export function nearestToSphere(
  scan: ReflectionScan,
  points: readonly RecipPoint[],
  radius: number,
): { index: number; s: number } {
  let best = -1;
  let bestAbs = Infinity;
  let bestS = 0;
  const g = vec3();
  for (let i = 0; i < points.length; i++) {
    if (points[i].n2 === 0) continue;
    g.x = scan.rotated[i * 3];
    g.y = scan.rotated[i * 3 + 1];
    g.z = scan.rotated[i * 3 + 2];
    const s = excitationError(g, radius);
    const abs = Math.abs(s);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = i;
      bestS = s;
    }
  }
  return { index: best, s: bestS };
}

/* ------------------------------------------------------------ 粉末法の環 */

/** デバイ・シェラー環 1 本(同じ h²+k²+l² をもつ反射をまとめたもの) */
export interface PowderRing {
  /** 指数の二乗和(環の並び順を決める) */
  n2: number;
  /** 代表の指数(|h| ≥ |k| ≥ |l| の非負の組) */
  h: number;
  k: number;
  l: number;
  /** 面間隔 d = a/√n2 [nm](式 E13) */
  d: number;
  /** |g| = 1/d [nm⁻¹] */
  g: number;
  /** 多重度(この環に寄与する反射の数) */
  multiplicity: number;
}

/**
 * 粉末回折の環を内側(小さい n2 = 大きい d)から順に返す。
 * 同じ h²+k²+l² をもつ反射は 1 本の環にまとまる(多重度)。
 * 強度は扱わない(仕様書 04 §5.6 の簡略化)。
 */
export function powderRings(
  lattice: CubicLattice,
  aNm: number,
  maxIndex: number,
): PowderRing[] {
  const byN2 = new Map<number, PowderRing>();
  for (let h = -maxIndex; h <= maxIndex; h++) {
    for (let k = -maxIndex; k <= maxIndex; k++) {
      for (let l = -maxIndex; l <= maxIndex; l++) {
        const n2 = h * h + k * k + l * l;
        if (n2 === 0) continue;
        if (!isAllowed(lattice, h, k, l)) continue;
        const existing = byN2.get(n2);
        if (existing) {
          existing.multiplicity++;
          continue;
        }
        // 代表は |h| ≥ |k| ≥ |l| の非負の組(慣用表記に合わせる)
        const sorted = [Math.abs(h), Math.abs(k), Math.abs(l)].sort(
          (p, q) => q - p,
        );
        byN2.set(n2, {
          n2,
          h: sorted[0],
          k: sorted[1],
          l: sorted[2],
          d: dCubic(sorted[0], sorted[1], sorted[2], aNm),
          g: Math.sqrt(n2) / aNm,
          multiplicity: 1,
        });
      }
    }
  }
  return [...byN2.values()].sort((p, q) => p.n2 - q.n2);
}

/** 検出器上の環の半径 / 試料〜検出器距離 L(式 E16: r = L tan 2θ) */
export function ringRadiusOverL(twoTheta: number): number {
  return Math.tan((twoTheta * Math.PI) / 180);
}

/* ---------------------------------------------------------- 電子線の波長 */

/** プランク定数 [J·s] */
const PLANCK = 6.62607015e-34;
/** 電子の静止質量 [kg] */
const ELECTRON_MASS = 9.1093837015e-31;
/** 電気素量 [C] */
const ELEMENTARY_CHARGE = 1.602176634e-19;
/** 光速 [m/s] */
const LIGHT_SPEED = 2.99792458e8;

/**
 * 電子線の波長 [nm](式 E15、相対論補正込み)。
 * λ = h / √(2 m_e e V (1 + eV/(2 m_e c²)))。V は加速電圧 [kV]。
 * 補正を落とすと 200 kV で 9% ずれるため、必ず補正込みで計算する。
 */
export function electronWavelengthNm(kV: number): number {
  const volts = kV * 1000;
  const eV = ELEMENTARY_CHARGE * volts;
  const restEnergy = ELECTRON_MASS * LIGHT_SPEED * LIGHT_SPEED;
  const denom = Math.sqrt(2 * ELECTRON_MASS * eV * (1 + eV / (2 * restEnergy)));
  return (PLANCK / denom) * 1e9;
}
