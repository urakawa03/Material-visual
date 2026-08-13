/**
 * bragg-reflection-gap.ts — 図2「ゾーン境界でギャップが開く」(仕様書 11 §5.2)
 *
 * 図1 の放物線に周期ポテンシャルを少しずつ入れていくと、ブリルアンゾーン
 * 境界 k = ±π/a で曲線が割れる。モデルは図4 と同じクローニッヒ・ペニー模型で、
 * 周期 a と障壁幅 b は固定し、高さ U₀ だけを動かす。U₀ = 0 では自由電子の
 * 放物線(ゴースト)と完全に重なることが出発点である。
 *
 * 簡略化(図注に明示): 1 次元の理想模型。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawCurve,
  drawGapMarks,
  drawPlotFrame,
  drawZoneBoundary,
  formatEv,
  formatK,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { DEFAULT_A, DEFAULT_B, freeElectronEnergy } from "./lib/constants";
import { findBands, type Band, type KPParams } from "./lib/kronig-penney";
import { createCurveBuffer, fillExtendedSegment } from "./lib/curves";

/** 表示範囲(横軸は ±3π/a、縦軸は 0〜8 eV) */
const ZONES = 3;
const E_MAX = 8;
/** バンド計算の上限。表示範囲より十分に広く取る(§5.4) */
const E_SCAN_MAX = 40;
/** 余白(px) */
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 18;
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 48;
/** 1 ゾーンあたりのサンプル点数 */
const SAMPLES = 121;
const SAMPLES_NARROW = 61;
const NARROW_WIDTH_PX = 480;
/** ギャップの寸法線を描く最小の幅 [eV](これ未満は目盛りを描かない) */
const MIN_DRAWN_GAP = 0.05;
/** ギャップ寸法線の横幅(ゾーン幅に対する割合) */
const GAP_MARK_HALF = 0.16;

/** ポテンシャルの強さ U₀ スライダー(§5.2 の表) */
const U0_MIN = 0;
const U0_MAX = 8;
const U0_STEP = 0.1;
const U0_INIT = 0;

/** 横軸の目盛りラベル(±nπ/a。マイナスは全角の − を使う) */
function zoneLabel(n: number): string {
  if (n === 0) return "0";
  const sign = n < 0 ? "−" : "";
  const mag = Math.abs(n) === 1 ? "" : String(Math.abs(n));
  return `${sign}${mag}π/a`;
}

export default function braggReflectionGap(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = bandColors();
  const mapper = createPlotMapper();

  /* ---- 状態 ---- */
  const params: KPParams = { a: DEFAULT_A, b: DEFAULT_B, u0: U0_INIT };
  /** 周期 a は固定なので、ゾーン境界の目盛りは 1 度だけ作る */
  const boundary = Math.PI / params.a;
  const kMax = ZONES * boundary;
  const xTicks: AxisTick[] = [];
  for (let z = -ZONES; z <= ZONES; z++) {
    xTicks.push({ value: z * boundary, label: zoneLabel(z) });
  }
  let showFree = true;
  let bands: Band[] = [];

  /* ---- 使い回すバッファ ---- */
  const curve = createCurveBuffer(SAMPLES);
  const freeK = new Float64Array(SAMPLES * ZONES);
  const freeE = new Float64Array(SAMPLES * ZONES);

  /** U₀ を変えたときだけバンドを計算し直す(操作中も 60fps を保つ) */
  function recompute(): void {
    bands = findBands(params, ZONES + 1, E_SCAN_MAX);
  }
  recompute();

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    setPlotRange(
      mapper,
      MARGIN_LEFT,
      MARGIN_TOP,
      w - MARGIN_LEFT - MARGIN_RIGHT,
      h - MARGIN_TOP - MARGIN_BOTTOM,
      -kMax,
      kMax,
      0,
      E_MAX,
    );

    // 狭い画面では ±2π/a のラベルを省いて重なりを避ける(目盛り線は残す)
    const narrow = w < NARROW_WIDTH_PX;
    for (let i = 0; i < xTicks.length; i++) {
      const z = i - ZONES;
      xTicks[i].label = narrow && Math.abs(z) === 2 ? undefined : zoneLabel(z);
    }
    drawPlotFrame(ctx, mapper, {
      colors,
      xTicks,
      yTicks: [
        { value: 0, label: "0" },
        { value: 2, label: "2" },
        { value: 4, label: "4" },
        { value: 6, label: "6" },
        { value: 8, label: "8" },
      ],
      xLabel: "波数 k",
      yLabel: "エネルギー E [eV]",
      yAxisAtZero: true,
    });

    const n = sampleCount();

    withPlotClip(ctx, mapper, () => {
      // 自由電子の放物線(ゴースト)
      if (showFree) {
        const total = n * ZONES;
        for (let i = 0; i < total; i++) {
          const k = -kMax + (2 * kMax * i) / (total - 1);
          freeK[i] = k;
          freeE[i] = freeElectronEnergy(k);
        }
        drawCurve(ctx, mapper, freeK, freeE, total, {
          color: colors.hairline,
          width: 2.5,
        });
      }

      // ゾーン境界(位置のラベルは横軸の目盛りが持つ)
      for (let z = 1; z <= ZONES; z++) {
        drawZoneBoundary(ctx, mapper, z * boundary, { colors });
        drawZoneBoundary(ctx, mapper, -z * boundary, { colors });
      }

      // 各ゾーンのバンド(拡張ゾーン表示)
      for (let z = 1; z <= ZONES && z <= bands.length; z++) {
        for (const sign of [1, -1] as const) {
          fillExtendedSegment(curve, n, bands[z - 1], params, z, sign);
          drawCurve(ctx, mapper, curve.k, curve.e, curve.count, {
            color: colors.level,
            width: 2.4,
          });
        }
      }

      // ゾーン境界のギャップに寸法線を付ける
      for (let z = 1; z < bands.length && z <= ZONES; z++) {
        const gap = bands[z].eLow - bands[z - 1].eHigh;
        if (gap < MIN_DRAWN_GAP || bands[z - 1].eHigh > E_MAX) continue;
        const half = GAP_MARK_HALF * boundary;
        for (const sign of [1, -1] as const) {
          const center = sign * z * boundary;
          drawGapMarks(
            ctx,
            mapper,
            center - half,
            center + half,
            bands[z - 1].eHigh,
            bands[z].eLow,
            { colors, label: sign > 0 ? `${gap.toFixed(2)} eV` : undefined },
          );
        }
      }
    });

    gap1Item.set(
      bands.length > 1 ? formatEv(bands[1].eLow - bands[0].eHigh) : "—",
    );
    gap2Item.set(
      bands.length > 2 ? formatEv(bands[2].eLow - bands[1].eHigh) : "—",
    );
    boundaryItem.set(formatK(boundary));
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const gap1Item = readout.item("第1ギャップ");
  const gap2Item = readout.item("第2ギャップ");
  const boundaryItem = readout.item("ゾーン境界 π/a", { color: "recip" });

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
    recompute();
  });

  const freeToggle = host.controls.toggle({
    id: "free",
    label: "自由電子の放物線を重ねる",
    value: true,
  });
  freeToggle.onChange((v) => {
    showFree = v;
  });

  host.controls.reset(() => {
    u0Slider.set(U0_INIT);
    freeToggle.set(true);
    params.u0 = U0_INIT;
    showFree = true;
    recompute();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
