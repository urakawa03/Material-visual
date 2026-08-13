/**
 * standing-waves.ts — 図3「2 つの定在波 — 隙間の正体」(仕様書 11 §5.3)
 *
 * 記事の山場。ゾーン境界 k = π/a では右向きと左向きの進行波が同じ重みで
 * 混ざるので、定在波が 2 通り作れる:
 *
 *   cos 型 ψ ∝ cos(πx/a): 電子密度の腹が原子核の上 → 引力を強く感じる → 低い
 *   sin 型 ψ ∝ sin(πx/a): 節が原子核の上          → 感じにくい       → 高い
 *
 * 同じ k なのにエネルギーが 2 通りある。その差 2|V₁| がバンドギャップである。
 *
 * 簡略化(図注に明示): 波動関数は平面波 2 個の重ね合わせ(最低次)で描いた
 * 近似であり、弱いポテンシャルでの姿である。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawCurve,
  drawGapMarks,
  drawLevelLine,
  formatEv,
  PLOT_FONT,
  PLOT_FONT_SMALL,
  setPlotRange,
  withPlotClip,
} from "../_shared/banddiagram";
import { DEFAULT_A, DEFAULT_B, HBAR2_OVER_2M } from "./lib/constants";
import { standingWaveEnergies, type KPParams } from "./lib/kronig-penney";

/** 実空間の表示範囲(周期の数) */
const CELLS = 5;
/** 余白(px)。狭い画面では段のラベルを記号だけにして左余白を詰める */
const MARGIN_LEFT = 112;
const MARGIN_LEFT_NARROW = 46;
const MARGIN_RIGHT = 76;
const MARGIN_TOP = 14;
const MARGIN_BOTTOM = 16;
/** 3 段(波動関数 / 電子密度 / エネルギー)の高さの割合 */
const ROW_WAVE = 0.36;
const ROW_DENSITY = 0.3;
const ROW_GAP_PX = 10;
/** 曲線のサンプル点数 */
const SAMPLES = 401;
const SAMPLES_NARROW = 201;
const NARROW_WIDTH_PX = 480;
/** 原子の見た目半径(px) */
const ATOM_RADIUS_PX = 5;
/** 障壁の塗りの不透明度 */
const BARRIER_ALPHA = 0.16;
/** 電子密度の塗りの不透明度 */
const DENSITY_ALPHA = 0.22;

/** ポテンシャルの強さ U₀ スライダー(§5.3 の表) */
const U0_MIN = 0;
const U0_MAX = 8;
const U0_STEP = 0.1;
const U0_INIT = 4;
/** エネルギー段の表示幅(±。U₀ 最大でも収まるように取る) */
const E_HALF_RANGE = 2.4;

type WaveMode = "both" | "cos" | "sin";

