/**
 * equilibration.ts — 図7「接触すると揃う」(仕様書 12 §5.7・次記事への伏線)
 *
 * 左右 2 つの Si のブロックのバンド図。どちらも同じ Si なので、接触前は
 * 伝導帯の底・価電子帯の頂上の高さを揃えて描く(真空準位と電子親和力が同じ
 * という前提 — 図注に明示)。各ブロックに自分の E_F。接触前はブロックの間に
 * 8% の隙間がある。
 *
 * 「接触させる」で tween(1.6 秒)が次を順に進める: 隙間が閉じる → 接合面の
 * 付近に電子の流れの矢印(E_F の高い側から低い側へ)が現れて消える → 左を
 * 固定したまま右のバンド全体が E_{F,A} − E_{F,B} だけ動き、接合面の付近で
 * 滑らかにつながって曲がる → 2 本の E_F が 1 本に揃う。曲がりの段差は接触前の
 * E_F の差に**厳密に**等しい(この一致が本図の主張)。
 *
 * 簡略化(図注に明示): 曲がりの形は smoothstep による模式(全幅の 30% の
 * S 字)。正しい形・空乏層・電場は次の記事(pn 接合)で扱う。
 *
 * 実装方式: 2D Canvas / requestRender + tween(src/core/anim.ts)。遷移が
 * 終われば描画は止まる。省モーション時は遷移なしで最終状態。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { tween, type Tween } from "../../core/anim";
import { clamp, smoothstep } from "../../core/mathx";
import { fmtSci } from "../../core/plot";
import { createReadout, drawArrow } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawBandRibbon,
  drawLevelLine,
  drawPlotFrame,
  PLOT_FONT,
  setPlotRange,
  withPlotClip,
} from "../_shared/banddiagram";
import { SILICON, solveFermiLevel } from "../_shared/semiconductor";
import {
  drawFermiLine,
  drawLabel,
  fermiColors,
  setControlEnabled,
  snapLog,
} from "./lib/draw";
import { formatEvFixed } from "./lib/format";

type Kind = "p" | "i" | "n";

/** 操作パラメータ(§5.7 の表) */
const LEFT_INIT: Kind = "p";
const RIGHT_INIT: Kind = "n";
const CONC_MIN = 1e14;
const CONC_MAX = 1e18;
const CONC_INIT = 1e16;
/** E_F を解く温度 [K] */
const TEMPERATURE = 300;
/** 遷移の長さ [ms] */
const TRANSITION_MS = 1600;
/** 接触前の隙間(横軸 0〜1 の 8%)と、閉じたあとの両端の余白 */
const GAP = 0.08;
const JUNCTION = 0.5;
/** 曲がりの S 字の半幅(全幅の 30% にわたる) */
const BEND_HALF = 0.15;
/** 帯の見た目の厚み [eV](伝導帯は E_c から上、価電子帯は E_v から下) */
const BAND_THICKNESS = 0.42;
/** 縦の余白 [eV] */
const E_PAD = 0.12;
/** 遷移の中の段階(進み具合 0〜1 のうち) */
const PHASE_GAP_END = 0.3;
const PHASE_ARROW_START = 0.2;
const PHASE_ARROW_END = 0.85;
const PHASE_SHIFT_START = 0.3;
/** 曲がった帯のサンプル点数 */
const SAMPLES = 161;
/** E_F の差がこれ未満なら「流れない」 [eV] */
const NO_FLOW = 5e-4;

const KIND_LABEL: Record<Kind, string> = {
  p: "p 型 Si",
  i: "真性 Si",
  n: "n 型 Si",
};

