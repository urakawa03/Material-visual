/**
 * intro-duality.ts — 図1「結晶のもうひとつの姿」(仕様書 05 §5.1)
 *
 * 左パネルに実格子(円形窓内の原子)、右パネルにその逆格子点を描き、
 * 回転・格子定数・格子タイプの変更に両者がどう応答するかを見せる。
 * 「向きは連動するのに、大きさは逆に動く」という謎の提示が本図の目的。
 *
 * 逆格子点は回転後の基底から dualBasis2(式 E8)で厳密に計算する
 * (飾りではない)。点の濃淡の減衰 exp(−|g|²/g₀²) だけは見やすさの
 * ための装飾で、回折強度ではない(図注で明示 — §5.1)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { set2, vec2 } from "../../core/mathx";
import { matColor } from "../../core/colors";
import { dualBasis2, latticePointsInDisk } from "./lattice";
import {
  createReadout,
  drawAtoms,
  drawPanelDivider,
  drawPanelLabel,
  drawScaleBar,
  makeMapper,
  splitPanels,
  withClip,
} from "./_shared2d";

/** 格子タイプ(§5.1: 正方 / 長方 b = 1.4a / 斜交 γ = 105°) */
type LatticeType = "square" | "rect" | "oblique";

/** 回転角 θ の初期値(°) */
const THETA_INIT = -15;
/** θ スライダーの範囲・刻み(°) */
const THETA_MIN = -180;
const THETA_MAX = 180;
const THETA_STEP = 1;
/** 自動回転の速さ(°/s — §5.1) */
const AUTO_DEG_PER_SEC = 4;
/** 格子定数 a の範囲・初期値・刻み(nm) */
const A_MIN = 0.25;
const A_MAX = 0.6;
const A_STEP = 0.01;
const A_INIT = 0.4;
/** 格子タイプの初期値 */
const TYPE_INIT: LatticeType = "square";
/** 長方格子の縦横比(a2 = 1.4a) */
const RECT_RATIO = 1.4;
/** 斜交格子の基底のなす角 γ(°) */
const OBLIQUE_GAMMA_DEG = 105;
/** 実空間の円形窓の半径(nm)。この中の原子だけを描く */
const DISK_RADIUS_NM = 1.6;
/** 実空間パネルの表示半径(nm)。パネル短辺の半分がこの長さに対応する */
const REAL_VIEW_RADIUS_NM = 1.75;
/** 逆空間パネルの表示半径(nm⁻¹)。12 nm⁻¹ 相当 + 余白 */
const RECIP_VIEW_RADIUS = 12.5;
/** 逆格子点の指数範囲(|h|, |k| ≤ 4 — §5.1) */
const HK_MAX = 4;
/** 点の濃淡の減衰スケール g₀(nm⁻¹)。装飾であって回折強度ではない */
const FADE_G0 = 6;
/** 原子の見た目半径(CSS px) */
const ATOM_RADIUS_PX = 6;
/** 逆格子点の見た目半径(CSS px)。原点 000 はひと回り大きく */
const RECIP_POINT_RADIUS_PX = 3.5;
const RECIP_ORIGIN_RADIUS_PX = 5.5;
/** スケールバーの長さ(左: nm、右: nm⁻¹ — §5.1) */
const SCALEBAR_REAL_NM = 1;
const SCALEBAR_RECIP = 5;
/** 原子バッファの上限。a = 0.25 nm の斜交格子でも約 140 点なので十分 */
const MAX_ATOMS = 320;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

/** 角度(°)を (-180, 180] に折り返す */
function wrapDeg(t: number): number {
  let r = t % 360;
  if (r <= -180) r += 360;
  else if (r > 180) r -= 360;
  return r;
}

