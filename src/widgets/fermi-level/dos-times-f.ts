/**
 * dos-times-f.ts — 図3「席の数 × 埋まり具合 = 電子の数」(仕様書 12 §5.3)
 *
 * 同じ縦軸(E = −0.4〜1.52 eV、E_v = 0・E_c = 1.12)を共有する横並びの 3 パネル。
 * 縦軸の共有がこの図の要点なので、狭幅でも縦積みにせず各パネルを細くする。
 *
 *   1. 席の数 g(E): 伝導帯 √(E − E_c)、価電子帯 √(E_v − E)
 *   2. 埋まり具合 f(E)(電子の実線)と 1 − f(E)(正孔の破線)
 *   3. その積 n(E) = g_c·f(電子の塗り)と p(E) = g_v·(1 − f)(正孔の塗り)
 *
 * 積は電子と正孔を**同じ倍率**で規格化する(両方の最大値のうち大きい方を 1)。
 * 席は上にもたくさんあるのに、積が効くのはバンド端から数 k_BT の範囲だけ。
 * 読み取りの n・p は 400 区間の数値積分(lib/dos.ts)で、electronDensity と
 * 一致する(§5.8 T5)。
 *
 * 簡略化(図注に明示): 放物線バンドの状態密度。バンド端の近く(k_BT の数倍
 * 以内)でだけ良い近似だが、積に効くのはまさにその範囲だけである。
 *
 * 実装方式: 2D Canvas / requestRender。計算はパラメータ変更時のみ。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawBandBox,
  drawCurve,
  drawGapMarks,
  drawPlotFrame,
  setPlotRange,
  withPlotClip,
  type AxisTick,
  type PlotMapper,
} from "../_shared/banddiagram";
import {
  fermiDirac,
  intrinsicDensity,
  SILICON,
  thermalEnergy,
} from "../_shared/semiconductor";
import {
  dosConduction,
  dosValence,
  integrateElectrons,
  integrateHoles,
  vacancy,
  type PeakIntegral,
} from "./lib/dos";
import { drawFermiLine, drawLabel, fermiColors } from "./lib/draw";
import { formatDensity, formatDensitySquared } from "./lib/format";

/** 縦軸の範囲 [eV] */
const E_MIN = -0.4;
const E_MAX = 1.52;
const EC = SILICON.eg;
const EV = 0;
/** 操作パラメータ(§5.3 の表) */
const EF_MIN = -0.2;
const EF_MAX = 1.32;
const EF_STEP = 0.005;
const EF_INIT = 0.56;
const T_MIN = 100;
const T_MAX = 1000;
const T_STEP = 10;
const T_INIT = 300;
/** 余白・寸法(px) */
const MARGIN_LEFT = 54;
const MARGIN_RIGHT = 10;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 40;
const NARROW_WIDTH_PX = 480;
/** 横軸で曲線が届く最大の割合(枠に触れないように) */
const X_FILL = 0.92;
/** サンプル点数 */
const SAMPLES = 241;
const SAMPLES_NARROW = 121;
/** 積の山を描く範囲: バンド端から(縮退なら E_F の先へ)k_BT のこの倍数まで */
const PEAK_SPAN_KT = 20;

const Y_TICKS: readonly AxisTick[] = [0, 0.4, 0.8, 1.2].map((v) => ({
  value: v,
  label: v === 0 ? "0" : v.toFixed(1),
}));
const F_TICKS: readonly AxisTick[] = [
  { value: 0, label: "0" },
  { value: 0.5, label: "0.5" },
  { value: 1, label: "1" },
];

