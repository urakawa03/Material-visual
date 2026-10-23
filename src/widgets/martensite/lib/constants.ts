/**
 * constants.ts — マルテンサイト変態記事の数値(記事仕様書 10 §2.3・§5.0)
 *
 * 記事の数値はすべてこのファイルに 1 箇所だけ置く(図版にマジックナンバーを
 * 置かない)。モデル材料は共析鋼(Fe–0.8 wt% C の普通炭素鋼)。
 *
 * 単位の約束(§2.3): 温度は ℃ で持ち、物理式の中だけ K に直す。時間は秒
 * (焼戻しのみ時間 [h])、炭素量は質量% C、長さは nm、硬さはビッカース HV。
 *
 * 出典(「もっと知るには」に掲載):
 * - [Callister] W. D. Callister & D. G. Rethwisch, Materials Science and
 *   Engineering: An Introduction, Wiley — Table 5.2(拡散データ)
 * - [Roberts] C. S. Roberts, "Effect of carbon on the lattice parameters of
 *   martensite", Trans. AIME 197 (1953) 203 — オーステナイト・マルテンサイトの
 *   格子定数と炭素量の関係
 * - [vanBohemen] S. M. C. van Bohemen, "Bainite and martensite start
 *   temperature calculated with exponential carbon dependence", Mater. Sci.
 *   Technol. 28 (2012) 487–495
 * - [KM] D. P. Koistinen & R. E. Marburger, Acta Metall. 7 (1959) 59
 * - [Krauss] G. Krauss, "Martensite in steel: strength and structure",
 *   Mater. Sci. Eng. A 273–275 (1999) 40–57 / G. Krauss, Steels: Processing,
 *   Structure, and Performance, ASM International
 * - [HJ] J. H. Hollomon & L. D. Jaffe, Trans. AIME 162 (1945) 223
 */

import { KELVIN_OFFSET, R_GAS } from "../../../core/units";

export { KELVIN_OFFSET, R_GAS };

/** ℃ → K */
export function toK(celsius: number): number {
  return celsius + KELVIN_OFFSET;
}

/** K → ℃ */
export function toC(kelvin: number): number {
  return kelvin - KELVIN_OFFSET;
}

/* ------------------------------------------------------- 鋼と熱処理の条件 */

/** 共析温度 A₁ [℃](Fe–C 状態図) */
export const A1_C = 727;
/** 共析鋼の炭素量 [wt%](図1・図2・図4・図7 の既定) */
export const C_EUTECTOID = 0.8;
/** 焼入れの出発温度(オーステナイト化温度)[℃](§5.0) */
export const T_AUSTENITIZE_C = 850;
/** 冷媒・室温 [℃](ニュートン冷却の行き着く先 — §5.0) */
export const T_ENV_C = 25;
/** 室温 [℃](残留オーステナイトを数える温度。図4・図6) */
export const T_ROOM_C = 25;

/* ------------------------------------------------- 炭素の拡散(§2.3 の表) */

/**
 * オーステナイト(γ-Fe)中の炭素の拡散 D = D₀ exp(−Q/RT)。
 * 出典: [Callister] Table 5.2(C in γ-Fe: D₀ = 2.3 × 10⁻⁵ m²/s、
 * Q_d = 148 kJ/mol)。図1 の C 曲線の拡散の項と、図2 の跳躍頻度・
 * 動ける距離の両方に使う。
 */
export const D0_GAMMA_M2S = 2.3e-5;
export const Q_GAMMA_J_PER_MOL = 148e3;

/**
 * フェライト(α-Fe)中の炭素の拡散(本文の比較用)。
 * 出典: [Callister] Table 5.2(C in α-Fe: D₀ = 1.1 × 10⁻⁶ m²/s、
 * Q_d = 87 kJ/mol — 版により 87.4)。カーケンドール効果の記事の格子間拡散
 * (0.85 eV ≈ 82 kJ/mol)と同程度。
 */
export const D0_ALPHA_M2S = 1.1e-6;
export const Q_ALPHA_J_PER_MOL = 87e3;

/**
 * 跳躍の試行頻度 ν [1/s](図2 の Γ = ν e^{−Q/RT})。カーケンドール効果・
 * コットレル雰囲気の記事と同じ 10¹³ s⁻¹(格子振動の振動数の目安)。
 */
export const HOP_ATTEMPT_HZ = 1e13;

/* ------------------------------------------- C 曲線(パーライトの開始線) */

/** C 曲線の鼻の温度 [℃] と時間 [s](共析鋼の目安 — §2.3) */
export const NOSE_T_C = 550;
export const NOSE_TIME_S = 0.8;

/**
 * C 曲線の指数が この値を超えたら「変態は始まらない」(1/t_s = 0)とする
 * (§5.0。A₁ の近くで指数の引数が巨大になり、そのまま exp を計算すると
 * 浮動小数点のオーバーフローになる)。
 */
