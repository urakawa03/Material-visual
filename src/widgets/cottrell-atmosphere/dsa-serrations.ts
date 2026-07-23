/**
 * dsa-serrations.ts — 図9: 追いかけっこの窓・動的ひずみ時効(記事仕様 §5.9)
 *
 * 左: 温度 T(20〜400 °C・線形)× ひずみ速度 ε̇(10⁻⁵〜10⁻¹ /s・対数)の
 * レジームマップ。転位の平均待ち時間 t_w = Ω/ε̇ と溶質の拡散時間 τ(T) の
 * 比が 0.1 < t_w/τ < 10 となる「セレーション窓」を accent 色の薄塗りで示し、
 * 現在の (T, ε̇) に defect 色の十字マーカーを重ねる。
 * 右: その条件で逐次生成される σ–ε 曲線。窓内では「応力が A まで盛り上がって
 * 急落する」のこぎり歯が重畳され、窓外では滑らかな硬化曲線に戻る。
 * T・ε̇ を途中で変えると、リセットせず「その場から」新レジームで生成を続ける。
 *
 * 実装方式: 2D / onFrame(ε を一定の表示速度で自動進行。ε = 10% で保持)。
 * マップの枠・目盛・窓の帯は現在の (T, ε̇) に依存しないため、オフスクリーン
 * キャンバスに描いて寸法変更時のみ再計算し、マーカーだけ毎フレーム上描きする。
 * 簡略化(図注に明示): 待ち時間モデルによる模式。ε の進行は実時間の ε̇ とは
 * 切り離した表示速度である。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp, mulberry32 } from "../../core/mathx";
import { matColor, uiColor } from "../../core/colors";
import { agingRecovery, agingTau, CELSIUS_OFFSET } from "./lib/constants";
import { parseRgb } from "./lib/lattice";
import {
  computePlotLayout,
  drawPlotFrame,
  drawPlotMarker,
  plotX,
  plotY,
  STEEL_E_MPA,
  type PlotFrameColors,
  type PlotLayout,
  type Rect,
} from "./lib/tensile";
import { makeStackableStage, splitPanels, type Panels } from "./lib/layout";

/* ------------------------------------------------------ マップ(§5.9) */

/** 温度スライダー(§5.9: 20〜400 °C、step 5、初期 25) */
const T_MIN_C = 20;
const T_MAX_C = 400;
const T_STEP_C = 5;
const T_INIT_C = 25;
/** 温度軸の目盛間隔 [°C] */
const T_TICK_STEP_C = 100;
/** ひずみ速度スライダー(§5.9: 10⁻⁵〜10⁻¹ /s・対数、初期 10⁻³) */
const RATE_MIN = 1e-5;
const RATE_MAX = 1e-1;
const RATE_INIT = 1e-3;
/** ε̇ 軸の範囲(log10) */
const LOG_RATE_MIN = -5;
const LOG_RATE_MAX = -1;
/** 1 回の解放で稼ぐひずみ Ω(転位の平均待ち時間 t_w = Ω/ε̇ — §5.9) */
const OMEGA_STRAIN = 1e-4;
/** 窓の条件: |log10(t_w/τ)| < 1(すなわち 0.1 < t_w/τ < 10 — §5.9) */
const WINDOW_LOG_HALF = 1;
/** 窓の帯を走査する温度刻み [°C](縦帯を積んで塗る) */
const MAP_SCAN_STEP_C = 2;
/** 窓の帯の不透明度(uiColor("accent") の薄塗り — §5.9) */
const MAP_BAND_ALPHA = 0.15;
/** 「セレーション窓」ラベルを添える温度 [°C](窓の中心線上に置く) */
const WINDOW_LABEL_T_C = 340;
/** マップの軸余白(左は 10⁻⁵ 等の目盛と回転軸ラベルのぶん広め) */
const MAP_ML = 56;
const MAP_MR = 14;
const MAP_MT = 10;
const MAP_MB = 34;
/** 回転させた縦軸ラベルの基線位置(パネル左端から。端の余白 8px を確保) */
const MAP_TITLE_X = 18;
/** 十字マーカーの線幅(matColor("defect")・1.5px — §5.9) */
const CROSS_WIDTH = 1.5;
/** 十字の交点に置く点の半径(px) */
const MARKER_DOT_R = 3;

