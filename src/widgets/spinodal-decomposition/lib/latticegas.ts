/**
 * latticegas.ts — 図4「上り坂拡散」の格子気体(原子交換モンテカルロ)
 * (記事仕様書 09 §5.0・§5.4。純クラス・DOM なし)
 *
 * 正方格子の A/B 格子気体。最近接の結合エネルギーは 2 次元イジング模型と
 * 同じ形 e = −J σᵢσⱼ(σ = +1 が B、−1 が A。同種が隣り合うと −J、異種なら +J)
 * にとり、臨界温度は厳密値 T_c = 2/ln(1+√2) J/k_B ≈ 2.269 J/k_B になる。
 *
 * 動力学はカワサキ動力学: ランダムに選んだ原子と、4 方向から一様に選んだ
 * 隣の原子を入れ替える試行を、メトロポリス法 min(1, e^{−ΔE/k_BT}) で
 * 受け入れる。**試行の向きには偏りがない**。偏っているのは受け入れの確率
 * (エネルギーの地形)だけで、入れ替えなので組成は厳密に保存される。
 * 周期境界。1 掃引 = 格子点の数と同じ回数の試行。
 *
 * 描画のため、受け入れた入れ替えを間引いてリングバッファに記録し、
 * 列の境界を横切った B の正味の数(流束)も数える。
 */

import { mulberry32 } from "../../../core/mathx";

/** 2 次元イジング模型の臨界温度 k_B T_c / J = 2/ln(1+√2) */
export const TC_ISING = 2 / Math.log(1 + Math.SQRT2);

/** 原子の種類 */
export const ATOM_A = 0;
export const ATOM_B = 1;

/** 4 方向(右・左・上・下) */
const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;

/** 入れ替えの記録(描画用)のリングバッファの容量 */
const SWAP_LOG_CAPACITY = 512;

export class LatticeGas {
  readonly cols: number;
  readonly rows: number;
  readonly size: number;
  /** 各格子点の原子(ATOM_A / ATOM_B)。index = row·cols + col */
  readonly occ: Uint8Array;
  /** 列の境界 x+½ を右向きに横切った B の正味の数(resetCounters まで累積) */
  readonly netFlux: Float64Array;
  /** 入れ替えの記録: 格子点の対と、その時点の掃引数(小数部は掃引内の進み) */
  readonly swapSiteA = new Int32Array(SWAP_LOG_CAPACITY);
  readonly swapSiteB = new Int32Array(SWAP_LOG_CAPACITY);
  readonly swapTime = new Float64Array(SWAP_LOG_CAPACITY);
  /** 記録した入れ替えの総数(リングバッファの書き込み位置 = これ mod 容量) */
  swapLogCount = 0;
  /** 受け入れた入れ替えを何回に 1 回記録するか(描画の混雑を避ける) */
  swapLogStride = 1;

  /** 異種どうしの入れ替えを試みた回数と、受け入れた回数 */
  attempted = 0;
  accepted = 0;
  /** 進めた掃引の数 */
  sweeps = 0;

