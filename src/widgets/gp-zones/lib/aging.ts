/**
 * aging.ts — 時効モデル(記事仕様書 07 §5.0。図1・6・7 で共用)
 *
 * 本記事の主張はすべてこの 1 ファイルに乗っている:
 *
 *   1. 析出は Avrami 型で進み、体積分率 f が育つ
 *   2. 粒子は析出とともに r1 まで育ち、そのあと粗大化 K(T)t で育ち続ける
 *   3. 転位は「切る(τ ∝ √(rf)、r の増加関数)」と
 *      「迂回する(τ = μb/L ∝ √f/r、r の減少関数)」の安い方を選ぶ
 *   4. 2 曲線の交点 = ピーク時効。その先は過時効(オストワルド成長記事へ)
 *
 * 温度依存は 2 本の見かけの活性化エネルギーの差が担う(constants.ts 参照):
 *   Q_p = 0.2 eV(析出。凍結空孔に助けられて低温側が速いぶん、見かけは小さい)
 *   Q_K = 0.6 eV(粗大化。Q_K > Q_p であることが要点)
 * 高温では粗大化が析出を追い越し、f が育ちきる前に r が交点半径を越える
 * ため、ピークは早く来るが低くなる(§5.0)。
 *
 * 簡略化(各図の図注で明示):
 * - 現象論モデルであり実測データではない。硬さは校正済みのモデル値。
 * - 実際の析出シーケンス(GP → θ″ → θ′ → θ)を「1 種類の粒子が育つ」に
 *   簡略化している。粒子は球として計算する(実際は {100} 上の板)。
 * - 体積分率は wt% から求めた模型値(密度差は無視)。
 */

import { orowanMPa, spacingNm } from "../../_shared/precipitate-strength";
import {
  AVRAMI_N,
  BETA,
  B_NM,
  C0_WT,
  C_THETA_WT,
  HV0,
  HV_PEAK,
  MU_B_MPA_NM,
  MU_GPA,
  R0_NM,
  R1_NM,
  R_CROSS_NM,
  T_CALIB_K,
  coarseningK,
  precipitationTime,
  solubilityWt,
} from "./constants";

/** 転位が粒子を通り抜ける機構 */
export type Mechanism = "cut" | "bow";

/** ある時刻の時効状態 */
export interface AgingState {
  /** 時効時間 [s] */
  t: number;
  /** 析出の進行度 X(0〜1) */
  x: number;
  /** 析出物の体積分率 f */
  f: number;
  /** 平均半径 r [nm] */
  r: number;
  /** 粒子間隔 L [nm] */
  l: number;
  /** せん断(切断)に必要な応力 [MPa] */
  tauCut: number;
  /** 迂回(オロワン)に必要な応力 [MPa] */
  tauBow: number;
  /** 実際に効く強化応力 Δτ = min(τ_cut, τ_bow) [MPa] */
  dtau: number;
  /** そのとき起きる機構 */
  mech: Mechanism;
  /** 硬さ [HV 相当](モデル値) */
  hv: number;
}

/**
 * 平衡体積分率 f_eq(T) = (c0 − c_s)/(c_θ − c_s)。
 * Al–4%Cu では 20〜250 °C の範囲で c_s ≪ c0 なので、この温度域の f_eq は
 * ほとんど温度によらない(「高温ほどピークが低い」の原因は f_eq ではなく
 * 速度の競合である — §5.0)。
 */
export function equilibriumFraction(
  tKelvin: number,
  c0Wt: number = C0_WT,
): number {
  const cs = solubilityWt(tKelvin);
  if (c0Wt <= cs) return 0;
  return (c0Wt - cs) / (C_THETA_WT - cs);
}

/** 析出の進行度 X(t) = 1 − exp[−(t/t_p)^n] */
export function transformedFraction(tSeconds: number, tKelvin: number): number {
  if (tSeconds <= 0) return 0;
  const u = tSeconds / precipitationTime(tKelvin);
  return 1 - Math.exp(-Math.pow(u, AVRAMI_N));
}

/** 平均半径 r(t) = [r0³ + (r1³ − r0³)X + K(T)t]^(1/3) [nm] */
export function meanRadius(tSeconds: number, tKelvin: number): number {
  const x = transformedFraction(tSeconds, tKelvin);
  const cubed =
    R0_NM ** 3 +
    (R1_NM ** 3 - R0_NM ** 3) * x +
    coarseningK(tKelvin) * Math.max(tSeconds, 0);
  return Math.cbrt(cubed);
}

/**
 * せん断(切断)に必要な応力 τ_cut = k√(rf) [MPa]。
 * 粒子が大きいほど、体積分率が高いほど切りにくい(r の増加関数)。
 * k は交点半径 r× で τ_bow と一致するよう校正した(下の K_CUT)。
 */
export function shearingMPa(rNm: number, f: number): number {
  return K_CUT * Math.sqrt(Math.max(rNm, 0) * Math.max(f, 0));
}

