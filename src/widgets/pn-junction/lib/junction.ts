/**
 * junction.ts — 階段接合の空乏層近似とダイオード式(仕様書 13 §5.0。純関数)
 *
 * 図2(空乏層)・図3(バンドの曲がり)・図4(坂を越える)・図5(バイアスと
 * I-V)・図6(太陽電池)が**同じ**この関数群を使う。同じドーピングなら空乏層の
 * 端・V_bi・W の数値は図をまたいで完全に一致する(§5.0 共通規約)。
 *
 * 単位と向き(§2.3):
 * - 位置 x は μm。p 型が左(x < 0)、n 型が右(x > 0)、接合面が x = 0
 * - 電場は kV/cm(+x 向きが正。空乏層の電場は n → p 向きなので負)
 * - 電位は V(p 側の中性領域を 0 とする)、エネルギーは eV、密度は cm⁻³、
 *   電流密度は A/cm²
 * - バイアス V は p 側が正のとき正(= 順方向)
 * - バンド図のエネルギーの原点は **p 側の中性領域の価電子帯の頂上**
 *   (E_v^p = 0、E_c^p = E_g)。n 側のバンドはそこから q(V_bi − V) だけ下がる
 *
 * 簡略化(図注に明示): 接合は急峻(ドーピングが境目で階段状に切り替わる)、
 * 空乏層の中にキャリアは 1 個もなく、外は完全に中性(空乏層近似)。
 */

import { EPS0_F_PER_CM, Q_E } from "../../../core/units";
import {
  intrinsicDensity,
  intrinsicLevel,
  solveFermiLevel,
  thermalEnergy,
  type Semiconductor,
} from "../../_shared/semiconductor";
import {
  DEPLETION_MARGIN,
  EXP_ARG_MAX,
  HC_EV_NM,
  MIN_HALF_RANGE_UM,
  RANGE_PER_W,
  type CarrierLifetimes,
} from "./constants";

/** 1 μm = 10⁻⁴ cm */
const CM_PER_UM = 1e-4;
/** 1 kV/cm = 10³ V/cm */
const V_PER_KV = 1e3;

/* ------------------------------------------------------------- 内蔵電位 */

/** 両側の中性領域のフェルミ準位(それぞれ自分の E_v から測った値)[eV] */
export interface SideFermiLevels {
  /** p 側(アクセプタ N_A だけを含む Si)の E_F */
  efp: number;
  /** n 側(ドナー N_D だけを含む Si)の E_F */
  efn: number;
}

/** 両側の E_F を `solveFermiLevel` で求める(不完全イオン化・縮退も含む) */
export function sideFermiLevels(
  sc: Semiconductor,
  nA: number,
  nD: number,
  T: number,
): SideFermiLevels {
  return {
    efp: solveFermiLevel(sc, 0, nA, T),
    efn: solveFermiLevel(sc, nD, 0, T),
  };
}

/**
 * 内蔵電位 V_bi [V](式 E1)。接触前の両側の E_F の差 E_F^n − E_F^p として
 * 計算する(フェルミ準位記事の図7 の段差と同じ量。縮退域でも一貫する)。
 * 非縮退・完全イオン化の範囲では k_BT·ln(N_A N_D/n_i²) に一致する。
 */
export function builtInPotential(
  sc: Semiconductor,
  nA: number,
  nD: number,
  T: number,
): number {
  const { efp, efn } = sideFermiLevels(sc, nA, nD, T);
  return efn - efp;
}

/* ------------------------------------------------------------- 空乏層 */

/** 空乏層近似の結果(式 E2・E4・E5) */
export interface Depletion {
  /** アクセプタ濃度 N_A(p 側)[cm⁻³] */
  nA: number;
  /** ドナー濃度 N_D(n 側)[cm⁻³] */
  nD: number;
  /** 温度 [K] */
  T: number;
  /** 両側の E_F(それぞれ自分の E_v から)[eV] */
  efp: number;
  efn: number;
  /** 内蔵電位 V_bi [V] */
  vbi: number;
  /** 与えたバイアス V [V] */
  v: number;
  /** 空乏層近似に使ったバイアス(V_bi − 0.02 V で止めた値)[V] */
  vEff: number;
  /** V ≥ V_bi − 0.02 で空乏層近似の適用外としてクランプしたか */
  clamped: boolean;
  /** 空乏層の両端の電位差 V_bi − V_eff [V](= 坂の高さ / q) */
  drop: number;
  /** 空乏層の幅 W = x_p + x_n [μm] */
  w: number;
  /** p 側の空乏層の厚み x_p [μm] */
  xp: number;
  /** n 側の空乏層の厚み x_n [μm] */
  xn: number;
  /** 最大電場の大きさ 𝓔_max(x = 0)[kV/cm](正の値) */
  eMax: number;
  /** qN_A/ε [V/cm²](電場の傾き) */
  kA: number;
  /** qN_D/ε [V/cm²] */
  kD: number;
}

