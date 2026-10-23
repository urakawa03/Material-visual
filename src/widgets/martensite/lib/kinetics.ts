/**
 * kinetics.ts — 冷却・変態の速さの純関数(記事仕様書 10 §5.0)
 *
 * - C 曲線(共析鋼のパーライト変態の開始時間)と、シャイルの加算則による
 *   連続冷却の判定(図1)
 * - ニュートン冷却の温度履歴(図1・図2)
 * - 炭素の跳躍頻度と、冷却中に炭素が動ける距離(図2)
 * - M_s・コイスティネン=マールブルガー式・アブラミ式(図4・図6)
 *
 * DOM・Canvas に依存しない純関数だけを置き、kinetics.test.ts で検証する。
 */

import {
  A1_C,
  AVRAMI_N,
  C_CURVE_EXP_CLAMP,
  C_EUTECTOID,
  D0_ALPHA_M2S,
  D0_GAMMA_M2S,
  FAST_PEARLITE_TIME_S,
  HOP_ATTEMPT_HZ,
  KM_RATE_PER_K,
  MF_FRACTION,
  MS_BASE_C,
  MS_CARBON_RATE,
  MS_CARBON_SPAN_C,
  MS_MN_COEF,
  MS_SI_COEF,
  NOSE_T_C,
  NOSE_TIME_S,
  Q_ALPHA_J_PER_MOL,
  Q_GAMMA_J_PER_MOL,
  R_GAS,
  SCHEIL_DT_K,
  START_FRACTION,
  STEEL_MN_WT,
  STEEL_SI_WT,
  T_AUSTENITIZE_C,
  T_ENV_C,
  T_ROOM_C,
  toC,
  toK,
} from "./constants";

/* ----------------------------------------------------------------- C 曲線 */

const A1_K = toK(A1_C);
const NOSE_K = toK(NOSE_T_C);
/** Q/R [K](オーステナイト中の炭素の拡散) */
const Q_OVER_R = Q_GAMMA_J_PER_MOL / R_GAS;

/**
 * C 曲線の核生成の項の定数 K [K³]。
 * t_s(T) = C₁ exp(Q/RT) exp(K / (T (A₁ − T)²)) の鼻(d ln t_s/dT = 0)が
 * NOSE_T_C に来る条件 Q/R = K (3T − A₁)/(A₁ − T)³ から決める(≈ 6.72 × 10⁷ K³)。
 */
export const C_CURVE_K =
  (Q_OVER_R * (A1_K - NOSE_K) ** 3) / (3 * NOSE_K - A1_K);

/** C 曲線の前因子の対数 ln C₁(鼻で t_s = NOSE_TIME_S。C₁ ≈ 2.4 × 10⁻¹¹ 秒) */
export const C_CURVE_LN_C1 =
  Math.log(NOSE_TIME_S) -
  Q_OVER_R / NOSE_K -
  C_CURVE_K / (NOSE_K * (A1_K - NOSE_K) ** 2);

/**
 * パーライト変態の開始の速さ 1/t_s(T) [1/s](T は K)。
 * A₁ 以上、または指数の引数が C_CURVE_EXP_CLAMP を超えるときは 0
 * (変態は始まらない — §5.0。そのまま exp を取るとオーバーフローする)。
 */
export function pearliteStartRate(tempK: number): number {
  if (!(tempK > 0) || tempK >= A1_K) return 0;
  const arg = Q_OVER_R / tempK + C_CURVE_K / (tempK * (A1_K - tempK) ** 2);
  if (!(arg <= C_CURVE_EXP_CLAMP)) return 0;
  return Math.exp(-arg - C_CURVE_LN_C1);
}

/** パーライト変態が始まるまでの時間 t_s(T) [s](始まらないなら Infinity) */
export function pearliteStartTime(tempK: number): number {
  const r = pearliteStartRate(tempK);
  return r > 0 ? 1 / r : Infinity;
}

/* ------------------------------------------------------- ニュートン冷却 */

/**
 * ニュートン冷却の温度 T(t) = T_env + (T₀ − T_env) e^{−t/τ} [℃]。
 */
export function newtonTempC(
  timeS: number,
  tauS: number,
  startC = T_AUSTENITIZE_C,
  envC = T_ENV_C,
): number {
  return envC + (startC - envC) * Math.exp(-Math.max(timeS, 0) / tauS);
}

/** ニュートン冷却で温度 tempC に達する時刻 [s](到達しないなら Infinity) */
export function newtonTimeS(
  tempC: number,
  tauS: number,
  startC = T_AUSTENITIZE_C,
  envC = T_ENV_C,
): number {
  if (tempC >= startC) return 0;
  if (tempC <= envC) return Infinity;
  return tauS * Math.log((startC - envC) / (tempC - envC));
}

