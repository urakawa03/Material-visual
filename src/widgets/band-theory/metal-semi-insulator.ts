/**
 * metal-semi-insulator.ts — 図6「3 つに分かれる」(仕様書 11 §5.6)
 *
 * 図4 と同じバンド(クローニッヒ・ペニー模型)を、価電子数で埋めていく。
 * 1 次元では 1 バンドに 1 原子あたり 2 個(スピン 2 重)入るので、
 *
 *   価電子数が奇数 → 途中まで埋まる → すぐ上に空席がある → 金属
 *   価電子数が偶数 → 埋まりきる     → 隙間の大きさが効く → 半導体 / 絶縁体
 *
 * 「通す / 通さない」は電子の数ではなく**空席の有無**で決まる、が主題である。
 *
 * 簡略化(図注に明示): 1 次元。半導体と絶縁体の境界(3 eV)は表示上の便宜で
 * あって定義ではない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout, createStepper } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawBandBox,
  drawCurve,
  drawElectronDots,
  drawGapMarks,
  drawLevelLine,
  drawPlotFrame,
  formatEv,
  PLOT_FONT_SMALL,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import {
  DEFAULT_A,
  DEFAULT_B,
  DEFAULT_U0,
  KB_EV,
  ROOM_TEMPERATURE,
} from "./lib/constants";
import {
  bandEnergyAt,
  fillingForValence,
  findBands,
  type Band,
  type KPParams,
} from "./lib/kronig-penney";
import { createCurveBuffer, fillReducedBand } from "./lib/curves";

/** 表示範囲 */
const E_MAX = 12;
const E_SCAN_MAX = 45;
const N_BANDS = 4;
/** 余白(px) */
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 14;
const MARGIN_TOP = 14;
const MARGIN_BOTTOM = 46;
/** 右の E 軸帯 */
const STRIP_WIDTH = 110;
const STRIP_GAP_PX = 26;
/** サンプル点数 */
const SAMPLES = 161;
const SAMPLES_NARROW = 81;
const NARROW_WIDTH_PX = 480;
/** 占有バンドに並べる電子の数(バンド 1 本あたり・満杯時) */
const DOTS_PER_BAND = 11;
/** 空席として描く丸の数 */
const EMPTY_DOTS = 4;
/** 半導体 / 絶縁体の表示上の境界 [eV](定義ではない — §5.6) */
const INSULATOR_GAP = 3;
/** ギャップの寸法線を描く最小幅 [eV] */
const MIN_DRAWN_GAP = 0.05;

/** 価電子数ステッパと U₀ スライダー(§5.6 の表) */
const Z_MIN = 1;
const Z_MAX = 4;
const Z_INIT = 1;
const U0_MIN = 0;
const U0_MAX = 10;
const U0_STEP = 0.1;

const X_TICKS: readonly AxisTick[] = [
  { value: -1, label: "−π/a" },
  { value: 0, label: "0" },
  { value: 1, label: "π/a" },
];

