/**
 * draw.ts — 記事「トンネル効果と STM」の 2D 図版の共通の小物(仕様書 14 §5.0)
 *
 * 軸・曲線・帯・準位線はカテゴリ D の `_shared/banddiagram.ts`、矢印と
 * 読み取り値は逆格子空間の記事の `_shared2d.ts`、白ふち取りの文字は
 * エヴァルト球の記事の `_draw2d.ts`、寸法線と操作部品の有効/無効は
 * カーケンドール効果の記事の `lib/draw.ts`、描けないほど小さいキャンバスの
 * 判定は構造因子の記事の `lib/draw.ts` から再利用する(再実装しない)。
 * ここに置くのは、この記事で新しく必要になった色の組・パネルの分割・
 * 対数軸の目盛り・数値の書式だけである。
 *
 * 色はすべて colors.ts(CSS 変数)経由で受け取り、ここでは直書きしない(§6.2)。
 */

import { darken, matColor, uiColor } from "../../../core/colors";
import { fmtSci, fmtSig, pow10Label } from "../../../core/plot";
import type { AxisTick } from "../../_shared/banddiagram";

export { haloText } from "../../ewald-sphere/_draw2d";
export {
  dimensionLine,
  setControlEnabled,
} from "../../kirkendall-effect/lib/draw";
export { tooSmall } from "../../structure-factor/lib/draw";

/* ------------------------------------------------------------- 色 */

export interface Palette {
  /** 電子・波動関数・|ψ|²(--mat-electron) */
  electron: string;
  /** 壁・探針・試料の原子(--mat-matrix) */
  matrix: string;
  matrixEdge: string;
  /** 2 種類目の原子(図6 の B 原子 — --mat-second) */
  second: string;
  secondEdge: string;
  /** トンネル電流の流れ(塗り・線 --mat-beam、文字 --mat-beam-ink) */
  beam: string;
  beamInk: string;
  /** 準位・バンド端(--mat-level)と許容帯(--mat-band) */
  level: string;
  band: string;
  hairline: string;
  /** hairline を少し暗くした補助線(白地でも見える細線) */
  ghost: string;
  accent: string;
  text: string;
  text2: string;
  bg: string;
}

/** 補助線を白地で見えるようにする暗さ(構造因子の記事と同じ値) */
const GHOST_DARKEN = 0.15;

/** 図版で使う色をまとめて解決する(初期化時に一度だけ呼ぶ — §6.2) */
export function resolvePalette(): Palette {
  const matrix = matColor("matrix");
  const second = matColor("second");
  const hairline = uiColor("hairline");
  return {
    electron: matColor("electron"),
    matrix,
    matrixEdge: darken(matrix, 0.2),
    second,
    secondEdge: darken(second, 0.2),
    beam: matColor("beam"),
    beamInk: matColor("beamInk"),
    level: matColor("level"),
    band: matColor("band"),
    hairline,
    ghost: darken(hairline, GHOST_DARKEN),
    accent: uiColor("accent"),
    text: uiColor("text"),
    text2: uiColor("text2"),
    bg: uiColor("bg"),
  };
}

/** `#rrggbb` を [r, g, b](0〜255)にする。読めない形式なら fallback */
export function parseHex(
  color: string,
  fallback: readonly [number, number, number],
): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [fallback[0], fallback[1], fallback[2]];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/* ---------------------------------------------------------- パネル分割 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 横並びと判定するアスペクト比の下限(これより縦長なら上下に積む) */
const SIDE_BY_SIDE_MIN_ASPECT = 1.2;

/**
 * キャンバスを 2 つのパネルに分ける。横長なら左右(左の幅の割合 = ratio)、
 * 縦長(狭幅の 4/5 など)なら上下(上の高さの割合 = stackedRatio)。
 * out の 2 つの矩形を書き換えて返す(フレーム内の新規割当てなし)。
 */
export function splitTwo(
  w: number,
  h: number,
  ratio: number,
  stackedRatio: number,
  gap: number,
  first: Rect,
  second: Rect,
): boolean {
  const stacked = w < h * SIDE_BY_SIDE_MIN_ASPECT;
  if (stacked) {
    const h1 = Math.round((h - gap) * stackedRatio);
    setRect(first, 0, 0, w, h1);
    setRect(second, 0, h1 + gap, w, h - h1 - gap);
  } else {
    const w1 = Math.round((w - gap) * ratio);
    setRect(first, 0, 0, w1, h);
    setRect(second, w1 + gap, 0, w - w1 - gap, h);
  }
  return stacked;
}

