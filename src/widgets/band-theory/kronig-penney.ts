/**
 * kronig-penney.ts — 図4「模型で確かめる」(仕様書 11 §5.4・中心図版)
 *
 * 上帯: 周期ポテンシャル V(x)(高さ U₀・幅 b・周期 a)と原子核。
 * 左下: E-k 図(拡張ゾーン表示)。自由電子の放物線を重ねられる。
 * 右下: E 軸の帯。許容帯(--mat-band の塗り + バンド端線)と
 *       禁制帯(塗りなし + 破線)が交互に現れる。
 *
 * バンドは超越方程式 cos(ka) = f(E) を区間二分法で解いて得る(lib/kronig-penney.ts)。
 * U₀ → 0 で図1 の放物線に戻ることが、この図のいちばん大事な確認である。
 *
 * 簡略化(図注に明示): 1 次元の理想模型。実際の 3 次元結晶のバンドはこれより
 * 複雑で、対称点ごとに異なる(図7 と対比)。電子間相互作用は無視(1 電子近似)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawBandBox,
  drawCurve,
  drawGapMarks,
  drawPlotFrame,
  drawZoneBoundary,
  formatEv,
  formatK,
  PLOT_FONT_SMALL,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import {
  DEFAULT_A,
  DEFAULT_B,
  DEFAULT_U0,
  freeElectronEnergy,
} from "./lib/constants";
import { findBands, type Band, type KPParams } from "./lib/kronig-penney";
import { createCurveBuffer, fillExtendedSegment } from "./lib/curves";

/** 表示範囲 */
const ZONES = 3;
const E_MAX = 10;
const E_SCAN_MAX = 45;
/** 上帯(ポテンシャル)の高さの割合と、下段との隙間(px) */
const POTENTIAL_FRACTION = 0.26;
const ROW_GAP_PX = 16;
/** 右下の E 軸帯の幅(px) */
const STRIP_WIDTH = 96;
const STRIP_GAP_PX = 26;
/** 余白(px) */
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 14;
const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 46;
/** 1 ゾーンあたりのサンプル点数 */
const SAMPLES = 121;
const SAMPLES_NARROW = 61;
const NARROW_WIDTH_PX = 480;
/** ポテンシャル断面に描く周期の数 */
const POTENTIAL_CELLS = 4;
/** 原子の見た目半径(px) */
const ATOM_RADIUS_PX = 4.5;
/** ギャップの寸法線・ラベルを描く最小幅 [eV] */
const MIN_DRAWN_GAP = 0.05;

/** スライダー(§5.4 の表)。b < a が常に成り立つ範囲に取ってある */
const U0_MIN = 0;
const U0_MAX = 10;
const U0_STEP = 0.1;
const B_MIN = 0.02;
const B_MAX = 0.25;
const B_STEP = 0.01;
const A_MIN = 0.35;
const A_MAX = 0.8;
const A_STEP = 0.01;

/** 横軸の目盛りラベル(±nπ/a) */
function zoneLabel(n: number): string {
  if (n === 0) return "0";
  const sign = n < 0 ? "−" : "";
  const mag = Math.abs(n) === 1 ? "" : String(Math.abs(n));
  return `${sign}${mag}π/a`;
}

