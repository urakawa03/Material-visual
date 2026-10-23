/**
 * cahnhilliard.ts — カーン・ヒリアード方程式の半陰的フーリエ・スペクトル法
 * (記事仕様書 09 §5.0・式 E8。図1・図6・図7 で共用。純クラス・DOM なし)
 *
 *   ∂c/∂t = M ∇²( g'(c) − κ∇²c ),   M = 1、周期境界、格子間隔 1
 *
 * を、安定化定数 A つきの半陰的スキーム
 *
 *   ĉⁿ⁺¹ = [ ĉⁿ − Δt k² F{g'(cⁿ) − A cⁿ} ] / (1 + Δt A k² + Δt κ k⁴)
 *
 * で進める。k = 0 の成分は式の形から変わらないので、平均組成は厳密に
 * 保存される。対数の特異点を避けるため c を [1e−6, 1−1e−6] にクランプして
 * から g' を評価する。
 *
 * 実装: スペクトル ĉ を状態として持ち、1 ステップで「g'(c) の順変換」と
 * 「ĉ の逆変換」の 2 回だけ実数 FFT(src/core/fft.ts)を呼ぶ。配列はすべて
 * 生成時に確保し、ステップ中は割り当てない(母体仕様 §8.3)。
 *
 * 2D は nx × ny(どちらも 2 のべき乗)。ny = 1 にすると 1 次元になる
 * (線形成長率のテスト T5 で使う)。
 */

import { createRealFFT2D, type RealFFT2D } from "../../../core/fft";
import { mulberry32 } from "../../../core/mathx";
import { C_CLAMP, binodal, d2gdc2, maxGrowthRate } from "./regular";

/** 勾配エネルギー係数 κ の既定値(既定条件で λ_m ≈ 12.6 格子 — §5.0) */
export const KAPPA = 4;
/** 安定化定数 A の基準値(既定の温度 T/Tc = 2/3 で十分 — §5.0) */
export const A_BASE = 8;
/** 時間刻み Δt(図6・図7。定数として固定し、読者には触らせない — §5.0) */
export const DT = 0.5;

/**
 * 温度に応じた安定化定数 A(χ)。
 *
 * 陽に扱う g' の勾配(バルクの相の g'')が大きいと、Δt = 0.5 では A = 8 でも
 * 振動して発散する(低温 T/Tc ≲ 0.58 で実際に起きる — 試作で確認)。
 * エネルギーが単調に減る十分条件 A ≥ max|g''|/2 を、平衡組成より少し外側
 * (0.85 c_b)まで含めて満たすように選ぶ。既定の温度(T/Tc ≥ 0.63)では
 * 基準値 A = 8 のまま。
 */
export function stabilizationFor(chi: number): number {
  if (chi <= 2) return A_BASE;
  const cLow = 0.85 * binodal(chi);
  return Math.max(A_BASE, 0.5 * d2gdc2(cLow, chi));
}

/**
 * 線形段階(模様が浮かび上がるまで)の時間刻み。安定化の項 A は時間刻み
 * の誤差として線形の増幅率を下げ、最も速く育つ波長を長い側へずらす
 * (Δt = 0.5・A = 8 では 17% ずれる)。線形段階だけ Δt を A に応じて細かく
 * して(A = 8 で Δt = 0.05 — ずれは 3%)、図5 の予測(λ_m)と図6 の初期の
 * 模様を一致させる(§5.8 T7)。
 */
export function earlyDt(A: number): number {
  return Math.min(DT, 0.4 / A);
}

/** 線形段階の長さを決める、最大増幅率での e 倍の回数 */
const LINEAR_STAGE_EFOLDS = 8;
/** 線形段階の長さの上限 [時間単位](スピノーダルの境目付近で無限に延びないように) */
const LINEAR_STAGE_MAX = 150;

/**
 * 線形段階の長さ [時間単位]。スピノーダルの外(育つ波がない)では 0。
 * 最大増幅率 R_max で約 8 回 e 倍になるまで(既定条件で 32)。
 */
export function linearStageDuration(
  c0: number,
  chi: number,
  kappa: number = KAPPA,
): number {
  const r = maxGrowthRate(c0, chi, kappa);
  if (r <= 0) return 0;
  return Math.min(LINEAR_STAGE_MAX, LINEAR_STAGE_EFOLDS / r);
}

