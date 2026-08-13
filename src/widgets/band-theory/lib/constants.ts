/**
 * constants.ts — 記事「バンド理論」の物理定数と既定値(仕様書 11 §2.3)
 *
 * 単位系: エネルギー eV / 長さ nm / 波数 nm⁻¹。
 * 本記事は物理学の慣習(k = 2π/λ)を採用する。逆格子空間記事(結晶学の
 * 慣習 q = 1/λ)との対応は k = 2πq、G = 2πg で、仕様書 11 §2.3 の対応表を
 * 記事本文にも載せている。
 */

/**
 * ħ²/(2mₑ) [eV·nm²]。E = ħ²k²/2m を eV と nm⁻¹ で書くための唯一の定数。
 * ħ = 1.054572e-34 J·s、mₑ = 9.109384e-31 kg、1 eV = 1.602177e-19 J から
 * ħ²/(2mₑ) = 6.104e-39 J·m² = 0.0380998 eV·nm²。
 */
export const HBAR2_OVER_2M = 0.0380998;

/** ボルツマン定数 [eV/K] */
export const KB_EV = 8.617333e-5;

/** 室温 [K](図6 の「熱で飛び越える割合」の目安に使う) */
export const ROOM_TEMPERATURE = 300;

/** 既定の格子周期 [nm]。ゾーン境界 π/a = 6.28 nm⁻¹、そこでの自由電子 1.50 eV */
export const DEFAULT_A = 0.5;
/** 既定の障壁幅 [nm] */
export const DEFAULT_B = 0.15;
/** 既定の障壁高さ [eV] */
export const DEFAULT_U0 = 4;

/** 自由電子のエネルギー E = ħ²k²/2m [eV](k は nm⁻¹ — 式 E1) */
export function freeElectronEnergy(k: number): number {
  return HBAR2_OVER_2M * k * k;
}

/**
 * 1 次元自由電子気体のフェルミ波数 [nm⁻¹](式 E2)。
 * k 空間の 1 状態あたり 2π/L、スピン 2 重で n = 2k_F/π。
 */
export function fermiWavenumber(density: number): number {
  return (Math.PI * density) / 2;
}
