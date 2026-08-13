/**
 * bragg-vs-laue.ts — 図1「同じ条件を、二つの言葉で」(仕様書 04 §5.1)
 *
 * 左パネルに実空間のブラッグの絵(間隔 d の格子面・入射線と反射線・光路差
 * 2d sinθ と波長 λ の物差し)、右パネルに逆空間のラウエの絵(k, k′, Δk と
 * 逆格子点の列)を描き、**同じ 1 つの条件を 2 つの言葉で書いたもの**である
 * ことを見せる。θ を動かすと両パネルが同時に応え、2d sinθ = λ の瞬間に
 * Δk の先端が逆格子点に着地する(式 E2・E6・E7・E8)。
 *
 * 慣習(§2.3): |k| = 1/λ、|g| = 1/d。2π は付けない。
 *
 * 簡略化(図注に明示): 2 次元の断面。原子は点として描き、熱振動・吸収は
 * 無視する。強度は扱わない — 線の太さは一致の印であって強度ではない。
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
  makeMapper,
  splitPanels,
  withClip,
  type PanelMapper,
} from "../reciprocal-lattice/_shared2d";
import {
  angleArc,
  CANVAS_FONT_LARGE,
  dashedLine,
  drawBadge,
  haloText,
  niceScaleValue,
} from "./_draw2d";
import { braggAngleDeg, scatteringVectorLength, waveNumber } from "./ewald";

/* ---------------------------------------------------------------- 定数 */

/** 入射角 θ の範囲・初期値・刻み(°) */
const THETA_MIN = 5;
const THETA_MAX = 75;
const THETA_STEP = 0.1;
const THETA_INIT = 15;
/** 面間隔 d の範囲・初期値・刻み(nm) */
const D_MIN = 0.12;
const D_MAX = 0.4;
const D_STEP = 0.005;
const D_INIT = 0.2;
/** 波長 λ の範囲・初期値・刻み(nm) */
const LAMBDA_MIN = 0.05;
const LAMBDA_MAX = 0.3;
const LAMBDA_STEP = 0.002;
/** Cu Kα(§5.1 の初期値) */
const LAMBDA_INIT = 0.154;
/** 一致判定の許容幅(nm⁻¹ — §5.1) */
const MATCH_TOLERANCE = 0.02;

/** 実空間パネルの表示半径(nm)。パネル短辺の半分がこの長さに対応する */
const REAL_VIEW_RADIUS_NM = 0.52;
/** 描く格子面の枚数と、面上の原子の間隔(nm。模式であり実寸比ではない) */
const PLANE_COUNT = 4;
const ATOM_SPACING_NM = 0.1;
const ATOM_RADIUS_PX = 3.2;
/** 光線の長さ(nm) */
const RAY_LENGTH_NM = 0.85;
/** 逆空間パネルの表示半径を決める余裕(最大の量に対する倍率) */
const RECIP_VIEW_MARGIN = 1.3;
/** 逆格子点の見た目半径(CSS px)と、一致時の拡大率 */
const RECIP_RADIUS_PX = 5;
const RECIP_MATCH_SCALE = 1.6;
/** ゴースト逆格子点の不透明度 */
const GHOST_ALPHA = 0.3;
/** 物差し(λ と光路差)のバーの太さ・間隔(px) */
const RULER_BAR_HEIGHT = 7;
const RULER_GAP = 20;
/** 反射線を太くする幅(一致の印。強度ではない — 図注) */
const RAY_WIDTH = 2;
const RAY_WIDTH_MATCH = 3.5;

const DEG = Math.PI / 180;

const MATCH_BADGE = "回折が起きる";
const NO_SOLUTION_MESSAGE = "この面間隔では、この波長は回折できません(λ > 2d)";

