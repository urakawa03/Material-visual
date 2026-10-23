/**
 * wavelength-selection.ts — 図5「どの波長が育つか」(記事仕様書 09 §5.5)
 *
 * 左: 増幅率 R(k) = −k²(g''(c0) + κk²) と波数 k のグラフ(式 E6)。R > 0 の
 * 範囲を薄く塗り、最大の位置 k_m に縦線と λ_m = 2π/k_m(式 E7)。
 * 代表の 3 つの波数(長い・ちょうどよい・短い)に印。
 * 右: 3 つの波の振幅の時間変化 e^{R(k)t}(対数の縦軸)。凡例に各波の形。
 *
 * 実装方式: 2D Canvas / requestRender。
 * 簡略化(図注): カーン・ヒリアード方程式の線形安定性解析(M = 1)。
 * 弾性ひずみの効果は入れていない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  type Axes,
  axX,
  axY,
  drawAxisLines,
  drawXTicks,
  drawYTicks,
  fmtFixed,
  fmtSig,
  font,
  linTicks,
  outlinedText,
  resolvePalette,
} from "./lib/draw";
import { pow10Label } from "../../core/plot";
import {
  chiFromT,
  d2gdc2,
  fastestK,
  growthRate,
  maxGrowthRate,
  sliderToTOverTc,
} from "./lib/regular";

/** スライダー(§5.5) */
const T_INIT = 0.67;
const C_INIT = 0.5;
const KAPPA_INIT = 4;
/** 左のグラフの波数の範囲(既定条件の k_c = 0.71 が中央付近に来る) */
const K_MAX = 1.2;
/** 右のグラフの時間と振幅の範囲(固定 — 条件による速さの違いが比べられる) */
const T_AXIS_MAX = 40;
const LOG_A_MIN = -2;
const LOG_A_MAX = 4;
/** スピノーダルの外で印を付ける波数(既定条件の代表値) */
const FALLBACK_K = [0.225, 0.5, 0.8] as const;
/** 代表の 3 つの波(k_m に対する比) */
const WAVE_RATIOS = [0.45, 1, 1.6] as const;
const WAVE_NAMES = ["長い波", "ちょうどよい波", "短い波"] as const;
/** スピノーダルの外(どの波も育たない)では「ちょうどよい」と呼ばない */
const WAVE_NAMES_STABLE = ["長い波", "中くらいの波", "短い波"] as const;
/** 凡例の行の高さ */
const LEGEND_ROW = 17;
/** 右のグラフの下に取る凡例の高さ(軸の文字 + 3 行) */
const LEGEND_SPACE = 40 + 3 * LEGEND_ROW;
const WAVE_DASH: ReadonlyArray<readonly number[]> = [[9, 5], [], [2.5, 3.5]];

