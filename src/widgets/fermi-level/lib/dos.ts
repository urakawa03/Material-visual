/**
 * dos.ts — 図3「席の数 × 埋まり具合」の状態密度と数値積分(仕様書 12 §5.3)
 *
 * 放物線バンドの 3 次元状態密度を、有効状態密度 N_c で規格化して書く:
 *
 *   g_c(E) = (2/√π)·N_c·(E − E_c)^{1/2} / (k_BT)^{3/2}   (価電子帯も同形)
 *
 * N_c ∝ T^{3/2} なので g_c は温度によらない(席の数は温度で変わらない)。
 * この規格化で ∫g_c f dE = N_c·F_{1/2}(η) が厳密に成り立つので、図の数値積分は
 * _shared/semiconductor.ts の electronDensity と一致する(§5.8 T5)。
 */

import {
  effectiveDos,
  fermiDirac,
  thermalEnergy,
  type Semiconductor,
} from "../../_shared/semiconductor";

const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/** 伝導帯の状態密度 g_c(E) [cm⁻³ eV⁻¹](E ≤ E_c では 0) */
export function dosConduction(sc: Semiconductor, e: number, T: number): number {
  if (!(e > sc.eg) || !(T > 0)) return 0;
  const kT = thermalEnergy(T);
  const { nc } = effectiveDos(sc, T);
  return (TWO_OVER_SQRT_PI * nc * Math.sqrt(e - sc.eg)) / Math.pow(kT, 1.5);
}

/** 価電子帯の状態密度 g_v(E) [cm⁻³ eV⁻¹](E ≥ E_v = 0 では 0) */
export function dosValence(sc: Semiconductor, e: number, T: number): number {
  if (!(e < 0) || !(T > 0)) return 0;
  const kT = thermalEnergy(T);
  const { nv } = effectiveDos(sc, T);
  return (TWO_OVER_SQRT_PI * nv * Math.sqrt(-e)) / Math.pow(kT, 1.5);
}

/**
 * 空席の確率 1 − f(E)。1 から引くと f ≈ 1 のとき桁落ちするので、
 * 恒等式 1 − f(E; E_F) = f(E_F; E)(引数の入れ替え)で直接求める。
 */
export function vacancy(e: number, eF: number, T: number): number {
  return fermiDirac(eF, e, T);
}

/** 電子(sign = +1)なら f、正孔(sign = −1)なら 1 − f */
function occupancy(e: number, eF: number, T: number, sign: 1 | -1): number {
  return sign > 0 ? fermiDirac(e, eF, T) : vacancy(e, eF, T);
}

/** 数値積分の結果 */
export interface PeakIntegral {
  /** キャリア密度(山の面積)[cm⁻³] */
  density: number;
  /** 山の 90% が収まるバンド端からの幅 [k_BT 単位] */
  width90: number;
}

/** 数値積分の区間数(仕様書 12 §5.3: 400 点) */
export const INTEGRAL_CELLS = 400;
/** 積分範囲: バンド端から(縮退していれば E_F の先まで)20 k_BT */
const INTEGRAL_SPAN_KT = 20;

/**
 * 伝導帯(sign = +1)または価電子帯(sign = −1)の山を数値積分する。
 * 変数はバンド端からの距離 ε = |E − E_edge|/k_BT。各区間で √ε の積分は解析的に
 * ((2/3)(b^{3/2} − a^{3/2}))、占有確率は区間の中点で取る(√ε の端の特異性で
 * 台形則の精度が落ちるのを避けるため)。
 *
 * 積分範囲は仕様書の「E_c 〜 E_c + 20k_BT」を基本に、E_F がバンドの中に
 * 入る(縮退)ときは E_F から先へ 20k_BT まで延ばす(そうしないと縮退域の
 * 山を切り落としてしまう)。
 */
function integratePeak(
  sc: Semiconductor,
  eF: number,
  T: number,
  sign: 1 | -1,
  cells: number,
  out: PeakIntegral,
): PeakIntegral {
  if (!(T > 0)) {
    out.density = 0;
    out.width90 = 0;
    return out;
  }
  const kT = thermalEnergy(T);
  const { nc, nv } = effectiveDos(sc, T);
  const edge = sign > 0 ? sc.eg : 0;
  const prefactor = TWO_OVER_SQRT_PI * (sign > 0 ? nc : nv);
  // バンドの中へ E_F がどれだけ入り込んでいるか(k_BT 単位)
  const depth = Math.max(0, (sign * (eF - edge)) / kT);
  const span = depth + INTEGRAL_SPAN_KT;
  const h = span / cells;

  let total = 0;
  for (let i = 0; i < cells; i++) {
    const a = i * h;
    const b = a + h;
    const weight = (2 / 3) * (Math.pow(b, 1.5) - Math.pow(a, 1.5));
    const e = edge + sign * (a + 0.5 * h) * kT;
    total += weight * occupancy(e, eF, T, sign);
  }

  // 山の 90% が収まる幅(累積が 90% に届く区間の中で線形補間)
  let width90 = span;
  if (total > 0) {
    const target = 0.9 * total;
    let acc = 0;
    for (let i = 0; i < cells; i++) {
      const a = i * h;
      const b = a + h;
      const weight = (2 / 3) * (Math.pow(b, 1.5) - Math.pow(a, 1.5));
      const e = edge + sign * (a + 0.5 * h) * kT;
      const part = weight * occupancy(e, eF, T, sign);
      if (acc + part >= target) {
        width90 = a + (part > 0 ? ((target - acc) / part) * h : 0);
        break;
      }
      acc += part;
    }
  }

  out.density = prefactor * total;
  out.width90 = width90;
  return out;
}

/** 図3 の電子密度 n = ∫ g_c(E) f(E) dE(400 区間の数値積分) */
export function integrateElectrons(
  sc: Semiconductor,
  eF: number,
  T: number,
  cells = INTEGRAL_CELLS,
  out: PeakIntegral = { density: 0, width90: 0 },
): PeakIntegral {
  return integratePeak(sc, eF, T, 1, cells, out);
}

/** 図3 の正孔密度 p = ∫ g_v(E) [1 − f(E)] dE(400 区間の数値積分) */
export function integrateHoles(
  sc: Semiconductor,
  eF: number,
  T: number,
  cells = INTEGRAL_CELLS,
  out: PeakIntegral = { density: 0, width90: 0 },
): PeakIntegral {
  return integratePeak(sc, eF, T, -1, cells, out);
}
