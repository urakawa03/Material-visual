/**
 * banddiagram.ts — バンド図の描画ヘルパ(カテゴリ D「電子とバンド」共通)
 *
 * 記事「バンド理論」(仕様書 11 §5.0)で切り出した共有モジュール。
 * フェルミ準位・pn 接合の記事が同じ絵(許容帯の帯・禁制帯の破線・準位線・
 * 占有の塗り・E-k 曲線)をそのまま描けるようにしてある。
 * `_shared/lattice2d.ts` と同じく、記事をまたいで使う部品はここに置く。
 *
 * 規約(母体仕様 §6.2 と仕様書 11 §5.0):
 * - 許容帯 = `--mat-band` の塗り + `--mat-level` のバンド端線
 * - 禁制帯 = **塗りなし + `--color-hairline` の破線**(専用の色を持たない)
 * - 電子・占有 = `--mat-electron`
 * - 色は初期化時に 1 度だけ解決する(毎フレーム getComputedStyle を呼ばない)
 * - 座標変換オブジェクトは使い回す(フレーム内の新規割当てを避ける — §8.3)
 */

import { matColor, uiColor } from "../../core/colors";

/* ------------------------------------------------------------------ 色 */

export interface BandColors {
  /** 電子・占有状態 */
  electron: string;
  /** 正孔 */
  hole: string;
  /** 許容帯の塗り */
  band: string;
  /** バンド端・準位線 */
  level: string;
  /** 原子核・周期ポテンシャル */
  matrix: string;
  /** k 空間の目印(ゾーン境界) */
  recip: string;
  /** 光子 */
  beam: string;
  /** 補助線 */
  hairline: string;
  /** 図中の文字 */
  text: string;
  text2: string;
  bg: string;
}

/** 意味パレットを 1 度だけ解決する(ウィジェットの初期化時に呼ぶ) */
export function bandColors(): BandColors {
  return {
    electron: matColor("electron"),
    hole: matColor("hole"),
    band: matColor("band"),
    level: matColor("level"),
    matrix: matColor("matrix"),
    recip: matColor("recip"),
    beam: matColor("beam"),
    hairline: uiColor("hairline"),
    text: uiColor("text"),
    text2: uiColor("text2"),
    bg: uiColor("bg"),
  };
}

/** 図中テキストの標準フォント(§6.5。_shared2d.ts と同じスタック) */
const FONT_STACK =
  '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif';
export const PLOT_FONT = `12px ${FONT_STACK}`;
export const PLOT_FONT_SMALL = `11px ${FONT_STACK}`;

/* ---------------------------------------------------------- 座標変換 */

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * プロット領域の座標変換。x は左→右、y(エネルギー)は下→上。
 * 同じオブジェクトを毎描画で `setPlotRange` により書き換えて使い回す。
 */
export interface PlotMapper {
  rect: PlotRect;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  toPxX(v: number): number;
  toPxY(v: number): number;
  toValX(px: number): number;
  toValY(px: number): number;
}

export function createPlotMapper(): PlotMapper {
  const m: PlotMapper = {
    rect: { x: 0, y: 0, w: 1, h: 1 },
    xMin: 0,
    xMax: 1,
    yMin: 0,
    yMax: 1,
    toPxX: (v) => m.rect.x + ((v - m.xMin) / (m.xMax - m.xMin)) * m.rect.w,
    toPxY: (v) =>
      m.rect.y + m.rect.h - ((v - m.yMin) / (m.yMax - m.yMin)) * m.rect.h,
    toValX: (px) => m.xMin + ((px - m.rect.x) / m.rect.w) * (m.xMax - m.xMin),
    toValY: (px) =>
      m.yMin + ((m.rect.y + m.rect.h - px) / m.rect.h) * (m.yMax - m.yMin),
  };
  return m;
}

/** プロット領域と値域を設定する(毎描画で呼ぶ。新規割当てなし) */
export function setPlotRange(
  m: PlotMapper,
  x: number,
  y: number,
  w: number,
  h: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): void {
  m.rect.x = x;
  m.rect.y = y;
  m.rect.w = Math.max(1, w);
  m.rect.h = Math.max(1, h);
  m.xMin = xMin;
  m.xMax = xMax;
  m.yMin = yMin;
  m.yMax = yMax;
}

