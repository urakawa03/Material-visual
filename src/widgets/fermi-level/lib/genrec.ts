/**
 * genrec.ts — 図4 の生成・再結合モンテカルロ(仕様書 12 §5.4)
 *
 * 純クラス・シード固定。位置は結晶の幅を 1 とした無次元(_shared/carriers1d)。
 *
 * - 時間刻み Δt = 1/60 秒(図版は fixedStep で 16.7 ms 刻みに回す)
 * - 生成: 1 ステップあたり平均 G₀·e^{−x}·Δt 件(ポアソン、x = E_g/k_BT)の
 *   電子・正孔の対を、一様乱数の位置に作る。電子と正孔は**同じ位置**に生まれる
 * - 移動: 速度に揺らぎを与える滑らかな熱運動(速さの目安 0.4/秒、方向の記憶
 *   時間 0.2 秒)。両端で反射
 * - 再結合: 各電子について、捕獲幅 w = 0.01 以内の正孔の数を k とし、確率
 *   1 − (1 − p_c)^k(p_c = 0.02)で最も近い 1 個と対消滅させる
 *
 * この規則は、よく混ざった極限で再結合の速さが r_eff·n·p(r_eff = 2w·p_c/Δt)
 * に比例する形に作ってある。生成とつり合うと n = p = √(G₀/r_eff)·e^{−x/2} —
 * **指数の「2」がここで現れる**。G₀ は x = 4 で平均 30 個前後になるよう
 * G₀ = r_eff·30²·e⁴(≈ 1180 /秒)とした。
 *
 * 仕様書の試作(同じ規則を 60000 ステップ)の期待値: x = 4, 6, 8 で時間平均
 * 29.5・10.8・3.97 個、ln n の傾き −0.502、1 組の寿命 1.39 秒。
 */

import { mulberry32 } from "../../../core/mathx";
import {
  CarrierSet,
  nearestWithin,
  thermalStep,
  type NearestResult,
} from "../../_shared/carriers1d";

/** 時間刻み [秒] */
export const GENREC_DT = 1 / 60;
/** 捕獲幅(結晶の幅を 1 とした無次元) */
export const CAPTURE_WIDTH = 0.01;
/** 捕獲幅内の正孔 1 個あたりの、1 ステップの再結合確率 */
export const CAPTURE_PROB = 0.02;
/** 有効再結合係数 r_eff = 2w·p_c/Δt [1/秒] */
export const R_EFF = (2 * CAPTURE_WIDTH * CAPTURE_PROB) / GENREC_DT;
/** 生成の比例定数 G₀ [1/秒](x = 4 で平均 30 個前後) */
export const G0 = R_EFF * 30 ** 2 * Math.exp(4);
/** 熱運動(速さの目安 0.4/秒・方向の記憶時間 0.2 秒) */
export const GENREC_THERMAL = Object.freeze({ speed: 0.4, tau: 0.2 });
/** キャリア数の上限(配列は事前確保) */
export const MAX_CARRIERS = 400;
/** 時間平均を取るステップ数(直近 900 ステップ = 15 秒) */
export const AVERAGE_STEPS = 900;
/** 初期化時に内部で進めておくステップ数(最初のフレームから定常状態を見せる) */
export const WARMUP_STEPS = 3000;
/** 生成・再結合の縦の移動を描く時間 [秒](表示だけの量) */
export const JUMP_SECONDS = 0.15;
/** 既定のシード */
export const GENREC_SEED = 20261023;

/** CarrierSet の付随値のチャンネル: 生まれた時刻 [秒] */
export const AUX_BORN = 0;
/** CarrierSet の付随値のチャンネル: 描画の縦位置のばらつき(0〜1) */
export const AUX_JITTER = 1;

/** 再結合の表示用の記録(電子が落ちて両方消えるまでの 0.15 秒を描く) */
const EFFECT_CAPACITY = 64;

