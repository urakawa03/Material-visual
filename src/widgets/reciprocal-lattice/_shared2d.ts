/**
 * _shared2d.ts — 記事「逆格子空間」2D 図版の共通ヘルパ(仕様書 05 §5.0)
 *
 * - 2 パネル構成(左 = 実空間、右 = 逆空間。狭幅では上下積み)
 * - スケールバー(nm / nm⁻¹)・矢印・原子・縞の描画
 * - 読み取り値の行・ステッパ(± ボタン)
 * - canvas 内ドラッグ要素の共通規約(44px 標的・Tab 巡回・矢印キー —
 *   dragPoints ヘルパ。将来 src/core/controls.ts への昇格候補: 付録 A-4)
 *
 * three.js には依存しない(2D 図版のチャンクに three を混入させない — §5.0)。
 */

import type { FigureHost, FigureSize } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";

const TAU = Math.PI * 2;

/* ------------------------------------------------------------ パネル分割 */

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** パネル中心(CSS px) */
  cx: number;
  cy: number;
}

export interface PanelSplit {
  /** 実空間パネル(横並びなら左、縦積みなら上) */
  first: PanelRect;
  /** 逆空間パネル(横並びなら右、縦積みなら下) */
  second: PanelRect;
  /** 縦積みかどうか */
  stacked: boolean;
}

/** 横並びと判定するアスペクト比の下限(広幅 2/1、縦積み 10/13 — §5.0) */
const SIDE_BY_SIDE_MIN_ASPECT = 1.25;
/** パネル間の隙間(CSS px) */
const PANEL_GAP = 16;

/**
 * キャンバスを 2 パネルに分割する。widget は毎描画でこれを呼び、
 * 返った矩形に対して描く(リサイズで自動的に追従する)。
 */
export function splitPanels(size: FigureSize): PanelSplit {
  const { w, h } = size;
  if (w >= h * SIDE_BY_SIDE_MIN_ASPECT) {
    const pw = (w - PANEL_GAP) / 2;
    return {
      first: rect(0, 0, pw, h),
      second: rect(pw + PANEL_GAP, 0, pw, h),
      stacked: false,
    };
  }
  const ph = (h - PANEL_GAP) / 2;
  return {
    first: rect(0, 0, w, ph),
    second: rect(0, ph + PANEL_GAP, w, ph),
    stacked: true,
  };
}

function rect(x: number, y: number, w: number, h: number): PanelRect {
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** パネル境界の区切り線(hairline)を描く */
export function drawPanelDivider(
  ctx: CanvasRenderingContext2D,
  size: FigureSize,
  split: PanelSplit,
): void {
  ctx.strokeStyle = uiColor("hairline");
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (split.stacked) {
    const y = (split.first.y + split.first.h + split.second.y) / 2;
    ctx.moveTo(0, y);
    ctx.lineTo(size.w, y);
  } else {
    const x = (split.first.x + split.first.w + split.second.x) / 2;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.h);
  }
  ctx.stroke();
}

/* -------------------------------------------------------------- 座標変換 */

export interface PanelMapper {
  panel: PanelRect;
  /** 1 単位(nm または nm⁻¹)あたりの CSS px */
  pxPerUnit: number;
  /** 世界座標(y 上向き)→ CSS px */
  toPxX(u: number): number;
  toPxY(u: number): number;
  /** CSS px → 世界座標 */
  toUnitX(px: number): number;
  toUnitY(px: number): number;
}

/** パネル中心を原点、y 上向きの世界座標と CSS px の相互変換を作る */
export function makeMapper(panel: PanelRect, pxPerUnit: number): PanelMapper {
  return {
    panel,
    pxPerUnit,
    toPxX: (u) => panel.cx + u * pxPerUnit,
    toPxY: (u) => panel.cy - u * pxPerUnit,
    toUnitX: (px) => (px - panel.cx) / pxPerUnit,
    toUnitY: (px) => (panel.cy - px) / pxPerUnit,
  };
}

/* ------------------------------------------------------------ 基本描画部品 */

/** 図中テキストの標準フォント(ラベル 12〜14px — §6.5) */
export const CANVAS_FONT = "12px " + FONT_STACK();
export const CANVAS_FONT_SMALL = "11px " + FONT_STACK();

function FONT_STACK(): string {
  return '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif';
}

/**
 * スケールバー。パネル左下に value 単位ぶんの長さの線分と端の刻み、
 * ラベル(例 "1 nm", "5 nm⁻¹")を描く(§5.0: 両パネルに必ず置く)。
 */
