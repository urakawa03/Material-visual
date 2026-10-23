/**
 * transmission-vs-thickness.ts — 図3「透過率は指数関数で効く」(仕様書 14 §5.3)
 *
 * 横軸 壁の厚さ d、縦軸 透過率 T(既定は対数 10⁻¹⁴〜1)。厳密な T(d)(式 E5)を
 * 実線、近似 e^{−2κd}(式 E3)を破線で重ねる。対数の軸ではどちらもほぼ直線で、
 * 傾きは −2κ(T2)。近似は前に付く係数 16E(V − E)/V² を落としているので、
 * 直線は平行だが少しずれる。縦軸を線形に切り替えると、曲線が左端でだけ
 * 立ち上がり、あとはゼロに張り付いて何も読めない(それ自体が教材)。
 * 現在の d と 2d の点を結び、「2 倍の厚さで ◯ 分の 1」を示す。
 *
 * E = 1 eV に固定して V を動かす(読み取りは V − E)。
 * 実装方式: requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout, drawArrow } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawCurve,
  drawPlotFrame,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { font, fmtSig } from "../../core/plot";
import {
  fmtFromLog10,
  fmtOneOver,
  haloText,
  log10Ticks,
  resolvePalette,
  tooSmall,
} from "./lib/draw";
import { kappa, logTransmission, logTransmissionApprox } from "./lib/tunneling";

/** 電子のエネルギー(固定)[eV] */
const E_FIXED = 1;
/** スライダー(§5.3 の表) */
const B_MIN = 0.5;
const B_MAX = 6;
const B_STEP = 0.1;
const B_INIT = 4;
const D_MIN = 0.05;
const D_MAX = 1.5;
const D_STEP = 0.01;
const D_INIT = 0.4;
/** 横軸の範囲 [nm] と、対数軸の範囲(log₁₀ T) */
const X_MAX = 1.5;
const LOG_MIN = -14;
const LOG_MAX = 0;
/** 曲線のサンプル点数 */
const SAMPLES = 301;
/** 余白(CSS px) */
const MARGIN_LEFT = 62;
const MARGIN_RIGHT = 18;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 50;

type AxisMode = "log" | "linear";

const X_TICKS: readonly AxisTick[] = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5].map(
  (v) => ({ value: v, label: String(v) }),
);
const LOG_TICKS: readonly AxisTick[] = log10Ticks(LOG_MIN, LOG_MAX, 2);
const LIN_TICKS: readonly AxisTick[] = [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => ({
  value: v,
  label: v === 0 ? "0" : String(v),
}));