export default function dosTimesF(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = fermiColors();
  const panels: PlotMapper[] = [
    createPlotMapper(),
    createPlotMapper(),
    createPlotMapper(),
  ];
  const span = createPlotMapper();

  /* ---- 状態 ---- */
  let eF = EF_INIT;
  let temperature = T_INIT;

  /* ---- 使い回すバッファ ---- */
  const xs = new Float64Array(SAMPLES);
  const es = new Float64Array(SAMPLES);
  const peakE = new Float64Array(SAMPLES);
  const peakN = new Float64Array(SAMPLES);
  const peakHoleE = new Float64Array(SAMPLES);
  const peakP = new Float64Array(SAMPLES);
  const nResult: PeakIntegral = { density: 0, width90: 0 };
  const pResult: PeakIntegral = { density: 0, width90: 0 };

  /* ---- パラメータ変更時の計算(積の山のサンプルと数値積分) ---- */
  let peakCount = 0;
  let peakNorm = 1;
  function recompute(count: number): void {
    const T = temperature;
    const kT = thermalEnergy(T);
    // 電子の山: E_c から上へ(縮退なら E_F の先へ 20 k_BT まで)。√ の立ち上がりを
    // 細かく取るため、端に寄せた 2 乗の間隔でサンプルする
    const depthN = Math.max(0, (eF - EC) / kT);
    const spanN = Math.min((depthN + PEAK_SPAN_KT) * kT, E_MAX - EC);
    const depthP = Math.max(0, (EV - eF) / kT);
    const spanP = Math.min((depthP + PEAK_SPAN_KT) * kT, EV - E_MIN);
    let maxN = 0;
    let maxP = 0;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const eN = EC + spanN * t * t;
      const eP = EV - spanP * t * t;
      peakE[i] = eN;
      peakHoleE[i] = eP;
      peakN[i] = dosConduction(SILICON, eN, T) * fermiDirac(eN, eF, T);
      peakP[i] = dosValence(SILICON, eP, T) * vacancy(eP, eF, T);
      if (peakN[i] > maxN) maxN = peakN[i];
      if (peakP[i] > maxP) maxP = peakP[i];
    }
    peakCount = count;
    peakNorm = Math.max(maxN, maxP) || 1;
    integrateElectrons(SILICON, eF, T, undefined, nResult);
    integrateHoles(SILICON, eF, T, undefined, pResult);
  }
  /** 最後に計算したときのパラメータ(変わったときだけ計算し直す) */
  let computedEF = NaN;
  let computedT = NaN;
  let computedN = 0;

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  /** 帯(許容帯)の塗りとバンド端を 1 パネルに描く */
  function drawBands(m: PlotMapper): void {
    drawBandBox(ctx, m, 0, 1, EC, E_MAX + 1, { colors });
    drawBandBox(ctx, m, 0, 1, E_MIN - 1, EV, { colors });
  }

  /** 積の山を塗る(縦の曲線と左の軸の間) */
  function fillPeak(
    m: PlotMapper,
    energies: Float64Array,
    values: Float64Array,
    count: number,
    color: string,
  ): void {
    if (count < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(m.toPxX(0), m.toPxY(energies[0]));
    for (let i = 0; i < count; i++) {
      ctx.lineTo(
        m.toPxX((values[i] / peakNorm) * X_FILL),
        m.toPxY(energies[i]),
      );
    }
    ctx.lineTo(m.toPxX(0), m.toPxY(energies[count - 1]));
    ctx.closePath();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const narrow = w < NARROW_WIDTH_PX;
    const n = sampleCount();
    if (eF !== computedEF || temperature !== computedT || n !== computedN) {
      recompute(n);
      computedEF = eF;
      computedT = temperature;
      computedN = n;
    }

    const gap = narrow ? 8 : 16;
    const totalW = w - MARGIN_LEFT - MARGIN_RIGHT;
    const panelW = (totalW - 2 * gap) / 3;
    const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
    for (let p = 0; p < 3; p++) {
      setPlotRange(
        panels[p],
        MARGIN_LEFT + p * (panelW + gap),
        MARGIN_TOP,
        panelW,
        plotH,
        0,
        1,
        E_MIN,
        E_MAX,
      );
    }
    setPlotRange(
      span,
      MARGIN_LEFT,
      MARGIN_TOP,
      totalW,
      plotH,
      0,
      1,
      E_MIN,
      E_MAX,
    );

    const [gPanel, fPanel, prodPanel] = panels;
    drawPlotFrame(ctx, gPanel, {
      colors,
      yTicks: Y_TICKS,
      yLabel: "エネルギー E [eV]",
    });
    drawPlotFrame(ctx, fPanel, { colors, xTicks: F_TICKS });
    drawPlotFrame(ctx, prodPanel, { colors });

    const T = temperature;

    /* ---- 1. 席の数 g(E) ---- */
    withPlotClip(ctx, gPanel, () => {
      drawBands(gPanel);
      // ギャップの寸法線(文字は付けない — 中央を E_F の線が横切ることがあるため)
      drawGapMarks(ctx, gPanel, 0, 1, EV, EC, { colors, measure: true });
      // g の最大(表示範囲の上端・下端)で横幅を規格化する(上下の大きさの比は正しい)
      const gScale =
        Math.max(
          dosConduction(SILICON, E_MAX, T),
          dosValence(SILICON, E_MIN, T),
        ) || 1;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const e = EC + (E_MAX - EC) * t * t;
        es[i] = e;
        xs[i] = (dosConduction(SILICON, e, T) / gScale) * X_FILL;
      }
      drawCurve(ctx, gPanel, xs, es, n, { color: colors.level, width: 2 });
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const e = EV - (EV - E_MIN) * t * t;
        es[i] = e;
        xs[i] = (dosValence(SILICON, e, T) / gScale) * X_FILL;
      }
      drawCurve(ctx, gPanel, xs, es, n, { color: colors.level, width: 2 });
    });
    drawLabel(
      ctx,
      "E_c",
      gPanel.toPxX(1) - 4,
      gPanel.toPxY(EC) + 9,
      colors.text2,
      "right",
    );
    drawLabel(
      ctx,
      "E_v",
      gPanel.toPxX(1) - 4,
      gPanel.toPxY(EV) - 9,
      colors.text2,
      "right",
    );

    /* ---- 2. 埋まり具合 f と 1 − f ---- */
    withPlotClip(ctx, fPanel, () => {
      drawBands(fPanel);
      for (let i = 0; i < n; i++) {
        const e = E_MIN + ((E_MAX - E_MIN) * i) / (n - 1);
        es[i] = e;
        xs[i] = fermiDirac(e, eF, T);
      }
      drawCurve(ctx, fPanel, xs, es, n, { color: colors.electron, width: 2.2 });
      for (let i = 0; i < n; i++) xs[i] = vacancy(es[i], eF, T);
      drawCurve(ctx, fPanel, xs, es, n, {
        color: colors.hole,
        width: 2,
        dash: [6, 4],
      });
    });
    // E_F より上では f が左端(0)、1 − f が右端(1)に寄るので、f の名前は
    // 左上に、1 − f の名前は左下(E_F より下では 1 − f が左端に寄る)に置く
    drawLabel(
      ctx,
      "f",
      fPanel.toPxX(0) + 8,
      fPanel.toPxY(E_MAX) + 12,
      colors.electron,
      "left",
    );
    drawLabel(
      ctx,
      "1 − f",
      fPanel.toPxX(0) + 8,
      fPanel.toPxY(E_MIN) - 12,
      colors.hole,
      "left",
    );

    /* ---- 3. その積 ---- */
    withPlotClip(ctx, prodPanel, () => {
      drawBands(prodPanel);
      fillPeak(prodPanel, peakE, peakN, peakCount, colors.electron);
      fillPeak(prodPanel, peakHoleE, peakP, peakCount, colors.hole);
    });
    // 山の名前は帯の奥の右端に置く(縮退して山が太っても重ならないように)
    drawLabel(
      ctx,
      "電子",
      prodPanel.toPxX(1) - 6,
      prodPanel.toPxY(E_MAX) + 12,
      colors.electron,
      "right",
    );
    drawLabel(
      ctx,
      "正孔",
      prodPanel.toPxX(1) - 6,
      prodPanel.toPxY(E_MIN) - 12,
      colors.hole,
      "right",
    );

    /* ---- 3 パネルを貫く E_F ---- */
    drawFermiLine(ctx, span, 0, 1, eF, colors);

    /* ---- 見出し(1 行目: パネル名、2 行目: 積の規格化の注記) ---- */
    const titles = narrow
      ? ["席の数 g", "埋まり具合", "積 g × f"]
      : ["席の数 g(E)", "埋まり具合 f(E)", "積 = キャリアの数"];
    for (let p = 0; p < 3; p++) {
      drawLabel(
        ctx,
        titles[p],
        panels[p].rect.x + panels[p].rect.w / 2,
        14,
        colors.text,
        "center",
      );
    }
    drawLabel(
      ctx,
      "最大値で規格化(上下の比は正しい)",
      prodPanel.rect.x + prodPanel.rect.w,
      31,
      colors.text2,
      "right",
    );

    /* ---- 読み取り値 ---- */
    const nVal = nResult.density;
    const pVal = pResult.density;
    const ni = intrinsicDensity(SILICON, T);
    nItem.set(formatDensity(nVal));
    pItem.set(formatDensity(pVal));
    npItem.set(formatDensitySquared(nVal * pVal));
    ni2Item.set(formatDensitySquared(ni * ni));
    widthItem.set(`0〜${nResult.width90.toFixed(1)} k_BT`);
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const nItem = readout.item("n", { color: "electron" });
  const pItem = readout.item("p", { color: "hole" });
  const npItem = readout.item("np");
  const ni2Item = readout.item("n_i²");
  const widthItem = readout.item("電子の山の幅(90%)", { color: "electron" });

  const efSlider = host.controls.slider({
    id: "ef",
    label: "E_F の高さ",
    min: EF_MIN,
    max: EF_MAX,
    step: EF_STEP,
    value: EF_INIT,
    unit: "eV",
    format: (v) => (v < 0 ? `−${Math.abs(v).toFixed(3)}` : v.toFixed(3)),
  });
  efSlider.onChange((v) => {
    eF = v;
  });

  const tSlider = host.controls.slider({
    id: "temperature",
    label: "温度 T",
    min: T_MIN,
    max: T_MAX,
    step: T_STEP,
    value: T_INIT,
    unit: "K",
  });
  tSlider.onChange((v) => {
    temperature = v;
  });

  host.controls.reset(() => {
    efSlider.set(EF_INIT);
    tSlider.set(T_INIT);
    eF = EF_INIT;
    temperature = T_INIT;
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
