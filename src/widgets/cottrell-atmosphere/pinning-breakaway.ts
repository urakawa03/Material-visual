/**
 * pinning-breakaway.ts — 図6: 固着と引き離し(記事仕様 §5.6)
 *
 * 水平すべり面上の刃状転位(⊥)が、初期位置 x=0 を囲む凝縮したコットレル
 * 雰囲気(位置固定の炭素点群)に束縛されている。せん断応力 τ を上げると
 * 転位は坂の途中で力がつり合ってわずかに前進し(固着)、τ·b が束縛力の
 * 最大値 F_max を超えた瞬間に引き離されて走り出す(= 上降伏点)。以後は
 * 低い摩擦応力 τ_f で滑走を続けられる(= 下降伏点)。温度を上げると
 * 占有率 θ(T) が急減して τ_c(T) が下がり、歯(落差)が消えることも
 * 確認できる。右の小プロットに τ vs 変位 x の軌跡を記録して描く。
 *
 * 実装方式: 2D / onFrame(離脱後の滑走と自動ランプのため)。手動モードで
 * 静止中(x・τ に変化がないとき)は dirty フラグで描画をスキップし、
 * requestRender 的に振る舞う(§5.6)。
 * 簡略化(図注に明示): 溶質は動かない(十分時効済み・低温での速い負荷を
 * 仮定)。熱活性化による待ち時間は扱わない。数値は典型値による現象論モデル。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { clamp, gaussian, mulberry32 } from "../../core/mathx";
import { darken, matColor, uiColor } from "../../core/colors";
import { C_FAR, U_BIND_EV } from "./lib/constants";
import {
  drawDislocationMark,
  equilibriumOccupancy,
  viewX,
  viewY,
  type LatticeView,
} from "./lib/lattice";
import { makeStackableStage, splitPanels } from "./lib/layout";
import type { Rect } from "./lib/tensile";

/** モード(§5.6: 手動 τ / 自動ランプ。初期は手動) */
type Mode = "manual" | "auto";
const MODE_INIT: Mode = "manual";

/** 乱数シード(雰囲気点群の配置。位置固定なので reset でも再生成不要) */
const SEED = 6109;
/** 雰囲気の溶質数 N(§5.6) */
const N_SOLUTE = 40;
/** 雰囲気点群のガウス分布の標準偏差 σ [b] */
const CLOUD_SIGMA_B = 2;
/** 点群の y 方向の広がりの上限 [b](すべり面の上下にばらす — §5.6) */
const CLOUD_Y_MAX_B = 2.5;
/** 点群の x 方向の広がりの上限 [b](ステージ左側に収める) */
const CLOUD_X_MAX_B = 6.5;

/** 束縛ポテンシャルの幅 w = 2b(§5.6: E_pin(x) = −N_eff U_b e^(−x²/2w²)) */
const PIN_WIDTH_B = 2;
/** 転位の可動域 [b](右端に達したら停止) */
const X_MAX_B = 18;
/** 離脱後の等速滑走の速度 [b/s] */
const GLIDE_SPEED_B_S = 6;
/** 自動ランプの応力上昇速度 [MPa/s] */
const RAMP_RATE_MPA_S = 25;
/** τ スライダーとプロット縦軸の上限 [MPa] */
const TAU_MAX_MPA = 300;
/** 表示換算の校正点: τ_c(300 K) = 270 MPa(図1 の上降伏点と整合 — §5.6) */
const CALIB_TEMP_K = 300;
const TAU_C_CALIB_MPA = 270;
/** 摩擦応力の比: τ_f = 0.85 × τ_c(300 K)(下降伏点 ≈ 230 MPa に相当) */
const TAU_F_RATIO = 0.85;
/** 温度スライダー(§5.6: 300〜900 K・step 25・初期 300) */
const TEMP_MIN = 300;
const TEMP_MAX = 900;
const TEMP_STEP = 25;
const TEMP_INIT = 300;

/** 固定タイムステップ [ms](自動ランプ・滑走を毎回同一挙動にする) */
const STEP_MS = 10;
/** 二分法の反復回数(τ·b = F(x) の安定解 — §5.6 準静的応答) */
const BISECT_ITERS = 40;
/** 軌跡バッファの容量(超えたら記録を打ち切る。通常は 1 千点程度) */
const TRAJ_CAP = 4096;
/** 軌跡の記録しきい値(前回の記録点からの変化量) */
const TRAJ_DX_MIN_B = 0.02;
const TRAJ_DTAU_MIN_MPA = 0.5;

