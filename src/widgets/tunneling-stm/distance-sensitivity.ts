/**
 * distance-sensitivity.ts — 図4「0.1 nm で 1 桁 — 異常な敏感さ」(仕様書 14 §5.4)
 *
 * 左(狭幅では上): 探針の先端と試料の断面の模式。探針は原子を三角形に積んだ
 *   先端で、先端の 1 原子と 1 段奥の原子(0.25 nm 遠い)を描き分ける。
 *   先端の原子から試料への電流を --mat-beam の太い矢印で、1 段奥の原子からの
 *   寄与を太さを電流に比例させた細い矢印で描く(0.5 px でクランプ — 図注で断る)。
 * 右(狭幅では下): 電流(対数)とすき間の直線 I = I_ref e^{−2κ(z − z_ref)}(式 E4)。
 *
 * 探針の形や原子ごとの電子状態の違いは無視した模型(図注に明示)。
 * 実装方式: requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout, drawArrow } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawCurve,
  drawPlotFrame,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { font, fmtSig } from "../../core/plot";
import { WORK_FUNCTION_EV, Z_REF_NM } from "./lib/constants";
import {
  drawDivider,
  fmtFromLog10,
  fmtTimes,
  haloText,
  log10Ticks,
  rect,
  resolvePalette,
  splitTwo,
  tooSmall,
  type Rect,
} from "./lib/draw";
import { apexFraction, currentRatio } from "./lib/stm";
import { kappa } from "./lib/tunneling";

/** スライダー(§5.4 の表) */
const GAP_MIN = 0.3;
const GAP_MAX = 1.5;
const GAP_STEP = 0.01;
const GAP_INIT = Z_REF_NM;
const PHI_MIN = 3;
const PHI_MAX = 6;
const PHI_STEP = 0.1;
const PHI_INIT = WORK_FUNCTION_EV;

/** 探針の原子の間隔 [nm] と、1 段奥の原子までの高さの差(= 間隔 × √3/2 ≈ 0.25 nm) */
const TIP_SPACING = 0.29;
const LAYER_DZ = 0.25;
/** 探針の原子の段数(1 + 2 + 3 + 4 個) */
const TIP_ROWS = 4;
/** 試料の原子の間隔 [nm] */
const SAMPLE_SPACING = 0.3;
/** 原子の見た目の半径 [nm] */
const ATOM_R = 0.12;
/** 先端の原子からの矢印の太さ(px)と、細い矢印の最小の太さ(px) */
const APEX_ARROW_W = 6;
const MIN_ARROW_W = 0.5;
/** 模式図の縦の範囲 [nm](すき間が最大でも収まる) */
const VIEW_Z_MIN = -0.42;
const VIEW_Z_MAX = GAP_MAX + LAYER_DZ * (TIP_ROWS - 1) + 0.45;
/** 右のグラフの範囲: すき間 [nm] と log₁₀(I/nA) */
const LOG_MIN = -10;
const LOG_MAX = 4;
/** 曲線のサンプル点数 */
const SAMPLES = 121;

const X_TICKS: readonly AxisTick[] = [0.3, 0.6, 0.9, 1.2, 1.5].map((v) => ({
  value: v,
  label: v.toFixed(1),
}));
const Y_TICKS: readonly AxisTick[] = log10Ticks(LOG_MIN, LOG_MAX, 2);

/** 1 段奥の原子の割合を計算するときの探針の段(仕様書 §5.4: 1 段奥の原子 1 個) */
const PAIR = [{ dz: LAYER_DZ, count: 1 }] as const;

