/**
 * strain-aging-cycle.ts — 図8: 歯の復活(ひずみ時効サイクル・記事仕様 §5.8)
 *
 * 「① 2% 引張 → ② 除荷 → ③ 時効 → ④ 再引張」のサイクルを σ–ε 曲線上に
 * 重ね描きし、ひずみ時効による降伏点(歯)の復活を観察させる。時効の回復率
 * W(t, T) = 1 − exp[−(t/τ)^(2/3)](τ = τ0 e^{E_m/kBT})を確定してから
 * 再引張すると、流動応力 σ_f より Δσ_max·W だけ高い上降伏点と、降伏伸び
 * ε'_L = ε_L·W のプラトーが現れる。170 °C なら分単位・室温なら年単位という
 * 時間の目盛り感覚を 2 本のスライダーで掴ませ、焼付硬化(BH)へ橋渡しする。
 *
 * モデル: マスター曲線(図1 の軟鋼)+ 履歴。引張はマスター曲線に沿って
 * Δε = 2% 進み、再引張の歯・プラトーのぶんだけマスターの ε を後ろへ
 * シフトして接続する(累積ひずみは伸び続ける)。
 *
 * 実装方式: 2D / onFrame。ボタン押下で該当区間の折れ線を生成し、約 1.2 秒
 * かけて進行描画する(アニメ中でなければ描画をスキップして CPU を使わない)。
 * 簡略化(図注に明示): 転位密度の増加・回復など他の時効因子は無視。
 * 典型値による現象論モデルであり実測データではない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { agingRecovery, CELSIUS_OFFSET, formatDuration } from "./lib/constants";
import {
  buildMildSteelCurve,
  computePlotLayout,
  curveStressAt,
  drawPlotFrame,
  plotX,
  plotY,
  STEEL_E_MPA,
  STEEL_LUDERS_STRAIN,
  STEEL_SIGMA_LOWER,
  STEEL_SIGMA_UPPER,
  type Curve,
  type PlotFrameColors,
  type PlotLayout,
  type Rect,
} from "./lib/tensile";

/** 手順ステッパーの高さ [px](§5.8 タスク指定 ~34px) */
const STEPPER_H = 34;
/** 1 回の引張でマスター曲線に沿って進むひずみ Δε(§5.8: 2%) */
const PULL_STRAIN = 0.02;
/** 引張系ボタンを無効化する累積ひずみのしきい値(4 サイクル分 — §5.8) */
const PULL_EPS_LIMIT = 0.08;
/** プロットの ε 軸上限(10% で十分 — §5.8) */
const PLOT_EPS_MAX = 0.1;
/** プロットの σ 軸上限 [MPa](図1 と同スタイル) */
const SIGMA_AXIS_MAX = 450;
/**
 * 焼付硬化(BH)の上乗せの最大値 Δσ_max [MPa](§5.8: 上乗せ = Δσ_max·W)。
 * 時効した再引張の上降伏点は「流動応力 + 復活したリューダース段差 +
 * 焼付硬化の上乗せ Δσ_max·W」とする。こうすると再引張の歯は初回の上降伏点
 * より明確に高くなる(§5.8 受け入れ基準「初回より高い」)。
 *
 * 注: §5.8 の受け入れ基準は「初回より約 +35〜40 MPa 高い」と「BH 量の相場
 * 30〜60 MPa」の 2 つを併記するが、この 2 つは同時には満たせない(前者は
 * 再引張ピーク ≈ 305〜310 を要求し、そのとき BH 量 = ピーク − 流動応力 ≈
 * 65〜70 で後者の上限を超える)。本実装は「復活した歯が初回より明確に高い」
 * という教育的意図を優先し、既定条件(170 °C・20 分, W≈0.79)で初回比 +31 MPa・
 * BH 量 ≈ 61 MPa となる値に校正した(母体仕様 §2-5 の誠実な簡略化)。
 */
