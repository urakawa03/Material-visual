/**
 * forward-bias.ts — 図4「坂を越える」(仕様書 13 §5.4)
 *
 * 左(狭幅では上): バンド図(図3 と同じ曲がった帯)。E_F の代わりに p 側・n 側の
 * 擬フェルミ準位を中性領域だけに短く描く。n 側の伝導帯の底のすぐ上に電子の丸、
 * p 側の価電子帯の頂上のすぐ下に正孔の丸が熱的に分布する(**縦位置 = その
 * キャリアのエネルギー**。実際の eV のスケールで、拡大しない)。キャリアは横に
 * 動き、坂に当たると坂の高さより大きいエネルギーのものだけが越えて、同じ高さの
 * まま向こう側へ進み(エネルギー保存)、相手側でしばらく進んだのちランダムな
 * 時刻に消える(少数キャリアの再結合)。越えられないものは跳ね返る。
 * 右(狭幅では下): 「1 秒あたりに越えた数」のカウンタと小さな片対数グラフ
 * (横軸 V、縦軸 越えた数 / 秒)。理論曲線 ∝ exp(qV/k_BT) を常に描き、現在の
 * 測定値(直近 5 秒の平均)を点で重ねる。
 *
 * モデル: lib/barrier.ts の BarrierSim(シード固定)。坂の高さは図3 と同じ
 * lib/junction.ts から(N_A = N_D = 10¹⁶ cm⁻³、300 K)。
 *
 * 誠実な簡略化(図注に明示): 越える過程を「坂を飛び越える」形(熱電子放出)で
 * 描いている。実際の Si ダイオードの電流は越えたあとの少数キャリアの拡散で
 * 決まるが、電圧への指数関数の依存は同じ。1 次元・時間は加速・粒子数は縮めた。
 *
 * 実装方式: 2D Canvas / onFrame + fixedStep(1/60 秒)。画面外・タブ非表示で
 * 停止。省モーション時は自動再生せず、各 V での静止フレーム(粒子の分布 + 理論の
 * 割合)を表示する。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { fmtSci } from "../../core/plot";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawPlotFrame,
  PLOT_FONT,
  pow10Ticks,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { SILICON, thermalEnergy } from "../_shared/semiconductor";
import {
  AUX_ENERGY,
  AUX_TIME,
  BARRIER_DT,
  BarrierSim,
  CARRIERS_EACH,
  theoryCrossingRate,
  TRANSIT_SECONDS,
  type BarrierSpecies,
} from "./lib/barrier";
import { DOPING_INIT, ROOM_T } from "./lib/constants";
import {
  depletion,
  displayHalfRange,
  quasiFermiLevels,
  type Depletion,
} from "./lib/junction";
import {
  BandSamples,
  curveSamples,
  drawBands,
  drawBarrierDimension,
  drawBoxedLabel,
  drawDotsPx,
  drawEdgeLine,
  drawLabel,
  drawSplitDivider,
  NARROW_WIDTH_PX,
  pnColors,
  splitByFraction,
} from "./lib/draw";

/** 操作パラメータ(§5.4 の表) */
const V_MIN = 0;
const V_MAX = 0.65;
const V_STEP = 0.005;
const V_INIT = 0;
/** 帯の見た目の厚み [eV] */
const BAND_THICKNESS = 0.36;
/** バンド図の縦軸 [eV](V = 0 で n 側の E_v は −0.71 eV) */
const E_MIN = -1.13;
const E_MAX = 1.56;
/** 片対数グラフの縦軸(log₁₀ の越えた数 / 秒) */
const LOG_MIN = -3;
const LOG_MAX = 2;
/** 測定値を点で示すのに必要な平均の時間 [秒] */
const MIN_RATE_SECONDS = 1;

const E_TICKS: readonly AxisTick[] = [-1, -0.5, 0, 0.5, 1, 1.5].map((v) => ({
  value: v,
  label: v === 0 ? "0" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`,
}));
const V_TICKS: readonly AxisTick[] = [0, 0.2, 0.4, 0.6].map((v) => ({
  value: v,
  label: v === 0 ? "0" : v.toFixed(1),
}));
const X_TICKS: readonly AxisTick[] = [-0.6, -0.3, 0, 0.3, 0.6].map((v) => ({
  value: v,
  label: v === 0 ? "0" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`,
}));

