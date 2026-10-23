/**
 * ldos-not-atoms.ts — 図6「何を見ているのか — 原子ではなく状態密度」(仕様書 14 §5.6)
 *
 * 左(狭幅では上): エネルギーの図。探針(金属: フェルミ準位まで詰まった帯)と
 *   試料(A 原子の詰まった状態が E_F の 1.0 eV 下、B 原子の空いた状態が 1.2 eV 上
 *   — 幅 0.3 eV のガウス型の山)を、すき間の壁を挟んで並べる。バイアス V で
 *   試料側全体が −qV だけ上下し、探針と試料のフェルミ準位の間(バイアスの窓)を
 *   --mat-beam の薄い帯で示す。窓に入った状態の山だけが濃くなる。
 * 右(狭幅では下): その条件での定電流像(図5 と同じ模型・同じ描き方。走査の
 *   アニメーションはなく一度に計算する)。A 原子(--mat-matrix)と B 原子
 *   (--mat-second)の本当の位置を小さな印で重ねる。
 *
 * 重み w(lib/stm.ts の windowWeights)= 窓に入る状態の山の面積。原子の位置は
 * 動かさない — 動くのは重み(状態)だけ、というのがこの図の主張(T7)。
 * GaAs(110) 面の実例(負のバイアスで As、正で Ga が見える)を、2 種類の原子の
 * 市松模様の正方格子として模式化した(実際の表面は斜方格子で、原子は面内でずれる)。
 *
 * 実装方式: requestRender。像の計算はバイアスを変えたときだけ。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout, drawArrow } from "../reciprocal-lattice/_shared2d";
import { MAT_COLORS, UI_COLORS } from "../../core/colors";
import { font, fmtSig } from "../../core/plot";
import { IMAGE_PIXELS, IMAGE_SIZE_NM } from "./lib/constants";
import {
  drawDivider,
  haloText,
  ownLine,
  parseHex,
  rect,
  resolvePalette,
  setRect,
  splitTwo,
  tooSmall,
  type Rect,
} from "./lib/draw";
import {
  AB_SPACING_NM,
  computeConstantCurrentImage,
  createSurface,
  STATE_A_EV,
  STATE_B_EV,
  STATE_WIDTH_EV,
  windowWeights,
  type WindowWeights,
} from "./lib/stm";

/** バイアスのスライダー(§5.6)。|V| < 0.3 V は窓がほぼ空なので飛ばす */
const BIAS_MIN = -2;
const BIAS_MAX = 2;
const BIAS_STEP = 0.05;
const BIAS_INIT = -1.5;
const BIAS_SKIP = 0.3;
/** エネルギーの図の縦の範囲 [eV](探針のフェルミ準位が 0) */
const E_LOW = -4;
const E_HIGH = 4;
/** 状態の山の横幅の最大(エネルギーの図の試料の領域に対する割合) */
const PEAK_WIDTH_FRACTION = 0.42;
/** 原子の印の半径(px) */
const MARK_R = 3.2;

