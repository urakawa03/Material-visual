/**
 * tunneling.ts — 矩形障壁の解析解と、傾いた障壁の WKB 指数(仕様書 14 §5.0)
 *
 * 単位: エネルギー eV、長さ nm、電場 V/nm(qF を eV/nm で表した値)。
 * massRatio は電子の有効質量 m* と m の比(SiO₂ の中では 0.42。既定は自由電子の 1)。
 * C = ħ²/2mₑ = 0.0380998 eV·nm²(src/core/units.ts)。
 *
 * 矩形障壁(高さ V・厚さ d)に左からエネルギー E の平面波を当てたときの
 * 厳密な透過率(式 E5)
 *
 *   T = [1 + V² sinh²(κd) / (4E(V − E))]⁻¹,   κ = √(m*(V − E)/C)
 *
 * を、sinh(κd)/κ = d·sinhc(κd)(sinhc x = sinh x / x)と書き直した
 *
 *   T = [1 + V² d² sinhc²(κd) / (4E·C/m*)]⁻¹
 *
 * の形で計算する。E > V では κ が虚数になって sinhc が sinc に置き換わるので、
 * E < V・E = V・E > V の 3 場合が 1 本の式で連続につながる(T1)。
 * κd が大きいと sinh² は倍精度をあふれるので、対数のまま計算する
 * (logTransmission。T が 10⁻³⁰⁰ を下回っても有限の値を返す)。
 * 厚い壁では T ≈ 16E(V − E)/V² · e^{−2κd} となり、ln T の d に対する傾きは
 * ちょうど −2κ になる(T2 — 記事の主張の担保)。
 */

import {
  ATTEMPT_FREQUENCY_HZ,
  HBAR2_OVER_2ME,
  MV_PER_CM_TO_V_PER_NM,
  SIO2_BARRIER_EV,
  SIO2_MASS_RATIO,
} from "./constants";

/** これより大きい x では sinh x・cosh x を対数の漸近形で扱う(e^{-2x} < 5e-18) */
const LARGE_X = 20;
/** これより小さい x では sinhc・sinc をテイラー展開で求める */
const SERIES_X = 1e-4;
/** ln X がこれより大きいと ln(1 + X) を ln X + ln(1 + 1/X) で計算する */
const LOG1P_SWITCH = 30;

/* ------------------------------------------------------------ 基本量 */

/**
 * 壁の中で波が減る速さ κ = √(m*(V − E)/C) [nm⁻¹](式 E2)。
 * barrier = V − E [eV]。壁より高いエネルギー(barrier ≤ 0)では 0。
 */
export function kappa(barrier: number, massRatio = 1): number {
  return barrier > 0 ? Math.sqrt((massRatio * barrier) / HBAR2_OVER_2ME) : 0;
}

/** 減衰長 1/κ [nm](波 ψ が 1/e になる距離)。κ = 0 なら Infinity */
export function decayLength(barrier: number, massRatio = 1): number {
  const k = kappa(barrier, massRatio);
  return k > 0 ? 1 / k : Infinity;
}

/** 壁より高いエネルギー(E > V)での、壁の中の波数 k' = √(m*(E − V)/C) [nm⁻¹] */
export function insideWavenumber(E: number, V: number, massRatio = 1): number {
  return kappa(E - V, massRatio);
}

/** ln(sinh x / x)(x ≥ 0)。大きな x でもあふれない */
export function logSinhc(x: number): number {
  if (x < SERIES_X) return (x * x) / 6;
  if (x < LARGE_X) return Math.log(Math.sinh(x) / x);
  return x - Math.LN2 - Math.log(x) + Math.log1p(-Math.exp(-2 * x));
}

/** ln cosh x(x ≥ 0)。大きな x でもあふれない */
export function logCosh(x: number): number {
  return x - Math.LN2 + Math.log1p(Math.exp(-2 * x));
}

function sinc(x: number): number {
  return Math.abs(x) < SERIES_X ? 1 - (x * x) / 6 : Math.sin(x) / x;
}

/* ------------------------------------------------------------ 透過率 */

/**
 * 矩形障壁の厳密な透過率の自然対数 ln T(式 E5)。
 * どんなに厚い壁でも有限の値を返す(T が 10⁻³⁰⁰ を下回っても 0 や NaN に
 * ならない)。E ≤ 0 は入射する進行波がないので −Infinity(T = 0)。
 */
