/**
 * atmosphere-equilibrium.ts — 図4: 平衡濃度の地図(記事仕様 §5.4)
 *
 * 転位中心 ±10b の領域について、飽和つきボルツマン分布(フェルミ型)
 * c(x, y) = equilibriumOccupancy(soluteEnergy(x, y), T, c0) の占有率
 * ヒートマップを描く。c は対数スケールで溶質色の不透明度にマップし、
 * 温度スライダーで雰囲気の凝縮(低温)/蒸発(高温)を観察する。
 *
 * 実装方式: 2D / requestRender(操作時のみ再描画)。ヒートマップは
 * 200×140 のオフスクリーン ImageData に T 変更時のみ再計算し、メイン
 * キャンバスへ拡大転送する(補間で滑らかに)。
 * 簡略化(図注に明示): サイト間の相互作用は無視する(希薄近似)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { C_FAR } from "./lib/constants";
import {
  buildEdgeLattice,
  dislocationSymbolPos,
  drawDislocationMark,
  equilibriumOccupancy,
  parseRgb,
  soluteEnergy,
  viewX,
  viewY,
  type LatticeView,
} from "./lib/lattice";

/** ヒートマップの計算格子 = オフスクリーン canvas の寸法(§5.4: 約 200×140) */
const HEAT_W = 200;
const HEAT_H = 140;
/** ヒートマップが覆う物理領域の半幅(b 単位。横 ±10b — §5.4) */
const REGION_HALF_X_B = 10;
/** 半高は計算格子のアスペクトに合わせる(= 7b。セルが b 単位で正方になる) */
const REGION_HALF_Y_B = (REGION_HALF_X_B * HEAT_H) / HEAT_W;
/** 計算格子 1 セルの物理寸法(b 単位) */
const CELL_B = (2 * REGION_HALF_X_B) / HEAT_W;

/** 温度スライダー(§5.4: 300〜1200 K・step 10・初期 600 K) */
const TEMP_MIN = 300;
const TEMP_MAX = 1200;
const TEMP_STEP = 10;
const TEMP_INIT = 600;

/** 下敷き格子の列数・行数(図2 と同じ buildEdgeLattice(27, 16)) */
const COLS = 27;
const ROWS = 16;
/** 下敷き格子の変位の誇張(§5.4: ×2) */
const LATTICE_EXAG = 2;
/** 下敷き格子の不透明度(薄く — §5.4) */
const LATTICE_ALPHA = 0.35;
/** 原子半径(格子間隔に対する割合。図2 と同じ) */
const ATOM_RADIUS_RATIO = 0.3;

/**
 * 占有率 → 不透明度の写像の節点 (log10(c/c0), α)(§5.4)。
 * c ≤ c0/10 → 0、c = c0 → 0.15、c = 100c0 → 0.55、c = 1(飽和)→ 0.95 を
 * 区分線形でつなぎ、log10(c/c0) ∈ [−1, 4] で単調に増える。
 */
const ALPHA_STOPS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [0, 0.15],
  [2, 0.55],
  [4, 0.95],
];

/** 読み出しプローブの位置: 転位直下 r = b(x = 0, y = −b — §5.4) */
const PROBE_X_B = 0;
const PROBE_Y_B = -1;

/** 凡例の 5 段: c₀ の 1/10・c₀・×10・×100・飽和(§5.4) */
const LEGEND_C_VALUES: readonly number[] = [
  C_FAR / 10,
  C_FAR,
  C_FAR * 10,
  C_FAR * 100,
  1,
];
const LEGEND_LABELS: readonly string[] = [
  "c₀の1/10",
  "c₀",
  "×10",
  "×100",
  "飽和",
];

/** レイアウト: 右に確保する凡例列の幅と、キャンバス端の余白(px) */
const LEGEND_COL_W = 100;
const MARGIN_PX = 12;
/** 凡例のスウォッチ寸法・間隔(px)。ラベルは 12px(§5.4) */
const SWATCH_W = 18;
const SWATCH_H = 14;
const SWATCH_GAP = 8;
const LEGEND_LABEL_GAP = 6;
const LEGEND_TITLE_H = 18;
/** 凡例全体の高さ(タイトル + スウォッチ 5 段) */
const LEGEND_TOTAL_H =
  LEGEND_TITLE_H +
  LEGEND_LABELS.length * SWATCH_H +
  (LEGEND_LABELS.length - 1) * SWATCH_GAP;
