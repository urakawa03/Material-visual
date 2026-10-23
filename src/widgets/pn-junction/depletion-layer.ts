/**
 * depletion-layer.ts — 図2「空乏層の電荷・電場・電位」(仕様書 13 §5.2)
 *
 * 同じ x 軸(μm)を共有する縦 3 段のグラフ:
 * 1. 電荷密度 ρ(x)/q: 空乏層の p 側に −N_A、n 側に +N_D の矩形(`--mat-solute` の
 *    薄い塗り + 縁 — 取り残された固定イオンの電荷)。両矩形の面積が等しいこと
 *    (N_A x_p = N_D x_n)を注記する
 * 2. 電場 𝓔(x): 三角形(`--color-text-2`)。最大値(x = 0)にラベル
 * 3. 電位 ψ(x): 2 本の放物線のつなぎ。全体の高さに寸法線と「V_bi」。電場の
 *    三角形の面積 = V_bi を、2 段目の三角形の塗りと 3 段目の寸法の帯を同じ淡い
 *    色で結んで示す
 * 空乏層の両端 −x_p・+x_n に 3 段を貫く細い縦の破線。
 *
 * モデル: lib/junction.ts の階段接合の空乏層近似(式 E2〜E5)。図3・図5 と同じ
 * 関数なので、同じドーピングなら空乏層の端・V_bi・W は完全に一致する。
 * 位置軸の範囲は max(1.5W, 0.6 μm) を左右に取り、変わる瞬間は 150 ms で補間。
 *
 * 簡略化(図注に明示): 接合は急峻、空乏層の中にキャリアは 1 個もなく外は完全に
 * 中性(実際の縁はなだらか)。
 *
 * 実装方式: 2D Canvas / requestRender(アイドル時は再描画しない)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fmtSci, linTicks } from "../../core/plot";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  PLOT_FONT,
  setPlotRange,
  withPlotClip,
  type PlotMapper,
} from "../_shared/banddiagram";
import { SILICON } from "../_shared/semiconductor";
import { DOPING_INIT, ROOM_T } from "./lib/constants";
import {
  depletion,
  displayHalfRange,
  potential,
  type Depletion,
} from "./lib/junction";
import {
  AnimatedRange,
  curveSamples,
  drawDimension,
  drawEdgeLine,
  drawLabel,
  fixedSigned,
  micronTicks,
  MINUS,
  NARROW_WIDTH_PX,
  pnColors,
  snapLog,
} from "./lib/draw";

/** 操作パラメータ(§5.2 の表) */
const DOPING_MIN = 1e14;
const DOPING_MAX = 1e18;
/** 電位の縦軸 [V](V_bi は 0.47〜0.93 V) */
const PSI_MIN = -0.1;
const PSI_MAX = 1.05;
/** 三角形の塗りと V_bi の寸法の帯の淡さ(同じ色で結ぶ) */
const PALE_ALPHA = 0.16;
/** 矩形を描く最小の幅・高さ [px](極端な非対称でも消えないように) */
const MIN_RECT_PX = 1.5;
const MAX_SAMPLES = 241;

