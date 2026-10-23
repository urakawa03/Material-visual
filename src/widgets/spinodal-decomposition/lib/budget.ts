/**
 * budget.ts — 1 フレームの計算時間の予算(記事仕様書 09 §5.0・§5.7)
 *
 * カーン・ヒリアードの 1 ステップにかかった時間を指数移動平均で測り、
 * 1 フレームの計算が予算(既定 8 ms)に収まるステップ数を返す。
 * 遅い端末では自動でステップ数を減らし(時間の進みが遅くなるだけで、
 * 時間刻み Δt は変えない — 計算結果は同じ)、それでも 1 ステップが予算を
 * 超えるときは overBudget() が true になる(図版は格子を縮小する)。
 */

/** 1 フレームの計算時間の予算 [ms](母体仕様 §8.3・仕様書 09 §5.0) */
export const FRAME_BUDGET_MS = 8;
/** 指数移動平均の重み */
const EMA = 0.15;
/** 予算超過と判定するまでに見るフレーム数 */
const WARMUP_FRAMES = 12;

export class StepBudget {
  private msPerStep: number;
  private frames = 0;

  /** guessMs: 1 ステップの時間の初期の見積もり */
  constructor(
    private readonly budgetMs = FRAME_BUDGET_MS,
    guessMs = 1,
  ) {
    this.msPerStep = guessMs;
  }

  /** このフレームで回すステップ数(1 以上 desired 以下) */
  steps(desired: number): number {
    const fit = Math.floor(this.budgetMs / Math.max(this.msPerStep, 1e-3));
    return Math.max(1, Math.min(desired, fit));
  }

  /** 実際にかかった時間を記録する */
  record(steps: number, elapsedMs: number): void {
    if (steps <= 0) return;
    const per = elapsedMs / steps;
    this.msPerStep =
      this.frames === 0 ? per : this.msPerStep + EMA * (per - this.msPerStep);
    this.frames++;
  }

  /** 1 ステップだけでも予算を超える(格子を縮小すべき)か */
  overBudget(): boolean {
    return this.frames >= WARMUP_FRAMES && this.msPerStep > this.budgetMs;
  }

  /** 計測をやり直す(格子の大きさを変えたとき) */
  reset(guessMs = 1): void {
    this.msPerStep = guessMs;
    this.frames = 0;
  }
}