export interface CahnHilliardOptions {
  /** 格子の大きさ(2 のべき乗)。ny = 1 で 1 次元 */
  nx: number;
  ny: number;
  /** χ = Ω/RT */
  chi: number;
  /** 勾配エネルギー係数(既定 KAPPA) */
  kappa?: number;
  /** 安定化定数(既定 stabilizationFor(chi)) */
  A?: number;
  /** 時間刻み(既定 DT) */
  dt?: number;
}

export class CahnHilliard {
  readonly nx: number;
  readonly ny: number;
  /** 格子点の数 nx·ny */
  readonly size: number;
  /** 濃度場 c(実空間、行優先 index = y·nx + x)。ステップごとに更新される */
  readonly c: Float64Array;
  /** 経過時間(無次元)とステップ数 */
  time = 0;
  steps = 0;

  private chiValue: number;
  private kappaValue: number;
  private aValue: number;
  private dtValue: number;
  private readonly fft: RealFFT2D;
  private readonly hx: number;
  private readonly specSize: number;
  /** ĉ(半分のスペクトル) */
  private readonly cRe: Float64Array;
  private readonly cIm: Float64Array;
  /** g'(c) とそのスペクトル */
  private readonly gp: Float64Array;
  private readonly gRe: Float64Array;
  private readonly gIm: Float64Array;
  /** 各成分の k² と |k|、パーセバルの重み(kx = 0, nx/2 は 1、ほかは 2) */
  private readonly k2: Float64Array;
  private readonly kAbs: Float64Array;
  private readonly weight: Float64Array;
  /** Δt k² と 1/(1 + Δt A k² + Δt κ k⁴)(Δt・A・κ が変わったら作り直す) */
  private readonly dtk2: Float64Array;
  private readonly invDen: Float64Array;
  private denDirty = true;

  constructor(opts: CahnHilliardOptions) {
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.size = opts.nx * opts.ny;
    this.chiValue = opts.chi;
    this.kappaValue = opts.kappa ?? KAPPA;
    this.aValue = opts.A ?? stabilizationFor(opts.chi);
    this.dtValue = opts.dt ?? DT;
    this.fft = createRealFFT2D(opts.nx, opts.ny);
    this.hx = this.fft.hx;
    this.specSize = this.hx * opts.ny;
    this.c = new Float64Array(this.size);
    this.cRe = new Float64Array(this.specSize);
    this.cIm = new Float64Array(this.specSize);
    this.gp = new Float64Array(this.size);
    this.gRe = new Float64Array(this.specSize);
    this.gIm = new Float64Array(this.specSize);
    this.k2 = new Float64Array(this.specSize);
    this.kAbs = new Float64Array(this.specSize);
    this.weight = new Float64Array(this.specSize);
    this.dtk2 = new Float64Array(this.specSize);
    this.invDen = new Float64Array(this.specSize);
    const { nx, ny, hx } = this;
    for (let j = 0; j < ny; j++) {
      const my = j < ny / 2 ? j : j - ny;
      const ky = (2 * Math.PI * my) / ny;
      for (let i = 0; i < hx; i++) {
        const kx = (2 * Math.PI * i) / nx;
        const idx = j * hx + i;
        this.k2[idx] = kx * kx + ky * ky;
        this.kAbs[idx] = Math.sqrt(this.k2[idx]);
        this.weight[idx] = i === 0 || 2 * i === nx ? 1 : 2;
      }
    }
  }

  /* ------------------------------------------------------------ パラメータ */

  get chi(): number {
    return this.chiValue;
  }
  get kappa(): number {
    return this.kappaValue;
  }
  get A(): number {
    return this.aValue;
  }
  get dt(): number {
    return this.dtValue;
  }

  /** χ を変える(A は与えなければ stabilizationFor(χ) にする) */
  setChi(chi: number, A: number = stabilizationFor(chi)): void {
    this.chiValue = chi;
    if (A !== this.aValue) {
      this.aValue = A;
      this.denDirty = true;
    }
  }

  setKappa(kappa: number): void {
    if (kappa !== this.kappaValue) {
      this.kappaValue = kappa;
      this.denDirty = true;
    }
  }