export default function metalSemiInsulator(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = bandColors();
  const ekMap = createPlotMapper();
  const stripMap = createPlotMapper();

  /* ---- 状態 ---- */
  const params: KPParams = { a: DEFAULT_A, b: DEFAULT_B, u0: DEFAULT_U0 };
  let valence = Z_INIT;
  let showEmpty = true;
  let bands: Band[] = [];

  /* ---- 使い回すバッファ ---- */
  const curve = createCurveBuffer(SAMPLES);
  const dotK = new Float64Array(DOTS_PER_BAND + EMPTY_DOTS);
  const dotE = new Float64Array(DOTS_PER_BAND + EMPTY_DOTS);

  function recompute(): void {
    bands = findBands(params, N_BANDS, E_SCAN_MAX);
  }
  recompute();

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  /** 最高被占準位 [eV] と分類に必要な情報 */
  function occupancy(): {
    topLevel: number;
    metal: boolean;
    gap: number;
    fillPercent: number;
    partialBand: number;
    fraction: number;
    fullBands: number;
  } {
    const f = fillingForValence(valence);
    const boundary = Math.PI / params.a;
    if (f.partialBand >= 0 && f.partialBand < bands.length) {
      const kF = f.partialFraction * boundary;
      return {
        topLevel: bandEnergyAt(kF, bands[f.partialBand], params),
        metal: true,
        gap: 0,
        fillPercent: f.partialFraction * 100,
        partialBand: f.partialBand,
        fraction: f.partialFraction,
        fullBands: f.fullBands,
      };
    }
    const top = bands[f.fullBands - 1];
    const next = bands[f.fullBands];
    return {
      topLevel: top.eHigh,
      metal: false,
      gap: next ? next.eLow - top.eHigh : 0,
      fillPercent: 100,
      partialBand: -1,
      fraction: 1,
      fullBands: f.fullBands,
    };
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const boundary = Math.PI / params.a;
    const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
    const ekW = w - MARGIN_LEFT - MARGIN_RIGHT - STRIP_WIDTH - STRIP_GAP_PX;

    // 横軸は π/a を単位に取る(還元ゾーン表示)
    setPlotRange(ekMap, MARGIN_LEFT, MARGIN_TOP, ekW, plotH, -1, 1, 0, E_MAX);
    drawPlotFrame(ctx, ekMap, {
      colors,
      xTicks: X_TICKS,
      yTicks: [
        { value: 0, label: "0" },
        { value: 3, label: "3" },
        { value: 6, label: "6" },
        { value: 9, label: "9" },
        { value: 12, label: "12" },
      ],
      xLabel: "波数 k(第 1 ブリルアンゾーン)",
      yLabel: "エネルギー E [eV]",
      yAxisAtZero: true,
    });

    const occ = occupancy();
    const n = sampleCount();

    withPlotClip(ctx, ekMap, () => {
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        if (band.eLow > E_MAX) break;
        fillReducedBand(curve, n, band, params);
        // k を π/a 単位に直して描く
        for (let j = 0; j < curve.count; j++) curve.k[j] /= boundary;
        drawCurve(ctx, ekMap, curve.k, curve.e, curve.count, {
          color: colors.level,
          width: 2.2,
        });

        // 占有部分を電子色で太く重ねる
        const filled =
          i < occ.fullBands ? 1 : i === occ.partialBand ? occ.fraction : 0;
        if (filled > 0) {
          let count = 0;
          for (let j = 0; j < curve.count; j++) {
            if (Math.abs(curve.k[j]) <= filled + 1e-9) {
              curve.k[count] = curve.k[j];
              curve.e[count] = curve.e[j];
              count++;
            }
          }
          drawCurve(ctx, ekMap, curve.k, curve.e, count, {
            color: colors.electron,
            width: 3.6,
          });
          // 電子の丸(占有範囲に等間隔)
          const dots = Math.max(3, Math.round(DOTS_PER_BAND * filled));
          for (let j = 0; j < dots; j++) {
            const kk = -filled + (2 * filled * j) / (dots - 1);
            dotK[j] = kk;
            dotE[j] = bandEnergyAt(kk * boundary, band, params);
          }
          drawElectronDots(ctx, ekMap, dotK, dotE, dots, { colors });

          // 部分占有バンドのすぐ上の空席(金属の「空席」)
          if (showEmpty && i === occ.partialBand) {
            for (let j = 0; j < EMPTY_DOTS; j++) {
              const kk = filled + (j + 1) * 0.07;
              dotK[j] = Math.min(kk, 1);
              dotE[j] = bandEnergyAt(dotK[j] * boundary, band, params);
            }
            drawElectronDots(ctx, ekMap, dotK, dotE, EMPTY_DOTS, {
              colors,
              empty: true,
            });
          }
        }
      }

      drawLevelLine(ctx, ekMap, -1, 1, occ.topLevel, {
        colors,
        color: colors.electron,
        label: "最高被占準位",
      });
    });

    // 右: E 軸の帯
    setPlotRange(
      stripMap,
      MARGIN_LEFT + ekW + STRIP_GAP_PX,
      MARGIN_TOP,
      STRIP_WIDTH,
      plotH,
      0,
      1,
      0,
      E_MAX,
    );
    withPlotClip(ctx, stripMap, () => {
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        if (band.eLow > E_MAX) break;
        const filledTo =
          i < occ.fullBands
            ? band.eHigh
            : i === occ.partialBand
              ? occ.topLevel
              : undefined;
        drawBandBox(ctx, stripMap, 0, 1, band.eLow, band.eHigh, {
          colors,
          fillTo: filledTo,
        });
        if (i + 1 < bands.length && bands[i + 1].eLow < E_MAX) {
          const gap = bands[i + 1].eLow - band.eHigh;
          drawGapMarks(ctx, stripMap, 0, 1, band.eHigh, bands[i + 1].eLow, {
            colors,
            measure: gap >= MIN_DRAWN_GAP,
          });
        }
      }
      drawLevelLine(ctx, stripMap, 0, 1, occ.topLevel, {
        colors,
        color: colors.electron,
      });
    });
    ctx.save();
    ctx.font = PLOT_FONT_SMALL;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      "電子の詰まり方",
      stripMap.rect.x + stripMap.rect.w / 2,
      stripMap.rect.y + stripMap.rect.h + 6,
    );
    ctx.restore();

    // 読み取り値
    const kind = occ.metal
      ? "金属"
      : occ.gap >= INSULATOR_GAP
        ? "絶縁体"
        : "半導体";
    kindItem.set(kind);
    fillItem.set(`${occ.fillPercent.toFixed(0)} %`);
    gapItem.set(occ.metal ? "—(空席あり)" : formatEv(occ.gap));
    thermalItem.set(
      occ.metal
        ? "—"
        : Math.exp(-occ.gap / (2 * KB_EV * ROOM_TEMPERATURE)).toExponential(1),
    );
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const kindItem = readout.item("分類");
  const fillItem = readout.item("最高被占バンドの埋まり具合", {
    color: "electron",
  });
  const gapItem = readout.item("ギャップ");
  const thermalItem = readout.item("300 K で飛び越える割合の目安");

  const zStepper = createStepper(host, {
    label: "1 原子あたりの価電子数",
    min: Z_MIN,
    max: Z_MAX,
    value: Z_INIT,
    format: (v) => `${v} 個`,
  });
  zStepper.onChange((v) => {
    valence = v;
  });

  const u0Slider = host.controls.slider({
    id: "u0",
    label: "障壁の高さ U₀(ギャップの大きさ)",
    min: U0_MIN,
    max: U0_MAX,
    step: U0_STEP,
    value: DEFAULT_U0,
    unit: "eV",
  });
  u0Slider.onChange((v) => {
    params.u0 = v;
    recompute();
  });

  const emptyToggle = host.controls.toggle({
    id: "empty",
    label: "空席を示す",
    value: true,
  });
  emptyToggle.onChange((v) => {
    showEmpty = v;
  });

  host.controls.reset(() => {
    zStepper.set(Z_INIT);
    u0Slider.set(DEFAULT_U0);
    emptyToggle.set(true);
    valence = Z_INIT;
    params.u0 = DEFAULT_U0;
    showEmpty = true;
    recompute();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
      zStepper.el.remove();
    },
  };
}
