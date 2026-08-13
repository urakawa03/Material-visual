/**
 * random-walk.ts — 図1「目的を持たない歩み」(記事仕様書 06 §5.1)
 *
 * 上段: 横長の箱。初期状態で左半分だけに粒子がある。各粒子は 4 方向から
 * 等確率に 1 つ選んで跳ぶだけで、**濃度勾配の情報は一切使わない**
 * (依頼文 §4: ランダムウォークに「意図」を持たせない)。
 * 下段: 濃度プロファイル(24 ビン)。誤差関数の理論曲線を重ねられる。
 *
 * 中央面(x = 0)を右へ渡った数と左へ渡った数を別々に数えて表示する。
 * どちらもゼロではないが、左に粒子が多い間は右へ渡る数の方が多い —
 * その差が正味の流束であり、J = −D ∂C/∂x は統計の結果である(§5.1)。
 *
 * 実装方式: 2D / onFrame + fixedStep。位置は Float64Array、粒子は 1 パスで
 * まとめ描き(母体仕様 §8.3)。粒子数は画面幅で自動スケール。
 * 簡略化(図注): 2D・格子上の 4 方向跳躍・粒子数は数百個・壁は反射・
 * 時間は強く加速している。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { clamp, mulberry32 } from "../../core/mathx";
import {
  type Pane,
  dashedLine,
  drawAtoms,
  drawRing,
  font,
  linTicks,
  outlinedText,
  paneFrame,
  resolvePalette,
} from "./lib/draw";
import { stepProfile } from "./lib/diffusion";

/** 乱数シード(reset で完全に同じ初期配置へ — 母体仕様 §8.2) */
const SEED = 19470601;
/** 粒子数の下限・上限(画面幅で自動スケール — §8.3) */
const COUNT_MIN = 360;
const COUNT_MAX = 900;
/** 箱の半幅を 1 とした跳躍距離 ℓ */
const STEP_LEN = 0.018;
/** 固定タイムステップ [ms] */
const STEP_MS = 16;
/** 時間の進み(1 tick あたりの跳躍回数) */
type SpeedValue = "1" | "4" | "16";
const SPEED_INIT: SpeedValue = "4";
/** 濃度プロファイルのビン数 */
const BINS = 24;
/** 通過数の集計窓 [s](表示のちらつきを抑える) */
const CROSS_WINDOW_S = 0.5;
/** 追跡粒子の軌跡の点数と間引き(跳躍何回ごとに 1 点残すか) */
const TRAIL_LEN = 90;
const TRAIL_EVERY = 2;
/** 粒子の描画半径 [px] */
const DOT_R = 2.4;

