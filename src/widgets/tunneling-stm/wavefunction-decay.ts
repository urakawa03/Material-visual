/**
 * wavefunction-decay.ts — 図2「壁の中で減っていく波」(仕様書 14 §5.2)
 *
 * 上段: ポテンシャルの形(高さ V・厚さ d の壁)と電子のエネルギー E の線。
 * 下段: 矩形障壁の定常解(lib/tunneling.ts の solveBarrier / evalWave)。
 *   確率密度 |ψ|² を塗りで主に描き、「波の形も表示」で Re ψ を細線で重ねる
 *   (ψ そのものは観測量ではない — 波の形を見るための補助)。
 *   壁の中に、減っていく成分の包絡線 |α|²e^{−2κx}(|ψ|² は ψ の 2 乗なので
 *   ψ ∝ e^{−κx} の 2 倍の速さで減る)を破線で重ね、減衰長 1/κ の寸法線を付ける。
 *   壁の右側は小さすぎて見えないことが多いので、10 の冪の倍率で拡大して
 *   描き、倍率を必ず書く(黙って拡大しない)。読み取りの T は倍率に関係しない。
 *
 * 実装方式: requestRender(操作したときだけ描き直す)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawPlotFrame,
  setPlotRange,
  withPlotClip,
  bandColors,
  type AxisTick,
} from "../_shared/banddiagram";
import { font, fmtSig } from "../../core/plot";
import { PM_PER_NM } from "./lib/constants";
import {
  dimensionLine,
  fmtFromLog10,
  haloText,
  resolvePalette,
  tooSmall,
} from "./lib/draw";
import {
  decayingAmplitude,
  evalWave,
  insideWavenumber,
  kappa,
  logTransmission,
  solveBarrier,
  type BarrierSolution,
  type Complex,
} from "./lib/tunneling";

/** スライダー(§5.2 の表) */
const V_MIN = 1;
const V_MAX = 8;
const V_STEP = 0.1;
const V_INIT = 5;
const E_MIN = 0.2;
const E_MAX = 6;
const E_STEP = 0.1;
const E_INIT = 1;
const D_MIN = 0.1;
const D_MAX = 1.5;
const D_STEP = 0.02;
const D_INIT = 0.4;

/** 壁の手前と後ろに表示する長さ [nm] */
const SIDE_NM = 2;
/** 上段のエネルギー軸の上限 [eV] */
const ENERGY_AXIS_MAX = 8.6;
/** 下段の |ψ|² 軸の上限(入射波 1 を基準。反射が強いと最大 4 になる) */
const DENSITY_AXIS_MAX = 4.4;
/** Re ψ を重ねるときの下段の下限(Re ψ は −2〜2) */
const WAVE_AXIS_MIN = -2.3;
/** 曲線のサンプル点数 */
const SAMPLES = 600;

/** 余白(CSS px) */
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 14;
const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 40;
const ROW_GAP = 16;
const TOP_FRACTION = 0.36;

const ENERGY_TICKS: readonly AxisTick[] = [0, 2, 4, 6, 8].map((v) => ({
  value: v,
  label: String(v),
}));
const DENSITY_TICKS: readonly AxisTick[] = [0, 1, 2, 3, 4].map((v) => ({
  value: v,
  label: String(v),
}));

/** 壁の右側の拡大倍率(10 の冪)。T·倍率 が 1 前後になるように選ぶ */
function magnification(T: number): number {
  if (!(T > 0) || T > 0.3) return 1;
  const e = Math.round(Math.log10(1 / T));
  return e > 0 ? 10 ** e : 1;
}

