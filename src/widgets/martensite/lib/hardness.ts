/**
 * hardness.ts — 硬さの目安(記事仕様書 10 §2.3・§5.1・§5.6)
 *
 * - 100% マルテンサイトの硬さと炭素量(実測の傾向に沿った表の単調補間)
 * - 徐冷した鋼の硬さ(図6 の参考線)
 * - パーライトの硬さと変態温度(図1。低い温度でできたものほど縞が細かく硬い)
 *
 * いずれも「目安」であり、図注でそう明示する(§5.0 共通規約)。
 */

import {
  A1_C,
  MARTENSITE_HV_TABLE,
  PEARLITE_HV_ANCHORS,
  SLOW_COOLED_HV_TABLE,
} from "./constants";
import { monotoneCubic } from "./interp";

const martensiteCurve = monotoneCubic(MARTENSITE_HV_TABLE);
const slowCooledCurve = monotoneCubic(SLOW_COOLED_HV_TABLE);

/** 100% マルテンサイトの硬さ [HV](炭素量 wt%。単調非減少) */
export function martensiteHardness(carbonWt: number): number {
  return martensiteCurve(carbonWt);
}

/** 徐冷(焼なまし)した鋼の硬さの目安 [HV](炭素量 wt%) */
export function slowCooledHardness(carbonWt: number): number {
  return slowCooledCurve(carbonWt);
}

/* ------------------------------------------- パーライトの硬さ(図1) */

const [[T_HI, HV_LO], [T_LO, HV_HI]] = PEARLITE_HV_ANCHORS;
const SQ_HI = Math.sqrt(A1_C - T_HI);
const SQ_LO = Math.sqrt(A1_C - T_LO);
/** HV = a + b√(A₁ − T) の係数(2 点を通る) */
const PEARLITE_B = (HV_HI - HV_LO) / (SQ_LO - SQ_HI);
const PEARLITE_A = HV_LO - PEARLITE_B * SQ_HI;

/**
 * パーライト変態が始まった温度 startC [℃] から見たパーライトの硬さの目安 [HV]。
 * 縞の間隔 ∝ 1/ΔT・硬さ ∝ 間隔^(−1/2) から HV = a + b√ΔT(constants.ts)。
 */
export function pearliteHardness(startC: number): number {
  const dT = Math.max(A1_C - startC, 0);
  return PEARLITE_A + PEARLITE_B * Math.sqrt(dT);
}

/**
 * パーライトの縞の間隔の相対値(図1 の組織の模式で縞を描く間隔)。
 * ΔT = A₁ − T に反比例(ツェナーの関係)。refC の温度で 1。
 */
export function pearliteSpacingRel(startC: number, refC: number): number {
  const dT = Math.max(A1_C - startC, 1);
  const dTref = Math.max(A1_C - refC, 1);
  return dTref / dT;
}
