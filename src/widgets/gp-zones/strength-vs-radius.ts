/**
 * strength-vs-radius.ts — 図7「交点がピーク」(記事仕様書 07 §5.7)
 *
 * 横軸 = 粒子半径 r(対数)、縦軸 = 必要せん断応力 [MPa]。
 *   せん断(切断)  τ_cut = k√(rf)      … r の増加関数(--mat-precip)
 *   迂回(オロワン)τ_bow = μb√f/(βr)   … r の減少関数(--mat-defect)
 * 転位は安い方の道を選ぶので、実際に効くのは 2 曲線の**下側の包絡線**であり、
 * その**交点がピーク時効**である。
 *
 * 本モデルでは両機構とも √f に比例するため、f を変えても交点半径は動かず、
 * ピークの高さだけが変わる(§5.7 の図注・本文で明示)。
 *
 * 簡略化(図注):
 * - せん断側は √(rf) の現象論(整合ひずみ・規則度などの寄与をまとめたもの)。
 * - オロワン式は対数係数を落とした簡略形。β は板状粒子を球で代表するための
 *   実効的な幾何係数。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import { R_CROSS_NM } from "./lib/constants";
import {
  bowingMPa,
  hardnessHV,
  shearingMPa,
  spacing,
  strengtheningMPa,
} from "./lib/aging";
import {
  type Pane,
  drawReadouts,
  fmtSig,
  font,
  linTicks,
  logTicks,
  resolvePalette,
} from "./lib/draw";

/** 半径軸の範囲 [nm] */
const R_MIN = 0.3;
const R_MAX = 100;
/** 応力軸の上限 [MPa] */
const TAU_MAX = 400;
/** 曲線のサンプル数 */
const SAMPLES = 160;
/** 体積分率スライダー */
const F_MIN = 0.02;
const F_MAX = 0.12;
const F_STEP = 0.005;
const F_INIT = 0.07;
/** 半径スライダーの初期値 [nm](交点) */
const R_INIT = R_CROSS_NM;

const TAU2 = Math.PI * 2;

