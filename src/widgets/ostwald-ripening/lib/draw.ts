/**
 * draw.ts — 本記事の図版共通の Canvas 描画ヘルパ
 *
 * 軸目盛・矢印・フォントなど、8 図版で見た目を揃えるための小物。
 * 色は必ず colors.ts(CSS 変数)経由で受け取り、ここでは直書きしない。
 */

/** 図中ラベルのフォントスタック(tokens.css の --font-sans と同値) */
export const FONT_SANS =
  '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic Medium", Meiryo, sans-serif';

/** `12px …` 形式のフォント指定を返す */
export function font(sizePx: number, weight = 400): string {
  return `${weight === 400 ? "" : `${weight} `}${sizePx}px ${FONT_SANS}`;
}

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

/** 線形軸の「きれいな」目盛り列(1/2/5 刻み) */
export function linTicks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (
    let v = Math.ceil(min / step) * step;
    v <= max + step * 1e-9;
    v += step
  ) {
    out.push(v);
  }
  return out;
}

/** 対数軸の 10 の冪の目盛り列(min ≤ 0 は空配列を返す — log10(0) の発散防止) */
export function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  if (min <= 0 || max <= 0 || max < min) return out;
  for (
    let e = Math.ceil(Math.log10(min) - 1e-9);
    e <= Math.floor(Math.log10(max) + 1e-9);
    e++
  ) {
    out.push(10 ** e);
  }
  return out;
}

/** 有効数字 3 桁程度の読みやすい数値表示 */
export function fmtSig(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  return String(Number(v.toPrecision(3)));
}

/** 10 の冪を「10³」形式で表示する(対数軸ラベル用) */
export function fmtPow10(v: number): string {
  const e = Math.round(Math.log10(v));
  const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const digits = String(Math.abs(e))
    .split("")
    .map((d) => SUP[Number(d)])
    .join("");
  return `10${e < 0 ? "⁻" : ""}${digits}`;
}
