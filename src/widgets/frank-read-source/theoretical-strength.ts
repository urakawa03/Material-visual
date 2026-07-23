/**
 * theoretical-strength.ts — 図1「一斉すべり vs 転位すべり」(記事仕様書 02 §5.1)
 *
 * 側面視の 2D 結晶ブロック(約 20×10)。中央の水平面がすべり面。
 *
 * - 一斉モード: 上ブロックの抵抗はフレンケル型 τ(x) = τ_th sin(2πx/b)。
 *   ドラッグは「カーソルとブロックをバネで繋ぐ」準静的モデルで、ピークを
 *   越えた瞬間に次の谷へスナップする(スティック・スリップ)。ゲージは
 *   バネ力から換算した応力を表示し、ピークで GPa 帯に達する。
 * - 転位モード: 同じ結晶の左端に刃状転位を挿入。MPa 帯の小さな応力で
 *   転位が右へ走り抜け、通過後に上下が b ずれて右表面に段差が残る。
 * - どちらのモードでも最終状態は同一(b のずれ)であることを完了時に表示。
 *
 * 応力ゲージは対数目盛(0.1 MPa〜3 GPa)。「実測の降伏(〜MPa)」と
 * 「理想強度(〜GPa)」の参照マークを常時表示する。
 *
 * 簡略化(図注に明示): 2D・フレンケル正弦モデル・桁を示すための模式。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { DislocLattice2D } from "../_shared/lattice2d";
import { CRSS_MPA, TAU_TH_MPA } from "./lib/constants";
import { clamp } from "../../core/mathx";
import {
  FIG_FONT,
  FIG_FONT_SMALL,
  drawArrow,
  drawMessage,
  drawReadout,
  drawTeeSymbol,
  drawViewBadge,
  resolvePalette,
} from "./lib/draw";

/** 格子の列数・半分あたりの行数(約 20×10 — §5.1) */
const COLS = 20;
const ROWS = 5;

/** ゲージの範囲(MPa・対数) */
const GAUGE_MIN = 0.1;
const GAUGE_MAX = 3000;

/** 一斉モード: バネ定数(MPa / 格子単位)と易動度(格子単位 / (s·MPa)) */
const K_RIGID = 1500;
const MOBILITY_RIGID = 0.012;
/** 転位モード: 格子摩擦(MPa)・バネ定数(MPa / すべり単位)・芯の易動度 */
const FRICTION_DISLOC = 1.2;
const K_DISLOC = 30;
const MOBILITY_CORE = 16;
/** 自動再生でカーソルが進む速さ(すべり単位 / s) */
const AUTOPLAY_SPEED = 0.4;
/** ドラッグできる上限(すべり単位 = b) */
const PULL_MAX = 2.2;

type Mode = "rigid" | "disloc";