  private tOverTc = 1;
  /** ΔE/J = −12, −8, …, +12 に対する受け入れ確率 */
  private readonly acceptTable = new Float64Array(7);
  private rand: () => number = mulberry32(1);
  private acceptedSinceLog = 0;
  private trialInSweep = 0;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.size = cols * rows;
    this.occ = new Uint8Array(this.size);
    this.netFlux = new Float64Array(cols);
    this.setTemperature(1);
  }

  /** 温度(T/Tc)を設定し、受け入れ確率の表を作り直す */
  setTemperature(tOverTc: number): void {
    this.tOverTc = tOverTc;
    const kT = tOverTc * TC_ISING;
    for (let i = 0; i < 7; i++) {
      const dE = -12 + 4 * i;
      this.acceptTable[i] = Math.min(1, Math.exp(-dE / kT));
    }
  }

  get temperature(): number {
    return this.tOverTc;
  }

  /** メトロポリスの受け入れ確率 min(1, e^{−ΔE/k_BT})(ΔE は J 単位) */
  acceptanceProbability(dE: number): number {
    return this.acceptTable[(dE + 12) / 4];
  }

  /**
   * 列ごとの B の割合を meanB + amplitude·sin(2πx/wavelength) にして置く
   * (シード固定)。各列の B の数はその割合 × 行数を丸めた数で、どの行に
   * 置くかを乱数で選ぶ(列ごとに独立な確率で置くと、測った初期の振幅が
   * 種によって 0.12〜0.17 とばらつくため)。カウンタと記録も初期化する。
   */
  initWave(
    meanB: number,
    amplitude: number,
    wavelength: number,
    seed: number,
  ): void {
    this.rand = mulberry32(seed);
    const { cols, rows, occ } = this;
    const order = new Int32Array(rows);
    for (let x = 0; x < cols; x++) {
      const p = meanB + amplitude * Math.sin((2 * Math.PI * x) / wavelength);
      const nB = Math.max(0, Math.min(rows, Math.round(p * rows)));
      for (let y = 0; y < rows; y++) {
        order[y] = y;
        occ[y * cols + x] = ATOM_A;
      }
      // 部分的なフィッシャー–イェーツで nB 行を選ぶ
      for (let k = 0; k < nB; k++) {
        const j = k + Math.floor(this.rand() * (rows - k));
        const t = order[k];
        order[k] = order[j];
        order[j] = t;
        occ[order[k] * cols + x] = ATOM_B;
      }
    }
    this.sweeps = 0;
    this.attempted = 0;
    this.accepted = 0;
    this.swapLogCount = 0;
    this.acceptedSinceLog = 0;
    this.trialInSweep = 0;
    this.netFlux.fill(0);
  }

  /** B の総数 */
  countB(): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) n += this.occ[i];
    return n;
  }

  /** 流束のカウンタだけを 0 に戻す(読み取りの窓を区切るため) */
  resetFlux(): void {
    this.netFlux.fill(0);
  }

  /**
   * 隣どうし(site と、方向 dir の隣)の入れ替えを 1 回試みる。
   * 同種どうしなら何もしない(false)。異種ならメトロポリスで判定し、
   * 受け入れたら入れ替えて true を返す。
   */
  attemptSwap(site: number, dir: number): boolean {
    const { cols, rows, occ } = this;
    const x = site % cols;
    const y = (site - x) / cols;
    const nx = (x + DX[dir] + cols) % cols;
    const ny = (y + DY[dir] + rows) % rows;
    const other = ny * cols + nx;
    const si = occ[site];
    if (si === occ[other]) return false;
    this.attempted++;
    // ΔE/J = 2σᵢ [ Σ_{N(i)∖j} σ − Σ_{N(j)∖i} σ ]  (σ = 2·occ − 1)
    const sumI = this.neighborSpinSum(x, y) - (2 * occ[other] - 1);
    const sumJ = this.neighborSpinSum(nx, ny) - (2 * si - 1);
    const dE = 2 * (2 * si - 1) * (sumI - sumJ);
    const p = this.acceptTable[(dE + 12) / 4];
    if (p < 1 && this.rand() >= p) return false;
    occ[site] = occ[other];
    occ[other] = si;
    this.accepted++;
    // 列の境界を横切った B の正味の数(横方向の入れ替えだけ)
    if (DY[dir] === 0) {
      // B が site → other へ動いたなら +向き(dir の向き)
      const sign = si === ATOM_B ? DX[dir] : -DX[dir];
      const boundary = DX[dir] > 0 ? x : nx; // 境界 x+½ の添字
      this.netFlux[boundary] += sign;
    }
    if (++this.acceptedSinceLog >= this.swapLogStride) {
      this.acceptedSinceLog = 0;
      const w = this.swapLogCount % SWAP_LOG_CAPACITY;
      this.swapSiteA[w] = site;
      this.swapSiteB[w] = other;
      this.swapTime[w] = this.sweeps + this.trialInSweep / this.size;
      this.swapLogCount++;
    }
    return true;
  }

  private neighborSpinSum(x: number, y: number): number {
    const { cols, rows, occ } = this;
    const xr = x + 1 === cols ? 0 : x + 1;
    const xl = x === 0 ? cols - 1 : x - 1;
    const yu = y + 1 === rows ? 0 : y + 1;
    const yd = y === 0 ? rows - 1 : y - 1;
    const s =
      occ[y * cols + xr] +
      occ[y * cols + xl] +
      occ[yu * cols + x] +
      occ[yd * cols + x];
    return 2 * s - 4;
  }

  /** count 回の掃引(1 掃引 = 格子点の数と同じ回数の試行) */
  sweep(count = 1): void {
    const { size } = this;
    for (let s = 0; s < count; s++) {
      for (let t = 0; t < size; t++) {
        this.trialInSweep = t;
        const site = Math.floor(this.rand() * size);
        const dir = Math.floor(this.rand() * 4);
        this.attemptSwap(site, dir);
      }
      this.trialInSweep = 0;
      this.sweeps++;
    }
  }

  /** 列ごとの B の割合を out(長さ cols)に書く */
  columnProfile(out: Float64Array): void {
    const { cols, rows, occ } = this;
    out.fill(0);
    for (let y = 0; y < rows; y++) {
      const base = y * cols;
      for (let x = 0; x < cols; x++) out[x] += occ[base + x];
    }
    for (let x = 0; x < cols; x++) out[x] /= rows;
  }

  /**
   * 列の濃度プロファイル ρ(x) の、波長 wavelength の成分の振幅と位相。
   * ρ ≈ ρ̄ + a·cos(kx) + b·sin(kx) の (a, b) を out に書き、振幅 √(a²+b²) を返す。
   */
  waveComponent(
    profile: Float64Array,
    wavelength: number,
    out: { a: number; b: number },
  ): number {
    const k = (2 * Math.PI) / wavelength;
    let a = 0;
    let b = 0;
    for (let x = 0; x < this.cols; x++) {
      a += profile[x] * Math.cos(k * x);
      b += profile[x] * Math.sin(k * x);
    }
    out.a = (2 * a) / this.cols;
    out.b = (2 * b) / this.cols;
    return Math.hypot(out.a, out.b);
  }
}