const DSIGMA_MAX_MPA = 40;
/** 復活したリューダース段差 [MPa](= 初回の歯の高さ σ_u − σ_l。§5.8) */
const REVIVED_LUDERS_MPA = STEEL_SIGMA_UPPER - STEEL_SIGMA_LOWER;
/** 歯が出る回復率のしきい値(W ≤ 0.02 なら歯なしで滑らかに接続) */
const TOOTH_W_MIN = 0.02;
/** 再引張の上→下降伏の遷移幅(ひずみ 0.08% — §5.8) */
const RETOOTH_WIDTH = 0.0008;
/** 進行アニメの所要時間 [s](§5.8: ボタン押下ごとに約 1.2 秒) */
const ANIM_DURATION_S = 1.2;
/** 折れ線サンプリングのひずみ刻み(全区間共通 → 進行速度が ε 一様になる) */
const SAMPLE_DEPS = 2e-5;
/** 軌跡バッファの容量(最大 5〜6 サイクルぶんの事前確保 — §8.3) */
const PT_CAP = 12288;
/** 区間(セグメント)数の上限(1 サイクル = 引張 + 除荷の 2 区間) */
const SEG_CAP = 16;
/** 過去サイクルの淡色表示の不透明度(§5.8) */
const PAST_ALPHA = 0.35;
/** 曲線の線幅 [px] */
const CURVE_WIDTH = 2;
/** 進行アニメ先端のマーカー半径 [px] */
const MARKER_R = 4;
/** 時効温度スライダー(§5.8: 20〜300 °C・step 5・初期 170) */
const TEMP_MIN_C = 20;
const TEMP_MAX_C = 300;
const TEMP_STEP_C = 5;
const TEMP_INIT_C = 170;
/** 時効時間 log スライダー(§5.8: 10^0〜10^8 s・初期 1.2×10^3 s = 20 分) */
const TIME_MIN_S = 1;
const TIME_MAX_S = 1e8;
const TIME_INIT_S = 1.2e3;
/** キャンバス端の最小余白 [px](日本語テキストのはみ出し防止) */
const EDGE_PAD = 8;

/** ステッパーの表示(現在の段階を accent + 太字で強調 — §5.8) */
const STEP_LABELS = ["① 2% 引張", "② 除荷", "③ 時効", "④ 再引張"] as const;
const STEP_ARROW = " → ";
const FONT_STEP = "13px sans-serif";
const FONT_STEP_ACTIVE = "bold 13px sans-serif";
/** 時効の読み出し(プロット右上・白縁取り)のフォント */
const FONT_READOUT = "13px sans-serif";

const TWO_PI = Math.PI * 2;

/** 操作の進行段階(ボタンの有効/無効の切替に使う — §5.8) */
type Phase = "initial" | "pulled" | "unloaded";