/* ------------------------------------------------------ 曲線(§5.9) */

/** 曲線の描画範囲(ε 0〜10%。終端で保持 — §5.9) */
const CURVE_EPS_MAX = 0.1;
/** 応力軸の上限 [MPa](§5.9: σ 0〜400) */
const SIGMA_AXIS_MAX = 400;
/** 滑らかな硬化曲線 σ_b(ε) = 250 + 550·ε^0.6 [MPa](歯なしのベース — §5.9) */
const BASE_SIGMA0_MPA = 250;
const BASE_K_MPA = 550;
const BASE_EXP = 0.6;
/** ε の表示進行速度 [1/s](≈ 0.8%/s。実時間の ε̇ とは切り離した模式値) */
const DISPLAY_EPS_RATE = 0.008;
/** のこぎり歯の最大振幅 [MPa](A = 25 × 窓深さ係数 × W — §5.9) */
const SERR_AMP_MAX_MPA = 25;
/** のこぎり歯イベントの間隔 Δε ∈ [0.15%, 0.4%](シード付き乱数 — §5.9) */
const EVENT_DEPS_MIN = 0.0015;
const EVENT_DEPS_MAX = 0.004;
/** 曲線を記録するひずみ間隔 */
const RECORD_DEPS = 2e-4;
/** 記録配列の容量(周期記録 500 + イベント記録 ≤ 134 + 操作時の追記) */
const CURVE_CAPACITY = 2048;
/** 曲線の線幅(px) */
const CURVE_WIDTH = 2;
/** 乱数シード(reset で完全に同一ののこぎり歯列を再現 — §8.2) */
const SEED = 20260723;
/** パネル分割: マップパネルの割合(§5.9: 0.44) */
const PANEL_RATIO = 0.44;

const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------ 純関数ヘルパ */

/** Unicode 上付き数字(ε̇ の目盛・指数表示用) */
const SUP_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"] as const;

/** 整数 n を上付き文字列にする(例 −3 → "⁻³") */
function supInt(n: number): string {
  let out = n < 0 ? "⁻" : "";
  for (const ch of String(Math.abs(n))) out += SUP_DIGITS[Number(ch)];
  return out;
}

/** 正の値 v を「1.0×10⁻³」形式に整形する(丸めの繰り上がりも処理) */
function formatSci(v: number): string {
  let e = Math.floor(Math.log10(v) + 1e-9);
  let m = Number((v / Math.pow(10, e)).toFixed(1));
  if (m >= 10) {
    m /= 10;
    e += 1;
  }
  return `${m.toFixed(1)}×10${supInt(e)}`;
}

/** t_w/τ の読み出し表示(中庸な値は素の数字、桁が離れたら指数表示) */
function formatRatio(r: number): string {
  if (r >= 0.01 && r < 100) return String(Number(r.toPrecision(2)));
  return formatSci(r);
}

/** マップの物理座標 → Canvas 座標(T は線形) */
function mapPlotX(plot: Rect, tC: number): number {
  return plot.x + ((tC - T_MIN_C) / (T_MAX_C - T_MIN_C)) * plot.w;
}

/** マップの物理座標 → Canvas 座標(ε̇ は対数。y 反転はここで引き受ける) */
function mapPlotY(plot: Rect, logRate: number): number {
  return (
    plot.y +
    plot.h -
    ((logRate - LOG_RATE_MIN) / (LOG_RATE_MAX - LOG_RATE_MIN)) * plot.h
  );
}

/** 滑らかな硬化曲線 σ_b(ε)(のこぎり歯なしの塑性ブランチ) */
function hardeningStress(e: number): number {
  return BASE_SIGMA0_MPA + BASE_K_MPA * Math.pow(e, BASE_EXP);
}

/** ベース曲線: 弾性立ち上がりと硬化曲線を min で接続する(§5.9) */
function baseStress(e: number): number {
  return Math.min(STEEL_E_MPA * e, hardeningStress(e));
}

