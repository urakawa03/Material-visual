/**
 * pattern-builder.ts — 図6「回折図形を組み立てる」(仕様書 08 §5.6)
 *
 * 上段: 計算した粉末図形(横軸 2θ = 20〜140°、縦軸 相対強度)。
 * 下段: 選んだ線の因子の内訳(|F|²・m・L_p を棒で並べ、最後に積 I)。
 * 3 つの因子をトグルで 1 つずつ有効にし、有効でない因子は 1 として扱う
 * — 「位置だけ」→「構造だけ」→「構造 + 多重度」→「全部」と組み上がる。
 * 因子が全部 off のときは、格子(ブラベー格子)が許す線が全部同じ高さで並ぶ
 * (エヴァルト球の記事の粉末の環と同じ「位置だけ」の図形)。
 *
 * モデル: I ∝ |F_hkl(s)|² · m · L_p(θ)、L_p = (1 + cos²2θ)/(sin²θ cosθ)
 * (式 E5)。f(s) は Cromer–Mann。熱振動・吸収・試料の配向は入れていない。
 * 線の位置は図1 と同じ powderPattern(エヴァルト球の記事の twoThetaDeg)。
 *
 * |F|² は波長によらない(s = 1/(2d) は面間隔だけで決まる)ので、物質を
 * 変えたときだけ数え直し、λ を動かしたときは 2θ と L_p だけを付け直す。
 *
 * 実装方式: requestRender 型。乱数不使用。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fmtSig, font } from "../../core/plot";
import { createReadout, createStepper } from "../reciprocal-lattice/_shared2d";
import {
  CSCL,
  CU,
  FE,
  KCL,
  NACL,
  SI,
  type CrystalStructure,
} from "./lib/structures";
import {
  applyWavelength,
  formatHkl,
  formatRing,
  maxIndexFor,
  powderRingBase,
  type PowderLine,
  type PowderRingBase,
} from "./lib/structurefactor";
import {
  PEAK_FWHM_DEG,
  allowReadoutWrap,
  createPeakList,
  createPlotArea,
  createProfileBuffer,
  drawHklLabel,
  drawIntensityAxis,
  drawProfile,
  drawRotatedLabel,
  drawTwoThetaAxis,
  haloText,
  hollowCircle,
  labelsCollide,
  peakSigmaDeg,
  plotX,
  plotY,
  resolvePalette,
  setPlotArea,
  tooSmall,
  withPlotClip,
} from "./lib/draw";

type MaterialId = "fe" | "cu" | "si" | "nacl" | "cscl" | "kcl";
const MATERIALS: Readonly<Record<MaterialId, CrystalStructure>> = {
  fe: FE,
  cu: CU,
  si: SI,
  nacl: NACL,
  cscl: CSCL,
  kcl: KCL,
};
const MATERIAL_INIT: MaterialId = "si";

/** 波長 λ の範囲・刻み・初期値(nm — 仕様書 08 §5.6) */
const LAMBDA_MIN = 0.1;
const LAMBDA_MAX = 0.25;
const LAMBDA_STEP = 0.001;
const LAMBDA_INIT = 0.15406;

const TT_MIN = 20;
const TT_MAX = 140;
/** 山の画面上の最小半値幅(px) */
const MIN_FWHM_PX = 1.2;
/** ラベルを付ける線の数(強い順 — 仕様書 08 §5.6) */
const LABEL_COUNT = 6;
/** 線のクリック判定の幅(px) */
const PICK_PX = 10;
/** 粉末図形の段に割り当てる高さの割合(広幅 / 狭幅) */
const PATTERN_FRACTION_WIDE = 0.64;
const PATTERN_FRACTION_NARROW = 0.56;
const NARROW_W = 560;

const FACTORS_INIT = { F2: false, m: false, Lp: false };