export default function kronigPenney(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = bandColors();
  const ekMap = createPlotMapper();
  const stripMap = createPlotMapper();
  const potMap = createPlotMapper();

  /* ---- 状態 ---- */
  const params: KPParams = { a: DEFAULT_A, b: DEFAULT_B, u0: DEFAULT_U0 };
  let showFree = true;
  let bands: Band[] = [];

  /* ---- 使い回すバッファ ---- */
  const curve = createCurveBuffer(SAMPLES);
  const freeK = new Float64Array(SAMPLES * ZONES);
  const freeE = new Float64Array(SAMPLES * ZONES);
  const xTicks: AxisTick[] = [];
  for (let z = -ZONES; z <= ZONES; z++)
    xTicks.push({ value: 0, label: zoneLabel(z) });

  function recompute(): void {
    bands = findBands(params, ZONES + 1, E_SCAN_MAX);
  }
  recompute();

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  /** 上帯: 周期ポテンシャルの断面と原子核・寸法ラベル */
  function drawPotential(): void {
    const span = POTENTIAL_CELLS * params.a;
    const baseY = potMap.toPxY(0);
    const topY = potMap.toPxY(params.u0);

    // 障壁の塗りと輪郭(井戸 = 0、障壁 = U₀ の階段)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(potMap.toPxX(0), baseY);
    for (let i = 0; i < POTENTIAL_CELLS; i++) {
      const center = (i + 0.5) * params.a;
      const x0 = potMap.toPxX(center - params.b / 2);
      const x1 = potMap.toPxX(center + params.b / 2);
      ctx.lineTo(x0, baseY);
      ctx.lineTo(x0, topY);
      ctx.lineTo(x1, topY);
      ctx.lineTo(x1, baseY);
    }
    ctx.lineTo(potMap.toPxX(span), baseY);
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = colors.matrix;
    for (let i = 0; i < POTENTIAL_CELLS; i++) {
      const center = (i + 0.5) * params.a;
      const x0 = potMap.toPxX(center - params.b / 2);
      const x1 = potMap.toPxX(center + params.b / 2);
      ctx.fillRect(x0, topY, x1 - x0, baseY - topY);
    }
    ctx.restore();

    // 原子核(井戸の中心)
    ctx.save();
    ctx.fillStyle = colors.matrix;
    ctx.strokeStyle = colors.recip;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= POTENTIAL_CELLS; i++) {
      const px = potMap.toPxX(i * params.a);
      ctx.moveTo(px + ATOM_RADIUS_PX, baseY);
      ctx.arc(px, baseY, ATOM_RADIUS_PX, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 寸法ラベル(a, b, U₀)
    ctx.save();
    ctx.font = PLOT_FONT_SMALL;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("a", potMap.toPxX(params.a * 0.5), baseY + 18);
    ctx.fillText("b", potMap.toPxX(params.a * 1.5), topY - 4);
    ctx.textAlign = "left";
    ctx.fillText(
      `U₀ = ${params.u0.toFixed(1)} eV`,
      potMap.toPxX(span) + 8,
      (baseY + topY) / 2,
    );
    // a の寸法線(原子 0 → 原子 1)
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(potMap.toPxX(0), baseY + 12);
    ctx.lineTo(potMap.toPxX(params.a), baseY + 12);
    ctx.stroke();
    ctx.restore();
  }

  /** 右下: E 軸の帯(許容帯 / 禁制帯) */
  function drawStrip(): void {
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      if (band.eLow > E_MAX) break;
      drawBandBox(ctx, stripMap, 0, 1, band.eLow, Math.min(band.eHigh, E_MAX), {
        colors,
      });
      if (i + 1 < bands.length && bands[i + 1].eLow < E_MAX) {
        const gap = bands[i + 1].eLow - band.eHigh;
        drawGapMarks(ctx, stripMap, 0, 1, band.eHigh, bands[i + 1].eLow, {
          colors,
          measure: gap >= MIN_DRAWN_GAP,
          label:
            i === 0 && gap >= MIN_DRAWN_GAP ? `${gap.toFixed(2)}` : undefined,
        });
      }
    }
  }

  /** 右下の帯の見出し(クリップの外に描く) */
  function drawStripLabel(): void {
    ctx.save();
    ctx.font = PLOT_FONT_SMALL;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      "許容帯 / 禁制帯",
      stripMap.rect.x + stripMap.rect.w / 2,
      stripMap.rect.y + stripMap.rect.h + 6,
    );
    ctx.restore();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const boundary = Math.PI / params.a;
    const kMax = ZONES * boundary;
    const contentH = h - MARGIN_TOP - MARGIN_BOTTOM;
    const potH = contentH * POTENTIAL_FRACTION;
    const ekY = MARGIN_TOP + potH + ROW_GAP_PX;
    const ekH = contentH - potH - ROW_GAP_PX;
    const ekW = w - MARGIN_LEFT - MARGIN_RIGHT - STRIP_WIDTH - STRIP_GAP_PX;

    // 上帯(ポテンシャル)。縦は 0〜U₀_MAX の固定スケール
    setPlotRange(
      potMap,
      MARGIN_LEFT,
      MARGIN_TOP,
      ekW,
      potH - 18,
      0,
      POTENTIAL_CELLS * params.a,
      0,
      U0_MAX,
    );
    drawPotential();

    // 左下(E-k 図)
    setPlotRange(ekMap, MARGIN_LEFT, ekY, ekW, ekH, -kMax, kMax, 0, E_MAX);
    // 狭い画面では ±2π/a のラベルを省いて重なりを避ける(目盛り線は残す)
    const narrow = w < NARROW_WIDTH_PX;
    for (let i = 0; i < xTicks.length; i++) {
      const z = i - ZONES;
      xTicks[i].value = z * boundary;
      xTicks[i].label = narrow && Math.abs(z) === 2 ? undefined : zoneLabel(z);
    }
    drawPlotFrame(ctx, ekMap, {
      colors,
      xTicks,
      yTicks: [
        { value: 0, label: "0" },
        { value: 2, label: "2" },
        { value: 4, label: "4" },
        { value: 6, label: "6" },
        { value: 8, label: "8" },
        { value: 10, label: "10" },
      ],
      xLabel: "波数 k",
      yLabel: "エネルギー E [eV]",
      yAxisAtZero: true,
    });

    const n = sampleCount();
    withPlotClip(ctx, ekMap, () => {
      if (showFree) {
        const total = n * ZONES;
        for (let i = 0; i < total; i++) {
          const k = -kMax + (2 * kMax * i) / (total - 1);
          freeK[i] = k;
          freeE[i] = freeElectronEnergy(k);
        }
        drawCurve(ctx, ekMap, freeK, freeE, total, {
          color: colors.hairline,
          width: 2.5,
        });
      }
      for (let z = 1; z <= ZONES; z++) {
        drawZoneBoundary(ctx, ekMap, z * boundary, { colors });
        drawZoneBoundary(ctx, ekMap, -z * boundary, { colors });
      }
      for (let z = 1; z <= ZONES && z <= bands.length; z++) {
        for (const sign of [1, -1] as const) {
          fillExtendedSegment(curve, n, bands[z - 1], params, z, sign);
          drawCurve(ctx, ekMap, curve.k, curve.e, curve.count, {
            color: colors.level,
            width: 2.4,
          });
        }
      }
    });

    // 右下(E 軸の帯)。E-k 図と同じ縦スケールにそろえる
    setPlotRange(
      stripMap,
      MARGIN_LEFT + ekW + STRIP_GAP_PX,
      ekY,
      STRIP_WIDTH,
      ekH,
      0,
      1,
      0,
      E_MAX,
    );
    withPlotClip(ctx, stripMap, drawStrip);
    drawStripLabel();

    const width1 = bands.length > 0 ? bands[0].eHigh - bands[0].eLow : 0;
    const gap1 = bands.length > 1 ? bands[1].eLow - bands[0].eHigh : 0;
    widthItem.set(formatEv(width1));
    gapItem.set(formatEv(gap1));
    boundaryItem.set(formatK(boundary));
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const widthItem = readout.item("第1バンド幅");
  const gapItem = readout.item("第1ギャップ");
  const boundaryItem = readout.item("ゾーン境界 π/a", { color: "recip" });

  const u0Slider = host.controls.slider({
    id: "u0",
    label: "障壁の高さ U₀",
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

  const bSlider = host.controls.slider({
    id: "b",
    label: "障壁の幅 b",
    min: B_MIN,
    max: B_MAX,
    step: B_STEP,
    value: DEFAULT_B,
    unit: "nm",
  });
  bSlider.onChange((v) => {
    params.b = v;
    recompute();
  });

  const aSlider = host.controls.slider({
    id: "a",
    label: "周期 a",
    min: A_MIN,
    max: A_MAX,
    step: A_STEP,
    value: DEFAULT_A,
    unit: "nm",
  });
  aSlider.onChange((v) => {
    params.a = v;
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
    u0Slider.set(DEFAULT_U0);
    bSlider.set(DEFAULT_B);
    aSlider.set(DEFAULT_A);
    freeToggle.set(true);
    params.u0 = DEFAULT_U0;
    params.b = DEFAULT_B;
    params.a = DEFAULT_A;
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