export function logTransmission(
  E: number,
  V: number,
  d: number,
  massRatio = 1,
): number {
  if (!(E > 0)) return -Infinity;
  if (!(d > 0) || V === 0) return 0;
  const c = HBAR2_OVER_2ME / massRatio;
  const q = (V - E) / c; // κ²(負なら壁の中で振動する)
  const x = Math.sqrt(Math.abs(q)) * d;
  let lnShape: number;
  if (q >= 0) {
    lnShape = logSinhc(x);
  } else {
    const s = sinc(x);
    if (s === 0) return 0; // 共鳴(k'd = nπ)で完全に透過する
    lnShape = Math.log(Math.abs(s));
  }
  // X = V² d² sinhc²(κd) / (4E·C/m*)、T = 1/(1 + X)
  const lnX = 2 * Math.log(Math.abs(V) * d) + 2 * lnShape - Math.log(4 * E * c);
  if (lnX > LOG1P_SWITCH) return -(lnX + Math.log1p(Math.exp(-lnX)));
  return -Math.log1p(Math.exp(lnX));
}

/**
 * 矩形障壁の厳密な透過率 T(0 ≤ T ≤ 1)。exp(logTransmission) なので、
 * 倍精度で表せる下限(約 10⁻³⁰⁸)より小さい T は 0 になる。桁で扱う図は
 * logTransmission を直接使うこと。
 */
export function transmission(
  E: number,
  V: number,
  d: number,
  massRatio = 1,
): number {
  return Math.exp(logTransmission(E, V, d, massRatio));
}

/** 近似 T ≈ e^{−2κd}(式 E3)の ln T = −2κd。前に付く係数を落としている */
export function logTransmissionApprox(
  barrier: number,
  d: number,
  massRatio = 1,
): number {
  return -2 * kappa(barrier, massRatio) * d;
}

/** 厚い壁での厳密解の前の係数 16E(V − E)/V²(近似 e^{−2κd} が落としているもの) */
export function thickBarrierPrefactor(E: number, V: number): number {
  return (16 * E * (V - E)) / (V * V);
}

/* ------------------------------------------------------- 定常解 ψ(x) */

export interface Complex {
  re: number;
  im: number;
}

/**
 * 矩形障壁(0 ≤ x ≤ d)の定常散乱解。左から振幅 1 の平面波を入射する:
 *
 *   x < 0:      ψ = e^{ikx} + r e^{−ikx}
 *   0 ≤ x ≤ d:  ψ = A ρ(d − x)(1 − ik·σ(d − x))   (E < V。下の注)
 *   x > d:      ψ = t e^{ik(x − d)}
 *
 * 壁の中は右端から逆向きにたどった形で持つ: ψ(x) = t[c(y) − ik s(y)]、
 * y = d − x、c = cosh κy、s = sinh(κy)/κ。t は小さく c は大きいので、
 * 積 t·c(d) = A と比 ρ(y) = c(y)/c(d) ≤ 1、σ(y) = s(y)/c(y) = tanh(κy)/κ に
 * 分けておけば、どんなに厚い壁でもあふれも桁落ちも起きない。
 * E ≥ V では c = cos k'y・s = sin(k'y)/k'(値が有界なのでそのまま持つ)。
 */
export interface BarrierSolution {
  E: number;
  V: number;
  d: number;
  /** C/m* [eV·nm²] */
  c: number;
  /** 壁の外の波数 k [nm⁻¹] */
  k: number;
  /** 壁の中の κ²(E > V なら −k'²)[nm⁻²] */
  q: number;
  /** 壁の中の √|q| [nm⁻¹] */
  root: number;
  /** A = t·c(d)(E < V)または t(E ≥ V)の実部・虚部 */
  aRe: number;
  aIm: number;
  /** ln c(d)(E < V のときだけ使う) */
  logCd: number;
  /** 反射振幅 r */
  rRe: number;
  rIm: number;
  /** 透過振幅 t の実部・虚部(極端に厚い壁では 0 にアンダーフローしうる) */
  tRe: number;
  tIm: number;
  /** 透過率 T = |t|²(logTransmission と同じ値) */
  T: number;
}

/** 壁の中の 2 つの基本解 c(y), s(y) を (out.re, out.im) = (c, s) に書く(E ≥ V 用) */
function oscillatory(q: number, root: number, y: number, out: Complex): void {
  if (q < 0) {
    out.re = Math.cos(root * y);
    out.im = root > 0 ? Math.sin(root * y) / root : y;
  } else {
    // q = 0(E = V): ψ'' = 0 なので c = 1, s = y
    out.re = 1;
    out.im = y;
  }
}

const scratch: Complex = { re: 0, im: 0 };

/**
 * 定常解の係数を求める(パラメータが変わったときに 1 回だけ呼ぶ)。
 * E は正であること(E ≤ 0 では入射する波がない)。
 */