export default function theoreticalStrength(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  const lattice = new DislocLattice2D(COLS, ROWS);

  let mode: Mode = "rigid";
  /** 一斉モード: 上ブロックの位置 x(b 単位) */
  let blockX = 0;
  /** 転位モード: 芯の進行度 c(0..COLS) */
  let core = 0;
  /** カーソル(バネの引き手)の位置(すべり単位) */
  let cursor = 0;
  /** 表示中の応力(MPa)とこの試行での最大値 */
  let sigma = 0;
  let sigmaPeak = 0;
  let autoPlaying = false;
  let dragging = false;
  let dragPointerId = -1;
  let dragStartPx = 0;
  let dragStartCursor = 0;
  let completed = false;
  let needsDraw = true;

  /** 現在のすべり量(b 単位。両モード共通の読み) */
  function slip(): number {
    return mode === "rigid" ? blockX : core / COLS;
  }

  function applyToLattice(): void {
    if (mode === "rigid") {
      lattice.mode = "rigid";
      lattice.offset = blockX;
      lattice.core = 0;
    } else {
      lattice.mode = "dislocation";
      lattice.offset = 0;
      lattice.core = core;
    }
  }

  function resetState(): void {
    blockX = 0;
    core = 0;
    cursor = 0;
    sigma = 0;
    sigmaPeak = 0;
    autoPlaying = false;
    setPlayLabel();
    completed = false;
    needsDraw = true;
  }

  /* ---- 物理更新 ---- */

  function update(dt: number): void {
    if (autoPlaying) {
      cursor = clamp(cursor + AUTOPLAY_SPEED * dt, 0, PULL_MAX);
    }
    if (mode === "rigid") {
      // 過減衰: dx/dt = M (k(x_c − x) − τ_th sin(2πx))
      const spring = K_RIGID * (cursor - blockX);
      const resist = TAU_TH_MPA * Math.sin(2 * Math.PI * blockX);
      const prev = blockX;
      blockX = clamp(
        blockX + MOBILITY_RIGID * (spring - resist) * dt,
        0,
        PULL_MAX,
      );
      sigma = Math.max(K_RIGID * (cursor - blockX), 0);
      if (Math.abs(blockX - prev) > 1e-6) needsDraw = true;
      if (!completed && blockX >= 0.98 && Math.abs(spring - resist) < 40) {
        completed = true;
        if (autoPlaying) {
          autoPlaying = false;
          setPlayLabel();
        }
        needsDraw = true;
      }
    } else {
      // 転位モード: バネ応力が格子摩擦を超えたぶんだけ芯が走る
      const spring = K_DISLOC * (cursor - core / COLS);
      let v = 0;
      if (spring > FRICTION_DISLOC)
        v = MOBILITY_CORE * (spring - FRICTION_DISLOC);
      else if (spring < -FRICTION_DISLOC)
        v = MOBILITY_CORE * (spring + FRICTION_DISLOC);
      const prev = core;
      core = clamp(core + v * dt, 0, COLS);
      sigma = Math.abs(spring);
      if (Math.abs(core - prev) > 1e-5) needsDraw = true;
      if (!completed && core >= COLS - 0.01) {
        completed = true;
        if (autoPlaying) {
          autoPlaying = false;
          setPlayLabel();
        }
        needsDraw = true;
      }
    }
    if (sigma > sigmaPeak) {
      sigmaPeak = sigma;
      needsDraw = true;
    }
    if (dragging || autoPlaying) needsDraw = true;
  }

  /* ---- 描画 ---- */

  function gaugeX(v: number, x0: number, x1: number): number {
    const t =
      (Math.log10(clamp(v, GAUGE_MIN, GAUGE_MAX)) - Math.log10(GAUGE_MIN)) /
      (Math.log10(GAUGE_MAX) - Math.log10(GAUGE_MIN));
    return x0 + t * (x1 - x0);
  }

  function drawGauge(w: number): void {
    const x0 = 24;
    const x1 = w - 54;
    const barY = 54;
    const barH = 10;

    // 現在値の読み出し(最上段)
    ctx.font = FIG_FONT;
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const label =
      sigma >= 1 ? `${sigma.toFixed(0)} MPa` : `${sigma.toFixed(2)} MPa`;
    ctx.fillText(`いまの応力: ${label}`, x0, 10);

    // 目盛(対数)
    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    for (const v of [0.1, 1, 10, 100, 1000]) {
      const gx = gaugeX(v, x0, x1);
      ctx.beginPath();
      ctx.moveTo(gx, barY);
      ctx.lineTo(gx, barY + barH + 4);
      ctx.stroke();
      ctx.fillText(String(v), gx, barY + barH + 7);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("MPa", x1 + 8, barY + barH / 2 + 0.5);

    // バーの枠と現在値
    ctx.strokeStyle = pal.text2;
    ctx.strokeRect(x0, barY, x1 - x0, barH);
    if (sigma > GAUGE_MIN) {
      ctx.fillStyle = pal.accent;
      ctx.fillRect(x0, barY, gaugeX(sigma, x0, x1) - x0, barH);
    }
    // この試行での最大値マーカー
    if (sigmaPeak > GAUGE_MIN) {
      const gx = gaugeX(sigmaPeak, x0, x1);
      ctx.strokeStyle = pal.defect;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gx, barY - 3);
      ctx.lineTo(gx, barY + barH + 3);
      ctx.stroke();
    }

    // 参照マーク(常時表示 — §5.1)
    ctx.font = FIG_FONT_SMALL;
    ctx.textBaseline = "bottom";
    for (const ref of [
      { v: CRSS_MPA, label: "実測の降伏(〜MPa)" },
      { v: TAU_TH_MPA, label: "理想強度(〜GPa)" },
    ]) {
      const gx = gaugeX(ref.v, x0, x1);
      ctx.fillStyle = pal.text2;
      ctx.beginPath();
      ctx.moveTo(gx, barY - 2);
      ctx.lineTo(gx - 4, barY - 8);
      ctx.lineTo(gx + 4, barY - 8);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillText(ref.label, clamp(gx, 80, w - 80), barY - 11);
    }
  }

  interface Frame {
    spacing: number;
    originX: number;
    slipY: number;
    handleX: number;
    handleY: number;
    handleW: number;
    handleH: number;
  }

  function frameGeom(): Frame {
    const { w, h } = host.size;
    // ゲージ(参照ラベル・目盛)と取っ手のぶん上を空ける
    const top = 132;
    const spacing = Math.min(
      (w - 60) / (COLS + 1.5),
      (h - top - 40) / (ROWS * 2 + 1.4),
    );
    const originX = (w - spacing * COLS) / 2;
    const slipY = top + (ROWS + 0.7) * spacing;
    const handleW = spacing * 3.4;
    const handleH = 22;
    const handleX = originX + (COLS / 2 + slip() - 0.5) * spacing - handleW / 2;
    const handleY = slipY - ROWS * spacing - 0.5 * spacing - handleH - 8;
    return { spacing, originX, slipY, handleX, handleY, handleW, handleH };
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawGauge(w);
    const f = frameGeom();
    applyToLattice();

    const r = Math.max(f.spacing * 0.32, 4);

    // 下半分(不動)
    ctx.beginPath();
    for (let rr = 0; rr < ROWS; rr++) {
      for (let i = 0; i < COLS; i++) {
        const x = f.originX + lattice.lowerX(i) * f.spacing;
        const y = f.slipY - lattice.lowerY(i, rr) * f.spacing;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = pal.matrix;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.matrixDark;
    ctx.stroke();

    // 上半分
    ctx.beginPath();
    const jc = lattice.upperCols();
    for (let rr = 0; rr < ROWS; rr++) {
      for (let j = 0; j < jc; j++) {
        const x = f.originX + lattice.upperX(j) * f.spacing;
        const y = f.slipY - lattice.upperY(j, rr) * f.spacing;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = pal.matrix;
    ctx.fill();
    ctx.strokeStyle = pal.matrixDark;
    ctx.stroke();

    // すべり面(破線)
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(f.originX - f.spacing, f.slipY);
    ctx.lineTo(f.originX + (COLS + 0.6) * f.spacing, f.slipY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 転位モード: ⊥ 記号
    if (mode === "disloc") {
      const cx = f.originX + lattice.coreX() * f.spacing;
      drawTeeSymbol(ctx, cx, f.slipY - 2, f.spacing * 0.55, pal.defect);
    }

    // 取っ手(上ブロックを引くハンドル)
    ctx.fillStyle = pal.bg;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(f.handleX, f.handleY, f.handleW, f.handleH, 6);
    ctx.fill();
    ctx.stroke();
    // グリップ線
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const gx = f.handleX + f.handleW / 2 + (k - 1) * 7;
      ctx.moveTo(gx, f.handleY + 6);
      ctx.lineTo(gx, f.handleY + f.handleH - 6);
    }
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // ハンドルと上ブロックをつなぐ短い線
    ctx.strokeStyle = pal.accent;
    ctx.beginPath();
    ctx.moveTo(f.handleX + f.handleW / 2, f.handleY + f.handleH);
    ctx.lineTo(f.handleX + f.handleW / 2, f.handleY + f.handleH + 8);
    ctx.stroke();

    // ドラッグ中のカーソル(バネの引き手)
    if (dragging || autoPlaying) {
      const cx = f.originX + (COLS / 2 + cursor - 0.5) * f.spacing;
      const cy = f.handleY + f.handleH / 2;
      drawArrow(
        ctx,
        f.handleX + f.handleW / 2 + 8,
        cy,
        cx + 26,
        cy,
        pal.solute,
        2,
        7,
      );
    }

    // 読み出し(左下。完了メッセージと重ならない高さに置く)
    drawReadout(ctx, [`上下のずれ: ${slip().toFixed(2)} b`], 24, h - 62, pal);

    if (completed) {
      drawMessage(
        ctx,
        w,
        h - 34,
        mode === "rigid"
          ? "1 格子ぶん滑りました — 最終状態は転位モードと同じ b のずれです"
          : "転位が通り抜けました — 上下のずれは b。一斉モードと同じ最終状態です",
        pal,
      );
    }

    drawViewBadge(ctx, w, "side", pal);
  }

  /* ---- ドラッグ(タッチ・マウス両対応) ---- */

  function onPointerDown(e: PointerEvent): void {
    const f = frameGeom();
    const margin = 12;
    if (
      e.offsetX < f.handleX - margin ||
      e.offsetX > f.handleX + f.handleW + margin ||
      e.offsetY < f.handleY - margin ||
      e.offsetY > f.handleY + f.handleH + margin
    ) {
      return;
    }
    dragging = true;
    dragPointerId = e.pointerId;
    dragStartPx = e.offsetX;
    dragStartCursor = cursor;
    autoPlaying = false;
    setPlayLabel();
    host.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    needsDraw = true;
    host.requestRender();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    const f = frameGeom();
    cursor = clamp(
      dragStartCursor + (e.offsetX - dragStartPx) / f.spacing,
      0,
      PULL_MAX,
    );
    needsDraw = true;
    host.requestRender();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;
    // 手を放すとバネは緩む(応力 0 へ)
    cursor = slip();
    needsDraw = true;
    host.requestRender();
  }

  host.canvas.addEventListener("pointerdown", onPointerDown);
  host.canvas.addEventListener("pointermove", onPointerMove);
  host.canvas.addEventListener("pointerup", onPointerUp);
  host.canvas.addEventListener("pointercancel", onPointerUp);

  /* ---- 操作部品(§5.1) ---- */

  const modeSeg = host.controls.segmented<Mode>({
    id: "mode",
    label: "モード",
    options: [
      { value: "rigid", label: "一斉にすべらせる" },
      { value: "disloc", label: "転位ですべらせる" },
    ],
    value: "rigid",
  });
  modeSeg.onChange((m) => {
    mode = m;
    resetState();
    host.requestRender();
  });

  // 自動再生(ドラッグ不能環境の代替 — §5.1)。engine の再生状態とは独立に、
  // カーソルを一定速度で引く演出のオン/オフを切り替える。
  const playBtn = host.controls.button({ label: "自動で引く" });
  function setPlayLabel(): void {
    playBtn.el.textContent = autoPlaying ? "一時停止" : "自動で引く";
  }
  playBtn.onClick(() => {
    if (completed && !autoPlaying) {
      resetState();
    }
    autoPlaying = !autoPlaying;
    setPlayLabel();
    needsDraw = true;
    host.requestRender();
  });

  host.controls.reset(() => {
    resetState();
  });

  host.onFrame((dt) => {
    update(dt);
    if (needsDraw) {
      needsDraw = false;
      draw();
    }
  });
  host.onRender(draw);

  return {
    resize(): void {
      needsDraw = true;
    },
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
      host.canvas.removeEventListener("pointermove", onPointerMove);
      host.canvas.removeEventListener("pointerup", onPointerUp);
      host.canvas.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
