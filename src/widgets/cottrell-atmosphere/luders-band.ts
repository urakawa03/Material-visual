/**
 * luders-band.ts — 図7: 降伏の前線・リューダース帯(記事仕様 §5.7)
 *
 * 上: 平板試験片をセル 64 個の横帯で表現(未降伏 = 無地 + hairline 枠、
 * 降伏済み = 薄い引張色 + 斜線テクスチャ、帯前面に defect 色のマーカー)。
 * 下: σ–ε 曲線(図1 と同スタイル)。1D 直列セルモデルを固定タイムステップで
 * 積分し、歯 → プラトー(帯の掃引)→ 全域降伏後の加工硬化を描く。
 *
 * モデル(§5.7): 応力は全セル共通 σ = K_m(ε_app − mean ε_p)。未降伏セルは
 * σ ≥ τ_u,i で降伏し、降伏済みセルは粘塑性 dε_p/dt = (σ − τ_l,i)/η と
 * 線形硬化 τ_l,i += h·dε_p に従う。降伏セルの隣接未降伏セルは τ_u を
 * Δ_front だけ引き下げる(応力集中の代理 → 帯の前面伝播)。
 *
 * 実装方式: 2D / onFrame + fixedStep(8)。この図は帯が横長のため最初から
 * 上下構成とし、横並び⇄縦積みの切替は行わない(600px 以下ではアスペクト比
 * のみ縦長に切り替えて描画領域を確保する)。
 * 簡略化(図注に明示): 1 次元の模式モデル。帯の傾き(約 50°)などの 2D
 * 幾何は扱わない。曲線は典型値による現象論であり実測データではない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { mulberry32 } from "../../core/mathx";
import { darken, matColor, uiColor } from "../../core/colors";
import {
  computePlotLayout,
  drawPlotFrame,
  drawPlotMarker,
  EPS_MAX,
  fillHatch,
  plotX,
  plotY,
  STEEL_E_MPA,
  STEEL_SIGMA_LOWER,
  STEEL_SIGMA_UPPER,
  type PlotFrameColors,
  type Rect,
} from "./lib/tensile";
import { makeStackableStage } from "./lib/layout";

/* ------------------------------------------------------ モデル定数(§5.7) */

/** 試験片を表すセルの個数 */
const CELL_COUNT = 64;
/** 試験機 + 弾性の合成剛性 K_m [MPa](= E = 210 GPa) */
const K_MACHINE_MPA = STEEL_E_MPA;
/** クロスヘッドの公称ひずみ速度 [1/s](1× 時) */
const BASE_STRAIN_RATE = 0.0025;
/** 未降伏セルの降伏応力 τ_u の基準値 [MPa](図1 の上降伏点と整合) */
const TAU_U_BASE = STEEL_SIGMA_UPPER;
/** 降伏済みセルの流動応力 τ_l の初期値 [MPa](図1 の下降伏点と整合) */
const TAU_L_INIT = STEEL_SIGMA_LOWER;
/**
 * 前面バイアス Δ_front [MPa]: 降伏セルの隣接未降伏セルの τ_u をこの分だけ
 * 引き下げる(応力集中の代理)。仕様目安 25 からリューダースひずみと
 * プラトー応力(≈ 250 MPa)の釣り合いを見て校正。
 */
const DELTA_FRONT = 20;
/** 粘塑性の粘性係数 η [MPa·s] */
const ETA_VISC = 800;
/**
 * 線形硬化係数 h [MPa]。セルが流動を終えるまでの塑性ひずみは
 * ≈ (σ_plateau − τ_l)/h なので、リューダースひずみが不均一さ 3% で
 * 約 2.5% になるよう校正(§5.7 の校正指示。仕様の目安値は 1000)。
 */
const HARDENING_H = 550;
/**
 * 降伏の瞬間にセルへ与える微小な塑性ひずみバースト。降伏なだれの応力解放を
 * 表し、これがないと弾性負荷が前面の伝播(1 セル/ステップ)を追い越して
 * σ が過剰に上振れし、低い不均一さでも帯が多数核生成してしまう。
 */
