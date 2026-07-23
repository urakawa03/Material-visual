/**
 * one-third-law.ts — 図6「3分の1乗の法則」(記事仕様書 03 §5.6)
 *
 * タブ3面: (a) r̄³ vs t の直線、(b) 両対数で傾き 1/3、(c) 規格化サイズ分布の
 * 自己相似(3 時点の重ね描き + LSW 分布形)。時間スクラバーで履歴の任意時点
 * まで表示、温度スライダーは軸の実時間ラベルだけを変える(§5.0)。
 *
 * データは平均場エンジン(ripening.ts)を複数アンサンブル集計して初回マウント
 * 時に一度だけ計算し、モジュールスコープにキャッシュする。計算は非同期で
 * チャンク実行し、50ms を超える長タスクを避ける(母体仕様 §10.1)。
 *
 * 簡略化(図注で明示): 希薄極限の平均場計算。統計のため複数アンサンブル
 * (4000 粒子 × 8 ラン)を集計している。実合金では速く・分布は広くなる。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import {
  KELVIN,
  K_REF_NM3S,
  formatDuration,
  timeDilation,
} from "./lib/constants";
import { RipeningEnsemble, lswPdf } from "./lib/ripening";
import { font, fmtSig, linTicks, logTicks } from "./lib/draw";

/** 集計するアンサンブルの数と各粒子数(数値検証済みの構成 — §5.6) */
const RUNS = 8;
const N0 = 4000;
/** ランごとのシード基準(reset でも同一データ) */
const SEED_BASE = 2000;
const SEED_STRIDE = 17;
/** スナップショットの基準時刻 T1 と比 1:8:64(τ 秒) */
const T1 = 1200;
const SNAP_TAUS = [T1, 8 * T1, 64 * T1] as const;
/** 履歴の終端 τ */
const TAU_END = 64 * T1 * 1.05;
/** ヒストグラムのビン(u = r/r̄、0〜2) */
const HIST_BINS = 16;
const HIST_MAX_U = 2;

const TAU = Math.PI * 2;

/** 集計結果(モジュールスコープにキャッシュ。2 回目のマウントで再計算しない) */
interface Precomputed {
  /** サンプル時刻 [τ 秒] */
  t: Float64Array;
  /** 集計平均半径 r̄ [nm] */
  rbar: Float64Array;
  /** フィット窓(τ ∈ [T3/4, T3])の傾き K_fit [nm³/s] と r̄³ 切片 */
  kFit: number;
  b0Fit: number;
  /** 3 スナップショットの規格化ヒストグラム(density、合計面積 1) */
  hist: number[][];
  /** LSW 分布形のヒストグラム(同ビン、density) */
  lswHist: number[];
}

let cache: Precomputed | null = null;
let computing: Promise<Precomputed> | null = null;

/** u = r/r̄ の配列を density ヒストグラムにする(合計面積 = 1) */
function toHist(us: number[]): number[] {
  const h = new Array<number>(HIST_BINS).fill(0);
  const bw = HIST_MAX_U / HIST_BINS;
  for (const u of us) {
    const b = Math.floor(u / bw);
    if (b >= 0 && b < HIST_BINS) h[b] += 1;
  }
  const n = us.length;
  for (let i = 0; i < HIST_BINS; i++) h[i] /= n * bw;
  return h;
}

