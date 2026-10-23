/**
 * semiconductor.ts — 半導体のキャリア統計(カテゴリ D 共通。仕様書 12 §0・§5.0)
 *
 * 記事「フェルミ準位」で新設し、記事「pn 接合」(仕様書 13)もそのまま使う
 * 純関数群。最初から 2 記事で使うので、記事の lib/ ではなく _shared/ に置く
 * (banddiagram.ts の「記事をまたいで使う部品はここ」の方針)。
 *
 * 単位と原点(仕様書 12 §2.3):
 * - エネルギーは eV。**価電子帯の頂上を E_v = 0**、伝導帯の底を E_c = E_g とする
 * - 密度は cm⁻³、温度は K
 * - k_B は src/core/units.ts の KB_EV(300 K で k_BT = 25.85 meV)
 *
 * 数値の安全性: 指数の引数はすべて ±EXP_CLAMP でクランプするか、オーバーフロー
 * しても NaN にならない形で評価する(スライダーを両端まで動かしても NaN・
 * Infinity を出さない — 仕様書 12 §5.2・§5.5 の受け入れ基準)。
 */

import { KB_EV, Q_E } from "../../core/units";

/* ---------------------------------------------------------------- 材料定数 */

/** 半導体の材料定数(仕様書 12 §2.3 の表) */
export interface Semiconductor {
  /** バンドギャップ E_g [eV]。温度によらず一定とする簡略化 */
  eg: number;
  /** 300 K の伝導帯の有効状態密度 N_c [cm⁻³](∝ T^{3/2}) */
  nc300: number;
  /** 300 K の価電子帯の有効状態密度 N_v [cm⁻³](∝ T^{3/2}) */
  nv300: number;
  /** ドナー準位の深さ E_c − E_D [eV] */
  edDepth: number;
  /** アクセプタ準位の深さ E_A − E_v [eV] */
  eaDepth: number;
  /** ドナー準位の縮退度 g_D */
  gD: number;
  /** アクセプタ準位の縮退度 g_A */
  gA: number;
  /** 電子の移動度 μ_n [cm²/(V·s)]。濃度・温度によらず一定とする簡略化 */
  muN: number;
  /** 正孔の移動度 μ_p [cm²/(V·s)] */
  muP: number;
  /** 比誘電率 ε_r(pn 接合の記事が使う) */
  epsR: number;
  /** 母体の原子密度 [cm⁻³](「何分の 1 の不純物か」の読み取り用) */
  atomDensity: number;
  /** 表示名 */
  label: string;
}

/**
 * シリコン(仕様書 12 §2.3・付録 A-1)。N_c・N_v は Sze & Ng 第 3 版の 300 K 値。
 * 真性キャリア密度はこれと E_g から導出され、300 K で約 1.08 × 10¹⁰ cm⁻³。
 * ドナーは P、アクセプタは B を想定している。
 */
export const SILICON: Readonly<Semiconductor> = Object.freeze({
  eg: 1.12,
  nc300: 2.86e19,
  nv300: 2.66e19,
  edDepth: 0.045,
  eaDepth: 0.045,
  gD: 2,
  gA: 4,
  muN: 1350,
  muP: 480,
  epsR: 11.7,
  atomDensity: 5.0e22,
  label: "Si",
});

/** 指数関数の引数のクランプ(e^{±700} は倍精度で有限) */
const EXP_CLAMP = 700;

function clampExp(x: number): number {
  return x > EXP_CLAMP ? EXP_CLAMP : x < -EXP_CLAMP ? -EXP_CLAMP : x;
}

/** k_BT [eV] */
export function thermalEnergy(T: number): number {
  return KB_EV * T;
}

/** 有効状態密度 {N_c, N_v} [cm⁻³]。N(T) = N(300 K)·(T/300)^{3/2} */
export function effectiveDos(
  sc: Semiconductor,
  T: number,
): { nc: number; nv: number } {
  const s = T > 0 ? Math.pow(T / 300, 1.5) : 0;
  return { nc: sc.nc300 * s, nv: sc.nv300 * s };
}

