/**
 * microstructure.ts — 粒子場の描画(記事仕様書 03 §5.0。図1・5・7 で共用)
 *
 * - シード付きランダム配置+重なり回避(初期半径ベース。位置は固定)
 * - nm → px 換算(視野をキャンバスの指定領域へレターボックスなしで写像)
 * - 溶解フェード(約 0.3 s で消える。消滅マークつき)
 *
 * 粒子の配置は装飾であり、平均場計算には位置は入らない(各図の図注で明示)。
 */

import { mulberry32 } from "../../../core/mathx";
import type { RipeningEnsemble } from "./ripening";

/** 溶解フェードの時間 [s](図1: 約 0.3 s) */
const FADE_SECONDS = 0.3;
/** 配置時に初期半径へ掛ける余裕係数(成長後の見た目の重なりを減らす) */
const GAP_FACTOR = 1.25;
/** 配置時の最小すき間 [nm] */
const GAP_PAD_NM = 3;
/** 1 粒子あたりの配置試行回数 */
const PLACE_TRIES = 150;

export interface Viewport {
  /** 描画先領域(CSS px) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldStyle {
  /** 粒子の塗り(--mat-solute) */
  fill: string;
  /** 粒子の縁(塗りを約 20% 暗く) */
  edge: string;
  /** 追跡リング等の色(--color-accent)。省略時はリングを描かない */
  accent?: string;
  /** 追跡中の粒子インデックス(-1 で無効) */
  trackIndex?: number;
}

/**
 * 粒子場ビュー。アンサンブルの半径列に、シード固定の配置と溶解フェードを
 * 重ねて描く。
 */
export class MicrostructureView {
  /** 粒子中心の nm 座標 */
  readonly xNm: Float64Array;
  readonly yNm: Float64Array;
  /** 1 → 0 の溶解フェード。1 = 完全表示 */
  private readonly fade: Float32Array;
  /** フェード中に使う最後の描画半径 [nm] */
  private readonly lastR: Float32Array;

  constructor(
    private readonly ens: RipeningEnsemble,
    readonly fieldWNm: number,
    readonly fieldHNm: number,
    seed: number,
  ) {
    const n = ens.count;
    this.xNm = new Float64Array(n);
    this.yNm = new Float64Array(n);
    this.fade = new Float32Array(n);
    this.lastR = new Float32Array(n);
    this.layout(seed);
    this.resetFades();
  }

