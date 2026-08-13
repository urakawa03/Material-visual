/**
 * aging-curve.ts — 図1「時効硬化曲線」(記事仕様書 07 §5.1。S1 で提示・S6 で回収)
 *
 * 横軸 = 時効時間(対数、1 秒〜10⁹ 秒)、縦軸 = 硬さ [HV 相当]。
 * 時計を進めると、いま選んでいる温度の曲線が左から描かれていく。温度を
 * 変えると新しい曲線の記録が始まり、前の曲線は淡色で残る(S6 で読者自身に
 * 何本か描かせ、「高温ほど早いがピークは低い」を発見させるため)。
 *
 * モデルは lib/aging.ts(§5.0)。曲線は解析式なので、時計は「どこまで
 * 描いたか」だけを決める。
 *
 * 簡略化(図注): 現象論モデルで硬さは校正済みのモデル値。時間表示は実時間
 * 換算だが、画面上では強く加速している。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import { KELVIN, formatDuration } from "./lib/constants";
import { agingStateAt, findPeak } from "./lib/aging";
import {
  type Pane,
  drawReadouts,
  fmtSig,
  font,
  linTicks,
  resolvePalette,
} from "./lib/draw";

/** 時間軸 [s] */
const LOG_T_MIN = 0;
const LOG_T_MAX = 9;
/** 硬さ軸 [HV 相当] */
const HV_MIN = 40;
const HV_MAX = 150;
/** 曲線のサンプル数(全域) */
const SAMPLES = 220;
/** 温度スライダー */
const TEMP_MIN = 20;
const TEMP_MAX = 250;
const TEMP_STEP = 5;
const TEMP_INIT = 130;
/** 早送りの速さ [decade/s] */
const SPEEDS = { slow: 0.2, normal: 0.5, fast: 1.2 } as const;
type SpeedKey = keyof typeof SPEEDS;
const SPEED_INIT: SpeedKey = "normal";
/** 目盛りに名前を添える時間 [s] */
const NAMED_TIMES: ReadonlyArray<[number, string]> = [
  [60, "1 分"],
  [3600, "1 時間"],
  [86400, "1 日"],
  [30 * 86400, "1 か月"],
  [365.25 * 86400, "1 年"],
];

const TAU2 = Math.PI * 2;

/** 1 本の測定曲線 */
interface Trace {
  tempC: number;
  /** どこまで描いたか(log10 の時間) */
  logT: number;
}

