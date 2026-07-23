/**
 * tensile.ts — 試験片(ダンベル形)描画と応力ひずみ曲線プロットの部品
 * (記事仕様 §5.0)。図1・6・7・8・9 で共用する。
 *
 * すべての曲線・数値は「典型値による現象論モデル」であり実測データでは
 * ない(母体仕様 §2-5)。応力は MPa、ひずみは割合(0.15 = 15%)。
 */

import { mulberry32 } from "../../../core/mathx";

/* ------------------------------------------------------ 材料モデル定数 */

/** 軟鋼のヤング率 E [MPa](= 210 GPa — 記事仕様 §5.1) */
export const STEEL_E_MPA = 210000;
/** 軟鋼の上降伏点 σ_u [MPa] */
export const STEEL_SIGMA_UPPER = 270;
/** 軟鋼の下降伏点 σ_l [MPa] */
export const STEEL_SIGMA_LOWER = 240;
/** 降伏伸び(リューダースひずみ)ε_L */
export const STEEL_LUDERS_STRAIN = 0.025;
/** 上→下降伏の遷移幅(ひずみ) */
export const STEEL_TOOTH_WIDTH = 0.0008;
/** プラトーのゆらぎ振幅 [MPa](シード固定 — §5.1) */
export const STEEL_PLATEAU_JITTER = 3;
/** 加工硬化指数 n */
export const STEEL_HARDENING_EXP = 0.5;
/** 曲線の描画範囲 ε_max */
export const EPS_MAX = 0.15;
/** ε = ε_max での応力(K の校正点 — §5.1) */
export const STEEL_SIGMA_AT_EPS_MAX = 430;

/** アルミニウム合金のヤング率 E [MPa](= 70 GPa) */
export const AL_E_MPA = 70000;
/** アルミニウム合金の 0.2% 耐力 [MPa] */
export const AL_SIGMA02 = 100;
/** Ramberg–Osgood の硬化指数(表示用の典型値) */
export const AL_RO_EXP = 8;

/** 上降伏点に達するひずみ */
export const STEEL_EPS_UPPER = STEEL_SIGMA_UPPER / STEEL_E_MPA;
/** プラトー終端(降伏伸びの終わり)のひずみ */
export const STEEL_PLATEAU_END =
  STEEL_EPS_UPPER + STEEL_TOOTH_WIDTH + STEEL_LUDERS_STRAIN;
/** 加工硬化係数 K(ε = ε_max で σ ≈ 430 MPa となるよう校正) */
export const STEEL_HARDENING_K =
  (STEEL_SIGMA_AT_EPS_MAX - STEEL_SIGMA_LOWER) /
  Math.pow(EPS_MAX - STEEL_PLATEAU_END, STEEL_HARDENING_EXP);

/** 加工硬化域の応力(ε ≥ ε_L_end)。図8 のサイクル合成でも使う */
export function steelHardeningStress(eps: number): number {
  if (eps <= STEEL_PLATEAU_END) return STEEL_SIGMA_LOWER;
  return (
    STEEL_SIGMA_LOWER +
    STEEL_HARDENING_K * Math.pow(eps - STEEL_PLATEAU_END, STEEL_HARDENING_EXP)
  );
}

/**
 * プラトーのゆらぎ(±3 MPa 程度・シード固定)。位相を乱した数本の正弦波の
 * 和で「波打つ平坦部」を作る。同じシードからは常に同じ形(§8.2)。
 */
export function plateauJitter(seed: number): (eps: number) => number {
  const rand = mulberry32(seed);
  const N_WAVES = 4;
  const phases: number[] = [];
  const freqs: number[] = [];
  for (let i = 0; i < N_WAVES; i++) {
    phases.push(rand() * Math.PI * 2);
    // 波長 2〜8 × 10⁻³ ひずみ程度
    freqs.push((2 * Math.PI) / (0.002 + rand() * 0.006));
  }
  // 和が確実に ±JITTER に収まるよう 1 波あたりの振幅を 1/N にする
  const amp = STEEL_PLATEAU_JITTER / N_WAVES;
  return (eps: number): number => {
    let v = 0;
    for (let i = 0; i < N_WAVES; i++) v += Math.sin(eps * freqs[i] + phases[i]);
    return v * amp;
  };
}

