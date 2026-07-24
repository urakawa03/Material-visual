/**
 * coarsening-timelapse.ts — 図1「組織の微速度撮影」(記事仕様書 03 §5.1)
 *
 * 左: 粒子場(視野 240×150 nm、粒子 60 個、シード固定)。
 * 右上: 読み出しカード3枚 — 粒子の数 N / 平均半径 r̄ / 体積分率 f(一定)。
 * 右下: 強さ(モデル強度 MPa)vs log t の小プロット+現在点マーカー。
 * 経過時間は選択温度での実時間へ換算して表示する(§5.0)。
 *
 * 簡略化(図注で明示):
 * - 平均場モデル。粒子の配置は装飾であり、計算には位置は入らない。
 * - 温度はシミュレーションの形を変えず、実時間換算(時計の速さ)のみ変える。
 * - 強さはオロワン機構の簡略式 Δτ = μb/L による「モデル強度」。
 * - 数値は Al–Cu 系を想定した典型値による現象論モデルで、実測ではない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import {
  F_VOLUME,
  KELVIN,
  formatDuration,
  timeDilation,
} from "./lib/constants";
import { RipeningEnsemble, SeriesBuffer } from "./lib/ripening";
import { MicrostructureView, type Viewport } from "./lib/microstructure";
import { displayStrengthMPa } from "./lib/strength";
import { font, linTicks, logTicks } from "./lib/draw";

/** 乱数シード(reset で完全に同じ初期組織を再現 — 母体仕様 §8.2) */
const SEED = 12;
/** 粒子数 N₀(§5.1) */
const N0 = 60;
/** 粒子場の視野 [nm](§5.1) */
const FIELD_W_NM = 240;
const FIELD_H_NM = 150;
/** 時間の進み ×1 のときのエンジン時間の速さ [τ 秒 / 実秒] */
const BASE_RATE = 20;
/** 温度スライダーの初期値 [°C] */
const TEMP_INIT = 200;
/** 時間の進み segmented の初期値 */
const SPEED_INIT = "10";
/** プロットの時間軸の下限 [τ 秒](対数軸) */
const TAU_MIN = 30;
/** 強さ軸の上限 [MPa](初期強度 ≈ 400 MPa が収まる固定レンジ) */
const STRENGTH_MAX_MPA = 450;
/** 記録バッファ容量と初期間隔 [τ 秒] */
const SERIES_CAP = 720;
const SERIES_INTERVAL = 10;
/** これ未満の幅では読み出しを簡略化する [CSS px] */
const NARROW_W = 560;

const TAU = Math.PI * 2;