const BOUNDS = Object.freeze({ min: 0, max: 1 });

/** 平均 lambda のポアソン乱数(lambda は 1 ステップあたり 1 未満なので逐次法で十分) */
function poisson(lambda: number, rand: () => number): number {
  if (!(lambda > 0)) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = rand();
  while (p > limit) {
    k++;
    p *= rand();
  }
  return k;
}

export class GenRecSim {
  readonly electrons = new CarrierSet(MAX_CARRIERS, 2);
  readonly holes = new CarrierSet(MAX_CARRIERS, 2);
  /** ギャップと熱の比 x = E_g/k_BT */
  ratio: number;
  /** シミュレーション時刻 [秒] */
  time = 0;
  /** reset からのステップ数 */
  steps = 0;
  /** 累計の生成数・再結合数 */
  generated = 0;
  recombined = 0;

  /** 再結合の表示用リングバッファ(電子・正孔の位置と縦位置のばらつき、時刻) */
  readonly effectXe = new Float64Array(EFFECT_CAPACITY);
  readonly effectXh = new Float64Array(EFFECT_CAPACITY);
  readonly effectJe = new Float64Array(EFFECT_CAPACITY);
  readonly effectJh = new Float64Array(EFFECT_CAPACITY);
  readonly effectT0 = new Float64Array(EFFECT_CAPACITY);
  effectCount = 0;
  private effectHead = 0;

  private readonly seed: number;
  private readonly initialRatio: number;
  private rand: () => number;
  private readonly history = new Int32Array(AVERAGE_STEPS);
  private historyHead = 0;
  private historyCount = 0;
  private historySum = 0;
  private readonly found: NearestResult = { index: -1, count: 0 };

  constructor(seed = GENREC_SEED, ratio = 5, warmupSteps = WARMUP_STEPS) {
    this.seed = seed;
    this.initialRatio = ratio;
    this.ratio = ratio;
    this.rand = mulberry32(seed);
    this.reset(ratio, warmupSteps);
  }

  /** 同じ乱数列・同じ初期状態へ戻し、warmupSteps だけ内部で進める */
  reset(ratio = this.initialRatio, warmupSteps = WARMUP_STEPS): void {
    this.rand = mulberry32(this.seed);
    this.ratio = ratio;
    this.electrons.clear();
    this.holes.clear();
    this.time = 0;
    this.steps = 0;
    this.generated = 0;
    this.recombined = 0;
    this.effectCount = 0;
    this.effectHead = 0;
    this.restartAverage();
    for (let i = 0; i < warmupSteps; i++) this.step();
  }

  /** 伝導帯の電子の数(= 価電子帯の正孔の数) */
  get count(): number {
    return this.electrons.count;
  }

  /** 直近 AVERAGE_STEPS ステップ(15 秒)の時間平均。記録がなければ NaN */
  get average(): number {
    return this.historyCount > 0 ? this.historySum / this.historyCount : NaN;
  }

  /** 時間平均に入っているステップ数(0〜AVERAGE_STEPS) */
  get averageSteps(): number {
    return this.historyCount;
  }

  /**
   * 時間平均を取り直す(条件を変えた直後に呼ぶ)。前の条件の値が平均に
   * 混ざったまま記録されるのを防ぐ。シミュレーションの状態は変えない。
   */
  restartAverage(): void {
    this.history.fill(0);
    this.historyHead = 0;
    this.historyCount = 0;
    this.historySum = 0;
  }

