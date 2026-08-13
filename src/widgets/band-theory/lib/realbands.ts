/**
 * realbands.ts — 図7「本物のバンド図」の模式バンド(仕様書 11 §5.7)
 *
 * ここで作る曲線は **模式** である(第一原理計算の結果ではない)。次の 2 つ
 * だけを実測値に合わせ、それ以外の形は読みやすさのために単純化している:
 *
 *   1. バンド端のエネルギー(バンドギャップ E_g と伝導帯の底の位置)
 *   2. バンド端の曲率 = 有効質量 m* = ħ² / (d²E/dk²)(式 E11)
 *
 * 1 本の枝(Branch)は「極値のまわりの余弦 + 遠方の平坦域」で表す:
 *
 *   E(k) = E_edge + s·Δ·(1 − cos(π·u)),  u = min(|k − k_edge| / W, 1)
 *   W = π·√(Δ·(m* / m) / (2C)),  C = ħ²/2m
 *
 * このとき極値での 2 階微分は s·2C / (m* / m) となり、m* が設計値に一致する
 * (単体テストで確認する)。s = +1 が伝導帯、s = −1 が価電子帯で、価電子帯の
 * 頂上では曲率が負 = **負の有効質量**になる(S7 の話題)。
 */

import { HBAR2_OVER_2M } from "./constants";

export interface Branch {
  /** 極値の波数 [nm⁻¹](パス上の符号付き k。+ が Γ→X 方向) */
  kEdge: number;
  /** 極値のエネルギー [eV](価電子帯の頂上を 0 に取る) */
  eEdge: number;
  /** 極値から平坦域までのエネルギー差 [eV] */
  rise: number;
  /** 有効質量比 m* / m(正の値。符号は sign が持つ) */
  mr: number;
  /** +1 = 下に凸(伝導帯)、−1 = 上に凸(価電子帯) */
  sign: 1 | -1;
}

export interface Material {
  key: "GaAs" | "Si";
  label: string;
  /** 格子定数 [nm](対称点の位置に使う) */
  a: number;
  /** バンドギャップ [eV](実測値) */
  eg: number;
  /** 直接遷移か */
  direct: boolean;
  conduction: Branch;
  valence: Branch;
  /** 出典・注記(図注と読み取りに使う) */
  note: string;
}

/** 枝の余弦部分の幅 W [nm⁻¹]。極値の曲率が m* に一致するように決まる */
export function branchWidth(br: Branch): number {
  const delta = br.rise / 2;
  return Math.PI * Math.sqrt((delta * br.mr) / (2 * HBAR2_OVER_2M));
}

/** 枝のエネルギー [eV] */
export function branchEnergy(k: number, br: Branch): number {
  const delta = br.rise / 2;
  const w = branchWidth(br);
  const u = Math.min(Math.abs(k - br.kEdge) / w, 1);
  return br.eEdge + br.sign * delta * (1 - Math.cos(Math.PI * u));
}

/**
 * 極値での数値 2 階微分から求めた有効質量比 m* / m。
 * 図の曲率と読み取り値が必ず一致することを保証する(§5.7 受け入れ基準)。
 */
export function effectiveMassRatio(br: Branch): number {
  const h = branchWidth(br) / 200;
  const e0 = branchEnergy(br.kEdge, br);
  const ep = branchEnergy(br.kEdge + h, br);
  const em = branchEnergy(br.kEdge - h, br);
  const second = (ep - 2 * e0 + em) / (h * h);
  return (2 * HBAR2_OVER_2M) / Math.abs(second);
}

/** 対称点 X の波数 [nm⁻¹](立方晶: 2π/a) */
export function kX(m: Material): number {
  return (2 * Math.PI) / m.a;
}

/** 対称点 L の波数 [nm⁻¹](立方晶: √3·π/a。パス上では負の向きに取る) */
export function kL(m: Material): number {
  return (Math.sqrt(3) * Math.PI) / m.a;
}

/**
 * パス座標 t(−1 = L、0 = Γ、+1 = X)を実際の波数 [nm⁻¹] に写す。
 * L 側と X side で Γ からの距離が違うので、区間ごとに倍率を変える。
 */
export function pathToK(t: number, m: Material): number {
  return t >= 0 ? t * kX(m) : t * kL(m);
}

/** 伝導帯の底のパス座標 t(Si は Γ→X 上の X 寄り) */
export function conductionMinimumT(m: Material): number {
  return m.conduction.kEdge / kX(m);
}

/** Si の伝導帯の底の位置(Γ→X 上の割合。実測に近い 0.85) */
const SI_VALLEY_FRACTION = 0.85;

const SI_A = 0.5431;
const GAAS_A = 0.5653;

/**
 * 材料の一覧(数値は Sze & Ng, *Physics of Semiconductor Devices* ほかの
 * 標準的な室温値)。伝導帯・価電子帯とも 1 本ずつに簡略化しており、
 * 縮退・スピン軌道分裂・複数の谷は描かない(図注に明示)。
 */
export const MATERIALS: readonly Material[] = [
  {
    key: "GaAs",
    label: "GaAs(ヒ化ガリウム)",
    a: GAAS_A,
    eg: 1.42,
    direct: true,
    conduction: { kEdge: 0, eEdge: 1.42, rise: 2.0, mr: 0.067, sign: 1 },
    valence: { kEdge: 0, eEdge: 0, rise: 3.0, mr: 0.51, sign: -1 },
    note: "伝導帯の底と価電子帯の頂上がどちらも Γ 点にある(直接遷移)",
  },
  {
    key: "Si",
    label: "Si(シリコン)",
    a: SI_A,
    eg: 1.12,
    direct: false,
    conduction: {
      kEdge: (SI_VALLEY_FRACTION * 2 * Math.PI) / SI_A,
      eEdge: 1.12,
      rise: 2.28,
      mr: 0.26,
      sign: 1,
    },
    valence: { kEdge: 0, eEdge: 0, rise: 3.0, mr: 0.49, sign: -1 },
    note: "伝導帯の底が Γ→X 上の X 寄りにあり、頂上と k がずれる(間接遷移)",
  },
] as const;

export function getMaterial(key: Material["key"]): Material {
  const m = MATERIALS.find((x) => x.key === key);
  if (!m) throw new Error(`未定義の材料: ${key}`);
  return m;
}
