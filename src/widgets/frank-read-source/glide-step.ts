/**
 * glide-step.ts — 図2「転位の歩き方」(記事仕様書 02 §5.2)
 *
 * 側面視の 2D 格子(約 24×12)。中央に刃状転位(⊥)。ボタンで 1 格子ずつ
 * コマ送りし、結合のつなぎ替え(芯近傍の原子 2〜3 個のハイライト)を
 * 約 250ms のイージングで見せる。転位が右端に到達すると表面に段差が現れる。
 *
 * バーガース回路: 転位を囲む回路(8×8 原子)を右回りに描き、閉じ残りを
 * --mat-defect の矢印「b」で表示。完全結晶側の比較回路は閉じる。
 *
 * 実装方式: onFrame(遷移アニメ中のみ実描画、待機中はアイドル)。
 * 簡略化(図注に明示): 2D 単純格子。パイエルス障壁は描画しない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { DislocLattice2D } from "../_shared/lattice2d";
import { clamp } from "../../core/mathx";
import {
  FIG_FONT_SMALL,
  drawArrow,
  drawMessage,
  drawReadout,
  drawSenseChevrons,
  drawTeeSymbol,
  drawViewBadge,
  resolvePalette,
} from "./lib/draw";

/** 格子の列数・半分あたりの行数(約 24×12 — §5.2) */
const COLS = 24;
const ROWS = 6;
/** 初期の芯位置(左寄り 1/4 — §5.2) */
const CORE_INIT = COLS / 4;
/** 遷移の収束レート(1/s)。約 250ms で新しい位置へ落ち着く */
const EASE_RATE = 14;
/** 連続再生のステップ間隔(s)= 2 ステップ/秒 */
const AUTO_STEP_INTERVAL = 0.5;
/** 回路の半幅(8 ステップ = 半幅 4) */
const CIRCUIT_HALF = 4;

