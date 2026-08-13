/**
 * draw.ts — GPゾーン記事の図版共通の Canvas 描画ヘルパ(記事仕様書 07 §5.0)
 *
 * 軸・目盛り・矢印・原子など、7 図版で見た目を揃えるための小物。
 * 色は必ず colors.ts(CSS 変数)経由で受け取り、ここでは直書きしない。
 * 体裁はオストワルド成長記事・フランク・リード源記事の lib/draw.ts に揃える。
 */

import { darken, matColor, uiColor } from "../../../core/colors";

/** 図中ラベルのフォントスタック(tokens.css の --font-sans と同値) */
export const FONT_SANS =
  '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic Medium", Meiryo, sans-serif';

/** `12px …` 形式のフォント指定を返す */
export function font(sizePx: number, weight = 400): string {
  return `${weight === 400 ? "" : `${weight} `}${sizePx}px ${FONT_SANS}`;
}

/** 描画領域(CSS px) */
export interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 図版で使う色をまとめて解決する(初期化時に一度だけ呼ぶ — §6.2) */
export interface Palette {
  matrix: string;
  matrixEdge: string;
  solute: string;
  soluteEdge: string;
  precip: string;
  precipEdge: string;
  defect: string;
  tension: string;
  compression: string;
  accent: string;
  text: string;
  text2: string;
  hairline: string;
  bg: string;
}

export function resolvePalette(): Palette {
  const matrix = matColor("matrix");
  const solute = matColor("solute");
  const precip = matColor("precip");
  return {
    matrix,
    matrixEdge: darken(matrix, 0.2),
    solute,
    soluteEdge: darken(solute, 0.2),
    precip,
    precipEdge: darken(precip, 0.2),
    defect: matColor("defect"),
    tension: matColor("tension"),
    compression: matColor("compression"),
    accent: uiColor("accent"),
    text: uiColor("text"),
    text2: uiColor("text2"),
    hairline: uiColor("hairline"),
    bg: uiColor("bg"),
  };
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

/** 原子 1 個(塗り円 + 同系色を暗くした縁 1.5px — 母体仕様 §6.5) */
export function atom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  edge: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

/** 空孔(塗りなし + 破線縁 — 母体仕様 §6.2) */
export function vacancy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  edge: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.setLineDash([2.5, 2.5]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
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

/** 対数軸の 10 の冪の目盛り列(min ≤ 0 は空配列) */
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
  if (!Number.isFinite(v)) return "—";
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

/** 読み出し行(ラベル + 値の並び)。狭い画面では 2 行に折り返す */
export function drawReadouts(
  ctx: CanvasRenderingContext2D,
  parts: ReadonlyArray<[string, string]>,
  x0: number,
  y: number,
  maxX: number,
  narrow: boolean,
): void {
  const size = narrow ? 11 : 12.5;
  ctx.font = font(size);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let x = x0;
  let line = 0;
  for (const [s, color] of parts) {
    const tw = ctx.measureText(s).width;
    if (x + tw > maxX && line === 0 && x > x0) {
      line = 1;
      x = x0;
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y + line * (size + 4));
    x += tw + (narrow ? 10 : 18);
  }
}

/**
 * 無次元の曲線(数学座標・+y 上向き)を画面座標へ写す。
 * out は長さ 2n の平坦配列 [x0, y0, x1, y1, …]。
 * (フランク・リード源記事 lib/draw.ts の projectCurve と同じ約束)
 */
export function projectCurve(
  x: readonly number[],
  y: readonly number[],
  n: number,
  ox: number,
  oy: number,
  scale: number,
  out: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    out[2 * i] = ox + x[i] * scale;
    out[2 * i + 1] = oy - y[i] * scale;
  }
}

/** projectCurve の出力を線として描く */
export function strokePts(
  ctx: CanvasRenderingContext2D,
  pts: Float64Array,
  n: number,
  closed: boolean,
): void {
  if (n < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
  if (closed) ctx.closePath();
  ctx.stroke();
}

/** 角の丸い小さなバッジ(「切って通る」などの状態表示) */
export function badge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  bg: string,
): number {
  ctx.font = font(11.5, 600);
  const w = ctx.measureText(text).width + 14;
  const h = 20;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.14;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 7, y + h / 2 + 0.5);
  ctx.textBaseline = "alphabetic";
  return w;
}
