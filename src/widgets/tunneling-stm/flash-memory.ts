/**
 * flash-memory.ts — 図7「書けて、消えない」(仕様書 14 §5.7・発展)
 *
 * 左(狭幅では上): フラッシュメモリのセルの断面模式(下から Si のチャネル、
 *   薄いトンネル酸化膜 = 壁、電子をためる浮遊ゲート、制御ゲート)と、
 *   壁のエネルギーの形(「書き込み」on のときは電場で傾いた三角の壁)。
 * 右(狭幅では下): 「電子 1 個が抜け出すまでの平均時間」(対数)と酸化膜の厚さ。
 *   目安の水平線「1 秒」「10 年」「宇宙の年齢」。書き込み on のときは、
 *   書き込み電圧で電子 1 個が通り抜けるまでの時間を破線と別の点で示す。
 *
 * 保持: 矩形の壁(SiO₂ 3.1 eV・有効質量 0.42 m)の T ≈ e^{−2κd}(式 E3)、
 *   τ = 1/(νT)、ν = 10¹⁴ s⁻¹ は桁の目安。
 * 書き込み: 電場 F で傾いた壁の WKB(式 E7。膜が厚ければファウラー・ノルドハイムの
 *   三角の壁、薄ければ台形の壁)。
 * T は 10⁻⁴¹ を下回るので、すべて対数のまま計算する(lib/tunneling.ts)。
 * 欠陥のない理想的な壁の計算で、実際の製品の保持は欠陥を介した漏れで決まる(図注)。
 *
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
import { font } from "../../core/plot";
import { formatDuration, UNIVERSE_AGE_S, YEAR_S } from "../../core/units";
import {
  MV_PER_CM_TO_V_PER_NM,
  SIO2_BARRIER_EV,
  SIO2_MASS_RATIO,
} from "./lib/constants";
import {
  drawDivider,
  fmtFromLog10,
  haloText,
  log10Ticks,
  rect,
  resolvePalette,
  setControlEnabled,
  splitTwo,
  tooSmall,
  type Rect,
} from "./lib/draw";
import {
  logRetentionTime,
  logWriteTime,
  logTransmissionApprox,
  tiltedBarrierExponent,
} from "./lib/tunneling";

/** スライダー(§5.7 の表) */
const D_MIN = 2;
const D_MAX = 10;
const D_STEP = 0.1;
const D_INIT = 8;
const F_MIN = 6;
const F_MAX = 14;
const F_STEP = 0.5;
const F_INIT = 10;
/** 縦軸 log₁₀(時間 / 秒) の範囲。保持の 10 nm(10³⁷ 秒)と、強い電場での書き込み
 *  (10⁻⁷ 秒)まで収まるように取る */
const LOG_MIN = -8;
const LOG_MAX = 40;
/** 曲線のサンプル点数 */
const SAMPLES = 161;
/** 浮遊ゲートの電子の数(模式) */
const ELECTRONS = 9;

const X_TICKS: readonly AxisTick[] = [2, 4, 6, 8, 10].map((v) => ({
  value: v,
  label: String(v),
}));
const Y_TICKS: readonly AxisTick[] = log10Ticks(LOG_MIN, LOG_MAX, 8).filter(
  (t) => t.value % 4 === 0,
);

/** 目安の水平線 */
const GUIDES: ReadonlyArray<{ log10s: number; label: string }> = [
  { log10s: 0, label: "1 秒" },
  { log10s: Math.log10(10 * YEAR_S), label: "10 年" },
  { log10s: Math.log10(UNIVERSE_AGE_S), label: "宇宙の年齢" },
];

