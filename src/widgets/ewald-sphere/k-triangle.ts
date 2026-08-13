/**
 * k-triangle.ts — 図2「波を矢で書く」(仕様書 04 §5.2)
 *
 * 入射波 k と散乱波 k′ を矢で描き、弾性散乱の拘束 |k′| = |k| = 1/λ
 * (式 E1・E4)のもとで散乱方向だけを変えさせる。差 Δk = k′ − k(式 E3)を
 * 原点 O を根元に描くと、その先端は必ず k の根元 C を中心とする半径 1/λ の
 * 円の上にある。軌跡を残していくとその円が現れる — **これがエヴァルト球の
 * 正体**であることを、次の節で明かすための図。
 *
 * 簡略化(図注に明示): 2 次元の断面(実際には k′ は 3 次元の球面上を動ける)。
 * 散乱体を 1 点として描いており、結晶全体の重ね合わせは扱っていない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import {
  attachDragPoints,
  CANVAS_FONT,
  createReadout,
  drawArrow,
  drawFocusRing,
  drawScaleBar,
  makeMapper,
  type PanelRect,
} from "../reciprocal-lattice/_shared2d";
import { angleArc, haloText, niceScaleValue } from "./_draw2d";
import { scatteringVectorLength, waveNumber } from "./ewald";

/* ---------------------------------------------------------------- 定数 */