/** プロット領域でクリップして描く */
export function withPlotClip(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  cb: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(m.rect.x, m.rect.y, m.rect.w, m.rect.h);
  ctx.clip();
  cb();
  ctx.restore();
}

/* ------------------------------------------------------------ 軸・枠 */

export interface AxisTick {
  value: number;
  label?: string;
}

export interface PlotFrameOptions {
  colors: BandColors;
  /** 横軸の目盛り(省略で目盛りなし) */
  xTicks?: readonly AxisTick[];
  /** 縦軸の目盛り */
  yTicks?: readonly AxisTick[];
  /** 横軸のタイトル(例 「波数 k [nm⁻¹]」) */
  xLabel?: string;
  /** 縦軸のタイトル(例 「エネルギー E [eV]」) */
  yLabel?: string;
  /** 縦軸を左端ではなく x = 0 の位置に描く(E-k 図で使う) */
  yAxisAtZero?: boolean;
}

/** 目盛り線の長さ(px)と、ラベルとの間隔 */
const TICK_LEN = 4;
const TICK_GAP = 6;

/**
 * 軸・目盛り・軸タイトルを描く。枠は描かず、下辺(x 軸)と左辺(E 軸)の
 * 2 本だけを引く(母体仕様 §2-7: 装飾を足さない)。
 */
export function drawPlotFrame(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  opts: PlotFrameOptions,
): void {
  const { colors } = opts;
  const left = m.rect.x;
  const right = m.rect.x + m.rect.w;
  const bottom = m.rect.y + m.rect.h;
  const axisX = opts.yAxisAtZero ? m.toPxX(0) : left;

  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.moveTo(axisX, m.rect.y);
  ctx.lineTo(axisX, bottom);
  ctx.stroke();

  ctx.font = PLOT_FONT;
  ctx.fillStyle = colors.text2;

  if (opts.xTicks) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.beginPath();
    for (const t of opts.xTicks) {
      const px = m.toPxX(t.value);
      ctx.moveTo(px, bottom);
      ctx.lineTo(px, bottom + TICK_LEN);
    }
    ctx.stroke();
    for (const t of opts.xTicks) {
      if (t.label) ctx.fillText(t.label, m.toPxX(t.value), bottom + TICK_GAP);
    }
  }

  if (opts.yTicks) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    for (const t of opts.yTicks) {
      const py = m.toPxY(t.value);
      ctx.moveTo(left, py);
      ctx.lineTo(left - TICK_LEN, py);
    }
    ctx.stroke();
    for (const t of opts.yTicks) {
      if (t.label) ctx.fillText(t.label, left - TICK_GAP, m.toPxY(t.value));
    }
  }

  if (opts.xLabel) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.xLabel, (left + right) / 2, bottom + 34);
  }
  if (opts.yLabel) {
    ctx.save();
    ctx.translate(left - 40, (m.rect.y + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();
  }
}

/* ------------------------------------------------------------ 曲線 */

export interface CurveOptions {
  color: string;
  /** 線幅(既定 2) */
  width?: number;
  /** 破線パターン(既定 実線) */
  dash?: readonly number[];
  /** 不透明度(既定 1) */
  alpha?: number;
}

/**
 * E-k 曲線などの折れ線を描く。xs / ys は値(px ではない)の配列で、
 * count 個までを使う(TypedArray を使い回すため長さと個数を分ける)。
 */
export function drawCurve(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  opts: CurveOptions,
): void {
  if (count < 2) return;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = opts.width ?? 2;
  ctx.setLineDash(opts.dash ? [...opts.dash] : []);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(m.toPxX(xs[0]), m.toPxY(ys[0]));
  for (let i = 1; i < count; i++) {
    ctx.lineTo(m.toPxX(xs[i]), m.toPxY(ys[i]));
  }
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------------------------------- 許容帯・禁制帯 */

export interface BandBoxOptions {
  colors: BandColors;
  /**
   * 電子で埋める上端(eLow〜fillTo を `--mat-electron` で塗る)。
   * 省略すると塗らない
   */
  fillTo?: number;
  /** 占有の塗りの不透明度(既定 0.35) */
  fillAlpha?: number;
  /** バンド端線を描くか(既定 true) */
  edges?: boolean;
  /** 帯の右側に置くラベル(例 「第1バンド」) */
  label?: string;
}

/** 占有部分の塗りの既定不透明度 */
const OCCUPIED_ALPHA = 0.35;

/**
 * 許容帯(バンド)を横長の帯として描く。x0〜x1 は横軸の値の範囲で、
 * pn 接合のように位置に沿ってバンドが曲がる図でも同じ API で使えるよう、
 * 上下端は定数として受け取る(曲げる場合は drawCurve と併用する)。
 */
export function drawBandBox(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x0: number,
  x1: number,
  eLow: number,
  eHigh: number,
  opts: BandBoxOptions,
): void {
  const { colors } = opts;
  const px0 = m.toPxX(x0);
  const px1 = m.toPxX(x1);
  const yTop = m.toPxY(eHigh);
  const yBottom = m.toPxY(eLow);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = colors.band;
  ctx.fillRect(px0, yTop, px1 - px0, yBottom - yTop);

  if (opts.fillTo !== undefined && opts.fillTo > eLow) {
    const yFill = m.toPxY(Math.min(opts.fillTo, eHigh));
    ctx.globalAlpha = opts.fillAlpha ?? OCCUPIED_ALPHA;
    ctx.fillStyle = colors.electron;
    ctx.fillRect(px0, yFill, px1 - px0, yBottom - yFill);
    ctx.globalAlpha = 1;
  }

  if (opts.edges !== false) {
    ctx.strokeStyle = colors.level;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px0, yTop);
    ctx.lineTo(px1, yTop);
    ctx.moveTo(px0, yBottom);
    ctx.lineTo(px1, yBottom);
    ctx.stroke();
  }

  if (opts.label) {
    ctx.font = PLOT_FONT_SMALL;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.label, px1 + 6, (yTop + yBottom) / 2);
  }
  ctx.restore();
}