export function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  panel: PanelRect,
  pxPerUnit: number,
  value: number,
  label: string,
): void {
  const len = value * pxPerUnit;
  const x0 = panel.x + 14;
  const y = panel.y + panel.h - 14;
  const tick = 4;
  ctx.strokeStyle = uiColor("text2");
  ctx.fillStyle = uiColor("text2");
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x0 + len, y);
  ctx.moveTo(x0, y - tick);
  ctx.lineTo(x0, y + tick);
  ctx.moveTo(x0 + len, y - tick);
  ctx.lineTo(x0 + len, y + tick);
  ctx.stroke();
  ctx.font = CANVAS_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, x0, y - 5);
}

/** パネル左上の小ラベル(例 「実空間」「逆空間」) */
export function drawPanelLabel(
  ctx: CanvasRenderingContext2D,
  panel: PanelRect,
  text: string,
): void {
  ctx.font = CANVAS_FONT;
  ctx.fillStyle = uiColor("text2");
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, panel.x + 12, panel.y + 10);
}

export interface ArrowOptions {
  color: string;
  /** 線幅(既定 2 — §6.5) */
  width?: number;
  /** 先端の塗り三角の長さ(既定 8px) */
  head?: number;
}

/** 矢印(線幅 2px + 先端の塗り三角 — §6.5) */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  opts: ArrowOptions,
): void {
  const width = opts.width ?? 2;
  const head = opts.head ?? 8;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;
  // 三角の分だけ線を短くする
  const bx = x1 - ux * head;
  const by = y1 - uy * head;
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(bx, by);
  ctx.stroke();
  const hw = head * 0.45;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx - uy * hw, by + ux * hw);
  ctx.lineTo(bx + uy * hw, by - ux * hw);
  ctx.closePath();
  ctx.fill();
}

/**
 * 原子群のまとめ描き(塗り + 同系色 20% 暗の縁取り 1.5px — §6.5)。
 * xy は世界座標の平坦配列 [x0, y0, x1, y1, …]。
 */
export function drawAtoms(
  ctx: CanvasRenderingContext2D,
  xy: Float64Array,
  count: number,
  mapper: PanelMapper,
  radiusPx: number,
  fill: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = mapper.toPxX(xy[i * 2]);
    const y = mapper.toPxY(xy[i * 2 + 1]);
    ctx.moveTo(x + radiusPx, y);
    ctx.arc(x, y, radiusPx, 0, TAU);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = darken(fill, 0.2);
  ctx.stroke();
}

/** パネル矩形でクリップして描画する(cb 内で自由に描く) */
export function withClip(
  ctx: CanvasRenderingContext2D,
  panel: PanelRect,
  cb: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(panel.x, panel.y, panel.w, panel.h);
  ctx.clip();
  cb();
  ctx.restore();
}

/* ------------------------------------------------------------------ 縞 */

export interface StripeOptions {
  /** 山の帯の不透明度(既定 0.12 — §5.2) */
  bandAlpha?: number;
  /** 山の中心線を描くか(既定 true) */
  crestLines?: boolean;
  /** 一致時の中心線強調(§5.3) */
  emphasize?: boolean;
}

/** 縞が細かすぎて描けない下限(px)。これ未満は一様塗りで代替する */
const MIN_STRIPE_PX = 2.5;

/**
 * 平面波 cos(2π q·r) の縞を描く。山(cos > 0)を --mat-beam の帯で塗り、
 * 山の中心線(q·r = n)を細線で重ねる(§5.2・§5.3)。q は世界座標
 * (nm⁻¹、y 上向き)。原点(パネル中心)は常に山の中心線上にある。
 */
