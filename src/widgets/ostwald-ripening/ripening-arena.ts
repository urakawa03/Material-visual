/**
 * ripening-arena.ts — 図5「生き残りの条件は変わり続ける」(記事仕様書 03 §5.5)
 *
 * 左: 粒子場(タップで追跡対象を選択)。右上: 半径のはしご(全粒子の r と
 * r* 破線)。右下: 追跡粒子の r(t) と r*(t) のプロット(交差点に自動マーカー)。
 * 温度は実時間換算の表示のみに影響する(§5.0)。
 *
 * 簡略化(図注で明示): 平均場モデル(粒子位置・空間相関は入らない)、
 * 希薄極限、粒子は球。配置は装飾で計算には入らない。
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
import { MicrostructureView } from "./lib/microstructure";
import { font, linTicks, logTicks, smallTriangle } from "./lib/draw";

/**
 * 乱数シード(reset で同一の初期組織を再現 — 母体仕様 §8.2)。
 * シードと既定の追跡百分位(60 %台)の組は、既定の追跡粒子が
 * 「成長 → r* に抜かれる → 収縮 → 溶解」の全生涯を 1 回の再生で見せる
 * ことを数値検証して選んである(受け入れ基準 §5.5)。
 */
const SEED = 10;
/** 粒子数 N₀(§5.5) */
const N0 = 80;
/** 粒子場の視野 [nm] */
const FIELD_W_NM = 240;
const FIELD_H_NM = 260;
/** 時間の進み ×1 のときのエンジン時間の速さ [τ 秒 / 実秒] */
const BASE_RATE = 20;
/** 追跡対象の巡回百分位(中位 → 上位 → 下位 — §5.5) */
const TRACK_PERCENTILES = [0.7, 0.85, 0.25] as const;
/** プロットの時間軸の下限 [τ 秒](対数軸) */
const TAU_MIN = 30;
/** 過去の追跡線を残す本数 */
const MAX_OLD_TRACKS = 3;
/** 記録バッファ容量と初期間隔 */
const SERIES_CAP = 720;
const SERIES_INTERVAL = 15;

const TAU = Math.PI * 2;

interface OldTrack {
  t: Float64Array;
  v: Float64Array;
  length: number;
}

