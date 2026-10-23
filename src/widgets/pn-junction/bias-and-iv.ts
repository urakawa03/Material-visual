/**
 * bias-and-iv.ts — 図5「バイアス 1 つで、全部が動く」(仕様書 13 §5.5)
 *
 * 左(幅 58%、狭幅では上): バンド図。順バイアスでは空乏層の中で擬フェルミ準位
 * E_Fn(`--mat-electron` の破線)と E_Fp(`--mat-hole` の破線)が分かれ、差 qV の
 * 寸法線を付ける(中性領域の奥で 1 本に合流する — 合流は拡散長の見た目上の
 * 距離で模式的に描く)。逆バイアスでは逆向きに分かれる。空乏層の幅を下端の帯で
 * 示す(図2・図3 と同じ破線の位置)。
 * 右(幅 42%、狭幅では下): I-V 曲線(`--mat-level` の実線)と、現在の動作点
 * (`--mat-electron` の丸)。縦軸は線形 ⇄ 対数(|J|)。
 *
 * **1 つのバイアス状態 V から、バンド図・空乏層・動作点を同じ draw で同時に
 * 更新する**(3 つを別々のウィジェットにしない — 本図の存在理由)。
 *
 * モデル: lib/junction.ts の空乏層近似と理想ダイオード式(式 E9・E10)。順方向は
 * V_bi に近づくと空乏層近似が成り立たなくなり、実際には直列抵抗も効くので +0.65 V
 * で打ち切る。降伏は描かない(本文で触れる)。擬フェルミ準位の差 = qV は
 * quasiFermiSplit と整合する(式 E11)。
 *
 * 表示の工夫(図注に明示):
 * - I-V の横軸は、逆方向(−5〜0 V)を順方向(0〜0.65 V)より縮めて描く
 *   (一様な目盛りでは順方向の立ち上がりが右端の 1 割に潰れるため)
 * - 位置軸の範囲はドーピングだけで決める(−5 V の空乏層が収まる幅)。バイアスで
 *   範囲を変えないので、空乏層の伸び縮みがそのまま見える
 * - エネルギー軸は、逆バイアスで n 側のバンドが下がって収まらなくなったときだけ
 *   2 eV ずつ広げる(150 ms で補間)
 *
 * 実装方式: 2D Canvas / requestRender(アイドル時は再描画しない)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fmtSci, fmtSig, linTicks } from "../../core/plot";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawPlotFrame,
  PLOT_FONT,
  PLOT_FONT_SMALL,
  pow10Ticks,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { SILICON } from "../_shared/semiconductor";
import {
  DOPING_INIT,
  MIN_HALF_RANGE_UM,
  ROOM_T,
  SI_LIFETIMES,
} from "./lib/constants";
import {
  depletion,
  diodeCurrent,
  quasiFermiLevels,
  saturationCurrent,
  voltsPerDecade,
  type Depletion,
} from "./lib/junction";
import {
  AnimatedRange,
  BandSamples,
  curveSamples,
  drawBadge,
  drawBands,
  drawBoxedLabel,
  drawDimension,
  drawEdgeLine,
  drawFermiLine,
  drawLabel,
  drawSplitDivider,
  fixedSigned,
  formatEvFixed,
  micronTicks,
  NARROW_WIDTH_PX,
  pnColors,
  snapLog,
  splitByFraction,
} from "./lib/draw";

/** 操作パラメータ(§5.5 の表) */
const V_MIN = -5;
const V_MAX = 0.65;
const V_STEP = 0.01;
const V_INIT = 0;
const DOPING_MIN = 1e15;
const DOPING_MAX = 1e18;
type Axis = "lin" | "log";
const AXIS_INIT: Axis = "lin";
/** 帯の見た目の厚み [eV] */
const BAND_THICKNESS = 0.36;
/** エネルギー軸の上端 [eV] と、下端の段(収まらなければ 2 eV ずつ広げる) */
const E_TOP = 1.62;
const E_BOTTOM_BASE = -1.4;
const E_BOTTOM_STEP = 2;
/** 対数軸の範囲(log₁₀ |J| [A/cm²])。10¹⁸ cm⁻³ の J₀ ≈ 1.8 × 10⁻¹³ まで入れる */
const LOG_MIN = -14;
const LOG_MAX = 2;
/** I-V の横軸: 逆方向 [V_MIN, 0] と順方向 [0, V_MAX] が占める幅の割合 */
const REVERSE_SHARE = 0.3;
const FORWARD_SHARE = 0.7;
const U_PAD = 0.03;
/** 擬フェルミ準位が合流する見た目上の距離(中性領域の長さに対する割合) */
const MERGE_FRACTION = 0.28;
/** −5 V の空乏層の端を表示範囲のこの割合までに収める */
const FIT_MARGIN = 1.12;

