/**
 * diffusion-couple.ts — 図3「1947 年の実験」(記事仕様書 06 §5.3・中心図版)
 *
 * 上段: 拡散対の断面(左 = 純銅、右 = α真鍮)。原子を表す点の色は局所の
 * X_Zn にもとづくシード固定のディザで A(--mat-matrix)/ B(--mat-second)に
 * 決める。目印(Mo 線)は accent の縦バー、初期界面は破線で残す。
 * 下段: X_Zn(x) のプロファイル。
 *
 * モデル: 実験室座標系の 1 次元相互拡散 ∂X/∂t = ∂/∂x(D̃(X) ∂X/∂x)、
 * D̃ = X_B D_A + X_A D_B(A = Zn、B = Cu)。マーカーは格子に固定された目印
 * なので v = (D_Zn − D_Cu) ∂X_Zn/∂x で運ばれる(§5.3)。
 *
 * 実装方式: 2D / onFrame + fixedStep。原子点は 2 パス(A・B)でまとめ描き、
 * 点の数は画面幅で自動スケール(母体仕様 §8.3)。
 *
 * 簡略化(図注): 1 次元・モル体積の変化や応力・粒界拡散は無視・原子の点は
 * 濃度のディザ表現(1 点 = 1 原子ではない)・**時間は極端に加速している**。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { clamp, mulberry32 } from "../../core/mathx";
import {
  CELSIUS_OFFSET,
  T_ANNEAL_C,
  T_ANNEAL_S,
  X_BRASS,
  dCu,
  dZn,
  formatDuration,
} from "./lib/constants";
import { DiffusionCouple, interdiffusionD } from "./lib/diffusion";
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
} from "./lib/draw";

/** 乱数シード(reset で完全に同じ点配置へ — 母体仕様 §8.2) */
const SEED = 19470714;
/** 計算領域の半幅 [m] と格子点数(Δx = 10 μm) */
const DOMAIN_HALF = 1000e-6;
const GRID = 201;
/**
 * 表示する視野の半幅 [m]。56 日の拡散帯(2√(D̃t) ≈ 460 μm)が収まり、かつ
 * 目印の移動(数十 μm)が画面上で 100 px 程度に見える幅に選んである。
 */
const VIEW_HALF = 300e-6;
/** 原子点の個数(画面幅で自動スケール) */
const DOT_MIN = 400;
const DOT_MAX = 1100;
/** 点の描画半径 [px] */
const DOT_R = 2.3;

/** 温度スライダー(§5.3: 650〜850 °C・step 5・初期 785) */
const TEMP_MIN_C = 650;
const TEMP_MAX_C = 850;
const TEMP_STEP_C = 5;

/** 時間の進み(×1 で 0.4 日/画面秒 → ×10 で約 4 日/画面秒 — §5.3) */
type SpeedValue = "1" | "10" | "100";
const SPEED_INIT: SpeedValue = "10";
const PHYS_S_PER_SCREEN_S = 0.4 * 86400;
/** 計算領域の端の影響が出ない上限 [s](100 日) */
const T_MAX_S = 100 * 86400;
/** 固定タイムステップ [ms] */
const STEP_MS = 16;