/* ------------------------------------------------------ 曲線の生成 */

export interface Curve {
  /** ひずみ(割合)。等間隔グリッド */
  eps: Float64Array;
  /** 応力 [MPa] */
  sig: Float64Array;
  n: number;
}

/** 曲線サンプルのひずみ刻み(歯のピークがなまらない細かさ) */
const CURVE_DEPS = 2e-5;

/** 曲線生成用の既定シード */
export const CURVE_SEED = 41219;

/**
 * 焼なまし軟鋼の応力ひずみ曲線(記事仕様 §5.1 の区分定義)。
 * 弾性 → 上降伏点 270 → 下降伏点 240 へ短い遷移 → 降伏伸び 2.5% の
 * プラトー(±3 MPa のゆらぎ) → 加工硬化。
 */
export function buildMildSteelCurve(seed: number = CURVE_SEED): Curve {
  const jitter = plateauJitter(seed);
  const n = Math.floor(EPS_MAX / CURVE_DEPS) + 1;
  const eps = new Float64Array(n);
  const sig = new Float64Array(n);
  const toothEnd = STEEL_EPS_UPPER + STEEL_TOOTH_WIDTH;
  for (let i = 0; i < n; i++) {
    const e = i * CURVE_DEPS;
    eps[i] = e;
    if (e <= STEEL_EPS_UPPER) {
      sig[i] = STEEL_E_MPA * e;
    } else if (e <= toothEnd) {
      // 上→下降伏の短い遷移(滑らかに降下)
      const t = (e - STEEL_EPS_UPPER) / STEEL_TOOTH_WIDTH;
      const s = t * t * (3 - 2 * t);
      sig[i] = STEEL_SIGMA_UPPER - (STEEL_SIGMA_UPPER - STEEL_SIGMA_LOWER) * s;
    } else if (e <= STEEL_PLATEAU_END) {
      sig[i] = STEEL_SIGMA_LOWER + jitter(e - toothEnd);
    } else {
      sig[i] = steelHardeningStress(e);
    }
  }
  return { eps, sig, n };
}

/**
 * アルミニウム合金の応力ひずみ曲線(Ramberg–Osgood 型・歯なし — §5.1)。
 * ε(σ) = σ/E + 0.002 (σ/σ0.2)^m を二分法で反転し、等間隔 ε グリッドに乗せる。
 */
export function buildAluminumCurve(): Curve {
  const n = Math.floor(EPS_MAX / CURVE_DEPS) + 1;
  const eps = new Float64Array(n);
  const sig = new Float64Array(n);
  const strainOf = (s: number): number =>
    s / AL_E_MPA + 0.002 * Math.pow(s / AL_SIGMA02, AL_RO_EXP);
  let hi = AL_SIGMA02;
  while (strainOf(hi) < EPS_MAX) hi *= 1.5;
  for (let i = 0; i < n; i++) {
    const e = i * CURVE_DEPS;
    eps[i] = e;
    let lo = 0;
    let up = hi;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + up) / 2;
      if (strainOf(mid) < e) lo = mid;
      else up = mid;
    }
    sig[i] = (lo + up) / 2;
  }
  return { eps, sig, n };
}

/* ------------------------------------------------------ プロット描画 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlotLayout extends Rect {
  epsMax: number;
  sigMax: number;
}

/** 軸ラベル用の余白 */
const PLOT_ML = 46;
const PLOT_MR = 8;
const PLOT_MT = 10;
const PLOT_MB = 34;

/** 外枠 rect から軸余白を除いたプロット領域を計算する */
export function computePlotLayout(
  rect: Rect,
  epsMax: number = EPS_MAX,
  sigMax = 450,
): PlotLayout {
  return {
    x: rect.x + PLOT_ML,
    y: rect.y + PLOT_MT,
    w: Math.max(10, rect.w - PLOT_ML - PLOT_MR),
    h: Math.max(10, rect.h - PLOT_MT - PLOT_MB),
    epsMax,
    sigMax,
  };
}

