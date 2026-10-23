/**
 * shape.ts — 表面起伏と自己調整の模式(記事仕様書 10 §5.5)
 *
 * 変態した層(厚さ d)を、1 枚の板(バリアント 1 種類)にするか、厚さ d/n の
 * 薄い板 n 枚を交互の向き(せん断 +γ・−γ)に並べるか(自己調整)。
 *
 * - 全体のせん断: 板のせん断の体積平均 Σ γᵢ wᵢ / L(L は考える領域の幅)
 * - 表面の起伏: 板の中で表面がせん断の量だけ持ち上がる(晶癖面の傾き θ)。
 *   1 種類では層全体で γ d sin θ、交互では 1 枚ぶんの γ (d/n) sin θ にとどまる
 * - ひずみエネルギー(相対・模式): 遠くまで届く分 ∝ (Σ γᵢ wᵢ)² と、
 *   それぞれの板の近くだけに残る分 ∝ κ Σ (γᵢ wᵢ)² の和を、1 種類のときで割る
 *
 * いずれも模式であり、図注で明示する(§5.5)。
 */

import {
  ALTERNATING_PLATES,
  LOCAL_STRAIN_WEIGHT,
  PLATE_SHEAR,
} from "./constants";

export type Arrangement = "single" | "alternating";

export interface PlateStack {
  /** 板の枚数 */
  n: number;
  /** 各板の厚さ(層の厚さ d に対する比。合計 1) */
  widths: Float64Array;
  /** 各板のせん断ひずみ(±γ) */
  shears: Float64Array;
}

/** 並び方から板の組を作る(交互では向きが 1 枚ごとに反転する) */
export function plateStack(
  arrangement: Arrangement,
  gamma = PLATE_SHEAR,
  n = ALTERNATING_PLATES,
): PlateStack {
  const count = arrangement === "single" ? 1 : n;
  const widths = new Float64Array(count).fill(1 / count);
  const shears = new Float64Array(count);
  for (let i = 0; i < count; i++) shears[i] = i % 2 === 0 ? gamma : -gamma;
  return { n: count, widths, shears };
}

/** 層全体のずれ(層の厚さ d を 1 としたときの Σ γᵢ wᵢ) */
export function netOffset(stack: PlateStack): number {
  let s = 0;
  for (let i = 0; i < stack.n; i++) s += stack.shears[i] * stack.widths[i];
  return s;
}

/**
 * 全体のせん断ひずみ(領域の幅 L に対する、層全体のずれの比)。
 * layerFraction = d/L(変態した層が領域に占める割合)。
 */
export function overallShear(stack: PlateStack, layerFraction: number): number {
  return netOffset(stack) * layerFraction;
}

/**
 * 表面の最大の起伏を、変態した層の厚さ d に対する比で返す。
 * 表面の高さは板を横切るにつれて γᵢ wᵢ sin θ ずつ上下するので、その
 * 累積の最大と最小の差をとる(sinHabit = 晶癖面と表面のなす角の sin)。
 */
export function surfaceReliefRatio(
  stack: PlateStack,
  sinHabit: number,
): number {
  let h = 0;
  let hMin = 0;
  let hMax = 0;
  for (let i = 0; i < stack.n; i++) {
    h += stack.shears[i] * stack.widths[i] * sinHabit;
    hMin = Math.min(hMin, h);
    hMax = Math.max(hMax, h);
  }
  return hMax - hMin;
}

/** ひずみエネルギーの正規化前の値 (Σ γᵢwᵢ)² + κ Σ (γᵢwᵢ)² */
function strainEnergyRaw(stack: PlateStack, kappa: number): number {
  let local = 0;
  for (let i = 0; i < stack.n; i++) {
    const b = stack.shears[i] * stack.widths[i];
    local += b * b;
  }
  const net = netOffset(stack);
  return net * net + kappa * local;
}

/**
 * たまったひずみエネルギー(相対値。同じ γ のバリアント 1 種類を 1 とする)。
 * 交互(n 枚・偶数)では遠くまで届く分が消え、κ/(n(1+κ)) だけが残る。
 */
export function strainEnergyRel(
  stack: PlateStack,
  kappa = LOCAL_STRAIN_WEIGHT,
): number {
  const gamma = Math.max(...Array.from(stack.shears, Math.abs));
  const single = plateStack("single", gamma);
  return strainEnergyRaw(stack, kappa) / strainEnergyRaw(single, kappa);
}
