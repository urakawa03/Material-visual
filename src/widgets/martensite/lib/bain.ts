/**
 * bain.ts — ベイン対応の格子(記事仕様書 10 §5.3)と正方性(§5.6)
 *
 * 面心立方(FCC)の慣用単位胞 2×2×1 個分の鉄原子を、変形量 s(0 → 1)で
 * 体心立方(BCC)へ連続に変形させる。FCC の中に埋まっている体心正方(BCT)の
 * 胞の格子定数を
 *   a(s) = (1 − s)·a_γ/√2 + s·a_end   (FCC の [110] 方向)
 *   c(s) = (1 − s)·a_γ     + s·c_end   (FCC の [001] 方向 = c 軸)
 * と線形に補間する(§5.3)。この変形は FCC の立方軸で対角
 * (x, y を √2·a(s)/a_γ 倍、z を c(s)/a_γ 倍)なので、全原子が同じ一次変換で
 * 一斉に動く。**原子の並び順・隣どうしの対応は変形の全過程で不変**
 * (無拡散変態 — プロンプト 10 の最重要の注意)。
 *
 * 座標の約束: 参照配置は a_γ = 1 の単位で、z が c 軸。中心の原子(BCT の
 * 体心)が原点に来るように平行移動してある。three.js の描画では z を上に向ける。
 *
 * 簡略化(図注): ベイン対応は格子の対応の説明であって、実際の原子の経路
 * そのものではない。実際の変態には格子不変せん断(すべり・双晶)が伴う(PTMC)。
 */

import { conventionalCellAtoms } from "../../reciprocal-lattice/lattice";
import {
  A_ALPHA_NM,
  A_MARTENSITE_PER_C_NM,
  C_EUTECTOID,
  TETRAGONALITY_PER_C,
  aGammaNm,
} from "./constants";

/** マルテンサイトの正方性 c/a = 1 + 0.045·C(式 E4) */
export function tetragonality(carbonWt: number): number {
  return 1 + TETRAGONALITY_PER_C * carbonWt;
}

/** マルテンサイト(体心正方)の格子定数 a, c [nm](炭素量 wt%) */
export function martensiteLattice(carbonWt: number): { a: number; c: number } {
  const a = A_ALPHA_NM - A_MARTENSITE_PER_C_NM * carbonWt;
  return { a, c: a * tetragonality(carbonWt) };
}

/** 図3 のオーステナイトの格子定数 [nm](共析鋼 0.8 C の値 = 0.359 nm) */
export const BAIN_A_GAMMA_NM = aGammaNm(C_EUTECTOID);

export interface BctParams {
  /** 体心正方の胞の a(底面の辺)[nm] */
  a: number;
  /** 体心正方の胞の c(縦の辺)[nm] */
  c: number;
}

/**
 * 変形量 s(0〜1)での体心正方の胞の格子定数(線形補間 — §5.3)。
 * carbon = false: 終点は体心立方(a = c = a_α)。
 * carbon = true: 終点は 0.8 C のマルテンサイト(c/a = 1.036)。
 */
export function bctParams(
  s: number,
  carbon: boolean,
  aGamma = BAIN_A_GAMMA_NM,
): BctParams {
  const end = carbon
    ? martensiteLattice(C_EUTECTOID)
    : { a: A_ALPHA_NM, c: A_ALPHA_NM };
  const a0 = aGamma / Math.SQRT2;
  const c0 = aGamma;
  return { a: a0 + (end.a - a0) * s, c: c0 + (end.c - c0) * s };
}

export interface BainStrain {
  /** c 方向(FCC の [001])のひずみ */
  epsC: number;
  /** a 方向(FCC の [110]・[100])のひずみ */
  epsA: number;
  /** 体心正方の胞の c/a */
  cOverA: number;
  /** 体積変化(1 原子あたりの体積の変化率) */
  dVol: number;
}

/** 変形量 s でのベインひずみと c/a・体積変化(式 E3。読み取り値) */
export function bainStrain(
  s: number,
  carbon: boolean,
  aGamma = BAIN_A_GAMMA_NM,
): BainStrain {
  const p = bctParams(s, carbon, aGamma);
  const fx = (Math.SQRT2 * p.a) / aGamma;
  const fz = p.c / aGamma;
  return {
    epsC: fz - 1,
    epsA: fx - 1,
    cOverA: p.c / p.a,
    dVol: fx * fx * fz - 1,
  };
}

/* ------------------------------------------------- 2×2×1 の原子と結合 */

/** 最近接の結合の種類 */
export const BOND_IN_PLANE = 0; // c 面内(FCC の ⟨110⟩ で z 成分 0)→ 第 2 近接になる
export const BOND_OUT_OF_PLANE = 1; // c 軸に傾いた結合 → 体心立方の最近接になる

export interface BainBlock {
  /** 原子数 */
  count: number;
  /** 参照配置(a_γ = 1 単位、[x0,y0,z0, x1,…])。中心の原子が原点 */
  ref: Float64Array;
  /** 中心の原子(体心正方の胞の体心)の添字。12 本の結合をすべて持つ */
  center: number;
  /** 体心正方の胞の 8 頂点の添字(下面 4 → 上面 4、周回順) */
  bctCorners: Int32Array;
  /** 変形前の最近接の組 [i0, j0, i1, j1, …] */
  bonds: Int32Array;
  /** 結合の種類(BOND_IN_PLANE / BOND_OUT_OF_PLANE) */
  bondKind: Uint8Array;
  /** 炭素を置く八面体位置(参照配置。体心正方の c 軸の稜の中点など) */
  carbonSites: Float64Array;
}

