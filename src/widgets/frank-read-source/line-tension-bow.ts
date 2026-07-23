/**
 * line-tension-bow.ts — 図3「張られた弦」(記事仕様書 02 §5.3)
 *
 * 上面視。固定点 2 つの間の転位線が、せん断応力 τ のもとで半径
 * R = T/(τb) の円弧に張り出す(準静的・解析解)。τ 変更時は現在形状から
 * 目標形状へ 150ms のイージング。requestRender 型でアイドル時消費ゼロ。
 *
 * 簡略化(図注にも明示): 線張力一定の近似。刃状/らせんでエネルギーが
 * 異なる効果は無視する。
 */

import type { FigureHost, WidgetHandle } from "../types";
import {
  TAU_C_SIM,
  arcRadiusFromSag,
  sagFromRadius,
  sampleArcPoints,
} from "./lib/line";
import { L_DEFAULT_UM, tauRatioToMPa } from "./lib/constants";
import {
  FIG_FONT,
  drawArrow,
  drawGrid,
  drawPin,
  drawReadout,
  drawViewBadge,
  resolvePalette,
} from "./lib/draw";
import { tween, type Tween } from "./lib/anim";

/** τ スライダーの上限(× τ_c)。半円の一歩手前で止める(§5.3) */
const TAU_MAX_RATIO = 0.95;
/** τ 変更時のイージング時間(ms) */
const EASE_MS = 150;
/** 弧のサンプル数 */
const ARC_SAMPLES = 64;
/** 分布力矢印の本数 */
const FORCE_ARROWS = 9;