export function drawStripes(
  ctx: CanvasRenderingContext2D,
  mapper: PanelMapper,
  qx: number,
  qy: number,
  opts: StripeOptions = {},
): void {
  const bandAlpha = opts.bandAlpha ?? 0.12;
  const beam = matColor("beam");
  const { panel } = mapper;
  const L = Math.hypot(qx, qy);
  withClip(ctx, panel, () => {
    if (L < 1e-6) {
      // q = 0: 一様な縞(変化なし)。全体を薄く塗る
      ctx.globalAlpha = bandAlpha;
      ctx.fillStyle = beam;
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
      ctx.globalAlpha = 1;
      return;
    }
    const lambdaPx = mapper.pxPerUnit / L; // 縞間隔(px)
    if (lambdaPx < MIN_STRIPE_PX) {
      ctx.globalAlpha = bandAlpha * 0.6;
      ctx.fillStyle = beam;
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
      ctx.globalAlpha = 1;
      return;
    }
    // スクリーン座標(y 下向き)での q の向き
    const angle = Math.atan2(-qy, qx);
    const halfDiag = Math.hypot(panel.w, panel.h) / 2 + lambdaPx;
    ctx.save();
    ctx.translate(panel.cx, panel.cy);
    ctx.rotate(angle);
    const n0 = Math.floor(-halfDiag / lambdaPx);
    const n1 = Math.ceil(halfDiag / lambdaPx);
    // 山の帯(幅 λ/2、山の中心線を中心に)
    ctx.globalAlpha = bandAlpha;
    ctx.fillStyle = beam;
    for (let n = n0; n <= n1; n++) {
      ctx.fillRect(
        n * lambdaPx - lambdaPx / 4,
        -halfDiag,
        lambdaPx / 2,
        halfDiag * 2,
      );
    }
    // 山の中心線
    if (opts.crestLines !== false) {
      ctx.globalAlpha = opts.emphasize ? 0.95 : 0.5;
      ctx.strokeStyle = beam;
      ctx.lineWidth = opts.emphasize ? 1.8 : 1;
      ctx.beginPath();
      for (let n = n0; n <= n1; n++) {
        ctx.moveTo(n * lambdaPx, -halfDiag);
        ctx.lineTo(n * lambdaPx, halfDiag);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  });
}

/* ------------------------------------------------------------- 読み取り値 */

export interface ReadoutItem {
  el: HTMLElement;
  set(text: string): void;
}

export interface Readout {
  el: HTMLElement;
  /**
   * 読み取り値の項目を追加する。color を指定するとラベルが意味色
   * (文字用 ink トークン)になる(§2.3 の q / g の色分け)。
   * "sphere" はエヴァルト球の量用(仕様書 04 §6.3)。
   */
  item(
    label: string,
    opts?: { color?: "beam" | "recip" | "sphere" },
  ): ReadoutItem;
}

/**
 * 図版下の読み取り値の行を作る(tabular-nums — §6.3)。
 * 操作部品(.ix-controls)の先頭に置かれる。
 */
export function createReadout(host: FigureHost): Readout {
  const row = document.createElement("div");
  row.className = "ix-readout";
  const container =
    host.stage.closest(".ix")?.querySelector(".ix-controls") ??
    host.stage.parentElement;
  container?.prepend(row);
  return {
    el: row,
    item(label, opts) {
      const item = document.createElement("span");
      item.className = "ix-readout-item";
      const lab = document.createElement("span");
      if (opts?.color) lab.className = `ix-readout-${opts.color}`;
      lab.textContent = label;
      const out = document.createElement("output");
      item.append(lab, out);
      row.appendChild(item);
      return {
        el: item,
        set(text: string): void {
          if (out.textContent !== text) out.textContent = text;
        },
      };
    },
  };
}

/* --------------------------------------------------------------- ステッパ */

export interface StepperOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  /** 1 押下あたりの変化量(既定 1) */
  step?: number;
  format?: (v: number) => string;
}

export interface StepperControl {
  el: HTMLElement;
  readonly value: number;
  set(v: number): void;
  /**
   * 上限を変える(選べる項目数が状態で変わる図版用 — 仕様書 04 §5.6 の
   * 「測る環」は格子と波長で本数が変わる)。現在値は新しい上限に丸められる。
   */
  setMax(max: number): void;
  onChange(cb: (v: number) => void): void;
}

/**
 * ± ボタンのステッパ(図4・6・7 の h/k/l 選択 — §5.4)。
 * ネイティブ button なのでキーボードだけで全操作できる(§7.2)。
 */
export function createStepper(
  host: FigureHost,
  opts: StepperOptions,
): StepperControl {
  const step = opts.step ?? 1;
  const format = opts.format ?? ((v: number) => String(v));
  const el = document.createElement("div");
  el.className = "ctl ctl-stepper";
  const lab = document.createElement("span");
  lab.className = "ctl-label";
  lab.textContent = opts.label;
  const group = document.createElement("div");
  group.className = "ctl-stepper-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", opts.label);
  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "ctl-stepper-btn";
  minus.textContent = "−";
  minus.setAttribute("aria-label", `${opts.label} を減らす`);
  const out = document.createElement("output");
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "ctl-stepper-btn";
  plus.textContent = "+";
  plus.setAttribute("aria-label", `${opts.label} を増やす`);
  group.append(minus, out, plus);
  el.append(lab, group);
  const container =
    host.stage.closest(".ix")?.querySelector(".ix-controls") ??
    host.stage.parentElement;
  container?.appendChild(el);

  let current = opts.value;
  let max = opts.max;
  const listeners: Array<(v: number) => void> = [];
  const display = (): void => {
    out.textContent = format(current);
    minus.disabled = current <= opts.min;
    plus.disabled = current >= max;
  };
  const apply = (v: number, notify: boolean): void => {
    const nv = Math.min(max, Math.max(opts.min, v));
    if (nv === current) {
      display();
      return;
    }
    current = nv;
    display();
    if (notify) {
      for (const cb of listeners) cb(current);
      host.requestRender();
    }
  };
  minus.addEventListener("click", () => apply(current - step, true));
  plus.addEventListener("click", () => apply(current + step, true));
  display();

  return {
    el,
    get value(): number {
      return current;
    },
    set(v: number): void {
      apply(v, true);
    },
    setMax(newMax: number): void {
      max = Math.max(opts.min, newMax);
      // 現在値が新しい上限を超えていれば丸めて通知する
      if (current > max) apply(max, true);
      else display();
    },
    onChange(cb: (v: number) => void): void {
      listeners.push(cb);
    },
  };
}

