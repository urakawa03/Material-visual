/**
 * draw.ts — 記事「構造因子と消滅則」の 2D 図版の共通描画(仕様書 08 §5.0)
 *
 * three.js には依存しない(図2 以外のチャンクに three を混ぜない)。
 * パネル・矢印・読み取り値・ステッパは逆格子空間の記事の `_shared2d.ts`、
 * 白ふち取りの文字はエヴァルト球の記事の `_draw2d.ts`、操作部品の有効/無効は
 * カーケンドール効果の記事の `lib/draw.ts` から再利用する(再実装しない)。
 * ここに置くのは、粉末図形(2θ 軸・ガウス形の山・(hkl) ラベル)など本記事で
 * 新しく必要になった描画だけである。
 *
 * 色は colors.ts(CSS 変数)経由で受け取り、ここでは直書きしない(§6.2)。
 */

import { darken, matColor, uiColor } from "../../../core/colors";
import { font, linTicks } from "../../../core/plot";
import { haloText } from "../../ewald-sphere/_draw2d";

export { haloText };
export { setControlEnabled } from "../../kirkendall-effect/lib/draw";

const TAU = Math.PI * 2;

/* ------------------------------------------------------------- 色 */

export interface Palette {
  /** 1 種類目の原子(Fe・Cu・Si・Na・K・Cs) */
  matrix: string;
  matrixEdge: string;
  /** 2 種類目の原子(Cl・Zn・Au) */
  second: string;
  secondEdge: string;
  /** 逆格子点・回折線 */
  recip: string;
  /** 構造因子 F(回折波の振幅)— 塗り・線 */
  beam: string;
  /** 構造因子 F の文字 */
  beamInk: string;
  accent: string;
  hairline: string;
  /** ゴースト線(hairline をやや暗く。白地でも見える細線) */
  ghost: string;
  text: string;
  text2: string;
  bg: string;
}

/** 補助線を白地で見えるようにする暗さ(逆格子空間の記事の図7 と同じ値) */
const GHOST_DARKEN = 0.15;

/** 図版で使う色をまとめて解決する(初期化時に一度だけ呼ぶ — §6.2) */
export function resolvePalette(): Palette {
  const matrix = matColor("matrix");
  const second = matColor("second");
  const hairline = uiColor("hairline");
  return {
    matrix,
    matrixEdge: darken(matrix, 0.2),
    second,
    secondEdge: darken(second, 0.2),
    recip: matColor("recip"),
    beam: matColor("beam"),
    beamInk: matColor("beamInk"),
    accent: uiColor("accent"),
    hairline,
    ghost: darken(hairline, GHOST_DARKEN),
    text: uiColor("text"),
    text2: uiColor("text2"),
    bg: uiColor("bg"),
  };
}

/* ------------------------------------------------------------ 寸法 */

/** これより小さいキャンバスには描かない(配置の途中で一瞬だけ極小になる場合) */
const MIN_CANVAS_PX = 48;

/**
 * キャンバスが描けないほど小さいか。ページの配置の途中で寸法が一瞬だけ
 * 1 px になることがあり、そのまま描くと半径が負になって arc が例外を出す。
 * 各図版の draw() の先頭で調べ、小さければ何も描かない(次の resize で描く)。
 */
export function tooSmall(size: { w: number; h: number }): boolean {
  return size.w < MIN_CANVAS_PX || size.h < MIN_CANVAS_PX;
}

/* --------------------------------------------------------- 粉末図形の座標 */

/** 2θ を横軸、相対強度を縦軸にとるプロット領域 */
export interface PlotArea {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 横軸の範囲(度) */
  xMin: number;
  xMax: number;
  /** 縦軸の上端の値(下端は 0) */
  yMax: number;
}

/** 毎描画で書き換えて使う(割当てを避ける) */
export function createPlotArea(): PlotArea {
  return { x: 0, y: 0, w: 1, h: 1, xMin: 20, xMax: 140, yMax: 100 };
}