export default function lineTensionBow(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const tauCMPaValue = tauRatioToMPa(1, L_DEFAULT_UM);

  /** 現在の目標 τ/τ_c と描画中のたわみ(イージングでこの値が動く) */
  let tauRatio = 0;
  let hCurrent = 0;
  let showForces = false;
  let showCircle = false;
  let activeTween: Tween | null = null;

  const arcPts = new Float64Array(ARC_SAMPLES * 2);
  const screenPts = new Float64Array(ARC_SAMPLES * 2);

  function targetSag(ratio: number): number {
    if (ratio <= 0) return 0;
    const tauSim = ratio * TAU_C_SIM;
    return sagFromRadius(1 / tauSim, 1);
  }

  function setTau(ratio: number): void {
    tauRatio = ratio;
    activeTween?.cancel();
    activeTween = tween(hCurrent, targetSag(ratio), EASE_MS, (v) => {
      hCurrent = v;
      draw();
    });
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // すべり面のグリッド(上面視 — §5.0)
    drawGrid(ctx, w, h, 36, pal.hairline);

    // 世界座標(L = 1)→ 画面座標
    const Lpx = Math.min(w * 0.52, h * 1.05);
    const cx = w / 2;
    const axisY = h * 0.66;
    const sx = (x: number): number => cx + x * Lpx;
    const sy = (y: number): number => axisY - y * Lpx;

    sampleArcPoints(hCurrent, 1, ARC_SAMPLES, arcPts);
    for (let i = 0; i < ARC_SAMPLES; i++) {
      screenPts[2 * i] = sx(arcPts[2 * i]);
      screenPts[2 * i + 1] = sy(arcPts[2 * i + 1]);
    }

    // 元の位置(固定点間の直線)を薄い破線で
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(-0.5), axisY);
    ctx.lineTo(sx(0.5), axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 半径 R の円(トグル)
    const tauSim = tauRatio * TAU_C_SIM;
    if (showCircle && hCurrent > 1e-4) {
      const R = arcRadiusFromSag(hCurrent, 1);
      ctx.strokeStyle = pal.accent;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(sx(0), sy(hCurrent - R), R * Lpx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 中心と半径線
      ctx.beginPath();
      ctx.arc(sx(0), sy(hCurrent - R), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx(0), sy(hCurrent - R));
      ctx.lineTo(sx(0), sy(hCurrent));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = FIG_FONT;
      ctx.fillStyle = pal.accent;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "R",
        sx(0) + 6,
        sy(hCurrent - R + (R - hCurrent) / 2 + hCurrent / 2),
      );
    }

    // 分布力 τb と固定点の張力 T(トグル)
    if (showForces) {
      if (tauRatio > 0.01) {
        const arrowLen = 12 + 30 * tauRatio;
        for (let k = 0; k < FORCE_ARROWS; k++) {
          const idx = Math.round(
            ((k + 0.5) / FORCE_ARROWS) * (ARC_SAMPLES - 1),
          );
          const i0 = Math.max(idx - 1, 0);
          const i1 = Math.min(idx + 1, ARC_SAMPLES - 1);
          const tx = screenPts[2 * i1] - screenPts[2 * i0];
          const ty = screenPts[2 * i1 + 1] - screenPts[2 * i0 + 1];
          const len = Math.hypot(tx, ty) || 1;
          // 画面座標での左法線(世界座標 +y 側 = 画面上方向)
          const nx = ty / len;
          const ny = -tx / len;
          const px = screenPts[2 * idx];
          const py = screenPts[2 * idx + 1];
          drawArrow(
            ctx,
            px,
            py,
            px + nx * arrowLen,
            py + ny * arrowLen,
            pal.solute,
            2,
            6,
          );
        }
        ctx.font = FIG_FONT;
        ctx.fillStyle = pal.solute;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          "力 τb(単位長さあたり)",
          sx(0),
          sy(hCurrent) - (12 + 30 * tauRatio) - 6,
        );
      }
      // 固定点に働く張力 T(接線方向・弧から離れる向き)
      const tLen = 30;
      for (const side of [-1, 1] as const) {
        const iPin = side < 0 ? 0 : ARC_SAMPLES - 1;
        const iIn = side < 0 ? 2 : ARC_SAMPLES - 3;
        let tx = screenPts[2 * iPin] - screenPts[2 * iIn];
        let ty = screenPts[2 * iPin + 1] - screenPts[2 * iIn + 1];
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        const px = screenPts[2 * iPin];
        const py = screenPts[2 * iPin + 1];
        drawArrow(
          ctx,
          px,
          py,
          px + tx * tLen,
          py + ty * tLen,
          pal.defect,
          2,
          6,
        );
        ctx.font = FIG_FONT;
        ctx.fillStyle = pal.defect;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("T", px + tx * (tLen + 9), py + ty * (tLen + 4));
      }
    }

    // 転位線(--mat-defect)
    ctx.strokeStyle = pal.defect;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(screenPts[0], screenPts[1]);
    for (let i = 1; i < ARC_SAMPLES; i++) {
      ctx.lineTo(screenPts[2 * i], screenPts[2 * i + 1]);
    }
    ctx.stroke();

    // 固定点(--mat-precip)
    drawPin(ctx, sx(-0.5), axisY, pal);
    drawPin(ctx, sx(0.5), axisY, pal);
    ctx.font = FIG_FONT;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("L", sx(0), axisY + 8);

    // 読み出し(R/L と τ/τ_c)
    const rOverL = tauSim > 1e-6 ? (1 / tauSim).toFixed(2) : "∞";
    drawReadout(
      ctx,
      [`R / L = ${rOverL}`, `τ / τ_c = ${Math.round(tauRatio * 100)} %`],
      14,
      12,
      pal,
    );

    drawViewBadge(ctx, w, "top", pal);
  }

  /* ---- 操作部品(§5.3) ---- */

  const tauSlider = host.controls.slider({
    id: "tau",
    label: "せん断応力 τ",
    min: 0,
    max: TAU_MAX_RATIO,
    step: 0.01,
    value: 0,
    format: (v) =>
      `${Math.round(v * 100)}% τc(${(v * tauCMPaValue).toFixed(1)} MPa)`,
  });
  tauSlider.onChange(setTau);

  const forceToggle = host.controls.toggle({
    id: "forces",
    label: "力を表示",
    value: false,
  });
  forceToggle.onChange((v) => {
    showForces = v;
    host.requestRender();
  });

  const circleToggle = host.controls.toggle({
    id: "circle",
    label: "半径の円を表示",
    value: false,
  });
  circleToggle.onChange((v) => {
    showCircle = v;
    host.requestRender();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      activeTween?.cancel();
    },
  };
}
