/**
 * planes-2d.ts — 図4「点は面の族」(仕様書 05 §5.4)
 *
 * 左パネルに正方格子と選択中 (hk) の格子線族(面法線の矢印と間隔 d の
 * 寸法線付き)、右パネルに逆格子点の全体(ゴースト)と選択点の g 矢印を
 * 描き、「逆格子点 1 つ = 向きと間隔をもつ面(線)の族 1 つ」の対応を
 * 見せる。d = 1/|g|(式 E5・E6)を読み取り値 d×|g| = 1.00 で確認する。
 *
 * 簡略化: 格子は 2 次元の正方格子。線族は g·r = n(n ∈ ℤ)の直線群として
 * 厳密に描き、(20) などの高次では原子を通らない中間の線も同格で描く
 * (図2 の 2 倍波 n/a への接続 — §5.4)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { set2, vec2 } from "../../core/mathx";
import { matColor, uiColor } from "../../core/colors";
import { dCubic, latticePointsInDisk } from "./lattice";
import {
  CANVAS_FONT,
  createReadout,
  createStepper,
  drawArrow,
  drawAtoms,
  drawPanelDivider,
  drawPanelLabel,
  drawScaleBar,
  makeMapper,
  splitPanels,
  withClip,
  type PanelMapper,
} from "./_shared2d";

/** ミラー指数 h, k の範囲・初期値(§5.4: −3〜3、初期 (1, 0)) */
const HK_MIN = -3;
const HK_MAX = 3;
const H_INIT = 1;
const K_INIT = 0;
/** 格子定数 a の範囲・初期値・刻み(nm) */
const A_MIN = 0.3;
const A_MAX = 0.5;
const A_STEP = 0.01;
const A_INIT = 0.4;
/** 実空間パネルの表示半径(nm)。パネル短辺の半分がこの長さに対応する */
const REAL_VIEW_RADIUS_NM = 2.4;
/** 実空間の円形窓の半径(nm)。この中の原子だけを描く */
const DISK_RADIUS_NM = 2.15;
/** 逆空間パネルの表示半径(nm⁻¹) */
const RECIP_VIEW_RADIUS = 11;
/** 原子の見た目半径(CSS px) */
const ATOM_RADIUS_PX = 6;
/** ゴースト逆格子点の見た目半径と不透明度(§5.4) */
const GHOST_RADIUS_PX = 3.5;
const GHOST_ALPHA = 0.28;
/** 選択中の逆格子点の見た目半径(CSS px) */
const SELECTED_RADIUS_PX = 5.5;
/** 格子線族の不透明度・線幅(§5.4: recip 60%・1.5px) */
const LINE_ALPHA = 0.6;
const LINE_WIDTH = 1.5;
/** 面法線方向の短い矢印の長さ(nm) */
const NORMAL_ARROW_NM = 0.55;
/** 寸法線を原点から線族の方向へずらす距離(nm)。見やすさのための配置 */
const DIM_OFFSET_NM = 0.9;
/** 寸法線の線幅・矢印先端(px)。先端は線分長に対して大きすぎないよう制限 */
const DIM_LINE_WIDTH = 1.5;
const DIM_HEAD_PX = 6;
const DIM_HEAD_MAX_RATIO = 0.35;
/** 寸法線ラベル・g ラベルを線・点から離す距離(px) */
const DIM_LABEL_GAP_PX = 16;
const G_LABEL_GAP_PX = 14;
/** テキストの白ふち取りの太さ(px)。格子や点の上でも可読性を保つ */
const HALO_WIDTH = 3;
/** スケールバーの長さ(左: nm、右: nm⁻¹ — §5.0) */
const SCALEBAR_REAL_NM = 1;
const SCALEBAR_RECIP = 5;
/** 点タップの当たり判定半径(px — §5.4) */
const TAP_RADIUS_PX = 18;
/** 原子バッファの上限。a = 0.30 nm の円窓でも約 160 点なので十分 */
const MAX_ATOMS = 240;

/** (00) 選択時の説明文と、その表示フォント(14px — §5.4) */
const ZERO_MESSAGE = "(00) は一様成分(面はない)";
const MESSAGE_FONT = CANVAS_FONT.replace("12px", "14px");

