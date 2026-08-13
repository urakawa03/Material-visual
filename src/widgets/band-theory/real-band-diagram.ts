/**
 * real-band-diagram.ts — 図7「本物のバンド図を読む」(仕様書 11 §5.7・発展)
 *
 * 対称点 L–Γ–X に沿った E-k 図。GaAs は伝導帯の底と価電子帯の頂上が同じ k
 * (直接遷移)、Si はずれている(間接遷移)。前者は光をそのまま出せるが、
 * 後者は格子の振動(フォノン)の助けが要る — LED が Si で作られない理由である。
 * バンド端の曲率は有効質量 m* = ħ²/(d²E/dk²) で、価電子帯の頂上では符号が
 * 逆(負の有効質量)になる。
 *
 * 簡略化(図注に明示): 曲線は模式で、バンドギャップと有効質量だけを実測値に
 * 合わせてある。縮退・スピン軌道分裂・複数の谷は描かない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawCurve,
  drawGapMarks,
  drawPlotFrame,
  formatEv,
  PLOT_FONT_SMALL,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { HBAR2_OVER_2M } from "./lib/constants";
import {
  branchEnergy,
  conductionMinimumT,
  effectiveMassRatio,
  getMaterial,
  pathToK,
  type Material,
} from "./lib/realbands";

/** 縦軸の表示範囲 [eV](価電子帯の頂上を 0 に取る) */
const E_MIN = -3.2;
const E_MAX = 4;
/** 余白(px) */
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 18;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 48;
/** サンプル点数 */
const SAMPLES = 241;
const SAMPLES_NARROW = 121;
const NARROW_WIDTH_PX = 480;
/** 接触放物線を描く範囲(パス座標) */
const PARABOLA_HALF_T = 0.32;
/** 矢印の頭の大きさ(px) */
const ARROW_HEAD = 8;

const X_TICKS: readonly AxisTick[] = [
  { value: -1, label: "L" },
  { value: 0, label: "Γ" },
  { value: 1, label: "X" },
];

