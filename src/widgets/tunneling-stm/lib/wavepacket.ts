/**
 * wavepacket.ts — 図1 の 1 次元時間依存シュレーディンガー方程式(仕様書 14 §5.1)
 *
 * クランク=ニコルソン法で解く:
 *
 *   (1 + iHΔt/2ħ) ψⁿ⁺¹ = (1 − iHΔt/2ħ) ψⁿ,
 *   Hψ_j = −C(ψ_{j+1} − 2ψ_j + ψ_{j−1})/Δx² + V_j ψ_j   (C = ħ²/2m)
 *
 * 左辺の三重対角行列はパラメータが変わるまで一定なので、トーマス法の前進消去の
 * 係数(各行の対角の逆数と c')を configure() で 1 回だけ求めておく。毎ステップは
 * 右辺の計算・前進代入・後退代入だけで、新規の割当てはない(母体仕様 §8.3)。
 * 境界は ψ = 0(固定端)。H はエルミートなので、この時間発展はユニタリで、
 * 確率の総和は丸め誤差の範囲で 1 のまま保たれる(T3)。吸収境界は使わず、
 * 波束が表示範囲の端から 3σ に近づいたら止める(isScatteringOver)。
 *
 * **表示範囲の左に 4 nm の余白を取る理由**: 中心 4 nm・幅 σ = 1 nm のガウス型の
 * 波束は、0 nm の位置でまだ振幅の 2% が残っている。そこで切ると、切り口が
 * 壁を飛び越える高いエネルギーの成分を作ってしまい、厚い壁では本物の透過より
 * 何百倍も大きな「にせの透過」が現れる(試作で確認)。そこで計算領域を
 * −4〜20 nm(1200 点、Δx = 0.02 nm)に取り、表示は 0〜20 nm(1000 点)だけにする。
 *
 * 単位: x [nm]、t [fs]、E [eV]。
 */

import { HBAR2_OVER_2ME, HBAR_EV_FS } from "./constants";
import { transmission } from "./tunneling";

/** 計算領域と初期波束の既定値(§5.1) */
export const PACKET_DEFAULTS = {
  /** 計算領域の左端・右端 [nm](表示は viewMin〜viewMax) */
  xMin: -4,
  xMax: 20,
  viewMin: 0,
  viewMax: 20,
  /** 格子間隔 [nm] と時間刻み [fs] */
  dx: 0.02,
  dt: 0.05,
  /** 初期波束の中心と幅(|ψ|² の標準偏差)[nm] */
  x0: 4,
  sigma: 1,
} as const;

/** 散乱が終わったとみなす、表示範囲の端からの距離(波束の幅の何倍か) */
const EDGE_SIGMAS = 3;
/** この確率より小さい部分は重心を計算しない */
const TINY_PROBABILITY = 1e-14;
/** 安全のための最大時間 [fs](これを超えたら必ず止める) */
const MAX_TIME_FS = 120;

export interface PacketSetup {
  /** 電子のエネルギー E [eV] */
  energy: number;
  /** 壁の高さ V [eV] */
  barrierHeight: number;
  /** 壁の左端 [nm] */
  barrierStart: number;
  /** 壁の厚さ d [nm] */
  barrierWidth: number;
}

export type PacketOptions = Partial<
  Record<keyof typeof PACKET_DEFAULTS, number>
>;

export class WavePacket {
  readonly xMin: number;
  readonly dx: number;
  readonly dt: number;
  readonly n: number;
  readonly x0: number;
  readonly sigma: number;
  readonly viewMin: number;
  readonly viewMax: number;
  /** ψ の実部・虚部(格子点 j の位置は xMin + jΔx) */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** ポテンシャル V_j [eV] */
  readonly pot: Float64Array;

