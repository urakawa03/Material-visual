/**
 * draw.ts — 記事「フェルミ準位」の図版で共通に使う描画・UI の小物
 *
 * バンド図そのもの(帯・禁制帯・準位線・電子の丸)は _shared/banddiagram.ts を
 * 使い、ここにはこの記事だけの約束事を置く:
 * - フェルミ準位の線は本記事の主役なので、線幅 2.2・破線・`--mat-electron`・
 *   ラベル「E_F」で描き、バンド端(1.6 の実線)や E_i・ドナー準位(1.2 の細い
 *   破線)と太さで区別する(仕様書 12 §2.3。新しい色は作らない)
 * - ドーパントは溶質なので `--mat-solute`(コットレル・GP ゾーンの記事と同じ意味)
 */

import { matColor, uiColor } from "../../../core/colors";
import {
  bandColors,
  drawLevelLine,
  PLOT_FONT,
  PLOT_FONT_SMALL,
  type BandColors,
  type PlotMapper,
} from "../../_shared/banddiagram";
import {
  splitPanels,
  type PanelRect,
} from "../../reciprocal-lattice/_shared2d";
import type { FigureSize } from "../../types";

/** バンド図の色 + この記事で使う意味色 */
export interface FermiColors extends BandColors {
  /** ドーパント原子・ドナー / アクセプタ準位(溶質) */
  solute: string;
  /** 光の文字用の暗色 */
  beamInk: string;
  /** 理論直線などの参照線(アクセント色) */
  accent: string;
}

/** 色を初期化時に 1 度だけ解決する */
export function fermiColors(): FermiColors {
  return {
    ...bandColors(),
    solute: matColor("solute"),
    beamInk: matColor("beamInk"),
    accent: uiColor("accent"),
  };
}

/** フェルミ準位の線幅(§2.3) */
export const FERMI_LINE_WIDTH = 2.2;
/** E_i・ドナー準位などの細い準位線の線幅(§2.3) */
export const THIN_LEVEL_WIDTH = 1.2;

/** フェルミ準位の線(太い破線・電子の色・ラベルは左端。label に "" でラベルなし) */
export function drawFermiLine(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x0: number,
  x1: number,
  eF: number,
  colors: BandColors,
  label: string | undefined = "E_F",
): void {
  drawLevelLine(ctx, m, x0, x1, eF, {
    colors,
    color: colors.electron,
    width: FERMI_LINE_WIDTH,
    dashed: true,
    label,
  });
}

/** 準位線のラベルの文字が占める高さの目安 [px](12px の字 + 線からの隙間) */
const LEVEL_LABEL_CLEARANCE = 18;

/**
 * 高さ e の線の上(左端)に置いたラベルを、高さ otherE の線が横切るか。
 * otherE の線がすぐ上(ラベルの字の高さの範囲)を通るときに true。
 * 2 本がほぼ重なっている(0.5px 未満)ときは、線の上に置けば両方の上に
 * なるので false。
 */
export function labelCrossedBy(
  m: PlotMapper,
  e: number,
  otherE: number,
): boolean {
  const gap = m.toPxY(e) - m.toPxY(otherE);
  return gap > 0.5 && gap < LEVEL_LABEL_CLEARANCE;
}

/**
 * 準位線のラベルを線の左端に置く(drawLevelLine のラベルと同じ字の大きさ)。
 * below が true なら線の下に置く(近くを通る別の線や曲線が、線の上の文字に
 * かかるとき)。
 */
export function drawLevelLabel(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x0: number,
  e: number,
  text: string,
  color: string,
  below = false,
): void {
  drawLabel(
    ctx,
    text,
    m.toPxX(x0) + 4,
    m.toPxY(e) + (below ? 3 : -3),
    color,
    "left",
    below ? "top" : "bottom",
    PLOT_FONT,
  );
}

/**
 * 細い準位線(E_i・ドナー / アクセプタ準位など)。ラベルは呼び出し側が
 * 右端の外側に drawBoxedLabel で置く(E_F のラベルが左端に来るので反対側に
 * し、E_F の太い破線を描いた後に下地付きで重ねて、線が重なっても読めるように)。
 */
export function drawThinLevel(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x0: number,
  x1: number,
  e: number,
  colors: BandColors,
  color: string,
): void {
  drawLevelLine(ctx, m, x0, x1, e, {
    colors,
    color,
    width: THIN_LEVEL_WIDTH,
    dashed: true,
  });
}