export default function realBandDiagram(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = bandColors();
  const mapper = createPlotMapper();

  /* ---- 状態 ---- */
  let material: Material = getMaterial("GaAs");
  let showParabola = false;
  let showTransition = true;

  /* ---- 使い回すバッファ ---- */
  const ts = new Float64Array(SAMPLES);
  const es = new Float64Array(SAMPLES);

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  /** バンド 1 本を描く(横軸はパス座標 t、縦軸は E) */
  function plotBand(n: number, branch: Material["conduction"]): void {
    for (let i = 0; i < n; i++) {
      const t = -1 + (2 * i) / (n - 1);
      ts[i] = t;
      es[i] = branchEnergy(pathToK(t, material), branch);
    }
    drawCurve(ctx, mapper, ts, es, n, { color: colors.level, width: 2.4 });
  }

  /** バンド端の接触放物線(有効質量の見える化) */
  function plotParabola(branch: Material["conduction"]): void {
    const t0 = branch.kEdge / pathToK(1, material);
    const n = 61;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 - PARABOLA_HALF_T + (2 * PARABOLA_HALF_T * i) / (n - 1);
      if (t < -1 || t > 1) continue;
      const dk = pathToK(t, material) - branch.kEdge;
      ts[count] = t;
      es[count] =
        branch.eEdge + (branch.sign * (HBAR2_OVER_2M * dk * dk)) / branch.mr;
      count++;
    }
    drawCurve(ctx, mapper, ts, es, count, {
      color: colors.electron,
      width: 1.8,
      dash: [6, 4],
    });
  }

  /** 矢印(遷移の描画用。線 + 塗り三角 — 母体仕様 §6.5) */
  function arrow(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len;
    const uy = dy / len;
    const bx = x1 - ux * ARROW_HEAD;
    const by = y1 - uy * ARROW_HEAD;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(bx, by);
    ctx.stroke();
    const hw = ARROW_HEAD * 0.45;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(bx - uy * hw, by + ux * hw);
    ctx.lineTo(bx + uy * hw, by - ux * hw);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 遷移(直接なら光の矢印 1 本、間接なら光 + フォノンの 2 本) */
  function drawTransition(): void {
    const tMin = conductionMinimumT(material);
    const xTop = mapper.toPxX(0);
    const yValence = mapper.toPxY(0);
    const yGap = mapper.toPxY(material.eg);
    ctx.save();
    ctx.font = PLOT_FONT_SMALL;
    ctx.textBaseline = "middle";
    if (material.direct) {
      arrow(xTop, yValence, xTop, mapper.toPxY(material.eg), colors.beam);
      ctx.fillStyle = colors.text2;
      ctx.textAlign = "left";
      ctx.fillText("光", xTop + 8, (yValence + yGap) / 2);
    } else {
      arrow(xTop, yValence, xTop, yGap, colors.beam);
      arrow(xTop, yGap, mapper.toPxX(tMin), yGap, colors.matrix);
      ctx.fillStyle = colors.text2;
      ctx.textAlign = "left";
      ctx.fillText("光", xTop + 8, (yValence + yGap) / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        "フォノン(格子の振動)",
        (xTop + mapper.toPxX(tMin)) / 2,
        yGap - 6,
      );
    }
    ctx.restore();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    setPlotRange(
      mapper,
      MARGIN_LEFT,
      MARGIN_TOP,
      w - MARGIN_LEFT - MARGIN_RIGHT,
      h - MARGIN_TOP - MARGIN_BOTTOM,
      -1,
      1,
      E_MIN,
      E_MAX,
    );
    drawPlotFrame(ctx, mapper, {
      colors,
      xTicks: X_TICKS,
      yTicks: [
        { value: -3, label: "−3" },
        { value: -2, label: "−2" },
        { value: -1, label: "−1" },
        { value: 0, label: "0" },
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
        { value: 4, label: "4" },
      ],
      xLabel: "波数 k(対称点に沿って)",
      yLabel: "エネルギー E [eV]",
    });

    const n = sampleCount();
    withPlotClip(ctx, mapper, () => {
      // 禁制帯(バンド端の間)。ラベルは遷移の矢印(Γ 点)を避けて左寄せに置く
      const tMin = conductionMinimumT(material);
      drawGapMarks(ctx, mapper, -1, 1, 0, material.eg, {
        colors,
        measure: false,
      });
      drawGapMarks(ctx, mapper, -0.85, -0.35, 0, material.eg, {
        colors,
        label: `E_g = ${material.eg.toFixed(2)} eV`,
      });

      plotBand(n, material.valence);
      plotBand(n, material.conduction);

      if (showParabola) {
        plotParabola(material.conduction);
        plotParabola(material.valence);
      }
      if (showTransition) drawTransition();

      // バンド端の印
      ctx.save();
      ctx.fillStyle = colors.electron;
      ctx.beginPath();
      const xc = mapper.toPxX(tMin);
      const yc = mapper.toPxY(material.eg);
      ctx.arc(xc, yc, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.hole;
      ctx.beginPath();
      ctx.arc(mapper.toPxX(0), mapper.toPxY(0), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // バンドの名前
      ctx.save();
      ctx.font = PLOT_FONT_SMALL;
      ctx.fillStyle = colors.text2;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "伝導帯",
        mapper.rect.x + mapper.rect.w - 8,
        mapper.toPxY(material.eg + 0.55),
      );
      ctx.fillText(
        "価電子帯",
        mapper.rect.x + mapper.rect.w - 8,
        mapper.toPxY(-0.75),
      );
      ctx.restore();
    });

    egItem.set(formatEv(material.eg));
    typeItem.set(material.direct ? "直接遷移" : "間接遷移(フォノンが必要)");
    meItem.set(effectiveMassRatio(material.conduction).toFixed(3));
    mhItem.set(`${effectiveMassRatio(material.valence).toFixed(2)}(曲率は負)`);
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const egItem = readout.item("E_g");
  const typeItem = readout.item("遷移の型");
  const meItem = readout.item("m*_e / m", { color: "electron" });
  const mhItem = readout.item("m*_h / m");

  const materialSeg = host.controls.segmented<Material["key"]>({
    id: "material",
    label: "材料",
    options: [
      { value: "GaAs", label: "GaAs" },
      { value: "Si", label: "Si" },
    ],
    value: "GaAs",
  });
  materialSeg.onChange((v) => {
    material = getMaterial(v);
  });

  const parabolaToggle = host.controls.toggle({
    id: "parabola",
    label: "有効質量の放物線を重ねる",
    value: false,
  });
  parabolaToggle.onChange((v) => {
    showParabola = v;
  });

  const transitionToggle = host.controls.toggle({
    id: "transition",
    label: "遷移の矢印を表示",
    value: true,
  });
  transitionToggle.onChange((v) => {
    showTransition = v;
  });

  host.controls.reset(() => {
    materialSeg.set("GaAs");
    parabolaToggle.set(false);
    transitionToggle.set(true);
    material = getMaterial("GaAs");
    showParabola = false;
    showTransition = true;
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