export function setPlotArea(
  p: PlotArea,
  x: number,
  y: number,
  w: number,
  h: number,
  xMin: number,
  xMax: number,
  yMax: number,
): void {
  p.x = x;
  p.y = y;
  p.w = Math.max(1, w);
  p.h = Math.max(1, h);
  p.xMin = xMin;
  p.xMax = xMax;
  p.yMax = yMax;
}

/** 2θ [度] → CSS px */
export function plotX(p: PlotArea, v: number): number {
  return p.x + ((v - p.xMin) / (p.xMax - p.xMin)) * p.w;
}

/** 値 → CSS px(下端 = 0) */
export function plotY(p: PlotArea, v: number): number {
  return p.y + p.h - (v / p.yMax) * p.h;
}

/** プロット領域でクリップして描く */
export function withPlotClip(
  ctx: CanvasRenderingContext2D,
  p: PlotArea,
  cb: () => void,
  padTop = 0,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x - 1, p.y - padTop, p.w + 2, p.h + padTop + 1);
  ctx.clip();
  cb();
  ctx.restore();
}

/* ------------------------------------------------------------ 軸 */

/** 2θ 軸の目盛りの数の目安(20〜140° を 20° 刻みにする) */
const TWO_THETA_TICK_TARGET = 6;

/**
 * 2θ の横軸(下端の線・目盛り・ラベル)。labels = false なら線と短い
 * 目盛りだけ(積み重ねたパネルの上の段用)。
 */
export function drawTwoThetaAxis(
  ctx: CanvasRenderingContext2D,
  p: PlotArea,
  pal: Palette,
  labels: boolean,
  title = "2θ",
): void {
  const y0 = p.y + p.h;
  ctx.strokeStyle = pal.text2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, y0 + 0.5);
  ctx.lineTo(p.x + p.w, y0 + 0.5);
  const ticks = linTicks(p.xMin, p.xMax, TWO_THETA_TICK_TARGET);
  for (const t of ticks) {
    const x = Math.round(plotX(p, t)) + 0.5;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + 4);
  }
  ctx.stroke();
  if (!labels) return;
  ctx.fillStyle = pal.text2;
  ctx.font = font(11);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of ticks) {
    ctx.fillText(`${t}°`, plotX(p, t), y0 + 6);
  }
  ctx.textAlign = "right";
  ctx.font = font(12);
  ctx.fillText(title, p.x + p.w, y0 + 20);
}

/**
 * 相対強度の縦軸(左端の線・0/50/100 の目盛り・ラベル)。
 * valueLabel で目盛りの数値を書き換えられる(図7 の拡大表示用)。
 */
export function drawIntensityAxis(
  ctx: CanvasRenderingContext2D,
  p: PlotArea,
  pal: Palette,
  ticks: readonly number[],
  format: (v: number) => string,
): void {
  ctx.strokeStyle = pal.text2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x - 0.5, p.y);
  ctx.lineTo(p.x - 0.5, p.y + p.h);
  for (const t of ticks) {
    const y = Math.round(plotY(p, t)) + 0.5;
    ctx.moveTo(p.x - 4, y);
    ctx.lineTo(p.x, y);
  }
  ctx.stroke();
  ctx.fillStyle = pal.text2;
  ctx.font = font(11);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of ticks) ctx.fillText(format(t), p.x - 6, plotY(p, t));
}

/** 縦書き(−90° 回転)のラベル(縦軸の題など) */
export function drawRotatedLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size = 12,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = color;
  ctx.font = font(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------- ガウス形の山 */

/** 粉末図形の線の半値幅(度 — 仕様書 08 §5.0) */
export const PEAK_FWHM_DEG = 0.15;
/** 半値幅 → σ */
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));
/**
 * 1 本の山を描く範囲(±σ の倍数)と、その中の標本数(奇数 = 中心を含む)。
 * ±4σ の端の値は頂の 0.03% なので、山と山の間の基線は 0 に見える
 */
const PEAK_HALF_SPAN_SIGMA = 4;
const PEAK_SAMPLES = 21;

