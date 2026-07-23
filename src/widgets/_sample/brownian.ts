/**
 * brownian.ts — 参照ウィジェット: ブラウン運動デモ(仕様書 §9.3)
 *
 * 白い箱の中を母相色の原子 60 個が熱運動する 2D デモ。1 個だけ溶質色の
 * 原子があり、ドラッグで掴んで放せる。目的は物理の正確さではなく、
 * engine / controls / DPR / タッチ / 省モーション / 画面外停止の全機構の
 * 動作確認。
 *
 * 簡略化: 原子運動はランジュバン方程式風の確率過程で、実在材料の
 * スケール・時間とは対応しない(見た目のための調整値)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { clamp, gaussian, mulberry32 } from "../../core/mathx";
import { darken, matColor } from "../../core/colors";

/** 母相原子の個数(§9.3: 60 個) */
const MATRIX_COUNT = 60;
/** 乱数シード(reset で完全に同じ初期状態に戻す — §8.2) */
const SEED = 20260723;
/** 原子の見た目半径(CSS px) */
const MATRIX_RADIUS = 7;
const SOLUTE_RADIUS = 9.5;
/** 縁取り(同系色を約 20% 暗く・1.5px — §6.5) */
const EDGE_WIDTH = 1.5;
const EDGE_DARKEN = 0.2;
/** 温度スライダー範囲(§9.3: 100〜1200 K) */
const TEMP_MIN = 100;
const TEMP_MAX = 1200;
const TEMP_INIT = 600;
const TEMP_STEP = 10;
/** 固定タイムステップ(ms) */
const STEP_MS = 8;
/** 熱浴との結合の強さ(1/s)。見た目の調整値 */
const FRICTION = 2.5;
/** 300 K での熱速度の目安(px/s)。sqrt(T/300) でスケールする */
const RMS_SPEED_300K = 55;
/** ドラッグの当たり判定を広げる量(px)。タッチで掴みやすくするため */
const GRAB_MARGIN = 14;
/** 投げたときの速度上限(px/s) */
const THROW_SPEED_MAX = 900;

const TAU = Math.PI * 2;
const TOTAL = MATRIX_COUNT + 1;
/** 溶質原子のインデックス(最後 = 最前面に描画) */
const SOLUTE = MATRIX_COUNT;

