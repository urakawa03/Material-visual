/**
 * critical-semicircle.ts — 図4「引き返せない半円」(記事仕様書 02 §5.4)
 *
 * 左パネル: 図3 と同じ上面視の弧。頂点にドラッグハンドル。
 * 右パネル: 横軸 h/L、縦軸 τ_req = T/(bR(h)) のカーブ。h = L/2 のピークに
 * τ_c 注記。ピークより右は「引き返せない」領域として薄く塗る。
 *
 * モード「形を操作」: h を直接動かして τ_req の山を体感する。
 * モード「応力を操作」: τ < τ_c では安定解へ 150ms で整定、τ ≥ τ_c で
 * 短いランナウェイ演出 → メッセージ → 自動で τ = 0.9τ_c へ戻す。
 *
 * requestRender 型。整定・ランナウェイの短い遷移のみ自前 rAF(anim.ts)。
 * 簡略化は図3 と同じ(線張力一定)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import {
  TAU_C_SIM,
  sagFromRadius,
  sampleArcPoints,
  tauRequiredForSag,
} from "./lib/line";
import { L_DEFAULT_UM, tauRatioToMPa } from "./lib/constants";
import { clamp } from "../../core/mathx";
import {
  FIG_FONT,
  FIG_FONT_SMALL,
  drawGrid,
  drawPin,
  drawViewBadge,
  resolvePalette,
  setControlEnabled,
} from "./lib/draw";
import { tween, type Tween } from "./lib/anim";

/** h/L の範囲(§5.4) */
const H_MIN = 0.05;
const H_MAX = 1.2;
/** 整定イージング(ms) */
const SETTLE_MS = 150;
/** ランナウェイ演出の時間(ms) */
const RUNAWAY_MS = 1500;
/** メッセージの表示時間(ms) */
const MESSAGE_MS = 3200;
/** ランナウェイ後に戻す応力(× τ_c) */
const TAU_AFTER_RUNAWAY = 0.9;
/** 弧のサンプル数 */
const ARC_SAMPLES = 72;
/** ハンドルの当たり判定半径(px) */
const HANDLE_HIT = 24;

type Mode = "shape" | "stress";