/** yield して長タスクを避ける */
function idle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** エンジンを複数アンサンブル集計して履歴・分布を作る(非同期チャンク実行) */
async function computeData(): Promise<Precomputed> {
  const ensembles = Array.from(
    { length: RUNS },
    (_, k) =>
      new RipeningEnsemble({ count: N0, seed: SEED_BASE + k * SEED_STRIDE }),
  );
  const ts: number[] = [];
  const rbars: number[] = [];
  const snaps: number[][] = [[], [], []];
  let snapIdx = 0;
  let next = 50;

  const meanRadius = (): number => {
    let sum = 0;
    let n = 0;
    for (const e of ensembles) {
      for (let i = 0; i < e.count; i++) {
        if (e.alive[i]) {
          sum += e.r[i];
          n++;
        }
      }
    }
    return n > 0 ? sum / n : 0;
  };

  let chunk = 0;
  while (ensembles[0].tau < TAU_END) {
    const target = Math.min(
      next,
      snapIdx < SNAP_TAUS.length ? SNAP_TAUS[snapIdx] : Infinity,
    );
    for (const e of ensembles) e.step(target - e.tau);
    const tau = ensembles[0].tau;
    const mean = meanRadius();
    ts.push(tau);
    rbars.push(mean);
    if (snapIdx < SNAP_TAUS.length && tau >= SNAP_TAUS[snapIdx] - 1e-6) {
      for (const e of ensembles) {
        for (let i = 0; i < e.count; i++) {
          if (e.alive[i]) snaps[snapIdx].push(e.r[i] / mean);
        }
      }
      snapIdx++;
    }
    if (tau >= next) next *= 1.12;
    // 数ステップごとに制御を返す(長タスク回避)
    if (++chunk % 4 === 0) await idle();
  }

  // フィット窓 τ ∈ [T3/4, T3] の最小二乗(r̄³ = kFit·t + b0)
  const t3 = SNAP_TAUS[2];
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let nf = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] >= t3 / 4 && ts[i] <= t3) {
      const x = ts[i];
      const y = rbars[i] ** 3;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
      nf++;
    }
  }
  const kFit = (nf * sxy - sx * sy) / (nf * sxx - sx * sx);
  const b0Fit = (sy - kFit * sx) / nf;

  // LSW 分布のヒストグラム(u をサンプルして同ビンへ)
  const lswSamples: number[] = [];
  const du = 0.002;
  let cum = 0;
  const cdf: Array<[number, number]> = [];
  for (let u = du / 2; u < 1.5; u += du) {
    cum += lswPdf(u) * du;
    cdf.push([u, cum]);
  }
  const total = cum;
  for (let k = 0; k < 6000; k++) {
    const target = ((k + 0.5) / 6000) * total;
    let lo = 0;
    let hi = cdf.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid][1] < target) lo = mid;
      else hi = mid;
    }
    lswSamples.push(cdf[lo][0]);
  }

  return {
    t: Float64Array.from(ts),
    rbar: Float64Array.from(rbars),
    kFit,
    b0Fit,
    hist: snaps.map(toHist),
    lswHist: toHist(lswSamples),
  };
}

function getData(): Promise<Precomputed> {
  if (cache) return Promise.resolve(cache);
  if (!computing) {
    computing = computeData().then((d) => {
      cache = d;
      return d;
    });
  }
  return computing;
}

type Tab = "a" | "b" | "c";