/** 温度 tempC での冷却速度 [℃/s](正の値。読み取りの「550 ℃ での冷却速度」) */
export function coolingRateAt(
  tempC: number,
  tauS: number,
  envC = T_ENV_C,
): number {
  return (tempC - envC) / tauS;
}

/* ------------------------------------------------- シャイルの加算則(図1) */

/**
 * 加算則の積分 I(T) = ∫_T^{A₁} dT′ / ((T′ − T_env) t_s(T′)) [1/s · s = 1/K·K]。
 * ニュートン冷却では dt = τ dT/(T − T_env) なので、加算和は τ·I(T) になる
 * (時定数に比例する)。T は ℃。
 */
export function scheilIntegral(tempC: number, envC = T_ENV_C): number {
  const lo = toK(Math.max(tempC, envC + SCHEIL_DT_K));
  const envK = toK(envC);
  let sum = 0;
  for (let t = A1_K; t > lo; t -= SCHEIL_DT_K) {
    const step = Math.min(SCHEIL_DT_K, t - lo);
    const mid = t - step / 2;
    sum += (pearliteStartRate(mid) / (mid - envK)) * step;
  }
  return sum;
}

export type Product = "pearlite" | "martensite";

export interface CoolingOutcome {
  /** できる組織 */
  product: Product;
  /**
   * 変態が始まった温度 [℃]。パーライトなら加算和が 1 に達した温度、
   * マルテンサイトなら M_s。
   */
  startTempC: number;
  /** その温度に達した時刻 [s](冷却開始から) */
  startTimeS: number;
  /** 加算和(パーライトなら 1、マルテンサイトなら M_s に達した時点の値) */
  scheilSum: number;
}

/**
 * 連続冷却の結果(§5.0): A₁ 以下で加算和 Σ Δt/t_s が 1 に達したら
 * パーライト変態が始まったとみなし、その前に M_s に達したらマルテンサイト。
 * 温度で積分する(dt = τ dT/(T − T_env))ので、時間刻みに依存しない。
 */
export function coolingOutcome(
  tauS: number,
  msC: number = msCelsius(C_EUTECTOID),
  envC = T_ENV_C,
  startC = T_AUSTENITIZE_C,
): CoolingOutcome {
  const msK = toK(msC);
  const envK = toK(envC);
  const top = Math.min(A1_K, toK(startC));
  let sum = 0;
  for (let t = top; t > msK; t -= SCHEIL_DT_K) {
    const step = Math.min(SCHEIL_DT_K, t - msK);
    const mid = t - step / 2;
    const inc = (tauS * pearliteStartRate(mid) * step) / (mid - envK);
    if (sum + inc >= 1) {
      // 刻みの中で 1 に達した位置を線形補間する
      const frac = (1 - sum) / inc;
      const tempC = toC(t - frac * step);
      return {
        product: "pearlite",
        startTempC: tempC,
        startTimeS: newtonTimeS(tempC, tauS, startC, envC),
        scheilSum: 1,
      };
    }
    sum += inc;
  }
  return {
    product: "martensite",
    startTempC: msC,
    startTimeS: newtonTimeS(msC, tauS, startC, envC),
    scheilSum: sum,
  };
}

/**
 * 臨界の時定数 τ_c [s]: これより速く冷やせば M_s まで加算和が 1 に届かない。
 * 加算和 = τ·I(M_s) なので τ_c = 1/I(M_s)(共析鋼で約 3.5 秒 — §5.0)。
 */
export function criticalTauS(
  msC: number = msCelsius(C_EUTECTOID),
  envC = T_ENV_C,
): number {
  return 1 / scheilIntegral(msC, envC);
}

/* ------------------------------------------- 炭素の跳躍と拡散(図2) */

/** 炭素の跳躍頻度 Γ = ν e^{−Q/RT} [1/s](式 E2。T は K。オーステナイト中) */
export function hopFrequency(tempK: number): number {
  return HOP_ATTEMPT_HZ * Math.exp(-Q_OVER_R / tempK);
}

/** オーステナイト中の炭素の拡散係数 D_γ(T) [m²/s](T は K) */
export function diffusivityGamma(tempK: number): number {
  return D0_GAMMA_M2S * Math.exp(-Q_OVER_R / tempK);
}

/** フェライト中の炭素の拡散係数 D_α(T) [m²/s](本文の比較用) */
export function diffusivityAlpha(tempK: number): number {
  return D0_ALPHA_M2S * Math.exp(-Q_ALPHA_J_PER_MOL / (R_GAS * tempK));
}

/**
 * ニュートン冷却で温度が [loC, hiC] を通り過ぎる間に炭素が動ける距離
 * √(2 ∫ D dt) [m]。dt = τ dT/(T − T_env) で温度について積分する。
 * 区間は [T_env, A₁] に切り詰める(A₁ より上は炭化物ができないので数えない)。
 */
