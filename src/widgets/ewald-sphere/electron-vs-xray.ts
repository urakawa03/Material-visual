/**
 * electron-vs-xray.ts — 図7「球が平らに見えるとき」(仕様書 04 §5.7・発展)
 *
 * 同じ逆格子の同じ断面に、X 線(左)と電子線(右)のエヴァルト球の弧を
 * 同じ縮尺で重ねる。断面は入射方向に垂直な逆格子面(晶帯軸に垂直な面)を
 * 横から見たもので、球はこの面に原点で接し、離れるほど離れていく。
 * 離れ方(サジッタ)は Δ = R − √(R² − g²) ≈ g²λ/2(式 E14)。
 *
 * 200 kV の電子線は λ ≈ 2.5 pm、R = 1/λ ≈ 399 nm⁻¹ で、逆格子の間隔
 * (1/a = 2.5 nm⁻¹)より 2 桁大きい。その結果、原点付近では球面が逆格子面と
 * ほとんど区別できなくなり、一列に並んだ点が一斉に条件を満たす —
 * TEM の回折図形が逆格子の断面図そのものに見える理由である。
 *
 * 簡略化(図注に明示): 2 次元の断面。動力学的効果(多重散乱)は扱わない。
 * X 線と電子線で散乱の強さ・吸収がまったく違うことも扱わない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import {
  CANVAS_FONT,
  createReadout,
  drawArrow,
  drawPanelDivider,
  drawPanelLabel,
  drawScaleBar,
  splitPanels,
  withClip,
  type PanelMapper,
  type PanelRect,
} from "../reciprocal-lattice/_shared2d";
import { dashedLine, haloText, niceScaleValue } from "./_draw2d";
import { electronWavelengthNm, sagitta, waveNumber } from "./ewald";
import { A_NM } from "./constants";

/* ---------------------------------------------------------------- 定数 */

/** X 線源のプリセット(波長 nm) */
const X_SOURCES = {
  cu: { label: "Cu Kα(0.1541 nm)", lambda: 0.15406 },
  mo: { label: "Mo Kα(0.0711 nm)", lambda: 0.07107 },
} as const;
type XSourceId = keyof typeof X_SOURCES;

/** 加速電圧 V の範囲・初期値(kV) */
const KV_MIN = 60;
const KV_MAX = 300;
const KV_STEP = 5;
const KV_INIT = 200;
/** 結晶の厚さ t の範囲・初期値(nm)。許容幅は 1/t(式 E12) */
const T_MIN = 5;
const T_MAX = 100;
const T_INIT = 30;
/** 表示範囲(パネル半幅、nm⁻¹) */
const VIEW_MIN = 5.5;
const VIEW_MAX = 12;
const VIEW_INIT = 8;
/** サジッタを測る位置(nm⁻¹)。1/a = 2.5 nm⁻¹ のちょうど 2 格子ぶん */
const MEASURE_G = 5;
/** 逆格子点の見た目半径(CSS px)と点灯時の拡大率 */
const POINT_RADIUS_PX = 4.5;
const POINT_LIT_SCALE = 1.7;
/** 入射波の矢の長さ(nm⁻¹) */
const K_ARROW_LEN = 3;
/** 原点を画面のどのあたりに置くか(パネル高さに対する比。弧が上に伸びる) */
const ORIGIN_Y_RATIO = 0.34;

const TAU = Math.PI * 2;