export default function depletionLayer(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = pnColors();
  const mRho = createPlotMapper();
  const mField = createPlotMapper();
  const mPsi = createPlotMapper();

  /* ---- 状態 ---- */
  let nA = DOPING_INIT;
  let nD = DOPING_INIT;
  let d: Depletion = depletion(SILICON, nA, nD, 0, ROOM_T);
  const range = new AnimatedRange(displayHalfRange(d));

  const xs = new Float64Array(MAX_SAMPLES);
  const ys = new Float64Array(MAX_SAMPLES);

  function recompute(): void {
    d = depletion(SILICON, nA, nD, 0, ROOM_T);
    range.set(displayHalfRange(d), () => host.requestRender());
  }

  /* ---- 描画の部品 ---- */
  /** パネルの左の縦軸と目盛り・ゼロの線 */
  function panelAxis(
    m: PlotMapper,
    ticks: ReadonlyArray<{ value: number; label: string }>,
    zero: number | null,
  ): void {
    const left = m.rect.x;
    const top = m.rect.y;
    const bottom = m.rect.y + m.rect.h;
    ctx.save();
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 0.5, top);
    ctx.lineTo(left + 0.5, bottom);
    if (zero !== null) {
      const y = Math.round(m.toPxY(zero)) + 0.5;
      ctx.moveTo(left, y);
      ctx.lineTo(left + m.rect.w, y);
    }
    for (const t of ticks) {
      const y = m.toPxY(t.value);
      ctx.moveTo(left, y);
      ctx.lineTo(left - 4, y);
    }
    ctx.stroke();
    ctx.font = PLOT_FONT;
    ctx.fillStyle = colors.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of ticks) ctx.fillText(t.label, left - 7, m.toPxY(t.value));
    ctx.restore();
  }

  /** パネルの題(プロット領域の上の帯) */
  function panelTitle(m: PlotMapper, text: string): void {
    drawLabel(ctx, text, m.rect.x + 6, m.rect.y - 9, colors.text, "left");
  }

  function drawRho(narrow: boolean): void {
    const big = Math.max(nA, nD);
    panelAxis(mRho, [{ value: 0, label: "0" }], 0);
    panelTitle(mRho, "電荷密度 ρ/q [cm⁻³]");
    withPlotClip(ctx, mRho, () => {
      const y0 = mRho.toPxY(0);
      // p 側: −N_A(下)、n 側: +N_D(上)。極端な非対称でも消えないよう最小の幅・高さ
      const pxL = mRho.toPxX(-d.xp);
      const px0 = mRho.toPxX(0);
      const pxR = mRho.toPxX(d.xn);
      // 高さ(px): p 側は 0 の線から下へ、n 側は上へ
      const hA = Math.max(MIN_RECT_PX, mRho.toPxY(-nA) - y0);
      const hD = Math.max(MIN_RECT_PX, y0 - mRho.toPxY(nD));
      const wA = Math.max(MIN_RECT_PX, px0 - pxL);
      const wD = Math.max(MIN_RECT_PX, pxR - px0);
      ctx.save();
      ctx.fillStyle = colors.solute;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(px0 - wA, y0, wA, hA);
      ctx.fillRect(px0, y0 - hD, wD, hD);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.solute;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px0 - wA, y0, wA, hA);
      ctx.strokeRect(px0, y0 - hD, wD, hD);
      ctx.restore();
      // 矩形のラベル(固定イオンの電荷)
      drawLabel(
        ctx,
        `${MINUS}N_A`,
        px0 - wA - 6,
        y0 + hA - 8,
        colors.solute,
        "right",
      );
      drawLabel(ctx, "+N_D", px0 + wD + 6, y0 - hD + 8, colors.solute, "left");
    });
    // 面積が等しいことの注記(p 側の上の空いた所)
    const sheet = nA * d.xp * 1e-4; // [cm⁻²]
    const note1 = "面積が等しい(電荷の総量が等しい)";
    const note2 = `N_A x_p = N_D x_n = ${fmtSci(sheet, 2)} cm⁻²`;
    const nx = mRho.rect.x + 8;
    const ny = mRho.rect.y + 12;
    drawLabel(ctx, note1, nx, ny, colors.text2, "left");
    drawLabel(ctx, note2, nx, ny + 15, colors.text2, "left");
    if (!narrow && big / Math.min(nA, nD) >= 300) {
      drawLabel(
        ctx,
        "(薄い側の矩形は細すぎるので最小の太さで描いた)",
        nx,
        ny + 30,
        colors.text2,
        "left",
      );
    }
  }

  function drawField(narrow: boolean): void {
    const ticks = linTicks(mField.yMin, mField.yMax, narrow ? 3 : 4).map(
      (v) => ({ value: v, label: fixedSigned(v, v % 1 === 0 ? 0 : 1) }),
    );
    panelAxis(mField, ticks, 0);
    panelTitle(mField, "電場 𝓔 [kV/cm](負 = 左向き、n → p)");
    withPlotClip(ctx, mField, () => {
      const y0 = mField.toPxY(0);
      const yTip = mField.toPxY(-d.eMax);
      const pxL = mField.toPxX(-d.xp);
      const px0 = mField.toPxX(0);
      const pxR = mField.toPxX(d.xn);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pxL, y0);
      ctx.lineTo(px0, yTip);
      ctx.lineTo(pxR, y0);
      ctx.closePath();
      ctx.fillStyle = colors.text2;
      ctx.globalAlpha = PALE_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.text2;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(mField.rect.x, y0);
      ctx.lineTo(pxL, y0);
      ctx.lineTo(px0, yTip);
      ctx.lineTo(pxR, y0);
      ctx.lineTo(mField.rect.x + mField.rect.w, y0);
      ctx.stroke();
      ctx.restore();
    });
    // 最大値のラベル(三角形の先の右)と、面積 = V_bi
    const tipX = mField.toPxX(0);
    const tipY = mField.toPxY(-d.eMax);
    drawLabel(
      ctx,
      `最大 ${d.eMax.toFixed(1)} kV/cm`,
      tipX + 8,
      tipY + 2,
      colors.text,
      "left",
    );
    const areaX = Math.max(mField.toPxX(d.xn) + 10, tipX + 10);
    drawLabel(
      ctx,
      "三角形の面積 = V_bi",
      Math.min(areaX, mField.rect.x + mField.rect.w - 4),
      mField.toPxY(-d.eMax * 0.45),
      colors.text2,
      areaX > mField.rect.x + mField.rect.w - 120 ? "right" : "left",
    );
  }

  function drawPotential(narrow: boolean): void {
    const ticks = [0, 0.5, 1].map((v) => ({
      value: v,
      label: v === 0 ? "0" : v.toFixed(1),
    }));
    panelAxis(mPsi, ticks, 0);
    panelTitle(mPsi, "電位 ψ [V](p 側の中性領域を 0)");
    const R = range.value;
    const n = curveSamples(host.size.w);
    for (let i = 0; i < n; i++) {
      const x = -R + (2 * R * i) / (n - 1);
      xs[i] = x;
      ys[i] = potential(d, x);
    }
    withPlotClip(ctx, mPsi, () => {
      // V_bi の高さの補助線
      ctx.save();
      ctx.strokeStyle = colors.hairline;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const yV = Math.round(mPsi.toPxY(d.vbi)) + 0.5;
      ctx.moveTo(mPsi.rect.x, yV);
      ctx.lineTo(mPsi.rect.x + mPsi.rect.w, yV);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = colors.text2;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(mPsi.toPxX(xs[0]), mPsi.toPxY(ys[0]));
      for (let i = 1; i < n; i++) {
        ctx.lineTo(mPsi.toPxX(xs[i]), mPsi.toPxY(ys[i]));
      }
      ctx.stroke();
      ctx.restore();
    });
    // V_bi の寸法(電場の三角形と同じ淡い帯 + 寸法線)。n 側の中性領域に置く
    const xDim = Math.min(
      mPsi.rect.x + mPsi.rect.w - (narrow ? 70 : 96),
      (mPsi.toPxX(d.xn) + mPsi.rect.x + mPsi.rect.w) / 2,
    );
    const y0 = mPsi.toPxY(0);
    const y1 = mPsi.toPxY(d.vbi);
    ctx.save();
    ctx.fillStyle = colors.text2;
    ctx.globalAlpha = PALE_ALPHA;
    ctx.fillRect(xDim - 5, y1, 10, y0 - y1);
    ctx.restore();
    drawDimension(
      ctx,
      xDim,
      y0,
      y1,
      `V_bi = ${d.vbi.toFixed(3)} V`,
      colors,
      "right",
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    const left = narrow ? 42 : 50;
    const right = 10;
    const top = 26;
    const bottom = 40;
    const titleH = 20;
    const gap = 8;
    const panelH = (h - top - bottom - 2 * (gap + titleH)) / 3;
    const R = range.value;
    const pw = w - left - right;
    const y1 = top;
    const y2 = y1 + panelH + gap + titleH;
    const y3 = y2 + panelH + gap + titleH;
    const big = Math.max(nA, nD);
    setPlotRange(mRho, left, y1, pw, panelH, -R, R, -1.2 * big, 1.2 * big);
    const fTop = 0.22 * d.eMax;
    setPlotRange(mField, left, y2, pw, panelH, -R, R, -1.18 * d.eMax, fTop);
    setPlotRange(mPsi, left, y3, pw, panelH, -R, R, PSI_MIN, PSI_MAX);

    // 左右の向き
    drawLabel(ctx, "p 型", left + 4, 10, colors.hole, "left");
    drawLabel(ctx, "n 型", left + pw - 4, 10, colors.electron, "right");

    drawRho(narrow);
    drawField(narrow);
    drawPotential(narrow);

    // 空乏層の両端(3 段を貫く縦の破線)
    const edgeTop = mRho.rect.y;
    const edgeBottom = mPsi.rect.y + mPsi.rect.h;
    for (const x of [-d.xp, d.xn]) {
      if (Math.abs(x) > R) continue;
      drawEdgeLine(ctx, mRho, x, colors.text2, edgeTop, edgeBottom);
    }
    drawLabel(
      ctx,
      "−x_p",
      mRho.toPxX(-d.xp) - 3,
      edgeBottom + 10,
      colors.text2,
      "right",
    );
    drawLabel(
      ctx,
      "x_n",
      mRho.toPxX(d.xn) + 3,
      edgeBottom + 10,
      colors.text2,
      "left",
    );

    // 位置の軸(最下段の下)
    const ticks = micronTicks(-R, R, narrow ? 4 : 7);
    ctx.save();
    ctx.strokeStyle = colors.hairline;
    ctx.fillStyle = colors.text2;
    ctx.font = PLOT_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.beginPath();
    for (const t of ticks) {
      const px = mPsi.toPxX(t.value);
      ctx.moveTo(px, edgeBottom);
      ctx.lineTo(px, edgeBottom + 4);
    }
    ctx.stroke();
    // 目盛りの数字は x_p・x_n のラベルと重ならない段に置く
    for (const t of ticks) {
      if (t.label) ctx.fillText(t.label, mPsi.toPxX(t.value), edgeBottom + 18);
    }
    ctx.restore();
    drawLabel(
      ctx,
      "位置 x [μm]",
      left + pw,
      h - 5,
      colors.text2,
      "right",
      "bottom",
    );

    // 読み取り値
    vbiItem.set(`${d.vbi.toFixed(3)} V`);
    wItem.set(`${d.w.toFixed(3)} μm`);
    xpItem.set(formatNm(d.xp));
    xnItem.set(formatNm(d.xn));
    eItem.set(`${d.eMax.toFixed(1)} kV/cm`);
  }

  /** 空乏層の厚み [μm] を nm の読み取りに */
  function formatNm(um: number): string {
    const nm = um * 1000;
    return `${nm >= 100 ? Math.round(nm) : Number(nm.toPrecision(3))} nm`;
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const vbiItem = readout.item("V_bi");
  const wItem = readout.item("W");
  const xpItem = readout.item("x_p");
  const xnItem = readout.item("x_n");
  const eItem = readout.item("最大電場");

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
  naSlider.onChange((v) => {
    nA = snapLog(v);
    recompute();
  });
  ndSlider.onChange((v) => {
    nD = snapLog(v);
    recompute();
  });

  host.controls.reset(() => {
    naSlider.set(DOPING_INIT);
    ndSlider.set(DOPING_INIT);
    nA = DOPING_INIT;
    nD = DOPING_INIT;
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
