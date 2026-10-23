/**
 * doping-shift.ts — 図5「不純物を少し混ぜる — ドーピング」(仕様書 12 §5.5)
 *
 * 左(主領域): バンド図。真性準位 E_i(細い破線)、ドーパント準位(ドナーなら
 * E_c のすぐ下、アクセプタなら E_v のすぐ上に `--mat-solute` の短い破線)、
 * その上にドーパントの目印を 8 個。イオン化したもの = 輪 +「+」(ドナー)/
 * 「−」(アクセプタ)、イオン化していないもの = 輪の中に電子(正孔)の丸。
 * イオン化した割合に比例して目印を切り替え、離れた電子(正孔)は目印の真上の
 * 伝導帯(真下の価電子帯)に置く。E_F の太い破線。縮退のときは右上に札。
 * 右(幅 42%、狭幅では下): n–T グラフ。多数キャリア密度の温度変化(対数)と
 * n_i(T) の破線、凍結・外因性・真性の 3 領域、現在の温度の縦線。
 *
 * モデル: _shared/semiconductor.ts の solveFermiLevel(不完全イオン化 +
 * フェルミ・ディラック積分)。n–T 曲線は 50〜700 K を 66 点で解く(パラメータ
 * 変更時のみ)。
 *
 * 簡略化(図注に明示): E_g・移動度・ドーパント準位の深さを温度・濃度によらず
 * 一定にしている。
 *
 * 実装方式: 2D Canvas / requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fmtSci } from "../../core/plot";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawBandBox,
  drawCurve,
  drawElectronDots,
  drawPlotFrame,
  pow10Ticks,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import {
  acceptorLevel,
  conductivity,
  donorLevel,
  electronDensity,
  holeDensity,
  intrinsicDensity,
  intrinsicLevel,
  ionizedAcceptors,
  ionizedDonors,
  isDegenerate,
  SILICON,
  solveFermiLevel,
} from "../_shared/semiconductor";
import {
  drawBadge,
  drawFermiLine,
  drawLabel,
  drawSplitDivider,
  drawThinLevel,
  fermiColors,
  setControlEnabled,
  snapLog,
  splitByFraction,
} from "./lib/draw";
import {
  formatDensity,
  formatEvSigned,
  formatOneIn,
  formatPercent,
  formatTimesRough,
} from "./lib/format";

type Dopant = "none" | "P" | "B";

/** 操作パラメータ(§5.5 の表) */
const DOPANT_INIT: Dopant = "P";
const CONC_MIN = 1e13;
const CONC_MAX = 1e20;
const CONC_INIT = 1e16;
const T_MIN = 50;
const T_MAX = 700;
const T_STEP = 10;
const T_INIT = 300;
/** n–T 曲線の点数(50〜700 K を 10 K 刻み) */
const CURVE_POINTS = 66;
/** n–T グラフの縦軸(log₁₀ cm⁻³) */
const LOG_MIN = 8;
const LOG_MAX = 20;
/** バンド図の縦軸 [eV] */
const E_MIN = -0.25;
const E_MAX = 1.37;
/** ドーパントの目印の数と並べる範囲(横軸 0〜1 の中) */
const MARKERS = 8;
const MARKER_X0 = 0.14;
const MARKER_X1 = 0.86;
/** 離れた電子・正孔をバンド端から離して置く距離 [eV] */
const FREE_OFFSET = 0.09;
/** 凍結の終わり(多数キャリアがドーピングのこの割合に届く温度) */
const FREEZE_FRACTION = 0.9;
/** 真性の始まり(多数キャリアがドーピングのこの倍数を超える温度) */
const INTRINSIC_FACTOR = 1.1;
const NARROW_WIDTH_PX = 480;

const T_TICKS: readonly AxisTick[] = [100, 200, 300, 400, 500, 600, 700].map(
  (v) => ({ value: v, label: String(v) }),
);
const E_TICKS: readonly AxisTick[] = [0, 0.5, 1].map((v) => ({
  value: v,
  label: v === 0 ? "0" : v.toFixed(1),
}));