const YIELD_BURST_EPS = 1e-3;
/** セル 0 の τ_u 引き下げ量 [MPa](フィレットでの核生成 — §5.7) */
const CELL0_WEAKEN = 10;
/** τ_u のばらつきの乱数シード(reset で完全に同一の初期状態へ — §8.2) */
const SEED = 20260723;
/** 固定タイムステップ(ms) */
const STEP_MS = 8;

/** 引張速度スライダー(§5.7: 0.5×〜4×、初期 1×) */
const SPEED_MIN = 0.5;
const SPEED_MAX = 4;
const SPEED_INIT = 1;
const SPEED_STEP = 0.1;
/** 不均一さスライダー(§5.7: τ_u のセル間ばらつき 0〜10%、初期 3%) */
const INHOM_MIN = 0;
const INHOM_MAX = 10;
const INHOM_INIT = 3;
const INHOM_STEP = 0.5;

/* ------------------------------------------------------ 曲線の記録 */

/** 曲線を記録するひずみ間隔 Δε_app(§5.7) */
const RECORD_DEPS = 2e-4;
/**
 * 記録配列の容量。Δε 刻みで EPS_MAX/RECORD_DEPS = 750 点 + 降伏イベント時の
 * 追加記録(歯の頂点を逃さないため。各セル 1 回 ≤ 64 点)+ 端点で足りる。
 */
const CURVE_CAPACITY = 1024;
/** 曲線の線幅(px) */
const CURVE_WIDTH = 2;
/** プロットの応力軸の上限 [MPa](§5.7: sigMax = 450) */
const SIGMA_AXIS_MAX = 450;

/* ------------------------------------------------------ レイアウト・描画 */

/** 上パネル(帯状試験片)の高さの割合(§5.7: 上 30% / 下 70%) */
const BAND_PANEL_RATIO = 0.3;
/** キャンバス端の余白(px)。日本語ラベルのはみ出し防止も兼ねる */
const CANVAS_MARGIN = 8;
/** 上下パネル間の余白(px) */
const PANEL_GAP = 10;
/** つかみ部の示唆(hairline の塗り)の幅(px — §5.7) */
const GRIP_W = 8;
/** つかみ部を帯より上下に張り出させる量(px) */
const GRIP_EXTRA = 4;
/** 帯の高さの上限(px) */
const BAND_MAX_H = 56;
/** 読み出しテキスト行の高さ(px) */
const READOUT_H = 22;
/** 前面マーカーの太さ(px — §5.7: 3px の縦線) */
const FRONT_MARKER_W = 3;
/** 前面マーカーを帯より上下に張り出させる量(px) */
const FRONT_MARKER_EXTRA = 3;
/** 降伏済み領域のハッチ線の暗さ(図1 と同じ) */
const HATCH_DARKEN = 0.05;
/** ハッチ線の間隔(px)。セル幅より細かい「短い斜線」にする */
const HATCH_SPACING = 5;