export default function transmissionVsThickness(
  host: FigureHost,
): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const colors = bandColors();
  const map = createPlotMapper();

  /* ---- 状態 ---- */
  let barrier = B_INIT; // V − E [eV]
  let d = D_INIT;
  let mode: AxisMode = "log";

  /* ---- 使い回すバッファ ---- */
  const ds = new Float64Array(SAMPLES);
  const exactY = new Float64Array(SAMPLES);
  const approxY = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) ds[i] = (X_MAX * i) / (SAMPLES - 1);

  /** ln T(厳密) */
  const lnT = (x: number): number =>
    logTransmission(E_FIXED, E_FIXED + barrier, x);

  /** 縦軸の値(対数なら log₁₀ T、線形なら T) */
  function axisValue(ln: number): number {
    return mode === "log" ? ln / Math.LN10 : Math.exp(ln);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    const isLog = mode === "log";
    setPlotRange(
      map,
      MARGIN_LEFT,
      MARGIN_TOP,
      w - MARGIN_LEFT - MARGIN_RIGHT,
      h - MARGIN_TOP - MARGIN_BOTTOM,
      0,
      X_MAX,
      isLog ? LOG_MIN : 0,
      isLog ? LOG_MAX : 1.05,
    );
    drawPlotFrame(ctx, map, {
      colors,
      xTicks: X_TICKS,
      yTicks: isLog ? LOG_TICKS : LIN_TICKS,
      xLabel: "壁の厚さ d [nm]",
      yLabel: isLog ? "透過率 T(対数目盛)" : "透過率 T(線形目盛)",
    });

    // 曲線
    for (let i = 0; i < SAMPLES; i++) {
      exactY[i] = axisValue(lnT(ds[i]));
      approxY[i] = axisValue(logTransmissionApprox(barrier, ds[i]));
    }
    withPlotClip(ctx, map, () => {
      drawCurve(ctx, map, ds, approxY, SAMPLES, {
        color: pal.electron,
        width: 1.6,
        dash: [7, 5],
        alpha: 0.75,
      });
      drawCurve(ctx, map, ds, exactY, SAMPLES, {
        color: pal.electron,
        width: 2.6,
      });
    });

    // 現在の d と 2d
    const ln1 = lnT(d);
    const ln2 = lnT(2 * d);
    const px1 = map.toPxX(d);
    const top = map.rect.y;
    const bottom = map.rect.y + map.rect.h;
    const clampY = (y: number): number => Math.min(bottom, Math.max(top, y));
    const py1 = clampY(map.toPxY(axisValue(ln1)));
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(px1 + 0.5, top);
    ctx.lineTo(px1 + 0.5, bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = font(12);
    if (2 * d <= X_MAX) {
      const px2 = map.toPxX(2 * d);
      const py2raw = map.toPxY(axisValue(ln2));
      const py2 = clampY(py2raw);
      // 同じ高さのまま 2d まで進み、そこから下へ落ちる矢印(桁で落ちる)
      ctx.strokeStyle = pal.text2;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py1);
      ctx.stroke();
      ctx.setLineDash([]);
      if (py2 - py1 > 10) {
        drawArrow(ctx, px2, py1, px2, py2, {
          color: pal.text2,
          width: 1.4,
          head: 7,
        });
      }
      ctx.beginPath();
      ctx.arc(px2, py2, 5, 0, Math.PI * 2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.strokeStyle = pal.electron;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = `2 倍の厚さで ${fmtOneOver(Math.exp(ln2 - ln1))}`;
      const lx = Math.min(
        px2 + 9,
        map.rect.x + map.rect.w - ctx.measureText(label).width - 2,
      );
      // 落差が大きければ矢印の横の中ほど。小さければ(薄い・低い壁で曲線が
      // 上の端に張り付くとき)曲線に重ならないよう点の下、下の端なら点の上
      let ly: number;
      if (py2 - py1 >= 24) ly = (py1 + py2) / 2;
      else if (py2 + 30 <= bottom) ly = py2 + 18;
      else ly = py1 - 14;
      haloText(ctx, label, lx, ly, pal.text, pal.bg);
    } else {
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      haloText(
        ctx,
        `2 倍の厚さ(${fmtSig(2 * d, 3)} nm)で ${fmtOneOver(Math.exp(ln2 - ln1))}`,
        map.rect.x + map.rect.w - 4,
        top + 4,
        pal.text,
        pal.bg,
      );
    }
    // 現在の点(枠の外なら端に印)
    ctx.beginPath();
    ctx.arc(px1, py1, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = pal.electron;
    ctx.fill();
    if (map.toPxY(axisValue(ln1)) > bottom + 0.5) {
      // 点が目盛りより下: 点の真上に印(右の端では文字が枠からはみ出さないよう寄せる)
      const outLabel = "▼ 目盛りの外";
      const half = ctx.measureText(outLabel).width / 2;
      const ox = Math.min(
        Math.max(px1, map.rect.x + half + 2),
        map.rect.x + map.rect.w - half - 2,
      );
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      haloText(ctx, outLabel, ox, bottom - 8, pal.text2, pal.bg);
    }

    // 凡例
    ctx.font = font(12);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const lx = map.rect.x + map.rect.w - 4;
    const ly = isLog ? top + 26 : top + 4;
    haloText(ctx, "実線: 厳密な T", lx, ly, pal.electron, pal.bg);
    haloText(ctx, "破線: 近似 e^(−2κd)", lx, ly + 17, pal.electron, pal.bg);
  }

  /* ---- 読み取り値 ---- */
  const readout = createReadout(host);
  const tItem = readout.item("T", { color: "electron" });
  const slopeItem = readout.item("ln T の傾き");
  const ratioItem = readout.item("2 倍の厚さで");

  function updateReadouts(): void {
    const ln1 = lnT(d);
    tItem.set(fmtFromLog10(ln1 / Math.LN10));
    // 厳密な ln T の局所の傾き(厚い壁で −2κ に近づく)
    const h = 1e-4;
    const slope = (lnT(d + h) - lnT(d - h)) / (2 * h);
    const twoK = 2 * kappa(barrier);
    slopeItem.set(
      `${fmtSig(slope, 3)} nm⁻¹(−2κ = ${fmtSig(-twoK, 3)})`.replace(/-/g, "−"),
    );
    ratioItem.set(fmtOneOver(Math.exp(lnT(2 * d) - ln1)));
  }

  /* ---- 操作部品 ---- */
  const bSlider = host.controls.slider({
    id: "barrier",
    label: "壁の高さ V − E",
    min: B_MIN,
    max: B_MAX,
    step: B_STEP,
    value: B_INIT,
    unit: "eV",
  });
  bSlider.onChange((v) => {
    barrier = v;
    updateReadouts();
  });
  const dSlider = host.controls.slider({
    id: "d",
    label: "壁の厚さ d",
    min: D_MIN,
    max: D_MAX,
    step: D_STEP,
    value: D_INIT,
    unit: "nm",
  });
  dSlider.onChange((v) => {
    d = v;
    updateReadouts();
  });
  const modeSeg = host.controls.segmented<AxisMode>({
    id: "axis",
    label: "縦軸",
    options: [
      { value: "log", label: "対数" },
      { value: "linear", label: "線形" },
    ],
    value: "log",
  });
  modeSeg.onChange((v) => {
    mode = v;
  });
  host.controls.reset(() => {
    bSlider.set(B_INIT);
    dSlider.set(D_INIT);
    modeSeg.set("log");
    barrier = B_INIT;
    d = D_INIT;
    mode = "log";
    updateReadouts();
  });

  updateReadouts();
  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