export default function electronVsXray(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const recipFill = matColor("recip");
  const beamFill = matColor("beam");
  const beamInk = matColor("beamInk");
  const sphereFill = matColor("sphereFill");
  const sphereLine = matColor("sphereLine");
  const sphereInk = matColor("sphereInk");
  const text2 = uiColor("text2");
  const bgFill = uiColor("bg");
  const hairline = uiColor("hairline");

  /* ---- 状態(§5.7) ---- */

  let xSource: XSourceId = "cu";
  let kV = KV_INIT;
  let thickness = T_INIT;
  let viewRadius = VIEW_INIT;

  function xLambda(): number {
    return X_SOURCES[xSource].lambda;
  }
  function eLambda(): number {
    return electronWavelengthNm(kV);
  }

  /** この断面で条件を満たす点の数(原点は反射ではないので数えない) */
  function litCount(radius: number): number {
    const sMax = 1 / thickness;
    let n = 0;
    for (let h = -12; h <= 12; h++) {
      if (h === 0) continue;
      const g = Math.abs(h) / A_NM;
      if (g > viewRadius) continue;
      if (sagitta(radius, g) <= sMax) n++;
    }
    return n;
  }

  /* ---- 読み取り値(§5.7) ---- */

  const readout = createReadout(host);
  const xLambdaItem = readout.item("λ(X 線)", { color: "beam" });
  const eLambdaItem = readout.item("λ(電子線)", { color: "beam" });
  const ratioItem = readout.item("1/λ の比(電子線 / X 線)", {
    color: "sphere",
  });
  const xSagItem = readout.item(`Δ(X 線, g = ${MEASURE_G} nm⁻¹)`);
  const eSagItem = readout.item("Δ(電子線)");
  const litItem = readout.item("条件を満たす点(X 線 / 電子線)");

  function updateReadout(): void {
    const rx = waveNumber(xLambda());
    const re = waveNumber(eLambda());
    xLambdaItem.set(`${xLambda().toFixed(4)} nm`);
    eLambdaItem.set(`${(eLambda() * 1000).toFixed(3)} pm`);
    ratioItem.set(`${(re / rx).toFixed(0)} 倍`);
    xSagItem.set(`${sagitta(rx, MEASURE_G).toFixed(3)} nm⁻¹`);
    eSagItem.set(`${sagitta(re, MEASURE_G).toFixed(4)} nm⁻¹`);
    litItem.set(`${litCount(rx)} 個 / ${litCount(re)} 個`);
  }

  /* ---- 描画 ---- */

  /**
   * 1 枚のパネルを描く。逆格子面を水平線、エヴァルト球を原点で接する円弧と
   * して描く(球の中心は面の真上、距離 R)。
   */
  function drawPanel(
    panel: PanelRect,
    title: string,
    lambda: number,
    lambdaLabel: string,
  ): void {
    const R = waveNumber(lambda);
    const pxPerUnit = panel.w / 2 / viewRadius;
    // 原点はパネル下寄りに置き、上へ伸びる弧の場所を確保する
    const originY = panel.y + panel.h * (1 - ORIGIN_Y_RATIO);
    const map: PanelMapper = {
      panel,
      pxPerUnit,
      toPxX: (u) => panel.cx + u * pxPerUnit,
      toPxY: (u) => originY - u * pxPerUnit,
      toUnitX: (px) => (px - panel.cx) / pxPerUnit,
      toUnitY: (px) => (originY - px) / pxPerUnit,
    };
    const sMax = 1 / thickness;

    withClip(ctx, panel, () => {
      // 球の内側(薄い塗り)と球面(弧)。中心は (0, R)
      const cxPx = map.toPxX(0);
      const cyPx = map.toPxY(R);
      const rPx = R * pxPerUnit;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cxPx, cyPx, rPx, 0, TAU);
      ctx.fillStyle = sphereFill;
      ctx.fill();
      ctx.strokeStyle = sphereLine;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 逆格子面(晶帯軸に垂直な断面)を水平線で
      ctx.strokeStyle = hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(panel.x, map.toPxY(0));
      ctx.lineTo(panel.x + panel.w, map.toPxY(0));
      ctx.stroke();

      // 逆格子点。条件を満たす点(|s| ≤ 1/t)は大きく beam 色にする
      for (let h = -12; h <= 12; h++) {
        const g = (h / A_NM) as number;
        if (Math.abs(g) > viewRadius * 1.05) continue;
        const lit = h !== 0 && sagitta(R, Math.abs(g)) <= sMax;
        const x = map.toPxX(g);
        const y = map.toPxY(0);
        ctx.fillStyle = h === 0 ? recipFill : lit ? beamFill : recipFill;
        ctx.beginPath();
        ctx.arc(
          x,
          y,
          POINT_RADIUS_PX * (lit || h === 0 ? POINT_LIT_SCALE : 1),
          0,
          TAU,
        );
        ctx.fill();
      }

      // 入射波 k(球の中心から原点へ = 面に垂直に入る)
      drawArrow(
        ctx,
        map.toPxX(0),
        map.toPxY(K_ARROW_LEN),
        map.toPxX(0),
        map.toPxY(0),
        { color: beamFill },
      );

      // サジッタ Δ の寸法(g = MEASURE_G の位置で、面と弧のあいだ)
      if (MEASURE_G <= viewRadius) {
        const delta = sagitta(R, MEASURE_G);
        const mx = map.toPxX(MEASURE_G);
        dashedLine(ctx, mx, map.toPxY(0), mx, map.toPxY(delta + 0.6), text2);
        drawArrow(ctx, mx, map.toPxY(0), mx, map.toPxY(delta), {
          color: sphereInk,
          width: 1.5,
          head: 6,
        });
        // ラベルは測定線の左側へ寄せる(パネル右端で切れないように)
        ctx.font = CANVAS_FONT;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        haloText(
          ctx,
          `Δ = ${delta < 0.1 ? delta.toFixed(4) : delta.toFixed(2)} nm⁻¹`,
          mx - 8,
          map.toPxY(delta + 0.7),
          sphereInk,
          bgFill,
        );
      }

      // ラベル
      ctx.font = CANVAS_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      haloText(
        ctx,
        "k",
        map.toPxX(0) - 16,
        map.toPxY(K_ARROW_LEN / 2),
        beamInk,
        bgFill,
      );
      haloText(ctx, "O", map.toPxX(0) - 14, map.toPxY(0) + 16, text2, bgFill);
      ctx.textAlign = "right";
      haloText(
        ctx,
        `R = 1/λ = ${R < 100 ? R.toFixed(2) : R.toFixed(0)} nm⁻¹`,
        panel.x + panel.w - 22,
        map.toPxY(0) + 22,
        sphereInk,
        bgFill,
      );
    });

    drawPanelLabel(ctx, panel, `${title} — ${lambdaLabel}`);
    const bar = niceScaleValue(viewRadius);
    drawScaleBar(ctx, panel, pxPerUnit, bar, `${bar} nm⁻¹`);
  }

  function draw(): void {
    const { w: sw, h: sh, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sw, sh);

    const split = splitPanels(host.size);
    drawPanelDivider(ctx, host.size, split);
    drawPanel(split.first, "X 線", xLambda(), `λ = ${xLambda().toFixed(4)} nm`);
    drawPanel(
      split.second,
      "電子線",
      eLambda(),
      `${kV} kV, λ = ${(eLambda() * 1000).toFixed(2)} pm`,
    );
  }

  /* ---- 操作部品(§5.7) ---- */

  const sourceControl = host.controls.segmented<XSourceId>({
    id: "xsource",
    label: "X 線源",
    options: [
      { value: "cu", label: X_SOURCES.cu.label },
      { value: "mo", label: X_SOURCES.mo.label },
    ],
    value: "cu",
  });
  sourceControl.onChange((v) => {
    xSource = v;
    updateReadout();
    host.requestRender();
  });

  const kvSlider = host.controls.slider({
    id: "kv",
    label: "加速電圧 V",
    min: KV_MIN,
    max: KV_MAX,
    step: KV_STEP,
    value: KV_INIT,
    unit: "kV",
  });
  kvSlider.onChange((v) => {
    kV = v;
    updateReadout();
    host.requestRender();
  });

  const thicknessSlider = host.controls.slider({
    id: "t",
    label: "結晶の厚さ t",
    min: T_MIN,
    max: T_MAX,
    step: 1,
    value: T_INIT,
    unit: "nm",
  });
  thicknessSlider.onChange((v) => {
    thickness = v;
    updateReadout();
    host.requestRender();
  });

  const viewSlider = host.controls.slider({
    id: "view",
    label: "表示範囲",
    min: VIEW_MIN,
    max: VIEW_MAX,
    step: 0.5,
    value: VIEW_INIT,
    unit: "nm⁻¹",
  });
  viewSlider.onChange((v) => {
    viewRadius = v;
    updateReadout();
    host.requestRender();
  });

  host.controls.reset(() => {
    sourceControl.set("cu");
    kvSlider.set(KV_INIT);
    thicknessSlider.set(T_INIT);
    viewSlider.set(VIEW_INIT);
  });

  /* ---- 初期化と描画登録(requestRender 型 — §5.7) ---- */

  host.onRender(draw);
  updateReadout();

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