export default function ludersBand(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(matColor/uiColor — §6.2)
  const hairlineColor = uiColor("hairline");
  const labelColor = uiColor("text2");
  const yieldedFill = matColor("tension");
  const hatchColor = darken(matColor("matrix"), HATCH_DARKEN);
  const frontColor = matColor("defect");
  const curveColor = matColor("recip");
  const markerColor = uiColor("accent");
  const plotColors: PlotFrameColors = {
    hairline: hairlineColor,
    label: labelColor,
  };

  // 縦積み切替はしないが、600px 以下ではアスペクト比だけ縦長にして
  // プロットの高さを確保する(§5.0 のレイアウト指針の代替)
  const stage = makeStackableStage(host, "4 / 3");

  /* ---- 状態(TypedArray を事前確保して再利用 — §8.3) ---- */

  /** τ_u ばらつきの単位ジッター(−1〜+1)。シード固定で構築時に一度生成 */
  const jitter = new Float64Array(CELL_COUNT);
  {
    const rand = mulberry32(SEED);
    for (let i = 0; i < CELL_COUNT; i++) jitter[i] = 2 * rand() - 1;
  }

  /** 各セルの降伏応力 τ_u,i [MPa](不均一さ変更時に再生成) */
  const tauU = new Float64Array(CELL_COUNT);
  /** 各セルの流動応力 τ_l,i [MPa](硬化で増加) */
  const tauL = new Float64Array(CELL_COUNT);
  /** 各セルの塑性ひずみ ε_p,i */
  const epsP = new Float64Array(CELL_COUNT);
  /** 降伏済みフラグ */
  const yielded = new Uint8Array(CELL_COUNT);
  /** ステップ開始時の降伏フラグのスナップショット(前面判定用) */
  const prevYielded = new Uint8Array(CELL_COUNT);

  /** 記録した曲線(ε は等間隔でないため自前ポリラインで描く — §5.7) */
  const curveEps = new Float64Array(CURVE_CAPACITY);
  const curveSig = new Float64Array(CURVE_CAPACITY);
  let curveN = 0;
  let lastRecordEps = 0;

  let speed = SPEED_INIT;
  let inhomPct = INHOM_INIT;
  /** クロスヘッドの公称ひずみ ε_app */
  let epsApp = 0;
  /** 現在の応力 σ [MPa](全セル共通) */
  let sigma = 0;
  /** ε_app が EPS_MAX に達したら停止・保持(§5.7) */
  let holding = false;

  /** τ_u,i = τ_u·(1 + U(−δ, δ))。セル 0 はフィレット相当で弱める(§5.7) */
  function regenTauU(): void {
    const delta = inhomPct / 100;
    for (let i = 0; i < CELL_COUNT; i++) {
      tauU[i] = TAU_U_BASE * (1 + delta * jitter[i]);
    }
    tauU[0] -= CELL0_WEAKEN;
  }

  function record(e: number, s: number): void {
    if (curveN < CURVE_CAPACITY) {
      curveEps[curveN] = e;
      curveSig[curveN] = s;
      curveN++;
    }
    lastRecordEps = e;
  }

  /** 引張をはじめからやり直す(τ_u は regenTauU の結果を維持) */
  function resetRun(): void {
    tauL.fill(TAU_L_INIT);
    epsP.fill(0);
    yielded.fill(0);
    epsApp = 0;
    sigma = 0;
    holding = false;
    curveN = 0;
    record(0, 0);
  }

  /* ---- 1D セルモデルの 1 ステップ(hs: 秒 — §5.7) ---- */

  function simStep(hs: number): void {
    if (holding) return;
    epsApp = Math.min(epsApp + BASE_STRAIN_RATE * hs, EPS_MAX);

    // 応力は全セル共通: σ = K_m(ε_app − mean ε_p)
    let meanEpsP = 0;
    for (let i = 0; i < CELL_COUNT; i++) meanEpsP += epsP[i];
    meanEpsP /= CELL_COUNT;
    sigma = K_MACHINE_MPA * (epsApp - meanEpsP);

    // 降伏判定。前面バイアスはステップ開始時のスナップショットで評価し、
    // 1 ステップ内の連鎖(帯が一瞬で走り切る)を防ぐ
    prevYielded.set(yielded);
    let newYield = false;
    for (let i = 0; i < CELL_COUNT; i++) {
      if (prevYielded[i] === 1) continue;
      const nearFront =
        (i > 0 && prevYielded[i - 1] === 1) ||
        (i < CELL_COUNT - 1 && prevYielded[i + 1] === 1);
      const threshold = tauU[i] - (nearFront ? DELTA_FRONT : 0);
      if (sigma >= threshold) {
        yielded[i] = 1;
        // 降伏なだれの応力解放(微小バースト + それに伴う硬化)
        epsP[i] += YIELD_BURST_EPS;
        tauL[i] += HARDENING_H * YIELD_BURST_EPS;
        newYield = true;
      }
    }

    // 降伏済みセルの粘塑性流動 + 線形硬化
    for (let i = 0; i < CELL_COUNT; i++) {
      if (yielded[i] === 0 || sigma <= tauL[i]) continue;
      const dEps = ((sigma - tauL[i]) / ETA_VISC) * hs;
      epsP[i] += dEps;
      tauL[i] += HARDENING_H * dEps;
    }

    if (epsApp >= EPS_MAX) holding = true;

    // Δε ごとの記録に加え、降伏イベント時と終端でも記録して
    // 歯の頂点・プラトーの段差がなまらないようにする
    if (newYield || holding || epsApp - lastRecordEps >= RECORD_DEPS) {
      record(epsApp, sigma);
    }
  }

  /* ---- 描画 ---- */

  // 毎フレームの新規割当てを避けるためパネル矩形は再利用(§8.3)
  const bandRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const plotRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  /** 上パネル: 帯状試験片(64 セル)と前面マーカー */
  function drawBand(rect: Rect): void {
    let yieldedCount = 0;
    for (let i = 0; i < CELL_COUNT; i++) yieldedCount += yielded[i];

    // 読み出し(補足テキスト 13px, --color-text-2)
    ctx.font = "13px sans-serif";
    ctx.fillStyle = labelColor;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("試験片(64 セルの帯)", rect.x, rect.y);
    ctx.textAlign = "right";
    ctx.fillText(
      `降伏 ${yieldedCount} / ${CELL_COUNT} セル`,
      rect.x + rect.w,
      rect.y,
    );

    const areaH = rect.h - READOUT_H;
    const bandH = Math.min(areaH, BAND_MAX_H);
    const bandY = rect.y + READOUT_H + (areaH - bandH) / 2;
    const cellsX = rect.x + GRIP_W;
    const cellsW = rect.w - 2 * GRIP_W;
    const cellW = cellsW / CELL_COUNT;

    // 両端のつかみ部の示唆(hairline の塗り 8px — §5.7)
    ctx.fillStyle = hairlineColor;
    ctx.fillRect(rect.x, bandY - GRIP_EXTRA, GRIP_W, bandH + 2 * GRIP_EXTRA);
    ctx.fillRect(
      rect.x + rect.w - GRIP_W,
      bandY - GRIP_EXTRA,
      GRIP_W,
      bandH + 2 * GRIP_EXTRA,
    );

    // 降伏済みセルは連続ラン単位でまとめ塗り(薄い引張色 + 斜線 — §5.7)
    for (let i = 0; i < CELL_COUNT;) {
      if (yielded[i] === 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < CELL_COUNT && yielded[j] === 1) j++;
      const x0 = cellsX + i * cellW;
      const runW = (j - i) * cellW;
      ctx.fillStyle = yieldedFill;
      ctx.fillRect(x0, bandY, runW, bandH);
      fillHatch(ctx, x0, bandY, runW, bandH, hatchColor, HATCH_SPACING);
      i = j;
    }

    // セルの枠(hairline 1px — §6.5): 外枠 + 縦の区切り線
    ctx.strokeStyle = hairlineColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(cellsX + 0.5, bandY + 0.5, cellsW - 1, bandH - 1);
    ctx.beginPath();
    for (let i = 1; i < CELL_COUNT; i++) {
      const x = cellsX + i * cellW;
      ctx.moveTo(x, bandY);
      ctx.lineTo(x, bandY + bandH);
    }
    ctx.stroke();

    // 帯前面のマーカー(降伏済みセルと未降伏セルの境界に defect 色 3px)
    ctx.fillStyle = frontColor;
    for (let i = 0; i < CELL_COUNT; i++) {
      if (yielded[i] === 0) continue;
      if (i > 0 && yielded[i - 1] === 0) {
        ctx.fillRect(
          cellsX + i * cellW - FRONT_MARKER_W / 2,
          bandY - FRONT_MARKER_EXTRA,
          FRONT_MARKER_W,
          bandH + 2 * FRONT_MARKER_EXTRA,
        );
      }
      if (i < CELL_COUNT - 1 && yielded[i + 1] === 0) {
        ctx.fillRect(
          cellsX + (i + 1) * cellW - FRONT_MARKER_W / 2,
          bandY - FRONT_MARKER_EXTRA,
          FRONT_MARKER_W,
          bandH + 2 * FRONT_MARKER_EXTRA,
        );
      }
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 上 30% = 帯状試験片、下 70% = σ–ε 曲線の上下分割(§5.7)
    bandRect.x = CANVAS_MARGIN;
    bandRect.y = CANVAS_MARGIN;
    bandRect.w = w - 2 * CANVAS_MARGIN;
    bandRect.h = Math.round(h * BAND_PANEL_RATIO) - CANVAS_MARGIN;
    plotRect.x = 0;
    plotRect.y = bandRect.y + bandRect.h + PANEL_GAP;
    plotRect.w = w;
    plotRect.h = h - plotRect.y;

    drawBand(bandRect);

    // σ–ε 曲線(図1 と同スタイル)。記録点は等間隔でないので自前ポリライン。
    // 縦軸の反転(応力が上向き)は plotY が引き受ける
    const layout = computePlotLayout(plotRect, EPS_MAX, SIGMA_AXIS_MAX);
    drawPlotFrame(ctx, layout, plotColors);
    if (curveN > 0) {
      ctx.strokeStyle = curveColor;
      ctx.lineWidth = CURVE_WIDTH;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(plotX(layout, curveEps[0]), plotY(layout, curveSig[0]));
      for (let i = 1; i < curveN; i++) {
        ctx.lineTo(plotX(layout, curveEps[i]), plotY(layout, curveSig[i]));
      }
      // 最後の記録点から現在点まで途切れなくつなぐ
      ctx.lineTo(plotX(layout, epsApp), plotY(layout, sigma));
      ctx.stroke();
    }
    drawPlotMarker(ctx, layout, epsApp, sigma, markerColor);
  }

  /* ---- 操作部品(§7.2) ---- */

  const speedSlider = host.controls.slider({
    id: "speed",
    label: "引張速度",
    min: SPEED_MIN,
    max: SPEED_MAX,
    step: SPEED_STEP,
    value: SPEED_INIT,
    format: (v) => `×${v.toFixed(1)}`,
  });
  speedSlider.onChange((v) => {
    speed = v;
  });

  const inhomSlider = host.controls.slider({
    id: "inhomogeneity",
    label: "不均一さ",
    min: INHOM_MIN,
    max: INHOM_MAX,
    step: INHOM_STEP,
    value: INHOM_INIT,
    unit: "%",
  });
  inhomSlider.onChange((v) => {
    // 変更時は τ_u を再生成して自動 reset(§5.7)。再生状態は変えない
    inhomPct = v;
    regenTauU();
    resetRun();
  });

  const play = host.controls.playPause();
  // 仕様 §5.7: 初期状態は一時停止(再生ボタンで開始)。engine の既定は
  // 再生中なので、生成直後に 1 回クリックして一時停止から始める
  play.el.click();

  host.controls.reset(() => {
    // 再生状態は変えず、速度・不均一さ・進行を初期状態へ。
    // inhomSlider.set は onChange 経由で τ_u 再生成 + resetRun を呼ぶ
    speedSlider.set(SPEED_INIT);
    inhomSlider.set(INHOM_INIT);
    resetRun();
  });

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    stepper(dt, (hReal) => {
      // 引張速度は時間ワープとして扱う: 実時間 8ms でシミュレーション時間
      // 8ms × speed を消化する。サブステップは 8ms 以下に保ち、前面の伝播
      // (1 セル/ステップ)の数値挙動を速度によらず一定にする
      const nSub = Math.ceil(speed);
      const hs = (hReal * speed) / nSub;
      for (let k = 0; k < nSub; k++) simStep(hs);
    });
    draw();
  });
  // 一時停止中の操作(スライダー・リセット・省モーション初期表示)用
  host.onRender(draw);

  regenTauU();
  resetRun();

  return {
    resize(): void {
      stage.update(); // 600px 以下でアスペクト比を縦長に切り替え
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