export default function introDuality(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(§6.2)
  const matrixFill = matColor("matrix");
  const recipFill = matColor("recip");

  /* ---- 状態 ---- */

  let theta = THETA_INIT; // 回転角(°)。(-180, 180] に折り返す
  let a = A_INIT; // 格子定数(nm)
  let latticeType: LatticeType = TYPE_INIT;
  /** 自動回転フラグ(§5.0: ユーザー操作で止め、playPause で再開する) */
  let auto = true;
  /** auto でないときの再描画要求(無駄描画を避ける) */
  let dirty = true;

  // 回転後の基底(毎フレームの割当てを避けるため再利用)
  const a1 = vec2();
  const a2 = vec2();
  // 円形窓内の原子位置 [x0, y0, x1, y1, …](再利用バッファ)
  const atomXY = new Float64Array(MAX_ATOMS * 2);

  /** 現在の格子タイプ・a・θ から回転後の基底 a1, a2 を作る */
  function computeBasis(): void {
    // 回転前: 正方 (a,0)/(0,a)、長方 (a,0)/(0,1.4a)、斜交 (a,0)/a(cosγ,sinγ)
    let a2x = 0;
    let a2y = a;
    if (latticeType === "rect") {
      a2y = RECT_RATIO * a;
    } else if (latticeType === "oblique") {
      a2x = a * Math.cos(OBLIQUE_GAMMA_DEG * DEG2RAD);
      a2y = a * Math.sin(OBLIQUE_GAMMA_DEG * DEG2RAD);
    }
    const c = Math.cos(theta * DEG2RAD);
    const s = Math.sin(theta * DEG2RAD);
    set2(a1, a * c, a * s);
    set2(a2, a2x * c - a2y * s, a2x * s + a2y * c);
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const split = splitPanels(host.size);
    drawPanelDivider(ctx, host.size, split);
    computeBasis();

    // 左パネル = 実空間(円形窓内の原子)
    const real = split.first;
    const realMap = makeMapper(
      real,
      Math.min(real.w, real.h) / 2 / REAL_VIEW_RADIUS_NM,
    );
    const atomCount = latticePointsInDisk(a1, a2, DISK_RADIUS_NM, atomXY);
    withClip(ctx, real, () => {
      drawAtoms(ctx, atomXY, atomCount, realMap, ATOM_RADIUS_PX, matrixFill);
    });
    drawPanelLabel(ctx, real, "実空間");
    drawScaleBar(ctx, real, realMap.pxPerUnit, SCALEBAR_REAL_NM, "1 nm");

    // 右パネル = 逆空間。回転後の基底の双対基底(式 E8)から
    // g = h b1 + k b2 を厳密に計算する — 回転・スケールの連動は
    // この構成から自動的に正しくなる(§5.1)
    const recip = split.second;
    const recipMap = makeMapper(
      recip,
      Math.min(recip.w, recip.h) / 2 / RECIP_VIEW_RADIUS,
    );
    const { b1, b2 } = dualBasis2(a1, a2);
    withClip(ctx, recip, () => {
      ctx.fillStyle = recipFill;
      const invG0Sq = 1 / (FADE_G0 * FADE_G0);
      for (let hh = -HK_MAX; hh <= HK_MAX; hh++) {
        for (let kk = -HK_MAX; kk <= HK_MAX; kk++) {
          const gx = hh * b1.x + kk * b2.x;
          const gy = hh * b1.y + kk * b2.y;
          // 濃淡は見やすさのための装飾で、回折強度ではない(図注で明示)
          ctx.globalAlpha = Math.exp(-(gx * gx + gy * gy) * invG0Sq);
          const r =
            hh === 0 && kk === 0
              ? RECIP_ORIGIN_RADIUS_PX
              : RECIP_POINT_RADIUS_PX;
          ctx.beginPath();
          ctx.arc(recipMap.toPxX(gx), recipMap.toPxY(gy), r, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    });
    drawPanelLabel(ctx, recip, "逆空間");
    drawScaleBar(ctx, recip, recipMap.pxPerUnit, SCALEBAR_RECIP, "5 nm⁻¹");
  }

  /* ---- 読み取り値(a と 1/a の並記 — §5.1) ---- */

  const readout = createReadout(host);
  const aItem = readout.item("a");
  const invItem = readout.item("1/a", { color: "recip" });

  function updateReadout(): void {
    aItem.set(`${a.toFixed(2)} nm`);
    invItem.set(`${(1 / a).toFixed(2)} nm⁻¹`);
  }

  /* ---- 操作部品 ---- */

  /** 自動回転・ドラッグからのスライダー同期中は onChange を無視する */
  let syncingTheta = false;

  const thetaSlider = host.controls.slider({
    id: "theta",
    label: "回転 θ",
    min: THETA_MIN,
    max: THETA_MAX,
    step: THETA_STEP,
    value: THETA_INIT,
    unit: "°",
  });
  thetaSlider.onChange((v) => {
    if (syncingTheta) return; // 内部同期(ユーザー操作ではない)
    theta = v;
    auto = false;
    dirty = true;
  });

  /** theta の現在値をスライダーへ反映する(ドラッグ・自動回転と双方向同期) */
  function syncThetaSlider(): void {
    syncingTheta = true;
    thetaSlider.set(theta);
    syncingTheta = false;
  }

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
    auto = false;
    dirty = true;
    updateReadout();
  });

  const typeSeg = host.controls.segmented<LatticeType>({
    id: "type",
    label: "格子タイプ",
    options: [
      { value: "square", label: "正方" },
      { value: "rect", label: "長方" },
      { value: "oblique", label: "斜交" },
    ],
    value: TYPE_INIT,
  });
  typeSeg.onChange((v) => {
    latticeType = v;
    auto = false;
    dirty = true;
  });

  const playPause = host.controls.playPause();
  const onPlayClick = (): void => {
    auto = true; // §5.0: playPause で自動回転を再開する
    dirty = true;
  };
  playPause.el.addEventListener("click", onPlayClick);

  host.controls.reset(() => {
    // set() の onChange 経由で theta / a / latticeType も初期値へ戻る
    thetaSlider.set(THETA_INIT);
    aSlider.set(A_INIT);
    typeSeg.set(TYPE_INIT);
    auto = true; // onChange が false にしたものを戻す(§5.1)
    dirty = true;
  });

  /* ---- パネル上ドラッグで回転(タッチ・マウス両対応) ---- */

  let dragActive = false;
  let dragPointerId = -1;
  /** ドラッグ開始パネル(false = 実空間、true = 逆空間) */
  let dragOnSecond = false;
  /** 直前のポインタ位置のスクリーン角(rad)。差分を積算する */
  let dragPrevAngle = 0;

  /** ドラッグ中パネルの中心まわりのスクリーン角(rad)を返す */
  function screenAngle(x: number, y: number): number {
    const split = splitPanels(host.size);
    const p = dragOnSecond ? split.second : split.first;
    return Math.atan2(y - p.cy, x - p.cx);
  }

  function onPointerDown(e: PointerEvent): void {
    const f = splitPanels(host.size).first;
    dragOnSecond = !(
      e.offsetX >= f.x &&
      e.offsetX <= f.x + f.w &&
      e.offsetY >= f.y &&
      e.offsetY <= f.y + f.h
    );
    dragActive = true;
    dragPointerId = e.pointerId;
    dragPrevAngle = screenAngle(e.offsetX, e.offsetY);
    auto = false; // 掴んだ時点で自動回転を止める(§5.0)
    dirty = true;
    host.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragActive || e.pointerId !== dragPointerId) return;
    const ang = screenAngle(e.offsetX, e.offsetY);
    let d = ang - dragPrevAngle;
    // atan2 の分岐(±π)をまたいでも連続になるよう差分を折り返す
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    dragPrevAngle = ang;
    // スクリーン座標は y 下向きなので、世界座標の回転角は符号を反転する
    theta = wrapDeg(theta - d * RAD2DEG);
    dirty = true;
    syncThetaSlider();
    host.requestRender(); // 一時停止中でもドラッグを即時反映
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragActive || e.pointerId !== dragPointerId) return;
    dragActive = false;
    dragPointerId = -1;
  }

  host.canvas.addEventListener("pointerdown", onPointerDown);
  host.canvas.addEventListener("pointermove", onPointerMove);
  host.canvas.addEventListener("pointerup", onPointerUp);
  host.canvas.addEventListener("pointercancel", onPointerUp);

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    if (auto) {
      theta = wrapDeg(theta + AUTO_DEG_PER_SEC * dt);
      syncThetaSlider();
      draw();
      dirty = false;
    } else if (dirty) {
      draw();
      dirty = false;
    }
    // auto でなく dirty もないフレームは描画をスキップする(§5.1)
  });
  // 一時停止中の操作(スライダー・ドラッグ・リセット・省モーション初期表示)用
  host.onRender(() => {
    draw();
    dirty = false;
  });

  updateReadout();

  return {
    resize(): void {
      // レイアウト依存値は draw() 内で毎回再計算するので、フラグのみ立てる
      // (resize 通知後に engine が 1 フレーム描く)
      dirty = true;
    },
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
      host.canvas.removeEventListener("pointermove", onPointerMove);
      host.canvas.removeEventListener("pointerup", onPointerUp);
      host.canvas.removeEventListener("pointercancel", onPointerUp);
      playPause.el.removeEventListener("click", onPlayClick);
      readout.el.remove();
    },
  };
}
