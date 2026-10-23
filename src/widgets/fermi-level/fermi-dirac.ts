/**
 * fermi-dirac.ts — 図2「温度がぼかす」(仕様書 12 §5.2・中心図版)
 *
 * 左(主領域): 縦軸 E − E_F、横軸 占有確率 f。フェルミ・ディラック分布
 * f(E) = 1/(e^{(E−E_F)/k_BT} + 1)(式 E1)を描き、T = 0 の階段をゴーストで
 * 重ねる。f(E_F) = 1/2 はどの温度でも変わらない。坂の幅(0.9 → 0.1)は
 * 2 ln 9 · k_BT ≈ 4.4 k_BT。
 * 「Si のバンド端を重ねる」では、真性 Si を想定して E_c − E_F = +0.56 eV・
 * E_v − E_F = −0.56 eV に帯を重ね、伝導帯の底での f(300 K で 3.9 × 10⁻¹⁰)を
 * 読ませる。「ボルツマン近似を重ねる」では e^{−(E−E_F)/k_BT}(式 E3)を破線で
 * 重ね、f との差が 5% 以下になる高さ(E − E_F = k_BT ln 20 ≈ 3k_BT)に目印を置く。
 * 右(幅 120px): k_BT のものさし — 高さ E_g の棒の横に高さ k_BT の小さな棒を
 * 積み、「E_g は k_BT の 43 個分」を寸法で見せる。
 *
 * 簡略化(図注に明示): 重ねる Si のバンド端は「E_F がギャップ中央にある
 * 真性 Si」を想定した固定位置(ドーピングで E_F が動く話は図5)。
 *
 * 実装方式: 2D Canvas / requestRender。
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
} from "../_shared/banddiagram";
import { fermiDirac, SILICON, thermalEnergy } from "../_shared/semiconductor";
import { fmtSci } from "../../core/plot";
import { drawFermiLine, drawLabel, fermiColors } from "./lib/draw";

/** 縦軸 E − E_F の表示範囲 [eV](±) */
const E_HALF = 0.7;
/** 横軸の右端(f = 1 の曲線が枠に重ならないよう少し広げる) */
const F_MAX = 1.08;
/** 真性 Si のバンド端の位置 E_c − E_F [eV](E_v − E_F はその符号違い) */
const HALF_GAP = SILICON.eg / 2;
/** ボルツマン近似の破線を描く上限(E < E_F で 1 を超えて発散するため) */
const BOLTZMANN_CLIP = 1.05;
/** f と近似の相対差が 5% になる高さ = k_BT ln 20 */
const BOLTZMANN_MATCH = Math.log(20);
/** 裾の幅 = 2 ln 9 · k_BT(T3) */
const TAIL_FACTOR = 2 * Math.log(9);
/** 温度スライダー(§5.2 の表) */
const T_MIN = 0;
const T_MAX = 2000;
const T_STEP = 10;
const T_INIT = 300;
/** 余白・寸法(px) */
const MARGIN_LEFT = 62;
const MARGIN_RIGHT = 8;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 46;
const RULER_W = 120;
const RULER_W_NARROW = 92;
const RULER_GAP = 14;
const NARROW_WIDTH_PX = 480;
/** 曲線のサンプル点数(狭い画面では半分 — §5.0) */
const SAMPLES = 241;
const SAMPLES_NARROW = 121;

const X_TICKS: readonly AxisTick[] = [
  { value: 0, label: "0" },
  { value: 0.5, label: "0.5" },
  { value: 1, label: "1" },
];
const Y_TICKS: readonly AxisTick[] = [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6].map(
  (v) => ({
    value: v,
    label: v === 0 ? "0" : `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}`,
  }),
);

