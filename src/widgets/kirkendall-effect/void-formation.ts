/**
 * void-formation.ts — 図6「余った空孔のゆくえ」(記事仕様書 06 §5.6)
 *
 * 左: 真鍮側(速い方)の格子(`_shared/lattice2d.ts` の完全格子)。過飽和に
 * なった空孔が**破線の輪郭**で増えていき、しきい値を超えると**ボイド**
 * (白い塗り + --mat-defect の輪郭)が現れて育つ。吸収源(転位・粒界)の記号は
 * 効きの強さで濃さが変わる。
 * 右: 過飽和度 S = C_V/C_V^eq の時間変化(accent)+ しきい値 S* の破線。
 *
 * モデル(0 次元の速度式 — §5.6):
 *   dS/dt = g − k_sink(S − 1) − c_consume·N·max(S − 1, 0)
 *   dA_i/dt = c_grow·max(S − 1, 0)   (S > S* の間だけ核生成)
 *
 * 実装方式: 2D / onFrame + fixedStep。
 * 簡略化(図注): 0 次元の現象論モデル・ボイドの位置は模式・数値はモデル値・
 * 時間は加速。実際には界面の金属間化合物や不純物が生成を強く左右する。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { clamp, mulberry32 } from "../../core/mathx";
import { VOID_MAX, VoidGrowthModel } from "./lib/diffusion";
import { SITE_B, buildSiteGrid } from "./lib/lattice";
import {
  type LatticeView,
  type Pane,
  dashedLine,
  drawAtoms,
  drawVacancies,
  font,
  linTicks,
  makeLatticeView,
  outlinedText,
  paneFrame,
  resolvePalette,
  viewX,
  viewY,
} from "./lib/draw";

/** 格子の列数と上下半分あたりの行数(合計 17 × 12 サイト) */
const COLS = 17;
const ROWS_PER_HALF = 6;
/** 乱数シード(reset で完全に同じ配置へ — §8.2) */
const SEED = 20471129;
/** B 原子(Zn)の割合(真鍮側なので 30%) */
const B_FRACTION = 0.3;
/** 過飽和 1 あたりに描く空孔の個数(表示の演出) */
const VAC_PER_EXCESS = 5;
/** 描く空孔の個数の上限 */
const VAC_DRAW_MAX = 40;
/** ボイドの面積(モデル単位)→ 半径(格子単位)の換算係数 */
const VOID_AREA_TO_R2 = 1.2;

/** 操作パラメータの範囲(§5.6) */
const SUPPLY_MIN = 0;
const SUPPLY_MAX = 3;
const SUPPLY_STEP = 0.1;
const SUPPLY_INIT = 1.2;
const SINK_MIN = 0;
const SINK_MAX = 1;
const SINK_STEP = 0.05;
const SINK_INIT = 0.3;
const THRESHOLD_MIN = 1.5;
const THRESHOLD_MAX = 8;
const THRESHOLD_STEP = 0.1;
const THRESHOLD_INIT = 3;

/** 固定タイムステップ [ms] と履歴の窓 [s] */
const STEP_MS = 16;
const HISTORY_WINDOW_S = 30;
const HISTORY_SAMPLE_S = 0.1;
const HISTORY_LEN = Math.ceil(HISTORY_WINDOW_S / HISTORY_SAMPLE_S) + 2;
/** プロットの縦軸上限 */
const S_AXIS_MAX = 9;