/**
 * 迂回(オロワン機構)に必要な応力 τ_bow = μb/L = μb√f/(βr) [MPa]。
 * フランク・リード源記事の τ_c ≈ μb/L と同じ式・同じ記号である。
 */
export function bowingMPa(rNm: number, f: number): number {
  if (f <= 0) return Infinity;
  return orowanMPa(Math.max(rNm, 1e-6), f, BETA, MU_GPA, B_NM);
}

/** 粒子間隔 L = βr/√f [nm](オストワルド成長記事と同じ式) */
export function spacing(rNm: number, f: number): number {
  return spacingNm(rNm, f, BETA);
}

/**
 * せん断側の係数 k [MPa](τ_cut = k√(rf))。
 * τ_cut(r×, f) = τ_bow(r×, f) ⇔ k√r× = μb/(βr×) より k = μb/(β r×^{3/2})。
 * 両機構とも √f に比例するので、**交点半径は f によらない**(§5.7)。
 */
export const K_CUT = MU_B_MPA_NM / (BETA * Math.pow(R_CROSS_NM, 1.5));

/** 強化応力 Δτ = min(τ_cut, τ_bow)(転位は安い道を選ぶ) */
export function strengtheningMPa(rNm: number, f: number): number {
  return Math.min(shearingMPa(rNm, f), bowingMPa(rNm, f));
}

/** そのとき起きる機構(交点より小さければ切断、大きければ迂回) */
export function mechanismAt(rNm: number, f: number): Mechanism {
  return shearingMPa(rNm, f) <= bowingMPa(rNm, f) ? "cut" : "bow";
}

/* ------------------------------------------------------------ 硬さへの換算 */

/** 校正用: 硬さ係数を決めるために Δτ のピークだけを走査する(HV を使わない) */
function peakDtau(tKelvin: number): number {
  const fEq = equilibriumFraction(tKelvin);
  let best = 0;
  // 1 s 〜 10⁹ s を対数格子で走査(校正はモジュール初期化時の 1 回だけ)
  for (let i = 0; i <= 900; i++) {
    const t = Math.pow(10, i / 100);
    const f = fEq * transformedFraction(t, tKelvin);
    const d = strengtheningMPa(meanRadius(t, tKelvin), f);
    if (d > best) best = d;
  }
  return best;
}

/** 130 °C のピークで HV = HV_PEAK となるよう校正した換算係数 [HV/MPa] */
export const HV_PER_MPA = (HV_PEAK - HV0) / peakDtau(T_CALIB_K);

/** 硬さ [HV 相当] = HV0 + C·Δτ */
export function hardnessHV(dtauMPa: number): number {
  return HV0 + HV_PER_MPA * dtauMPa;
}

/* -------------------------------------------------------------- 状態の評価 */

/** 時刻 t・温度 T の時効状態をまとめて返す */
export function agingStateAt(tSeconds: number, tKelvin: number): AgingState {
  const x = transformedFraction(tSeconds, tKelvin);
  const f = equilibriumFraction(tKelvin) * x;
  const r = meanRadius(tSeconds, tKelvin);
  const tauCut = shearingMPa(r, f);
  const tauBow = bowingMPa(r, f);
  const dtau = Math.min(tauCut, tauBow);
  return {
    t: tSeconds,
    x,
    f,
    r,
    l: f > 0 ? spacing(r, f) : Infinity,
    tauCut,
    tauBow,
    dtau,
    mech: tauCut <= tauBow ? "cut" : "bow",
    hv: hardnessHV(dtau),
  };
}

/** ピーク時効の情報 */
export interface AgingPeak {
  /** ピークに達する時間 [s] */
  t: number;
  /** ピークの硬さ [HV 相当] */
  hv: number;
  /** ピークでの平均半径 [nm] */
  r: number;
  /** ピークでの体積分率 */
  f: number;
}

/**
 * 温度 T の時効曲線のピークを対数格子の走査で求める。
 * 室温のように明確なピークを持たない場合は、走査範囲の端で最大となるため
 * `atEdge` が true になる(呼び出し側は「頭打ち」として扱う)。
 */
export function findPeak(
  tKelvin: number,
  tMinS = 1,
  tMaxS = 1e9,
  samples = 600,
): AgingPeak & { atEdge: boolean } {
  const lnMin = Math.log(tMinS);
  const lnMax = Math.log(tMaxS);
  let bestI = 0;
  let bestHv = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = Math.exp(lnMin + ((lnMax - lnMin) * i) / samples);
    const hv = agingStateAt(t, tKelvin).hv;
    if (hv > bestHv) {
      bestHv = hv;
      bestI = i;
    }
  }
  const atEdge = bestI === 0 || bestI === samples;
  const tPeak = Math.exp(lnMin + ((lnMax - lnMin) * bestI) / samples);
  const s = agingStateAt(tPeak, tKelvin);
  return { t: tPeak, hv: s.hv, r: s.r, f: s.f, atEdge };
}
