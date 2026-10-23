/**
 * binodal-spinodal.ts — 図3「2 本の線 — バイノーダルとスピノーダル」
 * (記事仕様書 09 §5.3)
 *
 * 左: 状態図(横軸 X、縦軸 T/Tc = 0.4〜1.1)。バイノーダル(実線)と
 * スピノーダル(破線)、3 つの領域のラベル。状態点(--color-accent の輪)は
 * ドラッグでき、キーボードでは矢印キーで動く(Shift で 5 倍)。
 * 右: その温度での g(X) の小さな図。曲率が負の区間(スピノーダルの内側)を
 * 太線で強調し、変曲点(スピノーダル)と共通接線の接点(バイノーダル)に印、
 * 状態点の組成に縦線。領域の判定は g''(X) の符号と同じ関数から出すので、
 * 左右の図は常に一致する。
 *
 * 実装方式: 2D Canvas / requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import {
  attachDragPoints,
  createReadout,
  drawFocusRing,
} from "../reciprocal-lattice/_shared2d";
import {
  type Axes,
  axInvX,
  axInvY,
  axX,
  axY,
  compositionTicks,
  drawAxisLines,
  drawDomes,
  drawGCurve,
  drawStateRing,
  drawXTicks,
  drawYTicks,
  fmtFixed,
  font,
  gAxisRange,
  linTicks,
  outlinedText,
  resolvePalette,
} from "./lib/draw";
import {
  type Region,
  binodal,
  chiFromT,
  commonTangent,
  d2gdc2,
  gMix,
  regionAt,
  sliderToTOverTc,
  spinodal,
} from "./lib/regular";

/** 状態点の範囲と初期値(§5.3) */
const X_MIN = 0.02;
const X_MAX = 0.98;
const T_LO = 0.4;
const T_HI = 1.1;
const X_INIT = 0.15;
const T_INIT = 0.67;
const STEP = 0.01;
const COARSE = 5;

const REGION_TEXT: Record<Region, string> = {
  stable: "安定(混ざったまま)",
  metastable: "準安定(核が要る)",
  unstable: "不安定(核は要らない)",
};

