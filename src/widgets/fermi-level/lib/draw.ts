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

/** フェルミ準位の線(太い破線・電子の色・ラベルは左端) */
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

/**
 * 細い準位線(E_i・ドナー / アクセプタ準位など)。ラベルは右端の外側に置く
 * (E_F のラベルが左端に来るので、重ならないよう反対側にする)。
 */
export function drawThinLevel(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x0: number,
  x1: number,
  e: number,
  colors: BandColors,
  color: string,
  label?: string,
): void {
  drawLevelLine(ctx, m, x0, x1, e, {
    colors,
    color,
    width: THIN_LEVEL_WIDTH,
    dashed: true,
  });
  if (label) {
    ctx.save();
    ctx.font = PLOT_FONT_SMALL;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, m.toPxX(x1) + 4, m.toPxY(e));
    ctx.restore();
  }
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
 * 角の丸い小さな札(縮退の注意など)。右上の角を (xRight, yTop) に置く。
 * 返り値は札の高さ(px)。
 */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  xRight: number,
  yTop: number,
  colors: BandColors,
  maxWidth: number,
): number {
  ctx.save();
  ctx.font = PLOT_FONT_SMALL;
  let tw = 0;
  for (const line of lines) tw = Math.max(tw, ctx.measureText(line).width);
  const pad = 7;
  const lineH = 15;
  const bw = Math.min(maxWidth, tw + pad * 2);
  const bh = lines.length * lineH + pad * 2 - 3;
  const x = xRight - bw;
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, yTop, bw, bh, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + pad, yTop + pad + i * lineH, bw - pad * 2);
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