export default function equilibration(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = fermiColors();
  const m = createPlotMapper();

  /* ---- 状態 ---- */
  let left: Kind = LEFT_INIT;
  let right: Kind = RIGHT_INIT;
  let conc = CONC_INIT;
  /** 0 = 離れている、1 = 接触して平衡 */
  let progress = 0;
  /** 接触させた(遷移中を含む)か */
  let contacted = false;
  let anim: Tween | null = null;

  let eFA = 0;
  let eFB = 0;
  let eMin = -1;
  let eMax = 2;

  /* ---- 使い回すバッファ ---- */
  const xs = new Float64Array(SAMPLES);
  const cbLow = new Float64Array(SAMPLES);
  const cbHigh = new Float64Array(SAMPLES);
  const vbLow = new Float64Array(SAMPLES);
  const vbHigh = new Float64Array(SAMPLES);
  const flatX = new Float64Array(2);
  const flatA = new Float64Array(2);
  const flatB = new Float64Array(2);

  function fermiLevelOf(kind: Kind): number {
    const nD = kind === "n" ? conc : 0;
    const nA = kind === "p" ? conc : 0;
    return solveFermiLevel(SILICON, nD, nA, TEMPERATURE);
  }

  /** 材料・濃度が変わったときだけ E_F と縦の範囲を計算し直す */
  function recompute(): void {
    eFA = fermiLevelOf(left);
    eFB = fermiLevelOf(right);
    const shift = eFA - eFB;
    eMin = Math.min(0, shift) - BAND_THICKNESS * 0.75 - E_PAD;
    eMax =
      Math.max(SILICON.eg, SILICON.eg + shift) + BAND_THICKNESS * 0.75 + E_PAD;
  }
  recompute();

  /** 進み具合から各段階の値(0〜1)を取り出す */
  function phase(p: number, start: number, end: number): number {
    return clamp((p - start) / (end - start), 0, 1);
  }

  /** 平らな帯(接触前のブロック) */
  function flatBlock(x0: number, x1: number, offset: number): void {
    flatX[0] = x0;
    flatX[1] = x1;
    flatA[0] = flatA[1] = SILICON.eg + offset;
    flatB[0] = flatB[1] = SILICON.eg + offset + BAND_THICKNESS;
    drawBandRibbon(ctx, m, flatX, flatA, flatB, 2, { colors, edges: "low" });
    flatA[0] = flatA[1] = offset - BAND_THICKNESS;
    flatB[0] = flatB[1] = offset;
    drawBandRibbon(ctx, m, flatX, flatA, flatB, 2, { colors, edges: "high" });
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const marginLeft = 44;
    const marginRight = 12;
    const marginTop = 30;
    const marginBottom = 12;
    setPlotRange(
      m,
      marginLeft,
      marginTop,
      w - marginLeft - marginRight,
      h - marginTop - marginBottom,
      0,
      1,
      eMin,
      eMax,
    );
    drawPlotFrame(ctx, m, { colors, yLabel: "電子のエネルギー" });

    const pGap = phase(progress, 0, PHASE_GAP_END);
    const pShift = smoothstep(PHASE_SHIFT_START, 1, progress);
    const pArrow = phase(progress, PHASE_ARROW_START, PHASE_ARROW_END);
    const close = (GAP / 2) * pGap;
    // ブロックの範囲(隙間が閉じると両者が中央へ寄る)
    const aX0 = close;
    const aX1 = JUNCTION - GAP / 2 + close;
    const bX0 = JUNCTION + GAP / 2 - close;
    const bX1 = 1 - close;
    const shiftFinal = eFA - eFB;
    const shift = shiftFinal * pShift;
    const joined = pGap >= 1;

    withPlotClip(ctx, m, () => {
      if (!joined) {
        flatBlock(aX0, aX1, 0);
        flatBlock(bX0, bX1, 0);
      } else {
        // 接触後: 左は固定、右は shift だけ動き、接合面の付近で滑らかに曲がる
        for (let i = 0; i < SAMPLES; i++) {
          const x = aX0 + ((bX1 - aX0) * i) / (SAMPLES - 1);
          const d =
            shift * smoothstep(JUNCTION - BEND_HALF, JUNCTION + BEND_HALF, x);
          xs[i] = x;
          cbLow[i] = SILICON.eg + d;
          cbHigh[i] = SILICON.eg + d + BAND_THICKNESS;
          vbLow[i] = d - BAND_THICKNESS;
          vbHigh[i] = d;
        }
        drawBandRibbon(ctx, m, xs, cbLow, cbHigh, SAMPLES, {
          colors,
          edges: "low",
        });
        drawBandRibbon(ctx, m, xs, vbLow, vbHigh, SAMPLES, {
          colors,
          edges: "high",
        });
      }

      // E_F(左は固定、右はバンドといっしょに動く)
      drawFermiLine(ctx, m, aX0, aX1, eFA, colors);
      const eFBNow = eFB + shift;
      drawFermiLine(ctx, m, bX0, bX1, eFBNow, colors, undefined);

      // 電子の流れ(E_F の高い側から低い側へ)。現れて消える
      if (
        contacted &&
        pArrow > 0 &&
        pArrow < 1 &&
        Math.abs(shiftFinal) >= NO_FLOW
      ) {
        const alpha = Math.sin(Math.PI * pArrow);
        const fromRight = eFB > eFA;
        const highEc = SILICON.eg + (fromRight ? shift : 0);
        ctx.save();
        ctx.globalAlpha = alpha;
        for (let k = 0; k < 2; k++) {
          const y = m.toPxY(highEc + 0.1 + k * 0.14);
          const xFrom = m.toPxX(fromRight ? JUNCTION + 0.1 : JUNCTION - 0.1);
          const xTo = m.toPxX(fromRight ? JUNCTION - 0.1 : JUNCTION + 0.1);
          drawArrow(ctx, xFrom, y, xTo, y, { color: colors.electron });
        }
        ctx.restore();
      }
    });

    // 右の E_F のラベル(右端。揃ったら左のラベルだけにする)
    if (Math.abs(eFB + shift - eFA) > 0.03) {
      drawLabel(
        ctx,
        "E_F",
        m.toPxX(bX1) - 4,
        m.toPxY(eFB + shift) - 9,
        colors.electron,
        "right",
        "middle",
      );
    }

    // ブロックの名前
    drawLabel(
      ctx,
      KIND_LABEL[left],
      m.toPxX((aX0 + aX1) / 2),
      14,
      colors.text,
      "center",
    );
    drawLabel(
      ctx,
      KIND_LABEL[right],
      m.toPxX((bX0 + bX1) / 2),
      14,
      colors.text,
      "center",
    );
    drawLabel(
      ctx,
      "伝導帯",
      m.toPxX(aX0) + 6,
      m.toPxY(SILICON.eg + BAND_THICKNESS * 0.55),
      colors.text2,
      "left",
    );
    drawLabel(
      ctx,
      "価電子帯",
      m.toPxX(aX0) + 6,
      m.toPxY(-BAND_THICKNESS * 0.55),
      colors.text2,
      "left",
    );

    // 寸法: 接触前は E_F の差、接触後はバンドの段差
    const diff = eFB - eFA;
    if (!contacted && Math.abs(diff) >= NO_FLOW) {
      const x = m.toPxX(JUNCTION);
      measure(
        x,
        m.toPxY(eFA),
        m.toPxY(eFB),
        `E_F の差 ${formatEvFixed(Math.abs(diff))}`,
      );
    } else if (contacted && progress >= 1 && Math.abs(diff) >= NO_FLOW) {
      // 右のバンドの段差(左の E_c を右へ延長した参照線と、右の E_c の差)
      const x = m.toPxX(bX1 - 0.04);
      drawLevelLine(ctx, m, JUNCTION, bX1, SILICON.eg, {
        colors,
        color: colors.text2,
        width: 1,
        dashed: true,
      });
      measure(
        x,
        m.toPxY(SILICON.eg),
        m.toPxY(SILICON.eg + shiftFinal),
        `段差 ${formatEvFixed(Math.abs(shiftFinal))}`,
        "right",
      );
    }

    // 読み取り値
    diffItem.set(
      Math.abs(diff) < NO_FLOW
        ? "0.000 eV(同じ)"
        : `${formatEvFixed(Math.abs(diff))}(${diff > 0 ? "右" : "左"}が高い)`,
    );
    if (contacted && progress >= 1) {
      stepItem.set(
        Math.abs(shiftFinal) < NO_FLOW
          ? "0.000 eV"
          : `${formatEvFixed(Math.abs(shiftFinal))}(${shiftFinal < 0 ? "右" : "左"}のバンドが低い)`,
      );
      flowItem.set(
        Math.abs(diff) < NO_FLOW
          ? "流れない"
          : diff > 0
            ? "右 → 左"
            : "左 → 右",
      );
    } else {
      stepItem.set("—");
      flowItem.set("—");
    }
  }

  /** 縦の寸法線とラベル */
  function measure(
    x: number,
    yA: number,
    yB: number,
    text: string,
    side: "left" | "right" = "left",
  ): void {
    const top = Math.min(yA, yB);
    const bottom = Math.max(yA, yB);
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.fillStyle = colors.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    if (bottom - top > 12) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x - 3.5, top + 6);
      ctx.lineTo(x + 3.5, top + 6);
      ctx.closePath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x - 3.5, bottom - 6);
      ctx.lineTo(x + 3.5, bottom - 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // ラベルは背景色の下地の上に置く(帯や線と重なっても読めるように)
    const ym = (top + bottom) / 2;
    const tx = side === "left" ? x + 8 : x - 8;
    ctx.save();
    ctx.font = PLOT_FONT;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(side === "left" ? tx - 3 : tx - tw - 3, ym - 9, tw + 6, 18);
    ctx.fillStyle = colors.text;
    ctx.textAlign = side === "left" ? "left" : "right";
    ctx.textBaseline = "middle";
    ctx.fillText(text, tx, ym);
    ctx.restore();
  }

  /* ---- 接触・切り離し ---- */
  function cancelAnim(): void {
    if (anim) {
      anim.cancel();
      anim = null;
    }
  }

  function separate(): void {
    cancelAnim();
    contacted = false;
    progress = 0;
    contactBtn.el.textContent = "接触させる";
  }

  function makeContact(): void {
    cancelAnim();
    contacted = true;
    progress = 0;
    contactBtn.el.textContent = "離す";
    anim = tween(
      0,
      1,
      TRANSITION_MS,
      (v) => {
        progress = v;
        host.requestRender();
      },
      () => {
        anim = null;
        progress = 1;
        host.requestRender();
      },
    );
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const diffItem = readout.item("接触前の E_F の差", { color: "electron" });
  const stepItem = readout.item("接触後の段差");
  const flowItem = readout.item("電子が流れた向き", { color: "electron" });

  const kindOptions: ReadonlyArray<{ value: Kind; label: string }> = [
    { value: "p", label: "p 型" },
    { value: "i", label: "真性" },
    { value: "n", label: "n 型" },
  ];
  const leftSeg = host.controls.segmented<Kind>({
    id: "left",
    label: "左の材料",
    options: kindOptions,
    value: LEFT_INIT,
  });
  const rightSeg = host.controls.segmented<Kind>({
    id: "right",
    label: "右の材料",
    options: kindOptions,
    value: RIGHT_INIT,
  });
  const concSlider = host.controls.slider({
    id: "conc",
    label: "濃度(両側共通)",
    min: CONC_MIN,
    max: CONC_MAX,
    value: CONC_INIT,
    scale: "log",
    unit: "cm⁻³",
    format: (v) => fmtSci(snapLog(v), 2),
  });
  const contactBtn = host.controls.button({ label: "接触させる" });

  function updateConcEnabled(): void {
    setControlEnabled(concSlider.el, left !== "i" || right !== "i");
  }

  // 接触中に材料・濃度を変えたら、いったん離した状態に戻して描き直す
  leftSeg.onChange((v) => {
    left = v;
    separate();
    recompute();
    updateConcEnabled();
  });
  rightSeg.onChange((v) => {
    right = v;
    separate();
    recompute();
    updateConcEnabled();
  });
  concSlider.onChange((v) => {
    conc = snapLog(v);
    separate();
    recompute();
  });
  contactBtn.onClick(() => {
    if (contacted) separate();
    else makeContact();
    host.requestRender();
  });

  host.controls.reset(() => {
    leftSeg.set(LEFT_INIT);
    rightSeg.set(RIGHT_INIT);
    concSlider.set(CONC_INIT);
    left = LEFT_INIT;
    right = RIGHT_INIT;
    conc = CONC_INIT;
    separate();
    recompute();
    updateConcEnabled();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      cancelAnim();
      readout.el.remove();
    },
  };
}