export function plotX(l: PlotLayout, eps: number): number {
  return l.x + (eps / l.epsMax) * l.w;
}

export function plotY(l: PlotLayout, sig: number): number {
  return l.y + l.h - (sig / l.sigMax) * l.h;
}

export interface PlotFrameColors {
  hairline: string;
  label: string;
}

/**
 * σ–ε プロットの軸・目盛り・ラベルを描く(図1 と同スタイル — §5.7)。
 * 目盛り: ε は 5% 刻み、σ は 100 MPa 刻み。
 */
export function drawPlotFrame(
  ctx: CanvasRenderingContext2D,
  l: PlotLayout,
  colors: PlotFrameColors,
): void {
  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1;
  ctx.strokeRect(l.x + 0.5, l.y + 0.5, l.w, l.h);

  ctx.fillStyle = colors.label;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const epsStepPct = l.epsMax > 0.06 ? 5 : 1;
  for (let pct = 0; pct <= l.epsMax * 100 + 1e-9; pct += epsStepPct) {
    const x = plotX(l, pct / 100);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, l.y + l.h);
    ctx.lineTo(x + 0.5, l.y + l.h + 4);
    ctx.stroke();
    ctx.fillText(String(pct), x, l.y + l.h + 7);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let s = 0; s <= l.sigMax; s += 100) {
    const y = plotY(l, s);
    ctx.beginPath();
    ctx.moveTo(l.x - 4, y + 0.5);
    ctx.lineTo(l.x, y + 0.5);
    ctx.stroke();
    ctx.fillText(String(s), l.x - 7, y);
  }
  // 軸タイトル
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "13px sans-serif";
  ctx.fillText("ひずみ ε [%]", l.x + l.w / 2, l.y + l.h + 30);
  ctx.save();
  ctx.translate(l.x - 34, l.y + l.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("応力 σ [MPa]", 0, 0);
  ctx.restore();
}

/**
 * 等間隔 ε グリッドの曲線を、maxEps まで(進行度クリップ)描く。
 * maxEps を省略すると全体を描く。
 */
