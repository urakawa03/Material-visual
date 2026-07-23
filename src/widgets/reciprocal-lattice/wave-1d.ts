/**
 * wave-1d.ts — 図2「縞で格子を測る」(仕様書 05 §5.2)
 *
 * 上段(高さ 60%)= 幅 10.5 nm の窓に原子列(間隔 a・N 個・中央寄せ)と
 * 縞 cos(2πqx)。下段(40%)= 空間周波数軸 0〜12 nm⁻¹ に現在の q マーカーと
 * 発見済みの一致点。q を自動掃引(または手動操作)し、全原子が縞の山に
 * 乗る q = n/a を「発見」して軸上に記録していく — 1 次元の逆格子の組み立て。
 * 一致度 M は lattice.ts の laue1D(式 E2)で計算する(再実装しない)。
 *
 * 簡略化(図注に明示): 原子は 1 次元の点として描き、熱振動は無視する。
 * 有限の N による一致の山の幅(≈ 1/(Na))は隠さず見せる。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { laue1D } from "./lattice";
import {
  CANVAS_FONT,
  createReadout,
  drawAtoms,
  drawScaleBar,
  withClip,
  type PanelMapper,
  type PanelRect,
} from "./_shared2d";

/* ---------------------------------------------------- 上段(原子列 + 縞) */

/** 上段窓の幅(nm)。pxPerNm = (size.w − 2×余白) / 10.5(§5.2) */
const WINDOW_NM = 10.5;
/** 左右余白(px)。上段窓と下段軸で共通 */
const SIDE_MARGIN_PX = 24;
/** 上段(原子列 + 縞)が占める高さの割合。残り 40% が下段の周波数軸 */
const TOP_FRACTION = 0.6;
/** 原子の見た目半径(px) */
const ATOM_RADIUS_PX = 4.5;
/** 縞の山の帯の不透明度(§5.2: 12% 目安) */
const BAND_ALPHA = 0.12;
/** 帯の半幅(縞間隔 λ に対する割合)。帯幅 λ/2 = 半幅 λ/4 */
const BAND_HALF_FRACTION = 0.25;
/** 山の中心線の不透明度・線幅(通常 / 一致時はやや強調) */
const CREST_ALPHA = 0.5;
const CREST_ALPHA_MATCH = 0.95;
const CREST_WIDTH = 1;
const CREST_WIDTH_MATCH = 1.8;
/** 縞間隔 λ がこれ未満(px)なら帯は一様塗りで代替(_shared2d と同値) */
const MIN_STRIPE_PX = 2.5;
/** 一様塗り代替時の不透明度係数(帯の平均被覆率の近似。_shared2d と同値) */
const FINE_STRIPE_ALPHA_SCALE = 0.6;
/** スケールバーの長さ(nm) */
const SCALE_BAR_NM = 1;

/* ------------------------------------------------------------ パラメータ */

/** 空間周波数 q スライダー(§5.2 の表: 0〜12 nm⁻¹、step 0.02、初期 1.2) */
const Q_MIN = 0;
const Q_MAX = 12;
const Q_STEP = 0.02;
const Q_INIT = 1.2;
/** 格子間隔 a スライダー(0.25〜0.50 nm、step 0.01、初期 0.40) */
const A_MIN = 0.25;
const A_MAX = 0.5;
const A_STEP = 0.01;
const A_INIT = 0.4;
/** 原子の数 N スライダー(4〜20 個、step 1、初期 12) */
const N_MIN = 4;
const N_MAX = 20;
const N_INIT = 12;

/** 自動掃引: q が 0→12→0 を片道約 15 秒で往復(速度 12/15 nm⁻¹ 毎秒) */
const SWEEP_SECONDS = 15;
const SWEEP_SPEED = (Q_MAX - Q_MIN) / SWEEP_SECONDS;

/** 一致(発見)判定: |q − n/a| ≤ 0.05 nm⁻¹ かつ M ≥ 0.98(§5.2) */
const MATCH_Q_TOL = 0.05;
const MATCH_M_MIN = 0.98;
/** 軸範囲チェックなど浮動小数比較の微小量 */
const EPS = 1e-9;

/* ------------------------------------------------------ 下段(周波数軸) */

/** 目盛り間隔(nm⁻¹)と数値ラベルの間隔(nm⁻¹) */
const TICK_STEP = 1;
const LABEL_STEP = 2;
/** 目盛り線の長さ・ラベルと軸タイトルの縦オフセット(px) */
const TICK_LEN = 5;
const TICK_LABEL_GAP = 8;
const AXIS_TITLE_GAP = 24;
/** 下段領域内での軸線の縦位置(上端からの割合) */
const AXIS_POS_FRACTION = 0.35;
const AXIS_TITLE = "空間周波数 q [nm⁻¹]";
/** 発見済みの一致点の半径(px) */
const FOUND_RADIUS_PX = 5;
/** 現在の q マーカー(beam の下向き三角 + 縦線)の寸法(px) */
const MARKER_LINE_ABOVE = 18;
const MARKER_LINE_BELOW = 8;
const MARKER_LINE_WIDTH = 1.5;
const MARKER_TIP_GAP = 4;
const MARKER_TRI_H = 8;
const MARKER_TRI_HALF_W = 5;