  /** 右辺と左辺の対角の虚部 2α + V_jΔt/2ħ(左辺は 1 + i·これ、右辺は 1 − i·これ) */
  private readonly diag: Float64Array;
  /** トーマス法: 前進消去後の対角の逆数 1/(a_j − b c'_{j−1}) */
  private readonly invRe: Float64Array;
  private readonly invIm: Float64Array;
  /** トーマス法の c'_j と d'_j */
  private readonly cpRe: Float64Array;
  private readonly cpIm: Float64Array;
  private readonly dpRe: Float64Array;
  private readonly dpIm: Float64Array;
  /** α = CΔt/(2ħΔx²)(非対角は −iα) */
  private readonly alpha: number;

  energy = 1;
  barrierHeight = 4;
  barrierStart = 9.5;
  barrierWidth = 0.5;
  /** 壁の格子点の範囲 [jStart, jEnd) */
  jStart = 0;
  jEnd = 0;
  /** 表示範囲の格子点の範囲 [jView0, jView1) */
  readonly jView0: number;
  readonly jView1: number;
  /** 初期波束の平均波数(格子の分散で E に合わせたもの)[nm⁻¹] */
  k0 = 1;
  /** 波束の中心の速さ v₀ = 2Ck₀/ħ [nm/fs] */
  v0 = 1;
  /** 経過時間 [fs] とステップ数 */
  time = 0;
  steps = 0;

  constructor(opts: PacketOptions = {}) {
    const o = { ...PACKET_DEFAULTS, ...opts };
    this.xMin = o.xMin;
    this.dx = o.dx;
    this.dt = o.dt;
    this.x0 = o.x0;
    this.sigma = o.sigma;
    this.viewMin = o.viewMin;
    this.viewMax = o.viewMax;
    this.n = Math.round((o.xMax - o.xMin) / o.dx);
    this.jView0 = Math.round((o.viewMin - o.xMin) / o.dx);
    this.jView1 = Math.min(this.n, Math.round((o.viewMax - o.xMin) / o.dx));
    const n = this.n;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.pot = new Float64Array(n);
    this.diag = new Float64Array(n);
    this.invRe = new Float64Array(n);
    this.invIm = new Float64Array(n);
    this.cpRe = new Float64Array(n);
    this.cpIm = new Float64Array(n);
    this.dpRe = new Float64Array(n);
    this.dpIm = new Float64Array(n);
    this.alpha = (HBAR2_OVER_2ME * o.dt) / (2 * HBAR_EV_FS * o.dx * o.dx);
  }

  /** 格子点 j の位置 [nm] */
  x(j: number): number {
    return this.xMin + j * this.dx;
  }

  /** 格子点 j の確率密度 |ψ|² [nm⁻¹] */
  density(j: number): number {
    return this.re[j] * this.re[j] + this.im[j] * this.im[j];
  }

