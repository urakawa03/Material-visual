/**
 * missing-reflections.ts — 図1「欠けている線」(仕様書 08 §5.1)
 *
 * Cu Kα で測った Fe(体心立方)・Cu(面心立方)・Si(ダイヤモンド構造)の
 * 粉末回折図形を縦に 3 段並べる。各段には「格子定数が同じ単純立方なら線が
 * 出る位置」を細い縦線(ゴースト)で重ね、実際の線(--mat-recip の山)と
 * 比べられるようにする。「欠けた線に印を付ける」で、ゴーストだけで線のない
 * 位置に中抜きの小円を置き、Si で面心立方(格子)としては許されるのに欠ける
 * 線((200)・(222)・(420)・(600)/(442))には、さらに破線の丸を付ける。
 *
 * 計算は図6 と同じ powderPattern(線の位置はエヴァルト球の記事の
 * twoThetaDeg)。強度の中身は 6 節で扱うので、ここでは位置と有無に注目させる
 * (図注で明示)。
 *
 * 実装方式: requestRender 型(自動再生なし)。乱数不使用。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { font } from "../../core/plot";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { CU, FE, SI, type CrystalStructure } from "./lib/structures";
import {
  formatHkl,
  maxIndexFor,
  powderPattern,
  type PowderLine,
} from "./lib/structurefactor";
import {
  PEAK_FWHM_DEG,
  createPeakList,
  createPlotArea,
  createProfileBuffer,
  dashedCircle,
  drawHklLabel,
  drawProfile,
  drawTwoThetaAxis,
  haloText,
  hollowCircle,
  labelsCollide,
  peakSigmaDeg,
  plotX,
  plotY,
  resolvePalette,
  setPlotArea,
  type PeakList,
  type PlotArea,
} from "./lib/draw";

/** Cu Kα₁ の波長(nm — 仕様書 08 §2.3) */
const LAMBDA = 0.15406;
/** 横軸の範囲(度) */
const TT_MIN = 20;
const TT_MAX = 140;
/** 山の画面上の最小半値幅(px)。0.15° が 1 px を切る幅でも線として見えるように */
const MIN_FWHM_PX = 1.2;
/** 余白(CSS px) */
const MARGIN_X = 14;
const AXIS_H = 36;
const PANEL_GAP = 12;
/** 山の頂の上に横書きラベルを置くための余白 */
const LABEL_HEADROOM = 16;
/** 凡例の高さ(1 行 / 狭幅では 2 行) */
const LEGEND_H_WIDE = 24;
const LEGEND_H_NARROW = 40;
/** 狭幅と判定する幅 */
const NARROW_W = 560;
/** 欠けた線の印(中抜きの小円)と「面心立方なら出るはず」の破線の丸の半径 */
const MISSING_R = 3.5;
const UNEXPLAINED_R = 8;
/** 印を基線からどれだけ上に置くか */
const MARK_LIFT = 7;

type Selection = "all" | "fe" | "cu" | "si";
const SELECTION_INIT: Selection = "all";
const MARKS_INIT = true;

/** 1 物質ぶんの前計算(状態によらない) */
interface Panel {
  id: Exclude<Selection, "all">;
  st: CrystalStructure;
  title: string;
  /** 単純立方なら線が出る位置(全環の 2θ) */
  ghosts: Float64Array;
  /** 実際の線(相対強度つき) */
  peaks: PeakList;
  /** 実際の線のラベル(族が重なる環は複数行) */
  labels: string[][];
  /** 横書きのときのラベル幅(px) */
  labelWidths: Float64Array;
  /** ラベルを置く画面 x(描画ごとに書き換える) */
  labelXs: Float64Array;
  /** 欠けた線の 2θ と「格子では説明できない」印 */
  missing: Float64Array;
  unexplained: Uint8Array;
  /** 読み取り値の文 */
  summary: string;
}

function lineLabel(line: PowderLine): string[] {
  return line.forms.map((f) => formatHkl(f.h, f.k, f.l));
}

