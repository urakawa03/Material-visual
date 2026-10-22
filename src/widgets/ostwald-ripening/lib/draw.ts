/**
 * draw.ts — 本記事の図版共通の Canvas 描画ヘルパ
 *
 * 軸目盛・矢印・フォントなど、8 図版で見た目を揃えるための小物。
 * 色は必ず colors.ts(CSS 変数)経由で受け取り、ここでは直書きしない。
 */

/** 文字の書式と軸の目盛りは記事をまたいで共通(src/core/plot.ts) */
export {
  FONT_SANS,
  fmtPow10,
  fmtSig,
  font,
  linTicks,
  logTicks,
} from "../../../core/plot";

/** 矢印(線幅 2px + 塗り三角の先端 — 母体仕様 §6.5) */
export function arrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 2,
  headLen = 7,
): void {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const bx = x1 - headLen * Math.cos(angle);
  const by = y1 - headLen * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(bx, by);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  const half = headLen * 0.55;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(
    bx + half * Math.cos(angle + Math.PI / 2),
    by + half * Math.sin(angle + Math.PI / 2),
  );
  ctx.lineTo(
    bx + half * Math.cos(angle - Math.PI / 2),
    by + half * Math.sin(angle - Math.PI / 2),
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** 小さな上向き/下向き三角(はしごの矢印など) */
export function smallTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  up: boolean,
  color: string,
): void {
  const s = up ? -size : size;
  ctx.beginPath();
  ctx.moveTo(x, y + s);
  ctx.lineTo(x - size * 0.8, y - s * 0.6);
  ctx.lineTo(x + size * 0.8, y - s * 0.6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