  /** ポテンシャルと初期波束を設定し、行列を分解し直す(パラメータ変更時に呼ぶ) */
  configure(setup: PacketSetup): void {
    this.energy = setup.energy;
    this.barrierHeight = setup.barrierHeight;
    this.barrierStart = setup.barrierStart;
    this.barrierWidth = setup.barrierWidth;
    const n = this.n;
    // 壁: barrierStart ≤ x < barrierStart + d の格子点(round(d/Δx) 点)
    this.jStart = Math.round((setup.barrierStart - this.xMin) / this.dx);
    this.jEnd =
      this.jStart + Math.max(1, Math.round(setup.barrierWidth / this.dx));
    const beta = (setup.barrierHeight * this.dt) / (2 * HBAR_EV_FS);
    for (let j = 0; j < n; j++) {
      const inside = j >= this.jStart && j < this.jEnd;
      this.pot[j] = inside ? setup.barrierHeight : 0;
      this.diag[j] = 2 * this.alpha + (inside ? beta : 0);
    }
    // 前進消去の係数: 左辺の行 j は (1 + i·diag_j)、非対角 b = −iα
    // c'_j = b / (a_j − b c'_{j−1})
    const bIm = -this.alpha;
    let cRe = 0;
    let cIm = 0;
    for (let j = 0; j < n; j++) {
      // m = a_j − b c'_{j−1}、b c' = (−iα)(cRe + i cIm) = α cIm − iα cRe
      const mRe = 1 - -bIm * cIm;
      const mIm = this.diag[j] - bIm * cRe;
      const den = mRe * mRe + mIm * mIm;
      this.invRe[j] = mRe / den;
      this.invIm[j] = -mIm / den;
      // c'_j = b · inv_j = (−iα)(invRe + i invIm) = α invIm − iα invRe
      cRe = -bIm * this.invIm[j];
      cIm = bIm * this.invRe[j];
      this.cpRe[j] = cRe;
      this.cpIm[j] = cIm;
    }
    // 格子の上の平面波のエネルギー 2C(1 − cos kΔx)/Δx² が E になる波数
    const arg = 1 - (setup.energy * this.dx * this.dx) / (2 * HBAR2_OVER_2ME);
    this.k0 = Math.acos(Math.max(-1, Math.min(1, arg))) / this.dx;
    this.v0 =
      (2 * HBAR2_OVER_2ME * Math.sqrt(setup.energy / HBAR2_OVER_2ME)) /
      HBAR_EV_FS;
    this.reset();
  }

  /** 初期波束(ガウス型、確率の総和を 1 に規格化)に戻す */
  reset(): void {
    const { n, re, im, x0, sigma, k0 } = this;
    const inv4s2 = 1 / (4 * sigma * sigma);
    let norm = 0;
    for (let j = 0; j < n; j++) {
      const x = this.x(j);
      const g = Math.exp(-(x - x0) * (x - x0) * inv4s2);
      re[j] = g * Math.cos(k0 * x);
      im[j] = g * Math.sin(k0 * x);
      norm += (re[j] * re[j] + im[j] * im[j]) * this.dx;
    }
    const s = 1 / Math.sqrt(norm);
    for (let j = 0; j < n; j++) {
      re[j] *= s;
      im[j] *= s;
    }
    this.time = 0;
    this.steps = 0;
  }

  /** 時間を count ステップ(Δt ずつ)進める */
  step(count = 1): void {
    const { n, re, im, diag, invRe, invIm, cpRe, cpIm, dpRe, dpIm, alpha } =
      this;
    for (let s = 0; s < count; s++) {
      // 右辺 r_j = (1 − i·diag_j)ψ_j + iα(ψ_{j+1} + ψ_{j−1}) を作りながら前進代入:
      // d'_j = (r_j − b d'_{j−1}) · inv_j、b = −iα
      let prevRe = 0;
      let prevIm = 0;
      for (let j = 0; j < n; j++) {
        const g = diag[j];
        const sRe = (j > 0 ? re[j - 1] : 0) + (j < n - 1 ? re[j + 1] : 0);
        const sIm = (j > 0 ? im[j - 1] : 0) + (j < n - 1 ? im[j + 1] : 0);
        // (1 − ig)(a + ib) = a + gb + i(b − ga)、iα(sRe + i sIm) = −α sIm + iα sRe
        const rRe = re[j] + g * im[j] - alpha * sIm;
        const rIm = im[j] - g * re[j] + alpha * sRe;
        // r − b d'_{j−1}、b d' = (−iα)(pRe + i pIm) = α pIm − iα pRe
        const uRe = rRe - alpha * prevIm;
        const uIm = rIm + alpha * prevRe;
        prevRe = uRe * invRe[j] - uIm * invIm[j];
        prevIm = uRe * invIm[j] + uIm * invRe[j];
        dpRe[j] = prevRe;
        dpIm[j] = prevIm;
      }
      // 後退代入: ψ_j = d'_j − c'_j ψ_{j+1}
      re[n - 1] = dpRe[n - 1];
      im[n - 1] = dpIm[n - 1];
      for (let j = n - 2; j >= 0; j--) {
        const nRe = re[j + 1];
        const nIm = im[j + 1];
        re[j] = dpRe[j] - (cpRe[j] * nRe - cpIm[j] * nIm);
        im[j] = dpIm[j] - (cpRe[j] * nIm + cpIm[j] * nRe);
      }
    }
    this.time += count * this.dt;
    this.steps += count;
  }