export default function coarseningTimelapse(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色(初期化時に一度だけ解決 — colors.ts の注意書き)
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill, 0.2);
  // 強さ = 転位(オロワン機構)の通り抜け抵抗なので転位色で描く(§5.0)
  const strengthLine = matColor("defect");
  const strengthEdge = darken(strengthLine, 0.2);
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");

  const ens = new RipeningEnsemble({ count: N0, seed: SEED });
  const micro = new MicrostructureView(ens, FIELD_W_NM, FIELD_H_NM, SEED + 1);
  /** (τ, 表示強度 [MPa]) の履歴 */
  const series = new SeriesBuffer(SERIES_CAP, SERIES_INTERVAL);

  let tempC = TEMP_INIT;
  let speedMult = Number(SPEED_INIT);

  function currentStrength(): number {
    return displayStrengthMPa(ens.meanR());
  }

  function resetAll(): void {
    ens.reset();
    micro.resetFades();
    series.clear();
    series.push(0, currentStrength());
  }

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "T",
    label: "温度",
    min: 150,
    max: 300,
    step: 5,
    value: TEMP_INIT,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    tempC = v; // 表示の実時間換算のみに影響(§5.0)
  });

  const speedSeg = host.controls.segmented({
    id: "speed",
    label: "時間の進み",
    options: [
      { value: "1", label: "×1" },
      { value: "10", label: "×10" },
      { value: "100", label: "×100" },
    ],
    value: SPEED_INIT,
  });
  speedSeg.onChange((v) => {
    speedMult = Number(v);
  });

  host.controls.playPause();
  host.controls.reset(() => {
    tempSlider.set(TEMP_INIT);
    speedSeg.set(SPEED_INIT);
    resetAll();
  });

  /* ---- レイアウト(毎フレーム host.size から計算。オブジェクトは再利用) ---- */

  interface Pane {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const L = {
    narrow: false,
    /** 簡略読み出し行(narrow 時のみ)の y */
    stripY: 0,
    field: { x: 0, y: 0, w: 0, h: 0 } as Pane,
    /** 読み出しカード行(narrow 時は使わない) */
    cards: { x: 0, y: 0, w: 0, h: 0 } as Pane,
    /** 経過表示の位置(narrow 時は strip 内に描く) */
    elapsedX: 0,
    elapsedY: 0,
    plot: { x: 0, y: 0, w: 0, h: 0 } as Pane,
  };

  function layout(): void {
    const { w, h } = host.size;
    L.narrow = w < NARROW_W;
    if (L.narrow) {
      // 狭い画面: 上に簡略読み出し(2 行)、下は粒子場 | プロットの横並び
      const pad = 8;
      const strip = 34;
      const top = pad + strip;
      const fieldW = w * 0.52 - pad * 1.5;
      L.stripY = pad;
      L.field.x = pad;
      L.field.y = top;
      L.field.w = fieldW;
      L.field.h = h - top - pad;
      L.plot.x = pad * 2 + fieldW;
      L.plot.y = top;
      L.plot.w = w - pad * 3 - fieldW;
      L.plot.h = h - top - pad;
      return;
    }
    // 広い画面: 左 55% に粒子場、右上にカード3枚+経過、右下にプロット
    const pad = 12;
    const cardsH = 48;
    const rightX = w * 0.55 + pad * 0.5;
    const rightW = w - rightX - pad;
    L.field.x = pad;
    L.field.y = pad;
    L.field.w = w * 0.55 - pad * 1.5;
    L.field.h = h - pad * 2;
    L.cards.x = rightX;
    L.cards.y = pad;
    L.cards.w = rightW;
    L.cards.h = cardsH;
    L.elapsedX = rightX;
    L.elapsedY = pad + cardsH + 8;
    L.plot.x = rightX;
    L.plot.y = L.elapsedY + 22;
    L.plot.w = rightW;
    L.plot.h = h - L.plot.y - pad;
  }

  /* ---- 描画 ---- */

  /** 粒子場の実描画領域(視野のアスペクトに合わせてペイン内へ収める) */
  const fieldVp: Viewport = { x: 0, y: 0, w: 0, h: 0 };
  const fieldStyle = { fill: soluteFill, edge: soluteEdge };

  function drawFieldPane(p: Pane): void {
    const s = Math.min(p.w / FIELD_W_NM, p.h / FIELD_H_NM);
    fieldVp.w = FIELD_W_NM * s;
    fieldVp.h = FIELD_H_NM * s;
    fieldVp.x = p.x + (p.w - fieldVp.w) / 2;
    fieldVp.y = p.y + (p.h - fieldVp.h) / 2;

    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      fieldVp.x + 0.5,
      fieldVp.y + 0.5,
      fieldVp.w - 1,
      fieldVp.h - 1,
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(fieldVp.x, fieldVp.y, fieldVp.w, fieldVp.h);
    ctx.clip();
    micro.draw(ctx, fieldVp, fieldStyle);
    ctx.restore();

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      "粒子場(配置は模式)",
      fieldVp.x + 6,
      fieldVp.y + fieldVp.h - 5,
    );
  }

  function drawCard(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
  ): void {
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.fillText(label, x + 8, y + 7);
    ctx.font = font(15, 600);
    ctx.fillStyle = text;
    ctx.fillText(value, x + 8, y + 24);
  }

  function drawCards(p: Pane): void {
    const gap = 8;
    const cw = (p.w - gap * 2) / 3;
    const long = cw >= 108; // 幅が足りないときはラベルを短縮する
    const fPct = F_VOLUME * ens.volumeRatio() * 100;
    drawCard(
      p.x,
      p.y,
      cw,
      p.h,
      long ? "粒子の数 N" : "N",
      String(ens.aliveCount),
    );
    drawCard(
      p.x + cw + gap,
      p.y,
      cw,
      p.h,
      long ? "平均半径 r̄" : "r̄",
      `${ens.meanR().toFixed(1)} nm`,
    );
    drawCard(
      p.x + (cw + gap) * 2,
      p.y,
      cw,
      p.h,
      long ? "体積分率 f(一定)" : "f(一定)",
      `${fPct.toFixed(1)} %`,
    );
  }

  function elapsedText(): string {
    const real = ens.tau * timeDilation(tempC + KELVIN);
    return `経過 ${formatDuration(real)}(${tempC} °C 換算)`;
  }

  /* narrow 用の簡略読み出し: 折り返しつきのテキストフロー(割当てなし) */
  let flowX = 0;
  let flowX0 = 0;
  let flowY = 0;
  let flowLine = 0;
  let flowMaxX = 0;
  let flowLineH = 0;

  function flowBegin(x: number, y: number, maxX: number, lineH: number): void {
    flowX = x;
    flowX0 = x;
    flowY = y;
    flowLine = 0;
    flowMaxX = maxX;
    flowLineH = lineH;
  }

  function flowText(s: string, color: string): void {
    const tw = ctx.measureText(s).width;
    if (flowLine === 0 && flowX + tw > flowMaxX) {
      flowLine = 1;
      flowX = flowX0;
    }
    ctx.fillStyle = color;
    ctx.fillText(s, flowX, flowY + flowLine * flowLineH);
    flowX += tw + 12;
  }

  function drawReadoutStrip(y: number, strength: number): void {
    const { w } = host.size;
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    flowBegin(8, y, w - 8, 15);
    const fPct = F_VOLUME * ens.volumeRatio() * 100;
    flowText(`N ${ens.aliveCount}`, text);
    flowText(`r̄ ${ens.meanR().toFixed(1)} nm`, text);
    flowText(`f ${fPct.toFixed(1)} %(一定)`, text);
    flowText(`強さ ${Math.round(strength)} MPa`, text);
    flowText(elapsedText(), text2);
  }

  function drawPlotPane(p: Pane, strength: number): void {
    const axisX = p.x + 34;
    const axisY = p.y + p.h - 20;
    const y0 = p.y + 16;
    const tauMax = Math.max(ens.tau * 1.05, TAU_MIN * 20);
    const lnMin = Math.log(TAU_MIN);
    const lnMax = Math.log(tauMax);
    const xRight = p.x + p.w - 8;
    const mapX = (t: number): number =>
      axisX + ((xRight - axisX) * (Math.log(t) - lnMin)) / (lnMax - lnMin);
    const mapY = (v: number): number =>
      axisY - ((axisY - y0) * Math.min(v, STRENGTH_MAX_MPA)) / STRENGTH_MAX_MPA;

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("強さ(モデル強度)", axisX + 4, p.y);

    // 軸
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, y0);
    ctx.lineTo(axisX + 0.5, axisY + 0.5);
    ctx.lineTo(xRight, axisY + 0.5);
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const v of linTicks(0, STRENGTH_MAX_MPA, L.narrow ? 3 : 4)) {
      if (v === 0) continue;
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), axisX - 5, y);
    }
    ctx.textAlign = "left";
    ctx.fillText("MPa", p.x + 2, y0 - 8);

    // 時間目盛り(τ の 10 の冪。ラベルは選択温度での実時間 — §5.1)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const dil = timeDilation(tempC + KELVIN);
    for (const tick of logTicks(TAU_MIN, tauMax)) {
      const x = mapX(tick);
      ctx.beginPath();
      ctx.moveTo(x, axisY + 0.5);
      ctx.lineTo(x, axisY + 3.5);
      ctx.stroke();
      ctx.fillText(formatDuration(tick * dil), x, axisY + 5);
    }

    // 強さの履歴(単調減。転位色 — 強さ = 転位の通り抜け抵抗)
    if (series.length >= 2) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < series.length; i++) {
        if (series.t[i] < TAU_MIN) continue;
        const x = mapX(series.t[i]);
        const y = mapY(series.v[i]);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = strengthLine;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 現在点マーカー + 値の読み出し
    if (ens.tau > TAU_MIN) {
      const x = mapX(ens.tau);
      const y = mapY(strength);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, TAU);
      ctx.fillStyle = strengthLine;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = strengthEdge;
      ctx.stroke();
      const right = x > p.x + p.w * 0.6;
      ctx.font = font(11);
      ctx.fillStyle = text;
      ctx.textAlign = right ? "right" : "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${Math.round(strength)} MPa`, x + (right ? -8 : 8), y - 6);
      ctx.textAlign = "left";
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    layout();
    const strength = currentStrength();
    if (L.narrow) {
      drawReadoutStrip(L.stripY, strength);
    } else {
      drawCards(L.cards);
      ctx.font = font(12.5);
      ctx.fillStyle = text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(elapsedText(), L.elapsedX, L.elapsedY);
    }
    drawFieldPane(L.field);
    drawPlotPane(L.plot, strength);
  }

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    const dTau = dt * BASE_RATE * speedMult;
    if (dTau > 0) {
      // dt = 0(requestRender 経由)のときは状態を進めず描画のみ(§5.1)
      ens.step(dTau);
      micro.update(dt, ens.dissolvedNow);
      series.push(ens.tau, currentStrength());
    }
    draw();
  });
  // 一時停止中の操作(スライダー・リセット・省モーション初期表示)用
  host.onRender(draw);

  // 初期系列(τ=0 点は対数軸の外だが、履歴の起点として保持)
  series.push(0, currentStrength());

  // 初期状態は一時停止。再生ボタンで開始する(§5.1)
  host.setPlaying(false);

  return {
    destroy(): void {
      // イベントリスナーは登録していないので解放するものはない
    },
  };
}