export default function wavefunctionDecay(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const colors = bandColors();
  const topMap = createPlotMapper();
  const botMap = createPlotMapper();

  /* ---- 状態 ---- */
  let V = V_INIT;
  let E = E_INIT;
  let d = D_INIT;
  let showWave = false;
  let sol: BarrierSolution = solveBarrier(E, V, d);

  /* ---- 使い回すバッファ ---- */
  const xs = new Float64Array(SAMPLES);
  const dens = new Float64Array(SAMPLES);
  const reals = new Float64Array(SAMPLES);
  const psi: Complex = { re: 0, im: 0 };

  function recompute(): void {
    sol = solveBarrier(E, V, d);
    const x0 = -SIDE_NM;
    const x1 = d + SIDE_NM;
    for (let i = 0; i < SAMPLES; i++) {
      const x = x0 + ((x1 - x0) * i) / (SAMPLES - 1);
      xs[i] = x;
      evalWave(sol, x, psi);
      dens[i] = psi.re * psi.re + psi.im * psi.im;
      reals[i] = psi.re;
    }
    updateReadouts();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;

    const plotW = w - MARGIN_LEFT - MARGIN_RIGHT;
    const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
    const topH = Math.round((plotH - ROW_GAP) * TOP_FRACTION);
    const botY = MARGIN_TOP + topH + ROW_GAP;
    const botH = plotH - topH - ROW_GAP;
    const x0 = -SIDE_NM;
    const x1 = d + SIDE_NM;
    setPlotRange(
      topMap,
      MARGIN_LEFT,
      MARGIN_TOP,
      plotW,
      topH,
      x0,
      x1,
      0,
      ENERGY_AXIS_MAX,
    );
    const yMin = showWave ? WAVE_AXIS_MIN : 0;
    setPlotRange(
      botMap,
      MARGIN_LEFT,
      botY,
      plotW,
      botH,
      x0,
      x1,
      yMin,
      DENSITY_AXIS_MAX,
    );

    drawTop();
    drawBottom();
  }

  function drawTop(): void {
    const m = topMap;
    drawPlotFrame(ctx, m, { colors, yTicks: ENERGY_TICKS });
    // 壁
    const wx0 = m.toPxX(0);
    const wx1 = m.toPxX(d);
    const wy = m.toPxY(V);
    const base = m.toPxY(0);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = pal.matrix;
    ctx.fillRect(wx0, wy, wx1 - wx0, base - wy);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.matrixEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wx0, wy, wx1 - wx0, base - wy);
    // エネルギー E の線
    const ey = m.toPxY(E);
    ctx.strokeStyle = pal.level;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(m.rect.x, ey);
    ctx.lineTo(m.rect.x + m.rect.w, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    // ラベル
    ctx.font = font(12);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    haloText(
      ctx,
      `電子のエネルギー E = ${E.toFixed(1)} eV`,
      m.rect.x + 4,
      ey - 3,
      pal.level,
      pal.bg,
    );
    ctx.textAlign = "center";
    haloText(
      ctx,
      `壁 V = ${V.toFixed(1)} eV`,
      (wx0 + wx1) / 2,
      wy - 3,
      pal.text2,
      pal.bg,
    );
    // 縦軸の名前
    ctx.save();
    ctx.translate(14, m.rect.y + m.rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = pal.text2;
    ctx.fillText("エネルギー [eV]", 0, 0);
    ctx.restore();
  }

  function drawBottom(): void {
    const m = botMap;
    const T = sol.T;
    const mag = magnification(T);
    const base = m.toPxY(0);
    const wx0 = m.toPxX(0);
    const wx1 = m.toPxX(d);

    // 枠と目盛り(横軸は位置)
    drawPlotFrame(ctx, m, {
      colors,
      yTicks: DENSITY_TICKS,
      xTicks: xTicks(),
    });
    // 壁の範囲を薄く示す
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = pal.matrix;
    ctx.fillRect(wx0, m.rect.y, wx1 - wx0, m.rect.h);
    ctx.globalAlpha = 1;
    if (showWave) {
      ctx.strokeStyle = pal.ghost;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.rect.x, base + 0.5);
      ctx.lineTo(m.rect.x + m.rect.w, base + 0.5);
      ctx.stroke();
    }

    withPlotClip(ctx, m, () => {
      // |ψ|² の塗り(壁の右側だけ mag 倍)
      ctx.beginPath();
      ctx.moveTo(m.toPxX(xs[0]), base);
      for (let i = 0; i < SAMPLES; i++) {
        const k = xs[i] > d ? mag : 1;
        ctx.lineTo(m.toPxX(xs[i]), m.toPxY(dens[i] * k));
      }
      ctx.lineTo(m.toPxX(xs[SAMPLES - 1]), base);
      ctx.closePath();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = pal.electron;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 0; i < SAMPLES; i++) {
        const k = xs[i] > d ? mag : 1;
        const X = m.toPxX(xs[i]);
        const Y = m.toPxY(dens[i] * k);
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = pal.electron;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Re ψ(補助の細線。壁の右側は |ψ|² と同じく √倍率 で拡大)
      if (showWave) {
        const kw = Math.sqrt(mag);
        ctx.beginPath();
        for (let i = 0; i < SAMPLES; i++) {
          const k = xs[i] > d ? kw : 1;
          const X = m.toPxX(xs[i]);
          const Y = m.toPxY(reals[i] * k);
          if (i === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
        ctx.strokeStyle = pal.electron;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 壁の中の包絡線 |α|² e^{−2κx}(E < V のとき)
      if (sol.q > 0) {
        const k = sol.root;
        const a2 = decayingAmplitude(sol) ** 2;
        ctx.beginPath();
        const n = 60;
        for (let i = 0; i <= n; i++) {
          const x = (d * i) / n;
          const X = m.toPxX(x);
          const Y = m.toPxY(a2 * Math.exp(-2 * k * x));
          if (i === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
        ctx.strokeStyle = pal.level;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // 拡大した領域の境とラベル
    ctx.font = font(12);
    if (mag > 1) {
      ctx.strokeStyle = pal.ghost;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(wx1 + 0.5, m.rect.y);
      ctx.lineTo(wx1 + 0.5, m.rect.y + m.rect.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      haloText(
        ctx,
        `壁の右側 ×${fmtMag(mag)}`,
        m.rect.x + m.rect.w - 4,
        m.rect.y + 4,
        pal.electron,
        pal.bg,
      );
    }
    // 右側の高さ(= T)のラベル
    const yRight = m.toPxY(Math.min(T * mag, DENSITY_AXIS_MAX));
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    haloText(
      ctx,
      `|ψ|² = T = ${fmtT(T)}`,
      m.rect.x + m.rect.w - 4,
      Math.max(m.rect.y + 34, yRight - 4),
      pal.electron,
      pal.bg,
    );

    // 減衰長 1/κ の寸法線(壁の中)
    if (sol.q > 0) {
      const len = 1 / sol.root;
      const yDim = m.toPxY(Math.min(DENSITY_AXIS_MAX * 0.78, 3.4));
      const xa = wx0;
      const xb = m.toPxX(Math.min(len, d + SIDE_NM));
      dimensionLine(
        ctx,
        xa,
        xb,
        yDim,
        `1/κ = ${fmtSig(len * PM_PER_NM, 2)} pm`,
        pal.text2,
        pal.bg,
      );
      ctx.font = font(11);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      haloText(ctx, "破線: e^(−2κx)", xa + 2, yDim + 6, pal.level, pal.bg);
    } else {
      ctx.font = font(12);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      haloText(
        ctx,
        "壁の中でも振動する",
        (wx0 + wx1) / 2,
        m.rect.y + 4,
        pal.text2,
        pal.bg,
      );
    }

    // 縦軸の名前・横軸の名前
    ctx.font = font(12);
    ctx.save();
    ctx.translate(14, m.rect.y + m.rect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = pal.text2;
    ctx.fillText(showWave ? "|ψ|²(塗り)・Re ψ(細線)" : "確率の濃さ |ψ|²", 0, 0);
    ctx.restore();
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = pal.text2;
    ctx.font = font(11);
    ctx.fillText(
      "位置 x [nm](壁は 0〜d)",
      m.rect.x + m.rect.w,
      m.rect.y + m.rect.h + 20,
    );
  }

  /** 横軸の目盛り(0・d と、きりのよい位置) */
  const tickBuf: AxisTick[] = [];
  function xTicks(): AxisTick[] {
    tickBuf.length = 0;
    for (let x = -2; x <= d + SIDE_NM + 1e-9; x += 1) {
      tickBuf.push({ value: x, label: x === 0 ? "0" : String(x) });
    }
    return tickBuf;
  }

  function fmtMag(m: number): string {
    return m < 1e5 ? String(m) : fmtFromLog10(Math.log10(m));
  }

  function fmtT(T: number): string {
    return T >= 0.01
      ? fmtSig(T, 2)
      : fmtFromLog10(logTransmission(E, V, d) / Math.LN10);
  }

  /* ---- 読み取り値 ---- */
  const readout = createReadout(host);
  const kItem = readout.item("κ");
  const lenItem = readout.item("減衰長 1/κ");
  const tItem = readout.item("透過率 T", { color: "electron" });
  const kLabel = kItem.el.firstElementChild;
  const lenLabel = lenItem.el.firstElementChild;

  function setLabel(el: Element | null, text: string): void {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function updateReadouts(): void {
    if (V > E) {
      const k = kappa(V - E);
      setLabel(kLabel, "κ");
      setLabel(lenLabel, "減衰長 1/κ");
      kItem.set(`${fmtSig(k, 3)} nm⁻¹`);
      lenItem.set(`${fmtSig(PM_PER_NM / k, 3)} pm`);
    } else {
      setLabel(kLabel, "壁の中の波数 k′");
      setLabel(lenLabel, "壁の中");
      kItem.set(`${fmtSig(insideWavenumber(E, V), 3)} nm⁻¹`);
      lenItem.set("壁より高いエネルギー: 中でも振動する");
    }
    tItem.set(fmtT(sol.T));
  }

  /* ---- 操作部品 ---- */
  const vSlider = host.controls.slider({
    id: "v",
    label: "壁の高さ V",
    min: V_MIN,
    max: V_MAX,
    step: V_STEP,
    value: V_INIT,
    unit: "eV",
  });
  vSlider.onChange((v) => {
    V = v;
    recompute();
  });
  const eSlider = host.controls.slider({
    id: "e",
    label: "電子のエネルギー E",
    min: E_MIN,
    max: E_MAX,
    step: E_STEP,
    value: E_INIT,
    unit: "eV",
  });
  eSlider.onChange((v) => {
    E = v;
    recompute();
  });
  const dSlider = host.controls.slider({
    id: "d",
    label: "壁の厚さ d",
    min: D_MIN,
    max: D_MAX,
    step: D_STEP,
    value: D_INIT,
    unit: "nm",
  });
  dSlider.onChange((v) => {
    d = v;
    recompute();
  });
  const waveToggle = host.controls.toggle({
    id: "wave",
    label: "波の形も表示(Re ψ)",
    value: false,
  });
  waveToggle.onChange((v) => {
    showWave = v;
  });
  host.controls.reset(() => {
    vSlider.set(V_INIT);
    eSlider.set(E_INIT);
    dSlider.set(D_INIT);
    waveToggle.set(false);
    V = V_INIT;
    E = E_INIT;
    d = D_INIT;
    showWave = false;
    recompute();
  });

  recompute();
  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