export default function glideStep(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  const lattice = new DislocLattice2D(COLS, ROWS);
  lattice.mode = "dislocation";

  /** 目標の芯位置(整数)と描画中の芯位置(イージング) */
  let coreTarget = CORE_INIT;
  let coreAnim = CORE_INIT;
  let showCircuit = false;
  let autoPlaying = false;
  let autoClock = 0;
  let needsDraw = true;
  const highlightCols: number[] = [];

  function animating(): boolean {
    return Math.abs(coreAnim - coreTarget) > 0.005;
  }

  function step(dir: 1 | -1): void {
    coreTarget = clamp(coreTarget + dir, 0, COLS);
    needsDraw = true;
    host.requestRender();
  }

  /* ---- 更新 ---- */

  function update(dt: number): void {
    if (autoPlaying) {
      autoClock += dt;
      if (autoClock >= AUTO_STEP_INTERVAL) {
        autoClock = 0;
        if (coreTarget >= COLS) {
          autoPlaying = false;
          setPlayLabel();
        } else {
          step(1);
        }
      }
    }
    if (animating()) {
      const k = Math.min(dt * EASE_RATE, 1);
      coreAnim += (coreTarget - coreAnim) * k;
      if (Math.abs(coreAnim - coreTarget) < 0.005) coreAnim = coreTarget;
      needsDraw = true;
    }
  }

  /* ---- 幾何 ---- */

  interface Frame {
    spacing: number;
    originX: number;
    slipY: number;
  }

  function frameGeom(): Frame {
    const { w, h } = host.size;
    const spacing = Math.min(
      (w - 50) / (COLS + 1.5),
      (h - 92) / (ROWS * 2 + 1.6),
    );
    const originX = (w - spacing * COLS) / 2;
    const slipY = 54 + (ROWS + 0.6) * spacing;
    return { spacing, originX, slipY };
  }

  /** 芯位置 x に最も近い上半分の列を返す */
  function nearestUpperCol(x: number): number {
    let best = 0;
    let bestD = Infinity;
    const jc = lattice.upperCols();
    for (let j = 0; j < jc; j++) {
      const d = Math.abs(lattice.upperX(j) - x);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  /**
   * バーガース回路の経路(原子位置の列)を組み立てる。
   * 右回り: 左下 → 左辺を上へ → 上辺を右へ → 右辺を下へ → 下辺を左へ。
   * 戻り値は画面座標の平坦配列と、始点・終点のインデックス。
   */
  function buildCircuit(
    centerCol: number,
    f: Frame,
  ): { pts: number[]; closed: boolean } {
    const iS = Math.round(
      clamp(centerCol - CIRCUIT_HALF, 1, COLS - 1 - 2 * CIRCUIT_HALF),
    );
    const rMax = Math.min(CIRCUIT_HALF - 1, ROWS - 1);
    const pts: number[] = [];
    const pushLower = (i: number, r: number): void => {
      pts.push(
        f.originX + lattice.lowerX(i) * f.spacing,
        f.slipY - lattice.lowerY(i, r) * f.spacing,
      );
    };
    const pushUpper = (j: number, r: number): void => {
      pts.push(
        f.originX + lattice.upperX(j) * f.spacing,
        f.slipY - lattice.upperY(j, r) * f.spacing,
      );
    };
    // 左辺: 下から上へ
    for (let r = rMax; r >= 0; r--) pushLower(iS, r);
    const jL = nearestUpperCol(iS);
    for (let r = 0; r <= rMax; r++) pushUpper(jL, r);
    // 上辺: 左から右へ(2*CIRCUIT_HALF ステップ)
    for (let s = 1; s <= 2 * CIRCUIT_HALF; s++) pushUpper(jL + s, rMax);
    // 右辺: 上から下へ
    const jR = jL + 2 * CIRCUIT_HALF;
    for (let r = rMax - 1; r >= 0; r--) pushUpper(jR, r);
    const iR = Math.round(clamp(lattice.upperX(jR), 0, COLS - 1));
    for (let r = 0; r <= rMax; r++) pushLower(iR, r);
    // 下辺: 右から左へ
    for (let s = 1; s <= 2 * CIRCUIT_HALF; s++) pushLower(iR - s, rMax);
    // 閉じ残り(終点 → 始点)が 0.3 格子未満なら「閉じた」とみなす
    const n = pts.length / 2;
    const gap = Math.hypot(pts[2 * n - 2] - pts[0], pts[2 * n - 1] - pts[1]);
    return { pts, closed: gap < f.spacing * 0.3 };
  }

  function drawCircuitPath(
    circuit: { pts: number[]; closed: boolean },
    color: string,
    alpha: number,
    label: string,
  ): void {
    const { pts, closed } = circuit;
    const n = pts.length / 2;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
    if (closed) ctx.closePath();
    ctx.stroke();
    drawSenseChevrons(ctx, pts, 8, closed, color);
    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, pts[0] + 40, pts[1] + 8);
    if (!closed) {
      // 閉じ残り = バーガースベクトル b(終点 → 始点)
      drawArrow(
        ctx,
        pts[2 * n - 2],
        pts[2 * n - 1],
        pts[0],
        pts[1],
        pal.defect,
        2.5,
        8,
      );
      ctx.fillStyle = pal.defect;
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("b", (pts[0] + pts[2 * n - 2]) / 2, pts[1] + 6);
    }
    ctx.globalAlpha = 1;
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const f = frameGeom();
    lattice.core = coreAnim;
    const r = Math.max(f.spacing * 0.3, 3.5);

    // つなぎ替え中の列(ハイライト対象)
    lattice.columnsNearCore(1.1, highlightCols);
    const highlightOn = animating();

    // 下半分
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

    // 上半分(ハイライト列は別パス)
    const jc = lattice.upperCols();
    ctx.beginPath();
    for (let rr = 0; rr < ROWS; rr++) {
      for (let j = 0; j < jc; j++) {
        if (highlightOn && rr === 0 && highlightCols.includes(j)) continue;
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

    // 結合をつなぎ替え中の原子(界面 1 行目の芯近傍 — §5.2)
    if (highlightOn) {
      ctx.beginPath();
      for (const j of highlightCols) {
        const x = f.originX + lattice.upperX(j) * f.spacing;
        const y = f.slipY - lattice.upperY(j, 0) * f.spacing;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = pal.solute;
      ctx.fill();
      ctx.strokeStyle = pal.defectDark;
      ctx.stroke();
    }

    // すべり面(破線)
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(f.originX - f.spacing, f.slipY);
    ctx.lineTo(f.originX + (COLS + 0.6) * f.spacing, f.slipY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 応力の向き(上=右、下=左 — §5.2)
    const arrowY1 = f.slipY - (ROWS + 1.15) * f.spacing;
    const arrowY2 = f.slipY + (ROWS + 1.15) * f.spacing;
    const ax = f.originX + COLS * 0.5 * f.spacing;
    drawArrow(ctx, ax - 40, arrowY1, ax + 40, arrowY1, pal.text2, 2, 7);
    drawArrow(ctx, ax + 40, arrowY2, ax - 40, arrowY2, pal.text2, 2, 7);
    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("τ", ax + 48, arrowY1);
    ctx.textAlign = "right";
    ctx.fillText("τ", ax - 48, arrowY2);

    // ⊥ 記号
    const coreScreenX = f.originX + lattice.coreX() * f.spacing;
    drawTeeSymbol(ctx, coreScreenX, f.slipY - 2, f.spacing * 0.6, pal.defect);

    // バーガース回路(トグル)
    if (showCircuit) {
      // 完全結晶側の比較回路(閉じる)
      const compCenter =
        coreAnim < COLS / 2 ? COLS - CIRCUIT_HALF - 2 : CIRCUIT_HALF + 2;
      if (Math.abs(compCenter - coreAnim) > CIRCUIT_HALF + 2) {
        drawCircuitPath(
          buildCircuit(compCenter, f),
          pal.text2,
          0.4,
          "完全結晶側(閉じる)",
        );
      }
      drawCircuitPath(
        buildCircuit(coreAnim, f),
        pal.defectDark,
        0.95,
        "転位を囲む回路",
      );
    }

    // 読み出し(§5.2)
    drawReadout(
      ctx,
      [
        `上下のずれ(平均): ${(coreAnim / COLS).toFixed(2)} b`,
        `転位の位置: ${Math.round(coreAnim)} / ${COLS}`,
      ],
      14,
      12,
      pal,
    );

    if (coreTarget >= COLS && !animating()) {
      drawMessage(
        ctx,
        w,
        h - 32,
        "転位が右端に到達 — 上下が b ずれ、表面に段差(レッジ)が残りました",
        pal,
      );
    }

    drawViewBadge(ctx, w, "side", pal);
  }

  /* ---- 操作部品(§5.2) ---- */

  const leftBtn = host.controls.button({ label: "← 1 格子" });
  leftBtn.onClick(() => step(-1));
  const rightBtn = host.controls.button({ label: "1 格子 →" });
  rightBtn.onClick(() => step(1));

  const playBtn = host.controls.button({ label: "連続再生" });
  function setPlayLabel(): void {
    playBtn.el.textContent = autoPlaying ? "一時停止" : "連続再生";
  }
  playBtn.onClick(() => {
    if (coreTarget >= COLS && !autoPlaying) {
      coreTarget = 0;
      coreAnim = 0;
    }
    autoPlaying = !autoPlaying;
    autoClock = AUTO_STEP_INTERVAL; // すぐ 1 歩目を踏み出す
    setPlayLabel();
    needsDraw = true;
    host.requestRender();
  });

  const circuitToggle = host.controls.toggle({
    id: "circuit",
    label: "バーガース回路を表示",
    value: false,
  });
  circuitToggle.onChange((v) => {
    showCircuit = v;
    needsDraw = true;
  });

  host.controls.reset(() => {
    coreTarget = CORE_INIT;
    coreAnim = CORE_INIT;
    autoPlaying = false;
    setPlayLabel();
    autoClock = 0;
    needsDraw = true;
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
      /* イベントリスナーなし */
    },
  };
}
