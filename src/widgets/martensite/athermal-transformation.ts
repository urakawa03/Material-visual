/**
 * athermal-transformation.ts — 図4「温度で進み、時間で進まない」
 * (記事仕様書 10 §5.4)
 *
 * 左(マルテンサイト): 横軸 到達温度、縦軸 マルテンサイト量。コイスティネン=
 * マールブルガーの曲線 f = 1 − exp[−0.011 (M_s − T)](式 E5)と現在の点。
 * M_s・M_f・室温の縦線と、室温で残るオーステナイトの量。下に保持時間の
 * 小さな目盛り。
 * 右(比較: 拡散変態): 同じ温度に保ったときのアブラミ式 f(t)(式 E6。t₀ は
 * 図1 の C 曲線から)。保持時間とともに増える。
 *
 * **保持時間を動かしても左の点が動かないのはバグではなく物理である**
 * (非熱的変態)。マルテンサイト量の関数 martensiteFraction は引数に時間を
 * 持たない(lib/kinetics.ts)。動くのは右の拡散変態だけ。
 *
 * 横軸(到達温度)は 0〜500 ℃ に固定し、炭素量を変えると曲線全体が低温側へ
 * ずれる様子を見せる(到達温度のスライダーの範囲は 0〜M_s + 50 ℃ — §5.4)。
 *
 * 実装方式: 2D / requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { formatDuration } from "../../core/units";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { T_ROOM_C, toK } from "./lib/constants";
import {
  diffusionalFraction,
  martensiteFraction,
  mfCelsius,
  msCelsius,
  pearliteStartTime,
} from "./lib/kinetics";
import {
  type Pane,
  type Scale,
  context2d,
  drawAxes,
  fmtCelsius,
  fmtPercent,
  font,
  makeScale,
  mapScale,
  plateText,
  resolvePalette,
  subLabel,
  timeTickLabel,
} from "./lib/draw";

/** 左の横軸(到達温度)の範囲 [℃] */
const T_AXIS_MIN = 0;
const T_AXIS_MAX = 500;
/** 保持時間の範囲 [s](§5.4: 1〜10⁵) */
const HOLD_MIN_S = 1;
const HOLD_MAX_S = 1e5;
/** 炭素量の範囲 [wt%](§5.4) */
const C_MIN = 0.2;
const C_MAX = 1.2;
const C_STEP = 0.05;
/** 到達温度のスライダーは M_s + この値まで(§5.4) */
const T_ABOVE_MS = 50;
/** 初期状態(§5.4: 0.8 C・100 ℃・1 秒) */
const C_INIT = 0.8;
const T_INIT = 100;
const HOLD_INIT = 1;
/** 曲線のサンプル数 */
const SAMPLES = 200;

const TAU2 = Math.PI * 2;

