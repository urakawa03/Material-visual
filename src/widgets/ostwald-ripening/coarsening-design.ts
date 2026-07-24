/**
 * coarsening-design.ts — 図8「粗大化に抗う」(記事仕様書 03 §5.8・発展)
 *
 * 設計レバー3本(界面・拡散・固溶度)を K = (4/9)D c∞ l_c の各因子への
 * 倍率として掛け合わせ、r̄(t) = (r̄0³ + K t)^(1/3) の粗大化曲線と 10,000 時間
 * 後の強度保持率、K の分解バーを見せる。本図のみ Ni 基相当の別定数系。
 *
 * 簡略化(図注で明示): レバーは実合金では独立でなく互いに作用する。
 * 本図のみ μ=80 GPa、b=0.25 nm、f=0.5、r̄0=300 nm のモデル定数系。数値は
 * モデル値であり実測ではない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { KB_EV, Q_K_EV, KELVIN, formatDuration } from "./lib/constants";
import { font, fmtSig, logTicks } from "./lib/draw";

/** 本図専用の Ni 基相当定数系(図注で明示 — §5.8) */
const R0_NM = 300;
/** 900 °C・汎用構成での基準速度定数 [nm³/s]
 *  (3100³ − 300³)/(1e4 h) ≈ 826。「汎用@900°C は 1e4 h で r̄ 10 倍超」を満たす */
const T_BASE_K = 900 + KELVIN;
const K_BASE = (3100 ** 3 - R0_NM ** 3) / (1e4 * 3600);
/** 10,000 時間 [s](保持率の評価点) */
const T_10K_HOURS_S = 1e4 * 3600;
/** 曲線の時間レンジ [s]: 1 h 〜 10 年 */
const T_MIN_S = 3600;
const T_MAX_S = 10 * 365.25 * 86400;

type Iface = "0.8" | "0.2" | "0.02";
type Diff = "fast" | "slow";
type Solub = "sol" | "insol";

/** レバー → K への倍率 */
function ifaceMul(v: Iface): number {
  return Number(v) / 0.2; // γ/0.2(l_c ∝ γ なので K ∝ γ)
}
function diffMul(v: Diff): number {
  return v === "fast" ? 1 : 1 / 30;
}
function solubMul(v: Solub): number {
  return v === "sol" ? 1 : 1e-4;
}

interface Preset {
  label: string;
  iface: Iface;
  diff: Diff;
  solub: Solub;
}
const PRESETS: Preset[] = [
  { label: "汎用析出合金", iface: "0.2", diff: "fast", solub: "sol" },
  { label: "Ni基超合金", iface: "0.02", diff: "slow", solub: "sol" },
  { label: "ODS 鋼", iface: "0.8", diff: "fast", solub: "insol" },
];