export default function distanceSensitivity(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const colors = bandColors();
  const map = createPlotMapper();
  const left: Rect = rect();
  const right: Rect = rect();

  /* ---- 状態 ---- */
  let gap = GAP_INIT;
  let phi = PHI_INIT;

  const zs = new Float64Array(SAMPLES);
  const logI = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    zs[i] = GAP_MIN + ((GAP_MAX - GAP_MIN) * i) / (SAMPLES - 1);
  }

  /** log₁₀(I/nA) = −2κ(z − z_ref)/ln10 */
  function log10Current(z: number): number {
    return (-2 * kappa(phi) * (z - Z_REF_NM)) / Math.LN10;
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    const stacked = splitTwo(w, h, 0.55, 0.47, 14, left, right);
    drawSchematic(left, stacked);
    drawDivider(ctx, left, right, stacked, pal.hairline);
    drawPlot(right);
  }

  /* ---------------------------------------------------- 左: 断面の模式 */

  function drawSchematic(r: Rect, stacked: boolean): void {
    const scale = Math.min(
      (r.h - 16) / (VIEW_Z_MAX - VIEW_Z_MIN),
      (r.w - 20) / 2.9,
    );
    const cx = r.x + r.w * (stacked ? 0.52 : 0.56);
    const zy = (z: number): number => r.y + r.h - 8 - (z - VIEW_Z_MIN) * scale;
    const xx = (x: number): number => cx + x * scale;
    const rPx = ATOM_R * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();

    // 試料の原子(2 列。上の列の中心が z = 0)
    ctx.lineWidth = 1.5;
    for (let row = 0; row < 2; row++) {
      const z = -row * SAMPLE_SPACING * 0.85;
      const shift = row === 0 ? 0 : SAMPLE_SPACING / 2;
      ctx.beginPath();
      for (let i = -6; i <= 6; i++) {
        const X = xx(i * SAMPLE_SPACING + shift);
        if (X < r.x - rPx || X > r.x + r.w + rPx) continue;
        ctx.moveTo(X + rPx, zy(z));
        ctx.arc(X, zy(z), rPx, 0, Math.PI * 2);
      }
      ctx.fillStyle = pal.matrix;
      ctx.fill();
      ctx.strokeStyle = pal.matrixEdge;
      ctx.stroke();
    }

    // 探針(先端の原子 1 個、その奥に 2・3・4 個)
    const ratio = 1 / currentRatio(phi, LAYER_DZ);
    for (let row = TIP_ROWS - 1; row >= 0; row--) {
      const z = gap + row * LAYER_DZ;
      ctx.beginPath();
      for (let k = 0; k <= row; k++) {
        const x = (k - row / 2) * TIP_SPACING;
        ctx.moveTo(xx(x) + rPx, zy(z));
        ctx.arc(xx(x), zy(z), rPx, 0, Math.PI * 2);
      }
      ctx.fillStyle = pal.matrix;
      ctx.fill();
      ctx.strokeStyle = pal.matrixEdge;
      ctx.stroke();
    }
    // 先端の原子を縁取りで強調
    ctx.beginPath();
    ctx.arc(xx(0), zy(gap), rPx + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 電流の矢印(太さ ∝ 電流)。1 段奥の原子からは 1/229 の太さ → 0.5 px でクランプ
    const yApexBottom = zy(gap) + rPx + 3;
    const ySample = zy(0) - rPx - 3;
    if (ySample - yApexBottom > 12) {
      drawArrow(ctx, xx(0), yApexBottom, xx(0), ySample, {
        color: pal.beam,
        width: APEX_ARROW_W,
        head: 12,
      });
    }
    const thin = Math.max(MIN_ARROW_W, APEX_ARROW_W * ratio);
    for (const side of [-1, 1]) {
      const x0 = side * TIP_SPACING * 0.5;
      const y0 = zy(gap + LAYER_DZ) + rPx + 2;
      const x1 = side * (TIP_SPACING * 0.5 + 0.12);
      if (ySample - y0 > 12) {
        drawArrow(ctx, xx(x0), y0, xx(x1), ySample, {
          color: pal.beam,
          width: thin,
          head: 5,
        });
      }
    }

    // すき間の目盛り(0.1 nm ごと)
    const rulerX = xx(-0.72);
    const yTop = zy(gap);
    const yBot = zy(0);
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rulerX, yTop);
    ctx.lineTo(rulerX, yBot);
    for (let t = 0; t <= gap + 1e-9; t += 0.1) {
      const y = zy(t);
      const long = Math.round(t * 10) % 5 === 0;
      ctx.moveTo(rulerX - (long ? 6 : 3), y);
      ctx.lineTo(rulerX + (long ? 6 : 3), y);
    }
    ctx.stroke();
    // 目盛りから原子の中心への細い補助線
    ctx.strokeStyle = pal.ghost;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(rulerX + 6, yTop);
    ctx.lineTo(xx(0) - rPx - 3, yTop);
    ctx.moveTo(rulerX + 6, yBot);
    ctx.lineTo(xx(-SAMPLE_SPACING) + rPx, yBot);
    ctx.stroke();
    ctx.setLineDash([]);

    // ラベル(すき間が狭いときも、2 行目が試料の原子にかからない高さに)
    const gapLabelY = Math.min((yTop + yBot) / 2, yBot - rPx - 23);
    ctx.font = font(12);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    haloText(
      ctx,
      `すき間 ${gap.toFixed(2)} nm`,
      rulerX - 8,
      gapLabelY,
      pal.text,
      pal.bg,
    );
    ctx.font = font(11);
    haloText(
      ctx,
      "(原子の中心どうし)",
      rulerX - 8,
      gapLabelY + 15,
      pal.text2,
      pal.bg,
    );
    // 先端の原子の割合: ふつうは太い矢印の右。すき間が狭くて矢印の横に
    // 入らないときは、先端の原子の右(試料の原子にかからない高さ)
    ctx.font = font(12);
    ctx.textAlign = "left";
    const frac = apexFraction(phi, PAIR);
    const roomy = ySample - yApexBottom >= 30;
    haloText(
      ctx,
      `先端の原子: ${fmtSig(frac * 100, 3)}%`,
      roomy ? xx(0) + 12 : xx(0) + rPx + 8,
      roomy ? (yApexBottom + ySample) / 2 : zy(gap),
      pal.beamInk,
      pal.bg,
    );
    // 1 段奥の原子の説明(その段の右の原子のすぐ右に 2 行で)
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const lx = xx(TIP_SPACING * 0.5) + rPx + 6;
    const ly = zy(gap + LAYER_DZ);
    haloText(ctx, "← 1 段奥の原子", lx, ly - 7, pal.text2, pal.bg);
    haloText(ctx, "(0.25 nm 遠い)", lx + 12, ly + 8, pal.text2, pal.bg);
    ctx.font = font(12);
    ctx.textBaseline = "top";
    haloText(ctx, "探針", r.x + 8, r.y + 8, pal.text2, pal.bg);
    ctx.textBaseline = "bottom";
    haloText(ctx, "試料", r.x + 8, r.y + r.h - 6, pal.text2, pal.bg);
    ctx.restore();
  }

  /* ---------------------------------------------------- 右: 対数グラフ */

  function drawPlot(r: Rect): void {
    const marginL = 58;
    const marginB = 46;
    setPlotRange(
      map,
      r.x + marginL,
      r.y + 14,
      r.w - marginL - 12,
      r.h - 14 - marginB,
      GAP_MIN,
      GAP_MAX,
      LOG_MIN,
      LOG_MAX,
    );
    drawPlotFrame(ctx, map, {
      colors,
      xTicks: X_TICKS,
      yTicks: Y_TICKS,
      xLabel: "すき間 z [nm]",
      yLabel: "電流 I [nA](対数)",
    });
    for (let i = 0; i < SAMPLES; i++) logI[i] = log10Current(zs[i]);
    withPlotClip(ctx, map, () => {
      drawCurve(ctx, map, zs, logI, SAMPLES, { color: pal.beam, width: 2.4 });
    });

    // 現在の点と「0.1 nm 近づけると」の段
    const y0 = log10Current(gap);
    const z1 = gap - 0.1;
    const px0 = map.toPxX(gap);
    const py0 = map.toPxY(y0);
    if (z1 >= GAP_MIN) {
      const px1 = map.toPxX(z1);
      const py1 = map.toPxY(log10Current(z1));
      ctx.strokeStyle = pal.text2;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px1, py0);
      ctx.lineTo(px1, py1);
      ctx.stroke();
      ctx.font = font(12);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      haloText(
        ctx,
        `0.1 nm で ${fmtTimes(currentRatio(phi, 0.1))}`,
        px1 - 6,
        (py0 + py1) / 2,
        pal.text,
        pal.bg,
      );
    }
    ctx.beginPath();
    ctx.arc(px0, py0, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = pal.beam;
    ctx.fill();
    ctx.strokeStyle = pal.beamInk;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /* ---- 読み取り値 ---- */
  const readout = createReadout(host);
  const iItem = readout.item("電流 I", { color: "beam" });
  const stepItem = readout.item("0.1 nm 近づけると");
  const atomItem = readout.item("原子 1 個分(0.15 nm)で");
  const fracItem = readout.item("先端の原子 1 個が運ぶ割合", { color: "beam" });
  // 電流の値の長さが変わっても折り返しが変わらないよう、いつも自分の行に置く
  fracItem.el.style.flexBasis = "100%";

  function updateReadouts(): void {
    const lg = log10Current(gap);
    iItem.set(
      Math.abs(lg) < 3 ? `${fmtSig(10 ** lg, 3)} nA` : `${fmtFromLog10(lg)} nA`,
    );
    stepItem.set(fmtTimes(currentRatio(phi, 0.1)));
    atomItem.set(fmtTimes(currentRatio(phi, 0.15)));
    fracItem.set(`${fmtSig(apexFraction(phi, PAIR) * 100, 3)}%`);
  }

  /* ---- 操作部品 ---- */
  const gapSlider = host.controls.slider({
    id: "gap",
    label: "探針と試料のすき間",
    min: GAP_MIN,
    max: GAP_MAX,
    step: GAP_STEP,
    value: GAP_INIT,
    unit: "nm",
  });
  gapSlider.onChange((v) => {
    gap = v;
    updateReadouts();
  });
  const phiSlider = host.controls.slider({
    id: "phi",
    label: "仕事関数 φ",
    min: PHI_MIN,
    max: PHI_MAX,
    step: PHI_STEP,
    value: PHI_INIT,
    unit: "eV",
  });
  phiSlider.onChange((v) => {
    phi = v;
    updateReadouts();
  });
  host.controls.reset(() => {
    gapSlider.set(GAP_INIT);
    phiSlider.set(PHI_INIT);
    gap = GAP_INIT;
    phi = PHI_INIT;
    updateReadouts();
  });

  updateReadouts();
  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
