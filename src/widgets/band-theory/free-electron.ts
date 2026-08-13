/**
 * free-electron.ts — 図1「まず自由な電子から」(仕様書 11 §5.1)
 *
 * ポテンシャルがゼロの箱に入れた電子の E-k 図。放物線 E = ħ²k²/2m を描き、
 * |k| ≤ k_F の部分を電子で埋める。電子数密度 n を動かすと k_F = πn/2 と
 * E_F = ħ²k_F²/2m が連動する。**曲線に切れ目がない**ことがこの図の主題で、
 * 次節でゾーン境界に隙間が開くことと対比される。
 *
 * 簡略化(図注に明示): 1 次元。絶対零度の詰め方(フェルミ分布の階段極限)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawCurve,
  drawElectronDots,
  drawLevelLine,
  drawPlotFrame,
  formatEv,
  formatK,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { fermiWavenumber, freeElectronEnergy } from "./lib/constants";

/** 表示範囲 */
const K_MAX = 15; // nm⁻¹
const E_MAX = 8; // eV
/** 余白(px) */
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 18;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 48;
/** 曲線のサンプル点数(狭い画面では半分に落とす — §5.0) */
const SAMPLES = 241;
const SAMPLES_NARROW = 121;
const NARROW_WIDTH_PX = 480;
/** 占有部分に並べる電子の数(片側) */
const DOTS_PER_SIDE = 6;
/** 空席として描く丸の数(片側) */
const EMPTY_PER_SIDE = 3;
/** 空席を置く k 方向の間隔(k_F に対する割合) */
const EMPTY_STEP = 0.09;

/** 電子数密度 n スライダー(§5.1 の表) */
const N_MIN = 1;
const N_MAX = 8;
const N_STEP = 0.1;
const N_INIT = 4;

const X_TICKS: readonly AxisTick[] = [
  { value: -15, label: "−15" },
  { value: -10, label: "−10" },
  { value: -5, label: "−5" },
  { value: 0, label: "0" },
  { value: 5, label: "5" },
  { value: 10, label: "10" },
  { value: 15, label: "15" },
];
const Y_TICKS: readonly AxisTick[] = [
  { value: 0, label: "0" },
  { value: 2, label: "2" },
  { value: 4, label: "4" },
  { value: 6, label: "6" },
  { value: 8, label: "8" },
];

export default function freeElectron(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = bandColors();
  const mapper = createPlotMapper();

  /* ---- 状態 ---- */
  let density = N_INIT; // 電子数密度 [nm⁻¹]
  let showEmpty = true;

  /* ---- 使い回すバッファ(フレーム内の新規割当てを避ける — §8.3) ---- */
  const curveK = new Float64Array(SAMPLES);
  const curveE = new Float64Array(SAMPLES);
  const dotK = new Float64Array(DOTS_PER_SIDE * 2 + 1);
  const dotE = new Float64Array(DOTS_PER_SIDE * 2 + 1);
  const emptyK = new Float64Array(EMPTY_PER_SIDE * 2);
  const emptyE = new Float64Array(EMPTY_PER_SIDE * 2);

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
      -K_MAX,
      K_MAX,
      0,
      E_MAX,
    );
    drawPlotFrame(ctx, mapper, {
      colors,
      xTicks: X_TICKS,
      yTicks: Y_TICKS,
      xLabel: "波数 k [nm⁻¹]",
      yLabel: "エネルギー E [eV]",
      yAxisAtZero: true,
    });

    const kF = fermiWavenumber(density);
    const eF = freeElectronEnergy(kF);
    const n = sampleCount();

    withPlotClip(ctx, mapper, () => {
      // 放物線(全体)
      for (let i = 0; i < n; i++) {
        const k = -K_MAX + (2 * K_MAX * i) / (n - 1);
        curveK[i] = k;
        curveE[i] = freeElectronEnergy(k);
      }
      drawCurve(ctx, mapper, curveK, curveE, n, {
        color: colors.level,
        width: 2,
      });

      // 占有部分(|k| ≤ k_F)を電子色で太く重ねる
      for (let i = 0; i < n; i++) {
        const k = -kF + (2 * kF * i) / (n - 1);
        curveK[i] = k;
        curveE[i] = freeElectronEnergy(k);
      }
      drawCurve(ctx, mapper, curveK, curveE, n, {
        color: colors.electron,
        width: 3.5,
      });

      // フェルミ準位
      drawLevelLine(ctx, mapper, -K_MAX, K_MAX, eF, {
        colors,
        color: colors.electron,
        label: "E_F",
      });

      // 占有状態の電子(等間隔に並べる)
      let count = 0;
      for (let i = -DOTS_PER_SIDE; i <= DOTS_PER_SIDE; i++) {
        const k = (kF * i) / DOTS_PER_SIDE;
        dotK[count] = k;
        dotE[count] = freeElectronEnergy(k);
        count++;
      }
      drawElectronDots(ctx, mapper, dotK, dotE, count, { colors });

      // すぐ上の空席(電場で加速できる = S6 の伏線)
      if (showEmpty) {
        let e = 0;
        for (let i = 1; i <= EMPTY_PER_SIDE; i++) {
          const dk = kF * EMPTY_STEP * i;
          emptyK[e] = kF + dk;
          emptyE[e] = freeElectronEnergy(kF + dk);
          e++;
          emptyK[e] = -kF - dk;
          emptyE[e] = freeElectronEnergy(-kF - dk);
          e++;
        }
        drawElectronDots(ctx, mapper, emptyK, emptyE, e, {
          colors,
          empty: true,
        });
      }
    });

    kfItem.set(formatK(kF));
    efItem.set(formatEv(eF));
  }

  /* ---- 操作部品(§7.2) ---- */
  const readout = createReadout(host);
  const kfItem = readout.item("k_F", { color: "electron" });
  const efItem = readout.item("E_F", { color: "electron" });
  const gapItem = readout.item("隙間");
  gapItem.set("なし");

  const nSlider = host.controls.slider({
    id: "n",
    label: "電子の数(1 nm あたり)",
    min: N_MIN,
    max: N_MAX,
    step: N_STEP,
    value: N_INIT,
    unit: "nm⁻¹",
  });
  nSlider.onChange((v) => {
    density = v;
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
    nSlider.set(N_INIT);
    emptyToggle.set(true);
    density = N_INIT;
    showEmpty = true;
  });

  host.onRender(draw);

  return {
    // レイアウトは draw() が毎回計算するので resize は不要
    // (engine がリサイズ後に 1 フレーム描画する)
    destroy(): void {
      readout.el.remove();
    },
  };
}