export default function agingCurve(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const c = resolvePalette();

  let current: Trace = { tempC: TEMP_INIT, logT: LOG_T_MIN };
  let past: Trace[] = [];
  let speed: SpeedKey = SPEED_INIT;

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "T",
    label: "時効温度",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    if (v === current.tempC) return;
    // いまの曲線を確定してから新しい温度の記録を始める
    if (keepToggle.value && current.logT > LOG_T_MIN + 0.05) {
      past = past.filter((t) => t.tempC !== current.tempC);
      past.push(current);
      if (past.length > 4) past.shift();
    }
    current = { tempC: v, logT: LOG_T_MIN };
    host.setPlaying(true);
  });

  host.controls
    .segmented<SpeedKey>({
      id: "speed",
      label: "時計の速さ",
      options: [
        { value: "slow", label: "遅い" },
        { value: "normal", label: "ふつう" },
        { value: "fast", label: "速い" },
      ],
      value: SPEED_INIT,
    })
    .onChange((v) => {
      speed = v;
    });

  const keepToggle = host.controls.toggle({
    id: "keep",
    label: "前の曲線を残す",
    value: true,
  });
  keepToggle.onChange((on) => {
    if (!on) past = [];
    host.requestRender();
  });

  host.controls.playPause();
  host.controls.reset(() => {
    past = [];
    tempSlider.set(TEMP_INIT);
    current = { tempC: TEMP_INIT, logT: LOG_T_MIN };
    host.setPlaying(true);
  });

  /* ---- レイアウト ---- */

  function layout(): { plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 36 : 22;
    const left = narrow ? 32 : 40;
    const bottom = narrow ? 32 : 38;
    return {
      plot: {
        x: pad + left,
        y: pad + strip + 12,
        w: w - pad * 2 - left,
        h: h - pad * 2 - strip - 12 - bottom,
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

    const mapX = (logT: number): number =>
      p.x + (p.w * (logT - LOG_T_MIN)) / (LOG_T_MAX - LOG_T_MIN);
    const mapY = (hv: number): number =>
      p.y +
      p.h -
      (p.h * (clamp(hv, HV_MIN, HV_MAX) - HV_MIN)) / (HV_MAX - HV_MIN);

    const tNow = 10 ** current.logT;
    const s = agingStateAt(tNow, current.tempC + KELVIN);

    /* 読み出し */
    drawReadouts(
      ctx,
      [
        [`硬さ ${Math.round(s.hv)} HV`, c.text],
        [`r ${fmtSig(s.r)} nm`, c.text],
        [`f ${(s.f * 100).toFixed(1)} %`, c.text],
        [s.mech === "cut" ? "転位は切って通る" : "転位は迂回する", c.text2],
        [`経過 ${formatDuration(tNow)}`, c.text2],
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
    for (const v of linTicks(HV_MIN, HV_MAX, 4)) {
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(p.x - 3, y + 0.5);
      ctx.lineTo(p.x + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), p.x - 5, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("硬さ [HV 相当]", p.x + 2, p.y - 4);

    // 時間目盛り: 10 の冪の細線 + 名前つきの時刻ラベル
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let e = LOG_T_MIN; e <= LOG_T_MAX; e++) {
      const x = mapX(e);
      ctx.beginPath();
      ctx.moveTo(x, p.y + p.h + 0.5);
      ctx.lineTo(x, p.y + p.h + 3.5);
      ctx.stroke();
    }
    for (const [t, label] of NAMED_TIMES) {
      const x = mapX(Math.log10(t));
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = c.hairline;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, p.y);
      ctx.lineTo(x + 0.5, p.y + p.h);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = c.text2;
      ctx.fillText(label, x, p.y + p.h + 5);
    }
    ctx.fillText(
      narrow ? "時効時間(対数)" : "時効時間(対数目盛)",
      p.x + p.w / 2,
      p.y + p.h + (narrow ? 18 : 20),
    );

    /* 1 本の曲線を描く */
    const strokeTrace = (tr: Trace, color: string, width: number): void => {
      const tK = tr.tempC + KELVIN;
      ctx.beginPath();
      const n = Math.max(
        4,
        Math.round((SAMPLES * (tr.logT - LOG_T_MIN)) / (LOG_T_MAX - LOG_T_MIN)),
      );
      for (let i = 0; i <= n; i++) {
        const logT = LOG_T_MIN + ((tr.logT - LOG_T_MIN) * i) / n;
        const hv = agingStateAt(10 ** logT, tK).hv;
        const x = mapX(logT);
        const y = mapY(hv);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    /* いまの温度の完成形を薄く先出し(S1「この曲線の正体を突き止める」) */
    ctx.save();
    ctx.globalAlpha = 0.16;
    strokeTrace({ tempC: current.tempC, logT: LOG_T_MAX }, c.text, 2);
    ctx.restore();

    /* 過去の曲線(淡色 + 温度ラベル) */
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (const tr of past) {
      strokeTrace(tr, c.text2, 1.5);
      const peak = findPeak(
        tr.tempC + KELVIN,
        10 ** LOG_T_MIN,
        10 ** LOG_T_MAX,
      );
      const labelLogT = Math.min(Math.log10(peak.t), tr.logT);
      ctx.font = font(narrow ? 10 : 11);
      ctx.fillStyle = c.text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        `${tr.tempC} °C`,
        mapX(labelLogT),
        mapY(agingStateAt(10 ** labelLogT, tr.tempC + KELVIN).hv) - 7,
      );
    }
    ctx.restore();

    /* いま描いている曲線 */
    strokeTrace(current, c.text, 2.25);

    /* ピークに達していればマーカーと注記 */
    const peak = findPeak(
      current.tempC + KELVIN,
      10 ** LOG_T_MIN,
      10 ** LOG_T_MAX,
    );
    const logPeak = Math.log10(peak.t);
    if (current.logT >= logPeak) {
      const x = mapX(logPeak);
      const y = mapY(peak.hv);
      ctx.beginPath();
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x - 5, y - 17);
      ctx.lineTo(x + 5, y - 17);
      ctx.closePath();
      ctx.fillStyle = c.accent;
      ctx.fill();
      ctx.font = font(narrow ? 10 : 11.5, 600);
      ctx.fillStyle = c.accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        `ピーク ${Math.round(peak.hv)} HV / ${formatDuration(peak.t)}`,
        clamp(x, p.x + 60, p.x + p.w - 60),
        y - 19,
      );
    }

    /* 現在点 */
    const xNow = mapX(current.logT);
    const yNow = mapY(s.hv);
    ctx.beginPath();
    ctx.arc(xNow, yNow, 4.5, 0, TAU2);
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.font = font(narrow ? 10 : 11.5, 600);
    ctx.fillStyle = c.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (xNow < p.x + p.w - 60) {
      ctx.fillText(`${current.tempC} °C`, xNow + 8, yNow);
    }
  }

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    if (current.logT < LOG_T_MAX) {
      current.logT = Math.min(LOG_T_MAX, current.logT + SPEEDS[speed] * dt);
      if (current.logT >= LOG_T_MAX) host.setPlaying(false);
    }
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
