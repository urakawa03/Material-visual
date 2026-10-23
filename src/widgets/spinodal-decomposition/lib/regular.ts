/**
 * regular.ts — 正則溶体の混合の自由エネルギーと、そこから引ける線
 * (記事仕様書 09 §2.3・§5.0・式 E1〜E7)
 *
 * 2 成分 A–B、組成 c = B の割合(0〜1)。混合の自由エネルギーを RT 単位で
 *
 *   g(c) = χ c(1−c) + c ln c + (1−c) ln(1−c),   χ = Ω/RT
 *
 * と書く。臨界温度は χ = 2(T/Tc = 2/χ)。読者向けのスライダーは T/Tc で出す。
 *
 * - スピノーダル: g''(c) = 0 ⇔ c(1−c) = 1/(2χ)(式 E4)
 * - バイノーダル: 対称な正則溶体では共通接線が水平になり、接点は
 *   g'(c) = 0 ⇔ ln(c/(1−c)) = χ(2c−1)(式 E3)。μ = g' の一致を二分法で解く
 * - 線形安定性(カーン・ヒリアード、M = 1): R(k) = −k²(g'' + κk²)(式 E6)、
 *   k_m² = −g''/(2κ)、R_max = g''²/(4κ)(式 E7)
 *
 * すべて純関数(図版・テストから共用)。
 */

/** 記事の代表の温度 T/Tc = 2/3(χ = 3)— §2.3 */
export const T_REP = 2 / 3;

/**
 * スライダーの値(step 0.01)を T/Tc に直す。0.67 の目盛りは記事の代表値
 * 2/3(χ = 3)を表す(表示は 2 桁に丸めた「0.67」)。ほかの目盛りはそのまま。
 * 代表値で図2・図3・図6 の数値(バイノーダル 0.0707 など)が本文と一致する。
 */
export function sliderToTOverTc(v: number): number {
  return Math.abs(v - T_REP) < 0.006 ? T_REP : v;
}

/** T/Tc → χ = 2/(T/Tc) */
export function chiFromT(tOverTc: number): number {
  return 2 / tOverTc;
}

/** 対数の特異点を避けるためのクランプ幅(カーン・ヒリアードと共通 — §5.0) */
export const C_CLAMP = 1e-6;

function clampC(c: number): number {
  return c < C_CLAMP ? C_CLAMP : c > 1 - C_CLAMP ? 1 - C_CLAMP : c;
}

/** 混合の自由エネルギー g(c) [RT](式 E1)。端は 0 に連続 */
export function gMix(c: number, chi: number): number {
  if (c <= 0 || c >= 1) return 0;
  return chi * c * (1 - c) + c * Math.log(c) + (1 - c) * Math.log(1 - c);
}

/** 化学ポテンシャル(差)μ = g'(c) = χ(1−2c) + ln(c/(1−c)) */
export function dgdc(c: number, chi: number): number {
  const cc = clampC(c);
  return chi * (1 - 2 * cc) + Math.log(cc / (1 - cc));
}

/** 曲率 g''(c) = −2χ + 1/(c(1−c)) */
export function d2gdc2(c: number, chi: number): number {
  const cc = clampC(c);
  return -2 * chi + 1 / (cc * (1 - cc));
}

/**
 * スピノーダルの組成(低い側)。高い側は 1 − c_s。
 * χ ≤ 2(臨界温度以上)では存在しないので NaN。
 */
export function spinodal(chi: number): number {
  if (chi <= 2) return NaN;
  return 0.5 * (1 - Math.sqrt(1 - 2 / chi));
}

/** 二分法の反復回数(区間幅 0.5 / 2^100 で倍精度の限界まで詰める) */
const BISECTION_STEPS = 100;

/**
 * バイノーダル(溶解度線)の組成(低い側)。高い側は 1 − c_b。
 * 共通接線の接点 = g'(c) = 0 の根を (0, c_s) で二分法で求める。
 * χ ≤ 2 では NaN。
 */
