/**
 * critical-stress-explorer.ts — 図6「τ_c を測る」(記事仕様書 02 §5.6)
 *
 * 左: 図5 の縮小版ステージ(現在の L の源のみ。ループは 1 本目の放出を
 * 検出したら即フェード)。右: 測定点が溜まっていく散布図。
 *
 * 測定: τ を 0 からゆっくり自動ランプし、最初の相殺イベント発生時の τ を
 * 記録して点を打つ。測定値は動的効果でわずかに理論より高側に出る(図注で
 * 明示)。内部計算は無次元(L = 1)なので、ランプは L によらず同じ時間で
 * 終わる(§5.6 受け入れ基準)。
 *
 * 理論線 τ_c = μb/L は測定点が 3 点たまるまで重ねられない
 * (発見が先、式が後 — デザイン原則 4)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { FrankReadSim, TAU_C_SIM, type SimEvents } from "./lib/line";
import { simTauToMPa, tauCMPa } from "./lib/constants";
import {
  FIG_FONT,
  FIG_FONT_SMALL,
  drawGrid,
  drawPin,
  drawViewBadge,
  projectCurve,
  resolvePalette,
  setControlEnabled,
  strokePts,
} from "./lib/draw";

/** L スライダーの範囲(μm) */
const L_MIN = 0.2;
const L_MAX = 3.0;
const L_INIT = 1.0;
/** 散布図の縦軸上限(MPa) */
const PLOT_TAU_MAX = 40;
/** 実時間 1 秒あたりのシミュレーション時間(測定を速く終えるため高め) */
const SIM_RATE = 4;
/** ランプ第 1 段(0 → 0.9τ_c)のレート(無次元 τ / シム時間) */
const RAMP_FAST = (0.9 * TAU_C_SIM) / (2 * SIM_RATE);
/** ランプ第 2 段(0.9τ_c 以降)のレート。遅くして動的効果を抑える
 * (この設定で測定値は理論の約 1.1 倍・1 回約 5 秒) */
const RAMP_SLOW = RAMP_FAST / 8;
/** 検出後のフェード時間(秒) */
const FADE_SECONDS = 0.35;
/** 測定の上限時間(秒)。万一相殺が起きない場合の保険 */
const MEASURE_TIMEOUT_S = 15;

interface MeasurePoint {
  lUm: number;
  tauMPa: number;
}

