/**
 * _draw2d.ts — 記事「エヴァルト球」2D 図版(図1・図2・図7)の小物
 * (仕様書 04 §5.0)
 *
 * パネル分割・座標変換・矢印・原子・スケールバー・読み取り値・ドラッグ点は
 * 前提記事「逆格子空間」の `_shared2d.ts` から**再利用する**(再実装しない)。
 * ここに置くのは、本記事で新しく必要になった描画だけである。
 */

import { CANVAS_FONT } from "../reciprocal-lattice/_shared2d";

/** 白ふち取りの太さ(px)。格子や点の上でも文字の可読性を保つ */
const HALO_WIDTH = 3;
/** スケールバーに使う「きりのよい」値の並び(1, 2, 5 の 10 のべき) */
const NICE_STEPS = [1, 2, 5] as const;

/** 図注・注記に使うやや大きめのフォント(14px — 母体仕様 §6.5) */
export const CANVAS_FONT_LARGE = CANVAS_FONT.replace("12px", "14px");

/** 白ふち取り付きテキスト(halo で下地を消してから fill で描く) */
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  halo: string,
): void {
  ctx.strokeStyle = halo;
  ctx.lineWidth = HALO_WIDTH;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** 破線の線分(補助線・垂線)。描画後に破線設定を必ず戻す */
export function dashedLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  dash: readonly number[] = [4, 4],
): void {
  ctx.save();
  ctx.setLineDash([...dash]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/**
 * 角度の弧(散乱角 2θ や入射角 θ の表示)。角度はスクリーン座標系
 * (y 下向き)のラジアンで渡す。
 */
export function angleArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, from, to, from > to);
  ctx.stroke();
}

/**
 * 表示半径に対して「きりのよい」スケールバーの値を返す(1・2・5 × 10ⁿ)。
 * 表示範囲が操作で変わる図版(図1 の逆空間パネルなど)で、目盛の桁が
 * 勝手に飛ばないようにするために使う。
 */
export function niceScaleValue(viewRadius: number): number {
  const target = viewRadius / 2.5;
  const exp = Math.floor(Math.log10(target));
  const base = Math.pow(10, exp);
  for (const step of NICE_STEPS) {
    if (step * base >= target) return step * base;
  }
  return 10 * base;
}

/**
 * パネル上部中央のバッジ(「回折が起きる」など)。塗りつぶした角丸の帯に
 * 文字を置く。色はトークン経由で渡すこと。
 */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  text: string,
  textColor: string,
  bgColor: string,
): void {
  ctx.font = CANVAS_FONT_LARGE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 20;
  const h = 24;
  const x = cx - w / 2;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, 12);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, cx, top + h / 2 + 0.5);
}