export default function diffusionCouple(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  let tempC = T_ANNEAL_C;
  let speedMult = Number(SPEED_INIT);
  let showProfile = true;

  const couple = new DiffusionCouple(
    dZn(T_ANNEAL_C + CELSIUS_OFFSET),
    dCu(T_ANNEAL_C + CELSIUS_OFFSET),
    { n: GRID, halfWidth: DOMAIN_HALF, xBrass: X_BRASS },
  );

  /* ---- 原子点(位置とディザのしきい値はシード固定) ---- */

  let dotCount = DOT_MAX;
  const dotX = new Float64Array(DOT_MAX);
  const dotY = new Float64Array(DOT_MAX);
  const dotU = new Float64Array(DOT_MAX);
  const bufAX = new Float64Array(DOT_MAX);
  const bufAY = new Float64Array(DOT_MAX);
  const bufBX = new Float64Array(DOT_MAX);
  const bufBY = new Float64Array(DOT_MAX);

  function targetDotCount(): number {
    return Math.round(clamp(host.size.w * 1.6, DOT_MIN, DOT_MAX));
  }

  /** 点の配置(x は視野内・y は 0〜1 の相対位置)。ディザ用の一様乱数も引く */
  function initDots(): void {
    const rand = mulberry32(SEED);
    dotCount = targetDotCount();
    for (let i = 0; i < dotCount; i++) {
      dotX[i] = (rand() * 2 - 1) * VIEW_HALF;
      dotY[i] = rand();
      dotU[i] = rand();
    }
  }

  function applyTemperature(): void {
    const tK = tempC + CELSIUS_OFFSET;
    couple.dA = dZn(tK);
    couple.dB = dCu(tK);
  }

  function resetSim(): void {
    applyTemperature();
    couple.reset();
  }

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "temp",
    label: "温度 T",
    min: TEMP_MIN_C,
    max: TEMP_MAX_C,
    step: TEMP_STEP_C,
    value: T_ANNEAL_C,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    // 温度は途中でも変えられる(以後の進みの速さが変わる)
    tempC = v;
    applyTemperature();
  });

  const speedSeg = host.controls.segmented<SpeedValue>({
    id: "speed",
    label: "時間の進み",
    options: [
      { value: "1", label: "×1" },
      { value: "10", label: "×10" },
      { value: "100", label: "×100" },
    ],
    value: SPEED_INIT,
  });
  speedSeg.onChange((v) => {
    speedMult = Number(v);
  });

  const profileToggle = host.controls.toggle({
    id: "profile",
    label: "濃度プロファイルを表示",
    value: true,
  });
  profileToggle.onChange((v) => {
    showProfile = v;
  });

  host.controls.playPause();
  host.controls.reset(() => {
    tempSlider.set(T_ANNEAL_C);
    speedSeg.set(SPEED_INIT);
    profileToggle.set(true);
    resetSim();
  });

  /* ---- レイアウト ---- */

  function layout(): {
    stage: Pane;
    plot: Pane;
    readoutY: number;
    narrow: boolean;
  } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const readoutH = narrow ? 34 : 20;
    const top = pad + readoutH;
    const gap = narrow ? 8 : 12;
    const plotH = showProfile ? Math.max(70, Math.min(150, h * 0.34)) : 0;
    const stageH = h - top - (plotH > 0 ? gap + plotH : 0) - pad;
    return {
      stage: { x: pad, y: top, w: w - 2 * pad, h: stageH },
      plot: { x: pad, y: top + stageH + gap, w: w - 2 * pad, h: plotH },
      readoutY: pad,
      narrow,
    };
  }

  /* ---- 描画 ---- */

  /** 物理 x [m] → ステージ内の px */
  function mapX(p: Pane, x: number): number {
    return p.x + ((x + VIEW_HALF) / (2 * VIEW_HALF)) * p.w;
  }

  function drawReadouts(y: number, narrow: boolean): void {
    const { w } = host.size;
    const size = narrow ? 11 : 12.5;
    ctx.font = font(size);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const dTilde = interdiffusionD(X_BRASS / 2, couple.dA, couple.dB);
    const spread = 2 * Math.sqrt(dTilde * couple.time) * 1e6;
    const parts: Array<[string, string]> = [
      [
        `経過: ${formatDuration(couple.time)}(${Math.round(tempC)} °C 換算)`,
        pal.text,
      ],
      [`目印の移動 Δ = ${(couple.markerX * 1e6).toFixed(1)} μm`, pal.accent],
      [`拡散距離 2√(D̃t) = ${spread.toFixed(0)} μm`, pal.text2],
      [`D_Zn/D_Cu = ${(couple.dA / couple.dB).toFixed(1)}`, pal.text2],
    ];
    let x = narrow ? 8 : 12;
    let line = 0;
    for (const [s, color] of parts) {
      const tw = ctx.measureText(s).width;
      if (x + tw > w - 8 && line < 1) {
        line++;
        x = narrow ? 8 : 12;
      }
      ctx.fillStyle = color;
      ctx.fillText(s, x, y + line * (size + 4));
      x += tw + (narrow ? 12 : 18);
    }
  }

  function drawStage(p: Pane): void {
    paneFrame(ctx, p, pal.hairline);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();

    // 原子点: 局所の X_Zn とシード固定のしきい値で A / B に振り分ける
    let na = 0;
    let nb = 0;
    const yTop = p.y + 16;
    const yBot = p.y + p.h - 16;
    for (let i = 0; i < dotCount; i++) {
      const sxp = mapX(p, dotX[i]);
      const syp = yTop + dotY[i] * (yBot - yTop);
      if (dotU[i] < couple.compositionAt(dotX[i])) {
        bufBX[nb] = sxp;
        bufBY[nb] = syp;
        nb++;
      } else {
        bufAX[na] = sxp;
        bufAY[na] = syp;
        na++;
      }
    }
    drawAtoms(ctx, bufAX, bufAY, na, DOT_R, pal.matrix, pal.matrixEdge);
    drawAtoms(ctx, bufBX, bufBY, nb, DOT_R, pal.second, pal.secondEdge);

    // 初期界面(破線)と目印(Mo 線 = accent の縦バー 2 本)
    const x0 = mapX(p, 0);
    dashedLine(ctx, x0, p.y + 2, x0, p.y + p.h - 2, pal.hairline, [5, 4]);
    const xm = mapX(p, couple.markerX);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(xm, p.y + 4);
    ctx.lineTo(xm, p.y + 4 + Math.max(10, p.h * 0.22));
    ctx.moveTo(xm, p.y + p.h - 4);
    ctx.lineTo(xm, p.y + p.h - 4 - Math.max(10, p.h * 0.22));
    ctx.stroke();

    // 移動量の寸法線(初期界面 → 目印)
    if (Math.abs(xm - x0) > 3) {
      dimensionLine(
        ctx,
        x0,
        xm,
        p.y + p.h / 2,
        `Δ = ${(couple.markerX * 1e6).toFixed(1)} μm`,
        pal.accent,
        pal.bg,
      );
    }

    // ラベル
    ctx.font = font(11.5);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    outlinedText(ctx, "純銅(Cu)", p.x + 6, p.y + 4, pal.text2, pal.bg);
    ctx.textAlign = "right";
    outlinedText(
      ctx,
      "α真鍮(Cu–30%Zn)",
      p.x + p.w - 6,
      p.y + 4,
      pal.text2,
      pal.bg,
    );
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    outlinedText(
      ctx,
      "破線 = 初期界面 / 縦棒 = 目印の Mo 線",
      p.x + 6,
      p.y + p.h - 4,
      pal.text2,
      pal.bg,
    );
    // 史実の焼鈍時間(56 日)を通過したら知らせる
    if (couple.time >= T_ANNEAL_S) {
      ctx.textAlign = "right";
      outlinedText(
        ctx,
        "史実と同じ 56 日を通過",
        p.x + p.w - 6,
        p.y + p.h - 4,
        pal.accent,
        pal.bg,
      );
    }
    ctx.restore();
  }

  function drawPlot(p: Pane): void {
    if (p.h <= 0) return;
    const axisX = p.x + 34;
    const plotW = p.x + p.w - axisX - 6;
    const yTop = p.y + 12;
    const yBot = p.y + p.h - 16;
    const cMax = X_BRASS * 1.15;
    const mapC = (c: number): number => yBot - ((yBot - yTop) * c) / cMax;
    const mx = (x: number): number =>
      axisX + ((x + VIEW_HALF) / (2 * VIEW_HALF)) * plotW;

    // 軸
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, yTop);
    ctx.lineTo(axisX + 0.5, yBot);
    ctx.lineTo(axisX + plotW, yBot);
    ctx.stroke();
    ctx.font = font(10.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, X_BRASS, 3)) {
      const y = mapC(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(v.toFixed(2), axisX - 5, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const xu of [-200, -100, 0, 100, 200]) {
      const x = mx(xu * 1e-6);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, yBot + 0.5);
      ctx.lineTo(x + 0.5, yBot + 4);
      ctx.stroke();
      ctx.fillText(`${xu}`, x, yBot + 5);
    }

    // 初期の段差(薄線)
    ctx.strokeStyle = pal.hairline;
    ctx.beginPath();
    ctx.moveTo(mx(-VIEW_HALF), mapC(0));
    ctx.lineTo(mx(0), mapC(0));
    ctx.lineTo(mx(0), mapC(X_BRASS));
    ctx.lineTo(mx(VIEW_HALF), mapC(X_BRASS));
    ctx.stroke();

    // プロファイル
    ctx.strokeStyle = pal.second;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 160; k++) {
      const x = -VIEW_HALF + (2 * VIEW_HALF * k) / 160;
      const sxp = mx(x);
      const syp = mapC(couple.compositionAt(x));
      if (k === 0) ctx.moveTo(sxp, syp);
      else ctx.lineTo(sxp, syp);
    }
    ctx.stroke();

    // マーカー位置(accent の縦線)
    const xm = mx(couple.markerX);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xm, yTop);
    ctx.lineTo(xm, yBot);
    ctx.stroke();

    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Zn 原子分率 X", axisX + 2, p.y - 1);
    ctx.textAlign = "right";
    ctx.fillText("位置 [μm]", axisX + plotW, p.y - 1);
    ctx.textAlign = "left";
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawStage(l.stage);
    drawPlot(l.plot);
    drawReadouts(l.readoutY, l.narrow);
  }

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    stepper(dt, (h) => {
      if (couple.time < T_MAX_S) {
        couple.step(
          Math.min(h * PHYS_S_PER_SCREEN_S * speedMult, T_MAX_S - couple.time),
        );
      }
    });
    draw();
  });
  host.onRender(draw);

  initDots();
  resetSim();
  host.setPlaying(false); // 初期状態は一時停止(再生ボタンで「実験開始」— §5.3)

  return {
    resize(): void {
      const want = targetDotCount();
      if (Math.abs(want - dotCount) > dotCount * 0.2) initDots();
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
