/**
 * draw.ts — 記事「スピノーダル分解」の図版共通の描画ヘルパ(記事仕様書 09 §5.0)
 *
 * - 濃度場は --mat-matrix(A リッチ)と --mat-second(B リッチ)の 2 色間の
 *   補間で描く(虹色のカラーマップは使わない — 母体仕様 §2-7)。補間の表
 *   (256 段)は初期化時に 1 度だけ作り、ImageData へ直接書き込む(§8.3)。
 * - 状態図(バイノーダルは実線、スピノーダルは破線 — §2.3)と自由エネルギー
 *   曲線は図2・図3・図6 で共用する。
 * - 原子の描き方・矢印・縁取り文字はカーケンドール効果の記事の lib/draw.ts を
 *   そのまま使う(記事をまたいで見た目を揃える)。
 *
 * 色は colors.ts(CSS 変数)経由で受け取り、ここでは直書きしない。
 */

import { darken, matColor, uiColor } from "../../../core/colors";
import { clamp } from "../../../core/mathx";
import { font, linTicks } from "../../../core/plot";
import { binodal, gMix, spinodal } from "./regular";

export {
  arrow,
  dashedLine,
  drawAtoms,
  outlinedText,
  paneFrame,
  type Pane,
} from "../../kirkendall-effect/lib/draw";
export { font, fmtSig, linTicks, logTicks } from "../../../core/plot";

/** 図版で使う色(初期化時に 1 度だけ解決する — 母体仕様 §6.2) */
export interface Palette {
  /** A 原子・A リッチ相 */
  matrix: string;
  matrixEdge: string;
  /** B 原子・B リッチ相 */
  second: string;
  secondEdge: string;
  /** 共通接線・状態点・置いた核の目印(参照の線) */
  accent: string;
  text: string;
  text2: string;
  hairline: string;
  bg: string;
}

export function resolvePalette(): Palette {
  const matrix = matColor("matrix");
  const second = matColor("second");
  return {
    matrix,
    matrixEdge: darken(matrix, 0.2),
    second,
    secondEdge: darken(second, 0.2),
    accent: uiColor("accent"),
    text: uiColor("text"),
    text2: uiColor("text2"),
    hairline: uiColor("hairline"),
    bg: uiColor("bg"),
  };
}

/* ------------------------------------------------------------- 濃度場 */

/** `#rrggbb` を [r, g, b] に(それ以外の書式は灰色) */
function parseHex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** 2 色補間の表の段数 */
const LUT_SIZE = 256;

/** 濃度 → 色の対応の端(この範囲の外は端の色)。平衡組成(0.07・0.93)が両端の色に近くなる */
export const FIELD_C_LO = 0.04;
export const FIELD_C_HI = 0.96;

/**
 * 濃度場の画像(1 格子点 = 1 画素の画像を作り、拡大して描く)。
 * 画像の更新は ImageData への直接書き込みで、フレームごとの割当てはしない。
 */
export class FieldImage {
  private n = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private readonly lut = new Uint8ClampedArray(LUT_SIZE * 3);

  constructor(colorA: string, colorB: string) {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D コンテキストを取得できません");
    this.ctx = ctx;
    const a = parseHex(colorA);
    const b = parseHex(colorB);
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1);
      for (let ch = 0; ch < 3; ch++) {
        this.lut[i * 3 + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * t);
      }
    }
  }

  /** 正方格子 n × n の濃度場 c を画像に写す */
  update(c: Float64Array, n: number): void {
    if (n !== this.n || !this.image) {
      this.n = n;
      this.canvas.width = n;
      this.canvas.height = n;
      this.image = this.ctx.createImageData(n, n);
    }
    const data = this.image.data;
    const { lut } = this;
    const scale = (LUT_SIZE - 1) / (FIELD_C_HI - FIELD_C_LO);
    const count = n * n;
    for (let i = 0; i < count; i++) {
      let t = (c[i] - FIELD_C_LO) * scale;
      t = t < 0 ? 0 : t > LUT_SIZE - 1 ? LUT_SIZE - 1 : t;
      const k = (t + 0.5) | 0;
      const o = i * 4;
      data[o] = lut[k * 3];
      data[o + 1] = lut[k * 3 + 1];
      data[o + 2] = lut[k * 3 + 2];
      data[o + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  /**
   * 画像を (x, y) に一辺 size の正方形で描く。smooth = true で双線形補間
   * (格子の粗さを目立たせない)。行 0 を上に描く。
   */
  draw(
    target: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    smooth = true,
  ): void {
    if (!this.image) return;
    target.save();
    target.imageSmoothingEnabled = smooth;
    target.drawImage(this.canvas, x, y, size, size);
    target.restore();
  }
}

/* ----------------------------------------------------------- プロット枠 */

/** プロットの座標変換(線形軸) */
export interface Axes {
  x: number;
  y: number;
  w: number;
  h: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function axX(a: Axes, v: number): number {
  return a.x + ((v - a.xMin) / (a.xMax - a.xMin)) * a.w;
}

export function axY(a: Axes, v: number): number {
  return a.y + a.h - ((v - a.yMin) / (a.yMax - a.yMin)) * a.h;
}

export function axInvX(a: Axes, px: number): number {
  return a.xMin + ((px - a.x) / a.w) * (a.xMax - a.xMin);
}

export function axInvY(a: Axes, py: number): number {
  return a.yMin + ((a.y + a.h - py) / a.h) * (a.yMax - a.yMin);
}

/** L 字の軸線(hairline) */
export function drawAxisLines(
  ctx: CanvasRenderingContext2D,
  a: Axes,
  pal: Palette,
) {
  ctx.strokeStyle = pal.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x + 0.5, a.y);
  ctx.lineTo(a.x + 0.5, a.y + a.h + 0.5);
  ctx.lineTo(a.x + a.w, a.y + a.h + 0.5);
  ctx.stroke();
}

/** 線形の目盛り(x 軸)。format で文字にする */
export function drawXTicks(
  ctx: CanvasRenderingContext2D,
  a: Axes,
  pal: Palette,
  ticks: readonly number[],
  format: (v: number) => string,
  sizePx = 11,
): void {
  ctx.strokeStyle = pal.hairline;
  ctx.fillStyle = pal.text2;
  ctx.font = font(sizePx);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const v of ticks) {
    const px = axX(a, v);
    ctx.beginPath();
    ctx.moveTo(px + 0.5, a.y + a.h);
    ctx.lineTo(px + 0.5, a.y + a.h + 4);
    ctx.stroke();
    ctx.fillText(format(v), px, a.y + a.h + 6);
  }
}

/** 線形の目盛り(y 軸) */
export function drawYTicks(
  ctx: CanvasRenderingContext2D,
  a: Axes,
  pal: Palette,
  ticks: readonly number[],
  format: (v: number) => string,
  sizePx = 11,
): void {
  ctx.strokeStyle = pal.hairline;
  ctx.fillStyle = pal.text2;
  ctx.font = font(sizePx);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of ticks) {
    const py = axY(a, v);
    ctx.beginPath();
    ctx.moveTo(a.x - 4, py + 0.5);
    ctx.lineTo(a.x, py + 0.5);
    ctx.stroke();
    ctx.fillText(format(v), a.x - 6, py);
  }
}

