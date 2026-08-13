/**
 * darken.ts — 図5「動く速さを測る」(記事仕様書 06 §5.5)
 *
 * 左: 拡散対のミニ版(プロファイル + 目印 + 初期界面の破線)。「測る」を押すと
 * 56 日ぶんの焼鈍を数秒で走らせ、目印が動く。
 * 右: 散布図(横軸 D_Zn − D_Cu、縦軸 目印の移動量 Δ)。測定点が溜まっていく。
 * **測定点が 3 点たまるまで理論線(ダルケンの式)は重ねられない**
 * — 「測定 → 法則発見」の順序を守る(デザイン原則 4)。
 *
 * モデル: 図3 と同じ数値解(lib/diffusion.ts の DiffusionCouple)。理論線は
 *   Δ(t) = X_brass (D_A − D_B)√(t / π D̃)
 * で、数値解はこれからわずかにずれる(数値解の D̃ は組成に依存するため。
 * 図注で明示)。**比を振るときは D̃ を一定に保つ**ので、Δ は D_A − D_B に
 * 正比例し、測定点は原点を通る直線に並ぶ(§5.5)。
 *
 * 実装方式: 2D / onFrame(測定中のみ積分。待機中は onRender でアイドル)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp, mulberry32 } from "../../core/mathx";
import {
  CELSIUS_OFFSET,
  T_ANNEAL_C,
  T_ANNEAL_S,
  X_BRASS,
  dCu,
  dZn,
  formatDuration,
  formatSci,
} from "./lib/constants";
import {
  DiffusionCouple,
  dPairAtFixedDTilde,
  interdiffusionD,
  markerShiftAnalytic,
} from "./lib/diffusion";
import {
  type Pane,
  dashedLine,
  dimensionLine,
  drawAtoms,
  font,
  linTicks,
  outlinedText,
  paneFrame,
  resolvePalette,
  setControlEnabled,
} from "./lib/draw";

/** 計算領域の半幅 [m] と格子点数 */
const DOMAIN_HALF = 1000e-6;
const GRID = 201;
/** 左ステージの視野の半幅 [m](図3 と同じ縮尺感) */
const VIEW_HALF = 300e-6;
/** ステージ上段に描く原子点(濃度のディザ表現)の個数とシード */
const DOT_COUNT = 260;
const DOT_SEED = 19480311;
const DOT_R = 2.1;
/** D_Zn/D_Cu 比(1.0 が必ず選べる刻み — §5.5) */
const RATIO_MIN = 0.5;
const RATIO_MAX = 8;
const RATIO_STEP = 0.1;
const RATIO_INIT = 4;
/** 1 回の測定にかける画面時間 [s] */
const MEASURE_SCREEN_S = 2.5;
/** 理論線を解禁する測定点数 */
const THEORY_MIN_POINTS = 3;
/** 散布図の軸範囲(横: 10⁻¹⁵ m²/s 単位、縦: μm) */
const DX_MIN = -7;
const DX_MAX = 13;
const DY_MIN = -30;
const DY_MAX = 50;

interface MeasurePoint {
  /** D_Zn − D_Cu [10⁻¹⁵ m²/s] */
  dDiff: number;
  /** 目印の移動量 [μm] */
  shiftUm: number;
}