export default function braggVsLaue(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(母体仕様 §6.2)
  const matrixFill = matColor("matrix");
  const beamFill = matColor("beam");
  const beamInk = matColor("beamInk");
  const recipFill = matColor("recip");
  const text2 = uiColor("text2");
  const bgFill = uiColor("bg");
  const hairline = uiColor("hairline");

  /* ---- 状態 ---- */

  let theta = THETA_INIT; // 入射角(°、面から測る)
  let d = D_INIT; // 面間隔(nm)
  let lambda = LAMBDA_INIT; // 波長(nm)

  /** 一致しているか(|Δk| と |g| の差が許容幅以内 — §5.1) */
  function isMatched(): boolean {
    return (
      Math.abs(scatteringVectorLength(theta, lambda) - 1 / d) <= MATCH_TOLERANCE
    );
  }

  /* ---- 読み取り値(§5.1) ---- */

  const readout = createReadout(host);
  const pathItem = readout.item("2d sinθ");
  const lambdaItem = readout.item("λ", { color: "beam" });
  const dkItem = readout.item("|Δk|", { color: "recip" });
  const gItem = readout.item("|g| = 1/d", { color: "recip" });
  const verdictItem = readout.item("判定");

  function updateReadout(): void {
    const path = 2 * d * Math.sin(theta * DEG);
    const dk = scatteringVectorLength(theta, lambda);
    const g = 1 / d;
    pathItem.set(`${path.toFixed(4)} nm`);
    lambdaItem.set(`${lambda.toFixed(3)} nm`);
    dkItem.set(`${dk.toFixed(3)} nm⁻¹`);
    gItem.set(`${g.toFixed(3)} nm⁻¹`);
    if (isMatched()) {
      verdictItem.set("一致(回折が起きる)");
    } else if (braggAngleDeg(d, lambda) === null) {
      verdictItem.set("λ > 2d のため解なし");
    } else {
      verdictItem.set(`差 ${(dk - g).toFixed(3)} nm⁻¹`);
    }
  }

  /* ---- 左パネル: 実空間のブラッグの絵 ---- */

  /** 格子面(水平線)と面上の原子 */
  function drawPlanes(map: PanelMapper): void {
    const halfSpan = (map.panel.w / 2 / map.pxPerUnit) * 1.1;
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j < PLANE_COUNT; j++) {
      const y = map.toPxY(-j * d);
      ctx.moveTo(map.toPxX(-halfSpan), y);
      ctx.lineTo(map.toPxX(halfSpan), y);
    }
    ctx.stroke();
    // 面上の原子(まとめ描き — 母体仕様 §8.3)
    ctx.beginPath();
    const iMax = Math.ceil(halfSpan / ATOM_SPACING_NM);
    for (let j = 0; j < PLANE_COUNT; j++) {
      const y = map.toPxY(-j * d);
      for (let i = -iMax; i <= iMax; i++) {
        const x = map.toPxX(i * ATOM_SPACING_NM);
        ctx.moveTo(x + ATOM_RADIUS_PX, y);
        ctx.arc(x, y, ATOM_RADIUS_PX, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = matrixFill;
    ctx.fill();
    // 面間隔 d の寸法(左端に縦の両矢印)
    const dimX = map.toPxX(-halfSpan * 0.82);
    drawArrow(ctx, dimX, map.toPxY(0), dimX, map.toPxY(-d), {
      color: text2,
      width: 1.5,
      head: 6,
    });
    drawArrow(ctx, dimX, map.toPxY(-d), dimX, map.toPxY(0), {
      color: text2,
      width: 1.5,
      head: 6,
    });
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    haloText(
      ctx,
      `d = ${d.toFixed(3)} nm`,
      dimX + 8,
      map.toPxY(-d / 2),
      text2,
      bgFill,
    );
  }

  /**
   * 2 本の平行な光線と、光路差 2d sinθ の作図(§5.1)。
   * 上の面で反射する点 A = (0, 0)、下の面で反射する点 B = (0, −d)。
   * A から下の光線に下ろした垂線の足 C・D の間が、余分に進む距離になる。
   */
  function drawRays(map: PanelMapper, matched: boolean): void {
    const th = theta * DEG;
    const ci = Math.cos(th);
    const si = Math.sin(th);
    // 入射方向(右下向き)と出射方向(右上向き)
    const inX = ci;
    const inY = -si;
    const outX = ci;
    const outY = si;
    const L = RAY_LENGTH_NM;

    const px = (x: number, y: number): [number, number] => [
      map.toPxX(x),
      map.toPxY(y),
    ];

    const drawRay = (bx: number, by: number): void => {
      const [sx, sy] = px(bx - inX * L, by - inY * L);
      const [hx, hy] = px(bx, by);
      const [ex, ey] = px(bx + outX * L, by + outY * L);
      ctx.strokeStyle = beamFill;
      ctx.lineWidth = matched ? RAY_WIDTH_MATCH : RAY_WIDTH;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      drawArrow(ctx, hx, hy, ex, ey, {
        color: beamFill,
        width: matched ? RAY_WIDTH_MATCH : RAY_WIDTH,
      });
    };

    drawRay(0, 0);
    drawRay(0, -d);

    // 垂線の足 C(入射側)と D(出射側)。|CB| = |BD| = d sinθ
    const cx = -d * si * inX;
    const cy = -d + d * si * si;
    const dx = d * si * outX;
    const dy = -d + d * si * outY;
    const [ax, ay] = px(0, 0);
    const [cxp, cyp] = px(cx, cy);
    const [dxp, dyp] = px(dx, dy);
    const [bxp, byp] = px(0, -d);
    dashedLine(ctx, ax, ay, cxp, cyp, text2);
    dashedLine(ctx, ax, ay, dxp, dyp, text2);
    // 余分に進む 2 本の区間を強調する(この 2 本の合計が 2d sinθ)
    ctx.strokeStyle = beamInk;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cxp, cyp);
    ctx.lineTo(bxp, byp);
    ctx.lineTo(dxp, dyp);
    ctx.stroke();
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    haloText(
      ctx,
      "この 2 本が余分な道のり = 2d sinθ",
      bxp,
      byp + 10,
      beamInk,
      bgFill,
    );

    // 入射角 θ の弧(面と入射線のあいだ)
    angleArc(ctx, ax, ay, 26, Math.PI, Math.PI + th, text2);
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    haloText(ctx, `θ = ${theta.toFixed(1)}°`, ax - 32, ay - 8, text2, bgFill);
  }

  /** 光路差 2d sinθ と波長 λ を、同じ縮尺の 2 本のバーで並べる(§5.1) */
  function drawRulers(map: PanelMapper): void {
    const path = 2 * d * Math.sin(theta * DEG);
    const p = map.panel;
    const x0 = p.x + 16;
    const yBase = p.y + p.h - 42;
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    ctx.fillStyle = beamInk;
    ctx.fillRect(x0, yBase, path * map.pxPerUnit, RULER_BAR_HEIGHT);
    haloText(
      ctx,
      `光路差 2d sinθ = ${path.toFixed(3)} nm`,
      x0 + path * map.pxPerUnit + 8,
      yBase + RULER_BAR_HEIGHT / 2,
      text2,
      bgFill,
    );

    const yLambda = yBase + RULER_GAP;
    ctx.fillStyle = beamFill;
    ctx.fillRect(x0, yLambda, lambda * map.pxPerUnit, RULER_BAR_HEIGHT);
    haloText(
      ctx,
      `λ = ${lambda.toFixed(3)} nm`,
      x0 + lambda * map.pxPerUnit + 8,
      yLambda + RULER_BAR_HEIGHT / 2,
      text2,
      bgFill,
    );
  }

  /* ---- 右パネル: 逆空間のラウエの絵 ---- */

  /** 表示半径(nm⁻¹)。k・g・Δk がすべて収まるよう自動で決める */
  function recipViewRadius(): number {
    return (
      Math.max(
        waveNumber(lambda),
        1 / d,
        scatteringVectorLength(theta, lambda),
      ) * RECIP_VIEW_MARGIN
    );
  }

  function drawReciprocal(map: PanelMapper, matched: boolean): void {
    const th = theta * DEG;
    const R = waveNumber(lambda);
    // k は入射方向、k′ は出射方向。どちらも長さ 1/λ(弾性散乱 — 式 E4)
    const inX = Math.cos(th);
    const inY = -Math.sin(th);
    const outX = Math.cos(th);
    const outY = Math.sin(th);
    // 球の中心 C = O − k
    const cX = -R * inX;
    const cY = -R * inY;
    // Δk = k′ − k の先端(O を根元に置く)
    const pX = cX + R * outX;
    const pY = cY + R * outY;

    const ox = map.toPxX(0);
    const oy = map.toPxY(0);

    // 逆格子点の列(この面族に対応する g = n/d の並び — §5.1)
    ctx.fillStyle = recipFill;
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.beginPath();
    for (let n = -2; n <= 3; n++) {
      if (n === 0) continue;
      const x = map.toPxX(0);
      const y = map.toPxY(n / d);
      ctx.moveTo(x + RECIP_RADIUS_PX, y);
      ctx.arc(x, y, RECIP_RADIUS_PX, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // 原点 O
    ctx.fillStyle = recipFill;
    ctx.beginPath();
    ctx.arc(ox, oy, RECIP_RADIUS_PX * 1.4, 0, Math.PI * 2);
    ctx.fill();

    // 注目する逆格子点 g = (0, 1/d)
    const gx = map.toPxX(0);
    const gy = map.toPxY(1 / d);
    ctx.beginPath();
    ctx.arc(
      gx,
      gy,
      RECIP_RADIUS_PX * (matched ? RECIP_MATCH_SCALE : 1),
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // k(C → O)と k′(C → P)
    drawArrow(ctx, map.toPxX(cX), map.toPxY(cY), ox, oy, { color: beamFill });
    drawArrow(ctx, map.toPxX(cX), map.toPxY(cY), map.toPxX(pX), map.toPxY(pY), {
      color: beamFill,
    });
    // Δk(O → P)
    drawArrow(ctx, ox, oy, map.toPxX(pX), map.toPxY(pY), { color: recipFill });

    ctx.font = CANVAS_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    haloText(
      ctx,
      "k",
      (map.toPxX(cX) + ox) / 2,
      (map.toPxY(cY) + oy) / 2 + 14,
      beamInk,
      bgFill,
    );
    haloText(
      ctx,
      "k′",
      (map.toPxX(cX) + map.toPxX(pX)) / 2,
      (map.toPxY(cY) + map.toPxY(pY)) / 2 - 14,
      beamInk,
      bgFill,
    );
    haloText(ctx, "Δk", ox + 22, (oy + map.toPxY(pY)) / 2, recipFill, bgFill);
    haloText(ctx, "g", gx - 20, gy, recipFill, bgFill);
    haloText(ctx, "O", ox - 16, oy + 14, text2, bgFill);
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w: sw, h: sh, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sw, sh);

    const split = splitPanels(host.size);
    drawPanelDivider(ctx, host.size, split);
    const matched = isMatched();

    // 左 = 実空間
    const real = split.first;
    const realMap = makeMapper(
      real,
      Math.min(real.w, real.h) / 2 / REAL_VIEW_RADIUS_NM,
    );
    withClip(ctx, real, () => {
      drawPlanes(realMap);
      drawRays(realMap, matched);
      drawRulers(realMap);
    });
    drawPanelLabel(ctx, real, "実空間 — ブラッグの絵");

    // 右 = 逆空間
    const recip = split.second;
    const viewRadius = recipViewRadius();
    const recipMap = makeMapper(
      recip,
      Math.min(recip.w, recip.h) / 2 / viewRadius,
    );
    withClip(ctx, recip, () => {
      drawReciprocal(recipMap, matched);
    });
    drawPanelLabel(ctx, recip, "逆空間 — ラウエの絵");
    const bar = niceScaleValue(viewRadius);
    drawScaleBar(ctx, recip, recipMap.pxPerUnit, bar, `${bar} nm⁻¹`);

    // 一致バッジ / 解なしのメッセージ
    if (matched) {
      drawBadge(ctx, (real.cx + recip.cx) / 2, 8, MATCH_BADGE, bgFill, beamInk);
    } else if (braggAngleDeg(d, lambda) === null) {
      ctx.font = CANVAS_FONT_LARGE;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      haloText(
        ctx,
        NO_SOLUTION_MESSAGE,
        (real.cx + recip.cx) / 2,
        10,
        text2,
        bgFill,
      );
    }
  }

  /* ---- 操作部品(§5.1) ---- */

  const thetaSlider = host.controls.slider({
    id: "theta",
    label: "入射角 θ",
    min: THETA_MIN,
    max: THETA_MAX,
    step: THETA_STEP,
    value: THETA_INIT,
    unit: "°",
  });
  thetaSlider.onChange((v) => {
    theta = v;
    updateReadout();
    host.requestRender();
  });

  const dSlider = host.controls.slider({
    id: "d",
    label: "面間隔 d",
    min: D_MIN,
    max: D_MAX,
    step: D_STEP,
    value: D_INIT,
    unit: "nm",
  });
  dSlider.onChange((v) => {
    d = v;
    updateReadout();
    updateBraggButton();
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
    updateReadout();
    updateBraggButton();
    host.requestRender();
  });

  const braggButton = host.controls.button({ label: "ブラッグ角に合わせる" });
  braggButton.onClick(() => {
    const angle = braggAngleDeg(d, lambda);
    if (angle === null) return;
    // set() が onChange と再描画を呼ぶ
    thetaSlider.set(angle);
  });

  /** λ > 2d では解がないのでボタンを無効化する(§5.1) */
  function updateBraggButton(): void {
    const angle = braggAngleDeg(d, lambda);
    braggButton.el.disabled =
      angle === null || angle < THETA_MIN || angle > THETA_MAX;
  }

  host.controls.reset(() => {
    thetaSlider.set(THETA_INIT);
    dSlider.set(D_INIT);
    lambdaSlider.set(LAMBDA_INIT);
  });

  /* ---- 初期化と描画登録(requestRender 型 — §5.1) ---- */

  host.onRender(draw);
  updateReadout();
  updateBraggButton();

  return {
    // レイアウト依存値は draw() 内で毎回再計算するので resize 処理は不要
    destroy(): void {
      readout.el.remove();
    },
  };
}