export default function voidFormation(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  const grid = buildSiteGrid(COLS, ROWS_PER_HALF);
  const model = new VoidGrowthModel(SUPPLY_INIT, SINK_INIT, THRESHOLD_INIT);

  /** 原子の種類(シード固定)と、空孔・ボイドの位置(シード固定) */
  const species = new Uint8Array(grid.count);
  const vacancyOrder = new Int32Array(grid.count);
  const voidLX = new Float64Array(VOID_MAX);
  const voidLY = new Float64Array(VOID_MAX);

  /** 空孔として描くサイト(毎フレーム作り直す。原子はここに描かない) */
  const vacantFlag = new Uint8Array(grid.count);
  /** 描画バッファ */
  const bufAX = new Float64Array(grid.count);
  const bufAY = new Float64Array(grid.count);
  const bufBX = new Float64Array(grid.count);
  const bufBY = new Float64Array(grid.count);
  const bufVX = new Float64Array(VAC_DRAW_MAX);
  const bufVY = new Float64Array(VAC_DRAW_MAX);

  /** 過飽和度の履歴(リングバッファ) */
  const histS = new Float64Array(HISTORY_LEN);
  const histT = new Float64Array(HISTORY_LEN);
  let histCount = 0;
  let histHead = 0;
  let sampleClock = 0;

  function initLayout(): void {
    const rand = mulberry32(SEED);
    for (let i = 0; i < grid.count; i++) {
      species[i] = rand() < B_FRACTION ? SITE_B : 0;
      vacancyOrder[i] = i;
    }
    // シード固定のシャッフル(空孔を描く順序)
    for (let i = grid.count - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = vacancyOrder[i];
      vacancyOrder[i] = vacancyOrder[j];
      vacancyOrder[j] = t;
    }
    // ボイドの中心(格子座標。端から 1.5 格子は避ける)
    for (let i = 0; i < VOID_MAX; i++) {
      voidLX[i] = (rand() * 2 - 1) * (COLS / 2 - 1.8);
      voidLY[i] = (rand() * 2 - 1) * (ROWS_PER_HALF - 1.2);
    }
  }

  function resetSim(): void {
    model.reset();
    histCount = 0;
    histHead = 0;
    sampleClock = 0;
  }

  /** ボイド i の半径(格子単位) */
  function voidRadius(i: number): number {
    return Math.sqrt(model.areas[i] * VOID_AREA_TO_R2);
  }

  /** 点 (lx, ly) がどれかのボイドの中にあるか(原子を隠すため) */
  function insideVoid(lx: number, ly: number): boolean {
    for (let i = 0; i < model.count; i++) {
      const r = voidRadius(i);
      const dx = lx - voidLX[i];
      const dy = ly - voidLY[i];
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  /** ボイドの面積率 [%](格子の見えている面積に対する割合) */
  function areaFractionPct(): number {
    let a = 0;
    for (let i = 0; i < model.count; i++) {
      const r = voidRadius(i);
      a += Math.PI * r * r;
    }
    return Math.min(100, (100 * a) / (COLS * (ROWS_PER_HALF * 2)));
  }

  /* ---- 操作部品(§7.2) ---- */

  const supplySlider = host.controls.slider({
    id: "supply",
    label: "空孔の供給(流入の強さ)",
    min: SUPPLY_MIN,
    max: SUPPLY_MAX,
    step: SUPPLY_STEP,
    value: SUPPLY_INIT,
    format: (v) => v.toFixed(1),
  });
  supplySlider.onChange((v) => {
    model.supply = v;
  });

  const sinkSlider = host.controls.slider({
    id: "sink",
    label: "吸収源の効き(転位・粒界)",
    min: SINK_MIN,
    max: SINK_MAX,
    step: SINK_STEP,
    value: SINK_INIT,
    format: (v) => v.toFixed(2),
  });
  sinkSlider.onChange((v) => {
    model.sink = v;
  });

  const thresholdSlider = host.controls.slider({
    id: "threshold",
    label: "凝集のしきい値 S*",
    min: THRESHOLD_MIN,
    max: THRESHOLD_MAX,
    step: THRESHOLD_STEP,
    value: THRESHOLD_INIT,
    format: (v) => v.toFixed(1),
  });
  thresholdSlider.onChange((v) => {
    model.threshold = v;
  });

  host.controls.playPause();
  host.controls.reset(() => {
    supplySlider.set(SUPPLY_INIT);
    sinkSlider.set(SINK_INIT);
    thresholdSlider.set(THRESHOLD_INIT);
    resetSim();
  });

  /* ---- レイアウト ---- */

  function layout(): { stage: Pane; plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 620;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const plotH = Math.max(120, h * 0.34);
      return {
        stage: { x: pad, y: pad, w: w - 2 * pad, h: h - plotH - 3 * pad },
        plot: { x: pad, y: h - plotH - pad, w: w - 2 * pad, h: plotH },
        narrow,
      };
    }
    const plotW = Math.max(210, Math.min(320, w * 0.4));
    return {
      stage: { x: pad, y: pad, w: w - plotW - 3 * pad, h: h - 2 * pad },
      plot: { x: w - plotW - pad, y: pad, w: plotW, h: h - 2 * pad },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  /** 吸収源(転位 ⊥ と粒界)の記号。効きの強さで濃さを変える */
  function drawSinks(view: LatticeView, p: Pane): void {
    const alpha = 0.15 + 0.85 * clamp(model.sink / SINK_MAX, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = pal.defect;
    ctx.lineWidth = 2;
    // 粒界(右端の縦線)
    const gbX = viewX(view, COLS / 2 + 0.7);
    ctx.beginPath();
    ctx.moveTo(gbX, p.y + 10);
    ctx.lineTo(gbX, p.y + p.h - 10);
    ctx.stroke();
    // 転位(⊥ 記号)を 2 つ
    for (const [lx, ly] of [
      [-COLS / 2 - 0.8, ROWS_PER_HALF - 1],
      [-COLS / 2 - 0.8, -(ROWS_PER_HALF - 1)],
    ]) {
      const x = viewX(view, lx);
      const y = viewY(view, ly);
      const s = view.scale * 0.7;
      ctx.beginPath();
      ctx.moveTo(x - s / 2, y);
      ctx.lineTo(x + s / 2, y);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - s * 0.75);
      ctx.stroke();
    }
    ctx.restore();
    ctx.font = font(10.5);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    outlinedText(ctx, "粒界", gbX - 4, p.y + 10, pal.defect, pal.bg);
    ctx.textAlign = "left";
    outlinedText(
      ctx,
      "⊥ 転位(空孔の吸収源)",
      viewX(view, -COLS / 2 - 0.8) + 4,
      p.y + 10,
      pal.defect,
      pal.bg,
    );
  }

  function drawStage(p: Pane): void {
    paneFrame(ctx, p, pal.hairline);
    // 左右に 1 格子ぶんの余白を取り、吸収源の記号(⊥・粒界)を原子列の外に置く
    const view = makeLatticeView(
      p.x,
      p.y,
      p.w,
      p.h - 20,
      COLS + 2,
      ROWS_PER_HALF * 2 + 2,
    );
    const r = 0.32 * view.scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    ctx.clip();

    drawSinks(view, p);

    // 空孔として描くサイトを先に決める(個数は過飽和度に比例させる)
    const excess = Math.max(model.s - 1, 0);
    const nVac = Math.min(Math.round(excess * VAC_PER_EXCESS), VAC_DRAW_MAX);
    vacantFlag.fill(0);
    let nv = 0;
    for (let k = 0; k < grid.count && nv < nVac; k++) {
      const s = vacancyOrder[k];
      if (insideVoid(grid.px[s], grid.py[s])) continue;
      vacantFlag[s] = 1;
      bufVX[nv] = viewX(view, grid.px[s]);
      bufVY[nv] = viewY(view, grid.py[s]);
      nv++;
    }

    // 原子(ボイドの中と空孔のサイトには描かない = 原子が無い場所)
    let na = 0;
    let nb = 0;
    for (let s = 0; s < grid.count; s++) {
      if (vacantFlag[s] !== 0) continue;
      const lx = grid.px[s];
      const ly = grid.py[s];
      if (insideVoid(lx, ly)) continue;
      const x = viewX(view, lx);
      const y = viewY(view, ly);
      if (species[s] === SITE_B) {
        bufBX[nb] = x;
        bufBY[nb] = y;
        nb++;
      } else {
        bufAX[na] = x;
        bufAY[na] = y;
        na++;
      }
    }
    drawAtoms(ctx, bufAX, bufAY, na, r, pal.matrix, pal.matrixEdge);
    drawAtoms(ctx, bufBX, bufBY, nb, r, pal.second, pal.secondEdge);

    // 空孔(塗りなし + --mat-matrix の破線縁)
    drawVacancies(ctx, bufVX, bufVY, nv, r, pal.matrixEdge);

    // ボイド(白い塗り + --mat-defect の輪郭)
    for (let i = 0; i < model.count; i++) {
      const rad = voidRadius(i) * view.scale;
      if (rad < 1) continue;
      ctx.beginPath();
      ctx.arc(
        viewX(view, voidLX[i]),
        viewY(view, voidLY[i]),
        rad,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.defect;
      ctx.stroke();
    }

    ctx.restore();

    // 凡例と判定バッジ
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    outlinedText(
      ctx,
      "破線の円 = 空孔 / 白い穴 = ボイド(--mat-defect の縁)",
      p.x + 6,
      p.y + p.h - 5,
      pal.text2,
      pal.bg,
    );
    const healthy = model.count === 0;
    ctx.textAlign = "right";
    outlinedText(
      ctx,
      healthy ? "健全" : "ボイド発生",
      p.x + p.w - 6,
      p.y + p.h - 5,
      healthy ? pal.text2 : pal.defect,
      pal.bg,
    );
    ctx.textAlign = "left";
  }

  function drawPlot(p: Pane): void {
    const axisX = p.x + 30;
    const axisR = p.x + p.w - 8;
    const yTop = p.y + 44;
    const yBot = p.y + p.h - 28;
    const tNow = model.time;
    const tMin = Math.max(0, tNow - HISTORY_WINDOW_S);
    const mx = (t: number): number =>
      axisX + ((t - tMin) / HISTORY_WINDOW_S) * (axisR - axisX);
    const my = (s: number): number =>
      yBot - ((s - 1) / (S_AXIS_MAX - 1)) * (yBot - yTop);

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
    for (const v of linTicks(1, S_AXIS_MAX, 4)) {
      ctx.fillText(`${v}`, axisX - 4, my(v));
    }

    // しきい値 S* の破線
    const yStar = my(clamp(model.threshold, 1, S_AXIS_MAX));
    dashedLine(ctx, axisX, yStar, axisR, yStar, pal.defect, [5, 4], 1.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    outlinedText(
      ctx,
      `S* = ${model.threshold.toFixed(1)}`,
      axisX + 4,
      yStar - 2,
      pal.defect,
      pal.bg,
    );

    // S(t) の履歴
    if (histCount > 1) {
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (let k = 0; k < histCount; k++) {
        const idx = (histHead - histCount + k + HISTORY_LEN * 2) % HISTORY_LEN;
        if (histT[idx] < tMin) continue;
        const x = mx(histT[idx]);
        const y = my(clamp(histS[idx], 1, S_AXIS_MAX));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 読み出し
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = pal.text;
    ctx.fillText("空孔の過飽和度 S = C_V / C_V^eq", p.x + 2, p.y + 4);
    ctx.fillText(
      `S = ${model.s.toFixed(2)} / ボイド ${model.count} 個 / 面積率 ${areaFractionPct().toFixed(1)}%`,
      p.x + 2,
      p.y + 19,
    );
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("時間 →(モデル時間・強く加速)", axisR, yBot + 5);
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
      model.step(h);
      sampleClock += h;
      if (sampleClock >= HISTORY_SAMPLE_S) {
        sampleClock = 0;
        histS[histHead] = model.s;
        histT[histHead] = model.time;
        histHead = (histHead + 1) % HISTORY_LEN;
        if (histCount < HISTORY_LEN) histCount++;
      }
    });
    draw();
  });
  host.onRender(draw);

  initLayout();
  resetSim();

  return {
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
