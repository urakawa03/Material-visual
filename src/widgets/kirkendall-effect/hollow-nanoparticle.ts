/**
 * hollow-nanoparticle.ts — 図7「欠点を利用する」(記事仕様書 06 §5.7・発展)
 *
 * 左: ナノ粒子の断面。内側から 空洞(白 + --mat-defect の輪郭)/ 未反応の
 * 金属コア(--mat-matrix)/ 生成物の殻(--mat-precip)/ 外側の反応種
 * (--mat-second の点)。3 本の流れ(金属が外へ・反応種が内へ・空孔が内へ)を
 * 図4 と同じ視覚言語(空孔は破線の矢印)で放射方向に描く。
 * 右: 半径の内訳(空洞・コア・殻)の時間変化を積み上げで表示。
 *
 * モデル(球対称・拡散律速 — §5.7): 反応の速さは 2 本の流れの**和**で決まり、
 * 空洞の大きさは**差**で決まる。D_金属 < D_反応種 なら空洞はできない。
 *
 * 実装方式: 2D / onFrame + fixedStep。
 * 簡略化(図注): 球対称・空洞は中心の 1 個・化学量論は体積比 1:1 の仮定・
 * 数値はモデル値・時間は強く加速している。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { mulberry32 } from "../../core/mathx";
import { formatDuration } from "./lib/constants";
import { HollowParticleModel } from "./lib/diffusion";
import {
  type Pane,
  arrow,
  dashedArrow,
  drawAtoms,
  font,
  linTicks,
  outlinedText,
  paneFrame,
  resolvePalette,
} from "./lib/draw";

/** 乱数シード(reset で完全に同じ配置へ — §8.2) */
const SEED = 20040813;
/** 粒径スライダー [nm](直径) */
const DIAM_MIN = 10;
const DIAM_MAX = 40;
const DIAM_STEP = 2;
const DIAM_INIT = 30;
/** D_金属 / D_反応種 の比(対数スライダー) */
const RATIO_MIN = 0.2;
const RATIO_MAX = 10;
const RATIO_INIT = 4;
/** モデル時間の進み [モデル秒/画面秒] と実時間換算 [実秒/モデル秒] */
const MODEL_PER_SCREEN_S = 20;
const REAL_PER_MODEL_S = 20;
/** 固定タイムステップ [ms] */
const STEP_MS = 16;
/** 履歴(積み上げプロット)のサンプル間隔 [モデル秒]と長さ */
const HISTORY_SAMPLE = 1;
const HISTORY_LEN = 400;
/** 外側の反応種の点の数 */
const REACTANT_DOTS = 90;

