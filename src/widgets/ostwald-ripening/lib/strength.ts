/**
 * strength.ts — 間隔と強さのモデル(記事仕様書 03 §5.0。図1・7・8 で共用)
 *
 * 過時効側のみのモデル: 転位は粒子間を張り出して通り抜ける(オロワン機構)。
 * オロワン式は対数係数を落とした簡略形 Δτ = μb/L(§5.7 図注で明示)。
 * 切断機構(時効の登り側)は GP ゾーン記事(仕様書 07)が扱う。
 *
 * 式そのものは GPゾーン記事と共通なので `_shared/precipitate-strength.ts`
 * に置き、本モジュールは本記事の定数を束ねる薄いラッパとする
 * (GPゾーン仕様書 07 §5.0 の昇格方針)。
 */

import {
  orowanMPa as sharedOrowanMPa,
  spacingNm as sharedSpacingNm,
} from "../../_shared/precipitate-strength";
import {
  BETA,
  B_NM,
  F_VOLUME,
  K_REF_NM3S,
  MU_GPA,
  R0_MEDIAN_NM,
} from "./constants";

/** 粒子間隔 L = β r̄ / √f [nm] */
export function spacingNm(meanRNm: number, f: number = F_VOLUME): number {
  return sharedSpacingNm(meanRNm, f, BETA);
}

/** オロワン応力 Δτ = μb/L [MPa](簡略形) */
export function orowanMPa(
  meanRNm: number,
  muGPa: number = MU_GPA,
  bNm: number = B_NM,
  f: number = F_VOLUME,
): number {
  return sharedOrowanMPa(meanRNm, f, BETA, muGPa, bNm);
}

/** 表示強度のベースライン σ0 [MPa](母相の寄与のモデル値) */
export const SIGMA0_MPA = 50;

/**
 * 表示強度への変換係数 C。
 * t = 10³ s・200 °C(r̄ ≈ 6.0 nm)で表示強度 ≈ 350 MPa となるよう校正(§5.7)。
 */
export const STRENGTH_C =
  (350 - SIGMA0_MPA) /
  orowanMPa(Math.cbrt(R0_MEDIAN_NM ** 3 + K_REF_NM3S * 1e3));

/** 表示強度 [MPa] = σ0 + C·Δτ(r̄)(図1・7 で同一の校正を使う) */
export function displayStrengthMPa(meanRNm: number): number {
  return SIGMA0_MPA + STRENGTH_C * orowanMPa(meanRNm);
}