function buildPanel(
  id: Panel["id"],
  st: CrystalStructure,
  ctx: CanvasRenderingContext2D,
): Panel {
  const lines = powderPattern(
    st,
    LAMBDA,
    maxIndexFor(st.a, LAMBDA, TT_MAX),
  ).filter((r) => r.twoTheta >= TT_MIN && r.twoTheta <= TT_MAX);
  const present = lines.filter((r) => r.I > 0);
  const absent = lines.filter((r) => r.I === 0);
  const maxI = Math.max(...present.map((r) => r.I));

  const peaks = createPeakList(present.length);
  present.forEach((r, i) => {
    peaks.tt[i] = r.twoTheta;
    peaks.height[i] = (100 * r.I) / maxI;
  });
  peaks.count = present.length;

  ctx.font = font(11);
  const labels = present.map(lineLabel);
  const labelWidths = new Float64Array(labels.length);
  labels.forEach((ls, i) => {
    labelWidths[i] = Math.max(...ls.map((s) => ctx.measureText(s).width));
  });

  const unexplained = new Uint8Array(absent.length);
  absent.forEach((r, i) => {
    unexplained[i] = r.latticeAllowed ? 1 : 0;
  });
  const nUnexplained = absent.filter((r) => r.latticeAllowed).length;
  const nExplained = absent.length - nUnexplained;
  const first = present
    .slice(0, 3)
    .map((r) => `${lineLabel(r).join("/")} ${r.twoTheta.toFixed(2)}°`)
    .join("、");

  return {
    id,
    st,
    title: `${st.label}(${st.structureName})`,
    ghosts: Float64Array.from(lines.map((r) => r.twoTheta)),
    peaks,
    labels,
    labelWidths,
    labelXs: new Float64Array(labels.length),
    missing: Float64Array.from(absent.map((r) => r.twoTheta)),
    unexplained,
    summary:
      `最初の線 ${first} ・ 欠けた線: 格子で説明できる ${nExplained} 本、` +
      `格子では説明できない ${nUnexplained} 本`,
  };
}