export function diffusionLengthCooling(
  tauS: number,
  loC: number,
  hiC: number = A1_C,
  envC = T_ENV_C,
): number {
  const lo = toK(Math.max(loC, envC + SCHEIL_DT_K));
  const hi = toK(Math.min(hiC, A1_C));
  if (!(hi > lo)) return 0;
  const envK = toK(envC);
  let sum = 0;
  for (let t = hi; t > lo; t -= SCHEIL_DT_K) {
    const step = Math.min(SCHEIL_DT_K, t - lo);
    const mid = t - step / 2;
    sum += (diffusivityGamma(mid) / (mid - envK)) * step;
  }
  return Math.sqrt(2 * tauS * sum);
}

export interface TempWindow {
  loC: number;
  hiC: number;
}

/**
 * パーライトが数秒でできはじめる温度域(C 曲線の開始時間が
 * FAST_PEARLITE_TIME_S 以下 — 鼻のまわり)。共析鋼で約 420〜620 ℃。
 * 二分法で両端を 0.01 K まで詰める。
 */
export function fastPearliteWindowC(
  maxTimeS = FAST_PEARLITE_TIME_S,
): TempWindow {
  const inside = (tC: number): boolean =>
    pearliteStartTime(toK(tC)) <= maxTimeS;
  const bisect = (a: number, b: number): number => {
    // a は外、b は内(または逆)。境界を返す
    let lo = a;
    let hi = b;
    const loInside = inside(lo);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid) === loInside) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    loC: bisect(NOSE_T_C - 400, NOSE_T_C),
    hiC: bisect(NOSE_T_C, A1_C),
  };
}

/* --------------------------------------------------- M_s と変態量(図4) */

/**
 * マルテンサイト変態の開始温度 M_s [℃]([vanBohemen] の式。constants.ts 参照)。
 */
export function msCelsius(
  carbonWt: number,
  mnWt = STEEL_MN_WT,
  siWt = STEEL_SI_WT,
): number {
  return (
    MS_BASE_C -
    (MS_MN_COEF * mnWt + MS_SI_COEF * siWt) -
    MS_CARBON_SPAN_C * (1 - Math.exp(-MS_CARBON_RATE * carbonWt))
  );
}

/**
 * マルテンサイト量 f_M = 1 − exp[−0.011 (M_s − T)](式 E5、T ≥ M_s では 0)。
 *
 * **引数に時間がないのは仕様である**(非熱的変態 — §5.4)。変態量は到達した
 * 温度だけで決まり、その温度に何秒保っても増えない。図4 で保持時間を
 * 動かしてもマルテンサイトの点が動かないのはバグではなく物理である。
 */
export function martensiteFraction(tempC: number, msC: number): number {
  if (tempC >= msC) return 0;
  return 1 - Math.exp(-KM_RATE_PER_K * (msC - tempC));
}

/** M_f [℃]: マルテンサイト量が MF_FRACTION(99%)に達する温度(M_s − 約 420 ℃) */
export function mfCelsius(msC: number): number {
  return msC + Math.log(1 - MF_FRACTION) / KM_RATE_PER_K;
}

/** 室温まで焼入れたときの残留オーステナイトの割合(0〜1) */
export function retainedAustenite(carbonWt: number, roomC = T_ROOM_C): number {
  return 1 - martensiteFraction(roomC, msCelsius(carbonWt));
}

/* ------------------------------------ 比較: 拡散変態のアブラミ式(図4) */

/** アブラミ式 f = 1 − exp[−(t/t₀)ⁿ](式 E6) */
export function avramiFraction(
  timeS: number,
  t0S: number,
  n = AVRAMI_N,
): number {
  if (!(timeS > 0) || !Number.isFinite(t0S)) return 0;
  return 1 - Math.exp(-((timeS / t0S) ** n));
}

/**
 * 温度 tempC での拡散変態のアブラミ式の t₀ [s]。C 曲線の開始時間 t_s を
 * 「START_FRACTION(1%)が変態した時刻」とみなして t₀ = t_s / (−ln 0.99)^{1/n}。
 * C 曲線が始まらない温度では Infinity。
 */
export function diffusionalT0(tempC: number, n = AVRAMI_N): number {
  const ts = pearliteStartTime(toK(tempC));
  if (!Number.isFinite(ts)) return Infinity;
  return ts / (-Math.log(1 - START_FRACTION)) ** (1 / n);
}

/** 温度 tempC に timeS 秒保ったときの拡散変態の量(0〜1。図4 右) */
export function diffusionalFraction(tempC: number, timeS: number): number {
  return avramiFraction(timeS, diffusionalT0(tempC));
}