  setDt(dt: number): void {
    if (dt !== this.dtValue) {
      this.dtValue = dt;
      this.denDirty = true;
    }
  }

  private rebuildDenominator(): void {
    const { dtValue: dt, aValue: A, kappaValue: kappa } = this;
    for (let i = 0; i < this.specSize; i++) {
      const k2 = this.k2[i];
      this.dtk2[i] = dt * k2;
      this.invDen[i] = 1 / (1 + dt * A * k2 + dt * kappa * k2 * k2);
    }
    this.denDirty = false;
  }

  /* --------------------------------------------------------------- 初期化 */

  /** 濃度場 c を書き換えたあとにスペクトルを作り直す */
  syncSpectrum(): void {
    this.fft.forward(this.c, this.cRe, this.cIm);
  }

  /**
   * 一様な組成 c0 + 振幅 amplitude の一様乱数のゆらぎ(シード固定)にする。
   * ゆらぎの平均を引いて、平均組成をちょうど c0 にする。時刻は 0 に戻す。
   */
  initUniform(c0: number, amplitude: number, seed: number): void {
    const rand = mulberry32(seed);
    const { c, size } = this;
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const v = amplitude * (2 * rand() - 1);
      c[i] = v;
      sum += v;
    }
    const shift = c0 - sum / size;
    for (let i = 0; i < size; i++) c[i] += shift;
    this.time = 0;
    this.steps = 0;
    this.syncSpectrum();
  }

  /**
   * 中心 (cx, cy)・半径 radius の円の内側を組成 cInside にする(核を置く)。
   * conserve = true なら、足した B の量を円の外から一様に差し引いて
   * 平均組成を保つ(核の B は母相から集めたものとする)。
   * 周期境界で折り返す。書き換えた格子点の数を返す。
   */
  addDisk(
    cx: number,
    cy: number,
    radius: number,
    cInside: number,
    conserve: boolean,
  ): number {
    const { nx, ny, c } = this;
    const r2 = radius * radius;
    let excess = 0;
    let inside = 0;
    for (let y = 0; y < ny; y++) {
      const dy = wrap(y - cy, ny);
      for (let x = 0; x < nx; x++) {
        const dx = wrap(x - cx, nx);
        if (dx * dx + dy * dy <= r2) {
          const i = y * nx + x;
          excess += cInside - c[i];
          c[i] = cInside;
          inside++;
        }
      }
    }
    if (conserve && inside < this.size) {
      const delta = excess / (this.size - inside);
      for (let y = 0; y < ny; y++) {
        const dy = wrap(y - cy, ny);
        for (let x = 0; x < nx; x++) {
          const dx = wrap(x - cx, nx);
          if (dx * dx + dy * dy > r2) c[y * nx + x] -= delta;
        }
      }
    }
    this.syncSpectrum();
    return inside;
  }

  /* ------------------------------------------------------------- 時間発展 */

  /** count ステップ進める(現在の Δt で) */
  step(count = 1): void {
    if (this.denDirty) this.rebuildDenominator();
    const { c, gp, size, cRe, cIm, gRe, gIm, dtk2, invDen, specSize } = this;
    const chi = this.chiValue;
    const A = this.aValue;
    const lo = C_CLAMP;
    const hi = 1 - C_CLAMP;
    for (let s = 0; s < count; s++) {
      for (let i = 0; i < size; i++) {
        const v = c[i];
        const cc = v < lo ? lo : v > hi ? hi : v;
        gp[i] = chi * (1 - 2 * cc) + Math.log(cc / (1 - cc));
      }
      this.fft.forward(gp, gRe, gIm);
      for (let i = 0; i < specSize; i++) {
        const f = dtk2[i];
        const d = invDen[i];
        cRe[i] = (cRe[i] - f * (gRe[i] - A * cRe[i])) * d;
        cIm[i] = (cIm[i] - f * (gIm[i] - A * cIm[i])) * d;
      }
      this.fft.inverse(cRe, cIm, c);
      this.time += this.dtValue;
      this.steps++;
    }
  }

  /* ---------------------------------------------------------------- 計測 */

  /** 平均組成(スペクトルの k = 0 成分から。ステップでは厳密に不変) */
  meanFromSpectrum(): number {
    return this.cRe[0] / this.size;
  }

  /** 平均組成(実空間の和から) */
  mean(): number {
    let s = 0;
    for (let i = 0; i < this.size; i++) s += this.c[i];
    return s / this.size;
  }

  /** 濃度の分散 ⟨(c − c̄)²⟩(パーセバルでスペクトルから) */
  variance(): number {
    let s = 0;
    for (let i = 1; i < this.specSize; i++) {
      s += this.weight[i] * (this.cRe[i] ** 2 + this.cIm[i] ** 2);
    }
    return s / (this.size * this.size);
  }

  /**
   * 1 格子点あたりの自由エネルギー [RT]
   *   F/N = ⟨g(c)⟩ + (κ/2)⟨|∇c|²⟩
   * 勾配の項はスキームと同じスペクトルの微分で評価する(パーセバル)。
   */
  freeEnergy(): number {
    const { c, size } = this;
    const chi = this.chiValue;
    let bulk = 0;
    for (let i = 0; i < size; i++) {
      const v = c[i];
      const cc = v < C_CLAMP ? C_CLAMP : v > 1 - C_CLAMP ? 1 - C_CLAMP : v;
      bulk +=
        chi * cc * (1 - cc) + cc * Math.log(cc) + (1 - cc) * Math.log(1 - cc);
    }
    let grad = 0;
    for (let i = 1; i < this.specSize; i++) {
      grad +=
        this.weight[i] * this.k2[i] * (this.cRe[i] ** 2 + this.cIm[i] ** 2);
    }
    return bulk / size + (0.5 * this.kappaValue * grad) / (size * size);
  }

  /**
   * 散乱強度 S(k) = |ĉ_k|²/N を放射方向に平均する(正方格子用)。
   * out[b] に半径 b(|m| を四捨五入した整数、b = 1 … nx/2 − 1)の平均を書く。
   * 対応する波数は k_b = 2πb/nx。out[0] は 0。
   */
  radialStructureFactor(out: Float64Array, counts: Float64Array): void {
    out.fill(0);
    counts.fill(0);
    const { ny, hx } = this;
    const nb = out.length;
    for (let j = 0; j < ny; j++) {
      const my = j < ny / 2 ? j : j - ny;
      for (let i = 0; i < hx; i++) {
        if (i === 0 && j === 0) continue;
        const b = Math.round(Math.sqrt(i * i + my * my));
        if (b >= nb) continue;
        const idx = j * hx + i;
        const w = this.weight[idx];
        out[b] += (w * (this.cRe[idx] ** 2 + this.cIm[idx] ** 2)) / this.size;
        counts[b] += w;
      }
    }
    for (let b = 0; b < nb; b++) if (counts[b] > 0) out[b] /= counts[b];
  }

  /**
   * 代表長さ L = 2π Σ S(k) / Σ |k| S(k)(全成分、k = 0 を除く — §5.6)。
   * 模様がなければ(分散が 0)NaN。
   */
  characteristicLength(): number {
    let s0 = 0;
    let s1 = 0;
    for (let i = 1; i < this.specSize; i++) {
      const p = this.weight[i] * (this.cRe[i] ** 2 + this.cIm[i] ** 2);
      s0 += p;
      s1 += p * this.kAbs[i];
    }
    return s1 > 0 ? (2 * Math.PI * s0) / s1 : NaN;
  }

  /**
   * 波数の添字 (mx, my)(mx ≥ 0)のフーリエ成分の振幅。
   * c = c̄ + a cos(k·r + φ) のとき a を返す(1 次元なら my = 0)。
   */
  modeAmplitude(mx: number, my: number): number {
    const j = my >= 0 ? my : my + this.ny;
    const idx = j * this.hx + mx;
    const mag = Math.hypot(this.cRe[idx], this.cIm[idx]);
    // −k に共役な相方がいない(自分自身が −k と同じ)成分だけ係数 1
    const selfConjugate =
      (mx === 0 || 2 * mx === this.nx) && (j === 0 || 2 * j === this.ny);
    return ((selfConjugate ? 1 : 2) * mag) / this.size;
  }
}

/** 周期境界での最短の差(−n/2 … n/2) */
function wrap(d: number, n: number): number {
  let v = d % n;
  if (v > n / 2) v -= n;
  else if (v < -n / 2) v += n;
  return v;
}