export default function missingReflections(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /* ---- 前計算(物質ごとの図形は状態によらない) ---- */

  const panels: Panel[] = [
    buildPanel("fe", FE, ctx),
    buildPanel("cu", CU, ctx),
    buildPanel("si", SI, ctx),
  ];
  const maxPeaks = Math.max(...panels.map((p) => p.peaks.count));
  const profileBuf = createProfileBuffer(maxPeaks);
  const plot: PlotArea = createPlotArea();
  /** 選択ごとの表示パネル(描画のたびに配列を作らない) */
  const shownBySelection: Record<Selection, readonly Panel[]> = {
    all: panels,
    fe: [panels[0]],
    cu: [panels[1]],
    si: [panels[2]],
  };

  /** 凡例の文と幅(フォント固定なので初期化時に一度だけ測る) */
  const LEGEND_GHOST = "単純立方なら線が出る位置";
  const LEGEND_MISSING = "欠けた線";
  const LEGEND_FCC = "面心立方なら出るはずの線";
  ctx.font = font(12);
  const legendGhostW = ctx.measureText(LEGEND_GHOST).width;
  const legendMissingW = ctx.measureText(LEGEND_MISSING).width;

  /* ---- 状態 ---- */

  let selection: Selection = SELECTION_INIT;
  let showMarks = MARKS_INIT;

  /* ---- 読み取り値(仕様書 08 §5.1) ---- */

  const readout = createReadout(host);
  const items = panels.map((p) => {
    const item = readout.item(p.title, { color: "recip" });
    // 長い文なので折り返しを許す(狭幅で横にはみ出さないように)
    item.el.style.whiteSpace = "normal";
    item.set(p.summary);
    return item;
  });

  function updateReadout(): void {
    panels.forEach((p, i) => {
      items[i].el.style.display =
        selection === "all" || selection === p.id ? "" : "none";
    });
  }

  /* ---- 描画 ---- */

  function drawLegend(narrow: boolean, showSi: boolean): void {
    ctx.font = font(12);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const y1 = 12;
    let x = MARGIN_X;
    // ゴースト線
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 4.5, y1 - 7);
    ctx.lineTo(x + 4.5, y1 + 7);
    ctx.stroke();
    ctx.fillStyle = pal.text2;
    ctx.fillText(LEGEND_GHOST, x + 12, y1);
    x += 12 + legendGhostW + 18;
    if (!showMarks) return;
    let y = y1;
    if (narrow) {
      x = MARGIN_X;
      y = y1 + 18;
    }
    hollowCircle(ctx, x + 4, y, MISSING_R, pal.recip);
    ctx.fillStyle = pal.text2;
    ctx.fillText(LEGEND_MISSING, x + 12, y);
    x += 12 + legendMissingW + 18;
    if (!showSi) return;
    dashedCircle(ctx, x + 8, y, 7, pal.recip);
    ctx.fillStyle = pal.text2;
    ctx.fillText(LEGEND_FCC, x + 20, y);
  }

  function drawPanel(
    p: Panel,
    top: number,
    bottom: number,
    last: boolean,
  ): void {
    setPlotArea(
      plot,
      MARGIN_X,
      top + LABEL_HEADROOM,
      host.size.w - MARGIN_X * 2,
      bottom - top - LABEL_HEADROOM,
      TT_MIN,
      TT_MAX,
      100,
    );
    const base = plotY(plot, 0);

    // 単純立方なら線が出る位置(ゴースト)
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < p.ghosts.length; i++) {
      const x = Math.round(plotX(plot, p.ghosts[i])) + 0.5;
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, base);
    }
    ctx.stroke();

    drawTwoThetaAxis(ctx, plot, pal, last);

    // 実際の線(ガウス形の山 — 半値幅 0.15°)
    drawProfile(
      ctx,
      plot,
      p.peaks,
      profileBuf,
      peakSigmaDeg(plot, PEAK_FWHM_DEG, MIN_FWHM_PX),
      pal.recip,
    );

    // 欠けた線の印
    if (showMarks) {
      for (let i = 0; i < p.missing.length; i++) {
        const x = plotX(plot, p.missing[i]);
        hollowCircle(ctx, x, base - MARK_LIFT, MISSING_R, pal.recip);
        if (p.unexplained[i]) {
          dashedCircle(ctx, x, base - MARK_LIFT, UNEXPLAINED_R, pal.recip);
        }
      }
    }

    // (hkl) ラベル(横書きで重なるなら縦書きにする)
    for (let i = 0; i < p.peaks.count; i++) {
      p.labelXs[i] = plotX(plot, p.peaks.tt[i]);
    }
    const rotated = labelsCollide(p.labelXs, p.labelWidths, p.peaks.count);
    for (let i = 0; i < p.peaks.count; i++) {
      drawHklLabel(
        ctx,
        p.labels[i],
        p.labelXs[i],
        plotY(plot, p.peaks.height[i]),
        base,
        rotated,
        pal.recip,
        pal.bg,
        top,
      );
    }

    // 物質名(右上 — 高角側の線は弱く、ここは空いている)
    ctx.font = font(13, 600);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    haloText(ctx, p.title, host.size.w - MARGIN_X, top + 2, pal.text, pal.bg);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_W;
    const shown = shownBySelection[selection];
    const showSi = selection === "all" || selection === "si";
    drawLegend(narrow, showSi);

    const legendH = narrow && showMarks ? LEGEND_H_NARROW : LEGEND_H_WIDE;
    const top0 = legendH + 4;
    const bottom = h - AXIS_H;
    const n = shown.length;
    const ph = (bottom - top0 - PANEL_GAP * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const top = top0 + i * (ph + PANEL_GAP);
      drawPanel(shown[i], top, top + ph, i === n - 1);
    }
  }

  /* ---- 操作部品(仕様書 08 §5.1) ---- */

  const marksToggle = host.controls.toggle({
    id: "marks",
    label: "欠けた線に印を付ける",
    value: MARKS_INIT,
  });
  marksToggle.onChange((v) => {
    showMarks = v;
  });

  const selectionSeg = host.controls.segmented<Selection>({
    id: "material",
    label: "表示する物質",
    options: [
      { value: "all", label: "3 つとも" },
      { value: "fe", label: "Fe" },
      { value: "cu", label: "Cu" },
      { value: "si", label: "Si" },
    ],
    value: SELECTION_INIT,
  });
  selectionSeg.onChange((v) => {
    selection = v;
    updateReadout();
  });

  host.controls.reset(() => {
    marksToggle.set(MARKS_INIT);
    selectionSeg.set(SELECTION_INIT);
  });

  /* ---- 登録・初期状態(requestRender 型) ---- */

  host.onRender(draw);
  updateReadout();

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
