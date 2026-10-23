/**
 * free-energy-curve.ts — 図2「混ざるか分かれるか — 自由エネルギー曲線」
 * (記事仕様書 09 §5.2)
 *
 * 正則溶体の混合の自由エネルギー g(X)(RT 単位)。谷が 2 つある温度では
 * 共通接線(--color-accent)と接点(= バイノーダルの組成)を示す。組成 X0 は
 * 曲線上のドラッグ点(キーボードでは矢印キー)とスライダーで動かせる。
 * 接線が曲線より下にあるときだけ、その差を「分かれると下がる量」として
 * 寸法線で示し、下段のてこの絵で分かれた後の 2 相の割合を示す。
 *
 * 実装方式: 2D Canvas / requestRender(アイドル時は再描画しない)。
 * 簡略化(図注): 最も単純な正則溶体の模型(実際の合金の G(X) は非対称)。
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
  axX,
  axY,
  compositionTicks,
  drawAxisLines,
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
  chiFromT,
  commonTangent,
  gMix,
  leverFraction,
  separationGain,
  sliderToTOverTc,
} from "./lib/regular";

/** 温度スライダー(§5.2: 0.5〜1.2・step 0.01・初期 0.67 = 2/3) */
const T_MIN = 0.5;
const T_MAX = 1.2;
const T_INIT = 0.67;
/** 組成スライダー(0.02〜0.98・初期 0.35) */
const X_MIN = 0.02;
const X_MAX = 0.98;
const X_INIT = 0.35;
const X_STEP = 0.01;
const X_STEP_COARSE = 0.05;