export const C_CURVE_EXP_CLAMP = 700;

/** 加算則の数値積分の温度刻み [K](§5.8 T1 の ±5 ℃ に十分細かい) */
export const SCHEIL_DT_K = 0.05;

/**
 * 図2 の「鼻のまわり」= C 曲線の開始時間がこの値より短い温度域
 * (パーライトが数秒でできはじめる温度域。共析鋼で約 420〜620 ℃)。
 */
export const FAST_PEARLITE_TIME_S = 10;

/* ------------------------------------------------------ 冷やし方(§5.0 表) */

export type CoolingId = "furnace" | "air" | "oil" | "water" | "brine";

export interface CoolingMedium {
  id: CoolingId;
  /** 表示名(segmented と棒グラフのラベル) */
  label: string;
  /** ニュートン冷却の時定数 τ [s] */
  tauS: number;
}

/** 冷やし方とその時定数(§5.0 の表。遅い順 = 棒グラフの並び順) */
export const COOLING_MEDIA: readonly CoolingMedium[] = [
  { id: "furnace", label: "炉", tauS: 3600 },
  { id: "air", label: "空気", tauS: 100 },
  { id: "oil", label: "油", tauS: 6 },
  { id: "water", label: "水", tauS: 0.6 },
  { id: "brine", label: "塩水", tauS: 0.3 },
];

export function coolingMedium(id: CoolingId): CoolingMedium {
  const m = COOLING_MEDIA.find((c) => c.id === id);
  if (!m) throw new Error(`未定義の冷やし方: ${id}`);
  return m;
}

/* --------------------------------------------------------- 格子定数(§2.3) */

/**
 * オーステナイトの格子定数 a_γ = 0.3555 + 0.0044·C [nm](C は wt%)。
 * 出典: [Roberts](a_γ = 3.555 + 0.044 p Å)。0.8 C で 0.359 nm。
 */
export const A_GAMMA_0_NM = 0.3555;
export const A_GAMMA_PER_C_NM = 0.0044;

export function aGammaNm(carbonWt: number): number {
  return A_GAMMA_0_NM + A_GAMMA_PER_C_NM * carbonWt;
}

/** フェライト(炭素のない体心立方の鉄)の格子定数 a_α [nm](室温) */
export const A_ALPHA_NM = 0.2866;

/**
 * マルテンサイトの正方性 c/a = 1 + 0.045·C(式 E4)。
 * 出典: [Roberts](c = a₀ + 0.0116 p、a = a₀ − 0.0013 p [nm] → c/a ≈ 1 +
 * 0.045 p)。実測に基づく経験式で、0.8 C で 1.036。
 */
export const TETRAGONALITY_PER_C = 0.045;
/** マルテンサイトの a 軸の炭素による縮み [nm / wt%]([Roberts]) */
export const A_MARTENSITE_PER_C_NM = 0.0013;

/* ---------------------------------------------------------- M_s と変態量 */

/**
 * M_s の式([vanBohemen] 式):
 *   M_s = 565 − (31 Mn + 13 Si + 10 Cr + 18 Ni + 12 Mo) − 600[1 − exp(−0.96 C)] [℃]
 * Andrews の線形式は高炭素側で合わないので使わない(§2.3)。炭素の項が
 * 指数関数なのは、高炭素側まで実測値に合わせるため(同論文の主題)。
 * 合金元素は普通炭素鋼の代表的な組成として Mn 0.70・Si 0.15 wt% とした。
 * 0.2/0.4/0.6/0.8/1.0/1.2 C で 437/350/279/220/171/131 ℃ になり、
 * 仕様書の目安(430/350/280/220/180/140 ℃)と 10 ℃ 以内で一致する。
 */
export const MS_BASE_C = 565;
export const MS_CARBON_SPAN_C = 600;
export const MS_CARBON_RATE = 0.96;
export const MS_MN_COEF = 31;
export const MS_SI_COEF = 13;
export const STEEL_MN_WT = 0.7;
export const STEEL_SI_WT = 0.15;

/** コイスティネン=マールブルガーの係数 [1/K]([KM]。式 E5) */
export const KM_RATE_PER_K = 0.011;

/** M_f の定義: マルテンサイト量がこの割合に達する温度(§2.3: 99%) */
export const MF_FRACTION = 0.99;

/* -------------------------------------- 比較用の拡散変態(図4 のアブラミ式) */

/** アブラミ指数 n(式 E6。§5.4) */
export const AVRAMI_N = 2.5;
/** C 曲線の「開始」に対応する変態量(TTT 図の慣習で 1%) */
export const START_FRACTION = 0.01;

/* ----------------------------------------------------------- 硬さ(§2.3) */