export default function dopingShift(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = fermiColors();
  const band = createPlotMapper();
  const graph = createPlotMapper();
  const logTicksWide = pow10Ticks(LOG_MIN, LOG_MAX, 2);
  const logTicksNarrow = pow10Ticks(LOG_MIN, LOG_MAX, 4);

  /* ---- 状態 ---- */
  let dopant: Dopant = DOPANT_INIT;
  let conc = CONC_INIT;
  let temperature = T_INIT;

  /* ---- パラメータ変更時に計算する量(使い回すバッファ) ---- */
  const curveT = new Float64Array(CURVE_POINTS);
  const curveLog = new Float64Array(CURVE_POINTS);
  const niLog = new Float64Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const T = T_MIN + i * T_STEP;
    curveT[i] = T;
    niLog[i] = Math.log10(intrinsicDensity(SILICON, T));
  }
  const freeX = new Float64Array(MARKERS);
  const freeY = new Float64Array(MARKERS);
  let freezeEnd = T_MIN;
  let intrinsicStart = T_MAX;
  /**
   * 3 領域を描くか。多数キャリアがドーピングの 90% に届かない(高濃度で
   * ドーパント準位が E_F に近く、イオン化しきらない)ときは描かない
   */
  let showRegions = false;

  const state = {
    eF: 0,
    eI: 0,
    n: 0,
    p: 0,
    ionized: 0,
    degenerate: false,
  };

  function donorsOf(d: Dopant): number {
    return d === "P" ? conc : 0;
  }
  function acceptorsOf(d: Dopant): number {
    return d === "B" ? conc : 0;
  }

  /** n–T 曲線と 3 領域の境界(ドーパント・濃度が変わったときだけ) */
  function recomputeCurve(): void {
    const nD = donorsOf(dopant);
    const nA = acceptorsOf(dopant);
    freezeEnd = T_MIN;
    intrinsicStart = T_MAX;
    let freezeFound = false;
    let intrinsicFound = false;
    for (let i = 0; i < CURVE_POINTS; i++) {
      const T = curveT[i];
      const eF = solveFermiLevel(SILICON, nD, nA, T);
      const majority =
        dopant === "B"
          ? holeDensity(SILICON, eF, T)
          : electronDensity(SILICON, eF, T);
      curveLog[i] = Math.log10(Math.max(majority, 1e-300));
      if (dopant !== "none") {
        if (!freezeFound && majority >= FREEZE_FRACTION * conc) {
          freezeEnd = T;
          freezeFound = true;
        }
        if (!intrinsicFound && majority >= INTRINSIC_FACTOR * conc) {
          intrinsicStart = T;
          intrinsicFound = true;
        }
      }
    }
    showRegions = dopant !== "none" && freezeFound;
  }

  /** 現在の温度での E_F・密度・イオン化率 */
  function recomputePoint(): void {
    const T = temperature;
    const nD = donorsOf(dopant);
    const nA = acceptorsOf(dopant);
    const eF = solveFermiLevel(SILICON, nD, nA, T);
    state.eF = eF;
    state.eI = intrinsicLevel(SILICON, T);
    state.n = electronDensity(SILICON, eF, T);
    state.p = holeDensity(SILICON, eF, T);
    state.ionized =
      dopant === "P"
        ? ionizedDonors(SILICON, nD, eF, T) / nD
        : dopant === "B"
          ? ionizedAcceptors(SILICON, nA, eF, T) / nA
          : NaN;
    state.degenerate = isDegenerate(SILICON, eF, T);
  }

  function recomputeAll(): void {
    recomputeCurve();
    recomputePoint();
  }
  recomputeAll();

  /** k 個のうち i 番目がイオン化しているか(8 個に均等に散らす) */
  function isIonized(i: number, k: number): boolean {
    return Math.floor(((i + 1) * k) / MARKERS) > Math.floor((i * k) / MARKERS);
  }

  /** ドーパントの目印(輪 + 符号、または輪の中のキャリア) */
  function drawMarkers(narrow: boolean): void {
    if (dopant === "none") return;
    const donor = dopant === "P";
    const level = donor ? donorLevel(SILICON) : acceptorLevel(SILICON);
    const k = Math.round(MARKERS * state.ionized);
    const r = narrow ? 6.5 : 8;
    const py = band.toPxY(level);

    // ドーパント準位の短い破線
    drawThinLevel(
      ctx,
      band,
      MARKER_X0 - 0.06,
      MARKER_X1 + 0.06,
      level,
      colors,
      colors.solute,
      donor ? "E_D" : "E_A",
    );

    let nFree = 0;
    ctx.save();
    ctx.lineWidth = 1.6;
    for (let i = 0; i < MARKERS; i++) {
      const xv = MARKER_X0 + ((MARKER_X1 - MARKER_X0) * i) / (MARKERS - 1);
      const px = band.toPxX(xv);
      ctx.fillStyle = colors.bg;
      ctx.strokeStyle = colors.solute;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (isIonized(i, k)) {
        // イオン化: 符号だけ(+ はドナー、− はアクセプタ)
        ctx.beginPath();
        ctx.moveTo(px - r * 0.5, py);
        ctx.lineTo(px + r * 0.5, py);
        if (donor) {
          ctx.moveTo(px, py - r * 0.5);
          ctx.lineTo(px, py + r * 0.5);
        }
        ctx.stroke();
        freeX[nFree] = xv;
        freeY[nFree] = donor ? SILICON.eg + FREE_OFFSET : -FREE_OFFSET;
        nFree++;
      } else {
        // 束縛されたキャリア(輪の中の丸)
        ctx.fillStyle = donor ? colors.electron : colors.hole;
        ctx.beginPath();
        ctx.arc(px, py, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    drawElectronDots(ctx, band, freeX, freeY, nFree, {
      colors,
      radius: narrow ? 3.6 : 4.2,
      kind: donor ? "electron" : "hole",
    });
  }

  function drawBandPanel(narrow: boolean): void {
    drawPlotFrame(ctx, band, {
      colors,
      yTicks: E_TICKS,
      yLabel: "エネルギー E [eV]",
    });
    withPlotClip(ctx, band, () => {
      drawBandBox(ctx, band, 0, 1, SILICON.eg, E_MAX + 1, { colors });
      drawBandBox(ctx, band, 0, 1, E_MIN - 1, 0, { colors });
      drawThinLevel(ctx, band, 0.02, 0.84, state.eI, colors, colors.level);
      drawMarkers(narrow);
      drawFermiLine(ctx, band, 0, 1, state.eF, colors);
    });
    drawLabel(
      ctx,
      "E_i",
      band.toPxX(0.84) + 4,
      band.toPxY(state.eI),
      colors.level,
      "left",
    );
    drawLabel(
      ctx,
      "伝導帯",
      band.rect.x + band.rect.w - 6,
      band.toPxY(E_MAX) + 12,
      colors.text2,
      "right",
    );
    drawLabel(
      ctx,
      "価電子帯",
      band.rect.x + band.rect.w - 6,
      band.toPxY(E_MIN) - 10,
      colors.text2,
      "right",
    );
    if (state.degenerate) {
      drawBadge(
        ctx,
        narrow
          ? ["縮退 — ボルツマン近似は使えない", "(F₁/₂ で計算)"]
          : [
              "縮退 — ボルツマン近似は使えない",
              "(この図はフェルミ・ディラック積分で計算)",
            ],
        band.rect.x + band.rect.w - 4,
        band.rect.y + 22,
        colors,
        band.rect.w - 8,
      );
    }
  }

  function drawGraphPanel(narrow: boolean): void {
    drawPlotFrame(ctx, graph, {
      colors,
      xTicks: T_TICKS,
      yTicks: narrow ? logTicksNarrow : logTicksWide,
      xLabel: "温度 T [K]",
      yLabel: dopant === "B" ? "正孔密度 p [cm⁻³]" : "電子密度 n [cm⁻³]",
    });
    const majorityColor = dopant === "B" ? colors.hole : colors.electron;
    withPlotClip(ctx, graph, () => {
      // 3 領域の境界(薄い縦線)
      if (showRegions) {
        ctx.save();
        ctx.strokeStyle = colors.hairline;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        if (freezeEnd > T_MIN && freezeEnd < T_MAX) {
          ctx.moveTo(graph.toPxX(freezeEnd), graph.rect.y);
          ctx.lineTo(graph.toPxX(freezeEnd), graph.rect.y + graph.rect.h);
        }
        if (intrinsicStart > T_MIN && intrinsicStart < T_MAX) {
          ctx.moveTo(graph.toPxX(intrinsicStart), graph.rect.y);
          ctx.lineTo(graph.toPxX(intrinsicStart), graph.rect.y + graph.rect.h);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (dopant !== "none") {
        // ドーピング濃度の高さ(≈ N_D で一定の目安)
        const lc = Math.log10(conc);
        ctx.save();
        ctx.strokeStyle = colors.solute;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(graph.rect.x, graph.toPxY(lc));
        ctx.lineTo(graph.rect.x + graph.rect.w, graph.toPxY(lc));
        ctx.stroke();
        ctx.restore();
      }
      // n_i(T)(破線)
      drawCurve(ctx, graph, curveT, niLog, CURVE_POINTS, {
        color: colors.text2,
        width: 1.4,
        dash: [5, 4],
        alpha: 0.7,
      });
      // 多数キャリア密度
      drawCurve(ctx, graph, curveT, curveLog, CURVE_POINTS, {
        color: majorityColor,
        width: 2.4,
      });
      // 現在の温度
      const px = graph.toPxX(temperature);
      ctx.save();
      ctx.strokeStyle = colors.text2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, graph.rect.y);
      ctx.lineTo(px, graph.rect.y + graph.rect.h);
      ctx.stroke();
      const majority = dopant === "B" ? state.p : state.n;
      const ly = Math.log10(Math.max(majority, 1e-300));
      if (ly >= LOG_MIN - 0.5) {
        ctx.fillStyle = majorityColor;
        ctx.beginPath();
        ctx.arc(px, graph.toPxY(ly), 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // ラベル: n_i・N_D と 3 領域
    drawLabel(
      ctx,
      "n_i(T)",
      graph.toPxX(T_MAX) - 4,
      graph.toPxY(niLog[CURVE_POINTS - 1]) + 12,
      colors.text2,
      "right",
    );
    if (dopant !== "none") {
      const lc = Math.log10(conc);
      drawLabel(
        ctx,
        dopant === "P" ? "N_D" : "N_A",
        graph.rect.x + 4,
        graph.toPxY(lc) - 8,
        colors.solute,
        "left",
      );
    }
    if (showRegions) {
      const yLabel = graph.rect.y + graph.rect.h - 10;
      const symbol = dopant === "P" ? "N_D" : "N_A";
      const xFreeze = graph.toPxX(freezeEnd);
      const xIntrinsic = graph.toPxX(intrinsicStart);
      const xLeft = graph.rect.x;
      const xRight = graph.rect.x + graph.rect.w;
      if (xFreeze - xLeft >= 30) {
        drawLabel(
          ctx,
          "凍結",
          (xLeft + xFreeze) / 2,
          yLabel,
          colors.text2,
          "center",
        );
      }
      if (xIntrinsic - xFreeze >= 40) {
        drawLabel(
          ctx,
          narrow ? "外因性" : `外因性(≈ ${symbol} で一定)`,
          (xFreeze + xIntrinsic) / 2,
          yLabel,
          colors.text2,
          "center",
        );
      }
      if (intrinsicStart < T_MAX) {
        // 真性の領域は右端に寄るので、狭ければ右端にそろえて置く
        const wide = xRight - xIntrinsic >= 34;
        drawLabel(
          ctx,
          "真性",
          wide ? (xIntrinsic + xRight) / 2 : xRight - 3,
          yLabel - 16,
          colors.text2,
          wide ? "center" : "right",
        );
      }
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    const layout = splitByFraction(host.size, 0.58, 0.55);
    const a = layout.first;
    const b = layout.second;
    setPlotRange(
      band,
      a.x + 56,
      a.y + 10,
      a.w - 56 - 34,
      a.h - 10 - 18,
      0,
      1,
      E_MIN,
      E_MAX,
    );
    setPlotRange(
      graph,
      b.x + 58,
      b.y + 10,
      b.w - 58 - 12,
      b.h - 10 - 46,
      T_MIN,
      T_MAX,
      LOG_MIN,
      LOG_MAX,
    );
    drawBandPanel(narrow);
    drawSplitDivider(ctx, layout, colors);
    drawGraphPanel(narrow);

    // 読み取り値
    nItem.set(formatDensity(state.n));
    pItem.set(formatDensity(state.p));
    efItem.set(formatEvSigned(state.eF - state.eI));
    ionItem.set(dopant === "none" ? "—" : formatPercent(state.ionized));
    fractionItem.set(
      dopant === "none"
        ? "—(混ぜていない)"
        : formatOneIn(SILICON.atomDensity / conc),
    );
    const ni = intrinsicDensity(SILICON, temperature);
    const sigma = conductivity(SILICON, state.n, state.p);
    const sigmaI = conductivity(SILICON, ni, ni);
    sigmaItem.set(
      dopant === "none"
        ? "真性と同じ"
        : `真性の ${formatTimesRough(sigma / sigmaI)}`,
    );
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const nItem = readout.item("n", { color: "electron" });
  const pItem = readout.item("p", { color: "hole" });
  const efItem = readout.item("E_F − E_i", { color: "electron" });
  const ionItem = readout.item("イオン化率");
  const fractionItem = readout.item("不純物の割合");
  const sigmaItem = readout.item("導電率");

  const dopantSeg = host.controls.segmented<Dopant>({
    id: "dopant",
    label: "ドーパント",
    options: [
      { value: "none", label: "なし" },
      { value: "P", label: "リン P(n 型)" },
      { value: "B", label: "ホウ素 B(p 型)" },
    ],
    value: DOPANT_INIT,
  });
  const concSlider = host.controls.slider({
    id: "conc",
    label: "濃度",
    min: CONC_MIN,
    max: CONC_MAX,
    value: CONC_INIT,
    scale: "log",
    unit: "cm⁻³",
    format: (v) => fmtSci(snapLog(v), 2),
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

  dopantSeg.onChange((v) => {
    dopant = v;
    setControlEnabled(concSlider.el, v !== "none");
    recomputeAll();
  });
  concSlider.onChange((v) => {
    conc = snapLog(v);
    recomputeAll();
  });
  tSlider.onChange((v) => {
    temperature = v;
    recomputePoint();
  });

  host.controls.reset(() => {
    dopantSeg.set(DOPANT_INIT);
    concSlider.set(CONC_INIT);
    tSlider.set(T_INIT);
    dopant = DOPANT_INIT;
    conc = CONC_INIT;
    temperature = T_INIT;
    setControlEnabled(concSlider.el, true);
    recomputeAll();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