export function setRect(
  r: Rect,
  x: number,
  y: number,
  w: number,
  h: number,
): Rect {
  r.x = x;
  r.y = y;
  r.w = Math.max(1, w);
  r.h = Math.max(1, h);
  return r;
}

export function rect(): Rect {
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** パネルの区切り線(hairline) */
export function drawDivider(
  ctx: CanvasRenderingContext2D,
  a: Rect,
  b: Rect,
  stacked: boolean,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (stacked) {
    const y = Math.round((a.y + a.h + b.y) / 2) + 0.5;
    ctx.moveTo(a.x, y);
    ctx.lineTo(a.x + a.w, y);
  } else {
    const x = Math.round((a.x + a.w + b.x) / 2) + 0.5;
    ctx.moveTo(x, a.y);
    ctx.lineTo(x, a.y + a.h);
  }
  ctx.stroke();
  ctx.restore();
}

/* ---------------------------------------------------------- 対数軸の目盛り */

/**
 * 対数軸(値は log₁₀ で持つ)の目盛り。指数 e0〜e1 の 10 の冪ごとに目盛りを置き、
 * labelEvery 桁ごとにだけ「10⁻⁴」のラベルを付ける。初期化時に 1 回だけ作る。
 * ラベルは src/core/plot.ts の pow10Label(banddiagram の pow10Ticks には依存しない)。
 */
export function log10Ticks(e0: number, e1: number, labelEvery = 1): AxisTick[] {
  const out: AxisTick[] = [];
  for (let e = Math.ceil(e0); e <= Math.floor(e1); e++) {
    const labelled = ((e % labelEvery) + labelEvery) % labelEvery === 0;
    out.push({ value: e, label: labelled ? pow10Label(e) : undefined });
  }
  return out;
}

/* ---------------------------------------------------------- 読み取りの配置 */

/**
 * 読み取りの項目(_shared2d の createReadout の項目の要素)をいつも自分の行に
 * 置き、狭い画面では項目の中で折り返す。値の長さが変わっても読み取りの行数が
 * 変わらず(スライダーの操作中に操作部品が上下に動かない)、長い文が狭幅で
 * 横にはみ出さない。
 */
export function ownLine(el: HTMLElement): void {
  el.style.flexBasis = "100%";
  el.style.whiteSpace = "normal";
}

/** 読み取りの項目を、狭い画面では項目の中で折り返せるようにする */
export function wrapInside(el: HTMLElement): void {
  el.style.whiteSpace = "normal";
}

/* ---------------------------------------------------------- 数値の書式 */

/**
 * 常用対数 log₁₀ v から「2.4 × 10⁻⁴¹」の形の文字列を作る(v そのものが
 * 倍精度であふれる・消える桁でも書ける)。
 */
export function fmtFromLog10(log10v: number, digits = 2): string {
  if (!Number.isFinite(log10v)) return log10v > 0 ? "∞" : "0";
  if (Math.abs(log10v) < 250) return fmtSci(10 ** log10v, digits);
  let e = Math.floor(log10v);
  let mant = Number((10 ** (log10v - e)).toPrecision(digits));
  if (mant >= 10) {
    mant /= 10;
    e += 1;
  }
  return `${mant === 1 ? "" : `${mant} × `}${pow10Label(e)}`;
}

/**
 * 割合(0〜1)をパーセントで書く。0.01% 未満は「3.7 × 10⁻⁷ %」の形にする
 * (図1・図3 の透過率)。
 */
export function fmtPercent(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct >= 0.01) return `${fmtSig(pct, digits)}%`;
  return `${fmtSci(pct, digits)} %`;
}

/** 「3600 分の 1」の形(ratio < 1 の比)。大きな分母は「2.1 × 10⁹ 分の 1」 */
export function fmtOneOver(ratio: number): string {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return "—";
  const inv = 1 / ratio;
  if (inv < 1.05) return "ほぼ同じ";
  // 有効数字 2 桁(3630 →「3600 分の 1」)
  if (inv < 1e5) return `${Number(inv.toPrecision(2))} 分の 1`;
  return `${fmtSci(inv, 2)} 分の 1`;
}

/** 「× 8.8」の形の倍率 */
export function fmtTimes(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return ratio < 1e5 ? `${fmtSig(ratio, 2)} 倍` : `${fmtSci(ratio, 2)} 倍`;
}