  /** シード付きランダム配置+重なり回避(大きい粒子から順に置く) */
  private layout(seed: number): void {
    const rand = mulberry32(seed);
    const n = this.ens.count;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => this.ens.r[b] - this.ens.r[a],
    );
    const placed: number[] = [];
    for (const i of order) {
      const ri = this.ens.r[i];
      let bestX = 0;
      let bestY = 0;
      let bestClear = -Infinity;
      for (let t = 0; t < PLACE_TRIES; t++) {
        const x = ri + rand() * (this.fieldWNm - 2 * ri);
        const y = ri + rand() * (this.fieldHNm - 2 * ri);
        // 既配置粒子とのすき間の最小値(負なら重なり)
        let clear = Infinity;
        for (const j of placed) {
          const need = (ri + this.ens.r[j]) * GAP_FACTOR + GAP_PAD_NM;
          const d = Math.hypot(x - this.xNm[j], y - this.yNm[j]) - need;
          if (d < clear) clear = d;
        }
        if (clear > bestClear) {
          bestClear = clear;
          bestX = x;
          bestY = y;
        }
        if (clear >= 0) break; // 重ならない場所が見つかった
      }
      this.xNm[i] = bestX;
      this.yNm[i] = bestY;
      placed.push(i);
    }
  }

  /** フェード状態を初期化する(reset 時に呼ぶ) */
  resetFades(): void {
    for (let i = 0; i < this.ens.count; i++) {
      this.fade[i] = 1;
      this.lastR[i] = this.ens.r[i];
    }
  }

  /**
   * フェードを進める。dtWall は壁時計の経過秒。
   * ens.dissolvedNow を毎フレーム渡すこと(step() 直後)。
   */
  update(dtWall: number, dissolvedNow: readonly number[]): void {
    for (const i of dissolvedNow) {
      // 溶解の瞬間の半径はほぼ r_dis。見た目用に下限を設ける
      if (this.lastR[i] < 0.5) this.lastR[i] = 0.5;
    }
    const decay = dtWall / FADE_SECONDS;
    for (let i = 0; i < this.ens.count; i++) {
      if (this.ens.alive[i]) {
        this.lastR[i] = this.ens.r[i];
      } else if (this.fade[i] > 0) {
        this.fade[i] = Math.max(0, this.fade[i] - decay);
      }
    }
  }

  /** nm → px の変換係数(viewport に視野全体を収める) */
  scale(vp: Viewport): number {
    return Math.min(vp.w / this.fieldWNm, vp.h / this.fieldHNm);
  }

  /**
   * 粒子場を描く。生存粒子は 1 パスでまとめ描き(母体仕様 §8.3)、
   * フェード中の粒子は透明度つきで消滅マーク(×)を重ねる。
   */
  draw(ctx: CanvasRenderingContext2D, vp: Viewport, style: FieldStyle): void {
    const s = this.scale(vp);
    const ox = vp.x + (vp.w - this.fieldWNm * s) / 2;
    const oy = vp.y + (vp.h - this.fieldHNm * s) / 2;
    const n = this.ens.count;
    const TAU = Math.PI * 2;

    // 生存粒子(1 パス)
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (!this.ens.alive[i]) continue;
      const x = ox + this.xNm[i] * s;
      const y = oy + this.yNm[i] * s;
      const r = Math.max(this.ens.r[i] * s, 0.75);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = style.edge;
    ctx.stroke();

    // フェード中の粒子(透明度つき+消滅マーク)
    for (let i = 0; i < n; i++) {
      if (this.ens.alive[i] || this.fade[i] <= 0) continue;
      const x = ox + this.xNm[i] * s;
      const y = oy + this.yNm[i] * s;
      const r = Math.max(this.lastR[i] * s, 2);
      ctx.globalAlpha = this.fade[i];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = style.fill;
      ctx.fill();
      // 消滅マーク: 小さな ×
      const m = r + 3;
      ctx.beginPath();
      ctx.moveTo(x - m, y - m);
      ctx.lineTo(x + m, y + m);
      ctx.moveTo(x + m, y - m);
      ctx.lineTo(x - m, y + m);
      ctx.lineWidth = 1;
      ctx.strokeStyle = style.edge;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 追跡リング(accent の二重円)
    const ti = style.trackIndex ?? -1;
    if (style.accent && ti >= 0 && this.ens.alive[ti]) {
      const x = ox + this.xNm[ti] * s;
      const y = oy + this.yNm[ti] * s;
      const r = Math.max(this.ens.r[ti] * s, 0.75);
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, TAU);
      ctx.lineWidth = 2;
      ctx.strokeStyle = style.accent;
      ctx.stroke();
    }
  }

  /**
   * viewport 内の CSS px 座標から粒子を当てる(タップ判定)。
   * 見つからなければ -1。当たり判定は半径 + 8 px。
   */
  hitTest(pxX: number, pxY: number, vp: Viewport): number {
    const s = this.scale(vp);
    const ox = vp.x + (vp.w - this.fieldWNm * s) / 2;
    const oy = vp.y + (vp.h - this.fieldHNm * s) / 2;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.ens.count; i++) {
      if (!this.ens.alive[i]) continue;
      const d =
        Math.hypot(pxX - (ox + this.xNm[i] * s), pxY - (oy + this.yNm[i] * s)) -
        this.ens.r[i] * s;
      if (d < 8 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