export function binodal(chi: number): number {
  if (chi <= 2) return NaN;
  // g' は (0, c_s) で単調増加し、0 付近で −∞、c_s で正
  let lo = 0;
  let hi = spinodal(chi);
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid <= 0 || mid === lo || mid === hi) break;
    const h = chi * (1 - 2 * mid) + Math.log(mid / (1 - mid));
    if (h < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** 共通接線(谷が 2 つあるときのみ) */
export interface CommonTangent {
  /** 接点の組成(A リッチ側 α・B リッチ側 β) */
  cAlpha: number;
  cBeta: number;
  /** 接線 y = slope·c + intercept */
  slope: number;
  intercept: number;
}

/** 共通接線を返す。T/Tc ≥ 1(χ ≤ 2)では null */
export function commonTangent(chi: number): CommonTangent | null {
  if (chi <= 2) return null;
  const cAlpha = binodal(chi);
  const cBeta = 1 - cAlpha;
  const ga = gMix(cAlpha, chi);
  const gb = gMix(cBeta, chi);
  const slope = (gb - ga) / (cBeta - cAlpha);
  return { cAlpha, cBeta, slope, intercept: ga - slope * cAlpha };
}

/**
 * 組成 c0 で、2 相に分かれると自由エネルギーがどれだけ下がるか [RT]。
 * = g(c0) − 接線の高さ。分かれたほうが得なときだけ正(それ以外は 0)。
 */
export function separationGain(c0: number, chi: number): number {
  const t = commonTangent(chi);
  if (!t || c0 <= t.cAlpha || c0 >= t.cBeta) return 0;
  return Math.max(0, gMix(c0, chi) - (t.slope * c0 + t.intercept));
}

/** てこの原理: β 相(B リッチ側)の割合 f_β = (c0 − cα)/(cβ − cα)(式 E2) */
export function leverFraction(c0: number, cAlpha: number, cBeta: number) {
  return (c0 - cAlpha) / (cBeta - cAlpha);
}

export type Region = "stable" | "metastable" | "unstable";

/**
 * 状態点 (c, χ) の領域。バイノーダルの外 = 安定、バイノーダルとスピノーダルの
 * 間 = 準安定(核が要る)、スピノーダルの内側 = 不安定(g'' < 0)。
 */
export function regionAt(c: number, chi: number): Region {
  if (d2gdc2(c, chi) < 0) return "unstable";
  if (chi <= 2) return "stable";
  const cb = binodal(chi);
  return c > cb && c < 1 - cb ? "metastable" : "stable";
}

/** 濃度の波の増幅率 R(k) = −k²(g''(c0) + κk²)(式 E6、M = 1) */
export function growthRate(
  k: number,
  c0: number,
  chi: number,
  kappa: number,
): number {
  return -k * k * (d2gdc2(c0, chi) + kappa * k * k);
}

/** 最も速く育つ波数 k_m = √(−g''/(2κ))(式 E7)。g'' ≥ 0 なら NaN */
export function fastestK(c0: number, chi: number, kappa: number): number {
  const g2 = d2gdc2(c0, chi);
  return g2 < 0 ? Math.sqrt(-g2 / (2 * kappa)) : NaN;
}

/** 最大の増幅率 R_max = g''²/(4κ)(g'' ≥ 0 なら 0) */
export function maxGrowthRate(c0: number, chi: number, kappa: number): number {
  const g2 = d2gdc2(c0, chi);
  return g2 < 0 ? (g2 * g2) / (4 * kappa) : 0;
}

/** 増幅率が正になる上限の波数 k_c = √(−g''/κ)(g'' ≥ 0 なら 0) */
export function cutoffK(c0: number, chi: number, kappa: number): number {
  const g2 = d2gdc2(c0, chi);
  return g2 < 0 ? Math.sqrt(-g2 / kappa) : 0;
}
