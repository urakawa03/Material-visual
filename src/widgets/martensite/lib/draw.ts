/**
 * draw.ts — マルテンサイト変態記事の図版共通の Canvas 描画ヘルパ
 * (記事仕様書 10 §5.0)
 *
 * 色・原子・矢印などの小物は、熱処理の文脈を共有する GP ゾーン記事と、
 * 拡散の図を共有するカーケンドール効果記事の lib/draw.ts から再エクスポート
 * する(コピーしない)。ここで足すのは、対数の時間軸を含むグラフの軸と、
 * 下付き文字のラベル(M_s・M_f)だけ。
 */

import { font, fmtPow10 } from "../../../core/plot";
import type { Palette } from "../../gp-zones/lib/draw";

export {
  atom,
  badge,
  resolvePalette,
  type Palette,
} from "../../gp-zones/lib/draw";
export {
  arrow,
  dashedLine,
  drawAtoms,
  outlinedText,
  paneFrame,
  type Pane,
} from "../../kirkendall-effect/lib/draw";
export {
  font,
  fmtPow10,
  fmtSci,
  fmtSig,
  linTicks,
  logTicks,
} from "../../../core/plot";

/**
 * これより小さいキャンバス(レイアウト前など)には描かない [CSS px]。
 * 寸法から計算する半径が負になって例外を投げるのを防ぐ。
 */
export const MIN_CANVAS_PX = 60;

/* ------------------------------------------------------------- 軸の写像 */

/** 値 → 画面座標の写像(線形または対数) */
export interface Scale {
  min: number;
  max: number;
  log: boolean;
  /** 値 min・max に対応する画面座標 */
  px0: number;
  px1: number;
}

export function makeScale(
  min: number,
  max: number,
  px0: number,
  px1: number,
  log = false,
): Scale {
  return { min, max, px0, px1, log };
}

/** 値を画面座標へ(範囲外もそのまま外挿する) */
export function mapScale(s: Scale, v: number): number {
  const t = s.log
    ? (Math.log10(v) - Math.log10(s.min)) /
      (Math.log10(s.max) - Math.log10(s.min))
    : (v - s.min) / (s.max - s.min);
  return s.px0 + (s.px1 - s.px0) * t;
}

/** 画面座標を値へ(mapScale の逆) */
export function unmapScale(s: Scale, px: number): number {
  const t = (px - s.px0) / (s.px1 - s.px0);
  return s.log
    ? 10 ** (Math.log10(s.min) + t * (Math.log10(s.max) - Math.log10(s.min)))
    : s.min + t * (s.max - s.min);
}

/**
 * 時間軸(秒)の目盛りのラベル。1000 秒未満は「0.1」「1」「10」「100」、
 * それ以上は「10³」の形にする(対数軸 — P0 の fmtPow10)。
 */
export function timeTickLabel(v: number): string {
  if (v < 1000) return String(Number(v.toPrecision(3)));
  return fmtPow10(v);
}

export interface AxesOptions {
  xTicks: readonly number[];
  yTicks: readonly number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** 軸の題(横軸は下、縦軸は左上に横書き) */
  xTitle?: string;
  yTitle?: string;
  /** 目盛りの文字の大きさ(既定 11px) */
  fontPx?: number;
  /** 補助の横線(y の目盛り位置に hairline を引く) */
  gridY?: boolean;
}

/**
 * 左と下の軸・目盛り・目盛りの文字を描く(hairline の軸線・text-2 の文字)。
 * x・y の写像は呼び出し側で作る(px0/px1 がプロット枠の端)。
 */