export default function coarseningDesign(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const solute = matColor("solute");
  const matrix = matColor("matrix");
  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");

  let iface: Iface = "0.2";
  let diff: Diff = "fast";
  let solub: Solub = "sol";
  let tempC = 900;

  /** 温度倍率(みかけの活性化エネルギー Q_K) */
  function tempMul(): number {
    return Math.exp((-Q_K_EV / KB_EV) * (1 / (tempC + KELVIN) - 1 / T_BASE_K));
  }
  /** 現在構成の K [nm³/s] */
  function kNow(i: Iface, d: Diff, s: Solub): number {
    return K_BASE * tempMul() * ifaceMul(i) * diffMul(d) * solubMul(s);
  }
  function rBar(t: number, k: number): number {
    return Math.cbrt(R0_NM ** 3 + k * t);
  }

  /* ---- 操作部品(§7.2) ---- */

  const ifaceSeg = host.controls.segmented<Iface>({
    id: "iface",
    label: "界面 γ",
    options: [
      { value: "0.8", label: "非整合" },
      { value: "0.2", label: "半整合" },
      { value: "0.02", label: "整合" },
    ],
    value: "0.2",
  });
  ifaceSeg.onChange((v) => {
    iface = v;
  });

  const diffSeg = host.controls.segmented<Diff>({
    id: "diff",
    label: "拡散 D",
    options: [
      { value: "fast", label: "速い" },
      { value: "slow", label: "遅い" },
    ],
    value: "fast",
  });
  diffSeg.onChange((v) => {
    diff = v;
  });

  const solubSeg = host.controls.segmented<Solub>({
    id: "solub",
    label: "固溶度 c∞",
    options: [
      { value: "sol", label: "溶ける" },
      { value: "insol", label: "ほぼ溶けない" },
    ],
    value: "sol",
  });
  solubSeg.onChange((v) => {
    solub = v;
  });

  const tempSlider = host.controls.slider({
    id: "T",
    label: "温度",
    min: 700,
    max: 1000,
    step: 25,
    value: 900,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    tempC = v;
  });

  function applyPreset(p: Preset): void {
    ifaceSeg.set(p.iface);
    diffSeg.set(p.diff);
    solubSeg.set(p.solub);
  }
  for (const p of PRESETS) {
    const btn = host.controls.button({ label: p.label });
    btn.onClick(() => {
      applyPreset(p);
      host.requestRender();
    });
  }

  host.controls.reset(() => {
    applyPreset(PRESETS[0]);
    tempSlider.set(900);
  });

  /* ---- 描画 ---- */

  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  function drawCurve(p: Rect): void {
    const lxMin = Math.log10(T_MIN_S);
    const lxMax = Math.log10(T_MAX_S);
    // y は r̄(log)。100 〜 20000 nm
    const yMin = 100;
    const yMax = 20000;
    const lyMin = Math.log10(yMin);
    const lyMax = Math.log10(yMax);
    const mapX = (t: number): number =>
      p.x + (p.w * (Math.log10(t) - lxMin)) / (lxMax - lxMin);
    const mapY = (r: number): number =>
      p.y + p.h - (p.h * (Math.log10(r) - lyMin)) / (lyMax - lyMin);

    ctx.font = font(12);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("平均半径 r̄(t)", p.x, p.y - 18);

    // 枠と目盛り
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y);
    ctx.lineTo(p.x + 0.5, p.y + p.h + 0.5);
    ctx.lineTo(p.x + p.w, p.y + p.h + 0.5);
    ctx.stroke();
    ctx.font = font(11);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of logTicks(T_MIN_S, T_MAX_S)) {
      const x = mapX(t);
      ctx.strokeStyle = hairline;
      ctx.beginPath();
      ctx.moveTo(x, p.y + p.h);
      ctx.lineTo(x, p.y + p.h + 3);
      ctx.stroke();
      ctx.fillStyle = text2;
      ctx.fillText(formatDuration(t), x, p.y + p.h + 5);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const r of logTicks(yMin, yMax)) {
      const y = mapY(r);
      ctx.fillText(`${fmtSig(r)}`, p.x - 5, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("nm", p.x + 2, p.y - 2);

    // 10,000 h の縦の目印
    const x10k = mapX(T_10K_HOURS_S);
    if (x10k >= p.x && x10k <= p.x + p.w) {
      ctx.strokeStyle = hairline;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x10k, p.y);
      ctx.lineTo(x10k, p.y + p.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = text2;
      ctx.font = font(10);
      ctx.textAlign = "center";
      ctx.fillText("1万時間", x10k, p.y + 2);
    }

    const drawOne = (k: number, color: string, width: number): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (let e = lxMin; e <= lxMax + 1e-9; e += (lxMax - lxMin) / 120) {
        const t = 10 ** e;
        const r = rBar(t, k);
        const x = mapX(t);
        const y = mapY(Math.min(r, yMax));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    // プリセット3本の淡色参照
    for (const pr of PRESETS) {
      drawOne(kNow(pr.iface, pr.diff, pr.solub), matrix, 1);
    }
    // 選択構成(太・text 色)
    drawOne(kNow(iface, diff, solub), text, 2.25);
  }

  function drawDecomp(p: Rect): void {
    // K = (4/9) D c∞ l_c の 3 因子の倍率(基準 = 汎用構成 = すべて ×1)
    const factors: Array<[string, number]> = [
      ["界面 (l_c ∝ γ)", ifaceMul(iface)],
      ["拡散 D", diffMul(diff)],
      ["固溶度 c∞", solubMul(solub)],
    ];
    const totalMul = ifaceMul(iface) * diffMul(diff) * solubMul(solub);

    ctx.font = font(12);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("K の分解(汎用構成を ×1 とした倍率)", p.x, p.y - 16);

    // 対数バー(×1e-4 〜 ×4)。中央 = ×1
    const lo = Math.log10(1e-4);
    const hi = Math.log10(4);
    const barX = p.x + 96;
    const barW = p.w - 96;
    const zeroX = barX + (barW * (0 - lo)) / (hi - lo); // ×1 の位置
    const rowH = (p.h - 8) / 4;

    const fmtMul = (m: number): string => {
      if (m >= 1) return `×${fmtSig(m)}`;
      if (m >= 1e-3) return `×1/${fmtSig(1 / m)}`;
      return `×${m.toExponential(0)}`;
    };

    // ×1 の基準線
    ctx.strokeStyle = hairline;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(zeroX, p.y);
    ctx.lineTo(zeroX, p.y + rowH * 3 + 4);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < factors.length; i++) {
      const [label, m] = factors[i];
      const y = p.y + i * rowH;
      ctx.font = font(11);
      ctx.fillStyle = text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, p.x, y + rowH / 2);
      const mClamped = Math.min(Math.max(m, 1e-4), 4);
      const x = barX + (barW * (Math.log10(mClamped) - lo)) / (hi - lo);
      ctx.fillStyle = m < 1 ? accent : solute;
      const x0 = Math.min(zeroX, x);
      const x1 = Math.max(zeroX, x);
      ctx.fillRect(x0, y + rowH / 2 - 5, Math.max(x1 - x0, 1.5), 10);
      ctx.fillStyle = text;
      ctx.textAlign = m < 1 ? "left" : "right";
      ctx.fillText(fmtMul(m), m < 1 ? x0 - 4 - 30 : x1 + 4, y + rowH / 2);
    }
    // 合計倍率
    const y = p.y + 3 * rowH;
    ctx.font = font(12, 600);
    ctx.fillStyle = text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`合計 K 倍率  ${fmtMul(totalMul)}`, p.x, y + rowH / 2);
  }

  function drawReadout(x: number, y: number): void {
    const k = kNow(iface, diff, solub);
    const r10k = rBar(T_10K_HOURS_S, k);
    // 強度保持率 = Δτ(r̄0)/Δτ(r̄) = r̄0 / r̄(オロワン式は 1/L ∝ 1/r̄)
    const retention = (R0_NM / r10k) * 100;
    ctx.font = font(13);
    ctx.fillStyle = text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      `10,000 時間後: r̄ = ${Math.round(r10k).toLocaleString("en-US")} nm、強度保持率 ${retention < 1 ? retention.toFixed(1) : Math.round(retention)} %`,
      x,
      y,
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = w < 560 ? 8 : 12;
    const readoutH = 22;
    const decompH = Math.min(120, h * 0.32);
    const curve: Rect = {
      x: pad + 42,
      y: pad + 18,
      w: w - pad * 2 - 42,
      h: h - pad * 2 - 18 - readoutH - decompH - 34,
    };
    drawCurve(curve);
    drawReadout(pad + 42, curve.y + curve.h + 28);
    drawDecomp({
      x: pad + 4,
      y: curve.y + curve.h + 28 + readoutH + 14,
      w: w - pad * 2 - 4,
      h: decompH,
    });
  }

  host.onRender(draw);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