/** 座標比較の許容誤差(a_γ 単位) */
const EPS = 1e-6;
/** FCC の最近接距離の 2 乗(a_γ = 1 で (1/√2)² = 0.5) */
const NN_DIST2 = 0.5;

/**
 * FCC の慣用単位胞 2×2×1 個分の鉄原子と、変形前の最近接の結合表を作る
 * (§5.3)。原子位置は reciprocal-lattice/lattice.ts の conventionalCellAtoms
 * (2×2×2)の下半分を使う。
 */
export function buildBainBlock(): BainBlock {
  // 2×2×2(原点中心、各軸 −1〜1)の下半分 z ≤ 0 が 2×2×1 個分
  const all = conventionalCellAtoms("fcc", 2).filter((p) => p.z <= EPS);
  // 体心正方の胞の体心 = 高さの中ほど(z = −1/2)の面心の原子 (0, −1/2, −1/2)
  const cx = 0;
  const cy = -0.5;
  const cz = -0.5;
  const count = all.length;
  const ref = new Float64Array(count * 3);
  let center = -1;
  all.forEach((p, i) => {
    ref[i * 3] = p.x - cx;
    ref[i * 3 + 1] = p.y - cy;
    ref[i * 3 + 2] = p.z - cz;
    if (
      Math.abs(p.x - cx) < EPS &&
      Math.abs(p.y - cy) < EPS &&
      Math.abs(p.z - cz) < EPS
    ) {
      center = i;
    }
  });
  if (center < 0) throw new Error("buildBainBlock: 中心の原子が見つからない");

  const find = (x: number, y: number, z: number): number => {
    for (let i = 0; i < count; i++) {
      if (
        Math.abs(ref[i * 3] - x) < EPS &&
        Math.abs(ref[i * 3 + 1] - y) < EPS &&
        Math.abs(ref[i * 3 + 2] - z) < EPS
      ) {
        return i;
      }
    }
    throw new Error(`buildBainBlock: (${x}, ${y}, ${z}) に原子がない`);
  };

  // 体心正方の胞: 底面は FCC の [110]・[1−10] に沿う正方形(辺 a_γ/√2)
  const ring: ReadonlyArray<readonly [number, number]> = [
    [-0.5, 0],
    [0, -0.5],
    [0.5, 0],
    [0, 0.5],
  ];
  const bctCorners = new Int32Array(8);
  ring.forEach(([x, y], k) => {
    bctCorners[k] = find(x, y, -0.5);
    bctCorners[k + 4] = find(x, y, 0.5);
  });

  // 変形前の最近接の組(距離 a_γ/√2)
  const bondList: number[] = [];
  const kindList: number[] = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = ref[j * 3] - ref[i * 3];
      const dy = ref[j * 3 + 1] - ref[i * 3 + 1];
      const dz = ref[j * 3 + 2] - ref[i * 3 + 2];
      if (Math.abs(dx * dx + dy * dy + dz * dz - NN_DIST2) < EPS) {
        bondList.push(i, j);
        kindList.push(Math.abs(dz) < EPS ? BOND_IN_PLANE : BOND_OUT_OF_PLANE);
      }
    }
  }

  // 炭素: 体心正方の c 軸の稜の中点(FCC の八面体位置)のうち 2 か所と、
  // 隣の FCC 胞の体心(これも八面体位置)の 1 か所
  const carbonSites = new Float64Array([0.5, 0, 0, -0.5, 0, 0, 0.5, 1, 0]);

  return {
    count,
    ref,
    center,
    bctCorners,
    bonds: Int32Array.from(bondList),
    bondKind: Uint8Array.from(kindList),
    carbonSites,
  };
}

/**
 * 参照配置(a_γ = 1 単位)を変形量 s の配置 [nm] に写す(一次変換)。
 * out は src と同じ長さ。毎フレームの割当てを避けるため書き込み先を渡す。
 */
export function deformInto(
  src: Float64Array,
  s: number,
  carbon: boolean,
  out: Float64Array,
  aGamma = BAIN_A_GAMMA_NM,
): void {
  const p = bctParams(s, carbon, aGamma);
  const fx = Math.SQRT2 * p.a;
  const fz = p.c;
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i] * fx;
    out[i + 1] = src[i + 1] * fx;
    out[i + 2] = src[i + 2] * fz;
  }
}

/**
 * 変形量 s での結合の長さ [nm](種類ごと)。
 * c 面内の 4 本は a(s)、傾いた 8 本は √(a²/2 + c²/4)。
 * s = 1(炭素なし)で a_α(第 2 近接)と (√3/2)a_α(最近接)になる。
 */
export function bondLengths(
  s: number,
  carbon: boolean,
  aGamma = BAIN_A_GAMMA_NM,
): { inPlane: number; outOfPlane: number } {
  const p = bctParams(s, carbon, aGamma);
  return {
    inPlane: p.a,
    outOfPlane: Math.sqrt((p.a * p.a) / 2 + (p.c * p.c) / 4),
  };
}
