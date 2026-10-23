/**
 * band-bending.ts — 図3「一直線の E_F と曲がったバンド」(仕様書 13 §5.3)
 *
 * バンド図: E_c(x)・E_v(x) を drawBandRibbon で(伝導帯は E_c から上へ、価電子帯
 * は E_v から下へ一定幅の帯)。E_i(x) を細い破線、E_F をフェルミ準位記事の太い
 * 破線で**全幅にわたって一直線**に描く。空乏層の両端に縦の破線(図2 と同じ
 * 位置)。左右の中性領域に「E_F と E_i の差」の矢印(p 側は E_i から下向き・
 * n 側は上向き)、右端に全体の段差 qV_bi の寸法線。
 *
 * 「接触前と比べる」: フェルミ準位記事の図7 の「接触前」の 2 つのブロック
 * (バンド端が揃い、E_F が食い違った状態)をゴースト(`--color-hairline`)で
 * 重ね、E_F の食い違い = 段差を並べた寸法線で対応させる。
 *
 * 論理の順序(本文と同じ): E_F は平衡で一直線でなければならない → 左右で E_F に
 * 対するバンドの位置が違う → 両方を満たすにはバンドが曲がるしかない。
 *
 * モデル: lib/junction.ts の bandEdges(式 E1・E3)。両側の E_F は
 * solveFermiLevel。図2 と同じ空乏層近似・同じ表示範囲の規則。
 *
 * 実装方式: 2D Canvas / requestRender(アイドル時は再描画しない)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fmtSci } from "../../core/plot";
import { createReadout, drawArrow } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawPlotFrame,
  PLOT_FONT,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { intrinsicLevel, SILICON } from "../_shared/semiconductor";
import { DOPING_INIT, ROOM_T } from "./lib/constants";
import { depletion, displayHalfRange, type Depletion } from "./lib/junction";
import {
  AnimatedRange,
  BandSamples,
  curveSamples,
  drawBands,
  drawBoxedLabel,
  drawDimension,
  drawEdgeLine,
  drawFermiLine,
  drawIntrinsicCurve,
  drawLabel,
  formatEvFixed,
  micronTicks,
  NARROW_WIDTH_PX,
  pnColors,
  snapLog,
} from "./lib/draw";

/** 操作パラメータ(§5.3 の表) */
const DOPING_MIN = 1e14;
const DOPING_MAX = 1e18;
/** 帯の見た目の厚み [eV] */
const BAND_THICKNESS = 0.36;
/** 縦軸 [eV](V_bi は最大 0.93 V なので、n 側の E_v は −0.93 eV まで下がる) */
const E_MIN = -1.38;
const E_MAX = 1.62;
/** 接触前のブロックの隙間(表示範囲の半幅に対する割合) */
const GHOST_GAP = 0.04;