export interface GapMarksOptions {
  colors: BandColors;
  /** ギャップの中央に置くラベル(例 「1.12 eV」) */
  label?: string;
  /** 幅を示す寸法線(両端の矢羽根つき)を描くか(既定 true) */
  measure?: boolean;
}

/** 禁制帯の破線パターン */
const GAP_DASH = [5, 4] as const;

/**
 * 禁制帯(バンドギャップ)を描く。**塗りは置かず**、上下の境界に
 * `--color-hairline` の破線を引く(§6.2 の規約)。
 */
export function drawGapMarks(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x0: number,
  x1: number,
  eLow: number,
  eHigh: number,
  opts: GapMarksOptions,
): void {
  const { colors } = opts;
  const px0 = m.toPxX(x0);
  const px1 = m.toPxX(x1);
  const yTop = m.toPxY(eHigh);
  const yBottom = m.toPxY(eLow);
  ctx.save();
  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([...GAP_DASH]);
  ctx.beginPath();
  ctx.moveTo(px0, yTop);
  ctx.lineTo(px1, yTop);
  ctx.moveTo(px0, yBottom);
  ctx.lineTo(px1, yBottom);
  ctx.stroke();

  if (opts.measure !== false && yBottom - yTop > 10) {
    const xm = (px0 + px1) / 2;
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.text2;
    ctx.fillStyle = colors.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xm, yTop);
    ctx.lineTo(xm, yBottom);
    ctx.stroke();
    // 両端の矢羽根
    ctx.beginPath();
    ctx.moveTo(xm, yTop);
    ctx.lineTo(xm - 3.5, yTop + 6);
    ctx.lineTo(xm + 3.5, yTop + 6);
    ctx.closePath();
    ctx.moveTo(xm, yBottom);
    ctx.lineTo(xm - 3.5, yBottom - 6);
    ctx.lineTo(xm + 3.5, yBottom - 6);
    ctx.closePath();
    ctx.fill();
  }

  if (opts.label) {
    ctx.setLineDash([]);
    ctx.font = PLOT_FONT;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const xm = (px0 + px1) / 2;
    const ym = (yTop + yBottom) / 2;
    const tw = ctx.measureText(opts.label).width;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(xm - tw / 2 - 3, ym - 8, tw + 6, 16);
    ctx.fillStyle = colors.text2;
    ctx.fillText(opts.label, xm, ym);
  }
  ctx.restore();
}