export default function strengthVsRadius(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const c = resolvePalette();

  let rNm = R_INIT;
  let f = F_INIT;
  let showHv = false;

  /* ---- 操作部品(§7.2) ---- */

  const rSlider = host.controls.slider({
    id: "r",
    label: "粒子半径 r",
    min: R_MIN,
    max: R_MAX,
    value: R_INIT,
    scale: "log",
    unit: "nm",
  });
  rSlider.onChange((v) => {
    rNm = v;
    host.requestRender();
  });

  const fSlider = host.controls.slider({
    id: "f",
    label: "体積分率 f",
    min: F_MIN,
    max: F_MAX,
    step: F_STEP,
    value: F_INIT,
    format: (v) => `${(v * 100).toFixed(1)} %`,
  });
  fSlider.onChange((v) => {
    f = v;
    host.requestRender();
  });

  const hvToggle = host.controls.toggle({
    id: "hv",
    label: "硬さ目盛りを重ねる",
    value: false,
  });
  hvToggle.onChange((v) => {
    showHv = v;
    host.requestRender();
  });

  host.controls.reset(() => {
    rSlider.set(R_INIT);
    fSlider.set(F_INIT);
    hvToggle.set(false);
  });

  /* ---- レイアウト ---- */

  function layout(): { plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 36 : 22;
    const left = narrow ? 34 : 42;
    const right = showHv ? (narrow ? 34 : 42) : pad;
    const bottom = narrow ? 30 : 34;
    return {
      plot: {
        x: pad + left,
        y: pad + strip + 10,
        w: w - pad * 2 - left - right,
        h: h - pad * 2 - strip - 10 - bottom,
      },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { plot: p, narrow } = layout();

    const lnMin = Math.log(R_MIN);
    const lnMax = Math.log(R_MAX);
    const mapX = (r: number): number =>
      p.x + (p.w * (Math.log(r) - lnMin)) / (lnMax - lnMin);
    const mapY = (t: number): number =>
      p.y + p.h - (p.h * clamp(t, 0, TAU_MAX)) / TAU_MAX;

    const cut = shearingMPa(rNm, f);
    const bow = bowingMPa(rNm, f);
    const dtau = Math.min(cut, bow);
    const isCut = cut <= bow;

    /* 読み出し */
    drawReadouts(
      ctx,
      [
        [`r ${fmtSig(rNm)} nm`, c.text],
        [`L ${fmtSig(spacing(rNm, f))} nm`, c.text],
        [`切る ${fmtSig(cut)} MPa`, c.precipEdge],
        [`迂回 ${fmtSig(bow)} MPa`, c.defect],
        [
          `Δτ ${fmtSig(dtau)} MPa(${isCut ? "切って通る" : "迂回する"})`,
          c.text,
        ],
      ],
      narrow ? 8 : 12,
      narrow ? 6 : 8,
      w - 8,
      narrow,
    );

    /* 軸 */
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y);
    ctx.lineTo(p.x + 0.5, p.y + p.h + 0.5);
    ctx.lineTo(p.x + p.w, p.y + p.h + 0.5);
    ctx.stroke();

    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, TAU_MAX, 4)) {
      if (v === 0) continue;
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(p.x - 3, y + 0.5);
      ctx.lineTo(p.x + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), p.x - 5, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("必要な応力 [MPa]", p.x + 2, p.y - 4);

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of logTicks(R_MIN, R_MAX)) {
      const x = mapX(t);
      ctx.beginPath();
      ctx.moveTo(x, p.y + p.h + 0.5);
      ctx.lineTo(x, p.y + p.h + 3.5);
      ctx.stroke();
      ctx.fillText(String(t), x, p.y + p.h + 5);
    }
    ctx.fillText("粒子半径 r [nm](対数)", p.x + p.w / 2, p.y + p.h + 18);

    /* 硬さの右目盛り(トグル) */
    if (showHv) {
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (const v of linTicks(0, TAU_MAX, 4)) {
        if (v === 0) continue;
        const y = mapY(v);
        ctx.beginPath();
        ctx.moveTo(p.x + p.w, y + 0.5);
        ctx.lineTo(p.x + p.w + 3, y + 0.5);
        ctx.strokeStyle = c.hairline;
        ctx.stroke();
        ctx.fillStyle = c.text2;
        ctx.fillText(String(Math.round(hardnessHV(v))), p.x + p.w + 5, y);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("硬さ [HV]", p.x + p.w + 34, p.y - 4);
    }

    /* 2 本の曲線(細線)*/
    const drawCurve = (
      fn: (r: number) => number,
      color: string,
      width: number,
      lower: boolean,
    ): void => {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= SAMPLES; i++) {
        const r = Math.exp(lnMin + ((lnMax - lnMin) * i) / SAMPLES);
        const v = fn(r);
        if (lower && v > strengtheningMPa(r, f) + 1e-9) {
          started = false;
          continue;
        }
        if (v > TAU_MAX) {
          started = false;
          continue;
        }
        const x = mapX(r);
        const y = mapY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    ctx.globalAlpha = 0.5;
    drawCurve((r) => shearingMPa(r, f), c.precip, 1.5, false);
    drawCurve((r) => bowingMPa(r, f), c.defect, 1.5, false);
    ctx.globalAlpha = 1;
    // 実際に効く側(下側の包絡線)を太線で
    drawCurve((r) => shearingMPa(r, f), c.precip, 3, true);
    drawCurve((r) => bowingMPa(r, f), c.defect, 3, true);

    /* 交点(= ピーク時効)*/
    const xCross = mapX(R_CROSS_NM);
    const yCross = mapY(shearingMPa(R_CROSS_NM, f));
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(xCross + 0.5, p.y);
    ctx.lineTo(xCross + 0.5, p.y + p.h);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(xCross, yCross, 4, 0, TAU2);
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.font = font(narrow ? 10.5 : 12, 600);
    ctx.fillStyle = c.accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("ピーク時効", xCross, p.y - 3);

    /* 領域ラベル(実際に効く側の曲線に沿えて置く) */
    ctx.font = font(narrow ? 10.5 : 12, 600);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "center";
    const rLeft = Math.exp(lnMin + (Math.log(R_CROSS_NM) - lnMin) * 0.45);
    const rRight = Math.exp(
      Math.log(R_CROSS_NM) + (lnMax - Math.log(R_CROSS_NM)) * 0.4,
    );
    ctx.fillStyle = c.precipEdge;
    ctx.fillText("切って通る", mapX(rLeft), mapY(shearingMPa(rLeft, f)) - 10);
    ctx.fillStyle = c.defect;
    ctx.fillText("迂回する", mapX(rRight), mapY(bowingMPa(rRight, f)) - 10);

    /* 現在半径のマーカー */
    const xNow = mapX(rNm);
    const yNow = mapY(dtau);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = c.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xNow + 0.5, p.y + p.h);
    ctx.lineTo(xNow + 0.5, yNow);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(xNow, yNow, 5, 0, TAU2);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = isCut ? c.precip : c.defect;
    ctx.stroke();
  }

  host.onRender(draw);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