export default function flashMemory(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const colors = bandColors();
  const map = createPlotMapper();
  const left: Rect = rect();
  const right: Rect = rect();

  /* ---- 状態 ---- */
  let d = D_INIT;
  let writing = false;
  let field = F_INIT; // MV/cm

  const ds = new Float64Array(SAMPLES);
  const keep = new Float64Array(SAMPLES);
  const write = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    ds[i] = D_MIN + ((D_MAX - D_MIN) * i) / (SAMPLES - 1);
  }

  const log10Keep = (x: number): number => logRetentionTime(x) / Math.LN10;
  const log10Write = (x: number): number => logWriteTime(x, field) / Math.LN10;

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    const stacked = splitTwo(w, h, 0.45, 0.44, 14, left, right);
    drawCell(left, stacked);
    drawDivider(ctx, left, right, stacked, pal.hairline);
    drawPlot(right);
  }

  /* ---------------------------------------------------- 左: セルと壁の形 */

  function drawCell(r: Rect, stacked: boolean): void {
    // 左半分にセルの断面、右半分に壁のエネルギーの形
    const cellW = r.w * (stacked ? 0.46 : 0.5);
    const cx0 = r.x + 10;
    const cx1 = r.x + cellW - 6;
    const top = r.y + 26;
    const bottom = r.y + r.h - 10;
    const H = bottom - top;
    // 層の厚さ(px)。酸化膜は d とともに厚くなるように誇張して描く(中に名前を書ける太さは保つ)
    const oxide = 14 + (d / D_MAX) * H * 0.14;
    const si = H * 0.2;
    const fg = H * 0.24;
    const ipd = H * 0.05;
    const cg = H - si - oxide - fg - ipd;
    const ySi = bottom - si;
    const yOx = ySi - oxide;
    const yFg = yOx - fg;
    const yIpd = yFg - ipd;

    const gateX0 = cx0 + (cx1 - cx0) * 0.12;
    const gateX1 = cx1 - (cx1 - cx0) * 0.12;
    // Si のチャネル
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = pal.matrix;
    ctx.fillRect(cx0, ySi, cx1 - cx0, si);
    // 浮遊ゲート・制御ゲート
    ctx.globalAlpha = 0.4;
    ctx.fillRect(gateX0, yFg, gateX1 - gateX0, fg);
    ctx.globalAlpha = 0.55;
    ctx.fillRect(gateX0, top, gateX1 - gateX0, cg);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.matrixEdge;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx0, ySi, cx1 - cx0, si);
    ctx.strokeRect(gateX0, yFg, gateX1 - gateX0, fg);
    ctx.strokeRect(gateX0, top, gateX1 - gateX0, cg);
    // 絶縁膜(トンネル酸化膜・ゲート間の膜)
    ctx.strokeStyle = pal.ghost;
    ctx.strokeRect(gateX0, yOx, gateX1 - gateX0, oxide);
    ctx.strokeRect(gateX0, yIpd, gateX1 - gateX0, ipd);

    // 浮遊ゲートにたまった電子
    ctx.fillStyle = pal.electron;
    ctx.beginPath();
    for (let i = 0; i < ELECTRONS; i++) {
      const fx = gateX0 + ((gateX1 - gateX0) * (i + 0.5)) / ELECTRONS;
      const fy = yFg + fg * (i % 2 === 0 ? 0.38 : 0.66);
      ctx.moveTo(fx + 3.4, fy);
      ctx.arc(fx, fy, 3.4, 0, Math.PI * 2);
    }
    ctx.fill();

    // 電子の出入り(保持: 抜け出す / 書き込み: チャネルから入る)
    // (矢印は膜の名前と重ならないよう、ゲートの端の近くに置く)
    if (writing) {
      const ax = gateX0 + 12;
      drawArrow(ctx, ax, ySi + si * 0.45, ax, yFg + fg * 0.2, {
        color: pal.beam,
        width: 3,
        head: 9,
      });
    } else {
      const ax = gateX1 - 10;
      ctx.setLineDash([3, 3]);
      drawArrow(ctx, ax, yFg + fg * 0.8, ax, ySi + si * 0.6, {
        color: pal.beam,
        width: 1,
        head: 6,
      });
      ctx.setLineDash([]);
    }

    // ラベル
    ctx.font = font(11);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    haloText(
      ctx,
      "制御ゲート",
      (gateX0 + gateX1) / 2,
      top + cg / 2,
      pal.text,
      pal.bg,
    );
    haloText(
      ctx,
      "浮遊ゲート",
      (gateX0 + gateX1) / 2 - 22,
      yFg + fg * 0.5,
      pal.text,
      pal.bg,
    );
    haloText(
      ctx,
      "Si のチャネル",
      (cx0 + cx1) / 2,
      ySi + si * 0.62,
      pal.text,
      pal.bg,
    );
    // トンネル酸化膜(壁)の名前は膜の中、電子の出入りの矢印を避けた幅に書く
    // (幅が足りなければ短く)
    const nameX0 = writing ? gateX0 + 20 : gateX0 + 4;
    const nameX1 = writing ? gateX1 - 4 : gateX1 - 18;
    const longName = `トンネル酸化膜 ${d.toFixed(1)} nm`;
    const oxName =
      ctx.measureText(longName).width < nameX1 - nameX0
        ? longName
        : `酸化膜 ${d.toFixed(1)} nm`;
    haloText(
      ctx,
      oxName,
      (nameX0 + nameX1) / 2,
      yOx + oxide / 2,
      pal.text2,
      pal.bg,
    );
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    haloText(ctx, "セルの断面(模式)", cx0, r.y + 6, pal.text2, pal.bg);

    drawBarrierShape(r.x + cellW + 6, top, r.x + r.w - 10, bottom);
  }

  /** 壁のエネルギーの形(横 = 位置: 左がチャネル・右が浮遊ゲート、縦 = エネルギー) */
  function drawBarrierShape(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const phi = SIO2_BARRIER_EV;
    const eTop = 4;
    const eBot = -3.4;
    const ey = (e: number): number =>
      y1 - ((e - eBot) / (eTop - eBot)) * (y1 - y0);
    const side = (x1 - x0) * 0.22;
    const wx0 = x0 + side;
    const wx1 = x1 - side;
    const drop = writing ? field * MV_PER_CM_TO_V_PER_NM * d : 0; // qFd [eV]
    // 両側の電子の準位(フェルミ準位の模式)
    const eLeft = 0;
    const eRight = -drop;
    // 強い電場では壁が図の下端より下まで傾くので、図の範囲で切り取って描く
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0 - 24, x1 - x0, y1 - y0 + 26);
    ctx.clip();
    // 壁(右へ下がる台形・三角)
    ctx.beginPath();
    ctx.moveTo(wx0, ey(eLeft));
    ctx.lineTo(wx0, ey(eLeft + phi));
    ctx.lineTo(wx1, ey(eRight + phi));
    ctx.lineTo(wx1, ey(Math.max(eBot, eRight)));
    ctx.lineTo(wx0, ey(Math.max(eBot, eRight)));
    ctx.closePath();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = pal.matrix;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.matrixEdge;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(wx0, ey(Math.max(eBot, eRight)));
    ctx.lineTo(wx0, ey(eLeft + phi));
    ctx.lineTo(wx1, ey(eRight + phi));
    ctx.lineTo(wx1, ey(Math.max(eBot, eRight)));
    ctx.stroke();
    // 電子の準位(破線)
    ctx.strokeStyle = pal.level;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, ey(eLeft));
    ctx.lineTo(wx0, ey(eLeft));
    ctx.moveTo(wx1, ey(eRight));
    ctx.lineTo(x1, ey(eRight));
    ctx.stroke();
    ctx.setLineDash([]);

    // 電子が通り抜ける道(壁の中を通る区間を矢印で)
    const ePath = writing ? eLeft : eRight;
    let xa: number;
    let xb: number;
    if (writing) {
      // チャネル(左)の電子が、三角の部分 x₀ = φ/qF だけを抜けて右へ
      const x0nm = Math.min(d, phi / (field * MV_PER_CM_TO_V_PER_NM));
      xa = wx0 - 10;
      xb = wx0 + ((wx1 - wx0) * x0nm) / d + 10;
    } else {
      xa = wx1 + 10;
      xb = wx0 - 10;
    }
    drawArrow(ctx, xa, ey(ePath), xb, ey(ePath), {
      color: pal.beam,
      width: 2,
      head: 7,
    });
    ctx.beginPath();
    ctx.arc(xa, ey(ePath), 3.6, 0, Math.PI * 2);
    ctx.fillStyle = pal.electron;
    ctx.fill();

    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("壁のエネルギーの形", (x0 + x1) / 2, y0 - 20);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "center";
    haloText(
      ctx,
      writing ? "電場で傾いた壁" : `高さ ${phi} eV`,
      (wx0 + wx1) / 2,
      ey(eLeft + phi) - 4,
      pal.text2,
      pal.bg,
    );
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    haloText(ctx, "チャネル", x0, y1 - 14, pal.text2, pal.bg);
    ctx.textAlign = "right";
    haloText(ctx, "浮遊ゲート", x1, y1 - 14, pal.text2, pal.bg);
    ctx.restore();
  }

  /* ---------------------------------------------------- 右: 時間のグラフ */

  function drawPlot(r: Rect): void {
    const marginL = 58;
    const marginB = 46;
    setPlotRange(
      map,
      r.x + marginL,
      r.y + 12,
      r.w - marginL - 12,
      r.h - 12 - marginB,
      D_MIN,
      D_MAX,
      LOG_MIN,
      LOG_MAX,
    );
    drawPlotFrame(ctx, map, {
      colors,
      xTicks: X_TICKS,
      yTicks: Y_TICKS,
      xLabel: "トンネル酸化膜の厚さ [nm]",
      yLabel: "電子 1 個が抜けるまで [秒]",
    });

    // 目安の水平線
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const g of GUIDES) {
      const y = map.toPxY(g.log10s);
      ctx.strokeStyle = pal.ghost;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(map.rect.x, y);
      ctx.lineTo(map.rect.x + map.rect.w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      haloText(ctx, g.label, map.rect.x + 4, y - 1, pal.text2, pal.bg);
    }

    for (let i = 0; i < SAMPLES; i++) {
      keep[i] = log10Keep(ds[i]);
      write[i] = log10Write(ds[i]);
    }
    withPlotClip(ctx, map, () => {
      drawCurve(ctx, map, ds, keep, SAMPLES, {
        color: pal.electron,
        width: 2.4,
      });
      if (writing) {
        drawCurve(ctx, map, ds, write, SAMPLES, {
          color: pal.beam,
          width: 2,
          dash: [7, 5],
        });
      }
    });

    // 現在の点
    const px = map.toPxX(d);
    const yKeep = log10Keep(d);
    point(px, map.toPxY(yKeep), pal.electron, pal.electron);
    ctx.font = font(12);
    ctx.textAlign = px > map.rect.x + map.rect.w * 0.6 ? "right" : "left";
    ctx.textBaseline = "bottom";
    const off = ctx.textAlign === "right" ? -9 : 9;
    haloText(ctx, "保持", px + off, map.toPxY(yKeep) - 6, pal.electron, pal.bg);
    if (writing) {
      const yW = log10Write(d);
      point(px, map.toPxY(yW), pal.bg, pal.beam);
      ctx.textBaseline = "top";
      haloText(
        ctx,
        "書き込み",
        px + off,
        map.toPxY(yW) + 6,
        pal.beamInk,
        pal.bg,
      );
    }
  }

  function point(x: number, y: number, fill: string, stroke: string): void {
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ---- 読み取り値 ---- */
  const readout = createReadout(host);
  const tItem = readout.item("透過率 T");
  const keepItem = readout.item("電子 1 個が抜け出すまで", {
    color: "electron",
  });
  const writeItem = readout.item("書き込みの時間の目安", { color: "beam" });
  // 値の長さが変わっても折り返しが変わらないよう、いつも自分の行に置く
  writeItem.el.style.flexBasis = "100%";

  function updateReadouts(): void {
    const lnT = logTransmissionApprox(SIO2_BARRIER_EV, d, SIO2_MASS_RATIO);
    tItem.set(fmtFromLog10(lnT / Math.LN10));
    keepItem.set(formatDuration(Math.exp(logRetentionTime(d))));
    if (writing) {
      const lnTw = -tiltedBarrierExponent(
        SIO2_BARRIER_EV,
        field * MV_PER_CM_TO_V_PER_NM,
        d,
        SIO2_MASS_RATIO,
      );
      writeItem.set(
        `${formatDuration(Math.exp(logWriteTime(d, field)))}(T = ${fmtFromLog10(lnTw / Math.LN10)})`,
      );
    } else {
      writeItem.set("—(書き込みを on にする)");
    }
  }

  /* ---- 操作部品 ---- */
  const dSlider = host.controls.slider({
    id: "d",
    label: "トンネル酸化膜の厚さ",
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
  const writeToggle = host.controls.toggle({
    id: "write",
    label: "書き込み(高い電圧をかける)",
    value: false,
  });
  const fSlider = host.controls.slider({
    id: "field",
    label: "電場の強さ(書き込み時)",
    min: F_MIN,
    max: F_MAX,
    step: F_STEP,
    value: F_INIT,
    unit: "MV/cm",
  });
  setControlEnabled(fSlider.el, false);
  writeToggle.onChange((v) => {
    writing = v;
    setControlEnabled(fSlider.el, v);
    updateReadouts();
  });
  fSlider.onChange((v) => {
    field = v;
    updateReadouts();
  });
  host.controls.reset(() => {
    dSlider.set(D_INIT);
    writeToggle.set(false);
    fSlider.set(F_INIT);
    d = D_INIT;
    writing = false;
    field = F_INIT;
    setControlEnabled(fSlider.el, false);
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