export default function binodalSpinodal(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /** 状態点(温度はスライダーと同じ 0.01 刻みの値。0.67 は 2/3 を表す) */
  let xState = X_INIT;
  let tState = T_INIT;

  const readout = createReadout(host);
  const roRegion = readout.item("領域");
  const roBinodal = readout.item("バイノーダル");
  const roSpinodal = readout.item("スピノーダル");
  const roCurv = readout.item("g''(X)");

  host.controls.reset(() => {
    xState = X_INIT;
    tState = T_INIT;
  });

  interface Layout {
    narrow: boolean;
    diagram: Axes;
    gPlot: Axes;
  }
  let layoutCache: Layout | null = null;

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const topH = Math.round(h * 0.56);
      return {
        narrow,
        diagram: {
          x: 40,
          y: pad + 18,
          w: w - 40 - 10,
          h: topH - pad - 18 - 32,
          xMin: 0,
          xMax: 1,
          yMin: T_LO,
          yMax: T_HI,
        },
        gPlot: {
          x: 40,
          y: topH + 26,
          w: w - 40 - 10,
          h: h - topH - 26 - 30,
          xMin: 0,
          xMax: 1,
          yMin: 0,
          yMax: 1,
        },
      };
    }
    const leftW = Math.round(w * 0.58);
    return {
      narrow,
      diagram: {
        x: 48,
        y: pad + 22,
        w: leftW - 48 - 14,
        h: h - pad - 22 - 36,
        xMin: 0,
        xMax: 1,
        yMin: T_LO,
        yMax: T_HI,
      },
      gPlot: {
        x: leftW + 44,
        y: pad + 22,
        w: w - leftW - 44 - 14,
        h: h - pad - 22 - 36,
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      },
    };
  }

  const drag = attachDragPoints(host, [
    {
      label: "状態点(矢印キーで組成と温度を動かす)",
      x: () => (layoutCache ? axX(layoutCache.diagram, xState) : 0),
      y: () => (layoutCache ? axY(layoutCache.diagram, tState) : 0),
      drag: (xPx, yPx) => {
        if (!layoutCache) return;
        const a = layoutCache.diagram;
        xState = snap(clamp(axInvX(a, xPx), X_MIN, X_MAX));
        tState = snap(clamp(axInvY(a, yPx), T_LO, T_HI));
      },
      key: (dx, dy, coarse) => {
        const s = coarse ? COARSE * STEP : STEP;
        xState = snap(clamp(xState + dx * s, X_MIN, X_MAX));
        tState = snap(clamp(tState + dy * s, T_LO, T_HI));
      },
    },
  ]);

  function snap(v: number): number {
    return Math.round(v / STEP) * STEP;
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout();
    layoutCache = L;
    const tPhys = sliderToTOverTc(tState);
    const chi = chiFromT(tPhys);
    const region = regionAt(xState, chi);
    drawDiagram(L, region);
    drawGPanel(L, chi);

    // 読み取り値
    roRegion.set(REGION_TEXT[region]);
    if (chi > 2) {
      const cb = binodal(chi);
      const cs = spinodal(chi);
      roBinodal.set(`${fmtFixed(cb, 4)} / ${fmtFixed(1 - cb, 4)}`);
      roSpinodal.set(`${fmtFixed(cs, 4)} / ${fmtFixed(1 - cs, 4)}`);
    } else {
      roBinodal.set("なし(T ≥ Tc)");
      roSpinodal.set("なし(T ≥ Tc)");
    }
    roCurv.set(d2gdc2(xState, chi) < 0 ? "負(上に凸)" : "正(下に凸)");
    drag.sync();
  }

  function drawDiagram(L: Layout, region: Region): void {
    const { diagram: a, narrow } = L;
    // 領域の淡い塗り(準安定の帯・不安定のドーム)
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    fillBand(a, "binodal", 0.07);
    fillBand(a, "spinodal", 0.07);
    ctx.restore();

    drawAxisLines(ctx, a, pal);
    drawXTicks(ctx, a, pal, compositionTicks(narrow), (v) => fmtFixed(v, 1));
    drawYTicks(ctx, a, pal, linTicks(T_LO, T_HI, narrow ? 4 : 7), (v) =>
      fmtFixed(v, 1),
    );
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("温度 T/Tc", a.x - (narrow ? 32 : 40), a.y - 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("組成 X(B の割合)", a.x + a.w / 2, a.y + a.h + 19);

    drawDomes(ctx, a, pal, 2);

    // 線の凡例
    const lx = a.x + a.w - (narrow ? 118 : 132);
    const ly = a.y + 4;
    ctx.font = font(narrow ? 10.5 : 11.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, ly + 6);
    ctx.lineTo(lx + 20, ly + 6);
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(lx, ly + 22);
    ctx.lineTo(lx + 20, ly + 22);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = pal.text2;
    ctx.fillText("バイノーダル", lx + 26, ly + 6);
    ctx.fillText("スピノーダル", lx + 26, ly + 22);

    // 領域のラベル(収まるところにだけ)
    ctx.font = font(narrow ? 11 : 12.5, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = pal.text2;
    ctx.fillText("安定", axX(a, 0.5), axY(a, 1.055));
    const tUn = 0.6;
    ctx.fillText("不安定", axX(a, 0.5), axY(a, tUn) - 8);
    ctx.font = font(narrow ? 10.5 : 11.5);
    ctx.fillText("(核は要らない)", axX(a, 0.5), axY(a, tUn) + 9);
    // 準安定: 低温側の帯(幅が最も広い)に縦書き風に 2 行で
    const tMeta = T_LO + 0.05;
    const chiMeta = chiFromT(tMeta);
    const xMeta = 0.5 * (binodal(chiMeta) + spinodal(chiMeta));
    const bandPx = (spinodal(chiMeta) - binodal(chiMeta)) * a.w;
    ctx.font = font(narrow ? 10 : 11.5, 600);
    const metaW = ctx.measureText("準安定").width;
    if (bandPx > metaW + 4) {
      for (const xv of [xMeta, 1 - xMeta]) {
        ctx.fillText("準安定", axX(a, xv), axY(a, tMeta) - 7);
        ctx.font = font(narrow ? 9.5 : 10.5);
        ctx.fillText("核が要る", axX(a, xv), axY(a, tMeta) + 8);
        ctx.font = font(narrow ? 10 : 11.5, 600);
      }
    }

    // 状態点
    const px = axX(a, xState);
    const py = axY(a, tState);
    drawStateRing(ctx, px, py, pal);
    if (drag.focusedIndex() === 0) drawFocusRing(ctx, px, py);
    // 状態点のラベル
    ctx.font = font(narrow ? 10.5 : 11.5);
    ctx.textBaseline = "bottom";
    const right = xState < 0.7;
    ctx.textAlign = right ? "left" : "right";
    outlinedText(
      ctx,
      `X = ${fmtFixed(xState, 2)}, T/Tc = ${fmtFixed(tState, 2)}`,
      px + (right ? 11 : -11),
      py - 6,
      region === "stable" ? pal.text2 : pal.text,
      pal.bg,
    );
  }

  /** バイノーダル(またはスピノーダル)のドームの内側を淡く塗る */
  function fillBand(a: Axes, kind: "binodal" | "spinodal", alpha: number) {
    const fn = kind === "binodal" ? binodal : spinodal;
    const n = 80;
    ctx.beginPath();
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k <= n; k++) {
        const s = pass === 0 ? k / n : 1 - k / n;
        const t = 1 - (1 - 0.3) * (1 - s) * (1 - s);
        const c = s >= 1 ? 0.5 : fn(chiFromT(t));
        const xv = pass === 0 ? c : 1 - c;
        if (pass === 0 && k === 0) ctx.moveTo(axX(a, xv), axY(a, t));
        else ctx.lineTo(axX(a, xv), axY(a, t));
      }
    }
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.text2;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawGPanel(L: Layout, chi: number): void {
    const { narrow } = L;
    const { yMin, yMax } = gAxisRange(chi, 0.22, 0.14);
    const a: Axes = { ...L.gPlot, yMin, yMax };
    drawAxisLines(ctx, a, pal);
    drawXTicks(ctx, a, pal, [0, 0.5, 1], (v) => fmtFixed(v, 1));
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `T/Tc = ${fmtFixed(tState, 2)} の g(X)`,
      a.x - (narrow ? 32 : 36),
      a.y - 6,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("組成 X", a.x + a.w / 2, a.y + a.h + 19);

    const tangent = commonTangent(chi);
    if (tangent) {
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(axX(a, 0), axY(a, tangent.intercept));
      ctx.lineTo(axX(a, 1), axY(a, tangent.slope + tangent.intercept));
      ctx.stroke();
    }
    // 曲線(細)と、曲率が負の区間(太)
    drawGCurve(ctx, a, chi, pal.text2, 1.75);
    if (chi > 2) {
      const cs = spinodal(chi);
      drawGCurve(ctx, a, chi, pal.text, 4, cs, 1 - cs);
      // 変曲点(スピノーダル)= 白抜きの丸
      for (const c of [cs, 1 - cs]) {
        ctx.beginPath();
        ctx.arc(axX(a, c), axY(a, gMix(c, chi)), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.bg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = pal.text;
        ctx.stroke();
      }
    }
    if (tangent) {
      // 接点(バイノーダル)= 塗りの丸
      for (const c of [tangent.cAlpha, tangent.cBeta]) {
        ctx.beginPath();
        ctx.arc(axX(a, c), axY(a, gMix(c, chi)), 4, 0, Math.PI * 2);
        ctx.fillStyle = pal.accent;
        ctx.fill();
      }
    }
    // 状態点の組成の縦線
    const px = axX(a, xState);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, a.y);
    ctx.lineTo(px, a.y + a.h);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(px, axY(a, gMix(xState, chi)), 4, 0, Math.PI * 2);
    ctx.fillStyle = pal.accent;
    ctx.fill();

    // 凡例(太線 = 曲率が負・変曲点・接点)
    ctx.font = font(narrow ? 10 : 11);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const legendY = a.y + 8;
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x + 8, legendY);
    ctx.lineTo(a.x + 26, legendY);
    ctx.stroke();
    outlinedText(
      ctx,
      "曲率が負(スピノーダルの内側)",
      a.x + 32,
      legendY,
      pal.text,
      pal.bg,
    );
    ctx.beginPath();
    ctx.arc(a.x + 17, legendY + 17, 4, 0, Math.PI * 2);
    ctx.fillStyle = pal.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.text;
    ctx.stroke();
    outlinedText(ctx, "変曲点", a.x + 32, legendY + 17, pal.text2, pal.bg);
    ctx.beginPath();
    ctx.arc(a.x + 17, legendY + 34, 4, 0, Math.PI * 2);
    ctx.fillStyle = pal.accent;
    ctx.fill();
    outlinedText(
      ctx,
      "共通接線の接点",
      a.x + 32,
      legendY + 34,
      pal.text2,
      pal.bg,
    );
  }

  host.onRender(draw);

  return {
    resize(): void {
      host.requestRender();
    },
    destroy(): void {
      drag.dispose();
    },
  };
}