/**
 * 100% マルテンサイトの硬さ [HV] と炭素量 [wt%] の対応点(図6・図1)。
 * 値は仕様書 §2.3 の目安(0.1 ≈ 350、0.3 ≈ 510、0.5 ≈ 700、0.7 ≈ 820 HV、
 * それ以上はほぼ一定)に沿う。これは [Krauss] がまとめた焼入れままの Fe–C
 * マルテンサイトの硬さの実測(Litwinchuk ら 1976 ほか)の傾向 — 約 0.05〜
 * 0.5 C ではほぼ直線的に増え、0.6〜0.8 C で 800〜900 HV に達して頭打ち。
 * 0.3 C だけは目安の 510 ではなく 525 HV とした(0.1〜0.5 C を直線に
 * そろえ、補間曲線が S 字に波打たないようにするため。差は目安の幅の内)。
 * 炭素 0 の 160 HV は「炭素のない鉄は焼入れても硬くならない」(§3 の 6)を
 * 示すための外挿の目安(ラス組織の転位だけが残るぶん)。
 * 注意: 一次文献の図からの数値の読み直しは本実装では行えていない(目安)。
 */
export const MARTENSITE_HV_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 160],
  [0.1, 350],
  [0.3, 525],
  [0.5, 700],
  [0.7, 820],
  [1.2, 820],
];

/**
 * 徐冷(焼なまし)した鋼の硬さ [HV] の目安(図6 の細い線)。フェライト
 * (約 90 HV)とパーライトのてこの関係で 0.8 C まで増え、それ以上は
 * 初析セメンタイトでゆるやかに増える。0.8 C の 220 HV は図1 の炉冷と同じ値。
 */
export const SLOW_COOLED_HV_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 90],
  [0.2, 125],
  [0.4, 160],
  [0.6, 190],
  [0.8, 220],
  [1.0, 235],
  [1.2, 250],
];

/**
 * パーライトの硬さの目安(図1): 変態が始まった温度が低いほど縞が細かく
 * 硬い。縞の間隔 ∝ 1/ΔT(ΔT = A₁ − T、ツェナーの関係)と、硬さ ∝ 間隔^(−1/2)
 * (ホール・ペッチの方向感覚)から HV = a + b√ΔT とし、仕様書 §5.1 の 2 点
 * (632 ℃ で 220 HV、521 ℃ で 350 HV)を通るように a・b を決める。
 */
export const PEARLITE_HV_ANCHORS: readonly [
  readonly [number, number],
  readonly [number, number],
] = [
  [632, 220],
  [521, 350],
];

/* --------------------------------------------------------- 図5 の模式 */

/** マルテンサイトの板のせん断ひずみ γ(目安 — §5.5) */
export const PLATE_SHEAR = 0.2;
/** 交互の並び(自己調整)の板の枚数(偶数 = 全体のせん断が打ち消す) */
export const ALTERNATING_PLATES = 6;
/**
 * 板の近くだけに残るひずみエネルギーの重み(全体のせん断による遠くまで
 * 届く分を 1 としたとき)。模式の値(§5.5)。
 */
export const LOCAL_STRAIN_WEIGHT = 0.3;

/* --------------------------------------------------- 図7 焼戻し(§5.7) */

/** ホロモン・ジャッフェの定数(式 E7。t は時間 [h]) */
export const HJ_CONSTANT = 20;
/** 焼入れままの硬さ [HV](0.8 C のマルテンサイト = 図6 の表の値) */
export const HV_AS_QUENCHED = 820;
/** 十分に焼き戻したときの硬さ [HV](§5.7) */
export const HV_FULLY_TEMPERED = 250;
/** 硬さの模式曲線(シグモイド)の中心と幅(P の単位) */
export const TEMPER_HV_MID_P = 13500;
export const TEMPER_HV_WIDTH_P = 1500;
/** 靭性の模式曲線の中心と幅、焼入れままの値(相対 0〜1) */
export const TOUGH_MID_P = 13300;
export const TOUGH_WIDTH_P = 1700;
export const TOUGH_AS_QUENCHED = 0.08;
/**
 * 焼戻し脆性(tempered martensite embrittlement)のくぼみ: 1 時間の焼戻しで
 * 260〜370 ℃ 付近(P ≈ 1.1〜1.3 万)に置く模式(§5.7)。
 */
export const EMBRITTLE_P = 11900;
export const EMBRITTLE_WIDTH_P = 600;
export const EMBRITTLE_DEPTH = 0.16;

/** 焼戻しスライダーの範囲(§5.7) */
export const TEMPER_T_MIN_C = 100;
export const TEMPER_T_MAX_C = 700;
export const TEMPER_TIME_MIN_H = 0.01;
export const TEMPER_TIME_MAX_H = 100;