/** 図中の小さな文字(既定 11px・`--color-text-2`) */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = "left",
  baseline: CanvasTextBaseline = "middle",
  font: string = PLOT_FONT_SMALL,
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * 背景色の下地の上に置く小さな文字(粒子や線の上でも読めるように)。
 * x は align に応じた基準点、y は文字の中央。
 */
export function drawBoxedLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colors: BandColors,
  align: "left" | "right" | "center" = "left",
  color: string = colors.text2,
): void {
  ctx.save();
  ctx.font = PLOT_FONT_SMALL;
  const tw = ctx.measureText(text).width;
  const x0 = align === "left" ? x : align === "right" ? x - tw : x - tw / 2;
  ctx.fillStyle = colors.bg;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x0 - 3, y - 8, tw + 6, 16);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x0, y);
  ctx.restore();
}

/**
 * 角の丸い小さな札(縮退の注意など)。anchor が "right" なら右上の角を、
 * "left" なら左上の角を (x, yTop) に置く。返り値は札の高さ(px)。
 */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  x: number,
  yTop: number,
  colors: BandColors,
  maxWidth: number,
  anchor: "left" | "right" = "right",
): number {
  ctx.save();
  ctx.font = PLOT_FONT_SMALL;
  let tw = 0;
  for (const line of lines) tw = Math.max(tw, ctx.measureText(line).width);
  const pad = 7;
  const lineH = 15;
  const bw = Math.min(maxWidth, tw + pad * 2);
  const bh = lines.length * lineH + pad * 2 - 3;
  const left = anchor === "right" ? x - bw : x;
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, yTop, bw, bh, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], left + pad, yTop + pad + i * lineH, bw - pad * 2);
  }
  ctx.restore();
  return bh;
}

/**
 * 操作部品の行を有効 / 無効にする(フランク・リード源・カーケンドール効果の
 * 記事と同じ `.is-disabled` クラス — controls.css — で見た目を揃える)。
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

/**
 * 操作部品の行の直後に、小さな注記の行を差し込む(見た目は読み取り値の行
 * `.ix-readout` と同じ — controls.css)。
 */
export function insertNote(after: HTMLElement, text: string): HTMLElement {
  const note = document.createElement("div");
  note.className = "ix-readout";
  note.textContent = text;
  after.after(note);
  return note;
}

function rect(x: number, y: number, w: number, h: number): PanelRect {
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

export interface SplitLayout {
  first: PanelRect;
  second: PanelRect;
  stacked: boolean;
}

/** パネル間の隙間(splitPanels と同じ 16px) */
const PANEL_GAP = 16;

/**
 * 2 パネルを割合で分ける。横並び / 縦積みの判定は splitPanels と同じ
 * (アスペクト 1.25 未満で縦積み — 仕様書 12 §5.0)にし、幅(縦積みなら高さ)
 * の配分だけを変える。sideFraction は横並びのときの左パネルの幅の割合、
 * stackFraction は縦積みのときの上パネルの高さの割合。
 */
export function splitByFraction(
  size: FigureSize,
  sideFraction: number,
  stackFraction: number,
): SplitLayout {
  const { w, h } = size;
  if (!splitPanels(size).stacked) {
    const w1 = Math.round((w - PANEL_GAP) * sideFraction);
    return {
      first: rect(0, 0, w1, h),
      second: rect(w1 + PANEL_GAP, 0, w - w1 - PANEL_GAP, h),
      stacked: false,
    };
  }
  const h1 = Math.round((h - PANEL_GAP) * stackFraction);
  return {
    first: rect(0, 0, w, h1),
    second: rect(0, h1 + PANEL_GAP, w, h - h1 - PANEL_GAP),
    stacked: true,
  };
}

/** パネル境界の区切り線(hairline) */
export function drawSplitDivider(
  ctx: CanvasRenderingContext2D,
  layout: SplitLayout,
  colors: BandColors,
): void {
  ctx.save();
  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (layout.stacked) {
    const y = (layout.first.y + layout.first.h + layout.second.y) / 2;
    ctx.moveTo(layout.first.x, y);
    ctx.lineTo(layout.first.x + layout.first.w, y);
  } else {
    const x = (layout.first.x + layout.first.w + layout.second.x) / 2;
    ctx.moveTo(x, layout.first.y);
    ctx.lineTo(x, layout.first.y + layout.first.h);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 対数スライダーの値を 1 桁あたり perDecade 段のきりのよい値にそろえる
 * (10¹⁶ のような既定値にちょうど戻れるように)。
 */
export function snapLog(v: number, perDecade = 20): number {
  if (!(v > 0)) return v;
  return 10 ** (Math.round(Math.log10(v) * perDecade) / perDecade);
}
