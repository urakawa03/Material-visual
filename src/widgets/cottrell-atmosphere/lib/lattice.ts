/**
 * lattice.ts — 刃状転位入り 2D 格子の幾何と場の評価(記事仕様 §5.0)
 *
 * 図2(応力場)・図3(エネルギープローブ)・図4(平衡地図)・図5(拡散
 * キネティクス)で共用する。
 *
 * 座標系(§5.0): 物理式は「y 上向き・余分な半面は +y 側・引張側は y < 0」
 * で定義する。長さの単位はバーガースベクトル b(格子定数も b とする)。
 * Canvas は y 下向きなので、描画層(LatticeView)で必ず反転する。
 *
 * 簡略化(母体仕様 §2-5): 実際の α-Fe は BCC だが、ここでは 2D 正方格子に
 * 簡略化する。弾性場は等方弾性の刃状転位の厳密解を用いる。
 */

import { clamp } from "../../../core/mathx";
import { FIELD_R_MIN_B, KB_EV, POISSON, U_BIND_EV } from "./constants";

/* ------------------------------------------------------------ 変位場 */

/** 変位場の評価半径の下限(b 単位)。コア特異点の発散を避ける(§5.0) */
const CORE_CLAMP_R_B = 1;

const DISP_COEF = 1 / (2 * Math.PI);
const NU_FACTOR = 1 / (2 * (1 - POISSON));
const LOG_COEF = (1 - 2 * POISSON) / (4 * (1 - POISSON));
const DEV_COEF = 1 / (4 * (1 - POISSON));

/**
 * 等方弾性の刃状転位変位場(記事仕様 §5.2。実装用で本文には出さない)。
 *   u_x = (b/2π)[atan2(y, x) + xy / (2(1−ν) r²)]
 *   u_y = −(b/2π)[(1−2ν)/(4(1−ν)) ln r² + (x²−y²)/(4(1−ν) r²)]
 * 入出力とも b 単位。out に {x, y} を書き込む(毎フレーム割当て回避)。
 * コア近傍(r < 1b)は半径方向に押し出した点で評価してクランプする。
 */
export function edgeDisplacement(
  x: number,
  y: number,
  out: { x: number; y: number },
): void {
  let ex = x;
  let ey = y;
  const r = Math.hypot(x, y);
  if (r === 0) {
    out.x = 0;
    out.y = 0;
    return;
  }
  if (r < CORE_CLAMP_R_B) {
    const s = CORE_CLAMP_R_B / r;
    ex *= s;
    ey *= s;
  }
  const r2 = ex * ex + ey * ey;
  out.x = DISP_COEF * (Math.atan2(ey, ex) + (ex * ey * NU_FACTOR) / r2);
  out.y =
    -DISP_COEF *
    (LOG_COEF * Math.log(r2) + (DEV_COEF * (ex * ex - ey * ey)) / r2);
}

/* ------------------------------------------------------------ 場の評価 */

/**
 * 静水圧場の正規化値 p̂(r, θ) = sinθ / r(b 単位・±1 にクランプ)。
 * p > 0 が圧縮(+y 側)、p < 0 が引張(−y 側)。実寸の係数 B は描画には
 * 不要なので持たない(不透明度への写像にのみ使う — §5.2)。
 */
export function pressureNorm(x: number, y: number): number {
  const r = Math.hypot(x, y);
  if (r === 0) return 0;
  const rc = Math.max(r, FIELD_R_MIN_B);
  return clamp(y / r / rc, -1, 1);
}

/**
 * 溶質–転位の相互作用エネルギー U(r, θ) = A sinθ / r [eV](記事仕様 §5.3)。
 * A は U(r=b, θ=−π/2) = −U_b となるよう校正(A = U_b·b。r が b 単位なので
 * 係数は U_b に一致する)。amp に A の実効値を渡す(格子間型 C は +U_b、
 * 置換型(小)は −0.6·U_b — 符号反転+効果を弱める)。
 * クランプ: r ≥ b、|U| ≤ U_b(§5.0)。
 */
export function soluteEnergy(
  x: number,
  y: number,
  amp: number = U_BIND_EV,
): number {
  const r = Math.hypot(x, y);
  if (r === 0) return 0;
  const rc = Math.max(r, FIELD_R_MIN_B);
  return clamp((amp * (y / r)) / rc, -U_BIND_EV, U_BIND_EV);
}