/** パネル分割: ステージ(左)の割合(§5.6 タスク指定 0.58) */
const STAGE_RATIO = 0.58;
/** パネル内余白 [px](日本語ラベルをキャンバス端から 8px 以上離す) */
const PANEL_PAD = 8;
/** 表示スケールの上限 [px/b](タスク指定 ~14px/b) */
const PX_PER_B_MAX = 14;
/** すべり面の縦位置(ステージ高さに対する割合。上部バーのぶん下げる) */
const SLIP_Y_RATIO = 0.55;
/** 溶質の点の半径 [px] */
const SOLUTE_R_PX = 3.5;
/** ⊥ 記号の大きさ [b](14px/b では格子図より小さく見えるため大きめに) */
const MARK_SIZE_B = 2;
/** 雰囲気の不透明度の下限(θ → 0 でも位置は薄く見せる) */
const CLOUD_ALPHA_MIN = 0.25;
/** すべり面の破線パターン(毎フレームの配列割当てを避けるため再利用) */
const SLIP_DASH: number[] = [5, 4];
const NO_DASH: number[] = [];

/** つり合いバーの高さと行送り [px](ラベル 12px — §5.6) */
const BAR_H = 8;
const BAR_LABEL_OFFSET = 16;
const BAR_ROW_STEP = 30;
/** F_max 目盛ラベルの半幅 [px](端でのはみ出しクランプ用) */
const FMAX_LABEL_HALF_PX = 20;
/** 「転位」ラベルの半幅 [px](右端でのはみ出しクランプ用) */
const DISLOC_LABEL_HALF_PX = 14;

/** プロットの軸余白 [px](下端はタイトルの baseline が端から 8px 以上) */
const PLOT_ML = 44;
const PLOT_MR = 10;
const PLOT_MT = 10;
const PLOT_MB = 36;
/** プロットの目盛間隔(x [b] / τ [MPa]) */
const PLOT_X_TICK_B = 6;
const PLOT_TAU_TICK_MPA = 100;
/** 軌跡の線幅と現在点マーカーの半径 [px] */
const CURVE_WIDTH = 2;
const MARKER_R = 4;

/** フォント(補足ラベル 12px・軸タイトルとステージ注記 13px) */
const FONT_SMALL = "12px sans-serif";
const FONT_LABEL = "13px sans-serif";

const TWO_PI = Math.PI * 2;

/** 占有率 θ(T) = c0 e^(U_b/kT) / (1−c0+c0 e^(U_b/kT))(図4 と同じ飽和式) */
function occupancyOf(tempK: number): number {
  return equilibriumOccupancy(-U_BIND_EV, tempK, C_FAR);
}

/**
 * 束縛力(戻す力の大きさ)F(x) = N θ U_b (x/w²) e^(−x²/2w²) [eV/b]。
 * E_pin(x) = −N θ U_b e^(−x²/2w²) の勾配 dE_pin/dx の符号を整理したもので、
 * x > 0 の転位を x = 0 に引き戻す向きの力の大きさを表す。
 */
function bindForceEv(xB: number, theta: number): number {
  const w2 = PIN_WIDTH_B * PIN_WIDTH_B;
  return (
    N_SOLUTE * theta * U_BIND_EV * (xB / w2) * Math.exp(-(xB * xB) / (2 * w2))
  );
}

/** 束縛力の最大値 F_max = N θ U_b e^(−1/2) / w [eV/b](x = w で最大) */
function fMaxEv(theta: number): number {
  return (N_SOLUTE * theta * U_BIND_EV * Math.exp(-0.5)) / PIN_WIDTH_B;
}

/**
 * 表示換算スケール S [MPa/(eV/b)](§5.6)。内部無次元(b=1)の力 F を
 * 応力 τ = F/b [MPa] に換算する。τ_c(300 K) = 270 MPa となるよう校正:
 * S = 270 / (F_max(300 K)/b)。
 */
const FORCE_TO_MPA = TAU_C_CALIB_MPA / fMaxEv(occupancyOf(CALIB_TEMP_K));