/** バイアス V → I-V の横軸の座標 u(逆方向を縮める) */
function toU(v: number): number {
  return v >= 0 ? (FORWARD_SHARE * v) / V_MAX : (REVERSE_SHARE * v) / -V_MIN;
}

const V_TICK_VALUES = [-5, -2.5, 0, 0.2, 0.4, 0.6];
const IV_X_TICKS: readonly AxisTick[] = V_TICK_VALUES.map((v) => ({
  value: toU(v),
  label: v === 0 ? "0" : fixedSigned(v, v === -2.5 ? 1 : v < 0 ? 0 : 1),
}));

export default function biasAndIv(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = pnColors();
  const band = createPlotMapper();
  const iv = createPlotMapper();
  const bands = new BandSamples(241);
  /** 図中の小さな文字の幅 [px] */
  function textWidth(text: string, font: string = PLOT_FONT_SMALL): number {
    ctx.save();
    ctx.font = font;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
  }
  const logTicksWide = pow10Ticks(LOG_MIN, LOG_MAX, 2);
  const logTicksNarrow = pow10Ticks(LOG_MIN, LOG_MAX, 4);

  /* ---- 状態(1 つのバイアス V がすべての表示を決める) ---- */
  let bias = V_INIT;
  let doping = DOPING_INIT;
  let axis: Axis = AXIS_INIT;
  let d: Depletion = depletion(SILICON, doping, doping, bias, ROOM_T);
  let j0 = saturationCurrent(SILICON, SI_LIFETIMES, doping, doping, ROOM_T);
  let jMax = diodeCurrent(j0, V_MAX, ROOM_T);

  /** 位置軸の半幅: ドーピングだけで決める(−5 V の空乏層が収まる幅) */
  function halfRangeFor(n: number): number {
    const d0 = depletion(SILICON, n, n, 0, ROOM_T);
    const dRev = depletion(SILICON, n, n, V_MIN, ROOM_T);
    return Math.max(
      MIN_HALF_RANGE_UM,
      1.5 * d0.w,
      FIT_MARGIN * Math.max(dRev.xp, dRev.xn),
    );
  }
  /** エネルギー軸の下端: n 側の価電子帯の帯が収まる最も浅い段 */
  function bottomFor(dd: Depletion): number {
    const need = -dd.drop - BAND_THICKNESS - 0.12;
    let b = E_BOTTOM_BASE;
    while (b > need) b -= E_BOTTOM_STEP;
    return b;
  }
  const xRange = new AnimatedRange(halfRangeFor(doping));
  const eBottom = new AnimatedRange(bottomFor(d));

  /* ---- I-V 曲線(パラメータ変更時だけ計算し直す) ---- */
  const MAX_IV = 241;
  const ivU = new Float64Array(MAX_IV);
  const ivLin = new Float64Array(MAX_IV);
  const ivLog = new Float64Array(MAX_IV);
  let ivCount = 0;
  let ivSampledFor = -1;
  function sampleIv(n: number): void {
    const nRev = Math.round(n / 4);
    const nFwd = n - nRev;
    let k = 0;
    for (let i = 0; i < nRev; i++) {
      const v = V_MIN + ((0 - V_MIN) * i) / nRev;
      const j = diodeCurrent(j0, v, ROOM_T);
      ivU[k] = toU(v);
      ivLin[k] = j;
      ivLog[k] = Math.log10(Math.max(Math.abs(j), 1e-300));
      k++;
    }
    for (let i = 0; i < nFwd; i++) {
      const v = (V_MAX * i) / (nFwd - 1);
      const j = diodeCurrent(j0, v, ROOM_T);
      ivU[k] = toU(v);
      ivLin[k] = j;
      ivLog[k] = Math.log10(Math.max(Math.abs(j), 1e-300));
      k++;
    }
    ivCount = k;
  }

  function recompute(dopingChanged: boolean): void {
    d = depletion(SILICON, doping, doping, bias, ROOM_T);
    if (dopingChanged) {
      j0 = saturationCurrent(SILICON, SI_LIFETIMES, doping, doping, ROOM_T);
      jMax = diodeCurrent(j0, V_MAX, ROOM_T);
      ivSampledFor = -1;
      xRange.set(halfRangeFor(doping), () => host.requestRender());
    }
    eBottom.set(bottomFor(d), () => host.requestRender(), 200);
  }

  /* ---- バンド図 ---- */
  function drawBandPanel(narrow: boolean): void {
    const R = xRange.value;
    const yTicks = linTicks(
      eBottom.value + 0.2,
      E_TOP - 0.2,
      narrow ? 4 : 5,
    ).map((v) => ({ value: v, label: fixedSigned(v, v % 1 === 0 ? 0 : 1) }));
    drawPlotFrame(ctx, band, {
      colors,
      xTicks: micronTicks(-R, R, narrow ? 4 : 5),
      yTicks,
      xLabel: "位置 x [μm]",
      yLabel: narrow ? undefined : "エネルギー [eV]",
    });
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
    const split = Math.abs(q.eFn - q.eFp) > 1e-9;
    // 中性領域が狭い(強い逆バイアス)ときは、合流が図の外まで続くように下限を置く
    const ell = Math.max(MERGE_FRACTION * (R - Math.max(d.xp, d.xn)), 0.1 * R);
    withPlotClip(ctx, band, () => {
      drawBands(ctx, band, bands, colors);
      for (const x of [-d.xp, d.xn]) drawEdgeLine(ctx, band, x, colors.text2);
      if (!split) {
        drawFermiLine(ctx, band, -R, R, q.eFp, colors, "");
      } else {
        // E_Fn: n 側から空乏層を通って p 側へ一定、p 側の中性領域で E_Fp に合流
        // E_Fp: p 側から空乏層を通って n 側へ一定、n 側の中性領域で E_Fn に合流
        const n = bands.count;
        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        for (const electron of [true, false]) {
          ctx.strokeStyle = electron ? colors.electron : colors.hole;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x = bands.xs[i];
            let e: number;
            if (electron) {
              e =
                x >= -d.xp
                  ? q.eFn
                  : q.eFp + (q.eFn - q.eFp) * Math.exp((x + d.xp) / ell);
            } else {
              e =
                x <= d.xn
                  ? q.eFp
                  : q.eFn + (q.eFp - q.eFn) * Math.exp(-(x - d.xn) / ell);
            }
            const px = band.toPxX(x);
            const py = band.toPxY(e);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      // 空乏層の幅(下端の帯)
      const y = band.rect.y + band.rect.h - 9;
      ctx.save();
      ctx.fillStyle = colors.text2;
      ctx.globalAlpha = 0.35;
      const x0 = band.toPxX(-d.xp);
      ctx.fillRect(x0, y - 3, Math.max(1.5, band.toPxX(d.xn) - x0), 6);
      ctx.restore();
    });
    // 空乏層の帯のラベル(帯の右 → 入らなければ左 → それも無理なら帯の上)
    const wText = `空乏層 W = ${d.w.toFixed(3)} μm`;
    const wW = textWidth(wText);
    const barY = band.rect.y + band.rect.h - 9;
    const barL = band.toPxX(-d.xp);
    const barR = band.toPxX(d.xn);
    const plotR = band.rect.x + band.rect.w;
    if (barR + 6 + wW < plotR - 2) {
      drawLabel(ctx, wText, barR + 6, barY, colors.text2, "left");
    } else if (barL - 6 - wW > band.rect.x + 2) {
      drawLabel(ctx, wText, barL - 6, barY, colors.text2, "right");
    } else {
      drawBoxedLabel(
        ctx,
        wText,
        (barL + barR) / 2,
        barY - 13,
        colors,
        "center",
      );
    }
    // 擬フェルミ準位のラベルと差 qV の寸法
    if (!split) {
      drawLabel(
        ctx,
        "E_F",
        band.toPxX(-R) + 4,
        band.toPxY(q.eFp) - 9,
        colors.electron,
        "left",
        "middle",
        PLOT_FONT,
      );
    } else {
      drawLabel(
        ctx,
        "E_Fp",
        band.toPxX(-R) + 4,
        band.toPxY(q.eFp) + (q.eFp > q.eFn ? -9 : 9),
        colors.hole,
        "left",
        "middle",
        PLOT_FONT,
      );
      drawLabel(
        ctx,
        "E_Fn",
        band.toPxX(R) - 4,
        band.toPxY(q.eFn) + (q.eFn > q.eFp ? -9 : 9),
        colors.electron,
        "right",
        "middle",
        PLOT_FONT,
      );
      // 差 qV の寸法: 空乏層の右の端のすぐ外(ラベルが入らなければ空乏層の中)
      const qText =
        bias > 0
          ? `qV = ${formatEvFixed(q.eFn - q.eFp)}`
          : `q|V| = ${formatEvFixed(q.eFp - q.eFn)}`;
      const outside = band.toPxX(d.xn) + 10;
      const xDim =
        outside + 14 + textWidth(qText, PLOT_FONT) < band.rect.x + band.rect.w
          ? outside
          : band.toPxX(0);
      drawDimension(
        ctx,
        xDim,
        band.toPxY(q.eFn),
        band.toPxY(q.eFp),
        qText,
        colors,
        "right",
      );
    }
    // 坂の高さ(p 側の中性領域。n 側の E_c の高さを参照線で示す)
    const ecN = SILICON.eg - d.drop;
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const xRef = band.toPxX(-R + 0.1 * R);
    ctx.moveTo(xRef - 4, band.toPxY(ecN));
    ctx.lineTo(band.toPxX(d.xn), band.toPxY(ecN));
    ctx.stroke();
    ctx.restore();
    drawDimension(
      ctx,
      xRef,
      band.toPxY(SILICON.eg),
      band.toPxY(ecN),
      narrow ? d.drop.toFixed(2) : `坂 ${d.drop.toFixed(2)} eV`,
      colors,
      "right",
    );
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
    if (d.clamped) {
      drawBadge(
        ctx,
        [
          "V_bi に近く、空乏層近似の適用外",
          `(坂は ${(d.drop * 1000).toFixed(0)} meV で止めて描いた)`,
        ],
        band.rect.x + band.rect.w - 6,
        band.rect.y + 6,
        colors,
        band.rect.w - 12,
        "right",
      );
    }
  }

  /* ---- I-V 曲線 ---- */
  function drawIvPanel(narrow: boolean): void {
    const n = curveSamples(host.size.w);
    if (ivSampledFor !== n) {
      sampleIv(n);
      ivSampledFor = n;
    }
    const j = diodeCurrent(j0, bias, ROOM_T);
    const linear = axis === "lin";
    let yTicks: AxisTick[];
    if (linear) {
      yTicks = linTicks(0, jMax, narrow ? 3 : 4).map((v) => ({
        value: v,
        label: v === 0 ? "0" : fmtSig(v, 2),
      }));
    } else {
      yTicks = narrow ? logTicksNarrow : logTicksWide;
    }
    drawPlotFrame(ctx, iv, {
      colors,
      xTicks: IV_X_TICKS,
      yTicks,
      xLabel: "バイアス V [V]",
      yLabel: linear ? "電流密度 J [A/cm²]" : "|J| [A/cm²](対数)",
    });
    withPlotClip(ctx, iv, () => {
      // 補助線: J = 0(線形)、V = 0
      ctx.save();
      ctx.strokeStyle = colors.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const u0 = Math.round(iv.toPxX(0)) + 0.5;
      ctx.moveTo(u0, iv.rect.y);
      ctx.lineTo(u0, iv.rect.y + iv.rect.h);
      if (linear) {
        const y0 = Math.round(iv.toPxY(0)) + 0.5;
        ctx.moveTo(iv.rect.x, y0);
        ctx.lineTo(iv.rect.x + iv.rect.w, y0);
      }
      ctx.stroke();
      ctx.restore();
      if (!linear) {
        // 飽和電流 J₀ の高さ
        ctx.save();
        ctx.strokeStyle = colors.text2;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        const yJ0 = iv.toPxY(Math.log10(j0));
        ctx.moveTo(iv.rect.x, yJ0);
        ctx.lineTo(iv.rect.x + iv.rect.w, yJ0);
        ctx.stroke();
        ctx.restore();
      }
      // I-V 曲線
      ctx.save();
      ctx.strokeStyle = colors.level;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const ys = linear ? ivLin : ivLog;
      const yLo = linear ? iv.yMin - 1 : LOG_MIN - 2;
      for (let i = 0; i < ivCount; i++) {
        const px = iv.toPxX(ivU[i]);
        const py = iv.toPxY(Math.max(yLo, ys[i]));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
      // 動作点
      const px = iv.toPxX(toU(bias));
      let py: number;
      if (linear) py = iv.toPxY(j);
      else if (j === 0) py = iv.rect.y + iv.rect.h - 1;
      else py = iv.toPxY(Math.max(LOG_MIN, Math.log10(Math.abs(j))));
      ctx.save();
      ctx.fillStyle = colors.electron;
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
    // 注記
    if (linear) {
      drawBoxedLabel(
        ctx,
        narrow ? "逆方向: J ≈ −J₀(ほぼ 0)" : "逆方向: J ≈ −J₀(ほぼ 0 に見える)",
        iv.rect.x + 6,
        iv.toPxY(0) - 12,
        colors,
        "left",
      );
    } else {
      drawBoxedLabel(
        ctx,
        `J₀ = ${fmtSci(j0, 3)}`,
        iv.rect.x + 6,
        iv.toPxY(Math.log10(j0)) - 11,
        colors,
        "left",
      );
      drawBoxedLabel(
        ctx,
        `1 桁 / ${(voltsPerDecade(ROOM_T) * 1000).toFixed(1)} mV`,
        iv.toPxX(toU(0.3)),
        iv.toPxY(-4.5),
        colors,
        "left",
      );
      if (bias === 0) {
        drawLabel(
          ctx,
          "J = 0",
          iv.toPxX(0) + 8,
          iv.rect.y + iv.rect.h - 10,
          colors.electron,
          "left",
        );
      }
    }
    drawLabel(
      ctx,
      narrow ? "逆方向は縮めた" : "逆方向は横軸を縮めた",
      iv.rect.x + 4,
      iv.rect.y + 9,
      colors.text2,
      "left",
    );
  }

  /** 2 パネルの配置(寸法が変わったときだけ作り直す) */
  let layout = splitByFraction(host.size, 0.58, 0.55);
  let layoutW = host.size.w;
  let layoutH = host.size.h;

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    if (w !== layoutW || h !== layoutH) {
      layout = splitByFraction(host.size, 0.58, 0.55);
      layoutW = w;
      layoutH = h;
    }
    const a = layout.first;
    const b = layout.second;
    const R = xRange.value;
    const bandLeft = narrow ? 36 : 58;
    setPlotRange(
      band,
      a.x + bandLeft,
      a.y + 22,
      a.w - bandLeft - 8,
      a.h - 22 - 40,
      -R,
      R,
      eBottom.value,
      E_TOP,
    );
    const ivLeft = narrow ? 52 : 58;
    const linear = axis === "lin";
    setPlotRange(
      iv,
      b.x + ivLeft,
      b.y + 22,
      b.w - ivLeft - 10,
      b.h - 22 - 40,
      toU(V_MIN) - U_PAD,
      toU(V_MAX) + U_PAD,
      linear ? -0.12 * jMax : LOG_MIN,
      linear ? 1.08 * jMax : LOG_MAX,
    );
    // 1 つの V から 3 つの表示(バンド図・空乏層・動作点)を同じフレームで描く
    drawBandPanel(narrow);
    drawSplitDivider(ctx, layout, colors);
    drawIvPanel(narrow);

    // 読み取り値
    const j = diodeCurrent(j0, bias, ROOM_T);
    vItem.set(`${bias > 0 ? "+" : ""}${fixedSigned(bias, 2)} V`);
    barrierItem.set(`${d.drop.toFixed(3)} eV`);
    wItem.set(`${d.w.toFixed(3)} μm`);
    jItem.set(j === 0 ? "0 A/cm²" : `${fmtSci(j, 3)} A/cm²`);
    kindItem.set(bias > 0 ? "順方向" : bias < 0 ? "逆方向" : "ゼロ");
    const q = quasiFermiLevels(d);
    splitItem.set(
      bias > 0
        ? d.clamped
          ? `${formatEvFixed(q.eFn - q.eFp)}(近似の適用外で止めた値)`
          : formatEvFixed(q.eFn - q.eFp)
        : "—(順方向のとき)",
    );
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const vItem = readout.item("V");
  const barrierItem = readout.item("坂の高さ");
  const wItem = readout.item("W");
  const jItem = readout.item("J", { color: "electron" });
  const kindItem = readout.item("区分");
  const splitItem = readout.item("E_Fn − E_Fp");

  const biasSlider = host.controls.slider({
    id: "bias",
    label: "バイアス V",
    min: V_MIN,
    max: V_MAX,
    step: V_STEP,
    value: V_INIT,
    unit: "V",
    format: (v) => `${v > 0 ? "+" : ""}${fixedSigned(v, 2)}`,
  });
  const axisSeg = host.controls.segmented<Axis>({
    id: "axis",
    label: "電流の軸",
    options: [
      { value: "lin", label: "線形" },
      { value: "log", label: "対数" },
    ],
    value: AXIS_INIT,
  });
  const dopingSlider = host.controls.slider({
    id: "doping",
    label: "ドーピング(両側)",
    min: DOPING_MIN,
    max: DOPING_MAX,
    value: DOPING_INIT,
    scale: "log",
    unit: "cm⁻³",
    format: (v) => fmtSci(snapLog(v), 2),
  });
  biasSlider.onChange((v) => {
    // 刻みの丸め誤差を除く(0 ちょうどで「ゼロ」になるように)
    bias = Math.round(v / V_STEP) * V_STEP;
    if (Math.abs(bias) < V_STEP / 2) bias = 0;
    recompute(false);
  });
  axisSeg.onChange((v) => {
    axis = v;
  });
  dopingSlider.onChange((v) => {
    doping = snapLog(v);
    recompute(true);
  });

  host.controls.reset(() => {
    biasSlider.set(V_INIT);
    axisSeg.set(AXIS_INIT);
    dopingSlider.set(DOPING_INIT);
    bias = V_INIT;
    axis = AXIS_INIT;
    doping = DOPING_INIT;
    recompute(true);
    xRange.jump(halfRangeFor(doping));
    eBottom.jump(bottomFor(d));
  });

  host.onRender(draw);

  return {
    destroy(): void {
      xRange.cancel();
      eBottom.cancel();
      readout.el.remove();
    },
  };
}