export default function freeEnergyCurve(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  let tOverTc = sliderToTOverTc(T_INIT);
  let x0 = X_INIT;

  /* ---- 読み取り値(§5.2) ---- */
  const readout = createReadout(host);
  const roVerdict = readout.item("判定");
  const roGain = readout.item("分かれると下がる量");
  const roComp = readout.item("2 相の組成");
  const roFrac = readout.item("2 相の割合");

  /* ---- 操作部品 ---- */
  const tSlider = host.controls.slider({
    id: "t",
    label: "温度 T/Tc",
    min: T_MIN,
    max: T_MAX,
    step: 0.01,
    value: T_INIT,
  });
  tSlider.onChange((v) => {
    tOverTc = sliderToTOverTc(v);
    host.requestRender();
  });
  const xSlider = host.controls.slider({
    id: "x0",
    label: "組成 X₀",
    min: X_MIN,
    max: X_MAX,
    step: X_STEP,
    value: X_INIT,
  });
  xSlider.onChange((v) => {
    x0 = v;
    host.requestRender();
  });
  host.controls.reset(() => {
    tSlider.set(T_INIT);
    xSlider.set(X_INIT);
  });

  /* ---- レイアウト ---- */
  interface Layout {
    narrow: boolean;
    plot: Axes;
    leverY: number;
    leverH: number;
  }
  let layoutCache: Layout | null = null;

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const left = narrow ? 40 : 50;
    const right = narrow ? 10 : 18;
    const top = pad + 22;
    const leverH = narrow ? 96 : 92;
    const bottomAxis = 34;
    const plotH = h - top - bottomAxis - leverH - pad;
    const chi = chiFromT(tOverTc);
    const { yMin, yMax } = gAxisRange(chi);
    const plot: Axes = {
      x: left,
      y: top,
      w: w - left - right,
      h: plotH,
      xMin: 0,
      xMax: 1,
      yMin,
      yMax,
    };
    return {
      narrow,
      plot,
      leverY: top + plotH + bottomAxis + 6,
      leverH: leverH - 6,
    };
  }

  /* ---- ドラッグ点(曲線上の組成 — キーボードは矢印キー) ---- */
  const drag = attachDragPoints(host, [
    {
      label: "組成 X₀ の点(左右の矢印キーで動かす)",
      x: () => (layoutCache ? axX(layoutCache.plot, x0) : 0),
      y: () =>
        layoutCache ? axY(layoutCache.plot, gMix(x0, chiFromT(tOverTc))) : 0,
      drag: (xPx) => {
        if (!layoutCache) return;
        const v = clamp(axInvX(layoutCache.plot, xPx), X_MIN, X_MAX);
        xSlider.set(Math.round(v / X_STEP) * X_STEP);
      },
      key: (dx, _dy, coarse) => {
        if (dx === 0) return;
        const step = coarse ? X_STEP_COARSE : X_STEP;
        xSlider.set(
          clamp(Math.round((x0 + dx * step) / X_STEP) * X_STEP, X_MIN, X_MAX),
        );
      },
    },
  ]);

  /* ---- 描画 ---- */
  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout();
    layoutCache = L;
    const { plot: a, narrow } = L;
    const chi = chiFromT(tOverTc);
    const tangent = commonTangent(chi);
    const gain = separationGain(x0, chi);

    // 軸と目盛り
    drawAxisLines(ctx, a, pal);
    drawXTicks(ctx, a, pal, compositionTicks(narrow), (v) => fmtFixed(v, 1));
    const yTicks = linTicks(a.yMin, a.yMax, narrow ? 4 : 5);
    drawYTicks(ctx, a, pal, yTicks, (v) =>
      fmtFixed(v, Math.abs(v) < 1e-12 ? 0 : 2),
    );
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      "混合の自由エネルギー g(X) [RT]",
      a.x - (narrow ? 32 : 40),
      a.y - 6,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      narrow ? "組成 X(B の割合)" : "組成 X(B の割合)→",
      a.x + a.w / 2,
      a.y + a.h + 19,
    );

    // g = 0 の基準線
    if (a.yMin < 0 && a.yMax > 0) {
      ctx.strokeStyle = pal.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, axY(a, 0) + 0.5);
      ctx.lineTo(a.x + a.w, axY(a, 0) + 0.5);
      ctx.stroke();
    }

    // 共通接線(谷が 2 つあるときのみ)
    if (tangent) {
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(axX(a, 0), axY(a, tangent.intercept));
      ctx.lineTo(axX(a, 1), axY(a, tangent.slope + tangent.intercept));
      ctx.stroke();
    }

    // 曲線
    drawGCurve(ctx, a, chi, pal.text2, 2.25);

    if (tangent) {
      // 接点(= バイノーダルの組成)
      for (const c of [tangent.cAlpha, tangent.cBeta]) {
        const px = axX(a, c);
        const py = axY(a, gMix(c, chi));
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.accent;
        ctx.fill();
      }
      ctx.font = font(narrow ? 10.5 : 11.5);
      ctx.textBaseline = "top";
      const yLab = axY(a, tangent.intercept) + 9;
      ctx.textAlign = "left";
      outlinedText(
        ctx,
        `接点 Xα = ${fmtFixed(tangent.cAlpha, 4)}`,
        Math.max(a.x + 2, axX(a, tangent.cAlpha) - 10),
        yLab,
        pal.accent,
        pal.bg,
      );
      ctx.textAlign = "right";
      outlinedText(
        ctx,
        `Xβ = ${fmtFixed(tangent.cBeta, 4)}`,
        Math.min(a.x + a.w - 2, axX(a, tangent.cBeta) + 10),
        yLab,
        pal.accent,
        pal.bg,
      );
      if (!narrow) {
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        outlinedText(
          ctx,
          "共通接線",
          axX(a, 0.5),
          axY(a, tangent.intercept) - 5,
          pal.accent,
          pal.bg,
        );
      }
    }

    // 「分かれると下がる量」の寸法線
    const gx = gMix(x0, chi);
    const px0 = axX(a, x0);
    if (tangent && gain > 0) {
      const yCurve = axY(a, gx);
      const yTan = axY(a, tangent.slope * x0 + tangent.intercept);
      ctx.strokeStyle = pal.text;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(px0, yCurve + 9);
      ctx.lineTo(px0, yTan);
      ctx.moveTo(px0 - 5, yTan + 0.5);
      ctx.lineTo(px0 + 5, yTan + 0.5);
      ctx.stroke();
      // 接線上の点(分かれた 2 相の混合物のエネルギー)
      ctx.beginPath();
      ctx.arc(px0, yTan, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
      ctx.font = font(narrow ? 11 : 12);
      const labelLeft = x0 > 0.62;
      ctx.textAlign = labelLeft ? "right" : "left";
      ctx.textBaseline = "middle";
      const lx = px0 + (labelLeft ? -10 : 10);
      const ly = (yCurve + yTan) / 2;
      outlinedText(ctx, "分かれると", lx, ly - 8, pal.text, pal.bg);
      outlinedText(
        ctx,
        `下がる量 ${fmtFixed(gain, 3)}`,
        lx,
        ly + 8,
        pal.text,
        pal.bg,
      );
    }

    // 組成の点(ドラッグ点)
    drawStateRing(ctx, px0, axY(a, gx), pal);
    if (drag.focusedIndex() === 0) drawFocusRing(ctx, px0, axY(a, gx));

    drawLever(
      L,
      tangent ? tangent.cAlpha : NaN,
      tangent ? tangent.cBeta : NaN,
      gain > 0,
    );

    // 読み取り値
    if (gain > 0 && tangent) {
      const fB = leverFraction(x0, tangent.cAlpha, tangent.cBeta);
      roVerdict.set("分かれたほうが得");
      roGain.set(`${fmtFixed(gain, 4)} RT`);
      roComp.set(
        `${fmtFixed(tangent.cAlpha, 4)} と ${fmtFixed(tangent.cBeta, 4)}`,
      );
      roFrac.set(
        `α ${Math.round((1 - fB) * 100)}% : β ${Math.round(fB * 100)}%`,
      );
    } else {
      roVerdict.set("混ざったままが得");
      roGain.set("0(分かれても下がらない)");
      roComp.set(tangent ? "—(1 相のまま)" : "—(谷が 1 つ)");
      roFrac.set("—");
    }
    drag.sync();
  }

  /** てこの絵: 支点 = X0、両端 = 2 つの接点、重りの面積 = 各相の割合 */
  function drawLever(L: Layout, cA: number, cB: number, split: boolean): void {
    const { plot: a, narrow } = L;
    const y0 = L.leverY;
    const beamY = y0 + L.leverH * 0.42;
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      narrow
        ? "てこの原理(分かれた後の量)"
        : "てこの原理 — 分かれた後の 2 相の量",
      a.x - (narrow ? 32 : 40),
      y0,
    );
    if (!split) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "この組成では分かれない(1 相のまま)",
        a.x + a.w / 2,
        beamY + 8,
      );
      return;
    }
    const fB = leverFraction(x0, cA, cB);
    const xa = axX(a, cA);
    const xb = axX(a, cB);
    const xf = axX(a, x0);
    // 梁と支点
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(xa, beamY);
    ctx.lineTo(xb, beamY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xf, beamY + 2);
    ctx.lineTo(xf - 8, beamY + 15);
    ctx.lineTo(xf + 8, beamY + 15);
    ctx.closePath();
    ctx.fillStyle = pal.accent;
    ctx.fill();
    // 重り(面積 ∝ 割合)
    const rMax = narrow ? 17 : 19;
    const weights: Array<[number, number, string, string, string]> = [
      [xa, 1 - fB, pal.matrix, pal.matrixEdge, "α(A リッチ)"],
      [xb, fB, pal.second, pal.secondEdge, "β(B リッチ)"],
    ];
    for (const [x, f, fill, edge, name] of weights) {
      const r = Math.max(2, rMax * Math.sqrt(f));
      ctx.beginPath();
      ctx.arc(x, beamY - r - 1.5, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.font = font(narrow ? 10.5 : 11.5);
      ctx.fillStyle = pal.text;
      ctx.textAlign = x < a.x + a.w / 2 ? "left" : "right";
      ctx.textBaseline = "top";
      const tx =
        x < a.x + a.w / 2
          ? Math.max(a.x - 30, x - 14)
          : Math.min(a.x + a.w + 6, x + 14);
      ctx.fillText(`${name} ${Math.round(f * 100)}%`, tx, beamY + 18);
    }
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