/** 摩擦応力 τ_f [MPa](離脱後の下降伏に相当) */
const TAU_F_MPA = TAU_F_RATIO * TAU_C_CALIB_MPA;

export default function pinningBreakaway(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(matColor/uiColor — §6.2)
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill);
  const defectColor = matColor("defect");
  const hairlineColor = uiColor("hairline");
  const labelColor = uiColor("text2");
  const curveColor = matColor("recip");
  const markerColor = uiColor("accent");

  const stage = makeStackableStage(host);

  /* ---- 状態 ---- */

  let mode: Mode = MODE_INIT;
  /** 現在の駆動応力 τ [MPa](手動: スライダー値 / 自動: 内部でランプ) */
  let tauMPa = 0;
  /** 占有率 θ(T) と引き離し臨界応力 τ_c(T) [MPa](T 変更時に再計算) */
  let theta = occupancyOf(TEMP_INIT);
  let tauCNow = FORCE_TO_MPA * fMaxEv(theta);
  /** 転位位置 x [b](物理座標・すべり面上) */
  let x = 0;
  /** 引き離し済みか(溶質は動かないので再固着はしない) */
  let broken = false;
  /** 可動域右端に達したか(以後は静止) */
  let done = false;
  /** dirty フラグ: 手動モードで静止中は描画をスキップする(§5.6) */
  let needsRedraw = true;

  // 凝縮雰囲気の点群(2D ガウス σ=2b・シード固定・位置固定 — §5.6)
  const cloudX = new Float64Array(N_SOLUTE);
  const cloudY = new Float64Array(N_SOLUTE);
  {
    const rand = mulberry32(SEED);
    const gauss = gaussian(rand);
    for (let i = 0; i < N_SOLUTE; i++) {
      // 広がりの上限を超えたサンプルは棄却して引き直す(シード固定で決定的)
      let gx = gauss() * CLOUD_SIGMA_B;
      while (Math.abs(gx) > CLOUD_X_MAX_B) gx = gauss() * CLOUD_SIGMA_B;
      let gy = gauss() * CLOUD_SIGMA_B;
      while (Math.abs(gy) > CLOUD_Y_MAX_B) gy = gauss() * CLOUD_SIGMA_B;
      cloudX[i] = gx;
      cloudY[i] = gy;
    }
  }

  // 軌跡(τ vs x)の記録バッファ(事前確保 — §8.3)
  const trajX = new Float64Array(TRAJ_CAP);
  const trajTau = new Float64Array(TRAJ_CAP);
  let trajCount = 0;

  // 物理座標(b 単位・y 上向き)→ Canvas の変換(値だけ毎フレーム更新)
  const view: LatticeView = { cx: 0, cy: 0, scale: 1 };

  /* ---- モデル(§5.6) ---- */

  /** 束縛力の現在値を表示単位 [MPa] で返す */
  function bindForceMPaOf(xB: number): number {
    return FORCE_TO_MPA * bindForceEv(xB, theta);
  }

  /**
   * 準静的応答: τ·b = F(x) の安定解(0 ≤ x < w)を二分法で求める。
   * F(x) は [0, w] で単調増加なので二分法がそのまま使える。
   */
  function solvePinnedX(tau: number): number {
    if (tau <= 0) return 0;
    let lo = 0;
    let hi = PIN_WIDTH_B;
    for (let i = 0; i < BISECT_ITERS; i++) {
      const mid = (lo + hi) / 2;
      if (bindForceMPaOf(mid) < tau) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** 固着中の転位の座り直しと離脱判定(τ か T が変わったら呼ぶ) */
  function updatePinned(): void {
    if (tauMPa > tauCNow) {
      // 引き離し: τ·b が束縛力の最大値 F_max を超えた(= 上降伏点)
      broken = true;
      x = Math.max(x, PIN_WIDTH_B); // 坂の頂上(x = w)から滑走が始まる
    } else {
      x = solvePinnedX(tauMPa);
    }
  }

  /** 軌跡に現在の (x, τ) を記録する(微小変化はしきい値で間引く) */
  function recordPoint(): void {
    if (trajCount >= TRAJ_CAP) return;
    if (trajCount > 0) {
      const dx = Math.abs(x - trajX[trajCount - 1]);
      const dtau = Math.abs(tauMPa - trajTau[trajCount - 1]);
      if (dx < TRAJ_DX_MIN_B && dtau < TRAJ_DTAU_MIN_MPA) return;
    }
    trajX[trajCount] = x;
    trajTau[trajCount] = tauMPa;
    trajCount++;
  }

  /** 固定タイムステップ 1 歩ぶんの状態更新(自動ランプと滑走) */
  function advance(h: number): void {
    if (done) return;
    if (mode === "auto") {
      if (!broken) {
        // ランプ: τ を一定速度で上げ、つり合い位置を更新(離脱判定を含む)
        tauMPa = Math.min(tauMPa + RAMP_RATE_MPA_S * h, TAU_MAX_MPA);
        updatePinned();
      } else if (tauMPa > TAU_F_MPA) {
        // 離脱の瞬間: 応力は摩擦応力 τ_f まで落ちる(上→下降伏の落差)
        tauMPa = TAU_F_MPA;
      } else if (tauMPa < TAU_F_MPA) {
        // τ_c(T) < τ_f の高温側: 落差なしで τ_f までランプを続ける
        tauMPa = Math.min(tauMPa + RAMP_RATE_MPA_S * h, TAU_F_MPA);
      }
    }
    // 滑走(手動・自動共通): τ ≥ τ_f の間、一定速度で前進(§5.6)
    if (broken && tauMPa >= TAU_F_MPA) {
      x += GLIDE_SPEED_B_S * h;
      if (x >= X_MAX_B) {
        x = X_MAX_B;
        done = true; // 可動域右端で終了
      }
    }
    recordPoint();
  }

  /** onFrame で毎フレーム進める必要があるか(それ以外は dirty 時のみ描画) */
  function isAnimating(): boolean {
    if (done) return false;
    if (mode === "auto") return true; // 再生中はランプまたは滑走が進む
    return broken && tauMPa >= TAU_F_MPA; // 手動モードの滑走中
  }

  /* ---- 描画 ---- */

  /** 上部「力のつり合いバー」: 駆動力 τ·b と束縛力 F(x)(§5.6) */
  function drawBalanceBars(rect: Rect): void {
    const barX = rect.x + PANEL_PAD;
    const barW = rect.w - PANEL_PAD * 2;
    const y1 = rect.y + PANEL_PAD + BAR_LABEL_OFFSET;
    const y2 = y1 + BAR_ROW_STEP;
    const fNow = bindForceMPaOf(x);

    // ラベル + 数値読み出し(12px — §5.6。F は F/b の応力換算値で示す)
    ctx.font = FONT_SMALL;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = labelColor;
    ctx.fillText(
      `駆動力 τ·b: ${Math.round(tauMPa)} MPa`,
      barX,
      y1 - BAR_LABEL_OFFSET,
    );
    ctx.fillText(
      `束縛力 F(x): ${Math.round(fNow)} MPa 相当`,
      barX,
      y2 - BAR_LABEL_OFFSET,
    );

    // トラック(下敷き)と現在値のバー(駆動 = defect / 束縛 = solute)
    ctx.fillStyle = hairlineColor;
    ctx.fillRect(barX, y1, barW, BAR_H);
    ctx.fillRect(barX, y2, barW, BAR_H);
    ctx.fillStyle = defectColor;
    ctx.fillRect(barX, y1, barW * clamp(tauMPa / TAU_MAX_MPA, 0, 1), BAR_H);
    ctx.fillStyle = soluteFill;
    ctx.fillRect(barX, y2, barW * clamp(fNow / TAU_MAX_MPA, 0, 1), BAR_H);

    // 束縛力の最大値 F_max(= τ_c(T) の位置)に目盛線(§5.6)
    const xTick = barX + barW * clamp(tauCNow / TAU_MAX_MPA, 0, 1);
    ctx.strokeStyle = labelColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xTick + 0.5, y1 - 3);
    ctx.lineTo(xTick + 0.5, y2 + BAR_H + 3);
    ctx.stroke();
    ctx.textAlign = "center";
    const tickLabelX = clamp(
      xTick,
      barX + FMAX_LABEL_HALF_PX,
      barX + barW - FMAX_LABEL_HALF_PX,
    );
    ctx.fillText("F_max", tickLabelX, y2 + BAR_H + 6);
  }

  /** 左パネル: すべり面・凝縮雰囲気・転位 ⊥・つり合いバー */
  function drawStageBg(rect: Rect): void {
    // 表示スケール: 雰囲気(左)+ 可動域 0〜18b(右)がパネル幅に収まる
    const spanB = CLOUD_X_MAX_B + 1 + X_MAX_B + 1;
    const scale = Math.min(PX_PER_B_MAX, (rect.w - PANEL_PAD * 2) / spanB);
    view.cx = rect.x + PANEL_PAD + (CLOUD_X_MAX_B + 1) * scale;
    view.cy = rect.y + rect.h * SLIP_Y_RATIO;
    view.scale = scale;

    drawBalanceBars(rect);

    // 水平すべり面(破線 1px, --color-hairline — §5.6)
    ctx.strokeStyle = hairlineColor;
    ctx.lineWidth = 1;
    ctx.setLineDash(SLIP_DASH);
    ctx.beginPath();
    ctx.moveTo(rect.x + PANEL_PAD, view.cy + 0.5);
    ctx.lineTo(rect.x + rect.w - PANEL_PAD, view.cy + 0.5);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);

    // 凝縮雰囲気の点群を 1 パスでまとめ描き(§8.3)。位置は固定のまま、
    // θ(T) の急減(雲の蒸発)を不透明度で示す
    ctx.globalAlpha = CLOUD_ALPHA_MIN + (1 - CLOUD_ALPHA_MIN) * theta;
    ctx.beginPath();
    for (let i = 0; i < N_SOLUTE; i++) {
      const px = viewX(view, cloudX[i]);
      const py = viewY(view, cloudY[i]);
      ctx.moveTo(px + SOLUTE_R_PX, py);
      ctx.arc(px, py, SOLUTE_R_PX, 0, TWO_PI);
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 転位 ⊥(--mat-defect。lattice.ts の描画ヘルパを自前スケールで)
    drawDislocationMark(ctx, view, x, 0, defectColor, MARK_SIZE_B);

    // 注記ラベル(13px, --color-text-2)
    ctx.font = FONT_LABEL;
    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      "炭素の雰囲気(動かない)",
      view.cx,
      viewY(view, -CLOUD_Y_MAX_B) + 6,
    );
    ctx.textBaseline = "alphabetic";
    const markLabelX = Math.min(
      viewX(view, x),
      rect.x + rect.w - PANEL_PAD - DISLOC_LABEL_HALF_PX,
    );
    ctx.fillText("転位", markLabelX, view.cy - MARK_SIZE_B * scale * 0.75 - 8);
  }

  /** 右パネル: τ vs 変位 x の小プロット(自前の簡易軸 — §5.6) */
  function drawPlot(rect: Rect): void {
    const ix = rect.x + PLOT_ML;
    const iy = rect.y + PLOT_MT;
    const iw = Math.max(10, rect.w - PLOT_ML - PLOT_MR);
    const ih = Math.max(10, rect.h - PLOT_MT - PLOT_MB);

    // hairline 枠 + 数個の目盛
    ctx.strokeStyle = hairlineColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(ix + 0.5, iy + 0.5, iw, ih);

    ctx.fillStyle = labelColor;
    ctx.font = FONT_SMALL;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let vb = 0; vb <= X_MAX_B; vb += PLOT_X_TICK_B) {
      const px = ix + (vb / X_MAX_B) * iw;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, iy + ih);
      ctx.lineTo(px + 0.5, iy + ih + 4);
      ctx.stroke();
      ctx.fillText(String(vb), px, iy + ih + 7);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let s = 0; s <= TAU_MAX_MPA; s += PLOT_TAU_TICK_MPA) {
      const py = iy + ih - (s / TAU_MAX_MPA) * ih;
      ctx.beginPath();
      ctx.moveTo(ix - 4, py + 0.5);
      ctx.lineTo(ix, py + 0.5);
      ctx.stroke();
      ctx.fillText(String(s), ix - 7, py);
    }

    // 軸タイトル(13px)
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT_LABEL;
    ctx.fillText("変位 x [b]", ix + iw / 2, iy + ih + 27);
    ctx.save();
    ctx.translate(ix - 32, iy + ih / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("τ [MPa]", 0, 0);
    ctx.restore();

    // 軌跡(離脱の瞬間に 270 → 230 の落差が見える)
    if (trajCount > 1) {
      ctx.strokeStyle = curveColor;
      ctx.lineWidth = CURVE_WIDTH;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(
        ix + (trajX[0] / X_MAX_B) * iw,
        iy + ih - (trajTau[0] / TAU_MAX_MPA) * ih,
      );
      for (let i = 1; i < trajCount; i++) {
        ctx.lineTo(
          ix + (trajX[i] / X_MAX_B) * iw,
          iy + ih - (trajTau[i] / TAU_MAX_MPA) * ih,
        );
      }
      ctx.stroke();
    }

    // 現在点マーカー
    ctx.beginPath();
    ctx.arc(
      ix + (x / X_MAX_B) * iw,
      iy + ih - (clamp(tauMPa, 0, TAU_MAX_MPA) / TAU_MAX_MPA) * ih,
      MARKER_R,
      0,
      TWO_PI,
    );
    ctx.fillStyle = markerColor;
    ctx.fill();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const stacked = stage.isStacked();
    const panels = splitPanels(w, h, stacked, STAGE_RATIO);
    drawStageBg(panels.a);
    drawPlot(panels.b);
  }

  /* ---- 操作部品(§7.2) ---- */

  const modeSeg = host.controls.segmented<Mode>({
    id: "mode",
    label: "モード",
    options: [
      { value: "manual", label: "手動 τ" },
      { value: "auto", label: "自動ランプ" },
    ],
    value: MODE_INIT,
  });

  const tauSlider = host.controls.slider({
    id: "tau",
    label: "せん断応力 τ",
    min: 0,
    max: TAU_MAX_MPA,
    step: 1,
    value: 0,
    unit: "MPa",
  });
  /** τ スライダーの実体 input(自動ランプ時は disabled にする — §5.6) */
  const tauInput = tauSlider.el.querySelector<HTMLInputElement>("input");

  const tempSlider = host.controls.slider({
    id: "temperature",
    label: "温度 T",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "K",
  });

  function syncTauDisabled(): void {
    if (tauInput) tauInput.disabled = mode === "auto"; // 手動時のみ有効
  }

  modeSeg.onChange((v) => {
    mode = v;
    // 自動で進んだ τ をスライダーに引き継いでから手動操作に戻す
    if (v === "manual") tauSlider.set(tauMPa);
    syncTauDisabled();
    needsRedraw = true;
  });

  tauSlider.onChange((v) => {
    tauMPa = v;
    if (!broken) updatePinned(); // 離脱後は τ は滑走条件にのみ効く
    recordPoint();
    needsRedraw = true;
  });

  tempSlider.onChange((v) => {
    theta = occupancyOf(v);
    tauCNow = FORCE_TO_MPA * fMaxEv(theta);
    // 固着中は座り直す。τ が新しい τ_c を超えていれば温度上昇でも離脱する
    if (!broken) updatePinned();
    recordPoint();
    needsRedraw = true;
  });

  host.controls.playPause(); // 自動ランプの再生/一時停止用(初期状態は再生)
  host.controls.reset(() => {
    // §5.6: reset で τ=0・x=0・軌跡クリア(モードと温度は維持)。
    // 再生状態も変えない
    broken = false;
    done = false;
    x = 0;
    trajCount = 0;
    tauSlider.set(0); // onChange 経由で τ=0・つり合い位置・軌跡の始点を再設定
  });

  syncTauDisabled();
  recordPoint(); // 軌跡の始点 (x, τ) = (0, 0)

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    if (isAnimating()) {
      stepper(dt, advance);
      draw();
      needsRedraw = false;
    } else if (needsRedraw) {
      // 手動モードで静止中(x・τ に変化がないとき)は描画をスキップして
      // CPU を使わない(dirty フラグ — §5.6)
      draw();
      needsRedraw = false;
    }
  });
  // 一時停止中の操作(スライダー・リセット・省モーション初期表示)用
  host.onRender(draw);

  return {
    resize(): void {
      stage.update(); // 600px 以下で縦積みに切り替え(§5.0)
      needsRedraw = true;
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