/** ドナー準位 E_D = E_c − (E_c − E_D) [eV] */
export function donorLevel(sc: Semiconductor): number {
  return sc.eg - sc.edDepth;
}

/** アクセプタ準位 E_A = E_v + (E_A − E_v) [eV] */
export function acceptorLevel(sc: Semiconductor): number {
  return sc.eaDepth;
}

/* ---------------------------------------------------------- 分布関数 */

/**
 * フェルミ・ディラック分布 f(E) = 1 / (exp[(E − E_F)/k_BT] + 1)(式 E1)。
 *
 * x = (E − E_F)/k_BT を ±700 でクランプし、x > 0 では e^{−x}/(1 + e^{−x})、
 * x ≤ 0 では 1/(1 + e^{x}) で評価する(どちらの側でも Infinity を作らない)。
 * T ≤ 0 は階段(E < E_F で 1、E > E_F で 0、E = E_F で 1/2)。
 */
export function fermiDirac(e: number, eF: number, T: number): number {
  if (!(T > 0)) return e < eF ? 1 : e > eF ? 0 : 0.5;
  const x = clampExp((e - eF) / thermalEnergy(T));
  if (x > 0) {
    const ex = Math.exp(-x);
    return ex / (1 + ex);
  }
  return 1 / (1 + Math.exp(x));
}

/** fdHalf の係数(Aymerich-Humet ら 1981) */
const FD_A = 9.6;
const FD_B = 2.13;
const FD_C = 2.4;
/** 3·√(π/2)(規格化した F_{1/2} の縮退極限 (4/3√π)·η^{3/2} を与える係数) */
const FD_K = 3 * Math.sqrt(Math.PI / 2);

/**
 * 規格化フェルミ・ディラック積分
 * F_{1/2}(η) = (2/√π) ∫₀^∞ √ε / (1 + e^{ε−η}) dε の解析近似
 * (X. Aymerich-Humet, F. Serra-Mestres, J. Millán, Solid-State Electronics
 * 24, 981 (1981))。
 *
 *   F_{1/2}(η) ≈ [ e^{−η} + 3√(π/2) / (b + η + (|η − b|^c + a)^{1/c})^{3/2} ]^{−1}
 *   a = 9.6, b = 2.13, c = 2.4
 *
 * 注意(係数の確認結果): 仕様書 12 §5.0 は括弧の中を `(|η − b|^c + a^c)^{1/c}`
 * と書いているが、原典の 9.6 は**すでに c 乗された値**(一般形の a ≈ 2.585 の
 * 2.4 乗)で、9.6 をさらに c 乗すると誤差が 97% に達する。ここでは原典どおり
 * 9.6 をそのまま足す。数値積分との相対誤差は全域で 0.53% 以下(最大は
 * η ≈ 2.06)で、η ≪ 0 では e^η に一致する(仕様書 12 §5.8 T4 で検証)。
 *
 * ボルツマン近似ではなくこれを使うのは、図5 のドーピングを縮退域
 * (10²⁰ cm⁻³)まで開放するため(仕様書 12 §5.0)。
 */
export function fdHalf(eta: number): number {
  if (Number.isNaN(eta)) return NaN;
  const d =
    FD_B +
    eta +
    Math.pow(Math.pow(Math.abs(eta - FD_B), FD_C) + FD_A, 1 / FD_C);
  // η → −∞ で e^{−η} が Infinity になっても 1/Infinity = 0(NaN にならない)
  return 1 / (Math.exp(-eta) + FD_K / Math.pow(d, 1.5));
}

/**
 * fdHalf の逆関数(F_{1/2}(η) = y となる η)。y ≤ 0 は −Infinity。
 * F_{1/2}(η) ≤ e^η なので η ≥ ln y、縮退極限 (4/3√π)·η^{3/2} ≤ F から上限を
 * 取り、区間二分法(固定 100 回)で解く。
 */
