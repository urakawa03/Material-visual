/**
 * tempering.ts — 焼戻し(記事仕様書 10 §5.7)
 *
 * ホロモン・ジャッフェのパラメータ P = T (20 + log₁₀ t)(式 E7。T は K、
 * t は時間 [h])と、硬さ・靭性の模式曲線。硬さは P の単調減少のシグモイドで、
 * 両端を焼入れまま(820 HV — 図6 の 0.8 C)と十分な焼戻し(250 HV)に合わせる。
 * 靭性は単調増加のシグモイドに、焼戻し脆性の小さなくぼみを重ねた模式。
 */

import {
  EMBRITTLE_DEPTH,
  EMBRITTLE_P,
  EMBRITTLE_WIDTH_P,
  HJ_CONSTANT,
  HV_AS_QUENCHED,
  HV_FULLY_TEMPERED,
  TEMPER_HV_MID_P,
  TEMPER_HV_WIDTH_P,
  TEMPER_TIME_MAX_H,
  TEMPER_TIME_MIN_H,
  TEMPER_T_MAX_C,
  TEMPER_T_MIN_C,
  TOUGH_AS_QUENCHED,
  TOUGH_MID_P,
  TOUGH_WIDTH_P,
  toC,
  toK,
} from "./constants";

/** ホロモン・ジャッフェのパラメータ P = T (20 + log₁₀ t)(T は ℃ で受け取る) */
export function hollomonJaffe(tempC: number, timeH: number): number {
  return toK(tempC) * (HJ_CONSTANT + Math.log10(timeH));
}

/** 温度 tempC で P に達する焼戻し時間 [h] */
export function timeForP(p: number, tempC: number): number {
  return 10 ** (p / toK(tempC) - HJ_CONSTANT);
}

/** 時間 timeH で P に達する焼戻し温度 [℃] */
export function tempForP(p: number, timeH: number): number {
  return toC(p / (HJ_CONSTANT + Math.log10(timeH)));
}

/** スライダーの範囲で取りうる P の最小値・最大値(100 ℃・0.01 h / 700 ℃・100 h) */
export const P_MIN = hollomonJaffe(TEMPER_T_MIN_C, TEMPER_TIME_MIN_H);
export const P_MAX = hollomonJaffe(TEMPER_T_MAX_C, TEMPER_TIME_MAX_H);

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

/** 硬さのシグモイド(正規化前) */
const hvRaw = (p: number): number =>
  logistic(-(p - TEMPER_HV_MID_P) / TEMPER_HV_WIDTH_P);
const HV_RAW_MIN = hvRaw(P_MIN);
const HV_RAW_MAX = hvRaw(P_MAX);

/**
 * 焼戻し後の硬さの目安 [HV](P の単調減少)。P_MIN で焼入れままの値、
 * P_MAX で十分に焼き戻した値にちょうど一致するよう正規化する。
 */
export function temperedHardness(p: number): number {
  const u = (hvRaw(p) - HV_RAW_MAX) / (HV_RAW_MIN - HV_RAW_MAX);
  return HV_FULLY_TEMPERED + (HV_AS_QUENCHED - HV_FULLY_TEMPERED) * u;
}

/**
 * 靭性の目安(相対値 0〜1、模式)。焼入れままは脆く、焼き戻すほど粘り強く
 * なる。1 時間の焼戻しで 260〜370 ℃ 付近に焼戻し脆性の小さなくぼみがある。
 */
export function toughness(p: number): number {
  const base =
    TOUGH_AS_QUENCHED +
    (1 - TOUGH_AS_QUENCHED) * logistic((p - TOUGH_MID_P) / TOUGH_WIDTH_P);
  const dip =
    EMBRITTLE_DEPTH * Math.exp(-(((p - EMBRITTLE_P) / EMBRITTLE_WIDTH_P) ** 2));
  return base - dip;
}

/**
 * 焼戻しの進み具合(0〜1)。硬さの下がり方に比例させる(図7 の組織の模式:
 * 0 で炭素は固溶したまま、1 で炭化物が十分に粗大化)。
 */
export function temperProgress(p: number): number {
  return (
    (HV_AS_QUENCHED - temperedHardness(p)) /
    (HV_AS_QUENCHED - HV_FULLY_TEMPERED)
  );
}