/* ------------------------------------------- canvas 内ドラッグ要素(§5.0) */

export interface DragPoint {
  /** スクリーンリーダー向けの名前(例 「プローブ q」) */
  label: string;
  /** 現在位置(canvas CSS px) */
  x(): number;
  y(): number;
  /**
   * ポインタドラッグ。canvas CSS px 座標で通知される。
   * 値域へのクランプ・世界座標への変換は実装側で行う。
   */
  drag(xPx: number, yPx: number): void;
  /**
   * 矢印キー操作。dx/dy ∈ {-1, 0, 1}(dy = +1 は画面の上方向 = 世界座標の
   * +y)。coarse = Shift 併用(粗動)。ステップ量は実装側で決める。
   */
  key(dx: number, dy: number, coarse: boolean): void;
}

export interface DragPointsHandle {
  /** 状態・レイアウト変更後に代理ボタンの位置を追従させる */
  sync(): void;
  /** フォーカス中の点の添字(なければ -1)。フォーカスリング描画用 */
  focusedIndex(): number;
  dispose(): void;
}

/**
 * canvas 内ドラッグ要素の共通規約(§5.0)。各点に透明な 44px の代理
 * ボタンを重ね、Tab 巡回・矢印キー微動(Shift で粗動)・ポインタドラッグ
 * を提供する。見た目とフォーカスリングは canvas 側で描く
 * (drawFocusRing)。他記事でも使うため将来 core への昇格候補(付録 A-4)。
 */
export function attachDragPoints(
  host: FigureHost,
  points: readonly DragPoint[],
): DragPointsHandle {
  const els: HTMLButtonElement[] = [];
  const disposers: Array<() => void> = [];

  points.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ix-handle";
    btn.setAttribute("aria-label", p.label);
    host.stage.appendChild(btn);
    els.push(btn);

    let dragId = -1;
    let rect: DOMRect | null = null;
    const down = (e: PointerEvent): void => {
      dragId = e.pointerId;
      rect = host.canvas.getBoundingClientRect();
      btn.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== dragId || !rect) return;
      p.drag(e.clientX - rect.left, e.clientY - rect.top);
      position(btn, p);
      host.requestRender();
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId === dragId) {
        dragId = -1;
        rect = null;
      }
    };
    const keydown = (e: KeyboardEvent): void => {
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -1;
      else if (e.key === "ArrowRight") dx = 1;
      else if (e.key === "ArrowUp") dy = 1;
      else if (e.key === "ArrowDown") dy = -1;
      else return;
      e.preventDefault();
      p.key(dx, dy, e.shiftKey);
      position(btn, p);
      host.requestRender();
    };
    const refocus = (): void => host.requestRender();

    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointermove", move);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("keydown", keydown);
    btn.addEventListener("focus", refocus);
    btn.addEventListener("blur", refocus);
    disposers.push(() => {
      btn.removeEventListener("pointerdown", down);
      btn.removeEventListener("pointermove", move);
      btn.removeEventListener("pointerup", up);
      btn.removeEventListener("pointercancel", up);
      btn.removeEventListener("keydown", keydown);
      btn.removeEventListener("focus", refocus);
      btn.removeEventListener("blur", refocus);
      btn.remove();
    });
    position(btn, p);
  });

  return {
    sync(): void {
      points.forEach((p, i) => position(els[i], p));
    },
    focusedIndex(): number {
      return els.findIndex((el) => el === document.activeElement);
    },
    dispose(): void {
      for (const d of disposers) d();
      disposers.length = 0;
    },
  };
}

function position(el: HTMLElement, p: DragPoint): void {
  el.style.left = `${p.x()}px`;
  el.style.top = `${p.y()}px`;
}

/**
 * キーボードフォーカス中のドラッグ点に描くフォーカスリング
 * (--color-accent 2px 相当 — §5.0)。
 */
export function drawFocusRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r = 15,
): void {
  ctx.strokeStyle = uiColor("bg");
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = uiColor("accent");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
}