export default function athermalTransformation(host: FigureHost): WidgetHandle {
  const ctx = context2d(host.canvas);
  const pal = resolvePalette();

  /* ---- 状態 ---- */
  let carbon = C_INIT;
  let tempC = T_INIT;
  let holdS = HOLD_INIT;

  /* ---- 読み取り値(§5.4) ---- */
  const readout = createReadout(host);
  const rMs = readout.item("Ms");
  const rMf = readout.item("Mf");
  const rFm = readout.item("マルテンサイト量");
  const rRa = readout.item("残留オーステナイト(室温)");
  const rDiff = readout.item("拡散変態の量(右)");

  function updateReadouts(): void {
    const ms = msCelsius(carbon);
    rMs.set(fmtCelsius(ms));
    rMf.set(fmtCelsius(mfCelsius(ms)));
    rFm.set(fmtPercent(martensiteFraction(tempC, ms)));
    rRa.set(fmtPercent(1 - martensiteFraction(T_ROOM_C, ms)));
    rDiff.set(fmtPercent(diffusionalFraction(tempC, holdS)));
  }

  /* ---- 操作部品(§5.4) ---- */
  const tSlider = host.controls.slider({
    id: "temp",
    label: "到達温度",
    min: T_AXIS_MIN,
    max: T_AXIS_MAX,
    step: 1,
    value: T_INIT,
    unit: "℃",
  });
  const tInput = tSlider.el.querySelector<HTMLInputElement>(
    'input[type="range"]',
  );
  tSlider.onChange((v) => {
    tempC = v;
    updateReadouts();
    host.requestRender();
  });

  const holdSlider = host.controls.slider({
    id: "hold",
    label: "保持時間",
    min: HOLD_MIN_S,
    max: HOLD_MAX_S,
    value: HOLD_INIT,
    scale: "log",
    format: (v) => formatDuration(v),
  });
  holdSlider.onChange((v) => {
    // 保持時間はマルテンサイト量に効かない(右の拡散変態だけが変わる)
    holdS = v;
    updateReadouts();
    host.requestRender();
  });

  const cSlider = host.controls.slider({
    id: "carbon",
    label: "炭素量",
    min: C_MIN,
    max: C_MAX,
    step: C_STEP,
    value: C_INIT,
    unit: "wt%",
  });
  cSlider.onChange((v) => {
    carbon = v;
    syncTempRange();
    updateReadouts();
    host.requestRender();
  });

  /** 到達温度のスライダーの上限を M_s + 50 ℃ に合わせる(§5.4) */
  function syncTempRange(): void {
    const max = Math.min(
      T_AXIS_MAX,
      Math.round(msCelsius(carbon) + T_ABOVE_MS),
    );
    if (tInput) tInput.max = String(max);
    if (tempC > max) tSlider.set(max);
  }

  host.controls.reset(() => {
    cSlider.set(C_INIT);
    carbon = C_INIT;
    syncTempRange();
    tSlider.set(T_INIT);
    holdSlider.set(HOLD_INIT);
    tempC = T_INIT;
    holdS = HOLD_INIT;
    updateReadouts();
  });

  /* ---- レイアウト ---- */

  function layout(): { left: Pane; right: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const leftH = Math.round((h - 3 * pad) * 0.56);
      return {
        left: { x: pad, y: pad, w: w - 2 * pad, h: leftH },
        right: {
          x: pad,
          y: 2 * pad + leftH,
          w: w - 2 * pad,
          h: h - 3 * pad - leftH,
        },
        narrow,
      };
    }
    const lw = Math.round((w - 3 * pad) * 0.54);
    return {
      left: { x: pad, y: pad, w: lw, h: h - 2 * pad },
      right: { x: 2 * pad + lw, y: pad, w: w - 3 * pad - lw, h: h - 2 * pad },
      narrow,
    };
  }

  /* ---- 左: マルテンサイト ---- */

  function vline(x: number, top: number, bottom: number, dash: boolean): void {
    ctx.save();
    if (dash) ctx.setLineDash([5, 4]);
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
    ctx.stroke();
    ctx.restore();
  }

  function drawLeft(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const ms = msCelsius(carbon);
    const mf = mfCelsius(ms);
    const holdStrip = narrow ? 34 : 42;
    const left = p.x + (narrow ? 34 : 40);
    const right = p.x + p.w - 8;
    const top = p.y + fs + 22;
    const bottom = p.y + p.h - (narrow ? 32 : 36) - holdStrip;
    const xs: Scale = makeScale(T_AXIS_MIN, T_AXIS_MAX, left, right);
    const ys: Scale = makeScale(0, 1, bottom, top);
    const X = (v: number): number => mapScale(xs, v);
    const Y = (v: number): number => mapScale(ys, v);

    ctx.font = font(fs + 1, 600);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("マルテンサイト(非熱的)", p.x, p.y);

    drawAxes(ctx, pal, xs, ys, {
      xTicks: [0, 100, 200, 300, 400, 500],
      yTicks: [0, 0.25, 0.5, 0.75, 1],
      yFormat: (v) => `${Math.round(v * 100)}`,
      xTitle: "到達した温度 [℃](ここまで冷やして止める)",
      yTitle: "マルテンサイト量 [%]",
      fontPx: fs,
      gridY: true,
    });

    // 室温の線
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(X(T_ROOM_C)) + 0.5, top);
    ctx.lineTo(Math.round(X(T_ROOM_C)) + 0.5, bottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // M_s・M_f(破線)
    vline(X(ms), top, bottom, true);
    subLabel(ctx, "M", "s", "", X(ms) + 4, top + fs + 2, pal.text2, fs);
    if (mf >= T_AXIS_MIN) {
      vline(X(mf), top, bottom, true);
      subLabel(ctx, "M", "f", "", X(mf) + 4, top + fs + 2, pal.text2, fs);
    } else {
      subLabel(
        ctx,
        "← M",
        "f",
        ` = ${fmtCelsius(mf)}(軸の外)`,
        left + 4,
        top + fs + 2,
        pal.text2,
        fs - 1,
      );
    }

    // コイスティネン=マールブルガーの曲線(M_s より上は 0)
    ctx.beginPath();
    for (let i = 0; i <= SAMPLES; i++) {
      const t = T_AXIS_MIN + ((T_AXIS_MAX - T_AXIS_MIN) * i) / SAMPLES;
      const x = X(t);
      const y = Y(martensiteFraction(t, ms));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 室温で残るオーステナイト(100% との差)
    const fRoom = martensiteFraction(T_ROOM_C, ms);
    const xr = X(T_ROOM_C);
    ctx.strokeStyle = pal.matrixEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xr + 6, Y(fRoom));
    ctx.lineTo(xr + 10, Y(fRoom));
    ctx.lineTo(xr + 10, Y(1));
    ctx.lineTo(xr + 6, Y(1));
    ctx.stroke();
    plateText(
      ctx,
      pal,
      `室温で残るオーステナイト ${fmtPercent(1 - fRoom)}`,
      xr + 14,
      Y((1 + fRoom) / 2),
      pal.text,
      fs,
      "left",
    );
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("室温", xr + 3, bottom - 3);

    // 現在の点(到達温度)
    const fM = martensiteFraction(tempC, ms);
    const px = X(tempC);
    const py = Y(fM);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(px, py);
    ctx.moveTo(px, py);
    ctx.lineTo(px, bottom);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, TAU2);
    ctx.fillStyle = pal.accent;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.bg;
    ctx.stroke();
    plateText(
      ctx,
      pal,
      fmtPercent(fM),
      px + (px > (left + right) / 2 ? -10 : 10),
      py - 14,
      pal.accent,
      fs + 1,
      px > (left + right) / 2 ? "right" : "left",
    );

    // 保持時間の小さな目盛り(点は動かない)
    const sy = p.y + p.h - holdStrip + 14;
    const hs = makeScale(HOLD_MIN_S, HOLD_MAX_S, left, right, true);
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(sy) + 0.5);
    ctx.lineTo(right, Math.round(sy) + 0.5);
    for (const v of [1, 10, 100, 1e3, 1e4, 1e5]) {
      const x = Math.round(mapScale(hs, v)) + 0.5;
      ctx.moveTo(x, sy - 3);
      ctx.lineTo(x, sy + 3);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of [1, 10, 100, 1e3, 1e4, 1e5]) {
      ctx.fillText(timeTickLabel(v), mapScale(hs, v), sy + 5);
    }
    const hx = mapScale(hs, holdS);
    ctx.beginPath();
    ctx.moveTo(hx, sy - 2);
    ctx.lineTo(hx - 5, sy - 9);
    ctx.lineTo(hx + 5, sy - 9);
    ctx.closePath();
    ctx.fillStyle = pal.accent;
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = pal.text2;
    ctx.fillText(
      `保持時間 ${formatDuration(holdS)} — 何秒保っても左の点は動かない`,
      left,
      sy - 10,
    );
  }

  /* ---- 右: 比較の拡散変態 ---- */

  function drawRight(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const left = p.x + (narrow ? 34 : 40);
    const right = p.x + p.w - 8;
    const top = p.y + fs + 22;
    const bottom = p.y + p.h - (narrow ? 32 : 36);
    const xs = makeScale(HOLD_MIN_S, HOLD_MAX_S, left, right, true);
    const ys = makeScale(0, 1, bottom, top);
    const X = (v: number): number => mapScale(xs, v);
    const Y = (v: number): number => mapScale(ys, v);

    ctx.font = font(fs + 1, 600);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`比較: 拡散変態(${Math.round(tempC)} ℃ に保つ)`, p.x, p.y);

    drawAxes(ctx, pal, xs, ys, {
      xTicks: [1, 10, 100, 1e3, 1e4, 1e5],
      yTicks: [0, 0.25, 0.5, 0.75, 1],
      xFormat: timeTickLabel,
      yFormat: (v) => `${Math.round(v * 100)}`,
      xTitle: "保持時間 [秒](対数目盛り)",
      yTitle: "変態した量 [%]",
      fontPx: fs,
      gridY: true,
    });

    // アブラミの曲線
    ctx.beginPath();
    for (let i = 0; i <= SAMPLES; i++) {
      const t = 10 ** ((5 * i) / SAMPLES);
      const x = X(t);
      const y = Y(diffusionalFraction(tempC, t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 2;
    ctx.stroke();

    const f = diffusionalFraction(tempC, holdS);
    const px = X(holdS);
    const py = Y(f);
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, TAU2);
    ctx.fillStyle = pal.accent;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.bg;
    ctx.stroke();

    // 保持しても始まらないときは、始まるまでの時間を書く
    const ts = pearliteStartTime(toK(tempC));
    if (diffusionalFraction(tempC, HOLD_MAX_S) < 0.01) {
      const msg = Number.isFinite(ts)
        ? `この温度では 10⁵ 秒保っても始まらない(始まるまで約 ${formatDuration(ts)})`
        : "この温度では拡散変態は始まらない";
      plateText(ctx, pal, msg, left + 6, Y(0.55), pal.text2, fs, "left");
      if (Number.isFinite(ts)) {
        plateText(
          ctx,
          pal,
          "炭素がほとんど動けない温度だから",
          left + 6,
          Y(0.55) + fs + 9,
          pal.text2,
          fs,
          "left",
        );
      }
    } else {
      plateText(
        ctx,
        pal,
        fmtPercent(f),
        px + (px > (left + right) / 2 ? -10 : 10),
        py - 14,
        pal.accent,
        fs + 1,
        px > (left + right) / 2 ? "right" : "left",
      );
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawLeft(l.left, l.narrow);
    drawRight(l.right, l.narrow);
    // パネルの区切り
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (l.narrow) {
      const y = Math.round((l.left.y + l.left.h + l.right.y) / 2) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    } else {
      const x = Math.round((l.left.x + l.left.w + l.right.x) / 2) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
  }

  syncTempRange();
  updateReadouts();
  host.onRender(draw);

  return {
    destroy(): void {
      /* 追加のイベントリスナーは持たない */
    },
  };
}
