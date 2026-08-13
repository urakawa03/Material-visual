/**
 * draw.ts — 本記事の図版共通の Canvas 描画ヘルパ(記事仕様 §5.0)
 *
 * 色は必ず colors.ts(CSS 変数)経由で受け取り、ここでは直書きしない
 * (母体仕様 §13: ダークモード追加への布石)。
 *
 * 全記事共通の約束(依頼文 §4): **空孔は塗らない**。塗りなし +
 * `--mat-matrix` の破線縁のみで描く(= そこに原子が無いことの視覚表現)。
 */

import { darken, matColor, uiColor } from "../../../core/colors";

/** 図中ラベルのフォントスタック(tokens.css の --font-sans と同値) */
export const FONT_SANS =
  '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic Medium", Meiryo, sans-serif';

/** `12px …` 形式のフォント指定を返す */
export function font(sizePx: number, weight = 400): string {
  return `${weight === 400 ? "" : `${weight} `}${sizePx}px ${FONT_SANS}`;
}

const TWO_PI = Math.PI * 2;
/** 原子の縁取り(同系色を約 20% 暗く・1.5px — 母体仕様 §6.5) */
const EDGE_WIDTH = 1.5;

/** 図版で使う色をまとめて解決する(初期化時に一度だけ呼ぶ — §6.2) */
export interface Palette {
  /** A 原子(Cu)・母相の格子 */
  matrix: string;
  matrixEdge: string;
  /** B 原子(Zn)= 拡散対のもう一方の元素 */
  second: string;
  secondEdge: string;
  /** 侵入型原子(C, N) */
  solute: string;
  soluteEdge: string;
  /** ボイド・欠陥・ソース/シンク */
  defect: string;
  /** 生成物の殻(図7) */
  precip: string;
  precipEdge: string;
  /** 目印・参照線・臨界値 */
  accent: string;
  hairline: string;
  text: string;
  text2: string;
  bg: string;
}

export function resolvePalette(): Palette {
  const matrix = matColor("matrix");
  const second = matColor("second");
  const solute = matColor("solute");
  const precip = matColor("precip");
  return {
    matrix,
    matrixEdge: darken(matrix, 0.2),
    second,
    secondEdge: darken(second, 0.2),
    solute,
    soluteEdge: darken(solute, 0.2),
    defect: matColor("defect"),
    precip,
    precipEdge: darken(precip, 0.2),
    accent: uiColor("accent"),
    hairline: uiColor("hairline"),
    text: uiColor("text"),
    text2: uiColor("text2"),
    bg: uiColor("bg"),
  };
}

/* ------------------------------------------------------------ 座標変換 */

/**
 * 格子座標(格子単位・y 上向き)→ Canvas 座標(CSS px・y 下向き)の変換。
 * y 反転はここが一手に引き受ける(符号バグの温床への対策)。
 */
export interface LatticeView {
  cx: number;
  cy: number;
  /** 格子間隔 1 あたりの px 数 */
  scale: number;
}

/** 幅 widthLat × 高さ heightLat(格子単位)の領域が矩形に収まる view を作る */
export function makeLatticeView(
  x: number,
  y: number,
  w: number,
  h: number,
  widthLat: number,
  heightLat: number,
): LatticeView {
  const scale = Math.min(w / widthLat, h / heightLat);
  return { cx: x + w / 2, cy: y + h / 2, scale };
}

export function viewX(v: LatticeView, x: number): number {
  return v.cx + x * v.scale;
}

/** y 反転はここで行う */
export function viewY(v: LatticeView, y: number): number {
  return v.cy - y * v.scale;
}

/* ------------------------------------------------------------ 図形 */

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
  const len = Math.hypot(x1 - x0, y1 - y0);
  const head = Math.min(headLen, len);
  const bx = x1 - head * Math.cos(angle);
  const by = y1 - head * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(bx, by);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  const half = head * 0.55;
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

/**
 * 破線の矢印(空孔の流れ用 — 塗らない/実線でないことで「原子ではない」を
 * 表す。記事仕様 §5.4)。先端の三角は塗らず輪郭のみにする。
 */