/** まだ弾性ブランチ上か(弾性区間にはのこぎり歯を重畳しない) */
function isElastic(e: number): boolean {
  return STEEL_E_MPA * e < hardeningStress(e);
}

export default function dsaSerrations(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(matColor/uiColor — §6.2)
  const hairlineColor = uiColor("hairline");
  const labelColor = uiColor("text2");
  const accentRgb = parseRgb(uiColor("accent"));
  const crossColor = matColor("defect");
  const curveColor = matColor("recip");
  const markerColor = uiColor("accent");
  const plotColors: PlotFrameColors = {
    hairline: hairlineColor,
    label: labelColor,
  };

  const stage = makeStackableStage(host);

  /* ---- 状態 ---- */

  let tempC = T_INIT_C;
  let rate = RATE_INIT;
  /** 現在のレジームののこぎり歯振幅 A [MPa](T・ε̇ 変更時に再計算) */
  let amp = 0;
  /** 現在の t_w/τ(読み出し表示用) */
  let twOverTau = 0;

  /** 現在の公称ひずみ(0〜CURVE_EPS_MAX)。終端で保持しループしない */
  let eps = 0;
  /** ε = 10% に達して保持中か */
  let done = false;
  /** のこぎり歯の現在区間 [eventStartEps, nextEventEps)(ε で刻む) */
  let eventStartEps = 0;
  let nextEventEps = 0;
  let rand = mulberry32(SEED);

  // 記録した曲線(ε は等間隔でないため自前ポリラインで描く — §8.3)
  const curveEps = new Float64Array(CURVE_CAPACITY);
  const curveSig = new Float64Array(CURVE_CAPACITY);
  let curveN = 0;
  let lastRecordEps = 0;

  /**
   * t_w/τ と窓深さ係数からのこぎり歯振幅を再計算する(T・ε̇ 変更時)。
   * A = 25 MPa × (1 − |log10(t_w/τ)|)⁺ × W(t_w, T)(§5.9)。
   * 窓深さ係数は窓中心(t_w = τ)で 1、境界(比 0.1・10)で 0。
   */
  function updateRegime(): void {
    const tempK = tempC + CELSIUS_OFFSET;
    const tw = OMEGA_STRAIN / rate;
    twOverTau = tw / agingTau(tempK);
    const depth = Math.max(
      0,
      1 - Math.abs(Math.log10(twOverTau)) / WINDOW_LOG_HALF,
    );
    amp = depth > 0 ? SERR_AMP_MAX_MPA * depth * agingRecovery(tw, tempK) : 0;
  }

  /** 現在の応力 [MPa] = ベース + のこぎり歯(区間内で 0 → A に線形上昇) */
  function currentSigma(): number {
    const len = nextEventEps - eventStartEps;
    const phase = len > 0 ? clamp((eps - eventStartEps) / len, 0, 1) : 0;
    const a = isElastic(eps) ? 0 : amp;
    return baseStress(eps) + a * phase;
  }

  function record(e: number, s: number): void {
    if (curveN < CURVE_CAPACITY) {
      curveEps[curveN] = e;
      curveSig[curveN] = s;
      curveN++;
    }
    lastRecordEps = e;
  }

  /**
   * 次ののこぎり歯イベントを予約する。イベント間隔は ε だけで決まるので、
   * 乱数列の消費は T・ε̇ の操作履歴によらず一定(reset で完全再現 — §8.2)。
   */
  function scheduleNextEvent(): void {
    eventStartEps = eps;
    nextEventEps =
      eps + EVENT_DEPS_MIN + rand() * (EVENT_DEPS_MAX - EVENT_DEPS_MIN);
  }

  /** 曲線をはじめから生成し直す(reset 用。T・ε̇ は呼び出し側で戻す) */
  function resetRun(): void {
    rand = mulberry32(SEED);
    eps = 0;
    done = false;
    curveN = 0;
    lastRecordEps = 0;
    record(0, 0);
    scheduleNextEvent();
  }

  /**
   * T・ε̇ 変更の直前に、変更前のレジームでの現在応力を確定しておく。
   * これで曲線は「その場から」新レジームに乗り換える(リセットしない — §5.9)。
   */
  function markRegimeChange(): void {
    if (!done && eps > lastRecordEps) record(eps, currentSigma());
  }

  /**
   * ε を表示速度で進めて応力を逐次生成する。イベント境界で分割して進み、
   * 頂点(base + A)と直後の急落を同じ ε に記録してのこぎり歯を作る。
   */
  function advance(dt: number): void {
    if (done) return;
    let remain = DISPLAY_EPS_RATE * dt;
    while (remain > 1e-12 && eps < CURVE_EPS_MAX) {
      const target = Math.min(eps + remain, CURVE_EPS_MAX, nextEventEps);
      remain -= target - eps;
      eps = target;
      if (eps - lastRecordEps >= RECORD_DEPS) record(eps, currentSigma());
      if (eps >= nextEventEps) {
        // 引き離しの瞬間: 盛り上がりの頂点 → 急落(窓外では A = 0 で不可視)
        const a = isElastic(eps) ? 0 : amp;
        record(eps, baseStress(eps) + a);
        scheduleNextEvent(); // 次の捕まえ直し区間へ(盛り上がりを 0 に戻す)
        record(eps, baseStress(eps));
      }
    }
    if (eps >= CURVE_EPS_MAX) {
      record(eps, currentSigma());
      done = true; // ε = 10% で保持(§5.9)
    }
  }

  /* ---- レジームマップ(オフスクリーン) ---- */

  const mapCanvas = document.createElement("canvas");
  const maybeMapCtx = mapCanvas.getContext("2d");
  if (!maybeMapCtx) throw new Error("2D コンテキストを取得できません");
  const mapCtx: CanvasRenderingContext2D = maybeMapCtx;
  let mapW = 0;
  let mapH = 0;
  let mapDpr = 0;

  // 毎フレームの新規割当てを避けるため矩形は再利用(§8.3)
  const offPlot: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const mapPlot: Rect = { x: 0, y: 0, w: 0, h: 0 };
  // パネル分割と曲線レイアウトは寸法/積み方が変わったときだけ作り直す(§8.3)
  let panels: Panels | null = null;
  let curveLayout: PlotLayout | null = null;
  let layoutW = -1;
  let layoutH = -1;
  let layoutStacked = false;

  function computeMapPlot(rect: Rect, out: Rect): void {
    out.x = rect.x + MAP_ML;
    out.y = rect.y + MAP_MT;
    out.w = Math.max(10, rect.w - MAP_ML - MAP_MR);
    out.h = Math.max(10, rect.h - MAP_MT - MAP_MB);
  }

  /** 窓の帯・枠・目盛・軸ラベルをオフスクリーンに描く(静的内容) */
  function drawMapStatic(plot: Rect, panelW: number): void {
    // セレーション窓: T を 2 °C 刻みに走査し、各 T で ε̇ ∈ (Ω/(10τ), 10Ω/τ)
    // の縦帯を積む(§5.9)。log10 で ±1 の帯を軸範囲にクランプして塗る
    const [ar, ag, ab] = accentRgb;
    mapCtx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${MAP_BAND_ALPHA})`;
    for (let t = T_MIN_C; t < T_MAX_C; t += MAP_SCAN_STEP_C) {
      const tau = agingTau(t + MAP_SCAN_STEP_C / 2 + CELSIUS_OFFSET);
      const logCenter = Math.log10(OMEGA_STRAIN / tau); // t_w = τ となる ε̇
      const lo = clamp(logCenter - WINDOW_LOG_HALF, LOG_RATE_MIN, LOG_RATE_MAX);
      const hi = clamp(logCenter + WINDOW_LOG_HALF, LOG_RATE_MIN, LOG_RATE_MAX);
      if (hi <= lo) continue;
      const x0 = mapPlotX(plot, t);
      const x1 = mapPlotX(plot, t + MAP_SCAN_STEP_C);
      const yTop = mapPlotY(plot, hi);
      mapCtx.fillRect(x0, yTop, x1 - x0 + 0.5, mapPlotY(plot, lo) - yTop);
    }

    // 枠と目盛(hairline 1px — §6.5)
    mapCtx.strokeStyle = hairlineColor;
    mapCtx.lineWidth = 1;
    mapCtx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w, plot.h);

    // T の目盛(100 °C 刻み — §5.9)
    mapCtx.fillStyle = labelColor;
    mapCtx.font = "12px sans-serif";
    mapCtx.textAlign = "center";
    mapCtx.textBaseline = "top";
    for (let t = T_TICK_STEP_C; t <= T_MAX_C; t += T_TICK_STEP_C) {
      const x = mapPlotX(plot, t);
      mapCtx.beginPath();
      mapCtx.moveTo(x + 0.5, plot.y + plot.h);
      mapCtx.lineTo(x + 0.5, plot.y + plot.h + 4);
      mapCtx.stroke();
      mapCtx.fillText(String(t), x, plot.y + plot.h + 7);
    }

    // ε̇ の目盛(各桁 — §5.9)
    mapCtx.textAlign = "right";
    mapCtx.textBaseline = "middle";
    for (let e = LOG_RATE_MIN; e <= LOG_RATE_MAX; e++) {
      const y = mapPlotY(plot, e);
      mapCtx.beginPath();
      mapCtx.moveTo(plot.x - 4, y + 0.5);
      mapCtx.lineTo(plot.x, y + 0.5);
      mapCtx.stroke();
      mapCtx.fillText(`10${supInt(e)}`, plot.x - 7, y);
    }

    // 軸ラベル(補足 13px, --color-text-2 — 曲線パネルの軸と同スタイル)
    mapCtx.textAlign = "center";
    mapCtx.textBaseline = "alphabetic";
    mapCtx.font = "13px sans-serif";
    mapCtx.fillText("温度 T [°C]", plot.x + plot.w / 2, plot.y + plot.h + 30);
    mapCtx.save();
    mapCtx.translate(plot.x - MAP_ML + MAP_TITLE_X, plot.y + plot.h / 2);
    mapCtx.rotate(-Math.PI / 2);
    mapCtx.fillText("ひずみ速度 [1/s]", 0, 0);
    mapCtx.restore();

    // 窓のラベル(窓の中心線 t_w = τ の上に置く)
    const labelLog = Math.log10(
      OMEGA_STRAIN / agingTau(WINDOW_LABEL_T_C + CELSIUS_OFFSET),
    );
    if (labelLog > LOG_RATE_MIN && labelLog < LOG_RATE_MAX && panelW > 0) {
      mapCtx.font = "12px sans-serif";
      mapCtx.textAlign = "right";
      mapCtx.textBaseline = "bottom";
      mapCtx.fillText(
        "セレーション窓",
        mapPlotX(plot, WINDOW_LABEL_T_C) - 10,
        mapPlotY(plot, labelLog) - 10,
      );
    }
  }

  /**
   * オフスクリーンのマップを最新化する。窓の形は現在の (T, ε̇) に依存しない
   * ので、再計算が要るのはパネル寸法か dpr が変わったときだけ(§5.9)。
   */
  function ensureMap(rect: Rect, dpr: number): void {
    if (rect.w === mapW && rect.h === mapH && dpr === mapDpr) return;
    mapW = rect.w;
    mapH = rect.h;
    mapDpr = dpr;
    mapCanvas.width = Math.max(1, Math.round(rect.w * dpr));
    mapCanvas.height = Math.max(1, Math.round(rect.h * dpr));
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mapCtx.clearRect(0, 0, rect.w, rect.h);
    offPlot.x = 0;
    offPlot.y = 0;
    offPlot.w = rect.w;
    offPlot.h = rect.h;
    computeMapPlot(offPlot, offPlot);
    drawMapStatic(offPlot, rect.w);
  }

  /* ---- 描画 ---- */

  /** 現在の (T, ε̇) の十字マーカー(defect 色・1.5px — §5.9) */
  function drawCross(plot: Rect): void {
    const x = mapPlotX(plot, tempC);
    const y = mapPlotY(plot, Math.log10(rate));
    ctx.strokeStyle = crossColor;
    ctx.lineWidth = CROSS_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, MARKER_DOT_R, 0, TWO_PI);
    ctx.fillStyle = crossColor;
    ctx.fill();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const stacked = stage.isStacked();
    if (
      panels === null ||
      curveLayout === null ||
      w !== layoutW ||
      h !== layoutH ||
      stacked !== layoutStacked
    ) {
      panels = splitPanels(w, h, stacked, PANEL_RATIO);
      curveLayout = computePlotLayout(panels.b, CURVE_EPS_MAX, SIGMA_AXIS_MAX);
      layoutW = w;
      layoutH = h;
      layoutStacked = stacked;
    }
    const a = panels.a;

    // 左(縦積み時は上): レジームマップ。静的内容はオフスクリーンを転送し、
    // マーカーと t_w/τ の読み出しだけを上描きする
    ensureMap(a, dpr);
    ctx.drawImage(mapCanvas, a.x, a.y, a.w, a.h);
    computeMapPlot(a, mapPlot);
    drawCross(mapPlot);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = labelColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      `t_w/τ = ${formatRatio(twOverTau)}`,
      mapPlot.x + 8,
      mapPlot.y + 8,
    );

    // 右(縦積み時は下): σ–ε 曲線(ε 0〜10%、σ 0〜400 MPa — §5.9)
    const layout = curveLayout;
    drawPlotFrame(ctx, layout, plotColors);
    if (curveN > 0) {
      // 歯の頂点が軸上限を僅かに超え得るので、枠の上辺でクリップする
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        layout.x - CURVE_WIDTH,
        layout.y,
        layout.w + 2 * CURVE_WIDTH,
        layout.h + CURVE_WIDTH,
      );
      ctx.clip();
      ctx.strokeStyle = curveColor;
      ctx.lineWidth = CURVE_WIDTH;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(plotX(layout, curveEps[0]), plotY(layout, curveSig[0]));
      for (let i = 1; i < curveN; i++) {
        ctx.lineTo(plotX(layout, curveEps[i]), plotY(layout, curveSig[i]));
      }
      // 最後の記録点から現在点まで途切れなくつなぐ
      ctx.lineTo(plotX(layout, eps), plotY(layout, currentSigma()));
      ctx.stroke();
      ctx.restore();
    }
    drawPlotMarker(
      ctx,
      layout,
      eps,
      Math.min(currentSigma(), SIGMA_AXIS_MAX),
      markerColor,
    );
  }

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "temperature",
    label: "温度 T",
    min: T_MIN_C,
    max: T_MAX_C,
    step: T_STEP_C,
    value: T_INIT_C,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    markRegimeChange(); // 変更前の応力を確定してから新レジームへ(§5.9)
    tempC = v;
    updateRegime();
  });

  const rateSlider = host.controls.slider({
    id: "strain-rate",
    label: "ひずみ速度",
    min: RATE_MIN,
    max: RATE_MAX,
    value: RATE_INIT,
    scale: "log",
    unit: "1/s",
    format: formatSci, // 指数表示「1.0×10⁻³」(§5.9)
  });
  rateSlider.onChange((v) => {
    markRegimeChange();
    rate = v;
    updateRegime();
  });

  const play = host.controls.playPause();
  // 仕様 §5.9: 初期状態は一時停止(再生ボタンで開始)。engine の既定は
  // 再生中なので、生成直後に 1 回クリックして一時停止から始める
  play.el.click();

  host.controls.reset(() => {
    // 再生状態は変えず、T・ε̇ と曲線を初期状態へ(set は onChange 経由で反映)
    tempSlider.set(T_INIT_C);
    rateSlider.set(RATE_INIT);
    resetRun();
  });

  /* ---- フレームループ ---- */

  // ε の進行は dt に対して線形で、イベントは ε だけで刻まれるため、
  // 固定タイムステップなしでも決定的(図1 と同じ方式)
  host.onFrame((dt) => {
    advance(dt);
    draw();
  });
  // 一時停止中の操作(スライダー・リセット・省モーション初期表示)用
  host.onRender(draw);

  updateRegime();
  resetRun();

  return {
    resize(): void {
      stage.update(); // 600px 以下で縦積みに切り替え(§5.0)
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