/** 置換型(小さい原子)の実効係数: A → −0.6A(記事仕様 §5.3) */
export const SUBSTITUTIONAL_AMP = -0.6 * U_BIND_EV;

/**
 * 飽和つきボルツマン分布(フェルミ型)による平衡占有率(記事仕様 §5.4):
 *   c = c0 e^(−U/kBT) / (1 − c0 + c0 e^(−U/kBT))
 * U [eV]、tempK [K]。U → −∞ で c → 1(凝縮)、U = 0 で c = c0。
 */
export function equilibriumOccupancy(
  u: number,
  tempK: number,
  c0: number,
): number {
  const w = Math.exp(-u / (KB_EV * tempK));
  return (c0 * w) / (1 - c0 + c0 * w);
}

/* ------------------------------------------------------------ 格子の生成 */

export interface EdgeLattice {
  /** 原子数 */
  count: number;
  /** 列数・行数 */
  cols: number;
  rows: number;
  /** 基準位置(b 単位・転位中心原点・y 上向き)。列 x は整数、行 y は半整数 */
  refX: Float64Array;
  refY: Float64Array;
  /** 変位場(誇張 ×1、b 単位) */
  ux: Float64Array;
  uy: Float64Array;
}

/**
 * 刃状転位入りの 2D 正方格子を作る(記事仕様 §5.0)。
 *
 * 完全格子(列 x = 整数、行 y = 半整数 — すべり面 y = 0 上に原子を
 * 置かない)に刃状転位の変位場を適用する。変位場の分枝切断(x < 0 の
 * すべり面)をまたぐ相対すべり b により、+y 側に余分な半面(x = 0 の列の
 * 上半分)が現れ、下半分の 1 列が実質的に取り除かれた配置になる。
 * cols は奇数を推奨(x = 0 の列 = 余分な半面が中央に来る)。
 */
export function buildEdgeLattice(cols: number, rows: number): EdgeLattice {
  const count = cols * rows;
  const refX = new Float64Array(count);
  const refY = new Float64Array(count);
  const ux = new Float64Array(count);
  const uy = new Float64Array(count);
  const x0 = -(cols - 1) / 2;
  const y0 = -(rows - 1) / 2 - 0.5;
  const tmp = { x: 0, y: 0 };
  let k = 0;
  for (let j = 0; j < rows; j++) {
    // 行 y は半整数(…, −1.5, −0.5, +0.5, …)
    const y = y0 + j + 0.5;
    for (let i = 0; i < cols; i++) {
      const x = x0 + i;
      refX[k] = x;
      refY[k] = y;
      edgeDisplacement(x, y, tmp);
      ux[k] = tmp.x;
      uy[k] = tmp.y;
      k++;
    }
  }
  return { count, cols, rows, refX, refY, ux, uy };
}

/**
 * 余分な半面の端(⊥ 記号を置く位置)を返す(b 単位・物理座標)。
 * x = 0 列の最下段(y = +0.5)の原子の変位に追従させ、記号がすべり面
 * (y = 0)上・半面の直下に来るようにする。
 */
export function dislocationSymbolPos(
  exaggeration: number,
  out: { x: number; y: number },
): void {
  const tmp = { x: 0, y: 0 };
  edgeDisplacement(0, 0.5, tmp);
  out.x = exaggeration * tmp.x;
  out.y = 0;
}

/* ------------------------------------------------------------ 描画ヘルパ */

/**
 * 物理座標(b 単位・y 上向き)→ Canvas 座標(CSS px・y 下向き)の変換。
 * §5.0 の「描画層で必ず反転する」を一手に引き受ける。
 */
export interface LatticeView {
  /** 物理原点の Canvas 座標 */
  cx: number;
  cy: number;
  /** 1b あたりの px 数 */
  scale: number;
}

/**
 * 格子全体がキャンバスに収まる LatticeView を作る。widthB / heightB は
 * 収めたい物理領域の寸法(b 単位)。変位の誇張で格子がはみ出す図版は、
 * 誇張率に応じた余裕を足して渡す(u_x は最大 ±b/2 × 誇張率)。
 */