export function drawAxes(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  x: Scale,
  y: Scale,
  opts: AxesOptions,
): void {
  const fx = opts.xFormat ?? ((v: number) => String(v));
  const fy = opts.yFormat ?? ((v: number) => String(v));
  const fs = opts.fontPx ?? 11;
  const left = Math.min(x.px0, x.px1);
  const right = Math.max(x.px0, x.px1);
  const bottom = Math.max(y.px0, y.px1);
  const top = Math.min(y.px0, y.px1);

  if (opts.gridY) {
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const v of opts.yTicks) {
      const py = Math.round(mapScale(y, v)) + 0.5;
      if (py < top - 0.5 || py > bottom + 0.5) continue;
      ctx.moveTo(left, py);
      ctx.lineTo(right, py);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = pal.text2;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left + 0.5, top);
  ctx.lineTo(left + 0.5, bottom + 0.5);
  ctx.lineTo(right, bottom + 0.5);
  // 目盛りの短い線
  for (const v of opts.xTicks) {
    const px = Math.round(mapScale(x, v)) + 0.5;
    if (px < left - 0.5 || px > right + 0.5) continue;
    ctx.moveTo(px, bottom + 0.5);
    ctx.lineTo(px, bottom + 4.5);
  }
  for (const v of opts.yTicks) {
    const py = Math.round(mapScale(y, v)) + 0.5;
    if (py < top - 0.5 || py > bottom + 0.5) continue;
    ctx.moveTo(left - 3.5, py);
    ctx.lineTo(left + 0.5, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.font = font(fs);
  ctx.fillStyle = pal.text2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const v of opts.xTicks) {
    const px = mapScale(x, v);
    if (px < left - 0.5 || px > right + 0.5) continue;
    ctx.fillText(fx(v), px, bottom + 6);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of opts.yTicks) {
    const py = mapScale(y, v);
    if (py < top - 0.5 || py > bottom + 0.5) continue;
    ctx.fillText(fy(v), left - 6, py);
  }
  if (opts.xTitle) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(opts.xTitle, (left + right) / 2, bottom + 8 + fs + 3);
  }
  if (opts.yTitle) {
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.yTitle, left - 4, top - 6);
  }
}

/**
 * 下付き文字つきのラベル(「M」+ 小さな「s」など)。align は全体の揃え。
 * 返り値は描いた幅。
 */
export function subLabel(
  ctx: CanvasRenderingContext2D,
  base: string,
  sub: string,
  rest: string,
  x: number,
  y: number,
  color: string,
  fontPx: number,
  align: "left" | "right" | "center" = "left",
  weight = 400,
): number {
  ctx.font = font(fontPx, weight);
  const wBase = ctx.measureText(base).width;
  const wRest = ctx.measureText(rest).width;
  ctx.font = font(fontPx * 0.72, weight);
  const wSub = ctx.measureText(sub).width;
  const total = wBase + wSub + 1 + wRest;
  let x0 = x;
  if (align === "right") x0 = x - total;
  else if (align === "center") x0 = x - total / 2;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(fontPx, weight);
  ctx.fillText(base, x0, y);
  ctx.font = font(fontPx * 0.72, weight);
  ctx.fillText(sub, x0 + wBase, y + fontPx * 0.22);
  ctx.font = font(fontPx, weight);
  ctx.fillText(rest, x0 + wBase + wSub + 1, y);
  return total;
}

/** 白い下地つきの角丸ラベル(線の上に重ねても読めるように) */
export function plateText(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  s: string,
  x: number,
  y: number,
  color: string,
  fontPx = 11,
  align: "left" | "right" | "center" = "left",
  baseline: "top" | "middle" | "bottom" = "middle",
): void {
  ctx.font = font(fontPx);
  const w = ctx.measureText(s).width;
  const h = fontPx + 6;
  let x0 = x;
  if (align === "right") x0 = x - w;
  else if (align === "center") x0 = x - w / 2;
  let y0 = y - h / 2;
  if (baseline === "top") y0 = y;
  else if (baseline === "bottom") y0 = y - h;
  ctx.fillStyle = pal.bg;
  ctx.globalAlpha = 0.88;
  ctx.fillRect(x0 - 3, y0, w + 6, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(s, x0, y0 + h / 2 + 0.5);
}

/** 温度を「−199 ℃」の形にする(負号は U+2212、整数に丸める) */
export function fmtCelsius(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? "−" : ""}${Math.abs(r)} ℃`;
}

/** 百分率を「12%」「0.4%」の形にする(1% 未満は小数 1 桁) */
export function fmtPercent(frac: number): string {
  const v = frac * 100;
  if (Math.abs(v) < 1 && v !== 0) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
}

/** 符号つきの百分率「+12.9%」「−20.2%」(小数 1 桁、負号は U+2212) */
export function fmtSignedPercent(frac: number): string {
  const v = frac * 100;
  const s = Math.abs(v).toFixed(1);
  if (s === "0.0") return "0.0%";
  return `${v < 0 ? "−" : "+"}${s}%`;
}

/** 2D キャンバスを取得する(取れなければ例外) */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D コンテキストを取得できません");
  return ctx;
}

/** 省モーション設定か(prefers-reduced-motion: reduce) */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