export default function randomWalk(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /* ---- 状態 ---- */

  let count = COUNT_MAX;
  const px = new Float64Array(COUNT_MAX);
  const py = new Float64Array(COUNT_MAX);
  const x0 = new Float64Array(COUNT_MAX);
  /** 描画用のスクリーン座標バッファ(毎フレームの割当てを避ける) */
  const sx = new Float64Array(COUNT_MAX);
  const sy = new Float64Array(COUNT_MAX);
  const bins = new Float64Array(BINS);
  const trailX = new Float64Array(TRAIL_LEN);
  const trailY = new Float64Array(TRAIL_LEN);
  let trailCount = 0;
  let trailHead = 0;

  let rand = mulberry32(SEED);
  let speed = Number(SPEED_INIT);
  let showTheory = false;
  let showTracked = true;
  /** 1 粒子あたりの跳躍回数 */
  let hops = 0;
  /** 箱の縦半幅(ステージのアスペクトから決める。1 = 箱の横半幅) */
  let halfY = 0.32;
  /** 通過数(集計中・表示中) */
  let crossRight = 0;
  let crossLeft = 0;
  let shownRight = 0;
  let shownLeft = 0;
  let crossClock = 0;

  /** 画面幅に応じた粒子数(§8.3) */
  function targetCount(): number {
    return Math.round(clamp(host.size.w * 1.2, COUNT_MIN, COUNT_MAX));
  }

  /** 箱の縦横比をステージの縦横比に合わせる(等方的な跳躍を保つため) */
  function syncBox(): void {
    const p = layout().stage;
    const hy = p.h / p.w;
    if (Math.abs(hy - halfY) > 1e-9) {
      halfY = hy;
      for (let i = 0; i < count; i++) py[i] = clamp(py[i], -halfY, halfY);
    }
  }

  function initParticles(): void {
    rand = mulberry32(SEED);
    count = targetCount();
    halfY = layout().stage.h / layout().stage.w;
    for (let i = 0; i < count; i++) {
      // 左半分(x < 0)に一様分布
      px[i] = -1 + rand() * 1;
      py[i] = (rand() * 2 - 1) * halfY;
      x0[i] = px[i];
    }
    hops = 0;
    crossRight = 0;
    crossLeft = 0;
    shownRight = 0;
    shownLeft = 0;
    crossClock = 0;
    trailCount = 0;
    trailHead = 0;
  }

  /** 1 跳躍: 全粒子が 4 方向から等確率に 1 つ選んで動く(バイアスなし) */
  function hopAll(): void {
    for (let i = 0; i < count; i++) {
      const dir = Math.floor(rand() * 4);
      let x = px[i];
      let y = py[i];
      const before = x;
      if (dir === 0) x += STEP_LEN;
      else if (dir === 1) x -= STEP_LEN;
      else if (dir === 2) y += STEP_LEN;
      else y -= STEP_LEN;
      // 壁は反射
      if (x > 1) x = 2 - x;
      else if (x < -1) x = -2 - x;
      if (y > halfY) y = 2 * halfY - y;
      else if (y < -halfY) y = -2 * halfY - y;
      // 中央面(x = 0)の通過を左右別に数える
      if (before < 0 && x >= 0) crossRight++;
      else if (before >= 0 && x < 0) crossLeft++;
      px[i] = x;
      py[i] = y;
    }
    hops++;
    if (hops % TRAIL_EVERY === 0) {
      trailX[trailHead] = px[0];
      trailY[trailHead] = py[0];
      trailHead = (trailHead + 1) % TRAIL_LEN;
      if (trailCount < TRAIL_LEN) trailCount++;
    }
  }

  /** 実測の平均二乗変位 ⟨Δx²⟩ */
  function measuredMsd(): number {
    let s = 0;
    for (let i = 0; i < count; i++) {
      const d = px[i] - x0[i];
      s += d * d;
    }
    return s / count;
  }

  /** 理論の Dt(2D 格子ランダムウォーク: Dt = ℓ²n/4) */
  function dTimesT(): number {
    return (STEP_LEN * STEP_LEN * hops) / 4;
  }

  /* ---- 操作部品(§7.2) ---- */

  const speedSeg = host.controls.segmented<SpeedValue>({
    id: "speed",
    label: "時間の進み",
    options: [
      { value: "1", label: "×1" },
      { value: "4", label: "×4" },
      { value: "16", label: "×16" },
    ],
    value: SPEED_INIT,
  });
  speedSeg.onChange((v) => {
    speed = Number(v);
  });

  const theoryToggle = host.controls.toggle({
    id: "theory",
    label: "誤差関数の曲線を重ねる",
    value: false,
  });
  theoryToggle.onChange((v) => {
    showTheory = v;
  });

  const trackToggle = host.controls.toggle({
    id: "track",
    label: "1 個を追跡",
    value: true,
  });
  trackToggle.onChange((v) => {
    showTracked = v;
  });

  host.controls.playPause();
  host.controls.reset(() => {
    speedSeg.set(SPEED_INIT);
    theoryToggle.set(false);
    trackToggle.set(true);
    initParticles();
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
    const gap = narrow ? 10 : 14;
    const plotH = Math.max(70, Math.min(150, h * 0.34));
    const stageH = h - top - gap - plotH - pad;
    return {
      stage: { x: pad, y: top, w: w - 2 * pad, h: stageH },
      plot: { x: pad, y: top + stageH + gap, w: w - 2 * pad, h: plotH },
      readoutY: pad,
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function drawReadouts(y: number, narrow: boolean): void {
    const { w } = host.size;
    const size = narrow ? 11 : 12.5;
    ctx.font = font(size);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const rms = Math.sqrt(measuredMsd());
    const theory = Math.sqrt(2 * dTimesT());
    const parts: Array<[string, string]> = [
      [`跳躍 ${hops} 回`, pal.text],
      [
        `にじみ幅 √⟨Δx²⟩ = ${rms.toFixed(3)}(理論 √2Dt = ${theory.toFixed(3)})`,
        pal.text2,
      ],
      [
        `中央面の通過: 右へ ${shownRight} / 左へ ${shownLeft} → 差 ${shownRight - shownLeft}`,
        pal.text,
      ],
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
      x += tw + (narrow ? 12 : 20);
    }
  }

  function drawStage(p: Pane): void {
    paneFrame(ctx, p, pal.hairline);
    const scaleX = p.w / 2;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();

    // 中央面
    dashedLine(ctx, cx, p.y + 2, cx, p.y + p.h - 2, pal.hairline, [5, 4]);

    // 粒子(1 パスでまとめ描き — §8.3)
    for (let i = 0; i < count; i++) {
      sx[i] = cx + px[i] * scaleX;
      sy[i] = cy - py[i] * scaleX;
    }
    drawAtoms(ctx, sx, sy, count, DOT_R, pal.second, pal.secondEdge);

    // 追跡粒子の軌跡とリング
    if (showTracked) {
      if (trailCount > 1) {
        ctx.strokeStyle = pal.accent;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < trailCount; k++) {
          const idx = (trailHead - trailCount + k + TRAIL_LEN * 2) % TRAIL_LEN;
          const tx = cx + trailX[idx] * scaleX;
          const ty = cy - trailY[idx] * scaleX;
          if (k === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      drawRing(
        ctx,
        cx + px[0] * scaleX,
        cy - py[0] * scaleX,
        DOT_R + 3.5,
        pal.accent,
      );
    }

    ctx.font = font(11);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    outlinedText(ctx, "← 濃い側", p.x + 6, p.y + 5, pal.text2, pal.bg);
    ctx.textAlign = "right";
    outlinedText(ctx, "薄い側 →", p.x + p.w - 6, p.y + 5, pal.text2, pal.bg);
    ctx.restore();
    ctx.textAlign = "left";
  }

  function drawPlot(p: Pane): void {
    // ヒストグラム(初期の左半分の密度を 1 とする)
    bins.fill(0);
    for (let i = 0; i < count; i++) {
      const b = clamp(Math.floor(((px[i] + 1) / 2) * BINS), 0, BINS - 1);
      bins[b]++;
    }
    const norm = count / (BINS / 2);
    const axisX = p.x + 26;
    const plotW = p.w - (axisX - p.x) - 6;
    const yTop = p.y + 12;
    const yBot = p.y + p.h - 14;
    const cMax = 1.25;
    const mapC = (c: number): number => yBot - ((yBot - yTop) * c) / cMax;
    const mapX = (x: number): number => axisX + ((x + 1) / 2) * plotW;

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
    for (const v of linTicks(0, 1, 2)) {
      const y = mapC(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(v.toFixed(1), axisX - 5, y);
    }

    // ビンの塗り
    const bw = plotW / BINS;
    ctx.fillStyle = pal.second;
    ctx.globalAlpha = 0.55;
    for (let b = 0; b < BINS; b++) {
      const c = bins[b] / norm;
      const y = mapC(Math.min(c, cMax));
      ctx.fillRect(axisX + b * bw + 0.5, y, bw - 1, yBot - y);
    }
    ctx.globalAlpha = 1;

    // 初期の段差(薄線)
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mapX(-1), mapC(1));
    ctx.lineTo(mapX(0), mapC(1));
    ctx.lineTo(mapX(0), mapC(0));
    ctx.lineTo(mapX(1), mapC(0));
    ctx.stroke();

    // 理論曲線(誤差関数)
    if (showTheory) {
      const dt = dTimesT();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 120; k++) {
        const x = -1 + (2 * k) / 120;
        const c = stepProfile(x, dt);
        const sxp = mapX(x);
        const syp = mapC(c);
        if (k === 0) ctx.moveTo(sxp, syp);
        else ctx.lineTo(sxp, syp);
      }
      ctx.stroke();
    }

    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("濃度 C/C₀", axisX + 2, p.y);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("位置 x", axisX + plotW / 2, yBot + 2);
    ctx.textAlign = "left";
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    syncBox();
    drawStage(l.stage);
    drawPlot(l.plot);
    drawReadouts(l.readoutY, l.narrow);
  }

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    syncBox();
    stepper(dt, (h) => {
      for (let s = 0; s < speed; s++) hopAll();
      crossClock += h;
      if (crossClock >= CROSS_WINDOW_S) {
        shownRight = crossRight;
        shownLeft = crossLeft;
        crossRight = 0;
        crossLeft = 0;
        crossClock = 0;
      }
    });
    draw();
  });
  host.onRender(draw);

  initParticles();

  return {
    resize(): void {
      // 画面幅が大きく変わったときだけ粒子数を作り直す(§8.3 の自動スケール。
      // 微小なリサイズで進行中の歩みを巻き戻さないよう 20% の余裕を持たせる)
      const want = targetCount();
      if (Math.abs(want - count) > count * 0.2) initParticles();
      else syncBox();
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし(操作は controls 経由のみ) */
    },
  };
}