export default function criticalStressExplorer(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  const sim = new FrankReadSim();
  const events: SimEvents = {
    recombined: false,
    collapsedLoops: 0,
    nan: false,
  };

  let lUm = L_INIT;
  let measuring = false;
  let measureClock = 0;
  let fadeClock = -1;
  let invAxis = false;
  let showTheory = false;
  const points: MeasurePoint[] = [];

  let screenPts = new Float64Array(1024);
  function ensurePts(n: number): void {
    if (screenPts.length < 2 * n) {
      screenPts = new Float64Array(1 << Math.ceil(Math.log2(2 * n)));
    }
  }

  function setLocked(locked: boolean): void {
    setControlEnabled(lSlider.el, !locked);
    setControlEnabled(measureBtn.el.parentElement ?? measureBtn.el, !locked);
    updateTheoryToggle();
  }

  function updateTheoryToggle(): void {
    setControlEnabled(theoryToggle.el, !measuring && points.length >= 3);
  }

  function startMeasurement(): void {
    if (measuring) return;
    sim.reset();
    sim.tau = 0;
    measuring = true;
    measureClock = 0;
    fadeClock = -1;
    setLocked(true);
  }

  function finishMeasurement(recordTau: boolean): void {
    if (recordTau) {
      points.push({ lUm, tauMPa: simTauToMPa(sim.tau, lUm) });
    }
    measuring = false;
    sim.tau = 0; // 源を緩和させる(直線へ戻る)
    setLocked(false);
  }

  function update(dt: number): void {
    if (measuring) {
      measureClock += dt;
      // 2 段ランプ: 0.9τ_c までは速く、それ以降は遅く(動的効果を抑える)
      const dSim = dt * SIM_RATE;
      const rate = sim.tau < 0.9 * TAU_C_SIM ? RAMP_FAST : RAMP_SLOW;
      sim.tau += rate * dSim;
      sim.advance(dSim, events);
      if (events.nan) {
        console.warn("[critical-stress-explorer] 数値破綻のためリセットします");
        sim.reset();
        finishMeasurement(false);
        return;
      }
      if (events.recombined) {
        // 最初の相殺イベント → 測定値を記録し、ループは即フェード(§5.6)
        finishMeasurement(true);
        fadeClock = 0;
      } else if (measureClock > MEASURE_TIMEOUT_S) {
        finishMeasurement(false);
      }
    } else {
      // 測定後の緩和(τ = 0 で直線へ戻る)とループのフェード
      sim.advance(dt * SIM_RATE, events);
      if (fadeClock >= 0) {
        fadeClock += dt;
        if (fadeClock >= FADE_SECONDS) {
          for (let i = sim.loops.length - 1; i >= 0; i--) {
            sim.removeLoop(sim.loops[i].id);
          }
          fadeClock = -1;
        }
      }
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const stageW = w * 0.4;

    /* ---- 左: ミニステージ ---- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, stageW, h);
    ctx.clip();
    drawGrid(ctx, stageW, h, 32, pal.hairline);

    // 物理スケール: L_MAX がステージ幅の 7 割に収まる px/μm
    const pxPerUm = (stageW * 0.7) / L_MAX;
    const scale = pxPerUm * lUm; // シム座標(L=1)→px
    const ox = stageW / 2;
    const oy = h * 0.52;

    ctx.lineJoin = "round";
    for (const loop of sim.loops) {
      ensurePts(loop.n);
      projectCurve(loop.x, loop.y, loop.n, ox, oy, scale, screenPts);
      ctx.globalAlpha =
        fadeClock >= 0 ? Math.max(1 - fadeClock / FADE_SECONDS, 0) : 1;
      ctx.strokeStyle = pal.defect;
      ctx.lineWidth = 2;
      strokePts(ctx, screenPts, loop.n, true);
      ctx.globalAlpha = 1;
    }
    const src = sim.source;
    ensurePts(src.n);
    projectCurve(src.x, src.y, src.n, ox, oy, scale, screenPts);
    ctx.strokeStyle = pal.defect;
    ctx.lineWidth = 2;
    strokePts(ctx, screenPts, src.n, false);
    drawPin(ctx, ox - scale / 2, oy, pal, 4);
    drawPin(ctx, ox + scale / 2, oy, pal, 4);

    // スケールバー(1 μm)
    const barY = h - 20;
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, barY);
    ctx.lineTo(14 + pxPerUm, barY);
    ctx.stroke();
    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("1 μm", 14, barY - 4);

    // 進行中の τ 表示(§5.6: 測定中は τ 値が読める)
    ctx.font = FIG_FONT;
    ctx.textBaseline = "top";
    if (measuring) {
      ctx.fillStyle = pal.text;
      ctx.fillText(
        `測定中… τ = ${simTauToMPa(sim.tau, lUm).toFixed(1)} MPa`,
        14,
        12,
      );
    } else {
      ctx.fillStyle = pal.text2;
      ctx.fillText(`L = ${lUm.toFixed(1)} μm`, 14, 12);
    }
    ctx.restore();

    drawViewBadge(ctx, stageW + 4, "top", pal);

    /* ---- 右: 散布図 ---- */
    const plotX0 = stageW + 56;
    const plotX1 = w - 18;
    const plotY0 = 24;
    const plotY1 = h - 40;

    const xMin = invAxis ? 0 : 0;
    const xMax = invAxis ? 1 / L_MIN : L_MAX + 0.2;
    const xOf = (l: number): number => (invAxis ? 1 / l : l);
    const px = (xv: number): number =>
      plotX0 + ((xv - xMin) / (xMax - xMin)) * (plotX1 - plotX0);
    const py = (tau: number): number =>
      plotY1 - (tau / PLOT_TAU_MAX) * (plotY1 - plotY0);

    // 軸
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX0, plotY0 - 4);
    ctx.lineTo(plotX0, plotY1);
    ctx.lineTo(plotX1, plotY1);
    ctx.stroke();

    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xTicks = invAxis ? [1, 2, 3, 4, 5] : [0.5, 1, 1.5, 2, 2.5, 3];
    for (const t of xTicks) {
      if (t < xMin || t > xMax) continue;
      ctx.beginPath();
      ctx.moveTo(px(t), plotY1);
      ctx.lineTo(px(t), plotY1 + 4);
      ctx.stroke();
      ctx.fillText(String(t), px(t), plotY1 + 7);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of [0, 10, 20, 30, 40]) {
      ctx.beginPath();
      ctx.moveTo(plotX0 - 4, py(t));
      ctx.lineTo(plotX0, py(t));
      ctx.stroke();
      ctx.fillText(String(t), plotX0 - 7, py(t));
    }
    ctx.font = FIG_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      invAxis ? "1 / L(μm⁻¹)" : "源の長さ L(μm)",
      (plotX0 + plotX1) / 2,
      plotY1 + 22,
    );
    ctx.save();
    ctx.translate(plotX0 - 36, (plotY0 + plotY1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "bottom";
    ctx.fillText("臨界応力 τ(MPa)", 0, 0);
    ctx.restore();

    // 理論線 τ_c = μb/L(3 点以上で解禁 — §5.6)
    if (showTheory && points.length >= 3) {
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const N = 80;
      let started = false;
      for (let i = 0; i <= N; i++) {
        const l = L_MIN + ((L_MAX - L_MIN) * i) / N;
        const tau = tauCMPa(l);
        if (tau > PLOT_TAU_MAX) continue;
        const xx = px(xOf(l));
        const yy = py(tau);
        if (!started) {
          ctx.moveTo(xx, yy);
          started = true;
        } else {
          ctx.lineTo(xx, yy);
        }
      }
      ctx.stroke();
      ctx.fillStyle = pal.accent;
      ctx.font = FIG_FONT_SMALL;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const lLabel = invAxis ? 0.45 : 0.62;
      ctx.fillText(
        "理論線 τ = μb/L",
        px(xOf(lLabel)) + 6,
        py(tauCMPa(lLabel)) - 4,
      );
    }

    // 測定点(同一 L の再測定は薄い重ね点 — §5.6)
    for (const pt of points) {
      ctx.beginPath();
      ctx.arc(
        px(xOf(pt.lUm)),
        py(Math.min(pt.tauMPa, PLOT_TAU_MAX)),
        4.5,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = pal.defect;
      ctx.globalAlpha = 0.65;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = pal.defectDark;
      ctx.stroke();
    }

    // 現在の L の位置(次に測る場所)を薄く示す
    if (!measuring) {
      ctx.strokeStyle = pal.hairline;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(px(xOf(lUm)), plotY0);
      ctx.lineTo(px(xOf(lUm)), plotY1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ---- 操作部品(§5.6) ---- */

  const lSlider = host.controls.slider({
    id: "length",
    label: "源の長さ L",
    min: L_MIN,
    max: L_MAX,
    step: 0.1,
    value: L_INIT,
    unit: "μm",
    format: (v) => v.toFixed(1),
  });
  lSlider.onChange((v) => {
    lUm = v;
  });

  const measureBtn = host.controls.button({ label: "臨界応力を測る" });
  measureBtn.onClick(() => {
    startMeasurement();
    host.requestRender();
  });

  const invToggle = host.controls.toggle({
    id: "inv-axis",
    label: "横軸を 1/L にする",
    value: false,
  });
  invToggle.onChange((v) => {
    invAxis = v;
  });

  const theoryToggle = host.controls.toggle({
    id: "theory",
    label: "理論線 τ = μb/L を重ねる",
    value: false,
  });
  theoryToggle.onChange((v) => {
    showTheory = v;
  });

  const resetBtn = host.controls.button({ label: "測定をやり直す" });
  resetBtn.onClick(() => {
    points.length = 0;
    sim.reset();
    sim.tau = 0;
    measuring = false;
    fadeClock = -1;
    showTheory = false;
    theoryToggle.set(false);
    setLocked(false);
    host.requestRender();
  });

  updateTheoryToggle();

  host.onFrame((dt) => {
    update(dt);
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      /* イベントリスナーなし */
    },
  };
}