const TAU = Math.PI * 2;

export default function wave1d(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色はトークンから初期化時に一度だけ解決する(§6.2・§13)
  const matrixFill = matColor("matrix");
  const beam = matColor("beam");
  const recip = matColor("recip");
  const hairline = uiColor("hairline");
  const text2 = uiColor("text2");

  /* ---- 状態 ---- */

  let q = Q_INIT; // 空間周波数(nm⁻¹)
  let a = A_INIT; // 格子間隔(nm)
  let nAtoms = N_INIT; // 原子の数
  let sweepDir = 1; // 掃引方向(+1 / −1)
  let auto = true; // 自動掃引中か(エンジンの再生状態とは独立)
  let dirty = true; // 次のフレームで描き直すか
  let syncing = false; // プログラムからの slider.set を利用者操作と区別する
  /** 発見済みの一致点(整数 n。位置は q_n = n/a) */
  const discovered = new Set<number>();

  // 原子位置(世界座標 nm の平坦配列)。毎フレーム再利用する(§8.3)
  const atomsXY = new Float64Array(N_MAX * 2);

  // 上段窓の矩形とマッパ。実体は draw() が毎回書き換える
  // (レイアウト依存値は描画時に再計算 — リサイズに自動追従)
  const windowRect: PanelRect = { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 };
  const mapper: PanelMapper = {
    panel: windowRect,
    pxPerUnit: 1,
    toPxX: (u: number): number => windowRect.cx + u * mapper.pxPerUnit,
    toPxY: (u: number): number => windowRect.cy - u * mapper.pxPerUnit,
    toUnitX: (px: number): number => (px - windowRect.cx) / mapper.pxPerUnit,
    toUnitY: (px: number): number => (windowRect.cy - px) / mapper.pxPerUnit,
  };

  /* ---- 一致判定 ---- */

  /**
   * 現在の q が一致条件を満たすなら対応する整数 n(≥ 0)、
   * 満たさなければ −1 を返す。m には laue1D(q, a, nAtoms) を渡す。
   * q = 0(n = 0)も一致点として扱う(§5.2: 原点も逆格子の仲間)。
   */
  function matchIndex(m: number): number {
    const n = Math.round(q * a);
    if (n < 0 || m < MATCH_M_MIN) return -1;
    const qn = n / a;
    if (qn > Q_MAX + EPS) return -1;
    return Math.abs(q - qn) <= MATCH_Q_TOL ? n : -1;
  }

  /** q の更新のたび(掃引・スライダーとも)に呼び、一致点を記録する */
  function checkDiscovery(): void {
    const n = matchIndex(laue1D(q, a, nAtoms));
    if (n >= 0 && !discovered.has(n)) {
      discovered.add(n);
      dirty = true;
    }
  }

  /* ---- 描画 ---- */

  /** 上段: 原子列の基準線・縞(帯 + 山の中心線)・原子・スケールバー */
  function drawTopPanel(matched: boolean): void {
    const topH = windowRect.h;
    const x0 = (-(nAtoms - 1) * a) / 2; // 最左端の原子位置(nm)

    // 原子列の乗る中央の水平線(補助線 — §6.5)
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(windowRect.x, windowRect.cy);
    ctx.lineTo(windowRect.x + windowRect.w, windowRect.cy);
    ctx.stroke();

    // 縞: cos(2πqx) の山を帯で塗り、山の中心線を重ねる
    withClip(ctx, windowRect, () => {
      ctx.fillStyle = beam;
      if (q === 0) {
        // q = 0: 一様な縞(全面が山)。全体を薄く塗る
        ctx.globalAlpha = BAND_ALPHA;
        ctx.fillRect(windowRect.x, windowRect.y, windowRect.w, topH);
        ctx.globalAlpha = 1;
        return;
      }
      const lambdaPx = mapper.pxPerUnit / q; // 縞間隔 λ(px)
      if (lambdaPx < MIN_STRIPE_PX) {
        // 縞が細かすぎて描けない: 一様塗りで代替
        ctx.globalAlpha = BAND_ALPHA * FINE_STRIPE_ALPHA_SCALE;
        ctx.fillRect(windowRect.x, windowRect.y, windowRect.w, topH);
        ctx.globalAlpha = 1;
        return;
      }
      // 山の中心を最左端の原子にアンカーする: crest x = x0 + n/q
      const anchorPx = mapper.toPxX(x0);
      const left = windowRect.x;
      const right = windowRect.x + windowRect.w;
      const n0 = Math.floor((left - anchorPx) / lambdaPx - BAND_HALF_FRACTION);
      const n1 = Math.ceil((right - anchorPx) / lambdaPx + BAND_HALF_FRACTION);
      // 山の帯(幅 λ/2、山の中心線を中心に)
      ctx.globalAlpha = BAND_ALPHA;
      for (let n = n0; n <= n1; n++) {
        const cx = anchorPx + n * lambdaPx;
        ctx.fillRect(
          cx - lambdaPx * BAND_HALF_FRACTION,
          windowRect.y,
          lambdaPx * BAND_HALF_FRACTION * 2,
          topH,
        );
      }
      // 山の中心線(一致時はやや強調 — §5.2)
      ctx.globalAlpha = matched ? CREST_ALPHA_MATCH : CREST_ALPHA;
      ctx.strokeStyle = beam;
      ctx.lineWidth = matched ? CREST_WIDTH_MATCH : CREST_WIDTH;
      ctx.beginPath();
      for (let n = n0; n <= n1; n++) {
        const cx = anchorPx + n * lambdaPx;
        ctx.moveTo(cx, windowRect.y);
        ctx.lineTo(cx, windowRect.y + topH);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // 原子列 x_j = x0 + j·a(中央寄せ、中央の水平線上)
    for (let j = 0; j < nAtoms; j++) {
      atomsXY[j * 2] = x0 + j * a;
      atomsXY[j * 2 + 1] = 0;
    }
    drawAtoms(ctx, atomsXY, nAtoms, mapper, ATOM_RADIUS_PX, matrixFill);

    drawScaleBar(ctx, windowRect, mapper.pxPerUnit, SCALE_BAR_NM, "1 nm");
  }

  /** 下段: 周波数軸・目盛り・発見済みの一致点・現在の q マーカー */
  function drawAxisPanel(w: number, h: number, topH: number): void {
    const axisY = topH + (h - topH) * AXIS_POS_FRACTION;
    const left = SIDE_MARGIN_PX;
    const right = w - SIDE_MARGIN_PX;
    const pxPerQ = (right - left) / (Q_MAX - Q_MIN);

    // 軸線と 1 nm⁻¹ ごとの目盛り(hairline)
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, axisY);
    ctx.lineTo(right, axisY);
    for (let t = Q_MIN; t <= Q_MAX; t += TICK_STEP) {
      const x = left + (t - Q_MIN) * pxPerQ;
      ctx.moveTo(x, axisY);
      ctx.lineTo(x, axisY + TICK_LEN);
    }
    ctx.stroke();

    // 2 nm⁻¹ ごとの数値ラベルと軸ラベル(text2)
    ctx.fillStyle = text2;
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let t = Q_MIN; t <= Q_MAX; t += LABEL_STEP) {
      ctx.fillText(
        String(t),
        left + (t - Q_MIN) * pxPerQ,
        axisY + TICK_LABEL_GAP,
      );
    }
    ctx.fillText(AXIS_TITLE, (left + right) / 2, axisY + AXIS_TITLE_GAP);

    // 発見済みの一致点(q_n = n/a の位置に recip の点)。
    // 未発見の候補は描かない(発見の驚きを残す — §5.2)
    ctx.fillStyle = recip;
    ctx.beginPath();
    for (const n of discovered) {
      const qn = n / a;
      if (qn > Q_MAX + EPS) continue;
      const x = left + (qn - Q_MIN) * pxPerQ;
      ctx.moveTo(x + FOUND_RADIUS_PX, axisY);
      ctx.arc(x, axisY, FOUND_RADIUS_PX, 0, TAU);
    }
    ctx.fill();

    // 現在の q マーカー(beam 色の下向き三角 + 縦線)
    const qPx = left + (q - Q_MIN) * pxPerQ;
    ctx.strokeStyle = beam;
    ctx.lineWidth = MARKER_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(qPx, axisY - MARKER_LINE_ABOVE);
    ctx.lineTo(qPx, axisY + MARKER_LINE_BELOW);
    ctx.stroke();
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(qPx, axisY - MARKER_TIP_GAP);
    ctx.lineTo(qPx - MARKER_TRI_HALF_W, axisY - MARKER_TIP_GAP - MARKER_TRI_H);
    ctx.lineTo(qPx + MARKER_TRI_HALF_W, axisY - MARKER_TIP_GAP - MARKER_TRI_H);
    ctx.closePath();
    ctx.fill();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // レイアウトは毎描画で再計算する(§7.1: リサイズ後の 1 フレームで追従)
    const topH = h * TOP_FRACTION;
    windowRect.x = SIDE_MARGIN_PX;
    windowRect.y = 0;
    windowRect.w = w - SIDE_MARGIN_PX * 2;
    windowRect.h = topH;
    windowRect.cx = w / 2;
    windowRect.cy = topH / 2;
    mapper.pxPerUnit = windowRect.w / WINDOW_NM;

    const m = laue1D(q, a, nAtoms);
    drawTopPanel(matchIndex(m) >= 0);
    drawAxisPanel(w, h, topH);

    // 読み取り値(百分率・小数 1 桁)。同値なら DOM は書き換えられない
    mItem.set(`${(m * 100).toFixed(1)} %`);
  }

  /* ---- 操作部品(§7.2) ---- */

  const readout = createReadout(host);
  const mItem = readout.item("一致度 M", { color: "beam" });

  const qSlider = host.controls.slider({
    id: "q",
    label: "空間周波数 q",
    min: Q_MIN,
    max: Q_MAX,
    step: Q_STEP,
    value: Q_INIT,
    unit: "nm⁻¹",
  });
  qSlider.onChange((v) => {
    if (syncing) return; // 掃引による表示同期は利用者操作ではない
    auto = false; // スライダーに触れたら掃引停止(エンジンは止めない)
    q = v;
    checkDiscovery();
    dirty = true;
  });

  const aSlider = host.controls.slider({
    id: "a",
    label: "格子間隔 a",
    min: A_MIN,
    max: A_MAX,
    step: A_STEP,
    value: A_INIT,
    unit: "nm",
  });
  aSlider.onChange((v) => {
    if (syncing) return;
    auto = false;
    a = v;
    discovered.clear(); // a を変えたら発見状態はリセット(§5.2)
    checkDiscovery();
    dirty = true;
  });

  const nSlider = host.controls.slider({
    id: "n",
    label: "原子の数 N",
    min: N_MIN,
    max: N_MAX,
    step: 1,
    value: N_INIT,
    unit: "個",
  });
  nSlider.onChange((v) => {
    if (syncing) return;
    auto = false;
    nAtoms = v;
    discovered.clear(); // N を変えたら発見状態はリセット(§5.2)
    checkDiscovery();
    dirty = true;
  });

  const play = host.controls.playPause();
  /** playPause の押下で自動掃引へ復帰する(§5.2) */
  const resumeAuto = (): void => {
    auto = true;
    dirty = true;
  };
  play.el.addEventListener("click", resumeAuto);

  const showAll = host.controls.button({ label: "すべての一致点を表示" });
  showAll.onClick(() => {
    // 0 ≤ n/a ≤ 12 の全整数 n を発見済みへ追加して 1 回描画する
    const nTop = Math.floor(Q_MAX * a + EPS);
    for (let n = 0; n <= nTop; n++) discovered.add(n);
    dirty = true;
    host.requestRender();
  });

  host.controls.reset(() => {
    // スライダー表示を戻す(syncing で「利用者操作」扱いを避ける)
    syncing = true;
    qSlider.set(Q_INIT);
    aSlider.set(A_INIT);
    nSlider.set(N_INIT);
    syncing = false;
    q = Q_INIT;
    a = A_INIT;
    nAtoms = N_INIT;
    sweepDir = 1;
    discovered.clear();
    auto = true;
    dirty = true;
  });

  /** 掃引中の q をスライダーへ反映する(値が変わるときだけ DOM を書く) */
  function syncQSlider(): void {
    const snapped = Math.round(q / Q_STEP) * Q_STEP;
    if (Math.abs(snapped - qSlider.value) < EPS) return;
    syncing = true;
    qSlider.set(snapped);
    syncing = false;
  }

  /* ---- フレームループ ---- */

  // 自動掃引中は onFrame で q を進める。1 フレームの移動量(60fps で約
  // 0.013 nm⁻¹)は判定窓 ±0.05 より十分小さく、通過時に必ず点灯する
  host.onFrame((dt) => {
    if (auto) {
      q += sweepDir * SWEEP_SPEED * dt;
      if (q >= Q_MAX) {
        q = Q_MAX;
        sweepDir = -1;
      } else if (q <= Q_MIN) {
        q = Q_MIN;
        sweepDir = 1;
      }
      checkDiscovery();
      syncQSlider();
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      draw();
    }
  });
  // 掃引停止中・一時停止中の操作は requestRender 経由で 1 フレーム描く
  host.onRender(() => {
    dirty = false;
    draw();
  });

  return {
    resize(): void {
      // レイアウトは draw() が毎回計算する。次のフレームで確実に描き直す
      dirty = true;
    },
    destroy(): void {
      play.el.removeEventListener("click", resumeAuto);
      readout.el.remove();
    },
  };
}