export default function hollowNanoparticle(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  let diamNm = DIAM_INIT;
  let ratio = RATIO_INIT;
  let model = new HollowParticleModel(DIAM_INIT / 2, RATIO_INIT);

  /** 外側の反応種の点(シード固定の極座標) */
  const dotAng = new Float64Array(REACTANT_DOTS);
  const dotRad = new Float64Array(REACTANT_DOTS);
  const bufDX = new Float64Array(REACTANT_DOTS);
  const bufDY = new Float64Array(REACTANT_DOTS);

  /** 履歴: 空洞・コア外・外径 [nm] */
  const histVoid = new Float64Array(HISTORY_LEN);
  const histCore = new Float64Array(HISTORY_LEN);
  const histOuter = new Float64Array(HISTORY_LEN);
  let histCount = 0;
  let sampleClock = 0;
  /** 履歴のサンプル間隔 [モデル秒]。満杯になったら間引いて 2 倍にする */
  let sampleInterval = HISTORY_SAMPLE;

  function initDots(): void {
    const rand = mulberry32(SEED);
    for (let i = 0; i < REACTANT_DOTS; i++) {
      dotAng[i] = rand() * Math.PI * 2;
      // 粒子の外側の帯(外径の 1.05〜1.6 倍)に置く
      dotRad[i] = 1.05 + rand() * 0.55;
    }
  }

  function resetSim(): void {
    model = new HollowParticleModel(diamNm / 2, ratio);
    histCount = 0;
    sampleClock = 0;
    sampleInterval = HISTORY_SAMPLE;
  }

  /** 履歴が満杯になったら 1 つ飛ばしに間引き、サンプル間隔を 2 倍にする */
  function decimateHistory(): void {
    const half = Math.floor(HISTORY_LEN / 2);
    for (let k = 0; k < half; k++) {
      histVoid[k] = histVoid[k * 2];
      histCore[k] = histCore[k * 2];
      histOuter[k] = histOuter[k * 2];
    }
    histCount = half;
    sampleInterval *= 2;
  }

  /* ---- 操作部品(§7.2) ---- */

  const ratioSlider = host.controls.slider({
    id: "ratio",
    label: "D_金属 / D_反応種",
    min: RATIO_MIN,
    max: RATIO_MAX,
    value: RATIO_INIT,
    scale: "log",
  });
  ratioSlider.onChange((v) => {
    ratio = v;
    // 反応途中でも比は変えられる(以後の空洞の育ち方が変わる)
    model.setRatio(v);
  });

  const diamSlider = host.controls.slider({
    id: "diam",
    label: "粒径",
    min: DIAM_MIN,
    max: DIAM_MAX,
    step: DIAM_STEP,
    value: DIAM_INIT,
    unit: "nm",
  });
  diamSlider.onChange((v) => {
    diamNm = v;
    resetSim(); // 粒径の変更は自動リセット(§5.7)
  });

  host.controls.playPause();
  host.controls.reset(() => {
    ratioSlider.set(RATIO_INIT);
    diamSlider.set(DIAM_INIT);
    resetSim();
  });

  /* ---- レイアウト ---- */

  function layout(): { stage: Pane; plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 620;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const plotH = Math.max(90, h * 0.3);
      return {
        stage: { x: pad, y: pad, w: w - 2 * pad, h: h - plotH - 3 * pad },
        plot: { x: pad, y: h - plotH - pad, w: w - 2 * pad, h: plotH },
        narrow,
      };
    }
    const plotW = Math.max(200, Math.min(300, w * 0.38));
    return {
      stage: { x: pad, y: pad, w: w - plotW - 3 * pad, h: h - 2 * pad },
      plot: { x: w - plotW - pad, y: pad, w: plotW, h: h - 2 * pad },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function drawStage(p: Pane): void {
    paneFrame(ctx, p, pal.hairline);
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    // 粒径の上限(40 nm)が常に同じ縮尺で収まるようにする
    const maxOuterNm = (DIAM_MAX / 2) * 1.5;
    const scale = (Math.min(p.w, p.h) / 2 - 26) / maxOuterNm;
    const rOuter = model.outerRadius() * scale;
    const rCore = model.coreRadius() * scale;
    const rVoid = model.voidRadius() * scale;

    // 外側の反応種(点)
    for (let i = 0; i < REACTANT_DOTS; i++) {
      const rad = model.outerRadius() * dotRad[i] * scale;
      bufDX[i] = cx + Math.cos(dotAng[i]) * rad;
      bufDY[i] = cy + Math.sin(dotAng[i]) * rad;
    }
    drawAtoms(
      ctx,
      bufDX,
      bufDY,
      REACTANT_DOTS,
      2.2,
      pal.second,
      pal.secondEdge,
    );

    // 殻(生成物)
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = pal.precip;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.precipEdge;
    ctx.stroke();

    // 未反応の金属コア
    if (rCore > 0.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, rCore, 0, Math.PI * 2);
      ctx.fillStyle = pal.matrix;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = pal.matrixEdge;
      ctx.stroke();
    }

    // 中心の空洞(白 + --mat-defect の輪郭)
    if (rVoid > 0.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, rVoid, 0, Math.PI * 2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.defect;
      ctx.stroke();
    }

    // 3 本の流れ(反応が続いている間だけ)
    if (!model.done()) {
      const dir = -Math.PI / 4; // 右上方向に 3 本並べて描く
      const ux = Math.cos(dir);
      const uy = Math.sin(dir);
      const at = (r: number): [number, number] => [cx + ux * r, cy + uy * r];
      // 金属: コア → 外へ
      const [mx0, my0] = at(Math.max(rCore, rVoid) + 2);
      const [mx1, my1] = at(rOuter + 16);
      arrow(ctx, mx0, my0, mx1, my1, pal.matrix);
      // 反応種: 外 → 内へ(別の方向に描く)
      const dir2 = Math.PI * 0.75;
      const vx = Math.cos(dir2);
      const vy = Math.sin(dir2);
      arrow(
        ctx,
        cx + vx * (rOuter + 16),
        cy + vy * (rOuter + 16),
        cx + vx * (Math.max(rCore, rVoid) + 2),
        cy + vy * (Math.max(rCore, rVoid) + 2),
        pal.second,
      );
      // 空孔: 外 → 中心へ(破線)
      const dir3 = Math.PI * 0.25;
      const wx = Math.cos(dir3);
      const wy = Math.sin(dir3);
      dashedArrow(
        ctx,
        cx + wx * (rOuter - 2),
        cy + wy * (rOuter - 2),
        cx + wx * Math.max(rVoid + 3, 6),
        cy + wy * Math.max(rVoid + 3, 6),
        pal.text2,
      );
      ctx.font = font(10.5);
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      outlinedText(ctx, "金属が外へ", mx1 + 3, my1, pal.matrix, pal.bg);
      ctx.textAlign = "right";
      outlinedText(
        ctx,
        "反応種が内へ",
        cx + vx * (rOuter + 18),
        cy + vy * (rOuter + 18),
        pal.second,
        pal.bg,
      );
      ctx.textAlign = "left";
      outlinedText(
        ctx,
        "空孔が中心へ",
        cx + wx * (rOuter + 6),
        cy + wy * (rOuter + 18),
        pal.text2,
        pal.bg,
      );
    }

    // 凡例
    ctx.font = font(10.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    outlinedText(
      ctx,
      "紫 = 生成物の殻 / 灰 = 未反応の金属",
      p.x + 6,
      p.y + 5,
      pal.text2,
      pal.bg,
    );
    ctx.textBaseline = "bottom";
    outlinedText(
      ctx,
      model.voidRadius() > 0.5
        ? "中心の白い穴 = 空洞(集まった空孔)"
        : "空洞なし(比を 1 より大きくすると空洞ができる)",
      p.x + 6,
      p.y + p.h - 5,
      model.voidRadius() > 0.5 ? pal.defect : pal.text2,
      pal.bg,
    );
  }

  function drawPlot(p: Pane): void {
    const axisX = p.x + 30;
    const axisR = p.x + p.w - 8;
    const yTop = p.y + 62;
    const yBot = p.y + p.h - 24;
    const rMax = (DIAM_MAX / 2) * 1.45;
    const my = (r: number): number => yBot - (r / rMax) * (yBot - yTop);
    const mx = (k: number): number =>
      axisX + (k / Math.max(histCount - 1, 1)) * (axisR - axisX);

    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, yTop);
    ctx.lineTo(axisX + 0.5, yBot);
    ctx.lineTo(axisR, yBot);
    ctx.stroke();
    ctx.font = font(10.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, rMax, 3)) {
      ctx.fillText(`${Math.round(v)}`, axisX - 4, my(v));
    }

    // 積み上げ(空洞 → コア → 殻)。履歴が 2 点以上たまってから描く
    if (histCount > 1) {
      const band = (
        lower: Float64Array | null,
        upper: Float64Array,
        color: string,
      ): void => {
        ctx.beginPath();
        for (let k = 0; k < histCount; k++) ctx.lineTo(mx(k), my(upper[k]));
        if (lower) {
          for (let k = histCount - 1; k >= 0; k--)
            ctx.lineTo(mx(k), my(lower[k]));
        } else {
          ctx.lineTo(mx(histCount - 1), my(0));
          ctx.lineTo(mx(0), my(0));
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      band(histCore, histOuter, pal.precip);
      band(histVoid, histCore, pal.matrix);
      // 空洞は塗らず輪郭のみ(「そこに原子が無い」の視覚表現に合わせる)
      ctx.beginPath();
      for (let k = 0; k < histCount; k++) ctx.lineTo(mx(k), my(histVoid[k]));
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.defect;
      ctx.stroke();
    }

    // 読み出し
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = pal.text;
    ctx.fillText("半径の内訳 [nm]", p.x + 2, p.y + 4);
    ctx.fillText(
      `空洞の直径 ${(model.voidRadius() * 2).toFixed(1)} nm`,
      p.x + 2,
      p.y + 19,
    );
    ctx.fillText(
      `殻の厚さ ${model.shellThickness().toFixed(1)} nm`,
      p.x + 2,
      p.y + 33,
    );
    ctx.fillStyle = pal.text2;
    ctx.fillText(
      `反応率 ${(model.conversion() * 100).toFixed(0)}% / 経過 ${formatDuration(model.time * REAL_PER_MODEL_S)}`,
      p.x + 2,
      p.y + 47,
    );
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("時間 →", axisR, yBot + 4);
    ctx.textAlign = "left";
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawStage(l.stage);
    drawPlot(l.plot);
  }

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    stepper(dt, (h) => {
      const step = h * MODEL_PER_SCREEN_S;
      model.step(step);
      sampleClock += step;
      if (sampleClock >= sampleInterval) {
        sampleClock = 0;
        if (histCount >= HISTORY_LEN) decimateHistory();
        histVoid[histCount] = model.voidRadius();
        histCore[histCount] = model.coreRadius();
        histOuter[histCount] = model.outerRadius();
        histCount++;
      }
    });
    draw();
  });
  host.onRender(draw);

  initDots();
  resetSim();

  return {
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