/* ------------------------------------------------------------ 準位線 */

export interface LevelLineOptions {
  colors: BandColors;
  /** 線の色(既定 `--mat-level`) */
  color?: string;
  /** 破線にするか(フェルミ準位は破線 — 既定 true) */
  dashed?: boolean;
  /** 右端に置くラベル(例 「E_F」) */
  label?: string;
  width?: number;
}

/** 準位線(フェルミ準位・バンド端)を水平線として描く */
export function drawLevelLine(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x0: number,
  x1: number,
  e: number,
  opts: LevelLineOptions,
): void {
  const px0 = m.toPxX(x0);
  const px1 = m.toPxX(x1);
  const py = m.toPxY(e);
  ctx.save();
  ctx.strokeStyle = opts.color ?? opts.colors.level;
  ctx.lineWidth = opts.width ?? 1.5;
  ctx.setLineDash(opts.dashed === false ? [] : [6, 4]);
  ctx.beginPath();
  ctx.moveTo(px0, py);
  ctx.lineTo(px1, py);
  ctx.stroke();
  if (opts.label) {
    ctx.setLineDash([]);
    ctx.font = PLOT_FONT;
    ctx.fillStyle = opts.color ?? opts.colors.level;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.label, px0 + 4, py - 3);
  }
  ctx.restore();
}

/* -------------------------------------------------------- ゾーン境界 */

export interface ZoneBoundaryOptions {
  colors: BandColors;
  /** 上端に置くラベル(例 「π/a」) */
  label?: string;
}

/** ブリルアンゾーン境界の縦破線(`--mat-recip`)を描く */
export function drawZoneBoundary(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  k: number,
  opts: ZoneBoundaryOptions,
): void {
  const px = m.toPxX(k);
  if (px < m.rect.x - 1 || px > m.rect.x + m.rect.w + 1) return;
  ctx.save();
  ctx.strokeStyle = opts.colors.recip;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(px, m.rect.y);
  ctx.lineTo(px, m.rect.y + m.rect.h);
  ctx.stroke();
  if (opts.label) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.font = PLOT_FONT_SMALL;
    ctx.fillStyle = opts.colors.recip;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(opts.label, px, m.rect.y + 2);
  }
  ctx.restore();
}

/* -------------------------------------------------------------- 電子 */

export interface ElectronDotOptions {
  colors: BandColors;
  /** 半径(px。既定 3.6) */
  radius?: number;
  /** 中抜き(空席)にするか */
  empty?: boolean;
}

/**
 * 電子(または空席)の丸を描く。xs / ys は値の配列(px ではない)。
 * 塗り + 同系色を 20% 暗くした縁取り、という母体規約(§6.5)に合わせ、
 * 空席は「塗りなし + 破線縁」ではなく細い実線の中抜きで描く
 * (空孔トークンとの混同を避けるため)。
 */
export function drawElectronDots(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  opts: ElectronDotOptions,
): void {
  const r = opts.radius ?? 3.6;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const px = m.toPxX(xs[i]);
    const py = m.toPxY(ys[i]);
    ctx.moveTo(px + r, py);
    ctx.arc(px, py, r, 0, Math.PI * 2);
  }
  if (opts.empty) {
    ctx.strokeStyle = opts.colors.electron;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  } else {
    ctx.fillStyle = opts.colors.electron;
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------ 書式 */

/** eV の読み取り表示(小数 2 桁・tabular-nums は CSS 側) */
export function formatEv(e: number): string {
  return `${e.toFixed(2)} eV`;
}

/** nm⁻¹ の読み取り表示 */
export function formatK(k: number): string {
  return `${k.toFixed(2)} nm⁻¹`;
}
