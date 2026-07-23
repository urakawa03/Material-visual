/**
 * solute-energy-probe.ts — 図3: 炭素原子の居心地メーター(記事仕様 §5.3)
 *
 * 図2 と同じ刃状転位入り格子の上で、溶質原子 1 個をドラッグ(または矢印
 * キー)で動かし、転位との相互作用エネルギー U(r, θ) = A sinθ / r を上部の
 * エネルギーメーターで読む。U < 0 が安定(引張側)、U > 0 が不安定(圧縮側)。
 * 溶質タイプを「置換型(小さい原子)」に切り替えると符号が反転する。
 *
 * 実装方式: 2D / requestRender(操作時のみ再描画 — アイドル時の消費ゼロ)。
 * 簡略化(図注に明示): 等方的な体積ミスフィット近似。実際の C は正方晶
 * ひずみを生み、らせん転位とも相互作用する。クランプ: r ≥ b、|U| ≤ U_b。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import { clamp } from "../../core/mathx";
import { U_BIND_EV } from "./lib/constants";
import type { LatticeView } from "./lib/lattice";
import {
  SUBSTITUTIONAL_AMP,
  buildEdgeLattice,
  dislocationSymbolPos,
  drawDislocationMark,
  drawLatticeAtoms,
  drawPressureOverlay,
  makeLatticeView,
  parseRgb,
  soluteEnergy,
  viewX,
  viewY,
} from "./lib/lattice";

/** 格子の列数・行数(図2 と同一 — §5.3「図2 と同じ格子ビュー」) */
const COLS = 27;
const ROWS = 16;
/** 変位の誇張(図3 ではスライダーなしの固定 ×2) */
const EXAGGERATION = 2;
/** 原子半径(格子間隔に対する割合。図2 と同一) */
const ATOM_RADIUS_RATIO = 0.3;
/** 溶質原子の半径(母相原子比)。格子間型 C は大きく、置換型は小さく描く */
const SOLUTE_RADIUS_FACTOR_LARGE = 1.25;
const SOLUTE_RADIUS_FACTOR_SMALL = 0.85;
/** 溶質の初期位置(b 単位・転位の右上、r ≈ 6b — §5.3) */
const INIT_X_B = 4.2;
const INIT_Y_B = 4.2;
/** 溶質の可動範囲(格子領域内にクランプ)。格子端の原子位置まで */
const X_MAX_B = (COLS - 1) / 2;
const Y_MAX_B = (ROWS - 1) / 2;
/** 矢印キー 1 回の移動量(b 単位 — 受け入れ基準のキーボード代替) */
const KEY_STEP_B = 0.5;
/** ドラッグの当たり判定を広げる量(px)。タッチで掴みやすくするため */
const GRAB_MARGIN_PX = 14;

/** エネルギーメーター帯の高さ(px)。この下に格子を描く */
const METER_HEIGHT_PX = 64;
/** メーターのキャンバス端からの余白(px ≥ 8) */
const METER_MARGIN_PX = 12;
/** バーの上端 y・高さ(px) */
const METER_BAR_TOP_PX = 24;
const METER_BAR_H_PX = 14;
/** 「安定 / 不安定」ラベル行・目盛り数値行の y(px) */
const METER_LABEL_Y_PX = 12;
const METER_TICK_Y_PX = 44;
/** 数値読み出し「U = −0.42 eV」用に右側へ確保する幅(px) */
const METER_READOUT_W_PX = 110;

/** エネルギー地図の等値線レベル(eV)。±両符号を描く(§5.3) */
const CONTOUR_LEVELS_EV = [0.1, 0.2, 0.35] as const;
const CONTOUR_SIGNS = [1, -1] as const;
/** 等値線の透明度(1px, uiColor("text2")) */
const CONTOUR_ALPHA = 0.5;

const TAU = Math.PI * 2;

/** 溶質のタイプ(§5.3 segmented) */
type SoluteType = "interstitial" | "substitutional";