export function dashedArrow(
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
  const len = Math.hypot(x1 - x0, y1 - y0);
  const head = Math.min(headLen, len);
  const bx = x1 - head * Math.cos(angle);
  const by = y1 - head * Math.sin(angle);
  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(bx, by);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(
    bx + head * 0.55 * Math.cos(angle + Math.PI / 2),
    by + head * 0.55 * Math.sin(angle + Math.PI / 2),
  );
  ctx.lineTo(
    bx + head * 0.55 * Math.cos(angle - Math.PI / 2),
    by + head * 0.55 * Math.sin(angle - Math.PI / 2),
  );
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * 原子群を 1 パスでまとめ描きする(母体仕様 §8.3)。
 * xs / ys は Canvas 座標(px)、count 個ぶんを描く。
 */
export function drawAtoms(
  ctx: CanvasRenderingContext2D,
  xs: Float64Array,
  ys: Float64Array,
  count: number,
  radius: number,
  fill: string,
  edge: string,
): void {
  if (count <= 0) return;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    ctx.moveTo(xs[i] + radius, ys[i]);
    ctx.arc(xs[i], ys[i], radius, 0, TWO_PI);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  if (radius >= 2) {
    ctx.lineWidth = EDGE_WIDTH;
    ctx.strokeStyle = edge;
    ctx.stroke();
  }
}

/**
 * 空孔を描く(**塗りなし + 破線の輪郭のみ** — 全記事共通の約束)。
 * 複数個をまとめて 1 パスで描く。
 */
export function drawVacancies(
  ctx: CanvasRenderingContext2D,
  xs: Float64Array,
  ys: Float64Array,
  count: number,
  radius: number,
  edge: string,
): void {
  if (count <= 0) return;
  ctx.save();
  ctx.setLineDash([3, 2.5]);
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    ctx.moveTo(xs[i] + radius, ys[i]);
    ctx.arc(xs[i], ys[i], radius, 0, TWO_PI);
  }
  ctx.lineWidth = EDGE_WIDTH;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
}

/** 単独の空孔(塗りなし + 破線縁)を描く */
export function drawVacancy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  edge: string,
): void {
  ctx.save();
  ctx.setLineDash([3, 2.5]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.lineWidth = EDGE_WIDTH;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
}

/** 追跡マーカーのリング(accent 色・2px — 「読み取りのための印」) */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** 破線(参照線)を引く */
export function dashedLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  dash: [number, number] = [4, 4],
  width = 1,
): void {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/** 白の縁取りつきテキスト(図の上に重ねても読めるように) */
export function outlinedText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  fill: string,
  bg: string,
): void {
  ctx.lineWidth = 4;
  ctx.strokeStyle = bg;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

/**
 * 寸法線(両端に短い縦棒 + 中央にラベル)。マーカー移動量の表示に使う。
 */
export function dimensionLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  label: string,
  color: string,
  bg: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y - 4);
  ctx.lineTo(x0, y + 4);
  ctx.moveTo(x1, y - 4);
  ctx.lineTo(x1, y + 4);
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.font = font(11);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  outlinedText(ctx, label, (x0 + x1) / 2, y - 3, color, bg);
}

/* ------------------------------------------------------------ 軸目盛 */

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

/** 対数軸の 10 の冪の目盛り列 */
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

/** 有効数字 3 桁程度の読みやすい数値表示 */
export function fmtSig(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  return String(Number(v.toPrecision(3)));
}

/**
 * 操作部品の行を有効/無効にする(測定中のロック・理論線の解禁に使う)。
 * フランク・リード源記事の `lib/draw.ts` と同じ実装・同じ `.is-disabled`
 * クラス(controls.css)を使い、記事をまたいで見た目を揃える。
 */
export function setControlEnabled(rowEl: HTMLElement, enabled: boolean): void {
  const inputs = rowEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    "input, button",
  );
  inputs.forEach((el) => {
    el.disabled = !enabled;
  });
  rowEl.classList.toggle("is-disabled", !enabled);
}

/** パネル(プロット領域)の矩形 */
export interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** パネルの枠を hairline で描く */
export function paneFrame(
  ctx: CanvasRenderingContext2D,
  p: Pane,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
}