export default function standingWaves(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = bandColors();
  const waveMap = createPlotMapper();
  const densityMap = createPlotMapper();
  const energyMap = createPlotMapper();

  /* ---- 状態 ---- */
  const params: KPParams = { a: DEFAULT_A, b: DEFAULT_B, u0: U0_INIT };
  let mode: WaveMode = "both";
  let showDensity = true;

  /* ---- 使い回すバッファ ---- */
  const xs = new Float64Array(SAMPLES);
  const ys = new Float64Array(SAMPLES);

  const xMax = CELLS * params.a;
  /** 端の原子が枠に触れないよう、表示範囲を左右にわずかに広げる [nm] */
  const X_PAD = 0.06;
  /** ゾーン境界での自由電子エネルギー E₀(2 つの準位はこれを挟む) */
  const e0 = HBAR2_OVER_2M * (Math.PI / params.a) ** 2;

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  /** 原子核(井戸の中心)の位置 [nm] */
  function atomX(i: number): number {
    return i * params.a;
  }

  /** 上 2 段に共通の縦補助線(原子核の位置)を引く */
  function drawAtomGuides(yTop: number, yBottom: number): void {
    ctx.save();
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (let i = 0; i <= CELLS; i++) {
      const px = waveMap.toPxX(atomX(i));
      ctx.moveTo(px, yTop);
      ctx.lineTo(px, yBottom);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 障壁(井戸と井戸のあいだ)を薄く塗る */
  function drawBarriers(yTop: number, height: number): void {
    ctx.save();
    ctx.globalAlpha = BARRIER_ALPHA * (params.u0 / U0_MAX);
    ctx.fillStyle = colors.matrix;
    for (let i = 0; i < CELLS; i++) {
      const center = atomX(i) + params.a / 2;
      const x0 = waveMap.toPxX(center - params.b / 2);
      const x1 = waveMap.toPxX(center + params.b / 2);
      ctx.fillRect(x0, yTop, x1 - x0, height);
    }
    ctx.restore();
  }

  /** 原子核を描く(井戸の中心 = 引力が強い場所) */
  function drawAtoms(py: number): void {
    ctx.save();
    ctx.fillStyle = colors.matrix;
    ctx.strokeStyle = colors.recip;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= CELLS; i++) {
      const px = waveMap.toPxX(atomX(i));
      ctx.moveTo(px + ATOM_RADIUS_PX, py);
      ctx.arc(px, py, ATOM_RADIUS_PX, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** 波動関数(または電子密度)を 1 本描く */
  function plotWave(
    mapper: ReturnType<typeof createPlotMapper>,
    n: number,
    f: (x: number) => number,
    dashed: boolean,
    fill: boolean,
  ): void {
    for (let i = 0; i < n; i++) {
      const x = (xMax * i) / (n - 1);
      xs[i] = x;
      ys[i] = f(x);
    }
    if (fill) {
      ctx.save();
      ctx.globalAlpha = DENSITY_ALPHA;
      ctx.fillStyle = colors.electron;
      ctx.beginPath();
      ctx.moveTo(mapper.toPxX(xs[0]), mapper.toPxY(0));
      for (let i = 0; i < n; i++) {
        ctx.lineTo(mapper.toPxX(xs[i]), mapper.toPxY(ys[i]));
      }
      ctx.lineTo(mapper.toPxX(xs[n - 1]), mapper.toPxY(0));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    drawCurve(ctx, mapper, xs, ys, n, {
      color: colors.electron,
      width: dashed ? 1.8 : 2.4,
      dash: dashed ? [7, 5] : undefined,
      alpha: dashed ? 0.85 : 1,
    });
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const narrow = w < NARROW_WIDTH_PX;
    const marginLeft = narrow ? MARGIN_LEFT_NARROW : MARGIN_LEFT;
    const plotW = w - marginLeft - MARGIN_RIGHT;
    const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
    const waveH = plotH * ROW_WAVE - ROW_GAP_PX;
    const densityH = plotH * ROW_DENSITY - ROW_GAP_PX;
    const energyH = plotH - waveH - densityH - ROW_GAP_PX * 2;
    const waveY = MARGIN_TOP;
    const densityY = waveY + waveH + ROW_GAP_PX;
    const energyY = densityY + densityH + ROW_GAP_PX;

    setPlotRange(
      waveMap,
      marginLeft,
      waveY,
      plotW,
      waveH,
      -X_PAD,
      xMax + X_PAD,
      -1.7,
      1.7,
    );
    setPlotRange(
      densityMap,
      marginLeft,
      densityY,
      plotW,
      densityH,
      -X_PAD,
      xMax + X_PAD,
      0,
      2.4,
    );
    setPlotRange(
      energyMap,
      marginLeft,
      energyY,
      plotW,
      energyH,
      -X_PAD,
      xMax + X_PAD,
      e0 - E_HALF_RANGE,
      e0 + E_HALF_RANGE,
    );

    const n = sampleCount();
    const showCos = mode !== "sin";
    const showSin = mode !== "cos";
    const k = Math.PI / params.a;

    /* ---- 上段: 波動関数 ---- */
    drawBarriers(waveY, waveH + ROW_GAP_PX + densityH);
    drawAtomGuides(waveY, densityY + densityH);
    // ψ = 0 の基準線
    ctx.save();
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginLeft, waveMap.toPxY(0));
    ctx.lineTo(marginLeft + plotW, waveMap.toPxY(0));
    ctx.stroke();
    ctx.restore();

    withPlotClip(ctx, waveMap, () => {
      if (showCos) {
        plotWave(waveMap, n, (x) => Math.SQRT2 * Math.cos(k * x), false, false);
      }
      if (showSin) {
        plotWave(waveMap, n, (x) => Math.SQRT2 * Math.sin(k * x), true, false);
      }
    });

    /* ---- 中段: 電子密度 ---- */
    withPlotClip(ctx, densityMap, () => {
      if (showDensity) {
        if (showCos) {
          plotWave(densityMap, n, (x) => 1 + Math.cos(2 * k * x), false, true);
        }
        if (showSin) {
          plotWave(densityMap, n, (x) => 1 - Math.cos(2 * k * x), true, false);
        }
      }
    });
    // 原子核は電子密度の基準線の上に置く(腹・節との関係を読ませる)
    drawAtoms(densityMap.toPxY(0));

    /* ---- 下段: 2 つの準位とギャップ ---- */
    const { eCos, eSin, gap } = standingWaveEnergies(params);
    if (gap > 0.02) {
      drawGapMarks(ctx, energyMap, xMax * 0.62, xMax * 0.86, eCos, eSin, {
        colors,
        label: `ギャップ ${gap.toFixed(2)} eV`,
      });
    }
    drawLevelLine(ctx, energyMap, 0, xMax, eCos, {
      colors,
      dashed: false,
      width: 2.4,
      label: `cos 型  ${formatEv(eCos)}`,
    });
    drawLevelLine(ctx, energyMap, 0, xMax, eSin, {
      colors,
      dashed: true,
      width: 2,
      label: `sin 型  ${formatEv(eSin)}`,
    });

    /* ---- 段のラベル ---- */
    ctx.save();
    ctx.font = PLOT_FONT;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(
      narrow ? "ψ" : "波動関数 ψ",
      marginLeft - 8,
      waveY + waveH / 2,
    );
    ctx.fillText(
      narrow ? "|ψ|²" : "電子密度 |ψ|²",
      marginLeft - 8,
      densityY + densityH / 2,
    );
    ctx.fillText(
      narrow ? "E" : "エネルギー",
      marginLeft - 8,
      energyY + energyH / 2,
    );
    ctx.font = PLOT_FONT_SMALL;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("● 原子核", marginLeft + plotW + 8, densityMap.toPxY(0) - 6);
    ctx.restore();

    eCosItem.set(formatEv(eCos));
    eSinItem.set(formatEv(eSin));
    gapItem.set(formatEv(gap));
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const eCosItem = readout.item("E₋(cos 型)", { color: "electron" });
  const eSinItem = readout.item("E₊(sin 型)", { color: "electron" });
  const gapItem = readout.item("ギャップ 2|V₁|");

  const u0Slider = host.controls.slider({
    id: "u0",
    label: "ポテンシャルの強さ U₀",
    min: U0_MIN,
    max: U0_MAX,
    step: U0_STEP,
    value: U0_INIT,
    unit: "eV",
  });
  u0Slider.onChange((v) => {
    params.u0 = v;
  });

  const modeSeg = host.controls.segmented<WaveMode>({
    id: "mode",
    label: "表示する波",
    options: [
      { value: "both", label: "両方" },
      { value: "cos", label: "cos 型" },
      { value: "sin", label: "sin 型" },
    ],
    value: "both",
  });
  modeSeg.onChange((v) => {
    mode = v;
  });

  const densityToggle = host.controls.toggle({
    id: "density",
    label: "電子密度を表示",
    value: true,
  });
  densityToggle.onChange((v) => {
    showDensity = v;
  });

  host.controls.reset(() => {
    u0Slider.set(U0_INIT);
    modeSeg.set("both");
    densityToggle.set(true);
    params.u0 = U0_INIT;
    mode = "both";
    showDensity = true;
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
