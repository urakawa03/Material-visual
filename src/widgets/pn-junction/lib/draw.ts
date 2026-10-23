/**
 * draw.ts — 記事「pn 接合」の図版で共通に使う描画・UI の小物
 *
 * バンド図そのもの(曲がった帯・準位線・キャリアの丸)は `_shared/banddiagram.ts`
 * を使い、フェルミ準位の線の約束(線幅 2.2・破線・`--mat-electron`)など前の記事
 * 「フェルミ準位」の小物は同記事の `lib/draw.ts` を再エクスポートして使う
 * (視覚言語を記事をまたいで揃える)。ここには本記事だけの約束事を置く:
 *
 * - **自由キャリア = 塗り丸、固定イオン = `--mat-solute` の輪 + 符号**
 *   (アクセプタ「−」・ドナー「+」)。新色は作らない(空孔が「塗りなし」で
 *   表されるのと同じ発想 — 仕様書 13 §2.3)
 * - 電場・電荷密度・電位など中立の量は `--color-text-2`
 * - 位置軸は μm。表示範囲が変わる瞬間は 150 ms で補間する(§5.0 — tween)
 */

import { tween, type Tween } from "../../../core/anim";
import { linTicks } from "../../../core/plot";
import {
  drawBandRibbon,
  PLOT_FONT,
  PLOT_FONT_SMALL,
  type AxisTick,
  type BandColors,
  type PlotMapper,
} from "../../_shared/banddiagram";
import type { Semiconductor } from "../../_shared/semiconductor";
import { bandEdges, type BandEdges, type Depletion } from "./junction";

export {
  drawBadge,
  drawBoxedLabel,
  drawFermiLine,
  drawLabel,
  drawLevelLabel,
  drawSplitDivider,
  drawThinLevel,
  fermiColors as pnColors,
  FERMI_LINE_WIDTH,
  insertNote,
  setControlEnabled,
  snapLog,
  splitByFraction,
  THIN_LEVEL_WIDTH,
  type FermiColors as PnColors,
} from "../../fermi-level/lib/draw";
export { formatEvFixed, formatEvSigned } from "../../fermi-level/lib/format";

/** 負号(U+2212) */
export const MINUS = "−";

/** 狭い画面の判定(曲線のサンプル数・文字の配置を切り替える) */
export const NARROW_WIDTH_PX = 480;

/** 省モーション設定か(engine・core/anim と同じ判定) */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 曲線のサンプル数(既定 241、画面幅 480px 未満で 121 — §5.0) */
export function curveSamples(widthPx: number): number {
  return widthPx < NARROW_WIDTH_PX ? 121 : 241;
}

/* ---------------------------------------------------------------- 数値の書式 */