/**
 * 階段接合の空乏層(式 E2・E4・E5)。
 *
 *   W = √( 2ε(V_bi − V)/q · (N_A + N_D)/(N_A N_D) ),
 *   x_p = W·N_D/(N_A + N_D),  x_n = W·N_A/(N_A + N_D)   (N_A x_p = N_D x_n)
 *   𝓔_max = qN_A x_p/ε = 2(V_bi − V)/W
 *
 * V ≥ V_bi − 0.02 V では空乏層近似が成り立たない(強い順方向で坂が消える)ので、
 * V を V_bi − 0.02 V に止めて計算し、`clamped` を立てる。
 */
export function depletion(
  sc: Semiconductor,
  nA: number,
  nD: number,
  V: number,
  T: number,
): Depletion {
  const { efp, efn } = sideFermiLevels(sc, nA, nD, T);
  const vbi = efn - efp;
  const v = Number.isFinite(V) ? V : 0;
  const vMax = vbi - DEPLETION_MARGIN;
  const clamped = v >= vMax;
  const vEff = clamped ? vMax : v;
  const drop = vbi - vEff;
  const eps = sc.epsR * EPS0_F_PER_CM;
  const wCm = Math.sqrt(((2 * eps * drop) / Q_E) * ((nA + nD) / (nA * nD)));
  const xpCm = (wCm * nD) / (nA + nD);
  const xnCm = (wCm * nA) / (nA + nD);
  const kA = (Q_E * nA) / eps;
  const kD = (Q_E * nD) / eps;
  return {
    nA,
    nD,
    T,
    efp,
    efn,
    vbi,
    v,
    vEff,
    clamped,
    drop,
    w: wCm / CM_PER_UM,
    xp: xpCm / CM_PER_UM,
    xn: xnCm / CM_PER_UM,
    eMax: (kA * xpCm) / V_PER_KV,
    kA,
    kD,
  };
}

/** 電荷密度 ρ(x)/q [cm⁻³](矩形: p 側の空乏層で −N_A、n 側で +N_D、外は 0) */
export function chargeDensity(d: Depletion, x: number): number {
  if (x <= -d.xp || x >= d.xn) return 0;
  return x < 0 ? -d.nA : d.nD;
}

/**
 * 電場 𝓔(x) [kV/cm](三角形。+x 向きが正)。空乏層の電場は n 側の正の電荷から
 * p 側の負の電荷へ向かうので、値は負(dE/dx = ρ/ε — 式 E3)。
 */
export function electricField(d: Depletion, x: number): number {
  if (x <= -d.xp || x >= d.xn) return 0;
  if (x < 0) return -(d.kA * (x + d.xp) * CM_PER_UM) / V_PER_KV;
  return -(d.kD * (d.xn - x) * CM_PER_UM) / V_PER_KV;
}

/**
 * 電位 ψ(x) [V](p 側の中性領域を 0 とする 2 本の放物線のつなぎ)。
 * n 側の中性領域では V_bi − V(= drop)。𝓔 = −dψ/dx。
 */
export function potential(d: Depletion, x: number): number {
  if (x <= -d.xp) return 0;
  if (x >= d.xn) return d.drop;
  if (x < 0) {
    const s = (x + d.xp) * CM_PER_UM;
    return 0.5 * d.kA * s * s;
  }
  const s = (d.xn - x) * CM_PER_UM;
  return d.drop - 0.5 * d.kD * s * s;
}

/** バンド端 [eV](原点は p 側の中性領域の E_v) */
export interface BandEdges {
  /** 伝導帯の底 E_c(x) */
  ec: number;
  /** 価電子帯の頂上 E_v(x) */
  ev: number;
  /** 真性準位 E_i(x) */
  ei: number;
}

/**
 * 位置 x のバンド端: E_c(x) = E_c^p − qψ(x)、E_v = E_c − E_g、
 * E_i = E_v + (中性領域での E_i − E_v)。out を渡すとそこに書き込んで返す
 * (曲線のサンプルでの新規割当てを避ける)。
 */
export function bandEdges(
  sc: Semiconductor,
  d: Depletion,
  x: number,
  T: number,
  out: BandEdges = { ec: 0, ev: 0, ei: 0 },
): BandEdges {
  const psi = potential(d, x);
  out.ec = sc.eg - psi;
  out.ev = -psi;
  out.ei = intrinsicLevel(sc, T) - psi;
  return out;
}

/**
 * 擬フェルミ準位 [eV](原点は p 側の E_v)。中性領域の奥では、正孔の
 * E_Fp は p 側の E_F のまま、電子の E_Fn は n 側の E_F(n 側のバンドといっしょに
 * 下がる)。差 E_Fn − E_Fp = qV_eff(式 E11。平衡では 0 で 1 本に重なる)。
 */
export function quasiFermiLevels(d: Depletion): { eFn: number; eFp: number } {
  return { eFn: d.efp + d.vEff, eFp: d.efp };
}

/**
 * 位置軸の表示範囲の半幅 [μm](§5.0): max(1.5W, 0.6 μm) を左右に取る。
 */
export function displayHalfRange(d: Depletion): number {
  return Math.max(RANGE_PER_W * d.w, MIN_HALF_RANGE_UM);
}