export default function darken(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /**
   * 相互拡散係数 D̃(785 °C の値)を固定したまま比だけを振る(§5.5)。
   * こうすると拡散の広がり方は変えずにマーカー速度だけを変えられるので、
   * 移動量 Δ が D_Zn − D_Cu に正比例する = 測定点が直線に並ぶ。
   */
  const D_TILDE = interdiffusionD(
    X_BRASS / 2,
    dZn(T_ANNEAL_C + CELSIUS_OFFSET),
    dCu(T_ANNEAL_C + CELSIUS_OFFSET),
  );

  let ratio = RATIO_INIT;
  let measuring = false;
  let showTheory = false;
  const points: MeasurePoint[] = [];

  function currentD(): { dA: number; dB: number } {
    return dPairAtFixedDTilde(ratio, D_TILDE, X_BRASS / 2);
  }

  /** ステージ上段の原子点(位置とディザのしきい値はシード固定) */
  const dotX = new Float64Array(DOT_COUNT);
  const dotY = new Float64Array(DOT_COUNT);
  const dotU = new Float64Array(DOT_COUNT);
  const bufAX = new Float64Array(DOT_COUNT);
  const bufAY = new Float64Array(DOT_COUNT);
  const bufBX = new Float64Array(DOT_COUNT);
  const bufBY = new Float64Array(DOT_COUNT);
  {
    const rand = mulberry32(DOT_SEED);
    for (let i = 0; i < DOT_COUNT; i++) {
      dotX[i] = (rand() * 2 - 1) * VIEW_HALF;
      dotY[i] = rand();
      dotU[i] = rand();
    }
  }

  let couple = newCouple();

  function newCouple(): DiffusionCouple {
    const { dA, dB } = currentD();
    return new DiffusionCouple(dA, dB, {
      n: GRID,
      halfWidth: DOMAIN_HALF,
      xBrass: X_BRASS,
    });
  }

  /* ---- 操作部品(§7.2) ---- */

  const ratioSlider = host.controls.slider({
    id: "ratio",
    label: "D_Zn / D_Cu",
    min: RATIO_MIN,
    max: RATIO_MAX,
    step: RATIO_STEP,
    value: RATIO_INIT,
    format: (v) => v.toFixed(1),
  });
  ratioSlider.onChange((v) => {
    ratio = v;
    couple = newCouple(); // 比を変えたら未焼鈍の状態から測り直す
    host.requestRender();
  });

  const measureBtn = host.controls.button({ label: "56 日間 焼鈍して測る" });
  measureBtn.onClick(() => {
    startMeasurement();
  });

  const evenBtn = host.controls.button({ label: "比を 1.0 にする" });
  evenBtn.onClick(() => {
    ratioSlider.set(1); // onChange 経由で未焼鈍状態へ
  });

  const theoryToggle = host.controls.toggle({
    id: "theory",
    label: "ダルケンの式を重ねる",
    value: false,
  });
  theoryToggle.onChange((v) => {
    showTheory = v;
    host.requestRender();
  });

  host.controls.reset(() => {
    points.length = 0;
    theoryToggle.set(false);
    ratioSlider.set(RATIO_INIT);
    measuring = false;
    couple = newCouple();
    updateLocks();
  });

  function updateLocks(): void {
    setControlEnabled(ratioSlider.el, !measuring);
    setControlEnabled(measureBtn.el.parentElement ?? measureBtn.el, !measuring);
    setControlEnabled(
      theoryToggle.el,
      !measuring && points.length >= THEORY_MIN_POINTS,
    );
  }

  function startMeasurement(): void {
    if (measuring) return;
    couple = newCouple();
    measuring = true;
    updateLocks();
    host.setPlaying(true); // 測定中だけフレームを回す
  }

  function finishMeasurement(): void {
    const { dA, dB } = currentD();
    points.push({
      dDiff: (dA - dB) * 1e15,
      shiftUm: couple.markerX * 1e6,
    });
    measuring = false;
    updateLocks();
    host.setPlaying(false);
    host.requestRender();
  }

  /* ---- レイアウト ---- */

  function layout(): { stage: Pane; plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 620;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const stageH = Math.max(90, h * 0.36);
      return {
        stage: { x: pad, y: pad, w: w - 2 * pad, h: stageH },
        plot: {
          x: pad,
          y: pad + stageH + pad,
          w: w - 2 * pad,
          h: h - stageH - 3 * pad,
        },
        narrow,
      };
    }
    const stageW = Math.max(200, w * 0.42);
    return {
      stage: { x: pad, y: pad, w: stageW, h: h - 2 * pad },
      plot: {
        x: pad + stageW + pad,
        y: pad,
        w: w - stageW - 3 * pad,
        h: h - 2 * pad,
      },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function drawStage(p: Pane): void {
    paneFrame(ctx, p, pal.hairline);
    const left = p.x + 8;
    const width = p.w - 16;
    const mx = (x: number): number =>
      left + ((x + VIEW_HALF) / (2 * VIEW_HALF)) * width;
    const x0 = mx(0);
    const xm = mx(couple.markerX);

    // 上段: 原子のディザ帯(図3 と同じ視覚言語で「拡散対」を示す)
    const bandTop = p.y + 40;
    const bandBot = bandTop + Math.max(48, p.h * 0.26);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 1, bandTop, p.w - 2, bandBot - bandTop);
    ctx.clip();
    let na = 0;
    let nb = 0;
    for (let i = 0; i < DOT_COUNT; i++) {
      const sx = mx(dotX[i]);
      const sy = bandTop + 4 + dotY[i] * (bandBot - bandTop - 8);
      if (dotU[i] < couple.compositionAt(dotX[i])) {
        bufBX[nb] = sx;
        bufBY[nb] = sy;
        nb++;
      } else {
        bufAX[na] = sx;
        bufAY[na] = sy;
        na++;
      }
    }
    drawAtoms(ctx, bufAX, bufAY, na, DOT_R, pal.matrix, pal.matrixEdge);
    drawAtoms(ctx, bufBX, bufBY, nb, DOT_R, pal.second, pal.secondEdge);
    ctx.restore();

    // 初期界面(破線)と目印(accent)。帯とプロファイルを縦に貫く
    const yBot = p.y + p.h - 40;
    const yTop = bandBot + 26;
    dashedLine(ctx, x0, bandTop, x0, yBot, pal.hairline, [5, 4]);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(xm, bandTop);
    ctx.lineTo(xm, yBot);
    ctx.stroke();

    // 移動量の寸法線(帯の下端)
    if (Math.abs(xm - x0) > 3) {
      dimensionLine(
        ctx,
        x0,
        xm,
        bandBot + 12,
        `Δ = ${(couple.markerX * 1e6).toFixed(1)} μm`,
        pal.accent,
        pal.bg,
      );
    }

    // 下段: 組成プロファイル(0 と X_brass の基準線つき)
    const mapC = (c: number): number => yBot - ((yBot - yTop) * c) / X_BRASS;
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx(-VIEW_HALF), mapC(0));
    ctx.lineTo(mx(VIEW_HALF), mapC(0));
    ctx.moveTo(mx(-VIEW_HALF), mapC(X_BRASS));
    ctx.lineTo(mx(VIEW_HALF), mapC(X_BRASS));
    ctx.stroke();
    ctx.font = font(10);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("0.30", mx(-VIEW_HALF) + 2, mapC(X_BRASS) - 1);
    ctx.textBaseline = "top";
    ctx.fillText("0", mx(-VIEW_HALF) + 2, mapC(0) + 2);
    // 初期の段差(薄線)
    ctx.strokeStyle = pal.hairline;
    ctx.beginPath();
    ctx.moveTo(x0, mapC(0));
    ctx.lineTo(x0, mapC(X_BRASS));
    ctx.stroke();
    ctx.strokeStyle = pal.second;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 120; k++) {
      const x = -VIEW_HALF + (2 * VIEW_HALF * k) / 120;
      const sx = mx(x);
      const sy = mapC(couple.compositionAt(x));
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // 読み出し
    const { dA, dB } = currentD();
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = pal.text;
    ctx.fillText(
      `D_Zn = ${formatSci(dA)} / D_Cu = ${formatSci(dB)} m²/s`,
      p.x + 6,
      p.y + 6,
    );
    ctx.fillStyle = pal.text2;
    ctx.fillText(
      `D̃ = ${formatSci(D_TILDE)} m²/s(比を振っても一定)`,
      p.x + 6,
      p.y + 20,
    );
    ctx.textAlign = "right";
    ctx.fillText("Zn 原子分率 X", p.x + p.w - 6, yTop - 14);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const status = measuring
      ? `焼鈍中… ${formatDuration(couple.time)}`
      : couple.time > 0
        ? `Δ = ${(couple.markerX * 1e6).toFixed(1)} μm(56 日後)`
        : "「測る」で 56 日間の焼鈍を実行";
    ctx.fillStyle = measuring ? pal.text : pal.accent;
    ctx.fillText(status, p.x + 6, p.y + p.h - 8);
    ctx.textAlign = "right";
    ctx.fillStyle = pal.text2;
    ctx.fillText("破線 = 初期界面 / 縦棒 = 目印", p.x + p.w - 6, p.y + p.h - 8);
    ctx.textAlign = "left";
  }

  function drawPlot(p: Pane): void {
    const axisL = p.x + 34;
    const axisR = p.x + p.w - 8;
    const yTop = p.y + 22;
    const yBot = p.y + p.h - 46;
    const mx = (d: number): number =>
      axisL + ((d - DX_MIN) / (DX_MAX - DX_MIN)) * (axisR - axisL);
    const my = (s: number): number =>
      yBot - ((s - DY_MIN) / (DY_MAX - DY_MIN)) * (yBot - yTop);

    // 枠と原点の軸
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisL + 0.5, yTop);
    ctx.lineTo(axisL + 0.5, yBot);
    ctx.lineTo(axisR, yBot);
    ctx.stroke();
    // 原点を通る十字線(符号が読めるように)
    ctx.beginPath();
    ctx.moveTo(mx(0) + 0.5, yTop);
    ctx.lineTo(mx(0) + 0.5, yBot);
    ctx.moveTo(axisL, my(0) + 0.5);
    ctx.lineTo(axisR, my(0) + 0.5);
    ctx.stroke();

    ctx.font = font(10.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(DY_MIN, DY_MAX, 4)) {
      ctx.fillText(`${v}`, axisL - 4, my(v));
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of linTicks(DX_MIN, DX_MAX, 4)) {
      ctx.fillText(`${v}`, mx(v), yBot + 4);
    }
    ctx.textAlign = "left";
    ctx.fillText("D_Zn − D_Cu [10⁻¹⁵ m²/s]", axisL, yBot + 18);
    ctx.textBaseline = "top";
    ctx.fillStyle = pal.accent;
    ctx.fillText("目印の移動 Δ [μm](56 日後)", axisL, p.y + 4);

    // 理論線(ダルケンの式)。比を振った軌跡として描く
    if (showTheory && points.length >= THEORY_MIN_POINTS) {
      ctx.strokeStyle = pal.text2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 60; k++) {
        const r = RATIO_MIN + ((RATIO_MAX - RATIO_MIN) * k) / 60;
        const { dA, dB } = dPairAtFixedDTilde(r, D_TILDE, X_BRASS / 2);
        const x = mx((dA - dB) * 1e15);
        const y = my(markerShiftAnalytic(dA, dB, T_ANNEAL_S) * 1e6);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.font = font(10.5);
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      outlinedText(
        ctx,
        "Δ = X(D_A − D_B)√(t/πD̃)",
        axisR - 2,
        my(DY_MAX) + 14,
        pal.text2,
        pal.bg,
      );
    }

    // 測定点
    ctx.fillStyle = pal.accent;
    for (const pt of points) {
      const x = mx(clamp(pt.dDiff, DX_MIN, DX_MAX));
      const y = my(clamp(pt.shiftUm, DY_MIN, DY_MAX));
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 案内
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const hint =
      points.length === 0
        ? "比を変えて「測る」を押すと、ここに点が溜まる"
        : points.length < THEORY_MIN_POINTS
          ? `測定点 ${points.length} 個(3 個たまると理論線が使える)`
          : `測定点 ${points.length} 個 — 原点を通る直線に並ぶ`;
    ctx.fillStyle = pal.text2;
    ctx.fillText(hint, axisL, p.y + p.h - 4);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawStage(l.stage);
    drawPlot(l.plot);
  }

  /* ---- フレームループ(測定中のみ) ---- */

  host.onFrame((dt) => {
    if (measuring) {
      const remain = T_ANNEAL_S - couple.time;
      const stepS = Math.min((dt / MEASURE_SCREEN_S) * T_ANNEAL_S, remain);
      couple.step(stepS);
      if (couple.time >= T_ANNEAL_S - 1) finishMeasurement();
    }
    draw();
  });
  host.onRender(draw);

  updateLocks();
  host.setPlaying(false); // 待機中はアイドル(測定開始で回す)

  return {
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