export default function fermiDiracFigure(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = fermiColors();
  const main = createPlotMapper();
  const ruler = createPlotMapper();

  /* ---- 状態 ---- */
  let temperature = T_INIT;
  let showBands = true;
  let showBoltzmann = false;

  /* ---- 使い回すバッファ ---- */
  const curveF = new Float64Array(SAMPLES);
  const curveE = new Float64Array(SAMPLES);
  const stepF = Float64Array.from([1, 1, 0, 0]);
  const stepE = Float64Array.from([-E_HALF, 0, 0, E_HALF]);

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  /** 縦の寸法線(両端に矢羽根) */
  function dimension(x: number, yA: number, yB: number): void {
    const top = Math.min(yA, yB);
    const bottom = Math.max(yA, yB);
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.fillStyle = colors.text2;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    if (bottom - top > 12) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x - 3.5, top + 6);
      ctx.lineTo(x + 3.5, top + 6);
      ctx.closePath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x - 3.5, bottom - 6);
      ctx.lineTo(x + 3.5, bottom - 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** 点線の補助線 */
  function guide(x0: number, y0: number, x1: number, y1: number): void {
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  /** 右: k_BT のものさし(E_g を k_BT の棒で測る) */
  function drawRuler(kT: number, narrow: boolean): void {
    const rx = ruler.rect.x;
    const yBottom = ruler.toPxY(-HALF_GAP);
    const yTop = ruler.toPxY(HALF_GAP);
    const barX = rx + 6;
    const barW = narrow ? 16 : 20;
    const stackX = barX + barW + (narrow ? 12 : 18);
    const stackW = barW;

    // E_g の棒(許容帯の色ではなく、ギャップの大きさを表す寸法の棒)
    ctx.save();
    ctx.fillStyle = colors.band;
    ctx.fillRect(barX, yTop, barW, yBottom - yTop);
    ctx.strokeStyle = colors.level;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(barX, yTop, barW, yBottom - yTop);
    ctx.restore();
    drawLabel(ctx, "E_g", barX + barW / 2, yTop - 8, colors.text, "center");

    // k_BT の棒を積む
    const pxPerEv = (yBottom - yTop) / SILICON.eg;
    const boxPx = kT * pxPerEv;
    const count = kT > 0 ? SILICON.eg / kT : Infinity;
    ctx.save();
    ctx.strokeStyle = colors.level;
    ctx.lineWidth = 0.8;
    if (kT > 0 && boxPx >= 3) {
      const full = Math.floor(count);
      for (let i = 0; i < full; i++) {
        const y1 = yBottom - i * boxPx;
        ctx.fillStyle = i % 2 === 0 ? colors.hairline : colors.bg;
        ctx.fillRect(stackX, y1 - boxPx, stackW, boxPx);
        ctx.strokeRect(stackX, y1 - boxPx, stackW, boxPx);
      }
      const rest = (count - full) * boxPx;
      if (rest > 0.5) {
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(stackX, yBottom - full * boxPx - rest, stackW, rest);
      }
    } else if (kT > 0) {
      // 棒が細かすぎて描けない: 1 本だけ描いて個数を文字で示す
      const hPx = Math.max(boxPx, 1.5);
      ctx.fillStyle = colors.level;
      ctx.fillRect(stackX, yBottom - hPx, stackW, hPx);
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(stackX, yTop, stackW, yBottom - yTop);
    }
    ctx.restore();
    drawLabel(
      ctx,
      "k_BT",
      stackX + stackW / 2,
      yTop - 8,
      colors.text,
      "center",
    );

    // 個数の表示
    const countText =
      kT > 0
        ? `${count >= 100 ? Math.round(count) : count.toFixed(0)} 個分`
        : "—";
    drawLabel(
      ctx,
      "E_g は k_BT の",
      rx + 4,
      yBottom + 16,
      colors.text2,
      "left",
    );
    drawLabel(ctx, countText, rx + 4, yBottom + 32, colors.text, "left");
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const narrow = w < NARROW_WIDTH_PX;
    const rulerW = narrow ? RULER_W_NARROW : RULER_W;
    const plotW = w - MARGIN_LEFT - MARGIN_RIGHT - rulerW - RULER_GAP;
    const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
    setPlotRange(
      main,
      MARGIN_LEFT,
      MARGIN_TOP,
      plotW,
      plotH,
      0,
      F_MAX,
      -E_HALF,
      E_HALF,
    );
    setPlotRange(
      ruler,
      MARGIN_LEFT + plotW + RULER_GAP,
      MARGIN_TOP,
      rulerW,
      plotH,
      0,
      1,
      -E_HALF,
      E_HALF,
    );
    drawPlotFrame(ctx, main, {
      colors,
      xTicks: X_TICKS,
      yTicks: Y_TICKS,
      xLabel: "占有確率 f(E)",
      yLabel: "E − E_F [eV]",
    });

    const T = temperature;
    const kT = thermalEnergy(T);
    const n = sampleCount();
    const fEdge = fermiDirac(HALF_GAP, 0, T);

    withPlotClip(ctx, main, () => {
      // Si のバンド端(真性 Si: E_F がギャップの中央)
      if (showBands) {
        drawBandBox(ctx, main, 0, F_MAX, HALF_GAP, E_HALF + 1, { colors });
        drawBandBox(ctx, main, 0, F_MAX, -E_HALF - 1, -HALF_GAP, { colors });
        drawGapMarks(ctx, main, 0, F_MAX, -HALF_GAP, HALF_GAP, {
          colors,
          measure: false,
        });
        drawLabel(
          ctx,
          "伝導帯",
          main.toPxX(F_MAX) - 8,
          main.toPxY(HALF_GAP) - 10,
          colors.text2,
          "right",
        );
        drawLabel(
          ctx,
          "価電子帯",
          main.toPxX(0) + 8,
          main.toPxY(-HALF_GAP) + 12,
          colors.text2,
          "left",
        );
      }

      // T = 0 の階段(ゴースト)
      drawCurve(ctx, main, stepF, stepE, 4, {
        color: colors.hairline,
        width: 2.5,
      });

      // ボルツマン近似 e^{−(E−E_F)/k_BT}(E < E_F 側は 1 を超えるので 1.05 で打ち切る)
      if (showBoltzmann && kT > 0) {
        const eStart = Math.max(-E_HALF, -kT * Math.log(BOLTZMANN_CLIP));
        for (let i = 0; i < n; i++) {
          const e = eStart + ((E_HALF - eStart) * i) / (n - 1);
          curveE[i] = e;
          curveF[i] = Math.exp(-e / kT);
        }
        drawCurve(ctx, main, curveF, curveE, n, {
          color: colors.electron,
          width: 1.8,
          dash: [6, 4],
          alpha: 0.9,
        });
      }

      // f(E)
      if (kT > 0) {
        for (let i = 0; i < n; i++) {
          const e = -E_HALF + (2 * E_HALF * i) / (n - 1);
          curveE[i] = e;
          curveF[i] = fermiDirac(e, 0, T);
        }
        drawCurve(ctx, main, curveF, curveE, n, {
          color: colors.electron,
          width: 2.4,
        });
      } else {
        drawCurve(ctx, main, stepF, stepE, 4, {
          color: colors.electron,
          width: 2.4,
        });
      }

      drawFermiLine(ctx, main, 0, F_MAX, 0, colors);
    });

    // 裾の幅の寸法線(f = 0.9 と f = 0.1 の高さを結ぶ)
    const half = 0.5 * TAIL_FACTOR * kT;
    const yLow = main.toPxY(-half);
    const yHigh = main.toPxY(half);
    if (kT > 0 && yLow - yHigh >= 6) {
      const xDim = main.toPxX(1.0) - 2;
      guide(main.toPxX(0.9), yLow, xDim, yLow);
      guide(main.toPxX(0.1), yHigh, xDim, yHigh);
      dimension(xDim, yLow, yHigh);
      drawLabel(
        ctx,
        narrow ? "裾の幅 ≈ 4.4 k_BT" : "裾の幅(0.9 → 0.1)≈ 4.4 k_BT",
        xDim - 6,
        yHigh - 6,
        colors.text,
        "right",
        "bottom",
      );
    }

    // ボルツマン近似が f と見分けられなくなる高さの目印
    if (showBoltzmann && kT > 0) {
      const eMatch = BOLTZMANN_MATCH * kT;
      if (eMatch < E_HALF) {
        const fx = main.toPxX(fermiDirac(eMatch, 0, T));
        const fy = main.toPxY(eMatch);
        ctx.save();
        ctx.strokeStyle = colors.electron;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx - 5, fy);
        ctx.lineTo(fx + 12, fy);
        ctx.stroke();
        ctx.restore();
        drawLabel(
          ctx,
          narrow
            ? "ここから上: 差 5% 以下"
            : "ここから上は f とほぼ同じ(差 5% 以下)",
          fx + 16,
          fy,
          colors.text2,
          "left",
        );
      }
      drawLabel(
        ctx,
        narrow
          ? "破線 = ボルツマン近似"
          : "破線 = ボルツマン近似 e^−(E−E_F)/k_BT",
        main.toPxX(F_MAX) - 6,
        main.rect.y + 12,
        colors.text2,
        "right",
      );
    }

    // 伝導帯の底での f の目印(バンド端 on のとき)
    if (showBands) {
      const px = main.toPxX(fEdge);
      const py = main.toPxY(HALF_GAP);
      ctx.save();
      ctx.strokeStyle = colors.electron;
      ctx.fillStyle = colors.bg;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawLabel(
        ctx,
        `ここでの f = ${fEdge > 0 ? fmtSci(fEdge, 2) : "0"}`,
        px + 10,
        py - 9,
        colors.text,
        "left",
      );
    }

    drawRuler(kT, narrow);

    // 読み取り値
    ktItem.set(`${(kT * 1000).toFixed(1)} meV`);
    widthItem.set(`${(TAIL_FACTOR * kT).toFixed(3)} eV`);
    const fPlus = fermiDirac(0.1, 0, T);
    plusItem.set(
      fPlus === 0
        ? "0"
        : fPlus >= 1e-3
          ? fPlus.toPrecision(3)
          : fmtSci(fPlus, 2),
    );
    edgeItem.set(showBands ? (fEdge > 0 ? fmtSci(fEdge, 2) : "0") : "—");
    ratioItem.set(kT > 0 ? (SILICON.eg / kT).toFixed(1) : "∞");
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const ktItem = readout.item("k_BT");
  const widthItem = readout.item("裾の幅(0.9 → 0.1)");
  const plusItem = readout.item("f(E_F + 0.1 eV)", { color: "electron" });
  const edgeItem = readout.item("伝導帯の底での f", { color: "electron" });
  const ratioItem = readout.item("E_g / k_BT");

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

  const bandToggle = host.controls.toggle({
    id: "bands",
    label: "Si のバンド端を重ねる",
    value: true,
  });
  bandToggle.onChange((v) => {
    showBands = v;
  });

  const boltzmannToggle = host.controls.toggle({
    id: "boltzmann",
    label: "ボルツマン近似を重ねる",
    value: false,
  });
  boltzmannToggle.onChange((v) => {
    showBoltzmann = v;
  });

  host.controls.reset(() => {
    tSlider.set(T_INIT);
    bandToggle.set(true);
    boltzmannToggle.set(false);
    temperature = T_INIT;
    showBands = true;
    showBoltzmann = false;
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