export default function ripeningArena(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色(初期化時に一度だけ解決 — colors.ts の注意書き)
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill, 0.2);
  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");
  const matrix = matColor("matrix");

  const ens = new RipeningEnsemble({ count: N0, seed: SEED });
  const micro = new MicrostructureView(ens, FIELD_W_NM, FIELD_H_NM, SEED + 1);

  let tempC = 200;
  let speedMult = 10;

  let trackIdx = ens.aliveIndexAtPercentile(TRACK_PERCENTILES[0]);
  let cycleAt = 1; // 次に「別の粒子を追跡」で使う百分位
  const trackSeries = new SeriesBuffer(SERIES_CAP, SERIES_INTERVAL);
  const rStarSeries = new SeriesBuffer(SERIES_CAP, SERIES_INTERVAL);
  const oldTracks: OldTrack[] = [];
  /** 追跡粒子が r* に抜かれた時刻(-1 = 未交差)と、そのときの r */
  let crossTau = -1;
  let crossR = 0;
  let prevDiff = 0;

  function archiveTrack(): void {
    if (trackSeries.length > 1) {
      oldTracks.push({
        t: trackSeries.t.slice(0, trackSeries.length),
        v: trackSeries.v.slice(0, trackSeries.length),
        length: trackSeries.length,
      });
      if (oldTracks.length > MAX_OLD_TRACKS) oldTracks.shift();
    }
    trackSeries.clear();
    crossTau = -1;
    prevDiff = 0;
  }

  function setTrack(idx: number): void {
    if (idx < 0 || idx === trackIdx) return;
    archiveTrack();
    trackIdx = idx;
    if (ens.alive[idx]) {
      prevDiff = ens.r[idx] - ens.rStar();
      trackSeries.push(ens.tau, ens.r[idx]);
    }
  }

  function resetAll(): void {
    ens.reset();
    micro.resetFades();
    trackSeries.clear();
    rStarSeries.clear();
    oldTracks.length = 0;
    crossTau = -1;
    prevDiff = 0;
    cycleAt = 1;
    trackIdx = ens.aliveIndexAtPercentile(TRACK_PERCENTILES[0]);
  }

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "T",
    label: "温度",
    min: 150,
    max: 300,
    step: 5,
    value: tempC,
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
    value: "10",
  });
  speedSeg.onChange((v) => {
    speedMult = Number(v);
  });

  const cycleBtn = host.controls.button({ label: "別の粒子を追跡" });
  cycleBtn.onClick(() => {
    const idx = ens.aliveIndexAtPercentile(TRACK_PERCENTILES[cycleAt]);
    cycleAt = (cycleAt + 1) % TRACK_PERCENTILES.length;
    setTrack(idx);
    host.requestRender();
  });

  host.controls.playPause();
  host.controls.reset(() => {
    tempSlider.set(200);
    speedSeg.set("10");
    resetAll();
  });

  /* ---- レイアウト(毎フレーム host.size から計算) ---- */

  interface Pane {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  function layout(): {
    field: Pane;
    ladder: Pane | null;
    plot: Pane;
    readoutY: number;
    narrow: boolean;
  } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 34 : 24; // 読み出し行の高さ
    const top = pad + strip;
    if (narrow) {
      const fieldW = w * 0.52 - pad * 1.5;
      return {
        field: { x: pad, y: top, w: fieldW, h: h - top - pad },
        ladder: null,
        plot: {
          x: pad * 2 + fieldW,
          y: top,
          w: w - pad * 3 - fieldW,
          h: h - top - pad,
        },
        readoutY: pad,
        narrow,
      };
    }
    const fieldW = w * 0.46 - pad;
    const rightX = pad + fieldW + pad;
    const rightW = w - rightX - pad;
    const ladderH = (h - top - pad) * 0.5;
    return {
      field: { x: pad, y: top, w: fieldW, h: h - top - pad },
      ladder: { x: rightX, y: top, w: rightW, h: ladderH },
      plot: {
        x: rightX,
        y: top + ladderH + 14,
        w: rightW,
        h: h - top - pad - ladderH - 14,
      },
      readoutY: pad,
      narrow,
    };
  }

  /* ---- タップで追跡対象を選択 ---- */

  function onPointerDown(e: PointerEvent): void {
    const { field } = layout();
    const idx = micro.hitTest(e.offsetX, e.offsetY, field);
    if (idx >= 0) {
      setTrack(idx);
      host.requestRender();
    }
  }
  host.canvas.addEventListener("pointerdown", onPointerDown);

  /* ---- 描画 ---- */

  function drawReadouts(y: number, narrow: boolean): void {
    const { w } = host.size;
    const size = narrow ? 11 : 12.5;
    ctx.font = font(size);
    ctx.textBaseline = "top";
    const rStar = ens.rStar();
    const fPct = F_VOLUME * ens.volumeRatio() * 100;
    const elapsed = formatDuration(ens.tau * timeDilation(tempC + KELVIN));
    const parts: Array<[string, string]> = [
      [`N ${ens.aliveCount}`, text],
      [`r̄ ${ens.meanR().toFixed(1)} nm`, text],
      [`r* ${rStar.toFixed(1)} nm`, accent],
      [`f ${fPct.toFixed(1)} %(一定)`, text],
      [`経過 ${elapsed}(${tempC} °C 換算)`, text2],
    ];
    let x = narrow ? 8 : 12;
    let line = 0;
    for (const [s, color] of parts) {
      const tw = ctx.measureText(s).width;
      if (narrow && x + tw > w - 8 && line === 0) {
        line = 1;
        x = 8;
      }
      ctx.fillStyle = color;
      ctx.fillText(s, x, y + line * (size + 4));
      x += tw + (narrow ? 12 : 18);
    }
  }

  function drawFieldPane(p: Pane): void {
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    micro.draw(ctx, p, {
      fill: soluteFill,
      edge: soluteEdge,
      accent,
      trackIndex: trackIdx,
    });
    ctx.restore();
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textBaseline = "bottom";
    ctx.fillText("粒子場(タップで追跡)", p.x + 6, p.y + p.h - 5);
  }

  /** はしご・プロットで共有する r 軸の上限 [nm] */
  function rAxisMax(): number {
    let m = 0;
    for (let i = 0; i < N0; i++) {
      if (ens.alive[i] && ens.r[i] > m) m = ens.r[i];
    }
    for (let i = 0; i < trackSeries.length; i++) {
      if (trackSeries.v[i] > m) m = trackSeries.v[i];
    }
    return Math.max(12, Math.ceil((m * 1.2) / 5) * 5);
  }

  function drawLadderPane(p: Pane, rMax: number): void {
    const axisX = p.x + 30;
    const y0 = p.y + 12;
    const y1 = p.y + p.h - 6;
    const mapY = (r: number): number => y1 - ((y1 - y0) * r) / rMax;

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textBaseline = "top";
    ctx.fillText("半径のはしご", axisX + 4, p.y);

    // 軸と目盛り
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, y0);
    ctx.lineTo(axisX + 0.5, y1);
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const v of linTicks(0, rMax, 4)) {
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), axisX - 5, y);
    }
    ctx.textAlign = "left";
    ctx.fillText("nm", axisX - 26, y0 - 8);

    // r* の破線(accent)
    const rStar = ens.rStar();
    const yStar = mapY(rStar);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(axisX + 2, yStar + 0.5);
    ctx.lineTo(p.x + p.w - 26, yStar + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent;
    ctx.font = font(12);
    ctx.fillText("r*", p.x + p.w - 22, yStar);

    // 全粒子の点 + 上下の小矢印
    const xLeft = axisX + 12;
    const xRight = p.x + p.w - 32;
    for (let i = 0; i < N0; i++) {
      if (!ens.alive[i]) continue;
      const x = xLeft + ((xRight - xLeft) * i) / (N0 - 1);
      const y = mapY(ens.r[i]);
      const up = ens.r[i] > rStar;
      ctx.beginPath();
      ctx.arc(x, y, i === trackIdx ? 3.5 : 2.5, 0, TAU);
      ctx.fillStyle = soluteFill;
      ctx.fill();
      if (i === trackIdx) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = accent;
        ctx.stroke();
      }
      smallTriangle(ctx, x, y + (up ? -7 : 7), 3, up, text2);
    }
  }

  function drawSeries(
    s: { t: Float64Array; v: Float64Array; length: number },
    mapX: (t: number) => number,
    mapY: (r: number) => number,
    color: string,
    width: number,
    dash: number[] = [],
  ): void {
    if (s.length < 2) return;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.length; i++) {
      if (s.t[i] < TAU_MIN) continue;
      const x = mapX(s.t[i]);
      const y = mapY(s.v[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPlotPane(p: Pane, rMax: number): void {
    const axisX = p.x + 30;
    const axisY = p.y + p.h - 20;
    const y0 = p.y + 14;
    const tauMax = Math.max(ens.tau * 1.05, TAU_MIN * 20);
    const lnMin = Math.log(TAU_MIN);
    const lnMax = Math.log(tauMax);
    const mapX = (t: number): number =>
      axisX +
      ((p.x + p.w - 8 - axisX) * (Math.log(t) - lnMin)) / (lnMax - lnMin);
    const mapY = (r: number): number => axisY - ((axisY - y0) * r) / rMax;

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("追跡粒子の r(t) と r*(t)", axisX + 4, p.y);

    // 軸
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, y0);
    ctx.lineTo(axisX + 0.5, axisY + 0.5);
    ctx.lineTo(p.x + p.w - 8, axisY + 0.5);
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const v of linTicks(0, rMax, 3)) {
      if (v === 0) continue;
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), axisX - 5, y);
    }
    // 時間目盛り(τ の 10 の冪。ラベルは選択温度での実時間)
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

    // 過去の追跡線(淡色)
    for (const old of oldTracks) {
      ctx.globalAlpha = 0.45;
      drawSeries(old, mapX, mapY, matrix, 1.25);
      ctx.globalAlpha = 1;
    }
    // r*(t)(accent 破線)と追跡粒子(solute)
    drawSeries(rStarSeries, mapX, mapY, accent, 1.5, [5, 4]);
    drawSeries(trackSeries, mapX, mapY, soluteFill, 2);

    // 交差マーカー「ここで形勢逆転」
    if (crossTau > TAU_MIN) {
      const x = mapX(crossTau);
      const y = mapY(crossR);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.font = font(11);
      ctx.fillStyle = text;
      ctx.textAlign = x > p.x + p.w * 0.6 ? "right" : "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("ここで形勢逆転", x + (x > p.x + p.w * 0.6 ? -8 : 8), y - 6);
    }
    ctx.textAlign = "left";
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawReadouts(l.readoutY, l.narrow);
    drawFieldPane(l.field);
    const rMax = rAxisMax();
    if (l.ladder) drawLadderPane(l.ladder, rMax);
    drawPlotPane(l.plot, rMax);
  }

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    const dTau = dt * BASE_RATE * speedMult;
    if (dTau > 0) {
      ens.step(dTau);
      micro.update(dt, ens.dissolvedNow);

      // 記録と交差検出
      rStarSeries.push(ens.tau, ens.rStar());
      if (trackIdx >= 0 && ens.alive[trackIdx]) {
        trackSeries.push(ens.tau, ens.r[trackIdx]);
        const diff = ens.r[trackIdx] - ens.rStar();
        if (crossTau < 0 && prevDiff > 0 && diff <= 0) {
          crossTau = ens.tau;
          crossR = ens.r[trackIdx];
        }
        prevDiff = diff;
      }
    }
    draw();
  });

  // 初期系列(τ=0 点は対数軸外だが、追跡開始値として保持)
  if (trackIdx >= 0) {
    prevDiff = ens.r[trackIdx] - ens.rStar();
    trackSeries.push(ens.tau, ens.r[trackIdx]);
  }
  rStarSeries.push(ens.tau, ens.rStar());

  return {
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