/* ------------------------------------------------------------ ダイオード式 */

/** 拡散係数 D = μk_BT/q [cm²/s](アインシュタインの関係) */
export function diffusionCoefficients(
  sc: Semiconductor,
  T: number,
): { dn: number; dp: number } {
  const kT = thermalEnergy(T); // eV の数値 = k_BT/q [V]
  return { dn: sc.muN * kT, dp: sc.muP * kT };
}

/** 拡散長 L = √(Dτ) [cm] */
export function diffusionLengths(
  sc: Semiconductor,
  k: CarrierLifetimes,
  T: number,
): { ln: number; lp: number } {
  const { dn, dp } = diffusionCoefficients(sc, T);
  return { ln: Math.sqrt(dn * k.tauN), lp: Math.sqrt(dp * k.tauP) };
}

/**
 * 飽和電流密度 J_0 [A/cm²](式 E10):
 *   J_0 = q n_i² ( D_n/(L_n N_A) + D_p/(L_p N_D) )
 * 長いダイオード(中性領域が拡散長より長い)の理想ダイオード式。
 */
export function saturationCurrent(
  sc: Semiconductor,
  k: CarrierLifetimes,
  nA: number,
  nD: number,
  T: number,
): number {
  const { dn, dp } = diffusionCoefficients(sc, T);
  const { ln, lp } = diffusionLengths(sc, k, T);
  const ni = intrinsicDensity(sc, T);
  return Q_E * ni * ni * (dn / (ln * nA) + dp / (lp * nD));
}

/** qV/k_BT を ±80 でクランプする(e^80 は有限 — NaN・Infinity を出さない) */
function clampedArg(V: number, T: number): number {
  const kT = thermalEnergy(T);
  if (!(kT > 0)) return V > 0 ? EXP_ARG_MAX : V < 0 ? -EXP_ARG_MAX : 0;
  const a = V / kT;
  if (!(a === a)) return 0; // NaN
  return a > EXP_ARG_MAX ? EXP_ARG_MAX : a < -EXP_ARG_MAX ? -EXP_ARG_MAX : a;
}

/**
 * 理想ダイオード式 J = J_0[exp(qV/k_BT) − 1] − J_L [A/cm²](式 E9・E13)。
 * J_L は光電流(太陽電池。既定 0)。指数の引数は 80 でクランプする。
 * V = 0・J_L = 0 で厳密に 0(expm1 で桁落ちも避ける)。
 */
export function diodeCurrent(j0: number, V: number, T: number, jL = 0): number {
  return j0 * Math.expm1(clampedArg(V, T)) - jL;
}

/**
 * 開放電圧 V_oc = (k_BT/q)·ln(J_L/J_0 + 1) [V](式 E14)。J_L ≤ 0 なら 0。
 */
export function openCircuitVoltage(j0: number, jL: number, T: number): number {
  if (!(jL > 0) || !(j0 > 0)) return 0;
  return thermalEnergy(T) * Math.log1p(jL / j0);
}

/** 最大電力点(太陽電池。電力 P = −JV が最大になる 0 ≤ V ≤ V_oc の点) */
export interface PowerPoint {
  /** 電圧 [V] */
  v: number;
  /** 電流密度 [A/cm²](負 = 外へ取り出す向き) */
  j: number;
  /** 取り出せる電力 |JV| [W/cm²] */
  p: number;
}

/** 黄金分割の反復回数(区間を 0.618^60 ≈ 3 × 10⁻¹³ 倍に縮める) */
const GOLDEN_STEPS = 60;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** 0 ≤ V ≤ V_oc で −J(V)·V を最大にする点(P は上に凸なので黄金分割で探す) */
export function maxPowerPoint(j0: number, jL: number, T: number): PowerPoint {
  const voc = openCircuitVoltage(j0, jL, T);
  if (!(voc > 0)) return { v: 0, j: diodeCurrent(j0, 0, T, jL), p: 0 };
  const power = (v: number): number => -diodeCurrent(j0, v, T, jL) * v;
  let a = 0;
  let b = voc;
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let pc = power(c);
  let pd = power(d);
  for (let i = 0; i < GOLDEN_STEPS; i++) {
    if (pc > pd) {
      b = d;
      d = c;
      pd = pc;
      c = b - GOLDEN * (b - a);
      pc = power(c);
    } else {
      a = c;
      c = d;
      pc = pd;
      d = a + GOLDEN * (b - a);
      pd = power(d);
    }
  }
  const v = 0.5 * (a + b);
  const j = diodeCurrent(j0, v, T, jL);
  return { v, j, p: -j * v };
}

/** 電流が 1 桁(10 倍)変わる電圧 k_BT·ln10/q [V](300 K で 59.5 mV) */
export function voltsPerDecade(T: number): number {
  return thermalEnergy(T) * Math.LN10;
}

/* ---------------------------------------------------------------- 発光 */

/** 発光波長 λ = hc/E_g = 1239.84/E_g [nm](式 E12) */
export function emissionWavelengthNm(eg: number): number {
  return eg > 0 ? HC_EV_NM / eg : NaN;
}