export function solveBarrier(
  E: number,
  V: number,
  d: number,
  massRatio = 1,
): BarrierSolution {
  const c = HBAR2_OVER_2ME / massRatio;
  const k = Math.sqrt(Math.max(E, 1e-12) / c);
  const q = (V - E) / c;
  const root = Math.sqrt(Math.abs(q));
  const sol: BarrierSolution = {
    E,
    V,
    d,
    c,
    k,
    q,
    root,
    aRe: 0,
    aIm: 0,
    logCd: 0,
    rRe: 0,
    rIm: 0,
    tRe: 0,
    tIm: 0,
    T: 0,
  };
  // 透過振幅 t = 2 / [2c(d) + i s(d)(q − k²)/k](本文の行列の計算から)
  const g = (q - k * k) / k;
  if (q > 0) {
    // t·c(d) = A = 2/(2 + iτg)、τ = s(d)/c(d) = tanh(κd)/κ
    const tau = Math.tanh(root * d) / root;
    const den = 4 + tau * g * (tau * g);
    sol.aRe = 4 / den;
    sol.aIm = (-2 * tau * g) / den;
    sol.logCd = logCosh(root * d);
    // ψ(0) = A(1 − ikτ)
    const p0Re = sol.aRe + sol.aIm * k * tau;
    const p0Im = sol.aIm - sol.aRe * k * tau;
    sol.rRe = p0Re - 1;
    sol.rIm = p0Im;
    const scale = Math.exp(-sol.logCd);
    sol.tRe = sol.aRe * scale;
    sol.tIm = sol.aIm * scale;
  } else {
    oscillatory(q, root, d, scratch);
    const cd = scratch.re;
    const sd = scratch.im;
    // t = 2/(2cd + i sd·g)
    const dRe = 2 * cd;
    const dIm = sd * g;
    const den = dRe * dRe + dIm * dIm;
    sol.tRe = (2 * dRe) / den;
    sol.tIm = (-2 * dIm) / den;
    sol.aRe = sol.tRe;
    sol.aIm = sol.tIm;
    // ψ(0) = t(cd − ik sd)
    const p0Re = sol.tRe * cd + sol.tIm * k * sd;
    const p0Im = sol.tIm * cd - sol.tRe * k * sd;
    sol.rRe = p0Re - 1;
    sol.rIm = p0Im;
  }
  sol.T = Math.exp(logTransmission(E, V, d, massRatio));
  return sol;
}

/** 定常解 ψ(x) を out に書いて返す(フレーム内で呼んでも割当てなし) */
export function evalWave(
  sol: BarrierSolution,
  x: number,
  out: Complex,
): Complex {
  const { k, d } = sol;
  if (x < 0) {
    const cr = Math.cos(k * x);
    const si = Math.sin(k * x);
    // e^{ikx} + r e^{−ikx}
    out.re = cr + sol.rRe * cr + sol.rIm * si;
    out.im = si + sol.rIm * cr - sol.rRe * si;
    return out;
  }
  if (x > d) {
    const ph = k * (x - d);
    const cr = Math.cos(ph);
    const si = Math.sin(ph);
    out.re = sol.tRe * cr - sol.tIm * si;
    out.im = sol.tRe * si + sol.tIm * cr;
    return out;
  }
  const y = d - x;
  if (sol.q > 0) {
    const ky = sol.root * y;
    const rho = Math.exp(logCosh(ky) - sol.logCd); // c(y)/c(d) ≤ 1
    const sigma = Math.tanh(ky) / sol.root; // s(y)/c(y)
    // A ρ (1 − ikσ)
    const fRe = rho;
    const fIm = -rho * k * sigma;
    out.re = sol.aRe * fRe - sol.aIm * fIm;
    out.im = sol.aRe * fIm + sol.aIm * fRe;
    return out;
  }
  oscillatory(sol.q, sol.root, y, scratch);
  const cy = scratch.re;
  const sy = scratch.im;
  // t (c(y) − ik s(y))
  out.re = sol.tRe * cy + sol.tIm * k * sy;
  out.im = sol.tIm * cy - sol.tRe * k * sy;
  return out;
}

/** 定常解 ψ(x)(便利関数。呼ぶたびに解き直すので、描画のループでは使わない) */
export function stationaryWave(
  E: number,
  V: number,
  d: number,
  x: number,
  massRatio = 1,
): Complex {
  return evalWave(solveBarrier(E, V, d, massRatio), x, { re: 0, im: 0 });
}

/**
 * 壁の中の解を ψ = α e^{−κx} + β e^{κx} と分けたときの、減っていく成分の
 * 振幅 |α|(E < V のときだけ意味を持つ。E ≥ V では 0)。
 * 図2 の破線(包絡線 |α|² e^{−2κx})に使う。
 */