export function drawCurve(
  ctx: CanvasRenderingContext2D,
  l: PlotLayout,
  curve: Curve,
  color: string,
  lineWidth = 2,
  maxEps: number = Infinity,
): void {
  const { eps, sig, n } = curve;
  if (n === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(plotX(l, eps[0]), plotY(l, sig[0]));
  for (let i = 1; i < n; i++) {
    if (eps[i] > maxEps) {
      // 最後の区間は maxEps ちょうどまで補間して途切れなく見せる
      const t = (maxEps - eps[i - 1]) / (eps[i] - eps[i - 1]);
      const s = sig[i - 1] + (sig[i] - sig[i - 1]) * t;
      ctx.lineTo(plotX(l, maxEps), plotY(l, s));
      break;
    }
    ctx.lineTo(plotX(l, eps[i]), plotY(l, sig[i]));
  }
  ctx.stroke();
}

/** 等間隔 ε グリッド曲線の maxEps における応力(線形補間) */
export function curveStressAt(curve: Curve, eps: number): number {
  const { eps: xs, sig, n } = curve;
  if (n === 0) return 0;
  if (eps <= xs[0]) return sig[0];
  if (eps >= xs[n - 1]) return sig[n - 1];
  const step = xs[1] - xs[0];
  const i = Math.min(n - 2, Math.floor(eps / step));
  const t = (eps - xs[i]) / step;
  return sig[i] + (sig[i + 1] - sig[i]) * t;
}

/** 現在点マーカー(塗り円) */
export function drawPlotMarker(
  ctx: CanvasRenderingContext2D,
  l: PlotLayout,
  eps: number,
  sig: number,
  color: string,
  radius = 4,
): void {
  ctx.beginPath();
  ctx.arc(plotX(l, eps), plotY(l, sig), radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/* ------------------------------------------------------ 試験片の描画 */

/** 伸びの表示誇張率(15% のひずみでも変形が読み取れるように) */
export const ELONGATION_EXAG = 2.5;

/** 斜線ハッチ(降伏済み領域のテクスチャ — §5.1, §5.7) */
export function fillHatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lineColor: string,
  spacing = 6,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -h; d < w; d += spacing) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

export interface SpecimenColors {
  /** 輪郭 */
  outline: string;
  /** つかみ部の塗り */
  grip: string;
  /** 降伏済み領域の塗り(--mat-tension) */
  yielded: string;
  /** ハッチ線 */
  hatch: string;
}

export interface SpecimenState {
  /** 公称ひずみ(0〜0.15) */
  strain: number;
  /** 平行部の降伏済み区間(0 = 下端、1 = 上端)。省略時は塗りなし */
  yieldedFrom?: number;
  yieldedTo?: number;
}

/**
 * ダンベル形試験片を縦向きに描く(記事仕様 §5.1)。つかみ部が上下に動き、
 * 平行部が伸びに応じて長くなる(表示は ELONGATION_EXAG 倍に誇張)。
 * 降伏済み領域は薄い引張色 + 細かい斜線テクスチャで示す。
 */
export function drawSpecimen(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: SpecimenState,
  colors: SpecimenColors,
): void {
  const cx = rect.x + rect.w / 2;
  // ε = ε_max でも rect に収まる基準寸法
  const growth = 1 + EPS_MAX * ELONGATION_EXAG;
  const gaugeLen0 = (rect.h * 0.52) / growth;
  const gripH = rect.h * 0.1;
  const filletH = rect.h * 0.055;
  const gaugeW = Math.min(rect.w * 0.3, rect.h * 0.13);
  const gripW = gaugeW * 2.1;

  const gaugeLen = gaugeLen0 * (1 + state.strain * ELONGATION_EXAG);
  const cy = rect.y + rect.h / 2;
  const gTop = cy - gaugeLen / 2; // 平行部上端
  const gBot = cy + gaugeLen / 2;

  // 輪郭パス(上つかみ → 右肩 → 平行部 → 下つかみ → 左側を戻る)
  const path = new Path2D();
  path.moveTo(cx - gripW / 2, gTop - filletH - gripH);
  path.lineTo(cx + gripW / 2, gTop - filletH - gripH);
  path.lineTo(cx + gripW / 2, gTop - filletH);
  path.quadraticCurveTo(
    cx + gaugeW / 2,
    gTop - filletH * 0.15,
    cx + gaugeW / 2,
    gTop,
  );
  path.lineTo(cx + gaugeW / 2, gBot);
  path.quadraticCurveTo(
    cx + gaugeW / 2,
    gBot + filletH * 0.85,
    cx + gripW / 2,
    gBot + filletH,
  );
  path.lineTo(cx + gripW / 2, gBot + filletH + gripH);
  path.lineTo(cx - gripW / 2, gBot + filletH + gripH);
  path.lineTo(cx - gripW / 2, gBot + filletH);
  path.quadraticCurveTo(
    cx - gaugeW / 2,
    gBot + filletH * 0.85,
    cx - gaugeW / 2,
    gBot,
  );
  path.lineTo(cx - gaugeW / 2, gTop);
  path.quadraticCurveTo(
    cx - gaugeW / 2,
    gTop - filletH * 0.15,
    cx - gripW / 2,
    gTop - filletH,
  );
  path.closePath();

  // 降伏済み領域(平行部の [from, to] 区間。0 = 下端)
  const from = state.yieldedFrom ?? 0;
  const to = state.yieldedTo ?? 0;
  if (to > from) {
    const yLo = gBot - gaugeLen * from; // 下端側
    const yHi = gBot - gaugeLen * to;
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = colors.yielded;
    ctx.fillRect(cx - gaugeW / 2, yHi, gaugeW, yLo - yHi);
    fillHatch(ctx, cx - gaugeW / 2, yHi, gaugeW, yLo - yHi, colors.hatch);
    ctx.restore();
  }

  // つかみ部の塗り
  ctx.fillStyle = colors.grip;
  ctx.fillRect(cx - gripW / 2, gTop - filletH - gripH, gripW, gripH);
  ctx.fillRect(cx - gripW / 2, gBot + filletH, gripW, gripH);

  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke(path);
}