export default function forwardBias(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = pnColors();
  const band = createPlotMapper();
  const graph = createPlotMapper();
  const bands = new BandSamples(241);
  const kT = thermalEnergy(ROOM_T);
  /** 枠の設定(毎フレームの新規割当てを避けるため初期化時に作る) */
  const bandFrameWide = {
    colors,
    xTicks: X_TICKS,
    yTicks: E_TICKS,
    xLabel: "位置 x [μm]",
    yLabel: "エネルギー [eV]",
  };
  const bandFrameNarrow = { ...bandFrameWide, yLabel: undefined };
  const graphFrame = {
    colors,
    xTicks: V_TICKS,
    yTicks: pow10Ticks(LOG_MIN, LOG_MAX, 1),
    xLabel: "バイアス V [V]",
    yLabel: "越えた数 / 秒",
  };
  const counts = { maj: 0, hot: 0 };

  /* ---- 状態 ---- */
  let bias = V_INIT;
  let d: Depletion = depletion(SILICON, DOPING_INIT, DOPING_INIT, bias, ROOM_T);
  /** 表示範囲は V = 0 の空乏層で決めて固定する(バイアスで狭まる様子が見える) */
  const R = displayHalfRange(d);
  const sim = new BarrierSim(d.drop);

  function recompute(): void {
    d = depletion(SILICON, DOPING_INIT, DOPING_INIT, bias, ROOM_T);
    sim.setBarrier(d.drop);
  }

  /* ---- 使い回す描画バッファ(px) ---- */
  const cap = 2 * CARRIERS_EACH;
  const majX = new Float64Array(cap);
  const majY = new Float64Array(cap);
  const hotX = new Float64Array(cap);
  const hotY = new Float64Array(cap);

  /**
   * 1 種類のキャリアの表示位置を書く。electron なら自分の側は n 側(右)。
   * 多数キャリアは majX/majY に、越えた(渡っている・相手側の)ものは hotX/hotY。
   */
  function placeSpecies(
    s: BarrierSpecies,
    electron: boolean,
    counts: { maj: number; hot: number },
  ): void {
    const ecN = SILICON.eg - d.drop;
    const ecP = SILICON.eg;
    const evP = 0;
    const evN = -d.drop;
    const homeEdge = electron ? d.xn : -d.xp;
    const otherEdge = electron ? -d.xp : d.xn;
    const homeSpan = electron ? R - d.xn : -(R - d.xp);
    const otherSpan = electron ? -(R - d.xp) : R - d.xn;
    const sign = electron ? 1 : -1;
    const base = electron ? ecN : evP;
    const maj = s.majority;
    const eM = maj.aux[AUX_ENERGY];
    for (let i = 0; i < maj.count; i++) {
      const k = counts.maj++;
      majX[k] = band.toPxX(homeEdge + maj.x[i] * homeSpan);
      majY[k] = band.toPxY(base + sign * eM[i]);
    }
    const tr = s.transit;
    const eT = tr.aux[AUX_ENERGY];
    const tT = tr.aux[AUX_TIME];
    for (let i = 0; i < tr.count; i++) {
      const p = Math.min(1, Math.max(0, (sim.time - tT[i]) / TRANSIT_SECONDS));
      const k = counts.hot++;
      hotX[k] = band.toPxX(homeEdge + (otherEdge - homeEdge) * p);
      hotY[k] = band.toPxY(base + sign * eT[i]);
    }
    const mi = s.minority;
    const eMi = mi.aux[AUX_ENERGY];
    for (let i = 0; i < mi.count; i++) {
      const k = counts.hot++;
      hotX[k] = band.toPxX(otherEdge + mi.x[i] * otherSpan);
      // 坂を下げたあとで V を戻すと、越えたときのエネルギーが新しい坂より
      // 低くなりうる。その場合も相手側のバンドの外には描かない
      const y = electron
        ? Math.max(base + eMi[i], ecP)
        : Math.min(base - eMi[i], evN);
      hotY[k] = band.toPxY(y);
    }
  }

  function drawBandPanel(narrow: boolean): void {
    drawPlotFrame(ctx, band, narrow ? bandFrameNarrow : bandFrameWide);
    bands.sample(
      SILICON,
      d,
      ROOM_T,
      -R,
      R,
      curveSamples(host.size.w),
      BAND_THICKNESS,
    );
    const q = quasiFermiLevels(d);
    const ecN = SILICON.eg - d.drop;
    withPlotClip(ctx, band, () => {
      drawBands(ctx, band, bands, colors);
      for (const x of [-d.xp, d.xn]) drawEdgeLine(ctx, band, x, colors.text2);
      // 擬フェルミ準位(中性領域だけに短く)
      ctx.save();
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = colors.hole;
      ctx.beginPath();
      ctx.moveTo(band.toPxX(-R), band.toPxY(q.eFp));
      ctx.lineTo(band.toPxX(-d.xp), band.toPxY(q.eFp));
      ctx.stroke();
      ctx.strokeStyle = colors.electron;
      ctx.beginPath();
      ctx.moveTo(band.toPxX(d.xn), band.toPxY(q.eFn));
      ctx.lineTo(band.toPxX(R), band.toPxY(q.eFn));
      ctx.stroke();
      ctx.restore();
      // n 側の E_c の高さを左へ延ばした参照線(坂の高さの寸法の起点)
      ctx.save();
      ctx.strokeStyle = colors.text2;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(band.toPxX(-R + 0.12 * R), band.toPxY(ecN));
      ctx.lineTo(band.toPxX(d.xn), band.toPxY(ecN));
      ctx.stroke();
      ctx.restore();

      // キャリア(多数キャリアは小さく、越えたものは少し大きく)
      counts.maj = 0;
      counts.hot = 0;
      placeSpecies(sim.holes, false, counts);
      const holesMaj = counts.maj;
      const holesHot = counts.hot;
      drawDotsPx(ctx, majX, majY, holesMaj, narrow ? 1.7 : 2.1, colors.hole);
      drawDotsPx(ctx, hotX, hotY, holesHot, narrow ? 2.6 : 3.1, colors.hole);
      counts.maj = 0;
      counts.hot = 0;
      placeSpecies(sim.electrons, true, counts);
      drawDotsPx(
        ctx,
        majX,
        majY,
        counts.maj,
        narrow ? 1.7 : 2.1,
        colors.electron,
      );
      drawDotsPx(
        ctx,
        hotX,
        hotY,
        counts.hot,
        narrow ? 2.6 : 3.1,
        colors.electron,
      );
    });

    // 坂の高さの寸法(p 側の中性領域の左寄り)。坂が低いときは帯の縁の線を
    // 隠さないよう、ラベルを寸法の下(禁制帯の中)に置く
    drawBarrierDimension(
      ctx,
      band.toPxX(-R + 0.07 * R),
      band.toPxY(SILICON.eg),
      band.toPxY(ecN),
      narrow ? barrierLabelShort : barrierLabel,
      colors,
    );
    // 擬フェルミ準位のラベル。E_Fn は n 側の E_c のすぐ下(0.2 eV)を通るので、
    // 線の上ではなく下(禁制帯の空いた所)に置く
    drawLabel(
      ctx,
      "E_Fp",
      band.toPxX(-R) + 4,
      band.toPxY(q.eFp) - 9,
      colors.hole,
      "left",
      "middle",
      PLOT_FONT,
    );
    drawLabel(
      ctx,
      "E_Fn",
      band.toPxX(R) - 4,
      band.toPxY(q.eFn) + 10,
      colors.electron,
      "right",
      "middle",
      PLOT_FONT,
    );
    // k_BT のものさし(実際のスケールであることを示す)。電子の雲の上、右端
    const sx = band.rect.x + band.rect.w - 10;
    const sy0 = band.toPxY(ecN + 0.2);
    const sy1 = band.toPxY(ecN + 0.2 + kT);
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy0);
    ctx.lineTo(sx, sy1);
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, "k_BT", sx - 4, (sy0 + sy1) / 2, colors.text2, "right");
    drawLabel(
      ctx,
      "p 型",
      band.rect.x + 4,
      band.rect.y - 8,
      colors.hole,
      "left",
    );
    drawLabel(
      ctx,
      "n 型",
      band.rect.x + band.rect.w - 4,
      band.rect.y - 8,
      colors.electron,
      "right",
    );
  }

  function drawGraphPanel(narrow: boolean): void {
    drawPlotFrame(ctx, graph, graphFrame);
    withPlotClip(ctx, graph, () => {
      // 現在の V
      ctx.save();
      ctx.strokeStyle = colors.text2;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(graph.toPxX(bias), graph.rect.y);
      ctx.lineTo(graph.toPxX(bias), graph.rect.y + graph.rect.h);
      ctx.stroke();
      ctx.restore();
      // 理論曲線(片対数では直線): 2·(当たる数)·exp(−q(V_bi − V)/k_BT)
      ctx.save();
      ctx.strokeStyle = colors.level;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const n = 66;
      for (let i = 0; i <= n; i++) {
        const v = V_MIN + ((V_MAX - V_MIN) * i) / n;
        const y = Math.log10(theoryCrossingRate(d.vbi - v));
        const px = graph.toPxX(v);
        const py = graph.toPxY(Math.max(LOG_MIN - 1, y));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
      // 測定値(直近 5 秒の平均)
      if (sim.rateSeconds >= MIN_RATE_SECONDS) {
        const r = sim.measuredRate;
        const px = graph.toPxX(bias);
        ctx.save();
        if (r > 0) {
          ctx.fillStyle = colors.electron;
          ctx.beginPath();
          ctx.arc(px, graph.toPxY(Math.log10(r)), 5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // 0 個は対数軸に載らないので、下端に中抜きの印
          ctx.strokeStyle = colors.electron;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, graph.rect.y + graph.rect.h - 6, 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
    // 凡例
    const lx = graph.rect.x + 6;
    const ly = graph.rect.y + 10;
    drawBoxedLabel(
      ctx,
      "— 理論 ∝ exp(qV/k_BT)",
      lx,
      ly,
      colors,
      "left",
      colors.level,
    );
    drawBoxedLabel(
      ctx,
      narrow ? "● 測定(直近 5 秒)" : "● 測定(直近 5 秒の平均)",
      lx,
      ly + 16,
      colors,
      "left",
      colors.electron,
    );
    if (sim.rateSeconds >= MIN_RATE_SECONDS && !(sim.measuredRate > 0)) {
      drawLabel(
        ctx,
        "○ = 0 個",
        graph.toPxX(bias) + (bias > 0.45 ? -8 : 8),
        graph.rect.y + graph.rect.h - 18,
        colors.text2,
        bias > 0.45 ? "right" : "left",
      );
    }
    // カウンタ(グラフの上)
    drawLabel(
      ctx,
      counterText,
      graph.rect.x,
      graph.rect.y - 16,
      colors.text,
      "left",
      "middle",
      PLOT_FONT,
    );
  }

  /** 2 パネルの配置(寸法が変わったときだけ作り直す) */
  let layout = splitByFraction(host.size, 0.63, 0.6);
  let layoutW = host.size.w;
  let layoutH = host.size.h;

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    if (w !== layoutW || h !== layoutH) {
      layout = splitByFraction(host.size, 0.63, 0.6);
      layoutW = w;
      layoutH = h;
    }
    const a = layout.first;
    const b = layout.second;
    const bandLeft = narrow ? 34 : 58;
    setPlotRange(
      band,
      a.x + bandLeft,
      a.y + 22,
      a.w - bandLeft - 8,
      a.h - 22 - 40,
      -R,
      R,
      E_MIN,
      E_MAX,
    );
    const gTop = layout.stacked ? 34 : 50;
    setPlotRange(
      graph,
      b.x + 50,
      b.y + gTop,
      b.w - 50 - 10,
      b.h - gTop - 44,
      V_MIN - 0.02,
      V_MAX + 0.02,
      LOG_MIN,
      LOG_MAX,
    );
    updateReadouts();
    drawBandPanel(narrow);
    drawSplitDivider(ctx, layout, colors);
    drawGraphPanel(narrow);
  }

  /* ---- 読み取り値(値が変わったときだけ文字列を作る) ---- */
  let counterText = "";
  let barrierLabel = "";
  let barrierLabelShort = "";
  let shownBias = NaN;
  let shownRateKey = NaN;
  function updateReadouts(): void {
    if (bias !== shownBias) {
      shownBias = bias;
      const b = d.drop;
      barrierItem.set(
        `${b.toFixed(3)} eV(熱エネルギーの ${(b / kT).toFixed(1)} 倍)`,
      );
      fractionItem.set(fmtSci(Math.exp(-b / kT), 2));
      barrierLabel = `坂の高さ ${b.toFixed(3)} eV`;
      barrierLabelShort = `${b.toFixed(3)} eV`;
    }
    const r = sim.measuredRate;
    const enough = sim.rateSeconds >= MIN_RATE_SECONDS;
    const key = enough ? Math.round(r * 10) : -1;
    if (key !== shownRateKey) {
      shownRateKey = key;
      const text = enough
        ? `${(Math.round(r * 10) / 10).toFixed(1)} 個`
        : "—(測定中)";
      rateItem.set(text);
      counterText = enough
        ? `1 秒あたりに越えた数: ${(Math.round(r * 10) / 10).toFixed(1)} 個`
        : "1 秒あたりに越えた数: 測定中";
    }
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const barrierItem = readout.item("坂の高さ");
  const fractionItem = readout.item("越える割合(理論)");
  const rateItem = readout.item("越えた数 / 秒(直近 5 秒)", {
    color: "electron",
  });

  const biasSlider = host.controls.slider({
    id: "bias",
    label: "バイアス V",
    min: V_MIN,
    max: V_MAX,
    step: V_STEP,
    value: V_INIT,
    unit: "V",
    format: (v) => v.toFixed(3),
  });
  biasSlider.onChange((v) => {
    bias = v;
    recompute();
  });
  host.controls.playPause();
  host.controls.reset(() => {
    biasSlider.set(V_INIT);
    bias = V_INIT;
    recompute();
    sim.reset();
  });

  /* ---- フレームループ(固定刻み 1/60 秒) ---- */
  const stepper = fixedStep(BARRIER_DT * 1000);
  host.onFrame((dt) => {
    stepper(dt, () => sim.step());
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
