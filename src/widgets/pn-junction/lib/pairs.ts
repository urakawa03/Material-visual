/**
 * pairs.ts — 図6(LED と太陽電池)の「出来事」の流れ(純クラス・シード固定)
 *
 * LED では「電子と正孔が空乏層の付近で出会い、電子が落ちて光(または格子の
 * 振動)を出す」、太陽電池では「光子が入って電子・正孔の対を作り、内蔵電場が
 * 左右へ引き離す」という出来事を、ポアソン過程で起こして固定長の配列に持つ。
 * 各出来事の見た目(どの段階にいるか)は経過時間から図版が決める。
 *
 * 出来事の頻度と「光る割合」は**表示上の目安**で、内部量子効率などの計算では
 * ない(図注に明示 — 仕様書 13 §5.6)。
 */

import { mulberry32 } from "../../../core/mathx";

/** 同時に持てる出来事の数 */
export const PAIR_CAPACITY = 24;

export class PairStream {
  /** 起きた時刻 [秒] */
  readonly t0 = new Float64Array(PAIR_CAPACITY);
  /** 場所(0〜1。図版が空乏層の付近へ写す) */
  readonly pos = new Float64Array(PAIR_CAPACITY);
  /** 見た目のばらつき(0〜1。光子の向き・縦の小さなずれ) */
  readonly jitter = new Float64Array(PAIR_CAPACITY);
  /** 光を出すか(LED)。1 = 光子、0 = 格子の振動 */
  readonly radiative = new Uint8Array(PAIR_CAPACITY);
  /** 使用中か */
  readonly active = new Uint8Array(PAIR_CAPACITY);
  /** 現在時刻 [秒] */
  time = 0;
  /** 1 秒あたりの出来事の数 */
  rate: number;
  /** 光を出す確率(直接遷移 1、間接遷移は目安の小さな値) */
  emitProbability = 1;
  /** 出来事の寿命 [秒](これを過ぎると枠を空ける) */
  lifetime: number;

  private readonly seed: number;
  private rand: () => number;

  constructor(seed: number, rate: number, lifetime: number) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.rate = rate;
    this.lifetime = lifetime;
  }

  /** 同じ乱数列・空の状態に戻す */
  reset(): void {
    this.rand = mulberry32(this.seed);
    this.time = 0;
    this.active.fill(0);
  }

  /** dt 秒進める(新しい出来事を起こし、寿命を過ぎたものを消す) */
  step(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    for (let i = 0; i < PAIR_CAPACITY; i++) {
      if (this.active[i] && this.time - this.t0[i] > this.lifetime) {
        this.active[i] = 0;
      }
    }
    // 1 ステップあたりの平均 rate·dt(1 未満)のポアソン乱数
    const lambda = this.rate * dt;
    if (!(lambda > 0)) return;
    const limit = Math.exp(-lambda);
    let p = this.rand();
    while (p > limit) {
      this.spawn();
      p *= this.rand();
    }
  }

  private spawn(): void {
    let slot = -1;
    for (let i = 0; i < PAIR_CAPACITY; i++) {
      if (!this.active[i]) {
        slot = i;
        break;
      }
    }
    // 乱数の消費は枠の有無によらず同じにする(再現性)
    const pos = this.rand();
    const jitter = this.rand();
    const radiative = this.rand() < this.emitProbability ? 1 : 0;
    if (slot < 0) return;
    this.active[slot] = 1;
    this.t0[slot] = this.time;
    this.pos[slot] = pos;
    this.jitter[slot] = jitter;
    this.radiative[slot] = radiative;
  }
}