export default function strainAgingCycle(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(matColor/uiColor — §6.2)
  const curveColor = matColor("recip");
  const labelColor = uiColor("text2");
  const accentColor = uiColor("accent");
  const bgColor = uiColor("bg");
  const plotColors: PlotFrameColors = {
    hairline: uiColor("hairline"),
    label: labelColor,
  };

  // マスター曲線(内部シード固定 — reset で毎回同一 §8.2)
  const master: Curve = buildMildSteelCurve();

  /* ---- 状態(§5.8 のモデル: マスター曲線 + 履歴) ---- */

  let phase: Phase = "initial";
  /** ステッパーで強調する段階(1〜4)。実行中の操作 or 次に促す操作 */
  let activeStep = 1;
  /** サイクル番号(引張のたびに +1)。過去サイクルの淡色判定に使う */
  let cycle = 0;
  /** 現在点の累積全ひずみ ε_now(プロット横軸。伸び続ける) */
  let epsNow = 0;
  /** 現在点の応力 [MPa] */
  let sigNow = 0;
  /** マスター曲線上の位置(流動応力 σ_f = σ_m(ここ)。歯・プラトーの
   *  ぶんだけ累積ひずみより遅れる = マスターの ε の後ろシフト) */
  let epsMaster = 0;
  /** 除荷後の塑性ひずみ ε_p = ε_now − σ/E */
  let epsP = 0;

  /** 進行アニメの状態(アニメ中でなければ描画スキップ — §5.8) */
  let animating = false;
  let animT = 0;
  let needsRedraw = true;
  /**
   * engine がこの図版のフレームを回しているか(setPlaying で受け取る)。
   * 省モーション時や画面外では false になり、onFrame が呼ばれない。
   * このとき進行アニメを回しても animT が進まないので、即時に完了させる。
   */
  let framesFlowing = false;

  // 軌跡(全サイクルの折れ線)は TypedArray に事前確保して蓄積(§8.3)
  const ptEps = new Float64Array(PT_CAP);
  const ptSig = new Float64Array(PT_CAP);
  let ptCount = 0;
  const segStart = new Int32Array(SEG_CAP);
  const segLen = new Int32Array(SEG_CAP);
  const segCycle = new Int32Array(SEG_CAP);
  let segCount = 0;

  // 毎フレームの新規割当てを避けるための再利用オブジェクト(§8.3)
  const plotRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const stepWidths = new Float64Array(STEP_LABELS.length);
  // プロットレイアウトは寸法が変わったときだけ作り直す(§8.3)
  let layout: PlotLayout | null = null;
  let layoutW = -1;
  let layoutH = -1;

  /* ---- 区間(折れ線)の生成 ---- */

  function pushPoint(e: number, s: number): void {
    if (ptCount >= PT_CAP) return;
    ptEps[ptCount] = e;
    ptSig[ptCount] = s;
    ptCount++;
  }

  function beginSegment(): number {
    return ptCount;
  }

  function endSegment(start: number): void {
    if (segCount >= SEG_CAP) return;
    segStart[segCount] = start;
    segLen[segCount] = ptCount - start;
    segCycle[segCount] = cycle;
    segCount++;
  }

  /**
   * 区間 [eA, eB] を SAMPLE_DEPS 刻みで折れ線に追加する(両端を必ず含む)。
   * プロット上限 ε_max を超える部分は切り捨てる。ボタン押下時にのみ呼ぶ
   * (毎フレームではないのでクロージャ許容)。
   */
  function samplePiece(
    eA: number,
    eB: number,
    sigmaAt: (e: number) => number,
  ): void {
    const end = Math.min(eB, PLOT_EPS_MAX);
    if (end <= eA) return;
    const n = Math.max(1, Math.ceil((end - eA) / SAMPLE_DEPS));
    for (let k = 0; k <= n; k++) {
      const e = eA + ((end - eA) * k) / n;
      pushPoint(e, sigmaAt(e));
    }
  }

  /** ① 初回の引張: マスター曲線を 0 → 2% なぞる(歯とプラトー前半) */
  function genFirstPull(): void {
    const start = beginSegment();
    samplePiece(0, PULL_STRAIN, (e) => curveStressAt(master, e));
    epsMaster = PULL_STRAIN;
    epsNow = ptEps[ptCount - 1];
    sigNow = ptSig[ptCount - 1];
    endSegment(start);
  }

  /**
   * ④ 再引張(§5.8): (ε_p, 0) から弾性線(傾き E)で立ち上がり、
   * W > 0.02 なら上降伏 σ_f + Δσ_max·W → 0.08% 幅で σ_f へ降下 →
   * 降伏伸び ε'_L = ε_L·W のプラトー → マスター曲線へ復帰(マスターの
   * ε はプラトー等のぶんだけ後ろへシフトして接続)。W ≤ 0.02 なら歯なしで
   * 滑らかに接続。マスター上を Δε = 2% 進んで終わる。
   */
  function genRetension(w: number): void {
    const start = beginSegment();
    const sigF = curveStressAt(master, epsMaster); // 再引張の流動応力
    const hasTooth = w > TOOTH_W_MIN;
    // 復活した上降伏点 = 流動応力 + リューダース段差 + 焼付硬化の上乗せ
    const sigPeak = hasTooth
      ? sigF + REVIVED_LUDERS_MPA + DSIGMA_MAX_MPA * w
      : sigF;
    const e1 = epsP + sigPeak / STEEL_E_MPA; // 弾性線の終点
    const e2 = hasTooth ? e1 + RETOOTH_WIDTH : e1; // 上→下降伏の降下の終点
    const e3 = hasTooth ? e2 + STEEL_LUDERS_STRAIN * w : e2; // プラトー終点
    const e4 = e3 + PULL_STRAIN; // マスター区間の終点

    samplePiece(epsP, e1, (e) => STEEL_E_MPA * (e - epsP));
    if (hasTooth) {
      samplePiece(e1, e2, (e) => {
        // 上降伏 → 下降伏(= σ_f)への短い滑らかな降下(図1 と同形)
        const t = (e - e1) / RETOOTH_WIDTH;
        const s = t * t * (3 - 2 * t);
        return sigPeak - (sigPeak - sigF) * s;
      });
      samplePiece(e2, e3, () => sigF);
    }
    samplePiece(e3, e4, (e) => curveStressAt(master, epsMaster + (e - e3)));

    // プロット上限でクランプされた場合は実際に進んだぶんだけ状態を更新
    const eEnd = Math.min(e4, PLOT_EPS_MAX);
    epsMaster += Math.max(0, eEnd - Math.min(e3, PLOT_EPS_MAX));
    epsNow = ptEps[ptCount - 1];
    sigNow = ptSig[ptCount - 1];
    endSegment(start);
  }

  /** ② 除荷: 傾き E の弾性線で σ = 0 まで(ε_p = ε_now − σ/E — §5.8) */
  function genUnload(): void {
    const start = beginSegment();
    const e0 = epsNow;
    const s0 = sigNow;
    epsP = e0 - s0 / STEEL_E_MPA;
    const n = Math.max(1, Math.ceil((e0 - epsP) / SAMPLE_DEPS));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pushPoint(e0 + (epsP - e0) * t, s0 * (1 - t));
    }
    epsNow = epsP;
    sigNow = 0;
    endSegment(start);
  }

  /* ---- 描画 ---- */

  /** 上部の手順ステッパー: 現在の段階を accent + 太字で強調(§5.8) */
  function drawStepper(w: number): void {
    const y = STEPPER_H / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // 各ラベル幅を測ってセンタリング(アクティブは太字なので都度測る)
    let total = 0;
    for (let i = 0; i < STEP_LABELS.length; i++) {
      ctx.font = i + 1 === activeStep ? FONT_STEP_ACTIVE : FONT_STEP;
      stepWidths[i] = ctx.measureText(STEP_LABELS[i]).width;
      total += stepWidths[i];
    }
    ctx.font = FONT_STEP;
    const arrowW = ctx.measureText(STEP_ARROW).width;
    total += arrowW * (STEP_LABELS.length - 1);
    let x = Math.max(EDGE_PAD, (w - total) / 2);
    for (let i = 0; i < STEP_LABELS.length; i++) {
      const active = i + 1 === activeStep;
      ctx.font = active ? FONT_STEP_ACTIVE : FONT_STEP;
      ctx.fillStyle = active ? accentColor : labelColor;
      ctx.fillText(STEP_LABELS[i], x, y);
      x += stepWidths[i];
      if (i < STEP_LABELS.length - 1) {
        ctx.font = FONT_STEP;
        ctx.fillStyle = labelColor;
        ctx.fillText(STEP_ARROW, x, y);
        x += arrowW;
      }
    }
  }

  /** 蓄積した全サイクルの軌跡。過去サイクルは淡色、現在は濃色(§5.8) */
  function drawSegments(l: PlotLayout): void {
    ctx.lineWidth = CURVE_WIDTH;
    ctx.strokeStyle = curveColor;
    ctx.lineJoin = "round";
    let tipE = epsNow;
    let tipS = sigNow;
    for (let s = 0; s < segCount; s++) {
      const len = segLen[s];
      if (len < 2) continue;
      const start = segStart[s];
      // 進行アニメ中の最終区間は進捗ぶんだけ描く(約 1.2 秒 — §5.8)
      let drawTo = len - 1;
      let frac = 0;
      if (animating && s === segCount - 1) {
        const idx = Math.min(1, animT / ANIM_DURATION_S) * (len - 1);
        drawTo = Math.floor(idx);
        frac = idx - drawTo;
      }
      ctx.globalAlpha = segCycle[s] < cycle ? PAST_ALPHA : 1;
      ctx.beginPath();
      ctx.moveTo(plotX(l, ptEps[start]), plotY(l, ptSig[start]));
      for (let i = 1; i <= drawTo; i++) {
        ctx.lineTo(plotX(l, ptEps[start + i]), plotY(l, ptSig[start + i]));
      }
      if (frac > 0 && drawTo + 1 < len) {
        const i0 = start + drawTo;
        tipE = ptEps[i0] + (ptEps[i0 + 1] - ptEps[i0]) * frac;
        tipS = ptSig[i0] + (ptSig[i0 + 1] - ptSig[i0]) * frac;
        ctx.lineTo(plotX(l, tipE), plotY(l, tipS));
      } else if (animating && s === segCount - 1) {
        tipE = ptEps[start + drawTo];
        tipS = ptSig[start + drawTo];
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // アニメ中は進行の先端にマーカー(現在点)
    if (animating && segCount > 0) {
      ctx.beginPath();
      ctx.arc(plotX(l, tipE), plotY(l, tipS), MARKER_R, 0, TWO_PI);
      ctx.fillStyle = accentColor;
      ctx.fill();
    }
  }

  /**
   * 時効の読み出し(プロット右上・白縁取り — §5.8)。スライダーの現在値に
   * 対する W を常に表示し、変更を即時反映する。
   */
  function drawReadout(l: PlotLayout): void {
    const tS = timeSlider.value;
    const tC = tempSlider.value;
    const w = agingRecovery(tS, tC + CELSIUS_OFFSET);
    const text = `${Math.round(tC)} °C・${formatDuration(tS)} → 回復率 ${Math.round(w * 100)}%`;
    ctx.font = FONT_READOUT;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = bgColor; // 曲線と重なっても読めるよう白の縁取り
    ctx.fillStyle = labelColor;
    const x = l.x + l.w - EDGE_PAD;
    const y = l.y + EDGE_PAD;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawStepper(w);

    // ステッパーの下は全面 σ–ε プロット(§5.8)。レイアウトは寸法変化時のみ再計算
    if (layout === null || w !== layoutW || h !== layoutH) {
      plotRect.x = 0;
      plotRect.y = STEPPER_H;
      plotRect.w = w;
      plotRect.h = h - STEPPER_H;
      layout = computePlotLayout(plotRect, PLOT_EPS_MAX, SIGMA_AXIS_MAX);
      layoutW = w;
      layoutH = h;
    }
    drawPlotFrame(ctx, layout, plotColors);
    drawSegments(layout);
    drawReadout(layout);
  }

  /* ---- 操作部品(§7.2) ---- */

  const pullBtn = host.controls.button({ label: "引張する(2%)" });
  const unloadBtn = host.controls.button({ label: "除荷する" });
  const ageBtn = host.controls.button({ label: "時効して再引張" });
  const resetBtn = host.controls.reset(() => {
    resetAll();
  });
  resetBtn.el.textContent = "はじめから"; // §5.8: reset の表示名

  const tempSlider = host.controls.slider({
    id: "aging-temp",
    label: "時効温度",
    min: TEMP_MIN_C,
    max: TEMP_MAX_C,
    step: TEMP_STEP_C,
    value: TEMP_INIT_C,
    unit: "°C",
  });
  const timeSlider = host.controls.slider({
    id: "aging-time",
    label: "時効時間",
    min: TIME_MIN_S,
    max: TIME_MAX_S,
    value: TIME_INIT_S,
    scale: "log",
    format: formatDuration, // 秒/分/時間/日/年で自動整形(§5.8)
  });
  // スライダー変更時は読み出し(その条件での W)を即時更新(§5.8)
  tempSlider.onChange(() => {
    needsRedraw = true;
  });
  timeSlider.onChange(() => {
    needsRedraw = true;
  });

  /** 状態に応じてボタンの有効/無効を切り替える(§5.8) */
  function syncButtons(): void {
    pullBtn.el.disabled = animating || phase !== "initial";
    unloadBtn.el.disabled = animating || phase !== "pulled";
    // ε_now > 8% では再引張も打ち止め(プロットは 10% まで — §5.8)
    ageBtn.el.disabled =
      animating || phase !== "unloaded" || epsNow > PULL_EPS_LIMIT;
  }

  /** 進行アニメを完了状態にする(次に促す操作を強調しボタンを開放) */
  function finishAnim(): void {
    animT = ANIM_DURATION_S;
    animating = false;
    activeStep = phase === "pulled" ? 2 : 3;
    syncButtons();
  }

  /**
   * 進行アニメを開始する(押下直後に 1 フレーム目を即時反映)。
   * フレームが回っていない(省モーション・画面外)ときは animT が進まず
   * 曲線が描かれないまま固着するため、アニメを省いて最終曲線を即時表示する
   * (母体仕様 §7.1: 省モーション時は意味のある静止フレームを出す)。
   */
  function startAnim(): void {
    if (!framesFlowing) {
      finishAnim();
      needsRedraw = true;
      host.requestRender();
      return;
    }
    animating = true;
    animT = 0;
    syncButtons();
    needsRedraw = true;
    host.requestRender();
  }

  pullBtn.onClick(() => {
    if (animating || phase !== "initial") return;
    cycle++;
    genFirstPull();
    phase = "pulled";
    activeStep = 1;
    startAnim();
  });

  unloadBtn.onClick(() => {
    if (animating || phase !== "pulled") return;
    genUnload();
    phase = "unloaded";
    activeStep = 2;
    startAnim();
  });

  ageBtn.onClick(() => {
    if (animating || phase !== "unloaded" || epsNow > PULL_EPS_LIMIT) return;
    // ③ 時効: ボタン押下で W をスライダー値から確定してから ④ 再引張(§5.8)
    const w = agingRecovery(
      timeSlider.value,
      tempSlider.value + CELSIUS_OFFSET,
    );
    cycle++;
    genRetension(w);
    phase = "pulled";
    activeStep = 4;
    startAnim();
  });

  /** 初期状態へ(§5.8「はじめから」)。再生状態は変えない */
  function resetAll(): void {
    ptCount = 0;
    segCount = 0;
    cycle = 0;
    phase = "initial";
    activeStep = 1;
    epsNow = 0;
    sigNow = 0;
    epsMaster = 0;
    epsP = 0;
    animating = false;
    animT = 0;
    tempSlider.set(TEMP_INIT_C);
    timeSlider.set(TIME_INIT_S);
    syncButtons();
    needsRedraw = true;
  }

  syncButtons(); // 初期状態: 引張のみ有効(§5.8)

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    if (animating) {
      animT += dt;
      if (animT >= ANIM_DURATION_S) finishAnim(); // 完了処理
      draw();
      needsRedraw = false;
    } else if (needsRedraw) {
      // アニメ中でなければ描画をスキップして CPU を使わない(§5.8)
      draw();
      needsRedraw = false;
    }
  });
  // 一時停止中の操作(スライダー・リセット・省モーション初期表示)用
  host.onRender(draw);

  return {
    resize(): void {
      needsRedraw = true; // engine が直後に 1 フレーム描画する
    },
    setPlaying(p: boolean): void {
      framesFlowing = p;
      // 省モーション中に開始したアニメが宙づりのままなら、再生開始時に
      // 残りを進める(次フレーム以降 onFrame が消化する)
      if (p) needsRedraw = true;
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