export default function criticalSemicircle(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const tauCMPaValue = tauRatioToMPa(1, L_DEFAULT_UM);

  let mode: Mode = "shape";
  /** 描画中のたわみ(h/L) */
  let hDisplay = 0.2;
  let activeTween: Tween | null = null;
  let message: string | null = null;
  let messageTimer: ReturnType<typeof setTimeout> | null = null;

  const arcPts = new Float64Array(ARC_SAMPLES * 2);

  // ドラッグ状態
  let dragging = false;
  let dragPointerId = -1;
  let hovering = false;

  // 左パネルの変換(draw で更新し、ドラッグ処理から参照する)
  let leftCx = 0;
  let leftAxisY = 0;
  let leftLpx = 1;

  function tauReqRatio(h: number): number {
    return tauRequiredForSag(h, 1, 1, 1) / TAU_C_SIM;
  }

  function showMessage(text: string): void {
    message = text;
    if (messageTimer !== null) clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message = null;
      messageTimer = null;
      host.requestRender();
    }, MESSAGE_MS);
    host.requestRender();
  }

  /* ---- モード別の状態遷移 ---- */

  function settleToStress(ratio: number): void {
    activeTween?.cancel();
    if (ratio < 1) {
      // 安定解(小さい方の根): R = T/(τb) の劣弧
      const target = ratio <= 0 ? 0 : sagFromRadius(1 / (ratio * TAU_C_SIM), 1);
      activeTween = tween(hDisplay, target, SETTLE_MS, (v) => {
        hDisplay = v;
        host.requestRender();
      });
    } else {
      // ランナウェイ演出: 加速しながら h が増え続ける(§5.4)
      const h0 = hDisplay;
      activeTween = tween(
        0,
        1,
        RUNAWAY_MS,
        (p) => {
          hDisplay = h0 + (H_MAX + 0.06 - h0) * p * p;
          host.requestRender();
        },
        () => {
          showMessage("半円を越えました — 続きは次の図で見届けましょう");
          tauSlider.set(TAU_AFTER_RUNAWAY);
        },
      );
    }
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const narrow = w < 560;
    // 左パネル(弧)と右パネル(カーブ)の領域
    const leftW = narrow ? w * 0.44 : w * 0.46;
    const plotX0 = leftW + (narrow ? 34 : 48);
    const plotX1 = w - 16;
    const plotY0 = 26;
    const plotY1 = h - 34;

    /* ---- 左パネル: 弧 ---- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, leftW, h);
    ctx.clip();
    drawGrid(ctx, leftW, h, 34, pal.hairline);
    ctx.restore();

    leftAxisY = h * 0.8;
    leftLpx = Math.min(leftW * 0.62, (leftAxisY - 26) / (H_MAX + 0.1));
    leftCx = leftW / 2;
    const sx = (x: number): number => leftCx + x * leftLpx;
    const sy = (y: number): number => leftAxisY - y * leftLpx;

    // 元の直線位置(破線)
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(-0.5), leftAxisY);
    ctx.lineTo(sx(0.5), leftAxisY);
    ctx.stroke();
    // 半円の高さの目安線
    ctx.beginPath();
    ctx.moveTo(sx(-0.62), sy(0.5));
    ctx.lineTo(sx(0.62), sy(0.5));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("h = L/2(半円)", sx(-0.62), sy(0.5) - 3);

    // 弧
    sampleArcPoints(hDisplay, 1, ARC_SAMPLES, arcPts);
    ctx.strokeStyle = pal.defect;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(sx(arcPts[0]), sy(arcPts[1]));
    for (let i = 1; i < ARC_SAMPLES; i++) {
      ctx.lineTo(sx(arcPts[2 * i]), sy(arcPts[2 * i + 1]));
    }
    ctx.stroke();

    drawPin(ctx, sx(-0.5), leftAxisY, pal);
    drawPin(ctx, sx(0.5), leftAxisY, pal);

    // ドラッグハンドル(形モードのみ)
    if (mode === "shape") {
      const hx = sx(0);
      const hy = sy(hDisplay);
      ctx.beginPath();
      ctx.arc(hx, hy, hovering || dragging ? 11 : 9, 0, Math.PI * 2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.accent;
      ctx.stroke();
      // 上下の矢じるし(ドラッグ可能の示唆)
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      for (const dir of [-1, 1] as const) {
        const ay = hy + dir * 16;
        ctx.beginPath();
        ctx.moveTo(hx - 4, ay - dir * 4);
        ctx.lineTo(hx, ay);
        ctx.lineTo(hx + 4, ay - dir * 4);
        ctx.stroke();
      }
      ctx.lineCap = "butt";
    }

    // たわみ h の読み出し
    ctx.font = FIG_FONT;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`h / L = ${hDisplay.toFixed(2)}`, 14, 12);
    if (mode === "stress") {
      ctx.fillText(`τ = ${Math.round(tauSlider.value * 100)}% τc`, 14, 31);
    }

    /* ---- 右パネル: τ_req(h) カーブ ---- */
    const yMaxRatio = 1.18;
    const px = (hh: number): number =>
      plotX0 + ((hh - H_MIN) / (H_MAX - H_MIN)) * (plotX1 - plotX0);
    const py = (ratio: number): number =>
      plotY1 - (ratio / yMaxRatio) * (plotY1 - plotY0);

    // 引き返せない領域(h > L/2)の塗り
    ctx.fillStyle = pal.tensionFill;
    ctx.fillRect(px(0.5), plotY0 - 4, plotX1 - px(0.5), plotY1 - plotY0 + 4);

    // 軸
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX0, plotY0 - 6);
    ctx.lineTo(plotX0, plotY1);
    ctx.lineTo(plotX1, plotY1);
    ctx.stroke();

    // 軸ラベルと目盛
    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const hh of [0.2, 0.5, 0.8, 1.1]) {
      ctx.beginPath();
      ctx.moveTo(px(hh), plotY1);
      ctx.lineTo(px(hh), plotY1 + 4);
      ctx.stroke();
      ctx.fillText(String(hh), px(hh), plotY1 + 7);
    }
    ctx.font = FIG_FONT;
    ctx.fillText("たわみ h / L", (plotX0 + plotX1) / 2, plotY1 + 19);
    ctx.save();
    ctx.translate(plotX0 - (narrow ? 22 : 30), (plotY0 + plotY1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "bottom";
    ctx.fillText("必要な応力 τ_req", 0, 0);
    ctx.restore();

    // τ_c の水平目盛線
    ctx.strokeStyle = pal.hairline;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(plotX0, py(1));
    ctx.lineTo(plotX1, py(1));
    ctx.stroke();
    ctx.setLineDash([]);

    // 応力モード: 加えている τ の水平線
    if (mode === "stress") {
      const applied = tauSlider.value;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotX0, py(applied));
      ctx.lineTo(plotX1, py(applied));
      ctx.stroke();
      ctx.fillStyle = pal.accent;
      ctx.font = FIG_FONT_SMALL;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("加えている τ", plotX1 - 4, py(applied) - 3);
    }

    // カーブ本体
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const N = 110;
    for (let i = 0; i <= N; i++) {
      const hh = H_MIN + ((H_MAX - H_MIN) * i) / N;
      const yy = py(tauReqRatio(hh));
      if (i === 0) ctx.moveTo(px(hh), yy);
      else ctx.lineTo(px(hh), yy);
    }
    ctx.stroke();

    // ピーク注記 τ_c
    ctx.fillStyle = pal.text;
    ctx.font = FIG_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("τ_c", px(0.5), py(1) - 8);

    // 引き返せない領域のラベル
    ctx.fillStyle = pal.defect;
    ctx.font = FIG_FONT_SMALL;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("引き返せない", px(0.56), plotY0 + 4);
    ctx.fillStyle = pal.text2;
    ctx.fillText("(同じ応力で加速し続ける)", px(0.56), plotY0 + 19);

    // 現在の形状に対応するマーカー
    const hMark = clamp(hDisplay, H_MIN, H_MAX);
    ctx.beginPath();
    ctx.arc(px(hMark), py(tauReqRatio(hMark)), 5.5, 0, Math.PI * 2);
    ctx.fillStyle = pal.defect;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.defectDark;
    ctx.stroke();

    drawViewBadge(ctx, leftW + 10, "top", pal);

    // メッセージ
    if (message) {
      ctx.font = FIG_FONT;
      const tw = ctx.measureText(message).width;
      const pad = 10;
      const bx = (w - tw) / 2 - pad;
      const by = h - 30 - 8;
      ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
      ctx.strokeStyle = pal.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + pad * 2, 26, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pal.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(message, w / 2, by + 13.5);
    }
  }

  /* ---- ドラッグハンドル(タッチ・マウス両対応) ---- */

  function handlePos(): { x: number; y: number } {
    return { x: leftCx, y: leftAxisY - hDisplay * leftLpx };
  }

  function onPointerDown(e: PointerEvent): void {
    if (mode !== "shape") return;
    const hp = handlePos();
    if (Math.hypot(e.offsetX - hp.x, e.offsetY - hp.y) > HANDLE_HIT) return;
    dragging = true;
    dragPointerId = e.pointerId;
    host.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    host.requestRender();
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragging && e.pointerId === dragPointerId) {
      const hNew = clamp((leftAxisY - e.offsetY) / leftLpx, H_MIN, H_MAX);
      hSlider.set(Number(hNew.toFixed(3)));
      return;
    }
    if (mode === "shape") {
      const hp = handlePos();
      const near = Math.hypot(e.offsetX - hp.x, e.offsetY - hp.y) <= HANDLE_HIT;
      if (near !== hovering) {
        hovering = near;
        host.canvas.style.cursor = near ? "ns-resize" : "";
        host.requestRender();
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;
    host.requestRender();
  }

  host.canvas.addEventListener("pointerdown", onPointerDown);
  host.canvas.addEventListener("pointermove", onPointerMove);
  host.canvas.addEventListener("pointerup", onPointerUp);
  host.canvas.addEventListener("pointercancel", onPointerUp);

  /* ---- 操作部品(§5.4) ---- */

  const modeSeg = host.controls.segmented<Mode>({
    id: "mode",
    label: "モード",
    options: [
      { value: "shape", label: "形を操作(h)" },
      { value: "stress", label: "応力を操作(τ)" },
    ],
    value: "shape",
  });

  const hSlider = host.controls.slider({
    id: "sag",
    label: "たわみ h",
    min: H_MIN,
    max: H_MAX,
    step: 0.01,
    value: 0.2,
    format: (v) => `${v.toFixed(2)} L`,
  });
  hSlider.onChange((v) => {
    if (mode !== "shape") return;
    activeTween?.cancel();
    hDisplay = v;
    host.requestRender();
  });

  const tauSlider = host.controls.slider({
    id: "tau",
    label: "せん断応力 τ",
    min: 0,
    max: 1.1,
    step: 0.01,
    value: 0.4,
    format: (v) =>
      `${Math.round(v * 100)}% τc(${(v * tauCMPaValue).toFixed(1)} MPa)`,
  });
  tauSlider.onChange((v) => {
    if (mode !== "stress") return;
    settleToStress(v);
    host.requestRender();
  });

  function applyMode(m: Mode): void {
    mode = m;
    setControlEnabled(hSlider.el, m === "shape");
    setControlEnabled(tauSlider.el, m === "stress");
    activeTween?.cancel();
    if (m === "shape") {
      const hNow = clamp(hDisplay, H_MIN, H_MAX);
      hDisplay = hNow;
      hSlider.set(Number(hNow.toFixed(2)));
    } else {
      settleToStress(tauSlider.value);
    }
    host.requestRender();
  }
  modeSeg.onChange(applyMode);
  setControlEnabled(tauSlider.el, false);

  host.onRender(draw);

  return {
    destroy(): void {
      activeTween?.cancel();
      if (messageTimer !== null) clearTimeout(messageTimer);
      host.canvas.removeEventListener("pointerdown", onPointerDown);
      host.canvas.removeEventListener("pointermove", onPointerMove);
      host.canvas.removeEventListener("pointerup", onPointerUp);
      host.canvas.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