export default function ldosNotAtoms(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const [bgR, bgG, bgB] = parseHex(
    pal.bg,
    parseHex(UI_COLORS.bg, [255, 255, 255]),
  );
  const [mR, mG, mB] = parseHex(
    pal.matrix,
    parseHex(MAT_COLORS.matrix, [154, 167, 184]),
  );

  /* ---- 状態 ---- */
  let bias = BIAS_INIT;
  let lastBias = BIAS_INIT;
  let showAtoms = true;
  const surface = createSurface(AB_SPACING_NM, { checkerboard: true });
  const weights: WindowWeights = { a: 0, b: 0 };
  const N = IMAGE_PIXELS;
  const heights = new Float64Array(N * N);
  const off = document.createElement("canvas");
  off.width = N;
  off.height = N;
  const offCtx = off.getContext("2d");
  const imageData = offCtx ? offCtx.createImageData(N, N) : null;

  /** バイアスを変えたときだけ像を計算し直す */
  function recompute(): void {
    windowWeights(bias, weights);
    surface.kindWeight[0] = weights.a;
    surface.kindWeight[1] = weights.b;
    computeConstantCurrentImage(surface, heights, N, IMAGE_SIZE_NM);
    if (imageData && offCtx) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < N * N; i++) {
        if (heights[i] < lo) lo = heights[i];
        if (heights[i] > hi) hi = heights[i];
      }
      const span = hi - lo > 1e-6 ? hi - lo : 1e-6;
      const data = imageData.data;
      for (let i = 0; i < N * N; i++) {
        const t = (heights[i] - lo) / span;
        const o = i * 4;
        data[o] = bgR + (mR - bgR) * t;
        data[o + 1] = bgG + (mG - bgG) * t;
        data[o + 2] = bgB + (mB - bgB) * t;
        data[o + 3] = 255;
      }
      offCtx.putImageData(imageData, 0, 0);
    }
    updateReadouts();
  }

  /* ---- レイアウト ---- */
  const energy: Rect = rect();
  const image: Rect = rect();
  const square: Rect = rect();
  let stacked = false;

  function layout(): void {
    const { w, h } = host.size;
    stacked = splitTwo(w, h, 0.4, 0.44, 14, energy, image);
    const labelTop = 24;
    const labelBottom = 14;
    const s = Math.max(
      10,
      Math.min(image.w - 20, image.h - labelTop - labelBottom),
    );
    setRect(
      square,
      image.x + (image.w - s) / 2,
      image.y + labelTop + (image.h - labelTop - labelBottom - s) / 2,
      s,
      s,
    );
  }

  /* ---------------------------------------------------- エネルギーの図 */

  function drawEnergy(): void {
    const r = energy;
    const top = r.y + 30;
    const bottom = r.y + r.h - 12;
    const ey = (e: number): number =>
      bottom - ((e - E_LOW) / (E_HIGH - E_LOW)) * (bottom - top);
    const tipX0 = r.x + 8;
    const tipX1 = r.x + r.w * 0.26;
    const gapX1 = r.x + r.w * 0.42;
    const sampleX0 = gapX1;
    const sampleX1 = r.x + r.w - 6;
    const efTip = 0;
    const efSample = -bias; // 試料の電子のエネルギーは −qV だけずれる

    // バイアスの窓(2 つのフェルミ準位の間)
    const wTop = ey(Math.max(efTip, efSample));
    const wBot = ey(Math.min(efTip, efSample));
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = pal.beam;
    ctx.fillRect(tipX0, wTop, sampleX1 - tipX0, wBot - wTop);
    ctx.globalAlpha = 1;

    // 探針: 金属の帯(フェルミ準位まで電子で詰まっている)
    ctx.fillStyle = pal.band;
    ctx.fillRect(tipX0, top, tipX1 - tipX0, bottom - top);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = pal.electron;
    ctx.fillRect(tipX0, ey(efTip), tipX1 - tipX0, bottom - ey(efTip));
    ctx.globalAlpha = 1;

    // すき間の壁(真空。高さは仕事関数 ≈ 4.5 eV で、この図の上端より高い)
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = pal.matrix;
    ctx.fillRect(tipX1, top, gapX1 - tipX1, bottom - top);
    ctx.globalAlpha = 1;

    // 試料の状態の山(横向きのガウス型)
    const peakW = (sampleX1 - sampleX0) * PEAK_WIDTH_FRACTION;
    drawPeak(
      sampleX0,
      peakW,
      efSample + STATE_A_EV,
      ey,
      pal.matrix,
      pal.matrixEdge,
      efSample,
      efTip,
      true,
    );
    drawPeak(
      sampleX0,
      peakW,
      efSample + STATE_B_EV,
      ey,
      pal.second,
      pal.secondEdge,
      efSample,
      efTip,
      false,
    );

    // フェルミ準位
    ctx.strokeStyle = pal.level;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(tipX0, ey(efTip));
    ctx.lineTo(tipX1, ey(efTip));
    ctx.moveTo(sampleX0, ey(efSample));
    ctx.lineTo(sampleX1, ey(efSample));
    ctx.stroke();
    ctx.setLineDash([]);

    // 電子の流れ(窓の真ん中の高さで、すき間を横切る)
    const ym = (wTop + wBot) / 2;
    const leftward = bias < 0; // 試料が負: 試料 → 探針
    drawArrow(
      ctx,
      leftward ? gapX1 + 6 : tipX1 - 6,
      ym,
      leftward ? tipX1 - 6 : gapX1 + 6,
      ym,
      { color: pal.beam, width: 2.6, head: 9 },
    );

    // ラベル
    ctx.font = font(12);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    haloText(ctx, "探針", tipX0, r.y + 8, pal.text2, pal.bg);
    ctx.textAlign = "center";
    haloText(ctx, "すき間", (tipX1 + gapX1) / 2, r.y + 8, pal.text2, pal.bg);
    ctx.textAlign = "right";
    haloText(ctx, "試料", sampleX1, r.y + 8, pal.text2, pal.bg);
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    haloText(ctx, "E_F", tipX0 + 2, ey(efTip) - 2, pal.level, pal.bg);
    ctx.textAlign = "right";
    haloText(ctx, "E_F", sampleX1, ey(efSample) - 2, pal.level, pal.bg);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // 山の先端(いちばん横に張り出したところ)のすぐ右に書く
    const lx = sampleX0 + peakW + 5;
    haloText(
      ctx,
      "A の詰まった状態",
      lx,
      ey(efSample + STATE_A_EV),
      pal.text,
      pal.bg,
    );
    haloText(
      ctx,
      "B の空いた状態",
      lx,
      ey(efSample + STATE_B_EV),
      pal.text,
      pal.bg,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    haloText(ctx, "電子", (tipX1 + gapX1) / 2, ym - 7, pal.beamInk, pal.bg);
  }

  /**
   * 状態の山を 1 つ描く。窓 [min(E_F,s, E_F,tip), max(…)] に入る部分を濃く塗る。
   * occupied = true は詰まった状態(塗り)、false は空いた状態(薄い塗り + 輪郭)。
   */
  function drawPeak(
    x0: number,
    maxW: number,
    center: number,
    ey: (e: number) => number,
    fill: string,
    edge: string,
    efSample: number,
    efTip: number,
    occupied: boolean,
  ): void {
    const span = 3.2 * STATE_WIDTH_EV;
    const steps = 48;
    const wLo = Math.min(efSample, efTip);
    const wHi = Math.max(efSample, efTip);
    const shape = (e: number): number =>
      Math.exp(-0.5 * ((e - center) / STATE_WIDTH_EV) ** 2);
    // 全体(薄く)
    ctx.beginPath();
    ctx.moveTo(x0, ey(center - span));
    for (let i = 0; i <= steps; i++) {
      const e = center - span + (2 * span * i) / steps;
      ctx.lineTo(x0 + maxW * shape(e), ey(e));
    }
    ctx.lineTo(x0, ey(center + span));
    ctx.closePath();
    ctx.globalAlpha = occupied ? 0.4 : 0.14;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 窓に入る部分(濃く)
    const a = Math.max(wLo, center - span);
    const b = Math.min(wHi, center + span);
    if (b > a) {
      ctx.beginPath();
      ctx.moveTo(x0, ey(a));
      for (let i = 0; i <= steps; i++) {
        const e = a + ((b - a) * i) / steps;
        ctx.lineTo(x0 + maxW * shape(e), ey(e));
      }
      ctx.lineTo(x0, ey(b));
      ctx.closePath();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------- 定電流像 */

  function drawImagePanel(): void {
    const q = square;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (offCtx) ctx.drawImage(off, q.x, q.y, q.w, q.h);
    ctx.restore();
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(q.x - 0.5, q.y - 0.5, q.w + 1, q.h + 1);

    if (showAtoms) {
      const s = surface;
      const k = q.w / IMAGE_SIZE_NM;
      ctx.lineWidth = 1.2;
      for (const kind of [0, 1] as const) {
        ctx.beginPath();
        for (let i = 0; i <= s.cells; i++) {
          for (let j = 0; j <= s.cells; j++) {
            if ((i + j) % 2 !== kind) continue;
            const x = s.offset + i * s.spacing;
            const y = s.offset + j * s.spacing;
            if (x < 0.02 || x > IMAGE_SIZE_NM - 0.02) continue;
            if (y < 0.02 || y > IMAGE_SIZE_NM - 0.02) continue;
            const px = q.x + x * k;
            const py = q.y + (IMAGE_SIZE_NM - y) * k;
            ctx.moveTo(px + MARK_R, py);
            ctx.arc(px, py, MARK_R, 0, Math.PI * 2);
          }
        }
        ctx.fillStyle = kind === 0 ? pal.matrix : pal.second;
        ctx.fill();
        ctx.strokeStyle = pal.bg;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.strokeStyle = kind === 0 ? pal.matrixEdge : pal.secondEdge;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // ラベルと凡例
    ctx.font = font(12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("定電流像(高いところほど濃い)", q.x, q.y - 6);
    if (showAtoms) {
      const ly = q.y - 6;
      ctx.textAlign = "right";
      const tb = "B 原子";
      const ta = "A 原子";
      const xb = q.x + q.w;
      ctx.fillText(tb, xb, ly);
      const wb = ctx.measureText(tb).width;
      dot(xb - wb - 8, ly - 7, pal.second, pal.secondEdge);
      const xa = xb - wb - 20;
      ctx.fillText(ta, xa, ly);
      const wa = ctx.measureText(ta).width;
      dot(xa - wa - 8, ly - 7, pal.matrix, pal.matrixEdge);
    }
  }

  function dot(x: number, y: number, fill: string, edge: string): void {
    ctx.beginPath();
    ctx.arc(x, y, MARK_R + 0.5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = pal.text2;
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    layout();
    drawEnergy();
    drawDivider(ctx, energy, image, stacked, pal.hairline);
    drawImagePanel();
  }

  /* ---- 読み取り値 ---- */
  const readout = createReadout(host);
  const seenItem = readout.item("見えている状態");
  const windowItem = readout.item("窓に入っている状態");
  // バイアスの符号で上の文の長さが変わっても折り返しが変わらないよう、
  // いつも自分の行に置く(スライダーの操作中に操作部品が動かないように)
  ownLine(windowItem.el);

  function updateReadouts(): void {
    seenItem.set(
      bias < 0 ? "試料の詰まった状態(A 原子)" : "試料の空いた状態(B 原子)",
    );
    windowItem.set(
      `A ${fmtSig(weights.a * 100, 2)}%・B ${fmtSig(weights.b * 100, 2)}%`,
    );
  }

  /* ---- 操作部品 ---- */
  const biasSlider = host.controls.slider({
    id: "bias",
    label: "バイアス(試料の電圧)",
    min: BIAS_MIN,
    max: BIAS_MAX,
    step: BIAS_STEP,
    value: BIAS_INIT,
    unit: "V",
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`,
  });
  biasSlider.onChange((v) => {
    if (Math.abs(v) < BIAS_SKIP - 1e-9) {
      // 窓がほぼ空になる |V| < 0.3 V は飛ばす。キーボードの 1 刻みなら反対側へ、
      // それより大きく動かしたら(クリック・ドラッグ)近い側の端へ
      const oneStep = Math.abs(v - lastBias) <= BIAS_STEP + 1e-9;
      let target: number;
      if (oneStep || v === 0) target = lastBias > 0 ? -BIAS_SKIP : BIAS_SKIP;
      else target = v > 0 ? BIAS_SKIP : -BIAS_SKIP;
      biasSlider.set(target);
      return;
    }
    bias = v;
    lastBias = v;
    recompute();
  });
  const atomsToggle = host.controls.toggle({
    id: "atoms",
    label: "原子の位置を表示",
    value: true,
  });
  atomsToggle.onChange((v) => {
    showAtoms = v;
  });
  host.controls.reset(() => {
    biasSlider.set(BIAS_INIT);
    atomsToggle.set(true);
    showAtoms = true;
    if (bias !== BIAS_INIT) {
      bias = BIAS_INIT;
      lastBias = BIAS_INIT;
      recompute();
    }
  });

  recompute();
  host.onRender(draw);

  return {
    resize(): void {
      layout();
    },
    destroy(): void {
      readout.el.remove();
    },
  };
}