const E_TICKS: readonly AxisTick[] = [-1, -0.5, 0, 0.5, 1, 1.5].map((v) => ({
  value: v,
  label: v === 0 ? "0" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`,
}));

export default function bandBending(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = pnColors();
  const m = createPlotMapper();
  const bands = new BandSamples(241);
  const eiBulk = intrinsicLevel(SILICON, ROOM_T);

  /* ---- 状態 ---- */
  let nA = DOPING_INIT;
  let nD = DOPING_INIT;
  let compare = false;
  let d: Depletion = depletion(SILICON, nA, nD, 0, ROOM_T);
  const range = new AnimatedRange(displayHalfRange(d));

  function recompute(): void {
    d = depletion(SILICON, nA, nD, 0, ROOM_T);
    range.set(displayHalfRange(d), () => host.requestRender());
  }

  /** 接触前のブロック(ゴースト): バンド端が揃い、E_F が食い違った状態 */
  function drawGhost(R: number): void {
    const g = GHOST_GAP * R;
    const blocks: Array<[number, number, number]> = [
      [-R, -g, d.efp],
      [g, R, d.efn],
    ];
    ctx.save();
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 2.2;
    for (const [x0, x1, ef] of blocks) {
      const p0 = m.toPxX(x0);
      const p1 = m.toPxX(x1);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p0, m.toPxY(SILICON.eg));
      ctx.lineTo(p1, m.toPxY(SILICON.eg));
      ctx.moveTo(p0, m.toPxY(0));
      ctx.lineTo(p1, m.toPxY(0));
      ctx.stroke();
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(p0, m.toPxY(ef));
      ctx.lineTo(p1, m.toPxY(ef));
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    const R = range.value;
    const left = narrow ? 44 : 56;
    const right = narrow ? 8 : 12;
    const top = 24;
    const bottom = 42;
    setPlotRange(
      m,
      left,
      top,
      w - left - right,
      h - top - bottom,
      -R,
      R,
      E_MIN,
      E_MAX,
    );
    drawPlotFrame(ctx, m, {
      colors,
      xTicks: micronTicks(-R, R, narrow ? 4 : 7),
      yTicks: E_TICKS,
      xLabel: "位置 x [μm]",
      yLabel: narrow ? undefined : "電子のエネルギー [eV]",
    });

    bands.sample(SILICON, d, ROOM_T, -R, R, curveSamples(w), BAND_THICKNESS);
    const eF = d.efp; // 熱平衡: E_F は p 側の値のまま全幅で一直線
    const ecN = SILICON.eg - d.vbi;

    withPlotClip(ctx, m, () => {
      if (compare) drawGhost(R);
      drawBands(ctx, m, bands, colors);
      drawIntrinsicCurve(ctx, m, bands, colors.level);
      // 空乏層の両端(図2 と同じ位置)
      for (const x of [-d.xp, d.xn]) drawEdgeLine(ctx, m, x, colors.text2);
      // E_F(全幅で水平)
      drawFermiLine(ctx, m, -R, R, eF, colors, "");
      // p 側の E_c の高さを右へ延ばした参照線(段差の寸法の起点)
      ctx.save();
      ctx.strokeStyle = colors.text2;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(m.toPxX(-d.xp), m.toPxY(SILICON.eg));
      ctx.lineTo(m.toPxX(R), m.toPxY(SILICON.eg));
      ctx.stroke();
      ctx.restore();
    });

    // E_F と E_i の差(中性領域。p 側は E_i から下向き、n 側は上向き)
    const xp = m.toPxX(-R + 0.42 * (R - d.xp));
    const xn = m.toPxX(R - 0.62 * (R - d.xn));
    const ypEi = m.toPxY(eiBulk);
    const ypEf = m.toPxY(eF);
    const ynEi = m.toPxY(eiBulk - d.vbi);
    drawArrow(ctx, xp, ypEi, xp, ypEf, {
      color: colors.text2,
      width: 1.4,
      head: 7,
    });
    drawArrow(ctx, xn, ynEi, xn, ypEf, {
      color: colors.text2,
      width: 1.4,
      head: 7,
    });
    const pDiff = eiBulk - d.efp;
    const nDiff = d.efn - eiBulk;
    drawBoxedLabel(
      ctx,
      narrow ? formatEvFixed(pDiff) : `E_i − E_F = ${formatEvFixed(pDiff)}`,
      xp + 6,
      (ypEi + ypEf) / 2,
      colors,
      "left",
      colors.text,
    );
    drawBoxedLabel(
      ctx,
      narrow ? formatEvFixed(nDiff) : `E_F − E_i = ${formatEvFixed(nDiff)}`,
      xn + 6,
      (ynEi + ypEf) / 2,
      colors,
      "left",
      colors.text,
    );

    // 右端: 全体の段差 qV_bi
    const xStep = m.rect.x + m.rect.w - (narrow ? 12 : 16);
    drawDimension(
      ctx,
      xStep,
      m.toPxY(SILICON.eg),
      m.toPxY(ecN),
      narrow ? `qV_bi` : `qV_bi = ${formatEvFixed(d.vbi)}`,
      colors,
      "left",
    );
    if (compare) {
      // 接触前の E_F の食い違い(段差と同じ長さ)
      const xGap = xStep - (narrow ? 58 : 150);
      drawDimension(
        ctx,
        xGap,
        m.toPxY(d.efn),
        m.toPxY(eF),
        narrow ? "E_F の差" : "接触前の E_F の差",
        colors,
        "left",
      );
      drawLabel(
        ctx,
        "接触前(薄い線)",
        m.rect.x + m.rect.w - 4,
        m.toPxY(d.efn) - 10,
        colors.text2,
        "right",
      );
    }

    // ラベル
    drawLabel(ctx, "p 型", m.toPxX(-R) + 4, 10, colors.hole, "left");
    drawLabel(ctx, "n 型", m.toPxX(R) - 4, 10, colors.electron, "right");
    drawLabel(
      ctx,
      "伝導帯",
      m.toPxX(-R) + 6,
      m.toPxY(SILICON.eg + BAND_THICKNESS * 0.55),
      colors.text2,
      "left",
    );
    drawLabel(
      ctx,
      "価電子帯",
      m.toPxX(-R) + 6,
      m.toPxY(-BAND_THICKNESS * 0.55),
      colors.text2,
      "left",
    );
    drawLabel(
      ctx,
      "E_F",
      m.toPxX(-R) + 6,
      m.toPxY(eF) - 9,
      colors.electron,
      "left",
      "middle",
      PLOT_FONT,
    );
    drawBoxedLabel(
      ctx,
      "E_i",
      m.toPxX(-d.xp) - 26,
      m.toPxY(eiBulk) - 9,
      colors,
      "left",
      colors.level,
    );

    // 読み取り値
    vbiItem.set(formatEvFixed(d.vbi));
    pItem.set(formatEvFixed(pDiff));
    nItem.set(formatEvFixed(nDiff));
    sumItem.set(formatEvFixed(pDiff + nDiff));
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const vbiItem = readout.item("qV_bi");
  const pItem = readout.item("p 側の E_i − E_F", { color: "hole" });
  const nItem = readout.item("n 側の E_F − E_i", { color: "electron" });
  const sumItem = readout.item("両者の和");

  const naSlider = host.controls.slider({
    id: "nA",
    label: "p 側のドーピング N_A",
    min: DOPING_MIN,
    max: DOPING_MAX,
    value: DOPING_INIT,
    scale: "log",
    unit: "cm⁻³",
    format: (v) => fmtSci(snapLog(v), 2),
  });
  const ndSlider = host.controls.slider({
    id: "nD",
    label: "n 側のドーピング N_D",
    min: DOPING_MIN,
    max: DOPING_MAX,
    value: DOPING_INIT,
    scale: "log",
    unit: "cm⁻³",
    format: (v) => fmtSci(snapLog(v), 2),
  });
  const compareToggle = host.controls.toggle({
    id: "compare",
    label: "接触前と比べる",
    value: false,
  });
  naSlider.onChange((v) => {
    nA = snapLog(v);
    recompute();
  });
  ndSlider.onChange((v) => {
    nD = snapLog(v);
    recompute();
  });
  compareToggle.onChange((v) => {
    compare = v;
  });

  host.controls.reset(() => {
    naSlider.set(DOPING_INIT);
    ndSlider.set(DOPING_INIT);
    compareToggle.set(false);
    nA = DOPING_INIT;
    nD = DOPING_INIT;
    compare = false;
    d = depletion(SILICON, nA, nD, 0, ROOM_T);
    range.jump(displayHalfRange(d));
  });

  host.onRender(draw);

  return {
    destroy(): void {
      range.cancel();
      readout.el.remove();
    },
  };
}