/** 山の列(2θ と高さ)。容量を先に確保して使い回す */
export interface PeakList {
  tt: Float64Array;
  height: Float64Array;
  count: number;
}

export function createPeakList(capacity: number): PeakList {
  return {
    tt: new Float64Array(capacity),
    height: new Float64Array(capacity),
    count: 0,
  };
}

/** 標本点のバッファ(drawProfile 用) */
export interface ProfileBuffer {
  xs: Float64Array;
}

export function createProfileBuffer(peakCapacity: number): ProfileBuffer {
  return { xs: new Float64Array(peakCapacity * PEAK_SAMPLES + 2) };
}

/** 画面上の山の σ(度)。半値幅は fwhmDeg、ただし画面で minFwhmPx より細くしない */
export function peakSigmaDeg(
  p: PlotArea,
  fwhmDeg: number,
  minFwhmPx: number,
): number {
  const pxPerDeg = p.w / (p.xMax - p.xMin);
  return Math.max(fwhmDeg, minFwhmPx / pxPerDeg) * FWHM_TO_SIGMA;
}

/**
 * 山の列をガウス形の和として 1 本の折れ線で描く(図1・図6)。標本は各山の
 * ±4σ に置き(中心を含む)、山と山の間は基線を直線でつなぐ。山どうしが
 * 近くても和として正しく描ける。高さは PlotArea の値(相対強度)。
 */