/** 符号を「−」にした固定小数(丸めて 0 なら符号なし) */
export function fixedSigned(v: number, digits: number): string {
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(s) !== 0 ? MINUS : ""}${s}`;
}

/** 位置軸の目盛り(μm)。−0 を出さず、負号は「−」 */
export function micronTicks(
  xMin: number,
  xMax: number,
  target = 5,
): AxisTick[] {
  const values = linTicks(xMin, xMax, target);
  const step = values.length > 1 ? values[1] - values[0] : 1;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return values.map((v) => ({
    value: v,
    label: fixedSigned(Math.abs(v) < step * 1e-6 ? 0 : v, digits),
  }));
}

/* ------------------------------------------------------- 表示範囲の補間 */

/**
 * 位置軸の表示範囲(半幅)。目標が変わったら 150 ms で補間する(§5.0)。
 * requestRender 型の図版用(遷移が終われば描画は止まる)。
 */
export class AnimatedRange {
  value: number;
  private target: number;
  private anim: Tween | null = null;

  constructor(initial: number) {
    this.value = initial;
    this.target = initial;
  }

  /** 目標を変える。変化があれば補間を始め、毎フレーム onUpdate を呼ぶ */
  set(target: number, onUpdate: () => void, durationMs = 150): void {
    if (Math.abs(target - this.target) < 1e-9) return;
    this.target = target;
    this.cancel();
    const from = this.value;
    this.anim = tween(
      from,
      target,
      durationMs,
      (v) => {
        this.value = v;
        onUpdate();
      },
      () => {
        this.anim = null;
        this.value = target;
        onUpdate();
      },
    );
  }

  /** 補間せずにすぐ値を置く(reset 用) */
  jump(target: number): void {
    this.cancel();
    this.target = target;
    this.value = target;
  }

  cancel(): void {
    if (this.anim) {
      this.anim.cancel();
      this.anim = null;
    }
  }
}

/* -------------------------------------------------------------- バンド図 */

/** 曲がったバンド図のサンプル(使い回す Float64Array) */
export class BandSamples {
  readonly xs: Float64Array;
  /** 伝導帯の底 E_c(x) と、帯の上端(見た目の厚み分だけ上) */
  readonly ec: Float64Array;
  readonly ecTop: Float64Array;
  /** 価電子帯の頂上 E_v(x) と、帯の下端 */
  readonly ev: Float64Array;
  readonly evBottom: Float64Array;
  /** 真性準位 E_i(x) */
  readonly ei: Float64Array;
  count = 0;
  private readonly edges: BandEdges = { ec: 0, ev: 0, ei: 0 };

  constructor(capacity = 241) {
    this.xs = new Float64Array(capacity);
    this.ec = new Float64Array(capacity);
    this.ecTop = new Float64Array(capacity);
    this.ev = new Float64Array(capacity);
    this.evBottom = new Float64Array(capacity);
    this.ei = new Float64Array(capacity);
  }

  /**
   * x ∈ [xMin, xMax] を n 点でサンプルする。thickness は帯の見た目の厚み
   * [eV](伝導帯は E_c から上へ、価電子帯は E_v から下へ一定幅)。
   * offset は全体を上下にずらす量 [eV](図6 の材料別のギャップで使う)。
   */
  sample(
    sc: Semiconductor,
    d: Depletion,
    T: number,
    xMin: number,
    xMax: number,
    n: number,
    thickness: number,
  ): void {
    const count = Math.max(2, Math.min(n, this.xs.length));
    for (let i = 0; i < count; i++) {
      const x = xMin + ((xMax - xMin) * i) / (count - 1);
      bandEdges(sc, d, x, T, this.edges);
      this.xs[i] = x;
      this.ec[i] = this.edges.ec;
      this.ecTop[i] = this.edges.ec + thickness;
      this.ev[i] = this.edges.ev;
      this.evBottom[i] = this.edges.ev - thickness;
      this.ei[i] = this.edges.ei;
    }
    this.count = count;
  }
}

/** 曲がったバンドを描く(伝導帯は下縁 = E_c、価電子帯は上縁 = E_v を縁取る) */
export function drawBands(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  s: BandSamples,
  colors: BandColors,
): void {
  drawBandRibbon(ctx, m, s.xs, s.ec, s.ecTop, s.count, {
    colors,
    edges: "low",
  });
  drawBandRibbon(ctx, m, s.xs, s.evBottom, s.ev, s.count, {
    colors,
    edges: "high",
  });
}

/** 真性準位 E_i(x) の細い破線 */
export function drawIntrinsicCurve(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  s: BandSamples,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(m.toPxX(s.xs[0]), m.toPxY(s.ei[0]));
  for (let i = 1; i < s.count; i++) {
    ctx.lineTo(m.toPxX(s.xs[i]), m.toPxY(s.ei[i]));
  }
  ctx.stroke();
  ctx.restore();
}

/** 空乏層の端を示す縦の細い破線(プロット領域の上から下まで) */
export function drawEdgeLine(
  ctx: CanvasRenderingContext2D,
  m: PlotMapper,
  x: number,
  color: string,
  yTop = m.rect.y,
  yBottom = m.rect.y + m.rect.h,
): void {
  const px = Math.round(m.toPxX(x)) + 0.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(px, yTop);
  ctx.lineTo(px, yBottom);
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------------------------------------- 寸法線 */

/**
 * 縦の寸法線(両端の矢羽根)とラベル。ラベルは背景色の下地の上に置く
 * (帯や線と重なっても読めるように)。side はラベルを線のどちら側に置くか。
 */
export function drawDimension(
  ctx: CanvasRenderingContext2D,
  x: number,
  yA: number,
  yB: number,
  text: string,
  colors: BandColors,
  side: "left" | "right" = "right",
  textColor: string = colors.text,
): void {
  const top = Math.min(yA, yB);
  const bottom = Math.max(yA, yB);
  ctx.save();
  ctx.strokeStyle = colors.text2;
  ctx.fillStyle = colors.text2;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  if (bottom - top > 12) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - 3.5, top + 6);
    ctx.lineTo(x + 3.5, top + 6);
    ctx.closePath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x - 3.5, bottom - 6);
    ctx.lineTo(x + 3.5, bottom - 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  if (!text) return;
  const ym = (top + bottom) / 2;
  const tx = side === "right" ? x + 7 : x - 7;
  ctx.save();
  ctx.font = PLOT_FONT;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = colors.bg;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(side === "right" ? tx - 3 : tx - tw - 3, ym - 9, tw + 6, 18);
  ctx.globalAlpha = 1;
  ctx.fillStyle = textColor;
  ctx.textAlign = side === "right" ? "left" : "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text, tx, ym);
  ctx.restore();
}

/**
 * 坂の高さの寸法(縦)。寸法が十分に長ければラベルを線の右の中ほどに、短ければ
 * (順バイアスで坂が低いとき)帯の縁の線を隠さないよう寸法の下端の下に置く。
 */
export function drawBarrierDimension(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  yBottom: number,
  text: string,
  colors: BandColors,
): void {
  const tall = Math.abs(yBottom - yTop) >= 28;
  drawDimension(ctx, x, yTop, yBottom, tall ? text : "", colors, "right");
  if (tall) return;
  ctx.save();
  ctx.font = PLOT_FONT;
  const tw = ctx.measureText(text).width;
  const y = Math.max(yTop, yBottom) + 14;
  ctx.fillStyle = colors.bg;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x - 7, y - 9, tw + 6, 18);
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x - 4, y);
  ctx.restore();
}

/** 水平の寸法線(両端の矢羽根)。ラベルは線の上(above = false で下) */
export function drawHorizontalDimension(
  ctx: CanvasRenderingContext2D,
  xA: number,
  xB: number,
  y: number,
  text: string,
  colors: BandColors,
  above = true,
): void {
  const left = Math.min(xA, xB);
  const right = Math.max(xA, xB);
  ctx.save();
  ctx.strokeStyle = colors.text2;
  ctx.fillStyle = colors.text2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  if (right - left > 12) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + 6, y - 3.5);
    ctx.lineTo(left + 6, y + 3.5);
    ctx.closePath();
    ctx.moveTo(right, y);
    ctx.lineTo(right - 6, y - 3.5);
    ctx.lineTo(right - 6, y + 3.5);
    ctx.closePath();
    ctx.fill();
  }
  if (text) {
    ctx.font = PLOT_FONT_SMALL;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = above ? "bottom" : "top";
    ctx.fillText(text, (left + right) / 2, above ? y - 3 : y + 3);
  }
  ctx.restore();
}

/* ------------------------------------------------------ 固定イオンの輪 */

/**
 * 固定イオン(イオン化したドーパント)の輪 + 符号をまとめ描きする
 * (`--mat-solute`。塗りは背景色 — 自由キャリアの塗り丸と区別する)。
 * xs / ys は px の配列。sign はアクセプタ「−」かドナー「+」。
 */
export function drawIonRings(
  ctx: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  r: number,
  sign: "+" | "−",
  colors: { solute: string; bg: string },
  alpha = 1,
): void {
  if (count <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.solute;
  ctx.lineWidth = r < 4 ? 1.2 : 1.5;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    ctx.moveTo(xs[i] + r, ys[i]);
    ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  // 符号(1 パスでまとめて描く)
  const a = r * 0.5;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    ctx.moveTo(xs[i] - a, ys[i]);
    ctx.lineTo(xs[i] + a, ys[i]);
    if (sign === "+") {
      ctx.moveTo(xs[i], ys[i] - a);
      ctx.lineTo(xs[i], ys[i] + a);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** 塗り丸(自由キャリア)を px 座標でまとめ描きする */
export function drawDotsPx(
  ctx: CanvasRenderingContext2D,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  r: number,
  color: string,
): void {
  if (count <= 0) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    ctx.moveTo(xs[i] + r, ys[i]);
    ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

/* ---------------------------------------------------------------- 光 */

/**
 * 光子の短い波線の矢印(`--mat-beam`)。(x0, y0) から (x1, y1) へ。
 * フェルミ準位の図6 の光の矢印と同じ描き方を任意の向きにしたもの。
 */
export function drawPhoton(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  alpha = 1,
  waves = 3,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 10) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = 8;
  const body = len - head;
  const amp = 3;
  const steps = 24;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = amp * Math.sin(t * waves * 2 * Math.PI);
    const px = x0 + ux * body * t - uy * s;
    const py = y0 + uy * body * t + ux * s;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  const bx = x0 + ux * body;
  const by = y0 + uy * body;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx - uy * 4.5, by + ux * 4.5);
  ctx.lineTo(bx + uy * 4.5, by - ux * 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