export default function soluteEnergyProbe(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(§6.2 意味パレット経由)
  const matrixFill = matColor("matrix");
  const matrixEdge = darken(matrixFill);
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill);
  const defectColor = matColor("defect");
  const labelColor = uiColor("text2");
  const textColor = uiColor("text");
  const hairlineColor = uiColor("hairline");
  const accentColor = uiColor("accent");
  const tensionRgb = parseRgb(matColor("tension"));
  const compressionRgb = parseRgb(matColor("compression"));

  const lat = buildEdgeLattice(COLS, ROWS);
  const symPos = { x: 0, y: 0 };

  // 物理座標(b 単位・y 上向き)での溶質の現在位置
  let soluteX = INIT_X_B;
  let soluteY = INIT_Y_B;
  let soluteType: SoluteType = "interstitial";
  let showMap = false;

  // ドラッグ状態
  let dragging = false;
  let dragPointerId = -1;

  /**
   * 描画・座標変換に使うビュー。メーター帯(上部 METER_HEIGHT_PX)を除いた
   * 領域に格子をフィットさせ、中心をその領域の中央へずらす。
   */
  const view: LatticeView = { cx: 0, cy: 0, scale: 1 };

  function updateView(): void {
    const { w, h } = host.size;
    // 図2 と同じ余裕(誇張 ×2 での変位分)を足してフィットさせる
    const fit = makeLatticeView(
      w,
      h - METER_HEIGHT_PX,
      COLS + EXAGGERATION,
      ROWS + 0.5 * EXAGGERATION,
    );
    view.cx = fit.cx;
    view.cy = METER_HEIGHT_PX + (h - METER_HEIGHT_PX) / 2;
    view.scale = fit.scale;
  }

  /** 溶質–転位相互作用の実効係数 A(格子間型 +U_b / 置換型 −0.6 U_b) */
  function currentAmp(): number {
    return soluteType === "interstitial" ? U_BIND_EV : SUBSTITUTIONAL_AMP;
  }

  /** 溶質原子の描画半径(px)。タイプで大小を変える */
  function soluteRadiusPx(): number {
    const factor =
      soluteType === "interstitial"
        ? SOLUTE_RADIUS_FACTOR_LARGE
        : SOLUTE_RADIUS_FACTOR_SMALL;
    return ATOM_RADIUS_RATIO * view.scale * factor;
  }

  /** 数値読み出し用の整形(例: "−0.42" / "+0.12"。負号は U+2212) */
  function formatEnergy(u: number): string {
    const abs = Math.abs(u);
    if (abs < 0.005) return "0.00";
    return (u < 0 ? "−" : "+") + abs.toFixed(2);
  }

  /**
   * U = 一定 の等値線を描く(§5.3)。U = A sinθ / r の等値線は「原点を通り
   * y 軸上に中心を持つ円」: r = (A/U) sinθ ⇔ x² + (y − A/2U)² = (A/2U)²。
   * 直径 d = |A/U|、中心 (0, A/2U)。A の符号で上下が決まるため、置換型
   * (A < 0)では同じ U の円が反対側に移る。|U| ≥ |A| のレベルはクランプ域
   * (r < b)に埋もれて実在しないので描かない。
   */
  function drawEnergyContours(amp: number): void {
    ctx.strokeStyle = labelColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = CONTOUR_ALPHA;
    ctx.beginPath();
    for (const mag of CONTOUR_LEVELS_EV) {
      if (mag >= Math.abs(amp)) continue;
      for (const sign of CONTOUR_SIGNS) {
        const u = sign * mag;
        const centerYB = amp / (2 * u); // 円の中心(b 単位・y 上向き)
        const radiusPx = Math.abs(centerYB) * view.scale;
        const cxPx = viewX(view, 0);
        const cyPx = viewY(view, centerYB);
        ctx.moveTo(cxPx + radiusPx, cyPx);
        ctx.arc(cxPx, cyPx, radiusPx, 0, TAU);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * エネルギーメーター(キャンバス上部の横バー)。軸は左 = −U_b、右 = +U_b
   * で 0 が中央。U < 0(安定)が左に来る。0 から現在値までを accent で塗り、
   * 右に数値読み出しを表示する。
   */
  function drawMeter(w: number, u: number): void {
    const barX = METER_MARGIN_PX;
    const barW = Math.max(40, w - METER_MARGIN_PX * 2 - METER_READOUT_W_PX);
    const xAt = (v: number): number =>
      barX + ((v + U_BIND_EV) / (2 * U_BIND_EV)) * barW;

    // 0 → 現在値の塗り(uiColor("accent"))
    const x0 = xAt(0);
    const xu = xAt(clamp(u, -U_BIND_EV, U_BIND_EV));
    ctx.fillStyle = accentColor;
    ctx.fillRect(
      Math.min(x0, xu),
      METER_BAR_TOP_PX,
      Math.abs(xu - x0),
      METER_BAR_H_PX,
    );

    // バーの枠と 0(中央)の目盛り線(補助線 1px)
    ctx.strokeStyle = hairlineColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, METER_BAR_TOP_PX + 0.5, barW, METER_BAR_H_PX);
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, METER_BAR_TOP_PX - 3);
    ctx.lineTo(Math.round(x0) + 0.5, METER_BAR_TOP_PX + METER_BAR_H_PX + 3);
    ctx.stroke();

    // 「安定 / 不安定」ラベル(U < 0 = 安定が左 — §5.3)
    ctx.font = "14px sans-serif";
    ctx.fillStyle = labelColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("安定", barX, METER_LABEL_Y_PX);
    ctx.textAlign = "right";
    ctx.fillText("不安定", barX + barW, METER_LABEL_Y_PX);

    // 目盛りの数値(12px)
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("−0.5", barX, METER_TICK_Y_PX);
    ctx.textAlign = "center";
    ctx.fillText("0", x0, METER_TICK_Y_PX);
    ctx.textAlign = "right";
    ctx.fillText("+0.5 eV", barX + barW, METER_TICK_Y_PX);

    // 数値読み出し(バーの右)
    ctx.font = "14px sans-serif";
    ctx.fillStyle = textColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText(
      `U = ${formatEnergy(u)} eV`,
      w - METER_MARGIN_PX,
      METER_BAR_TOP_PX + METER_BAR_H_PX / 2,
    );

    // メーター帯と格子の区切り(補助線 1px)
    ctx.strokeStyle = hairlineColor;
    ctx.beginPath();
    ctx.moveTo(0, METER_HEIGHT_PX - 0.5);
    ctx.lineTo(w, METER_HEIGHT_PX - 0.5);
    ctx.stroke();
  }

  function drawSolute(): void {
    const r = soluteRadiusPx();
    ctx.beginPath();
    ctx.arc(viewX(view, soluteX), viewY(view, soluteY), r, 0, TAU);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    updateView();

    const amp = currentAmp();

    if (showMap) {
      // 図2 と同じ p 場のセル塗り + U の等値線(§5.3)
      drawPressureOverlay(ctx, view, COLS, ROWS, tensionRgb, compressionRgb);
      drawEnergyContours(amp);
    }

    drawLatticeAtoms(
      ctx,
      view,
      lat,
      EXAGGERATION,
      ATOM_RADIUS_RATIO * view.scale,
      matrixFill,
      matrixEdge,
    );

    // ⊥ 記号は余分な半面の端(変位に追従)に置く(図2 と同様)
    dislocationSymbolPos(EXAGGERATION, symPos);
    drawDislocationMark(ctx, view, symPos.x, symPos.y, defectColor);

    drawSolute();

    // メーターの U はクランプ済み(r ≥ b、|U| ≤ U_b — §5.0)
    drawMeter(w, soluteEnergy(soluteX, soluteY, amp));
  }

  /* ---- ドラッグ(タッチ・マウス両対応: Pointer Events) ---- */

  function onPointerDown(e: PointerEvent): void {
    updateView();
    const dx = e.offsetX - viewX(view, soluteX);
    const dy = e.offsetY - viewY(view, soluteY);
    if (Math.hypot(dx, dy) > soluteRadiusPx() + GRAB_MARGIN_PX) return;
    dragging = true;
    dragPointerId = e.pointerId;
    host.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    updateView();
    // Canvas 座標(y 下向き)→ 物理座標(y 上向き)。格子領域内にクランプ
    soluteX = clamp((e.offsetX - view.cx) / view.scale, -X_MAX_B, X_MAX_B);
    soluteY = clamp((view.cy - e.offsetY) / view.scale, -Y_MAX_B, Y_MAX_B);
    host.requestRender(); // ドラッグ中も pointermove ごとに即時反映(§5.3)
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;
  }

  host.canvas.addEventListener("pointerdown", onPointerDown);
  host.canvas.addEventListener("pointermove", onPointerMove);
  host.canvas.addEventListener("pointerup", onPointerUp);
  host.canvas.addEventListener("pointercancel", onPointerUp);

  /* ---- キーボード代替(受け入れ基準: 矢印キーで 0.5b ずつ移動) ---- */

  // Figure.astro は canvas を aria-hidden にするが、この図版はキャンバス
  // 自体が操作対象なのでフォーカス可能にして公開する
  host.canvas.tabIndex = 0;
  host.canvas.setAttribute("aria-hidden", "false");
  host.canvas.setAttribute("role", "img");
  host.canvas.setAttribute(
    "aria-label",
    "刃状転位のまわりで溶質原子をドラッグまたは矢印キーで動かし、" +
      "相互作用エネルギー U をメーターで読む図。下側(引張側)で U は負になる",
  );

  function onKeyDown(e: KeyboardEvent): void {
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case "ArrowLeft":
        dx = -KEY_STEP_B;
        break;
      case "ArrowRight":
        dx = KEY_STEP_B;
        break;
      case "ArrowUp":
        dy = KEY_STEP_B; // 物理座標は y 上向き
        break;
      case "ArrowDown":
        dy = -KEY_STEP_B;
        break;
      default:
        return;
    }
    e.preventDefault();
    soluteX = clamp(soluteX + dx, -X_MAX_B, X_MAX_B);
    soluteY = clamp(soluteY + dy, -Y_MAX_B, Y_MAX_B);
    host.requestRender();
  }

  host.canvas.addEventListener("keydown", onKeyDown);

  /* ---- 操作部品(§5.3) ---- */

  const typeSeg = host.controls.segmented<SoluteType>({
    id: "solute-type",
    label: "溶質のタイプ",
    options: [
      { value: "interstitial", label: "格子間型(C・大きい)" },
      { value: "substitutional", label: "置換型(小さい原子)" },
    ],
    value: "interstitial",
  });
  typeSeg.onChange((v) => {
    soluteType = v;
    host.requestRender();
  });

  const mapToggle = host.controls.toggle({
    id: "show-map",
    label: "エネルギー地図を表示",
    value: false,
  });
  mapToggle.onChange((v) => {
    showMap = v;
    host.requestRender();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
      host.canvas.removeEventListener("pointermove", onPointerMove);
      host.canvas.removeEventListener("pointerup", onPointerUp);
      host.canvas.removeEventListener("pointercancel", onPointerUp);
      host.canvas.removeEventListener("keydown", onKeyDown);
    },
  };
}