  /** 正規乱数(ボックス=ミュラー。生成時の初速に使う) */
  private normal(): number {
    let u1 = this.rand();
    if (u1 < 1e-300) u1 = 1e-300;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * this.rand());
  }

  /** 1 ステップ(Δt = 1/60 秒)進める */
  step(): void {
    const rand = this.rand;
    const e = this.electrons;
    const h = this.holes;
    const speed = GENREC_THERMAL.speed;

    // 1. 生成: 同じ位置に電子と正孔の対が生まれる(初速は定常の熱分布から)。
    //    描画の縦位置のばらつきも対で共有する(跳ぶ電子が正孔の位置から出発する)
    const births = poisson(G0 * Math.exp(-this.ratio) * GENREC_DT, rand);
    for (let b = 0; b < births; b++) {
      const x = rand();
      const ve = speed * this.normal();
      const vh = speed * this.normal();
      const jitter = rand();
      if (e.count >= e.capacity || h.count >= h.capacity) continue;
      const ie = e.add(x, ve);
      e.aux[AUX_BORN][ie] = this.time;
      e.aux[AUX_JITTER][ie] = jitter;
      const ih = h.add(x, vh);
      h.aux[AUX_BORN][ih] = this.time;
      h.aux[AUX_JITTER][ih] = jitter;
      this.generated++;
    }

    // 2. 移動: 滑らかな熱運動(両端で反射)
    thermalStep(e, GENREC_DT, GENREC_THERMAL, rand, BOUNDS);
    thermalStep(h, GENREC_DT, GENREC_THERMAL, rand, BOUNDS);

    // 3. 再結合: 各電子について捕獲幅内の正孔を数え、最も近い 1 個と対消滅
    //    (入れ替え削除なので添字の大きい方から回す)
    const keep = 1 - CAPTURE_PROB;
    for (let i = e.count - 1; i >= 0; i--) {
      const hit = nearestWithin(h, e.x[i], CAPTURE_WIDTH, -1, this.found);
      if (hit.count === 0) continue;
      if (rand() >= 1 - Math.pow(keep, hit.count)) continue;
      this.pushEffect(
        e.x[i],
        h.x[hit.index],
        e.aux[AUX_JITTER][i],
        h.aux[AUX_JITTER][hit.index],
      );
      h.removeAt(hit.index);
      e.removeAt(i);
      this.recombined++;
    }

    // 4. 時間平均の記録
    this.time += GENREC_DT;
    this.steps++;
    const c = e.count;
    if (this.historyCount === AVERAGE_STEPS) {
      this.historySum -= this.history[this.historyHead];
    } else {
      this.historyCount++;
    }
    this.history[this.historyHead] = c;
    this.historySum += c;
    this.historyHead = (this.historyHead + 1) % AVERAGE_STEPS;
  }

  private pushEffect(xe: number, xh: number, je: number, jh: number): void {
    const i = this.effectHead;
    this.effectXe[i] = xe;
    this.effectXh[i] = xh;
    this.effectJe[i] = je;
    this.effectJh[i] = jh;
    this.effectT0[i] = this.time;
    this.effectHead = (i + 1) % EFFECT_CAPACITY;
    if (this.effectCount < EFFECT_CAPACITY) this.effectCount++;
  }
}

/**
 * 傾きを固定した直線 ln y = c + slope·x の切片 c を、点 (x_i, y_i) に最小二乗で
 * 合わせる(y ≤ 0 の点は使わない)。点がなければ NaN。
 * 図4 の理論直線: 傾きは −1/2 に固定し、切片だけを測定点に合わせる
 * (比例定数はモデルの細部で決まるが、傾きは決まらない — §5.4)。
 */
export function fitInterceptFixedSlope(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  slope: number,
): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (!(ys[i] > 0)) continue;
    sum += Math.log(ys[i]) - slope * xs[i];
    n++;
  }
  return n > 0 ? sum / n : NaN;
}

/**
 * ln y の x に対する最小二乗の傾き(y ≤ 0 の点は使わない)。
 * 使える点が 2 未満、または x がすべて同じなら NaN。
 */
export function fitLogSlope(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < count; i++) {
    if (!(ys[i] > 0)) continue;
    const x = xs[i];
    const y = Math.log(ys[i]);
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  if (n < 2) return NaN;
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return NaN;
  return (n * sxy - sx * sy) / den;
}