export default function brownian(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は CSS 変数(tokens.css)から実行時に解決する(§13)
  const matrixFill = matColor("matrix");
  const matrixEdge = darken(matrixFill, EDGE_DARKEN);
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill, EDGE_DARKEN);

  const px = new Float64Array(TOTAL);
  const py = new Float64Array(TOTAL);
  const vx = new Float64Array(TOTAL);
  const vy = new Float64Array(TOTAL);

  let rand = mulberry32(SEED);
  let gauss = gaussian(rand);
  let temperature = TEMP_INIT;

  // ドラッグ状態
  let dragging = false;
  let dragPointerId = -1;
  let dragVx = 0;
  let dragVy = 0;

  function thermalSpeed(): number {
    return RMS_SPEED_300K * Math.sqrt(temperature / 300);
  }

  function radiusOf(i: number): number {
    return i === SOLUTE ? SOLUTE_RADIUS : MATRIX_RADIUS;
  }

  /** シード固定の初期配置(ジッター付きグリッド)。reset で毎回同一 */
  function init(): void {
    rand = mulberry32(SEED);
    gauss = gaussian(rand);
    const { w, h } = host.size;
    const cols = Math.ceil(Math.sqrt((TOTAL * w) / h));
    const rows = Math.ceil(TOTAL / cols);
    const cellW = w / (cols + 1);
    const cellH = h / (rows + 1);
    const speed = thermalSpeed();
    for (let i = 0; i < TOTAL; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      px[i] = cellW * (c + 1) + (rand() - 0.5) * cellW * 0.5;
      py[i] = cellH * (r + 1) + (rand() - 0.5) * cellH * 0.5;
      const angle = rand() * TAU;
      vx[i] = Math.cos(angle) * speed;
      vy[i] = Math.sin(angle) * speed;
    }
    dragging = false;
    dragPointerId = -1;
  }

  /** 壁での反射と、箱の中への押し戻し */
  function confine(i: number): void {
    const { w, h } = host.size;
    const r = radiusOf(i);
    if (px[i] < r) {
      px[i] = r;
      vx[i] = Math.abs(vx[i]);
    } else if (px[i] > w - r) {
      px[i] = w - r;
      vx[i] = -Math.abs(vx[i]);
    }
    if (py[i] < r) {
      py[i] = r;
      vy[i] = Math.abs(vy[i]);
    } else if (py[i] > h - r) {
      py[i] = h - r;
      vy[i] = -Math.abs(vy[i]);
    }
  }

  /** 等質量の弾性衝突(重なり解消 + 法線方向の速度交換) */
  function collide(): void {
    for (let i = 0; i < TOTAL; i++) {
      const ri = radiusOf(i);
      for (let j = i + 1; j < TOTAL; j++) {
        const minDist = ri + radiusOf(j);
        const dx = px[j] - px[i];
        const dy = py[j] - py[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        // 重なりを半分ずつ押し戻す(ドラッグ中の溶質は動かさない)
        const overlap = minDist - d;
        const iFixed = dragging && i === SOLUTE;
        const jFixed = dragging && j === SOLUTE;
        if (!iFixed && !jFixed) {
          px[i] -= nx * overlap * 0.5;
          py[i] -= ny * overlap * 0.5;
          px[j] += nx * overlap * 0.5;
          py[j] += ny * overlap * 0.5;
        } else if (iFixed) {
          px[j] += nx * overlap;
          py[j] += ny * overlap;
        } else {
          px[i] -= nx * overlap;
          py[i] -= ny * overlap;
        }
        // 接近しているときだけ法線方向の速度成分を交換する
        const rvn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
        if (rvn < 0) {
          if (!iFixed && !jFixed) {
            vx[i] += rvn * nx;
            vy[i] += rvn * ny;
            vx[j] -= rvn * nx;
            vy[j] -= rvn * ny;
          } else if (iFixed) {
            vx[j] -= 2 * rvn * nx;
            vy[j] -= 2 * rvn * ny;
          } else {
            vx[i] += 2 * rvn * nx;
            vy[i] += 2 * rvn * ny;
          }
        }
      }
    }
  }

  /** ランジュバン方程式風の 1 ステップ(h: 秒) */
  function physicsStep(h: number): void {
    const sigma = thermalSpeed() * Math.sqrt(2 * FRICTION);
    const kick = sigma * Math.sqrt(h);
    for (let i = 0; i < TOTAL; i++) {
      if (dragging && i === SOLUTE) continue;
      vx[i] += -FRICTION * vx[i] * h + kick * gauss();
      vy[i] += -FRICTION * vy[i] * h + kick * gauss();
      px[i] += vx[i] * h;
      py[i] += vy[i] * h;
    }
    collide();
    for (let i = 0; i < TOTAL; i++) {
      if (dragging && i === SOLUTE) continue;
      confine(i);
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 母相原子は 1 パスでまとめ描き(§8.3)
    ctx.beginPath();
    for (let i = 0; i < MATRIX_COUNT; i++) {
      ctx.moveTo(px[i] + MATRIX_RADIUS, py[i]);
      ctx.arc(px[i], py[i], MATRIX_RADIUS, 0, TAU);
    }
    ctx.fillStyle = matrixFill;
    ctx.fill();
    ctx.lineWidth = EDGE_WIDTH;
    ctx.strokeStyle = matrixEdge;
    ctx.stroke();

    // 溶質原子(ドラッグ対象)
    ctx.beginPath();
    ctx.arc(px[SOLUTE], py[SOLUTE], SOLUTE_RADIUS, 0, TAU);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
  }

  /* ---- ドラッグ(タッチ・マウス両対応: Pointer Events) ---- */

  function onPointerDown(e: PointerEvent): void {
    const dx = e.offsetX - px[SOLUTE];
    const dy = e.offsetY - py[SOLUTE];
    if (Math.hypot(dx, dy) > SOLUTE_RADIUS + GRAB_MARGIN) return;
    dragging = true;
    dragPointerId = e.pointerId;
    dragVx = 0;
    dragVy = 0;
    host.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    const { w, h } = host.size;
    const nx = clamp(e.offsetX, SOLUTE_RADIUS, w - SOLUTE_RADIUS);
    const ny = clamp(e.offsetY, SOLUTE_RADIUS, h - SOLUTE_RADIUS);
    // 「投げる」ための速度推定(直近の移動を 60fps 相当に換算して平滑化)
    dragVx = dragVx * 0.6 + (nx - px[SOLUTE]) * 60 * 0.4;
    dragVy = dragVy * 0.6 + (ny - py[SOLUTE]) * 60 * 0.4;
    px[SOLUTE] = nx;
    py[SOLUTE] = ny;
    host.requestRender(); // 一時停止中でもドラッグを即時反映(§7.1)
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;
    const speed = Math.hypot(dragVx, dragVy);
    const s = speed > THROW_SPEED_MAX ? THROW_SPEED_MAX / speed : 1;
    vx[SOLUTE] = dragVx * s;
    vy[SOLUTE] = dragVy * s;
  }

  host.canvas.addEventListener("pointerdown", onPointerDown);
  host.canvas.addEventListener("pointermove", onPointerMove);
  host.canvas.addEventListener("pointerup", onPointerUp);
  host.canvas.addEventListener("pointercancel", onPointerUp);

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "temperature",
    label: "温度",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "K",
  });
  tempSlider.onChange((v) => {
    temperature = v;
  });
  host.controls.playPause();
  host.controls.reset(() => {
    tempSlider.set(TEMP_INIT); // temperature も onChange 経由で戻る
    init();
  });

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    stepper(dt, physicsStep);
    draw();
  });
  // 一時停止中の操作(ドラッグ・リセット・省モーション初期表示)用
  host.onRender(draw);

  init();

  return {
    resize(): void {
      // 新しい箱に収まるように位置だけ丸める(状態は維持)
      for (let i = 0; i < TOTAL; i++) confine(i);
    },
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
      host.canvas.removeEventListener("pointermove", onPointerMove);
      host.canvas.removeEventListener("pointerup", onPointerUp);
      host.canvas.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