  /** 確率の総和 Σ|ψ|²Δx(計算領域全体) */
  norm(): number {
    let s = 0;
    for (let j = 0; j < this.n; j++) s += this.density(j);
    return s * this.dx;
  }

  /** 壁より左にいる確率(反射した部分 + まだ当たっていない部分) */
  probabilityLeft(): number {
    let s = 0;
    for (let j = 0; j < this.jStart; j++) s += this.density(j);
    return s * this.dx;
  }

  /** 壁より右にいる確率(透過した部分) */
  probabilityRight(): number {
    let s = 0;
    for (let j = this.jEnd; j < this.n; j++) s += this.density(j);
    return s * this.dx;
  }

  /** 時刻 t での自由な波束の幅 σ(t) = σ√(1 + (Ct/ħσ²)²) [nm] */
  widthAt(t: number): number {
    const s2 = this.sigma * this.sigma;
    const r = (HBAR2_OVER_2ME * t) / (HBAR_EV_FS * s2);
    return this.sigma * Math.sqrt(1 + r * r);
  }

  /** 波束の中心が壁に届く時刻の目安 [fs] */
  arrivalTime(): number {
    return (this.barrierStart - this.x0) / this.v0;
  }

  /**
   * 散乱が終わったか。波束の中心が壁に届いたあとで、反射した部分か透過した
   * 部分の重心が表示範囲の端から 3σ(t) 以内に入ったら終わりとする(§5.1)。
   */
  isScatteringOver(): boolean {
    if (this.time >= MAX_TIME_FS) return true;
    if (this.time < this.arrivalTime()) return false;
    let pl = 0;
    let xl = 0;
    for (let j = 0; j < this.jStart; j++) {
      const p = this.density(j);
      pl += p;
      xl += p * j;
    }
    let pr = 0;
    let xr = 0;
    for (let j = this.jEnd; j < this.n; j++) {
      const p = this.density(j);
      pr += p;
      xr += p * j;
    }
    const margin = EDGE_SIGMAS * this.widthAt(this.time);
    if (pl * this.dx > TINY_PROBABILITY) {
      if (this.x(xl / pl) <= this.viewMin + margin) return true;
    }
    if (pr * this.dx > TINY_PROBABILITY) {
      if (this.x(xr / pr) >= this.viewMax - margin) return true;
    }
    return false;
  }
}

/**
 * 波束のエネルギー分布で平均した透過率 ⟨T⟩(T3 の比較の基準、図1 の読み取り)。
 * 幅 σ のガウス型の波束の波数の分布は、中心 k₀ = √(E₀/C)・標準偏差 1/(2σ) の
 * ガウス型。その上で平面波の透過率 T(Ck²) を平均する。
 */
export function averagedTransmission(
  E0: number,
  V: number,
  d: number,
  sigma: number = PACKET_DEFAULTS.sigma,
  samples = 801,
): number {
  const k0 = Math.sqrt(E0 / HBAR2_OVER_2ME);
  const sk = 1 / (2 * sigma);
  const span = 8 * sk;
  let wSum = 0;
  let tSum = 0;
  for (let i = 0; i < samples; i++) {
    const k = k0 - span + (2 * span * i) / (samples - 1);
    if (k <= 0) continue;
    const u = (k - k0) / sk;
    const w = Math.exp(-0.5 * u * u);
    wSum += w;
    tSum += w * transmission(HBAR2_OVER_2ME * k * k, V, d);
  }
  return wSum > 0 ? tSum / wSum : 0;
}