export default function wavelengthSelection(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  let tOverTc = sliderToTOverTc(T_INIT);
  let c0 = C_INIT;
  let kappa = KAPPA_INIT;

  const readout = createReadout(host);
  const roKm = readout.item("k_m");
  const roLambda = readout.item("λ_m");
  const roRmax = readout.item("R_max");
  const roVerdict = readout.item("判定");

  const tSlider = host.controls.slider({
    id: "t",
    label: "温度 T/Tc",
    min: 0.5,
    max: 1.1,
    step: 0.01,
    value: T_INIT,
  });
  tSlider.onChange((v) => {
    tOverTc = sliderToTOverTc(v);
  });
  const cSlider = host.controls.slider({
    id: "c0",
    label: "組成 c₀",
    min: 0.05,
    max: 0.95,
    step: 0.01,
    value: C_INIT,
  });
  cSlider.onChange((v) => {
    c0 = v;
  });
  const kSlider = host.controls.slider({
    id: "kappa",
    label: "界面の硬さ κ",
    min: 1,
    max: 16,
    step: 0.5,
    value: KAPPA_INIT,
  });
  kSlider.onChange((v) => {
    kappa = v;
  });
  host.controls.reset(() => {
    tSlider.set(T_INIT);
    cSlider.set(C_INIT);
    kSlider.set(KAPPA_INIT);
  });

  interface Layout {
    narrow: boolean;
    left: Axes;
    right: Axes;
  }

  function layout(rMax: number, rMinShown: number): Layout {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const yHi = rMax > 0 ? 1.3 * rMax : 0.05;
    // 短い波(1.6 k_m)の R = −1.43 R_max が枠内に入る下限
    const yLo = rMax > 0 ? -1.6 * rMax : rMinShown;
    if (narrow) {
      const topH = Math.round(h * 0.5);
      return {
        narrow,
        left: {
          x: 44,
          y: pad + 20,
          w: w - 44 - 10,
          h: topH - pad - 20 - 34,
          xMin: 0,
          xMax: K_MAX,
          yMin: yLo,
          yMax: yHi,
        },
        right: {
          x: 44,
          y: topH + 28,
          w: w - 44 - 10,
          h: h - topH - 28 - LEGEND_SPACE,
          xMin: 0,
          xMax: T_AXIS_MAX,
          yMin: LOG_A_MIN,
          yMax: LOG_A_MAX,
        },
      };
    }
    const leftW = Math.round(w * 0.55);
    return {
      narrow,
      left: {
        x: 52,
        y: pad + 22,
        w: leftW - 52 - 16,
        h: h - pad - 22 - 38,
        xMin: 0,
        xMax: K_MAX,
        yMin: yLo,
        yMax: yHi,
      },
      right: {
        x: leftW + 44,
        y: pad + 22,
        w: w - leftW - 44 - 14,
        h: h - pad - 22 - LEGEND_SPACE,
        xMin: 0,
        xMax: T_AXIS_MAX,
        yMin: LOG_A_MIN,
        yMax: LOG_A_MAX,
      },
    };
  }

  function waveKs(chi: number): number[] {
    const km = fastestK(c0, chi, kappa);
    if (!Number.isFinite(km)) return [...FALLBACK_K];
    return WAVE_RATIOS.map((r) => r * km);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const chi = chiFromT(tOverTc);
    const rMax = maxGrowthRate(c0, chi, kappa);
    const km = fastestK(c0, chi, kappa);
    const unstable = Number.isFinite(km);
    // スピノーダルの外: 3 つの印(いちばん短い波まで)の減衰が見える縦軸にする
    const rMinShown = Math.min(
      -0.05,
      1.12 * growthRate(FALLBACK_K[2], c0, chi, kappa),
    );
    const L = layout(rMax, rMinShown);
    const ks = waveKs(chi);
    drawRate(L, chi, km, ks, unstable);
    drawGrowth(L, chi, ks, unstable);

    if (unstable) {
      roKm.set(fmtFixed(km, 3));
      roLambda.set(`${fmtSig((2 * Math.PI) / km)} 格子`);
      roRmax.set(fmtSig(rMax, 3));
      roVerdict.set("λ_m の波が最も速く育つ");
    } else {
      roKm.set("—");
      roLambda.set("—");
      roRmax.set("0");
      roVerdict.set(
        `どの波も育たない(g'' = ${fmtSig(d2gdc2(c0, chi), 2)} > 0)`,
      );
    }
  }

  function drawRate(
    L: Layout,
    chi: number,
    km: number,
    ks: number[],
    unstable: boolean,
  ): void {
    const { left: a, narrow } = L;
    drawAxisLines(ctx, a, pal);
    drawXTicks(ctx, a, pal, linTicks(0, K_MAX, narrow ? 3 : 6), (v) =>
      fmtFixed(v, 1),
    );
    drawYTicks(ctx, a, pal, linTicks(a.yMin, a.yMax, 4), (v) => fmtSig(v, 2));
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("増幅率 R(k)", a.x - (narrow ? 36 : 44), a.y - 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("波数 k(右ほど短い波)", a.x + a.w / 2, a.y + a.h + 19);

    // R = 0 の線
    const y0 = axY(a, 0);
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, y0 + 0.5);
    ctx.lineTo(a.x + a.w, y0 + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    const n = 240;
    // R > 0 の範囲を薄く塗る
    if (unstable) {
      ctx.beginPath();
      ctx.moveTo(axX(a, 0), y0);
      for (let i = 0; i <= n; i++) {
        const k = (K_MAX * i) / n;
        ctx.lineTo(
          axX(a, k),
          axY(a, Math.max(0, growthRate(k, c0, chi, kappa))),
        );
      }
      ctx.lineTo(axX(a, K_MAX), y0);
      ctx.closePath();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = pal.second;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 曲線
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const k = (K_MAX * i) / n;
      const px = axX(a, k);
      const py = axY(a, growthRate(k, c0, chi, kappa));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineWidth = 2.25;
    ctx.strokeStyle = pal.text2;
    ctx.stroke();
    ctx.restore();

    // k_m の縦線と λ_m
    if (unstable && km <= K_MAX) {
      const px = axX(a, km);
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(px, a.y);
      ctx.lineTo(px, a.y + a.h);
      ctx.stroke();
      ctx.restore();
      ctx.font = font(narrow ? 11 : 12.5, 600);
      ctx.textAlign = px > a.x + a.w * 0.6 ? "right" : "left";
      ctx.textBaseline = "top";
      outlinedText(
        ctx,
        `λm = 2π/km = ${fmtSig((2 * Math.PI) / km)}`,
        px + (px > a.x + a.w * 0.6 ? -7 : 7),
        a.y + 4,
        pal.accent,
        pal.bg,
      );
    }

    // 代表の 3 つの波数の印
    for (let i = 0; i < 3; i++) {
      const k = ks[i];
      if (k > K_MAX) continue;
      const r = growthRate(k, c0, chi, kappa);
      const py = Math.min(Math.max(axY(a, r), a.y), a.y + a.h);
      ctx.beginPath();
      ctx.arc(axX(a, k), py, i === 1 ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = i === 1 ? pal.second : pal.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.second;
      ctx.stroke();
    }

    if (!unstable) {
      ctx.font = font(narrow ? 11 : 12);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      outlinedText(
        ctx,
        "R(k) ≤ 0 — どの波も育たない(スピノーダルの外)",
        a.x + a.w / 2,
        y0 - 8,
        pal.text,
        pal.bg,
      );
    }
  }

  function drawGrowth(
    L: Layout,
    chi: number,
    ks: number[],
    unstable: boolean,
  ): void {
    const { right: a, narrow } = L;
    drawAxisLines(ctx, a, pal);
    drawXTicks(ctx, a, pal, linTicks(0, T_AXIS_MAX, 4), (v) => fmtFixed(v, 0));
    const yTicks: number[] = [];
    for (let e = LOG_A_MIN; e <= LOG_A_MAX; e += narrow ? 2 : 1) yTicks.push(e);
    drawYTicks(ctx, a, pal, yTicks, (e) => pow10Label(e));
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("波の振幅(初期 = 1)", a.x - (narrow ? 36 : 36), a.y - 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("時間 t", a.x + a.w / 2, a.y + a.h + 19);
    // 振幅 1 の線
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, axY(a, 0) + 0.5);
    ctx.lineTo(a.x + a.w, axY(a, 0) + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    for (let i = 0; i < 3; i++) {
      const r = growthRate(ks[i], c0, chi, kappa);
      // log10(e^{rt}) = r t / ln 10 は直線
      ctx.beginPath();
      ctx.moveTo(axX(a, 0), axY(a, 0));
      ctx.lineTo(axX(a, T_AXIS_MAX), axY(a, (r * T_AXIS_MAX) / Math.LN10));
      ctx.lineWidth = i === 1 ? 2.75 : 2;
      ctx.strokeStyle = pal.second;
      ctx.setLineDash(WAVE_DASH[i] as number[]);
      ctx.stroke();
    }
    ctx.restore();

    // 凡例(3 行): 線種の見本・名前と波長・波の形(波長を画面上でも比例させる)
    const legendTop = a.y + a.h + 40;
    const names = unstable ? WAVE_NAMES : WAVE_NAMES_STABLE;
    ctx.font = font(narrow ? 10.5 : 11);
    let labelW = 0;
    const labels = ks.map((k, i) => {
      const text = `${names[i]} λ = ${fmtSig((2 * Math.PI) / k, 2)}`;
      labelW = Math.max(labelW, ctx.measureText(text).width);
      return text;
    });
    const glyphX = a.x - 30 + 24 + labelW + 10;
    const glyphW = Math.max(30, a.x + a.w - glyphX);
    const pxPerLattice = Math.min(2.4, glyphW / 30);
    for (let i = 0; i < 3; i++) {
      const y = legendTop + i * LEGEND_ROW;
      const x0 = a.x - 30;
      ctx.save();
      ctx.strokeStyle = pal.second;
      ctx.lineWidth = i === 1 ? 2.75 : 2;
      ctx.setLineDash(WAVE_DASH[i] as number[]);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 18, y);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(labels[i], x0 + 24, y);
      const lambda = (2 * Math.PI) / ks[i];
      ctx.beginPath();
      for (let s = 0; s <= 80; s++) {
        const u = (glyphW * s) / 80;
        const yv = Math.sin((2 * Math.PI * u) / (lambda * pxPerLattice));
        if (s === 0) ctx.moveTo(glyphX + u, y - yv * 4.5);
        else ctx.lineTo(glyphX + u, y - yv * 4.5);
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = pal.text2;
      ctx.stroke();
    }
  }

  host.onRender(draw);

  return {
    resize(): void {
      host.requestRender();
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