export function makeLatticeView(
  w: number,
  h: number,
  widthB: number,
  heightB: number,
  marginPx = 12,
): LatticeView {
  const scale = Math.min(
    (w - marginPx * 2) / widthB,
    (h - marginPx * 2) / heightB,
  );
  return { cx: w / 2, cy: h / 2, scale };
}

export function viewX(v: LatticeView, x: number): number {
  return v.cx + x * v.scale;
}

/** y 反転はここで行う(§5.0 符号バグの温床への対策) */
export function viewY(v: LatticeView, y: number): number {
  return v.cy - y * v.scale;
}

const TAU = Math.PI * 2;

/**
 * 格子原子を 1 パスでまとめ描きする(母体仕様 §8.3)。
 * 位置は物理座標(b 単位)の配列 + 変位 × 誇張。
 */
export function drawLatticeAtoms(
  ctx: CanvasRenderingContext2D,
  view: LatticeView,
  lat: EdgeLattice,
  exaggeration: number,
  radiusPx: number,
  fill: string,
  edge: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < lat.count; i++) {
    const x = viewX(view, lat.refX[i] + exaggeration * lat.ux[i]);
    const y = viewY(view, lat.refY[i] + exaggeration * lat.uy[i]);
    ctx.moveTo(x + radiusPx, y);
    ctx.arc(x, y, radiusPx, 0, TAU);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

/**
 * ⊥ 記号(刃状転位)を描く。中心 (x, y) は物理座標(b 単位)。
 * サイズは格子間隔に比例。線幅 2px(母体仕様 §6.5)。
 */
export function drawDislocationMark(
  ctx: CanvasRenderingContext2D,
  view: LatticeView,
  x: number,
  y: number,
  color: string,
  sizeB = 0.9,
): void {
  const s = sizeB * view.scale;
  const px = viewX(view, x);
  const py = viewY(view, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  // 横棒(すべり面)と、そこから上へ伸びる縦棒(余分な半面)
  ctx.moveTo(px - s / 2, py);
  ctx.lineTo(px + s / 2, py);
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - s * 0.75);
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** `rgba(r, g, b, a)` / `#rrggbb` 形式から RGB 成分を取り出す */
export function parseRgb(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(
    color.trim(),
  );
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  return [0, 0, 0];
}

/** 体積ひずみオーバーレイの最大不透明度(|p̂| = 1 のとき) */
const OVERLAY_ALPHA_MAX = 0.42;
/** オーバーレイのセル分割(1b あたり) */
const OVERLAY_CELLS_PER_B = 1;

/**
 * 圧縮/引張場のセル塗りオーバーレイ(記事仕様 §5.2)。
 * 格子領域を 1b 角のセルに割り、p̂ = sinθ/r の符号で色
 * (圧縮 --mat-compression / 引張 --mat-tension)、|p̂| で不透明度を決める。
 * tensionRgb / compressionRgb には parseRgb() の結果を渡す。
 */
export function drawPressureOverlay(
  ctx: CanvasRenderingContext2D,
  view: LatticeView,
  cols: number,
  rows: number,
  tensionRgb: [number, number, number],
  compressionRgb: [number, number, number],
): void {
  const half = 1 / (2 * OVERLAY_CELLS_PER_B);
  const cellPx = view.scale / OVERLAY_CELLS_PER_B + 0.5; // 隙間を残さない
  const nx = cols * OVERLAY_CELLS_PER_B;
  const ny = rows * OVERLAY_CELLS_PER_B;
  for (let j = 0; j < ny; j++) {
    const y = (j - (ny - 1) / 2) / OVERLAY_CELLS_PER_B;
    for (let i = 0; i < nx; i++) {
      const x = (i - (nx - 1) / 2) / OVERLAY_CELLS_PER_B;
      const p = pressureNorm(x, y);
      const a = Math.abs(p) * OVERLAY_ALPHA_MAX;
      if (a < 0.01) continue;
      const [cr, cg, cb] = p > 0 ? compressionRgb : tensionRgb;
      ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${a.toFixed(3)})`;
      ctx.fillRect(
        viewX(view, x - half),
        viewY(view, y + half),
        cellPx,
        cellPx,
      );
    }
  }
}