export function decayingAmplitude(sol: BarrierSolution): number {
  if (!(sol.q > 0)) return 0;
  const { k, root } = sol;
  // ψ(0) = 1 + r、ψ'(0) = ik(1 − r)
  const p0Re = 1 + sol.rRe;
  const p0Im = sol.rIm;
  const dpRe = k * sol.rIm;
  const dpIm = k * (1 - sol.rRe);
  // α = (ψ(0) − ψ'(0)/κ)/2
  const aRe = (p0Re - dpRe / root) / 2;
  const aIm = (p0Im - dpIm / root) / 2;
  return Math.hypot(aRe, aIm);
}

/* ---------------------------------------------- 傾いた壁(図7 の書き込み) */

/**
 * 三角障壁の WKB 指数 (4/3) κ₀ φ/(qF)(式 E7 — ファウラー・ノルドハイム)。
 * phi: 壁の高さ [eV]、field: 電場 [V/nm]。T ≈ exp(−この値)。
 */
export function triangularExponent(
  phi: number,
  field: number,
  massRatio = 1,
): number {
  if (!(field > 0)) return Infinity;
  return (4 / 3) * kappa(phi, massRatio) * (phi / field);
}

/**
 * 電場 F で傾いた厚さ d の壁の WKB 指数 2∫κ(x)dx。
 * 電場が壁を傾けきる(qFd ≥ φ)と三角の壁(ファウラー・ノルドハイム)、
 * そこまでいかないと台形の壁(直接トンネル)になる。F → 0 で 2κd に戻る。
 * 台形の式 (4/3)√(m* / C)(φ^{3/2} − (φ − qFd)^{3/2})/(qF) は、小さな F での
 * 桁落ちを避けるため a^{3/2} − b^{3/2} = (a − b)(a + √(ab) + b)/(√a + √b) の形で計算する。
 */
export function tiltedBarrierExponent(
  phi: number,
  field: number,
  d: number,
  massRatio = 1,
): number {
  if (!(phi > 0) || !(d > 0)) return 0;
  const drop = Math.max(field, 0) * d;
  if (drop >= phi) return triangularExponent(phi, field, massRatio);
  const s = Math.sqrt(massRatio / HBAR2_OVER_2ME);
  const a = phi;
  const b = phi - drop;
  const sa = Math.sqrt(a);
  const sb = Math.sqrt(b);
  return (4 / 3) * s * d * ((a + sa * sb + b) / (sa + sb));
}

/* ------------------------------------- フラッシュメモリの平均時間(図7) */

/** トンネル酸化膜の壁の条件(既定は SiO₂: 3.1 eV・0.42 m・ν = 10¹⁴ s⁻¹) */
export interface OxideOptions {
  /** 壁の高さ [eV] */
  barrier?: number;
  /** 有効質量(m* と m の比) */
  massRatio?: number;
  /** 電子が壁に当たる頻度の目安 ν [s⁻¹] */
  attemptFrequency?: number;
}

/**
 * 保持(電圧をかけていない平らな壁)で、電子 1 個が抜け出すまでの平均時間
 * τ = 1/(νT) の自然対数 ln τ。T ≈ e^{−2κd}(式 E3)。対数のまま返すので、
 * どんなに厚い膜でもあふれない。
 */
export function logRetentionTime(d: number, opts: OxideOptions = {}): number {
  const barrier = opts.barrier ?? SIO2_BARRIER_EV;
  const m = opts.massRatio ?? SIO2_MASS_RATIO;
  const nu = opts.attemptFrequency ?? ATTEMPT_FREQUENCY_HZ;
  return -logTransmissionApprox(barrier, d, m) - Math.log(nu);
}

/** 保持の平均時間 τ = 1/(νT) [s](厚さ d [nm]) */
export function retentionTime(d: number, opts: OxideOptions = {}): number {
  return Math.exp(logRetentionTime(d, opts));
}

/**
 * 書き込み(電場 fieldMVcm [MV/cm] で傾けた壁)で電子 1 個が通り抜けるまでの
 * 平均時間 τ = 1/(νT) の自然対数。T は傾いた壁の WKB(式 E7 — 膜が厚ければ
 * ファウラー・ノルドハイムの三角の壁)。
 */
export function logWriteTime(
  d: number,
  fieldMVcm: number,
  opts: OxideOptions = {},
): number {
  const barrier = opts.barrier ?? SIO2_BARRIER_EV;
  const m = opts.massRatio ?? SIO2_MASS_RATIO;
  const nu = opts.attemptFrequency ?? ATTEMPT_FREQUENCY_HZ;
  const field = fieldMVcm * MV_PER_CM_TO_V_PER_NM;
  return tiltedBarrierExponent(barrier, field, d, m) - Math.log(nu);
}

/** 書き込みの平均時間の目安 [s](ファウラー・ノルドハイムのトンネル) */
export function fowlerNordheimTime(
  d: number,
  fieldMVcm: number,
  opts: OxideOptions = {},
): number {
  return Math.exp(logWriteTime(d, fieldMVcm, opts));
}