/** 波束のエネルギーの広がり(標準偏差の相対値 ΔE/E ≈ 2σ_k/k₀ = 1/(σk₀)) */
export function relativeEnergySpread(
  E0: number,
  sigma: number = PACKET_DEFAULTS.sigma,
): number {
  return 1 / (sigma * Math.sqrt(E0 / HBAR2_OVER_2ME));
}

/* ------------------------------------------------------- 古典の玉(図1 上段) */

/** 電子の質量を eV·fs²/nm² で表した値 m = ħ²/(2C) */
export const ELECTRON_MASS_EV_FS2_NM2 =
  (HBAR_EV_FS * HBAR_EV_FS) / (2 * HBAR2_OVER_2ME);

/**
 * 図1 上段の坂(台形の山)。頂上の平らな部分が壁と同じ位置・幅
 * [start, start + width]、高さ height、左右に水平距離 slope の斜面を持つ。
 */
export interface Hill {
  start: number;
  width: number;
  slope: number;
  height: number;
}

/** 坂の高さ U(x) [eV](玉の位置エネルギー) */
export function hillHeight(x: number, hill: Hill): number {
  const a0 = hill.start - hill.slope;
  const b1 = hill.start + hill.width + hill.slope;
  if (x <= a0 || x >= b1) return 0;
  if (x < hill.start) return (hill.height * (x - a0)) / hill.slope;
  if (x <= hill.start + hill.width) return hill.height;
  return (hill.height * (b1 - x)) / hill.slope;
}

export type ClassicalOutcome = "bounce" | "cross" | "stall";

/** 古典の玉の結果: E < V なら跳ね返る、E > V なら越える、ちょうど同じなら頂上で止まる */
export function classicalOutcome(E: number, V: number): ClassicalOutcome {
  const tol = 1e-9 * Math.max(1, Math.abs(V));
  if (E > V + tol) return "cross";
  if (E < V - tol) return "bounce";
  return "stall";
}

/**
 * エネルギー E の玉を x0 から右へ転がしたときの、時刻 t [fs] の位置 [nm]。
 * 摩擦のない斜面を等加速度で登り降りする(解析的に求めるので時間に誤差が
 * たまらず、どの時刻でも同じ答えになる)。速さ v₀ = √(2E/m) は波束の中心の
 * 速さと同じ。
 */
export function ballPosition(
  t: number,
  E: number,
  x0: number,
  hill: Hill,
  mass = ELECTRON_MASS_EV_FS2_NM2,
): number {
  const v0 = Math.sqrt((2 * Math.max(E, 0)) / mass);
  const a0 = hill.start - hill.slope;
  const t1 = (a0 - x0) / v0;
  if (t <= t1) return x0 + v0 * t;
  const g = hill.height / (mass * hill.slope); // 斜面での減速度 [nm/fs²]
  const tau = t - t1;
  const outcome = classicalOutcome(E, hill.height);
  if (outcome !== "cross") {
    const ts = v0 / g; // 止まるまでの時間
    if (outcome === "stall") {
      return tau < ts ? a0 + v0 * tau - 0.5 * g * tau * tau : hill.start;
    }
    if (tau <= 2 * ts) return a0 + v0 * tau - 0.5 * g * tau * tau;
    return a0 - v0 * (tau - 2 * ts);
  }
  const v1 = Math.sqrt((2 * (E - hill.height)) / mass);
  const tr = (v0 - v1) / g; // 斜面を登りきる時間
  if (tau <= tr) return a0 + v0 * tau - 0.5 * g * tau * tau;
  const tp = hill.width / v1;
  if (tau <= tr + tp) return hill.start + v1 * (tau - tr);
  const td = tau - tr - tp;
  if (td <= tr) return hill.start + hill.width + v1 * td + 0.5 * g * td * td;
  return hill.start + hill.width + hill.slope + v0 * (td - tr);
}
