/**
 * constants.ts — 記事「トンネル効果と STM」の物理定数と既定値(仕様書 14 §2.3)
 *
 * 単位系: エネルギー eV / 長さ nm(表面の凹凸だけ pm)/ 時間 fs(図1)・秒(図7)/
 * 電流 nA。ħ²/2mₑ と ħ は P0 の共通モジュール src/core/units.ts の値を使い、
 * 記事の中に同じ定数を二重に持たない(90 §3.1)。
 */

export { HBAR2_OVER_2ME, HBAR_EV_FS } from "../../../core/units";

/** 1 nm = 1000 pm(表面の凹凸の表示用) */
export const PM_PER_NM = 1000;

/* ------------------------------------------------- STM の真空の壁(図4・図5・図6) */

/**
 * 障壁の高さ = 探針と試料の仕事関数の平均 φ [eV]。
 * κ = √(2mφ)/ħ = 10.87 nm⁻¹、減衰長 1/κ = 92 pm、0.1 nm あたり 8.8 倍。
 */
export const WORK_FUNCTION_EV = 4.5;
/** 探針と試料の距離の既定値 = 電流の基準点 z_ref [nm] */
export const Z_REF_NM = 0.6;
/** z_ref(原子 1 個の真上 0.6 nm)での電流 I_ref [nA] */
export const I_REF_NA = 1;
/** 定電流モードの設定電流 [nA] */
export const I_SET_NA = 1;
/** バイアスの既定値 [V](図5。I ∝ V の換算の基準 V_ref) */
export const BIAS_REF_V = 0.5;

/* ------------------------------------------------------------- 表面(図5) */

/** 表面の原子間隔: 半導体の再構成表面ふうの模式 [nm] */
export const SPACING_SEMI_NM = 0.5;
/** 表面の原子間隔: 金属の最密面ふう [nm] */
export const SPACING_METAL_NM = 0.29;
/** 像の 1 辺の長さ [nm] と画素数 */
export const IMAGE_SIZE_NM = 3.2;
export const IMAGE_PIXELS = 64;
/** 吸着原子の高さ(表面の原子の中心から)[nm] */
export const ADATOM_HEIGHT_NM = 0.2;
/**
 * 欠陥(空孔・吸着原子)の位置を決める乱数のシード。0.5 nm の表面で
 * 空孔 (1.10, 1.10)・吸着原子 (1.85, 1.85)、0.29 nm の表面で
 * (0.88, 1.46)・(1.89, 1.31) nm になり、どちらも走査線の中央付近に来る
 */
export const SURFACE_SEED = 19;
/** 図5 の振動ノイズの乱数のシード */
export const NOISE_SEED = 11;

/* ---------------------------------------------- フラッシュメモリの壁(図7) */

/** Si/SiO₂ の伝導帯の段差(トンネル酸化膜の壁の高さ)[eV] */
export const SIO2_BARRIER_EV = 3.1;
/** SiO₂ の中の電子の有効質量(m* と m の比。κ = 5.85 nm⁻¹) */
export const SIO2_MASS_RATIO = 0.42;
/** 電子が壁に当たる頻度の桁の目安 ν [s⁻¹](τ = 1/(νT)) */
export const ATTEMPT_FREQUENCY_HZ = 1e14;
/** 1 MV/cm を V/nm(= qF を eV/nm で表した値)に直す係数 */
export const MV_PER_CM_TO_V_PER_NM = 0.1;
