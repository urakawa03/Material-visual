/**
 * yield-tooth.ts — 図1: 引張試験と「歯」(記事仕様 §5.1)
 *
 * 左にダンベル形試験片、右に σ–ε 曲線を並べ、焼なまし軟鋼の上降伏点 →
 * 下降伏点の「歯」と降伏伸び(プラトー)を観察させる。プラトーの間は
 * 試験片の平行部に降伏済み領域が下端から広がる簡易表現(詳細モデルは図7)。
 * アルミニウム合金に切り替えると歯が消えることを対比で見せる。
 *
 * 実装方式: 2D / onFrame(ε を一定速度で自動進行)。曲線は初期化時に
 * 事前計算した折れ線を進行度でクリップ描画する。
 * 簡略化(図注に明示): 典型値による模式曲線。くびれ・破断は扱わない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import { darken, matColor, uiColor } from "../../core/colors";
import {
  buildAluminumCurve,
  buildMildSteelCurve,
  computePlotLayout,
  curveStressAt,
  drawCurve,
  drawPlotFrame,
  drawPlotMarker,
  drawSpecimen,
  EPS_MAX,
  STEEL_EPS_UPPER,
  STEEL_LUDERS_STRAIN,
  STEEL_TOOTH_WIDTH,
  type Curve,
  type PlotFrameColors,
  type Rect,
  type SpecimenColors,
  type SpecimenState,
} from "./lib/tensile";
import { makeStackableStage, splitPanels } from "./lib/layout";

/** 材料の選択肢(§5.1: 切替時は自動 reset) */
type Material = "steel" | "aluminum";
const MATERIAL_INIT: Material = "steel";

/** パネル分割: 横並び時の試験片パネルの割合 */
const SPECIMEN_RATIO_WIDE = 0.36;
/** パネル分割: 縦積み時は上=試験片(描画領域を確保するため広め) */
const SPECIMEN_RATIO_STACKED = 0.42;
/** 試験片パネル内の余白(px)。日本語ラベルのはみ出し防止も兼ねる */
const PANEL_PAD = 8;

/** 1× での引張の所要時間(ε=0 → ε_max。約 18 秒 — §5.1) */
const PULL_DURATION_S = 18;
/** ε の進行速度(1/s・1× 時) */
const EPS_RATE = EPS_MAX / PULL_DURATION_S;
/** 引張速度スライダー(§5.1: 0.5×〜3×、初期 1×) */
const SPEED_MIN = 0.5;
const SPEED_MAX = 3;
const SPEED_INIT = 1;
const SPEED_STEP = 0.1;

/** プロットの応力軸の上限 [MPa](軟鋼の ε=15% で σ≈430 が収まる) */
const SIGMA_AXIS_MAX = 450;
/** 曲線の線幅(px) */
const CURVE_WIDTH = 2;
/** 降伏済み領域のハッチ線の暗さ(母相色をわずかに暗く) */
const HATCH_DARKEN = 0.05;

/** プラトー開始ひずみ(歯の遷移が終わった点) */
const PLATEAU_START = STEEL_EPS_UPPER + STEEL_TOOTH_WIDTH;

export default function yieldTooth(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(matColor/uiColor — §6.2)
  const specimenColors: SpecimenColors = {
    outline: darken(matColor("matrix")),
    grip: uiColor("hairline"),
    yielded: matColor("tension"),
    hatch: darken(matColor("matrix"), HATCH_DARKEN),
  };
  const plotColors: PlotFrameColors = {
    hairline: uiColor("hairline"),
    label: uiColor("text2"),
  };
  const curveColor = matColor("recip");
  const markerColor = uiColor("accent");

  // 曲線は初期化時に生成して使い回す(シード固定 — reset で毎回同一 §5.1)
  const steelCurve: Curve = buildMildSteelCurve();
  const aluminumCurve: Curve = buildAluminumCurve();

  const stage = makeStackableStage(host);

  let material: Material = MATERIAL_INIT;
  let speed = SPEED_INIT;
  /** 現在の公称ひずみ(0〜EPS_MAX)。終端で保持しループしない */
  let eps = 0;

  // 毎フレームの新規割当てを避けるため描画用オブジェクトは再利用(§8.3)
  const specimenRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const specimenState: SpecimenState = {
    strain: 0,
    yieldedFrom: 0,
    yieldedTo: 0,
  };

  function currentCurve(): Curve {
    return material === "steel" ? steelCurve : aluminumCurve;
  }

  /**
   * 試験片の降伏済み区間の上端(0〜1)。プラトー内の進行度に対応させ、
   * プラトー前は 0、プラトー後は 1(全断面降伏)とする(§5.1)。
   * アルミ合金では降伏領域は表示しない。
   */
  function yieldedProgress(): number {
    if (material !== "steel") return 0;
    return clamp((eps - PLATEAU_START) / STEEL_LUDERS_STRAIN, 0, 1);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const stacked = stage.isStacked();
    const { a, b } = splitPanels(
      w,
      h,
      stacked,
      stacked ? SPECIMEN_RATIO_STACKED : SPECIMEN_RATIO_WIDE,
    );

    // 左(縦積み時は上): ダンベル形試験片。伸びと降伏領域を反映
    specimenRect.x = a.x + PANEL_PAD;
    specimenRect.y = a.y + PANEL_PAD;
    specimenRect.w = a.w - PANEL_PAD * 2;
    specimenRect.h = a.h - PANEL_PAD * 2;
    specimenState.strain = eps;
    specimenState.yieldedTo = yieldedProgress();
    drawSpecimen(ctx, specimenRect, specimenState, specimenColors);

    // 右(縦積み時は下): σ–ε 曲線を進行度 ε までクリップ描画 + 現在点
    const layout = computePlotLayout(b, EPS_MAX, SIGMA_AXIS_MAX);
    drawPlotFrame(ctx, layout, plotColors);
    const curve = currentCurve();
    drawCurve(ctx, layout, curve, curveColor, CURVE_WIDTH, eps);
    drawPlotMarker(ctx, layout, eps, curveStressAt(curve, eps), markerColor);
  }

  /** 引張をはじめからやり直す(材料切替と reset で共用) */
  function resetRun(): void {
    eps = 0;
  }

  /* ---- 操作部品(§7.2) ---- */

  const materialSeg = host.controls.segmented<Material>({
    id: "material",
    label: "材料",
    options: [
      { value: "steel", label: "焼なまし軟鋼" },
      { value: "aluminum", label: "アルミニウム合金" },
    ],
    value: MATERIAL_INIT,
  });
  materialSeg.onChange((v) => {
    material = v;
    resetRun(); // 切替時は自動 reset(§5.1)。再生状態は変えない
  });

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

  const play = host.controls.playPause();
  // 仕様 §5.1: 初期状態は一時停止(再生ボタンで開始)。engine の既定は
  // 再生中なので、生成直後に 1 回クリックして一時停止から始める
  play.el.click();

  host.controls.reset(() => {
    // 再生状態は変えず、材料・速度・ε を初期状態へ(set は onChange 経由で反映)
    materialSeg.set(MATERIAL_INIT);
    speedSlider.set(SPEED_INIT);
    resetRun();
  });

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    // ε を一定速度で進め、終端では自動停止せず保持(ループしない — §5.1)
    eps = Math.min(eps + EPS_RATE * speed * dt, EPS_MAX);
    draw();
  });
  // 一時停止中の操作(材料切替・リセット・省モーション初期表示)用
  host.onRender(draw);

  return {
    resize(): void {
      stage.update(); // 600px 以下で縦積みに切り替え(§5.0)
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