function inverseFdHalf(y: number): number {
  if (!(y > 0)) return -Infinity;
  if (!Number.isFinite(y)) return Infinity;
  let lo = Math.log(y);
  // 非縮退の極限では F = e^η(1 − e^η/2^{3/2} + …)。十分小さい y はそのまま返す
  if (lo < -40) return lo + y / (2 * Math.SQRT2);
  let hi = Math.max(lo + 1, Math.pow(0.75 * Math.sqrt(Math.PI) * y, 2 / 3) + 2);
  while (fdHalf(hi) < y) hi = hi * 2 + 1;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (fdHalf(mid) < y) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/* ------------------------------------------------------------ キャリア密度 */

/** 縮退の T → 0 極限 N(300)·(4/3√π)·(ΔE/k_B·300)^{3/2}(T が消える) */
function degenerateLimit(n300: number, depth: number): number {
  if (!(depth > 0)) return 0;
  return (
    n300 *
    (4 / (3 * Math.sqrt(Math.PI))) *
    Math.pow(depth / thermalEnergy(300), 1.5)
  );
}

/** 電子密度 n = N_c·F_{1/2}((E_F − E_c)/k_BT) [cm⁻³] */
export function electronDensity(
  sc: Semiconductor,
  eF: number,
  T: number,
): number {
  if (!(T > 0)) return degenerateLimit(sc.nc300, eF - sc.eg);
  const { nc } = effectiveDos(sc, T);
  return nc * fdHalf((eF - sc.eg) / thermalEnergy(T));
}

/** 正孔密度 p = N_v·F_{1/2}((E_v − E_F)/k_BT) [cm⁻³](E_v = 0) */
export function holeDensity(sc: Semiconductor, eF: number, T: number): number {
  if (!(T > 0)) return degenerateLimit(sc.nv300, -eF);
  const { nv } = effectiveDos(sc, T);
  return nv * fdHalf(-eF / thermalEnergy(T));
}

/** 真性キャリア密度 n_i = √(N_c N_v)·e^{−E_g/2k_BT} [cm⁻³](式 E7) */
export function intrinsicDensity(sc: Semiconductor, T: number): number {
  if (!(T > 0)) return 0;
  const { nc, nv } = effectiveDos(sc, T);
  return Math.sqrt(nc * nv) * Math.exp(-sc.eg / (2 * thermalEnergy(T)));
}

/** 真性準位 E_i = E_g/2 + (k_BT/2)·ln(N_v/N_c) [eV](式 E8) */
export function intrinsicLevel(sc: Semiconductor, T: number): number {
  const kT = T > 0 ? thermalEnergy(T) : 0;
  return sc.eg / 2 + (kT / 2) * Math.log(sc.nv300 / sc.nc300);
}

/** イオン化したドナー N_D⁺ = N_D / [1 + g_D·e^{(E_F − E_D)/k_BT}] [cm⁻³] */
export function ionizedDonors(
  sc: Semiconductor,
  nD: number,
  eF: number,
  T: number,
): number {
  if (!(nD > 0)) return 0;
  const eD = donorLevel(sc);
  if (!(T > 0)) return eF < eD ? nD : eF > eD ? 0 : nD / (1 + sc.gD);
  const x = clampExp((eF - eD) / thermalEnergy(T));
  return nD / (1 + sc.gD * Math.exp(x));
}

/** イオン化したアクセプタ N_A⁻ = N_A / [1 + g_A·e^{(E_A − E_F)/k_BT}] [cm⁻³] */
export function ionizedAcceptors(
  sc: Semiconductor,
  nA: number,
  eF: number,
  T: number,
): number {
  if (!(nA > 0)) return 0;
  const eA = acceptorLevel(sc);
  if (!(T > 0)) return eF > eA ? nA : eF < eA ? 0 : nA / (1 + sc.gA);
  const x = clampExp((eA - eF) / thermalEnergy(T));
  return nA / (1 + sc.gA * Math.exp(x));
}

/** 二分法の反復回数(区間 E_g + 2 eV を 2⁻⁸⁰ に縮める = 倍精度の限界まで) */
const BISECTION_STEPS = 80;
/** solveFermiLevel が扱う最低温度 [K](T → 0 で指数がすべて飽和するため) */
const MIN_SOLVE_T = 1;

/**
 * 電荷中性 n + N_A⁻ = p + N_D⁺(式 E9)を E_F について区間二分法で解く。
 * 区間は [−1, E_g + 1] eV、固定 80 回(仕様書 12 §5.0)。
 * 正孔・イオン化ドナーは E_F について単調減少、電子・イオン化アクセプタは
 * 単調増加なので、残差 p + N_D⁺ − n − N_A⁻ の符号で区間を狭めればよい。
 * 不完全イオン化とフェルミ・ディラック積分を含むので、凍結・縮退の域でも使える。
 */
export function solveFermiLevel(
  sc: Semiconductor,
  nD: number,
  nA: number,
  T: number,
): number {
  const t = Math.max(T, MIN_SOLVE_T);
  const kT = thermalEnergy(t);
  const { nc, nv } = effectiveDos(sc, t);
  const eD = donorLevel(sc);
  const eA = acceptorLevel(sc);
  const donors = nD > 0 ? nD : 0;
  const acceptors = nA > 0 ? nA : 0;
  let lo = -1;
  let hi = sc.eg + 1;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const eF = 0.5 * (lo + hi);
    const n = nc * fdHalf((eF - sc.eg) / kT);
    const p = nv * fdHalf(-eF / kT);
    const dPlus =
      donors > 0
        ? donors / (1 + sc.gD * Math.exp(clampExp((eF - eD) / kT)))
        : 0;
    const aMinus =
      acceptors > 0
        ? acceptors / (1 + sc.gA * Math.exp(clampExp((eA - eF) / kT)))
        : 0;
    // 正の電荷が多い → 電子を増やす(E_F を上げる)必要がある
    if (p + dPlus - n - aMinus > 0) lo = eF;
    else hi = eF;
  }
  return 0.5 * (lo + hi);
}

