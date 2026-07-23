/**
 * constants.ts — フランク・リード源テーマの物理定数(記事仕様書 02 §5.0)
 *
 * モデルはアルミニウムを想定。図5〜7 の内部計算は L = b = T = 1 の
 * 無次元単位で行い、表示のみここで物理値(MPa・μm・nm)へ換算する。
 */

import { TAU_C_SIM } from "./line";

/** 剛性率 μ = 26 GPa(Pa) */
export const MU_PA = 26e9;

/** ポアソン比 ν */
export const NU = 0.35;

/** 格子定数 a = 0.405 nm(FCC Al) */
export const A_NM = 0.405;

/** バーガースベクトルの大きさ b = a/√2 ≈ 0.286 nm */
export const B_NM = 0.286;

/** b(m 単位) */
export const B_M = B_NM * 1e-9;

/** 線張力 T ≈ μb²/2 ≈ 1.1×10⁻⁹ N(モデル値) */
export const T_LINE_N = 0.5 * MU_PA * B_M * B_M;

/** 理想強度の目安 τ_th ≈ μ/30 ≈ 0.9 GPa(桁の話として扱う) */
export const TAU_TH_MPA = MU_PA / 30 / 1e6;

/** 高純度 Al 単結晶の CRSS の目安(本文では「1 MPa 前後」) */
export const CRSS_MPA = 1;

/** 源の長さの既定値 L = 1 μm */
export const L_DEFAULT_UM = 1;

/**
 * 作動応力 τ_c = 2T/(bL) ≈ μb/L(MPa)。L は μm 単位。
 * L = 1 μm で約 7.4 MPa。
 */
export function tauCMPa(lUm: number): number {
  return (MU_PA * B_M) / (lUm * 1e-6) / 1e6;
}

/** 無次元応力(τ_c^sim = 2)→ 物理応力(MPa)への換算 */
export function simTauToMPa(tauSim: number, lUm: number): number {
  return (tauSim / TAU_C_SIM) * tauCMPa(lUm);
}

/** τ/τ_c(比)→ 物理応力(MPa) */
export function tauRatioToMPa(ratio: number, lUm: number): number {
  return ratio * tauCMPa(lUm);
}

/**
 * 転位間相互作用係数 K = μb/(2π(1−ν))(MPa·μm)。
 * 同一すべり面上の同符号刃状転位の反発応力 τ = K/Δx(Δx は μm)に使う(§5.7)。
 * 単位換算: Pa·m = MPa·μm(数値がそのまま一致する)。
 */
export const K_INTERACTION_MPA_UM = (MU_PA * B_M) / (2 * Math.PI * (1 - NU));