export function drawProfile(
  ctx: CanvasRenderingContext2D,
  p: PlotArea,
  peaks: PeakList,
  buf: ProfileBuffer,
  sigmaDeg: number,
  color: string,
  lineWidth = 1.5,
): void {
  const xs = buf.xs;
  let n = 0;
  xs[n++] = p.xMin;
  xs[n++] = p.xMax;
  const span = PEAK_HALF_SPAN_SIGMA * sigmaDeg;
  const step = (2 * span) / (PEAK_SAMPLES - 1);
  for (let i = 0; i < peaks.count; i++) {
    for (let j = 0; j < PEAK_SAMPLES; j++) {
      if (n >= xs.length) break;
      xs[n++] = peaks.tt[i] - span + j * step;
    }
  }
  // 未使用の末尾を +∞ で埋めて丸ごと並べ替える(部分配列を作らない)
  xs.fill(Infinity, n);
  xs.sort();
  const inv2s2 = 1 / (2 * sigmaDeg * sigmaDeg);
  const reach = span * 1.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let started = false;
  for (let s = 0; s < n; s++) {
    const x = xs[s];
    if (x < p.xMin || x > p.xMax) continue;
    let y = 0;
    for (let i = 0; i < peaks.count; i++) {
      const dx = x - peaks.tt[i];
      if (dx > reach || dx < -reach) continue;
      y += peaks.height[i] * Math.exp(-dx * dx * inv2s2);
    }
    const px = plotX(p, x);
    const py = plotY(p, y);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
}

/**
 * 1 本の山を閉じた形として描く(図7: 超格子反射は中抜き → 規則度とともに
 * 塗りが濃くなる)。fillAlpha = 0 で輪郭だけ。
 */
export function drawPeakShape(
  ctx: CanvasRenderingContext2D,
  p: PlotArea,
  tt: number,
  height: number,
  sigmaDeg: number,
  stroke: string,
  fill: string,
  fillAlpha: number,
  lineWidth = 1.5,
): void {
  const span = PEAK_HALF_SPAN_SIGMA * sigmaDeg;
  const step = (2 * span) / (PEAK_SAMPLES - 1);
  const inv2s2 = 1 / (2 * sigmaDeg * sigmaDeg);
  const base = plotY(p, 0);
  ctx.beginPath();
  ctx.moveTo(plotX(p, tt - span), base);
  for (let j = 0; j < PEAK_SAMPLES; j++) {
    const dx = -span + j * step;
    ctx.lineTo(
      plotX(p, tt + dx),
      plotY(p, height * Math.exp(-dx * dx * inv2s2)),
    );
  }
  ctx.lineTo(plotX(p, tt + span), base);
  ctx.closePath();
  if (fillAlpha > 0) {
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/* ------------------------------------------------------ (hkl) ラベル */

/** 縦書きラベルの書き出しを基線からどれだけ上げるか(px) */
const ROTATED_LABEL_LIFT = 18;

/**
 * 線の (hkl) ラベルの置き方を決める。横書きで隣と重なるなら、パネル全体を
 * 縦書き(線の右に沿わせる)にする。xs は線の画面 x(昇順)、widths は
 * 横書きのときのラベル幅。stride = 2 は「2 段に互い違いに置いたとき、
 * 同じ段の隣どうしが重なるか」を調べる。
 */
export function labelsCollide(
  xs: Float64Array,
  widths: Float64Array,
  count: number,
  gap = 4,
  stride = 1,
): boolean {
  for (let i = stride; i < count; i++) {
    const j = i - stride;
    if (xs[i] - xs[j] < (widths[i] + widths[j]) / 2 + gap) return true;
  }
  return false;
}

/**
 * (hkl) ラベル 1 つを描く。rotated = false なら山の頂の上に横書き
 * (複数の族が重なる環は行を重ねる。lift だけさらに上げる — 2 段の
 * 互い違い用)、true なら線の右に沿って縦書き(rotatedGap は線からの距離。
 * 太い山の脇に置くときに広げる)。lines は表示する行(例 ["(5 1 1)", "(3 3 3)"])。
 */
export function drawHklLabel(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  x: number,
  topY: number,
  baseY: number,
  rotated: boolean,
  color: string,
  halo: string,
  minY: number,
  lift = 0,
  rotatedGap = 3,
): void {
  ctx.font = font(11);
  if (!rotated) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const lineH = 12;
    let y = Math.max(topY - 3 - lift, minY + lineH * lines.length);
    for (let i = lines.length - 1; i >= 0; i--) {
      haloText(ctx, lines[i], x, y, color, halo);
      y -= lineH;
    }
    return;
  }
  // 縦書きは基線の少し上から(基線の上の「欠けた線」の印と重ならないように)
  ctx.save();
  ctx.translate(x + rotatedGap, baseY - ROTATED_LABEL_LIFT);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  haloText(ctx, lines.join("/"), 0, 0, color, halo);
  ctx.restore();
}

/* ------------------------------------------------------- 読み取り値 */

/**
 * 読み取り値の項目(.ix-readout-item は nowrap)の折り返しを許す。この記事の
 * 読み取り値には長い文(原子数の内訳・照合の結果など)があり、狭い画面で横に
 * はみ出さないようにするため。項目を作り終えてから行の要素を渡す。
 */
export function allowReadoutWrap(row: HTMLElement): void {
  for (const el of row.querySelectorAll<HTMLElement>(".ix-readout-item")) {
    el.style.whiteSpace = "normal";
  }
}

/* ---------------------------------------------------------- 小物 */

/** 中抜きの小円(消えた反射・現れない点 — 逆格子空間の記事と同じ描き方) */
export function hollowCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  lineWidth = 1.5,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
}

/** 破線の円(「面心立方なら現れるはず」の印 — 図1) */
export function dashedCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  dash: readonly number[] = [3, 3],
): void {
  ctx.save();
  ctx.setLineDash([...dash]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** 原子 1 個(塗り + 同系色 20% 暗の縁取り 1.5px — 母体仕様 §6.5) */
export function drawAtom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  edge: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

/** 分率座標の表示(0・¼・½・¾・1 は分数で、それ以外は小数 3 桁) */
export function fracLabel(v: number): string {
  const q = Math.round(v * 4);
  if (Math.abs(v * 4 - q) < 1e-9) {
    return ["0", "¼", "½", "¾", "1"][q] ?? String(v);
  }
  return v.toFixed(3);
}

/** 角度(度)の表示(整数に丸める) */
export function degLabel(turns: number): string {
  return `${Math.round(turns * 360) % 360}°`;
}