/**
 * 縮退しているか: E_F がバンド端から 3k_BT 以内(またはバンドの中)なら true。
 * このときボルツマン近似 n ≈ N_c·e^{−(E_c−E_F)/k_BT} は使えない。
 */
export function isDegenerate(
  sc: Semiconductor,
  eF: number,
  T: number,
): boolean {
  const kT = T > 0 ? thermalEnergy(T) : 0;
  return eF > sc.eg - 3 * kT || eF < 3 * kT;
}

/** 導電率 σ = q(nμ_n + pμ_p) [S/cm](式 E12) */
export function conductivity(sc: Semiconductor, n: number, p: number): number {
  return Q_E * (n * sc.muN + p * sc.muP);
}

/**
 * 擬フェルミ準位の分離 E_Fn − E_Fp = k_BT·ln(np/n_i²) [eV](式 E13)。
 * 熱平衡(np = n_i²)では 0。光や順バイアスで np > n_i² になると正。
 * 図6 と pn 接合の記事で使う。オーバーフローを避けて対数の和で評価する。
 */
export function quasiFermiSplit(
  sc: Semiconductor,
  n: number,
  p: number,
  T: number,
): number {
  const ni = intrinsicDensity(sc, T);
  return thermalEnergy(T) * (Math.log(n) + Math.log(p) - 2 * Math.log(ni));
}

/**
 * 電子の擬フェルミ準位 E_Fn: n = N_c·F_{1/2}((E_Fn − E_c)/k_BT) を E_Fn に
 * ついて解く(electronDensity の逆関数)。熱平衡の n を渡せば E_F に戻る。
 */
export function fermiLevelForElectrons(
  sc: Semiconductor,
  n: number,
  T: number,
): number {
  const t = Math.max(T, MIN_SOLVE_T);
  const { nc } = effectiveDos(sc, t);
  return sc.eg + thermalEnergy(t) * inverseFdHalf(n / nc);
}

/**
 * 正孔の擬フェルミ準位 E_Fp: p = N_v·F_{1/2}((E_v − E_Fp)/k_BT) を E_Fp に
 * ついて解く(holeDensity の逆関数)。
 */
export function fermiLevelForHoles(
  sc: Semiconductor,
  p: number,
  T: number,
): number {
  const t = Math.max(T, MIN_SOLVE_T);
  const { nv } = effectiveDos(sc, t);
  return -thermalEnergy(t) * inverseFdHalf(p / nv);
}