/** 状態点・置いた核の目印(--color-accent の輪 — §2.3) */
export function drawStateRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pal: Palette,
  r = 7,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = pal.bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = pal.accent;
  ctx.stroke();
}

/* ----------------------------------------------------------- 状態図 */

/** 状態図の線を引くための温度の刻み(頂上 T/Tc = 1 付近を細かく) */
const DOME_SAMPLES = 160;
const DOME_T_LOW = 0.05;
/** 温度 t_i と、そこでのバイノーダル・スピノーダルの組成(低い側)の表 */
const DOME_T = new Float64Array(DOME_SAMPLES + 1);
const DOME_CB = new Float64Array(DOME_SAMPLES + 1);
const DOME_CS = new Float64Array(DOME_SAMPLES + 1);
for (let i = 0; i <= DOME_SAMPLES; i++) {
  const s = i / DOME_SAMPLES;
  const t = 1 - (1 - DOME_T_LOW) * (1 - s) * (1 - s);
  const chi = 2 / Math.min(t, 1 - 1e-12);
  DOME_T[i] = t;
  DOME_CB[i] = i === DOME_SAMPLES ? 0.5 : binodal(chi);
  DOME_CS[i] = i === DOME_SAMPLES ? 0.5 : spinodal(chi);
}

/**
 * バイノーダル(実線)とスピノーダル(破線)のドームを描く(§2.3)。
 * 縦軸は T/Tc(a.yMin … a.yMax)、横軸は組成 X(0 … 1)。
 */
export function drawDomes(
  ctx: CanvasRenderingContext2D,
  a: Axes,
  pal: Palette,
  lineWidth = 2,
): void {
  const curve = (table: Float64Array, dashed: boolean): void => {
    ctx.save();
    // 軸の外(下端より低温)ははみ出さないよう切り取る
    ctx.beginPath();
    ctx.rect(a.x, a.y - 2, a.w, a.h + 2);
    ctx.clip();
    ctx.beginPath();
    // 左の枝を下から頂上へ、右の枝を頂上から下へ
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k <= DOME_SAMPLES; k++) {
        const i = pass === 0 ? k : DOME_SAMPLES - k;
        const xv = pass === 0 ? table[i] : 1 - table[i];
        const px = axX(a, xv);
        const py = axY(a, DOME_T[i]);
        if (pass === 0 && k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = pal.text2;
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
  };
  curve(DOME_CB, false);
  curve(DOME_CS, true);
}

/* -------------------------------------------------- 自由エネルギー曲線 */

/** g(X) の値の範囲(描画の縦軸を決めるため。端の 0 を含む) */
export function gRange(chi: number): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (let i = 1; i < 200; i++) {
    const v = gMix(i / 200, chi);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** 縦軸の範囲を g の値の範囲から決める(上下に余白) */
export function gAxisRange(
  chi: number,
  padTop = 0.18,
  padBottom = 0.12,
): { yMin: number; yMax: number } {
  const { min, max } = gRange(chi);
  const span = Math.max(max - min, 1e-3);
  return { yMin: min - span * padBottom, yMax: max + span * padTop };
}

/**
 * g(X) の曲線を描く。from … to の区間だけ描きたいときは範囲を渡す。
 */
export function drawGCurve(
  ctx: CanvasRenderingContext2D,
  a: Axes,
  chi: number,
  color: string,
  lineWidth: number,
  from = 0,
  to = 1,
): void {
  const samples = 240;
  ctx.beginPath();
  for (let i = 0; i <= samples; i++) {
    const c = from + ((to - from) * i) / samples;
    const px = axX(a, c);
    const py = axY(a, gMix(c, chi));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** 組成軸(0 … 1)の目盛り */
export function compositionTicks(narrow: boolean): number[] {
  return narrow ? [0, 0.5, 1] : linTicks(0, 1, 5);
}

/** 0〜1 の小数を「0.35」の形に(末尾の 0 は落とさない) */
export function fmtFixed(v: number, digits: number): string {
  return clamp(v, -1e9, 1e9).toFixed(digits);
}