export default function oneThirdLaw(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const solute = matColor("solute");
  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");

  let data: Precomputed | null = cache;
  let tab: Tab = "a";
  let scrub = 0.5;
  let tempC = 200;
  let showLsw = false;
  let destroyed = false;

  /* ---- 操作部品(§7.2) ---- */

  const tabSeg = host.controls.segmented<Tab>({
    id: "tab",
    label: "表示",
    options: [
      { value: "a", label: "r̄³∝t" },
      { value: "b", label: "両対数" },
      { value: "c", label: "形は不変" },
    ],
    value: "a",
  });
  tabSeg.onChange((v) => {
    tab = v;
  });

  const scrubSlider = host.controls.slider({
    id: "scrub",
    label: "時間",
    min: 0,
    max: 100,
    step: 1,
    value: 50,
    unit: "%",
  });
  scrubSlider.onChange((v) => {
    scrub = v / 100;
  });

  const tempSlider = host.controls.slider({
    id: "T",
    label: "温度",
    min: 150,
    max: 300,
    step: 5,
    value: 200,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    tempC = v;
  });

  const lswToggle = host.controls.toggle({
    id: "lsw",
    label: "LSW 分布を重ねる",
    value: false,
  });
  lswToggle.onChange((v) => {
    showLsw = v;
  });

  host.controls.reset(() => {
    tabSeg.set("a");
    scrubSlider.set(50);
    tempSlider.set(200);
    lswToggle.set(false);
  });

  /* ---- 描画 ---- */

  interface Plot {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  function plotArea(): Plot {
    const { w, h } = host.size;
    const pad = w < 560 ? 8 : 12;
    const left = pad + 40;
    const top = pad + 20;
    return {
      x: left,
      y: top,
      w: w - left - pad,
      h: h - top - pad - 24,
    };
  }

  function drawFrame(p: Plot, title: string): void {
    ctx.font = font(12);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, p.x, p.y - 18);
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y);
    ctx.lineTo(p.x + 0.5, p.y + p.h + 0.5);
    ctx.lineTo(p.x + p.w, p.y + p.h + 0.5);
    ctx.stroke();
  }

  /** スクラブで選ぶサンプル数(データ長に対する割合) */
  function scrubCount(d: Precomputed): number {
    return Math.max(2, Math.round(scrub * (d.t.length - 1)) + 1);
  }

  function drawLinear(d: Precomputed, p: Plot): void {
    drawFrame(p, "(a) r̄³ は時間に比例する");
    const n = scrubCount(d);
    const tMax = d.t[n - 1];
    // y は全域の最大に固定(スクラブで軸が動かないように)
    const yMax = d.rbar[d.t.length - 1] ** 3 * 1.05;
    const mapX = (t: number): number => p.x + (p.w * t) / (tMax || 1);
    const mapY = (v: number): number => p.y + p.h - (p.h * v) / yMax;

    const dil = timeDilation(tempC + KELVIN);
    // 時間目盛り
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of linTicks(0, tMax, 4)) {
      const x = mapX(t);
      ctx.strokeStyle = hairline;
      ctx.beginPath();
      ctx.moveTo(x, p.y + p.h);
      ctx.lineTo(x, p.y + p.h + 3);
      ctx.stroke();
      ctx.fillText(formatDuration(t * dil), x, p.y + p.h + 5);
    }
    // y 目盛り(nm³)
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, yMax, 4)) {
      if (v === 0) continue;
      const y = mapY(v);
      ctx.fillText(fmtSig(v), p.x - 5, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("r̄³ [nm³]", p.x + 2, p.y - 2);

    // フィット直線(参照)
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(mapX(0), mapY(d.b0Fit));
    ctx.lineTo(mapX(tMax), mapY(d.kFit * tMax + d.b0Fit));
    ctx.stroke();
    ctx.setLineDash([]);

    // データ点
    ctx.strokeStyle = solute;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = mapX(d.t[i]);
      const y = mapY(d.rbar[i] ** 3);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 現在点
    const cx = mapX(d.t[n - 1]);
    const cy = mapY(d.rbar[n - 1] ** 3);
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, TAU);
    ctx.fillStyle = solute;
    ctx.fill();

    // K の読み出し(200 °C 基準)
    ctx.font = font(12);
    ctx.fillStyle = text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      `傾き K ≈ ${fmtSig(K_REF_NM3S)} nm³/s(200 °C)`,
      p.x + 8,
      p.y + 6,
    );
  }

  function drawLogLog(d: Precomputed, p: Plot): void {
    drawFrame(p, "(b) 両対数では傾き 1/3");
    const n = scrubCount(d);
    // x, y とも log。範囲は全域固定
    const tMin = d.t[0];
    const tMax = d.t[d.t.length - 1];
    const rMin = d.rbar[0];
    const rMax = d.rbar[d.t.length - 1];
    const lxMin = Math.log10(tMin);
    const lxMax = Math.log10(tMax);
    const lyMin = Math.log10(rMin * 0.9);
    const lyMax = Math.log10(rMax * 1.1);
    const mapX = (t: number): number =>
      p.x + (p.w * (Math.log10(t) - lxMin)) / (lxMax - lxMin);
    const mapY = (r: number): number =>
      p.y + p.h - (p.h * (Math.log10(r) - lyMin)) / (lyMax - lyMin);

    const dil = timeDilation(tempC + KELVIN);
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of logTicks(tMin, tMax)) {
      const x = mapX(t);
      ctx.strokeStyle = hairline;
      ctx.beginPath();
      ctx.moveTo(x, p.y + p.h);
      ctx.lineTo(x, p.y + p.h + 3);
      ctx.stroke();
      ctx.fillText(formatDuration(t * dil), x, p.y + p.h + 5);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const r of logTicks(rMin * 0.9, rMax * 1.1)) {
      const y = mapY(r);
      ctx.fillText(`${fmtSig(r)}`, p.x - 5, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("r̄ [nm]", p.x + 2, p.y - 2);

    // 傾き 1/3 の参照線(後半のデータに沿わせる)
    const iRef = Math.floor(d.t.length * 0.5);
    const tRef = d.t[iRef];
    const rRef = d.rbar[iRef];
    const refR = (t: number): number => rRef * Math.cbrt(t / tRef);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(mapX(tRef), mapY(refR(tRef)));
    ctx.lineTo(mapX(tMax), mapY(refR(tMax)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent;
    ctx.font = font(11);
    ctx.fillText("傾き 1/3", mapX(tMax) - 52, mapY(refR(tMax)) - 16);

    // データ
    ctx.strokeStyle = solute;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = mapX(d.t[i]);
      const y = mapY(d.rbar[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const cx = mapX(d.t[n - 1]);
    const cy = mapY(d.rbar[n - 1]);
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, TAU);
    ctx.fillStyle = solute;
    ctx.fill();
  }

  function drawHistograms(d: Precomputed, p: Plot): void {
    drawFrame(p, "(c) 形は変わらない(規格化サイズ分布)");
    const bw = HIST_MAX_U / HIST_BINS;
    let yMax = 0;
    for (const h of d.hist) for (const v of h) if (v > yMax) yMax = v;
    for (const v of d.lswHist) if (v > yMax) yMax = v;
    yMax *= 1.1;
    const mapX = (u: number): number => p.x + (p.w * u) / HIST_MAX_U;
    const mapY = (v: number): number => p.y + p.h - (p.h * v) / yMax;

    // x 目盛り(u = r/r̄)
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const u of [0, 0.5, 1, 1.5, 2]) {
      const x = mapX(u);
      ctx.fillText(u.toFixed(1), x, p.y + p.h + 5);
    }
    ctx.textAlign = "left";
    ctx.fillText("r / r̄", p.x + p.w - 34, p.y + p.h + 5);

    // 3 時点の階段線(透明度で区別)
    const alphas = [0.35, 0.6, 1];
    const labels = ["t̃ = 1", "t̃ = 8", "t̃ = 64"];
    for (let s = 0; s < d.hist.length; s++) {
      const h = d.hist[s];
      ctx.globalAlpha = alphas[s];
      ctx.strokeStyle = solute;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < HIST_BINS; i++) {
        const x0 = mapX(i * bw);
        const x1 = mapX((i + 1) * bw);
        const y = mapY(h[i]);
        if (i === 0) ctx.moveTo(x0, y);
        else ctx.lineTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // LSW 分布形(toggle)
    if (showLsw) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.75;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = 0; i < HIST_BINS; i++) {
        const x = mapX((i + 0.5) * bw);
        const y = mapY(d.lswHist[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 凡例
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let lx = p.x + 8;
    const ly = p.y + 6;
    for (let s = 0; s < labels.length; s++) {
      ctx.globalAlpha = alphas[s];
      ctx.fillStyle = solute;
      ctx.fillRect(lx, ly + 3, 14, 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = text2;
      ctx.fillText(labels[s], lx + 18, ly);
      lx += 18 + ctx.measureText(labels[s]).width + 14;
    }
    if (showLsw) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.75;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(lx, ly + 4.5);
      ctx.lineTo(lx + 14, ly + 4.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = text2;
      ctx.fillText("LSW", lx + 18, ly);
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!data) {
      ctx.font = font(14);
      ctx.fillStyle = text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("分布を計算中…", w / 2, h / 2);
      return;
    }
    const p = plotArea();
    if (tab === "a") drawLinear(data, p);
    else if (tab === "b") drawLogLog(data, p);
    else drawHistograms(data, p);
  }

  // requestRender 型(タブ・スクラバー・T・toggle 変更時のみ再描画 — §5.6)
  host.onRender(draw);

  void getData().then((d) => {
    if (destroyed) return;
    data = d;
    host.requestRender();
  });

  return {
    resize(): void {
      host.requestRender();
    },
    destroy(): void {
      destroyed = true;
    },
  };
}