export default function patternBuilder(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /* ---- 状態 ---- */

  let material: MaterialId = MATERIAL_INIT;
  let lambda = LAMBDA_INIT;
  let useF2 = FACTORS_INIT.F2;
  let useM = FACTORS_INIT.m;
  let useLp = FACTORS_INIT.Lp;
  /** 選んだ線(lines の添字) */
  let selected = 0;

  /* ---- 派生量 ---- */

  let base: PowderRingBase[] = [];
  /** 格子が許す線で、いまの λ で 20〜140° に入るもの(低角から) */
  let lines: PowderLine[] = [];
  /** 表示する相対強度(最大 100) */
  let shownI = new Float64Array(0);
  /** 強い順の添字 */
  let order: number[] = [];
  /** 因子ごとの最大(内訳の棒の長さの基準) */
  let maxF2 = 1;
  let maxM = 1;
  let maxLp = 1;

  const peaks = createPeakList(256);
  const profileBuf = createProfileBuffer(256);
  const plot = createPlotArea();
  const labelXs = new Float64Array(LABEL_COUNT);
  const labelWs = new Float64Array(LABEL_COUNT);
  const labelIdx = new Int32Array(LABEL_COUNT);
  let labelCount = 0;
  /** ラベルの文字(線ごと)と幅 */
  let labelText: string[][] = [];
  let labelWidth = new Float64Array(0);

  function rebuildBase(): void {
    const st = MATERIALS[material];
    base = powderRingBase(st, maxIndexFor(st.a, LAMBDA_MIN, TT_MAX), "xray");
  }

  function recompute(): void {
    const prevN2 = lines[selected]?.n2;
    lines = applyWavelength(base, lambda, "xray").filter(
      (r) => r.latticeAllowed && r.twoTheta >= TT_MIN && r.twoTheta <= TT_MAX,
    );
    maxF2 = Math.max(1e-30, ...lines.map((r) => r.F2));
    maxM = Math.max(1, ...lines.map((r) => r.m));
    maxLp = Math.max(1e-30, ...lines.map((r) => r.Lp));
    const raw = lines.map(
      (r) => (useF2 ? r.F2 : 1) * (useM ? r.m : 1) * (useLp ? r.Lp : 1),
    );
    const max = Math.max(1e-30, ...raw);
    shownI = Float64Array.from(raw.map((v) => (100 * v) / max));
    order = lines
      .map((_, i) => i)
      .sort((a, b) => shownI[b] - shownI[a] || a - b);

    peaks.count = 0;
    lines.forEach((r, i) => {
      if (shownI[i] <= 0) return;
      peaks.tt[peaks.count] = r.twoTheta;
      peaks.height[peaks.count] = shownI[i];
      peaks.count++;
    });

    ctx.font = font(11);
    labelText = lines.map((r) => r.forms.map((f) => formatHkl(f.h, f.k, f.l)));
    labelWidth = Float64Array.from(
      labelText.map((ls) =>
        Math.max(...ls.map((s) => ctx.measureText(s).width)),
      ),
    );
    // 強い順に 6 本(0 の線は除く)を、画面の左から順に並べ替えて持つ
    const top = order.filter((i) => shownI[i] > 0).slice(0, LABEL_COUNT);
    top.sort((a, b) => a - b);
    labelCount = top.length;
    top.forEach((i, j) => {
      labelIdx[j] = i;
      labelWs[j] = labelWidth[i];
    });

    // 選んだ線は同じ環を追いかける(λ を動かしても同じ反射を見続ける)
    const keep = lines.findIndex((r) => r.n2 === prevN2);
    selected = keep >= 0 ? keep : Math.min(selected, lines.length - 1);
    lineStepper.setMax(Math.max(1, lines.length));
    if (lineStepper.value !== selected + 1) lineStepper.set(selected + 1);
    updateReadout();
  }

  /* ---- 読み取り値(仕様書 08 §5.6) ---- */

  const readout = createReadout(host);
  const selItem = readout.item("選んだ線", { color: "recip" });
  const factorItem = readout.item("因子");
  const topItem = readout.item("強い順(相対強度)");
  allowReadoutWrap(readout.el);

  function updateReadout(): void {
    const r = lines[selected];
    if (!r) {
      selItem.set("—");
      factorItem.set("—");
    } else {
      selItem.set(`${formatRing(r)} 2θ = ${r.twoTheta.toFixed(2)}°`);
      factorItem.set(
        `|F|² = ${fmtSig(r.F2, 3)}、m = ${r.m}、L_p = ${fmtSig(r.Lp, 3)}` +
          ` → 相対強度 ${fmtSig(shownI[selected], 3)}`,
      );
    }
    topItem.set(
      order
        .filter((i) => shownI[i] > 0)
        .slice(0, LABEL_COUNT)
        .map(
          (i) =>
            `${formatRing(lines[i])} ${lines[i].twoTheta.toFixed(2)}° ${fmtSig(shownI[i], 3)}`,
        )
        .join("、"),
    );
  }

  /* ---- 描画 ---- */

  function patternHeight(): number {
    const { w, h } = host.size;
    return h * (w < NARROW_W ? PATTERN_FRACTION_NARROW : PATTERN_FRACTION_WIDE);
  }

  function drawPattern(): void {
    const { w } = host.size;
    const ml = 46;
    const mr = 14;
    const top = 38;
    const ph = patternHeight();
    setPlotArea(plot, ml, top, w - ml - mr, ph - top - 34, TT_MIN, TT_MAX, 100);
    drawIntensityAxis(ctx, plot, pal, INTENSITY_TICKS, (v) => String(v));
    drawRotatedLabel(ctx, "相対強度", 13, plot.y + plot.h / 2, pal.text2);
    drawTwoThetaAxis(ctx, plot, pal, true);

    // 選んだ線の位置(アクセント色の細い縦線と、軸の下の三角)
    const sel = lines[selected];
    if (sel) {
      const x = plotX(plot, sel.twoTheta);
      ctx.strokeStyle = pal.accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, plot.y);
      ctx.lineTo(Math.round(x) + 0.5, plot.y + plot.h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      const yb = plot.y + plot.h + 1;
      ctx.moveTo(x, yb);
      ctx.lineTo(x - 5, yb + 7);
      ctx.lineTo(x + 5, yb + 7);
      ctx.closePath();
      ctx.fill();
    }

    withPlotClip(
      ctx,
      plot,
      () => {
        drawProfile(
          ctx,
          plot,
          peaks,
          profileBuf,
          peakSigmaDeg(plot, PEAK_FWHM_DEG, MIN_FWHM_PX),
          pal.recip,
        );
      },
      2,
    );

    // 構造で消えた線(格子は許すが |F|² = 0)の印
    if (useF2) {
      const base0 = plotY(plot, 0);
      lines.forEach((r, i) => {
        if (shownI[i] > 0) return;
        hollowCircle(ctx, plotX(plot, r.twoTheta), base0 - 7, 3.5, pal.recip);
      });
    }

    // (hkl) ラベル(強い順に 6 本)
    for (let j = 0; j < labelCount; j++) {
      labelXs[j] = plotX(plot, lines[labelIdx[j]].twoTheta);
    }
    const rotated = labelsCollide(labelXs, labelWs, labelCount);
    for (let j = 0; j < labelCount; j++) {
      const i = labelIdx[j];
      drawHklLabel(
        ctx,
        labelText[i],
        labelXs[j],
        plotY(plot, shownI[i]),
        plotY(plot, 0),
        rotated,
        pal.recip,
        pal.bg,
        6,
      );
    }

    // いま有効な因子
    ctx.font = font(12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const on = [useF2 ? "|F|²" : "", useM ? "m" : "", useLp ? "L_p" : ""]
      .filter(Boolean)
      .join(" × ");
    haloText(
      ctx,
      on ? `I ∝ ${on}` : "因子なし(位置だけ)",
      w - mr,
      6,
      pal.text2,
      pal.bg,
    );
  }

  function drawBreakdown(): void {
    const { w, h } = host.size;
    const top = patternHeight() + 4;
    const r = lines[selected];
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top - 0.5);
    ctx.lineTo(w, top - 0.5);
    ctx.stroke();
    if (!r) return;

    ctx.font = font(13, 600);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      `${formatRing(r)}(2θ = ${r.twoTheta.toFixed(2)}°)の内訳`,
      12,
      top + 8,
    );

    const rowsTop = top + 32;
    const rowH = Math.min(30, (h - rowsTop - 8) / 4);
    const labelW = w < NARROW_W ? 92 : 150;
    const valueW = w < NARROW_W ? 74 : 110;
    const x0 = 12 + labelW;
    const barMax = Math.max(20, w - x0 - valueW - 16);
    const rows: Array<{
      name: string;
      on: boolean;
      frac: number;
      value: string;
    }> = [
      {
        name: "|F|² 構造",
        on: useF2,
        frac: r.F2 / maxF2,
        value: fmtSig(r.F2, 3),
      },
      {
        name: "m 多重度",
        on: useM,
        frac: r.m / maxM,
        value: String(r.m),
      },
      {
        name: w < NARROW_W ? "L_p 幾何" : "L_p 測定の幾何",
        on: useLp,
        frac: r.Lp / maxLp,
        value: fmtSig(r.Lp, 3),
      },
      {
        name: "I 相対強度",
        on: true,
        frac: shownI[selected] / 100,
        value: fmtSig(shownI[selected], 3),
      },
    ];
    rows.forEach((row, i) => {
      const y = rowsTop + i * rowH + rowH / 2;
      const bh = Math.min(14, rowH * 0.5);
      const isI = i === 3;
      ctx.font = font(12, isI ? 600 : 400);
      ctx.fillStyle = row.on ? pal.text : pal.text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(row.name, 12, y);
      // 棒(off の因子は 1 として扱う → 棒は薄く、値の横に注記)
      ctx.fillStyle = isI ? pal.recip : pal.text2;
      ctx.globalAlpha = row.on ? (isI ? 1 : 0.55) : 0.15;
      ctx.fillRect(x0, y - bh / 2, Math.max(1, row.frac * barMax), bh);
      ctx.globalAlpha = 1;
      ctx.font = font(12);
      ctx.fillStyle = row.on ? pal.text : pal.text2;
      ctx.textAlign = "left";
      ctx.fillText(
        row.on ? row.value : `${row.value}(off → 1)`,
        x0 + Math.max(1, row.frac * barMax) + 6,
        y,
      );
    });
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    drawPattern();
    drawBreakdown();
  }

  /* ---- 操作部品(仕様書 08 §5.6) ---- */

  const materialSeg = host.controls.segmented<MaterialId>({
    id: "material",
    label: "物質",
    options: [
      { value: "fe", label: "Fe" },
      { value: "cu", label: "Cu" },
      { value: "si", label: "Si" },
      { value: "nacl", label: "NaCl" },
      { value: "cscl", label: "CsCl" },
      { value: "kcl", label: "KCl" },
    ],
    value: MATERIAL_INIT,
  });
  materialSeg.onChange((v) => {
    material = v;
    rebuildBase();
    selected = 0;
    lines = [];
    recompute();
  });

  const f2Toggle = host.controls.toggle({
    id: "f2",
    label: "構造 |F|²",
    value: FACTORS_INIT.F2,
  });
  f2Toggle.onChange((v) => {
    useF2 = v;
    recompute();
  });
  const mToggle = host.controls.toggle({
    id: "m",
    label: "多重度 m",
    value: FACTORS_INIT.m,
  });
  mToggle.onChange((v) => {
    useM = v;
    recompute();
  });
  const lpToggle = host.controls.toggle({
    id: "lp",
    label: "ローレンツ偏光 L_p",
    value: FACTORS_INIT.Lp,
  });
  lpToggle.onChange((v) => {
    useLp = v;
    recompute();
  });

  const lambdaSlider = host.controls.slider({
    id: "lambda",
    label: "波長 λ",
    min: LAMBDA_MIN,
    max: LAMBDA_MAX,
    step: LAMBDA_STEP,
    value: LAMBDA_INIT,
    unit: "nm",
    format: (v) => (v === LAMBDA_INIT ? "0.15406(Cu Kα)" : v.toFixed(3)),
  });
  lambdaSlider.onChange((v) => {
    lambda = v;
    recompute();
  });

  const lineStepper = createStepper(host, {
    label: "選ぶ線(低角から)",
    min: 1,
    max: 1,
    value: 1,
  });
  lineStepper.onChange((v) => {
    selected = v - 1;
    updateReadout();
  });

  host.controls.reset(() => {
    f2Toggle.set(FACTORS_INIT.F2);
    mToggle.set(FACTORS_INIT.m);
    lpToggle.set(FACTORS_INIT.Lp);
    lambdaSlider.set(LAMBDA_INIT);
    materialSeg.set(MATERIAL_INIT);
    selected = 0;
    lines = [];
    recompute();
    lineStepper.set(1);
  });

  /* ---- 線のクリックで選ぶ ---- */

  function onClick(e: MouseEvent): void {
    const rect = host.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y > patternHeight()) return;
    let best = -1;
    let bestD = PICK_PX;
    lines.forEach((r, i) => {
      const d = Math.abs(plotX(plot, r.twoTheta) - x);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) lineStepper.set(best + 1);
  }
  host.canvas.addEventListener("click", onClick);

  /* ---- 登録・初期状態(requestRender 型) ---- */

  host.onRender(draw);
  rebuildBase();
  recompute();

  return {
    destroy(): void {
      host.canvas.removeEventListener("click", onClick);
      readout.el.remove();
      lineStepper.el.remove();
    },
  };
}

/** 相対強度の目盛り */
const INTENSITY_TICKS: readonly number[] = [0, 50, 100];