/** 下付き数字(₀₁₂₃)と下付きマイナス(₋)。g ラベルの指数表記に使う */
const SUB_DIGITS = ["₀", "₁", "₂", "₃"] as const;
const SUB_MINUS = "₋";

const TAU = Math.PI * 2;

/** 指数 1 つを Unicode 下付き文字にする(|n| ≤ 3) */
function subscript(n: number): string {
  return (n < 0 ? SUB_MINUS : "") + SUB_DIGITS[Math.abs(n)];
}

/** 白ふち取り付きテキスト(halo で下地を消してから fill で描く) */
function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  halo: string,
): void {
  ctx.strokeStyle = halo;
  ctx.lineWidth = HALO_WIDTH;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export default function planes2d(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(§6.2)
  const matrixFill = matColor("matrix");
  const recipFill = matColor("recip");
  const text2 = uiColor("text2");
  const bgFill = uiColor("bg");

  /* ---- 状態 ---- */

  let h = H_INIT; // ミラー指数 h
  let k = K_INIT; // ミラー指数 k
  let a = A_INIT; // 格子定数(nm)

  // 正方格子の基底と円形窓内の原子位置(a 変更時のみ再生成 — §5.4)
  const a1 = vec2(A_INIT, 0);
  const a2 = vec2(0, A_INIT);
  const atomXY = new Float64Array(MAX_ATOMS * 2);
  let atomCount = 0;

  // 状態変更時に組み立てるラベル文字列(毎描画の文字列生成を避ける)
  let gLabelText = "";
  let dimLabelText = "";

  function rebuildAtoms(): void {
    set2(a1, a, 0);
    set2(a2, 0, a);
    atomCount = latticePointsInDisk(a1, a2, DISK_RADIUS_NM, atomXY);
  }

  /* ---- 読み取り値(§5.4: (hk) / d / |g| / d×|g|) ---- */

  const readout = createReadout(host);
  const hkItem = readout.item("(hk)");
  const dItem = readout.item("d");
  const gItem = readout.item("|g|", { color: "recip" });
  const prodItem = readout.item("d×|g|");

  /** 状態(h, k, a)から読み取り値とキャンバス用ラベルを更新する */
  function updateDerived(): void {
    hkItem.set(`(${h} ${k})`);
    if (h === 0 && k === 0) {
      // (00) は一様成分: 面がないので d と d×|g| は定義しない(§5.4)
      dItem.set("—");
      gItem.set("0.00 nm⁻¹");
      prodItem.set("—");
      gLabelText = "";
      dimLabelText = "";
      return;
    }
    // 2D 正方格子の d は l = 0 の式 E10 と同形: d = a/√(h²+k²)
    const d = dCubic(h, k, 0, a);
    const gAbs = Math.hypot(h, k) / a;
    dItem.set(`${d.toFixed(3)} nm`);
    gItem.set(`${gAbs.toFixed(2)} nm⁻¹`);
    prodItem.set((d * gAbs).toFixed(2)); // 常に 1.00(式 E6: d = 1/|g|)
    gLabelText = `g${subscript(h)}${subscript(k)}`;
    dimLabelText = `d = ${d.toFixed(2)} nm`;
  }

  /* ---- 描画 ---- */

  /** 選択中 (hk) の格子線族: 直線 g·r = n(n は窓を覆う範囲 — §5.4) */
  function drawLineFamily(map: PanelMapper): void {
    const gx = h / a;
    const gy = k / a;
    const g2 = gx * gx + gy * gy;
    const gAbs = Math.sqrt(g2);
    // 線の方向(単位ベクトル)と、隣の線への間隔ベクトル(長さ d)
    const ux = -gy / gAbs;
    const uy = gx / gAbs;
    const sx = gx / g2;
    const sy = gy / g2;
    const p = map.panel;
    // パネル対角の半分(世界座標)。この範囲の n をすべて描けば窓を覆う
    const halfDiag = Math.hypot(p.w, p.h) / 2 / map.pxPerUnit;
    const nMax = Math.ceil(gAbs * halfDiag);
    ctx.globalAlpha = LINE_ALPHA;
    ctx.strokeStyle = recipFill;
    ctx.lineWidth = LINE_WIDTH;
    ctx.beginPath();
    for (let n = -nMax; n <= nMax; n++) {
      // 直線 g·r = n は r_n = n g/|g|² を通り、方向は (-gy, gx)/|g|
      const cx = n * sx;
      const cy = n * sy;
      ctx.moveTo(map.toPxX(cx - ux * halfDiag), map.toPxY(cy - uy * halfDiag));
      ctx.lineTo(map.toPxX(cx + ux * halfDiag), map.toPxY(cy + uy * halfDiag));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** 面法線方向(= g 方向)の短い矢印。線族との直交は構成上厳密 */
  function drawNormalArrow(map: PanelMapper): void {
    const gAbs = Math.hypot(h, k) / a;
    const gux = h / a / gAbs;
    const guy = k / a / gAbs;
    drawArrow(
      ctx,
      map.toPxX(0),
      map.toPxY(0),
      map.toPxX(gux * NORMAL_ARROW_NM),
      map.toPxY(guy * NORMAL_ARROW_NM),
      { color: recipFill },
    );
  }

  /** 隣接 2 線(n = 0 と n = 1)の間の寸法線とラベル "d = …" */
  function drawDimension(map: PanelMapper): void {
    const gx = h / a;
    const gy = k / a;
    const g2 = gx * gx + gy * gy;
    const gAbs = Math.sqrt(g2);
    const ux = -gy / gAbs;
    const uy = gx / gAbs;
    // 原点から線族に沿って少しずらした位置に、法線方向の線分を描く
    const ax = ux * DIM_OFFSET_NM;
    const ay = uy * DIM_OFFSET_NM;
    const bx = ax + gx / g2;
    const by = ay + gy / g2;
    const x0 = map.toPxX(ax);
    const y0 = map.toPxY(ay);
    const x1 = map.toPxX(bx);
    const y1 = map.toPxY(by);
    // 両端矢印(高次で d が小さいときは先端を線分長に合わせて縮める)
    const lenPx = Math.hypot(x1 - x0, y1 - y0);
    const head = Math.min(DIM_HEAD_PX, lenPx * DIM_HEAD_MAX_RATIO);
    drawArrow(ctx, x0, y0, x1, y1, {
      color: text2,
      width: DIM_LINE_WIDTH,
      head,
    });
    drawArrow(ctx, x1, y1, x0, y0, {
      color: text2,
      width: DIM_LINE_WIDTH,
      head,
    });
    // ラベルは寸法線の横(線族の方向へ少し離す)
    const lx = (x0 + x1) / 2 + ux * DIM_LABEL_GAP_PX;
    const ly = (y0 + y1) / 2 - uy * DIM_LABEL_GAP_PX;
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    haloText(ctx, dimLabelText, lx, ly, text2, bgFill);
  }

  function draw(): void {
    const { w: sw, h: sh, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sw, sh);

    const split = splitPanels(host.size);
    drawPanelDivider(ctx, host.size, split);

    // 左パネル = 実空間(正方格子 + 選択中 (hk) の線族)
    const real = split.first;
    const realMap = makeMapper(
      real,
      Math.min(real.w, real.h) / 2 / REAL_VIEW_RADIUS_NM,
    );
    withClip(ctx, real, () => {
      drawAtoms(ctx, atomXY, atomCount, realMap, ATOM_RADIUS_PX, matrixFill);
      if (h !== 0 || k !== 0) {
        drawLineFamily(realMap);
        drawNormalArrow(realMap);
        drawDimension(realMap);
      } else {
        // (00): 線族・矢印・寸法線は描かず、説明を表示する(§5.4)
        ctx.font = MESSAGE_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        haloText(ctx, ZERO_MESSAGE, real.cx, real.cy, text2, bgFill);
      }
    });
    drawPanelLabel(ctx, real, "実空間");
    drawScaleBar(ctx, real, realMap.pxPerUnit, SCALEBAR_REAL_NM, "1 nm");

    // 右パネル = 逆空間(全点のゴースト + 選択点と g 矢印)
    const recip = split.second;
    const recipMap = makeMapper(
      recip,
      Math.min(recip.w, recip.h) / 2 / RECIP_VIEW_RADIUS,
    );
    withClip(ctx, recip, () => {
      // |h|,|k| ≤ 3 の全逆格子点 (h/a, k/a) をゴースト表示(§5.4)
      ctx.fillStyle = recipFill;
      ctx.globalAlpha = GHOST_ALPHA;
      ctx.beginPath();
      for (let hh = -HK_MAX; hh <= HK_MAX; hh++) {
        for (let kk = -HK_MAX; kk <= HK_MAX; kk++) {
          const x = recipMap.toPxX(hh / a);
          const y = recipMap.toPxY(kk / a);
          ctx.moveTo(x + GHOST_RADIUS_PX, y);
          ctx.arc(x, y, GHOST_RADIUS_PX, 0, TAU);
        }
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      // 原点からの g 矢印(選択点の下に描く)とラベル g_hk
      const tipX = recipMap.toPxX(h / a);
      const tipY = recipMap.toPxY(k / a);
      if (h !== 0 || k !== 0) {
        const ox = recipMap.toPxX(0);
        const oy = recipMap.toPxY(0);
        drawArrow(ctx, ox, oy, tipX, tipY, { color: recipFill });
        const len = Math.hypot(tipX - ox, tipY - oy);
        const lx = tipX + ((tipX - ox) / len) * G_LABEL_GAP_PX;
        const ly = tipY + ((tipY - oy) / len) * G_LABEL_GAP_PX;
        ctx.font = CANVAS_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        haloText(ctx, gLabelText, lx, ly, recipFill, bgFill);
      }
      // 選択点の強調(不透明・大きめ — §5.4)
      ctx.fillStyle = recipFill;
      ctx.beginPath();
      ctx.arc(tipX, tipY, SELECTED_RADIUS_PX, 0, TAU);
      ctx.fill();
    });
    drawPanelLabel(ctx, recip, "逆空間");
    drawScaleBar(ctx, recip, recipMap.pxPerUnit, SCALEBAR_RECIP, "5 nm⁻¹");
  }

  /* ---- 操作部品(§5.4: h / k ステッパと a スライダー。reset は置かない) ---- */

  const hStepper = createStepper(host, {
    label: "h",
    min: HK_MIN,
    max: HK_MAX,
    value: H_INIT,
  });
  hStepper.onChange((v) => {
    h = v;
    updateDerived();
    // 再描画はステッパ内部の host.requestRender() が要求する
  });

  const kStepper = createStepper(host, {
    label: "k",
    min: HK_MIN,
    max: HK_MAX,
    value: K_INIT,
  });
  kStepper.onChange((v) => {
    k = v;
    updateDerived();
  });

  const aSlider = host.controls.slider({
    id: "a",
    label: "格子定数 a",
    min: A_MIN,
    max: A_MAX,
    step: A_STEP,
    value: A_INIT,
    unit: "nm",
  });
  aSlider.onChange((v) => {
    a = v;
    rebuildAtoms();
    updateDerived();
    host.requestRender();
  });

  /* ---- 右パネルの点タップで選択(近道。キーボード経路はステッパ — §5.4) ---- */

  function onCanvasClick(e: MouseEvent): void {
    const p = splitPanels(host.size).second;
    const x = e.offsetX;
    const y = e.offsetY;
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) return;
    const map = makeMapper(p, Math.min(p.w, p.h) / 2 / RECIP_VIEW_RADIUS);
    // 最寄りのゴースト点を探し、18px 以内ならステッパへ反映(双方向同期)
    let bestDist = TAP_RADIUS_PX;
    let bestH = h;
    let bestK = k;
    let found = false;
    for (let hh = -HK_MAX; hh <= HK_MAX; hh++) {
      for (let kk = -HK_MAX; kk <= HK_MAX; kk++) {
        const d = Math.hypot(map.toPxX(hh / a) - x, map.toPxY(kk / a) - y);
        if (d <= bestDist) {
          bestDist = d;
          bestH = hh;
          bestK = kk;
          found = true;
        }
      }
    }
    if (found) {
      // set() が onChange と host.requestRender() を呼ぶ(値が同じなら何もしない)
      hStepper.set(bestH);
      kStepper.set(bestK);
    }
  }
  host.canvas.addEventListener("click", onCanvasClick);

  /* ---- 初期化と描画登録(requestRender 型 — §5.4) ---- */

  host.onRender(draw);
  rebuildAtoms();
  updateDerived();

  return {
    // レイアウト依存値は draw() 内で毎回再計算するので resize 処理は不要
    // (resize 通知後に engine が 1 フレーム描く)
    destroy(): void {
      host.canvas.removeEventListener("click", onCanvasClick);
      readout.el.remove();
      hStepper.el.remove();
      kStepper.el.remove();
    },
  };
}