/** キャンバス端から確保する最小余白(px。日本語テキストのはみ出し防止) */
const EDGE_MARGIN_PX = 8;

const TAU = Math.PI * 2;

/** 占有率 c → 不透明度(0〜1)。ALPHA_STOPS の区分線形補間(単調) */
function alphaFromOccupancy(c: number): number {
  const l = Math.log10(c / C_FAR);
  if (l <= ALPHA_STOPS[0][0]) return ALPHA_STOPS[0][1];
  for (let i = 1; i < ALPHA_STOPS.length; i++) {
    const [l1, a1] = ALPHA_STOPS[i];
    if (l <= l1) {
      const [l0, a0] = ALPHA_STOPS[i - 1];
      return a0 + ((a1 - a0) * (l - l0)) / (l1 - l0);
    }
  }
  return ALPHA_STOPS[ALPHA_STOPS.length - 1][1];
}

export default function atmosphereEquilibrium(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // オフスクリーンのヒートマップ。T 変更時のみ再計算する(§5.4)
  const heatCanvas = document.createElement("canvas");
  heatCanvas.width = HEAT_W;
  heatCanvas.height = HEAT_H;
  const maybeHeatCtx = heatCanvas.getContext("2d");
  if (!maybeHeatCtx) throw new Error("2D コンテキストを取得できません");
  const heatCtx: CanvasRenderingContext2D = maybeHeatCtx;
  const heatImage = heatCtx.createImageData(HEAT_W, HEAT_H);

  const soluteRgb = parseRgb(matColor("solute"));
  const defectColor = matColor("defect");
  const hairlineColor = uiColor("hairline");
  const labelColor = uiColor("text2");
  const bgColor = uiColor("bg");

  // RGB は全ピクセル共通(溶質色)。再計算では α チャンネルだけ書き換える
  {
    const data = heatImage.data;
    for (let k = 0; k < data.length; k += 4) {
      data[k] = soluteRgb[0];
      data[k + 1] = soluteRgb[1];
      data[k + 2] = soluteRgb[2];
    }
  }

  // 凡例スウォッチの塗り(ヒートマップと同じ写像から得る。α=0 は塗りなし)
  const legendItems = LEGEND_LABELS.map((label, i) => {
    const a = alphaFromOccupancy(LEGEND_C_VALUES[i]);
    return {
      label,
      fill:
        a > 0
          ? `rgba(${soluteRgb[0]}, ${soluteRgb[1]}, ${soluteRgb[2]}, ${a.toFixed(3)})`
          : null,
    };
  });

  const lat = buildEdgeLattice(COLS, ROWS);
  const symPos = { x: 0, y: 0 };
  // 物理座標(y 上向き)→ Canvas 座標の変換。draw() で毎回値を更新する
  const view: LatticeView = { cx: 0, cy: 0, scale: 1 };

  let temperature = TEMP_INIT;
  let heatDirty = true;

  /**
   * 現在の T でヒートマップの α チャンネルを再計算する。
   * 200×140 の exp 評価は十分速く 16ms 以内に収まる(§5.4)。
   */
  function recomputeHeatmap(): void {
    const data = heatImage.data;
    let k = 3; // α チャンネルのみ更新
    for (let j = 0; j < HEAT_H; j++) {
      // 行 0 = 上端 = +y 側。§5.0 の y 反転はここで行う(物理は y 上向き)
      const y = REGION_HALF_Y_B - (j + 0.5) * CELL_B;
      for (let i = 0; i < HEAT_W; i++) {
        const x = (i + 0.5) * CELL_B - REGION_HALF_X_B;
        const c = equilibriumOccupancy(soluteEnergy(x, y), temperature, C_FAR);
        data[k] = Math.round(alphaFromOccupancy(c) * 255);
        k += 4;
      }
    }
    heatCtx.putImageData(heatImage, 0, 0);
    heatDirty = false;
  }

  /** 凡例を縦に描く(右の凡例列。12px ラベル — §5.4) */
  function drawLegend(w: number, h: number, mapTop: number): void {
    const x = w - LEGEND_COL_W + EDGE_MARGIN_PX;
    // 地図の上端に揃える。ただし下端がはみ出す場合は押し上げる
    const top = Math.max(
      EDGE_MARGIN_PX,
      Math.min(mapTop, h - EDGE_MARGIN_PX - LEGEND_TOTAL_H),
    );
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = labelColor;
    ctx.fillText("占有率 c", x, top + LEGEND_TITLE_H / 2);
    let y = top + LEGEND_TITLE_H;
    for (const item of legendItems) {
      if (item.fill !== null) {
        ctx.fillStyle = item.fill;
        ctx.fillRect(x, y, SWATCH_W, SWATCH_H);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = hairlineColor;
      ctx.strokeRect(x + 0.5, y + 0.5, SWATCH_W - 1, SWATCH_H - 1);
      ctx.fillStyle = labelColor;
      ctx.fillText(
        item.label,
        x + SWATCH_W + LEGEND_LABEL_GAP,
        y + SWATCH_H / 2,
      );
      y += SWATCH_H + SWATCH_GAP;
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (heatDirty) recomputeHeatmap();

    // ビュー: 右の凡例列を除いた領域に ±10b × ±7b をフィットさせる
    const availW = w - LEGEND_COL_W;
    view.scale = Math.min(
      (availW - MARGIN_PX * 2) / (REGION_HALF_X_B * 2),
      (h - MARGIN_PX * 2) / (REGION_HALF_Y_B * 2),
    );
    view.cx = availW / 2;
    view.cy = h / 2;
    const mapLeft = viewX(view, -REGION_HALF_X_B);
    const mapTop = viewY(view, REGION_HALF_Y_B);
    const mapW = REGION_HALF_X_B * 2 * view.scale;
    const mapH = REGION_HALF_Y_B * 2 * view.scale;

    // 下敷き: 薄い格子(hairline の塗りのみ・縁取りなし — §5.4)。
    // 格子(±13b)は地図(±10b)より広いので、地図の矩形でクリップする
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapLeft, mapTop, mapW, mapH);
    ctx.clip();
    ctx.globalAlpha = LATTICE_ALPHA;
    ctx.beginPath();
    const atomR = ATOM_RADIUS_RATIO * view.scale;
    for (let i = 0; i < lat.count; i++) {
      const x = viewX(view, lat.refX[i] + LATTICE_EXAG * lat.ux[i]);
      const y = viewY(view, lat.refY[i] + LATTICE_EXAG * lat.uy[i]);
      ctx.moveTo(x + atomR, y);
      ctx.arc(x, y, atomR, 0, TAU);
    }
    ctx.fillStyle = hairlineColor;
    ctx.fill();
    ctx.restore(); // globalAlpha とクリップを戻す

    // ヒートマップ(オフスクリーン → 拡大転送。補間で滑らかに — §5.4)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(heatCanvas, mapLeft, mapTop, mapW, mapH);

    // 最前面に ⊥ 記号(位置は下敷き格子の誇張 ×2 の変位に追従)
    dislocationSymbolPos(LATTICE_EXAG, symPos);
    drawDislocationMark(ctx, view, symPos.x, symPos.y, defectColor);

    // 地図の枠(補助線: hairline 1px — §6.5)
    ctx.lineWidth = 1;
    ctx.strokeStyle = hairlineColor;
    ctx.strokeRect(mapLeft + 0.5, mapTop + 0.5, mapW - 1, mapH - 1);

    // 読み出し: 転位直下(r = b)の占有率(§5.4)。
    // 地図の上に重なるので白の縁取り(lineWidth 4)を敷いて読みやすくする
    const cCore = equilibriumOccupancy(
      soluteEnergy(PROBE_X_B, PROBE_Y_B),
      temperature,
      C_FAR,
    );
    const readout = `転位直下 (r=b) の占有率: ${cCore.toFixed(2)}`;
    ctx.font = "14px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = bgColor;
    ctx.fillStyle = labelColor;
    const rx = mapLeft + EDGE_MARGIN_PX;
    const ry = mapTop + EDGE_MARGIN_PX;
    ctx.strokeText(readout, rx, ry);
    ctx.fillText(readout, rx, ry);

    drawLegend(w, h, mapTop);
  }

  /* ---- 操作部品(§5.4: 温度スライダーのみ) ---- */

  const tempSlider = host.controls.slider({
    id: "temperature",
    label: "温度 T",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "K",
  });
  tempSlider.onChange((v) => {
    temperature = v;
    heatDirty = true; // T 変更時のみヒートマップを再計算する
    host.requestRender();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      /* イベントリスナーなし */
    },
  };
}