/** 散乱角 2θ の範囲・初期値・刻み(°) */
const TWO_THETA_MIN = -180;
const TWO_THETA_MAX = 180;
const TWO_THETA_STEP = 0.5;
const TWO_THETA_INIT = 35;
/** 波長 λ の範囲・初期値・刻み(nm) */
const LAMBDA_MIN = 0.08;
const LAMBDA_MAX = 0.3;
const LAMBDA_STEP = 0.002;
const LAMBDA_INIT = 0.154;
/** キーボード操作の刻み(矢印 / Shift+矢印 — §5.2) */
const KEY_STEP = 0.5;
const KEY_STEP_COARSE = 5;
/** 表示半径 = 1/λ の何倍か */
const VIEW_MARGIN = 1.42;
/** 軌跡の点の半径(CSS px)と不透明度 */
const TRACE_RADIUS_PX = 2;
const TRACE_ALPHA = 0.55;
/** 散乱体 C・原点 O の見た目半径(CSS px) */
const NODE_RADIUS_PX = 4.5;
/** k′ の先端ハンドルの見た目半径(CSS px) */
const TIP_RADIUS_PX = 7;
/** 角度弧の半径(CSS px) */
const ARC_RADIUS_PX = 34;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export default function kTriangle(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const beamFill = matColor("beam");
  const beamInk = matColor("beamInk");
  const recipFill = matColor("recip");
  const sphereLine = matColor("sphereLine");
  const matrixFill = matColor("matrix");
  const text2 = uiColor("text2");
  const bgFill = uiColor("bg");

  /* ---- 状態 ---- */

  let twoTheta = TWO_THETA_INIT; // 散乱角(°)
  let lambda = LAMBDA_INIT; // 波長(nm)
  let traceOn = true;
  /** 軌跡: 0.5° 刻みに量子化した散乱角の集合(毎描画の配列割当てを避ける) */
  const trace = new Set<number>();

  /** 現在のパネル矩形(canvas 全体を 1 枚のパネルとして使う) */
  function panelRect(): PanelRect {
    const { w, h } = host.size;
    return { x: 0, y: 0, w, h, cx: w / 2, cy: h / 2 };
  }

  /** 表示半径(nm⁻¹)。円がちょうど収まる大きさにする */
  function viewRadius(): number {
    return waveNumber(lambda) * VIEW_MARGIN;
  }

  /**
   * 座標系: 円の中心 C をパネル中央に置く。世界座標では C = (−R, 0)、
   * O = (0, 0) なので、描画時に x を +R だけずらす。
   */
  function mapper(): {
    toPx(x: number, y: number): [number, number];
    pxPerUnit: number;
    panel: PanelRect;
  } {
    const panel = panelRect();
    const base = makeMapper(
      panel,
      Math.min(panel.w, panel.h) / 2 / viewRadius(),
    );
    const shift = waveNumber(lambda);
    return {
      panel,
      pxPerUnit: base.pxPerUnit,
      toPx: (x: number, y: number) => [base.toPxX(x + shift), base.toPxY(y)],
    };
  }

  /** k′ の先端 P(世界座標 nm⁻¹) */
  function tipWorld(): [number, number] {
    const R = waveNumber(lambda);
    const a = twoTheta * DEG;
    // C = (−R, 0) から半径 R の円周上へ
    return [-R + R * Math.cos(a), R * Math.sin(a)];
  }

  function recordTrace(): void {
    if (traceOn) trace.add(Math.round(twoTheta / TWO_THETA_STEP));
  }

  /* ---- 読み取り値(§5.2) ---- */

  const readout = createReadout(host);
  const lambdaItem = readout.item("λ", { color: "beam" });
  const kItem = readout.item("|k| = 1/λ", { color: "beam" });
  const angleItem = readout.item("2θ");
  const dkItem = readout.item("|Δk|", { color: "recip" });
  const dItem = readout.item("d = 1/|Δk|");

  function updateReadout(): void {
    const dk = scatteringVectorLength(Math.abs(twoTheta) / 2, lambda);
    lambdaItem.set(`${lambda.toFixed(3)} nm`);
    kItem.set(`${waveNumber(lambda).toFixed(2)} nm⁻¹`);
    angleItem.set(`${twoTheta.toFixed(1)}°`);
    dkItem.set(`${dk.toFixed(3)} nm⁻¹`);
    dItem.set(dk > 1e-6 ? `${(1 / dk).toFixed(3)} nm` : "—");
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w: sw, h: sh, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sw, sh);

    const map = mapper();
    const R = waveNumber(lambda);
    const [cx, cy] = map.toPx(-R, 0);
    const [ox, oy] = map.toPx(0, 0);
    const [px, py] = map.toPx(...tipWorld());

    // 軌跡(発見の記録)。円が現れるのはここ
    if (trace.size > 0) {
      ctx.fillStyle = sphereLine;
      ctx.globalAlpha = TRACE_ALPHA;
      ctx.beginPath();
      for (const key of trace) {
        const a = key * TWO_THETA_STEP * DEG;
        const [tx, ty] = map.toPx(-R + R * Math.cos(a), R * Math.sin(a));
        ctx.moveTo(tx + TRACE_RADIUS_PX, ty);
        ctx.arc(tx, ty, TRACE_RADIUS_PX, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 散乱角の弧(C を頂点に、k の向きから k′ の向きまで)
    const arcTo = -twoTheta * DEG; // スクリーンは y 下向き
    angleArc(ctx, cx, cy, ARC_RADIUS_PX, 0, arcTo, text2);

    // k(C → O)と k′(C → P)
    drawArrow(ctx, cx, cy, ox, oy, { color: beamFill });
    drawArrow(ctx, cx, cy, px, py, { color: beamFill });
    // Δk(O → P)
    drawArrow(ctx, ox, oy, px, py, { color: recipFill });

    // 散乱体 C と原点 O
    ctx.fillStyle = matrixFill;
    ctx.beginPath();
    ctx.arc(cx, cy, NODE_RADIUS_PX, 0, TAU);
    ctx.fill();
    ctx.fillStyle = recipFill;
    ctx.beginPath();
    ctx.arc(ox, oy, NODE_RADIUS_PX, 0, TAU);
    ctx.fill();
    // k′ の先端(ドラッグできることを示すつまみ)
    ctx.fillStyle = beamFill;
    ctx.beginPath();
    ctx.arc(px, py, TIP_RADIUS_PX, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = beamInk;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ラベル
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    haloText(ctx, "結晶", cx, cy + 20, text2, bgFill);
    haloText(ctx, "k", (cx + ox) / 2, (cy + oy) / 2 + 16, beamInk, bgFill);
    haloText(ctx, "k′", (cx + px) / 2, (cy + py) / 2 - 14, beamInk, bgFill);
    haloText(ctx, "Δk", (ox + px) / 2 + 14, (oy + py) / 2, recipFill, bgFill);
    haloText(ctx, "O", ox, oy + 20, text2, bgFill);
    haloText(
      ctx,
      `2θ = ${twoTheta.toFixed(1)}°`,
      cx + ARC_RADIUS_PX + 34,
      cy + (twoTheta >= 0 ? -18 : 18),
      text2,
      bgFill,
    );

    // フォーカスリング(キーボードでハンドルを選んでいるとき — §5.0)
    if (handles.focusedIndex() === 0) drawFocusRing(ctx, px, py);

    const bar = niceScaleValue(viewRadius());
    drawScaleBar(ctx, map.panel, map.pxPerUnit, bar, `${bar} nm⁻¹`);
  }

  /* ---- 操作部品(§5.2) ---- */

  const angleSlider = host.controls.slider({
    id: "twoTheta",
    label: "散乱角 2θ",
    min: TWO_THETA_MIN,
    max: TWO_THETA_MAX,
    step: TWO_THETA_STEP,
    value: TWO_THETA_INIT,
    unit: "°",
  });
  angleSlider.onChange((v) => {
    twoTheta = v;
    recordTrace();
    updateReadout();
    handles.sync();
    host.requestRender();
  });

  const lambdaSlider = host.controls.slider({
    id: "lambda",
    label: "波長 λ",
    min: LAMBDA_MIN,
    max: LAMBDA_MAX,
    step: LAMBDA_STEP,
    value: LAMBDA_INIT,
    unit: "nm",
  });
  lambdaSlider.onChange((v) => {
    lambda = v;
    // 円の半径が変わるので、それまでの軌跡は意味を失う(§5.2)
    trace.clear();
    recordTrace();
    updateReadout();
    handles.sync();
    host.requestRender();
  });

  const traceToggle = host.controls.toggle({
    id: "trace",
    label: "先端の軌跡を残す",
    value: true,
  });
  traceToggle.onChange((v) => {
    traceOn = v;
    recordTrace();
    host.requestRender();
  });

  const clearButton = host.controls.button({ label: "軌跡を消す" });
  clearButton.onClick(() => {
    trace.clear();
    recordTrace();
    host.requestRender();
  });

  host.controls.reset(() => {
    trace.clear();
    angleSlider.set(TWO_THETA_INIT);
    lambdaSlider.set(LAMBDA_INIT);
    traceToggle.set(true);
  });

  /* ---- k′ の先端のドラッグ(§5.0 の規約に従う) ---- */

  const handles = attachDragPoints(host, [
    {
      label: "散乱波 k′ の先端(散乱角を変える)",
      x: () => {
        const map = mapper();
        return map.toPx(...tipWorld())[0];
      },
      y: () => {
        const map = mapper();
        return map.toPx(...tipWorld())[1];
      },
      drag: (xPx, yPx) => {
        const map = mapper();
        const [cx, cy] = map.toPx(-waveNumber(lambda), 0);
        // 中心 C から見た角度だけを取る = |k′| は変えられない(弾性散乱)
        const deg = (Math.atan2(-(yPx - cy), xPx - cx) * 180) / Math.PI;
        angleSlider.set(Math.round(deg / TWO_THETA_STEP) * TWO_THETA_STEP);
      },
      key: (dx, dy, coarse) => {
        const step = coarse ? KEY_STEP_COARSE : KEY_STEP;
        angleSlider.set(twoTheta + (dx + dy) * step);
      },
    },
  ]);

  /* ---- 初期化と描画登録(requestRender 型 — §5.2) ---- */

  host.onRender(draw);
  recordTrace();
  updateReadout();

  return {
    resize(): void {
      handles.sync();
    },
    destroy(): void {
      handles.dispose();
      readout.el.remove();
    },
  };
}
