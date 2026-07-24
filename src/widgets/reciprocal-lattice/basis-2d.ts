/**
 * basis-2d.ts — 図5「逆格子も格子」(仕様書 05 §5.5)
 *
 * 左パネルの基本ベクトル a1, a2 を先端ハンドルのドラッグ(または矢印キー)
 * で変形すると、右パネルの双対基底 b1, b2 と逆格子が即時に応答する。
 * (i) 回転は連動する、(ii) 伸ばすと縮む、(iii) 斜交させても b1 ⊥ a2,
 * b2 ⊥ a1 が保たれる、を体感させ、a_i·b_j = δ_ij(式 E7)へ接続する。
 *
 * 双対基底は lattice.ts の dualBasis2(式 E8)で厳密に計算する(再実装
 * しない)。γ のクランプ(25°〜155°)は退化(S → 0 で逆格子が画面外へ
 * 発散)を避ける操作上の制限であり、物理的限界ではない(図注に明示)。
 *
 * 実装方式: requestRender 型(自動再生なし)。乱数不使用(決定論的)。
 * 開発ビルドでは更新のたびに a_i·b_j の誤差 < 1e-9 を assert する(§5.5)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import {
  clamp,
  copy2,
  dot2,
  len2,
  set2,
  vec2,
  type Vec2,
} from "../../core/mathx";
import { darken, matColor, uiColor } from "../../core/colors";
import { dualBasis2, latticePointsInDisk } from "./lattice";
import {
  attachDragPoints,
  createReadout,
  drawArrow,
  drawAtoms,
  drawFocusRing,
  drawPanelDivider,
  drawPanelLabel,
  drawScaleBar,
  makeMapper,
  splitPanels,
  withClip,
  CANVAS_FONT,
  type DragPoint,
  type PanelMapper,
} from "./_shared2d";

/** 初期の格子定数(nm)。正方 a1 = (0.40, 0), a2 = (0, 0.40) */
const A_INIT = 0.4;
/** 基本ベクトルの長さの可動範囲(nm) */
const LEN_MIN = 0.25;
const LEN_MAX = 0.6;
/** 度 → ラジアン */
const DEG = Math.PI / 180;
/** a1 から a2 への符号付き角 γ の可動範囲(rad)。S > 0 を維持する */
const GAMMA_MIN = 25 * DEG;
const GAMMA_MAX = 155 * DEG;
/** プリセット「長方」の a2 の長さ(nm) */
const RECT_A2_LEN = 0.56;
/** プリセット「斜交」の a2(長さ nm と a1 からの角) */
const OBLIQUE_A2_LEN = 0.44;
const OBLIQUE_GAMMA = 105 * DEG;
/** 左パネルの表示半径(nm)と格子点の窓半径(nm) */
const REAL_VIEW_RADIUS_NM = 1.45;
const REAL_WINDOW_NM = 1.3;
/** 右パネルの表示半径(nm⁻¹)と逆格子点の窓半径(nm⁻¹) */
const RECIP_VIEW_RADIUS = 10.5;
const RECIP_WINDOW = 9.5;
/** 原子・逆格子点の見た目半径(CSS px) */
const ATOM_RADIUS_PX = 5;
const RECIP_POINT_RADIUS_PX = 4;
/** 先端ハンドルの見た目半径(CSS px)。当たり判定 44px は代理ボタン側 */
const HANDLE_RADIUS_PX = 10;
/** 縁取り(同系色を約 20% 暗く・1.5px — §6.5) */
const EDGE_WIDTH = 1.5;
const EDGE_DARKEN = 0.2;
/** 矢印キーの成分あたり移動量(nm。粗動 = Shift 併用 — §5.5) */
const KEY_STEP_FINE = 0.01;
const KEY_STEP_COARSE = 0.05;
/** 単位胞(左)・逆単位胞(右)の塗りの不透明度 */
const CELL_ALPHA_REAL = 0.15;
const CELL_ALPHA_RECIP = 0.12;
/** 直交補助線の破線パターン(px)と解除用の空配列 */
const GUIDE_DASH = [5, 4];
const NO_DASH: number[] = [];
/** 直交補助線の片側の長さ(世界単位)。クリップ前提でパネルを必ず覆う */
const GUIDE_HALF_LEN = RECIP_VIEW_RADIUS * 3;
/** 直角マーク(原点近くの小さい四角)の一辺(CSS px) */
const RIGHT_ANGLE_MARK_PX = 9;
/** ベクトルラベルの先端からのオフセット(CSS px)。a はハンドルの外側 */
const A_LABEL_OFFSET_PX = 24;
const B_LABEL_OFFSET_PX = 16;
/** スケールバーの長さ(左: nm、右: nm⁻¹ — §5.0) */
const SCALEBAR_REAL_NM = 0.5;
const SCALEBAR_RECIP = 5;
/**
 * 格子点バッファの上限(点数)。可動範囲全域の走査で
 * 左は最大 205 点(両長さ 0.25 nm・γ = 25°)、右は最大 103 点(S 最大)
 */
const MAX_REAL_POINTS = 260;
const MAX_RECIP_POINTS = 140;
/** 開発時 assert の許容誤差(§5.5: a_i·b_j の誤差 < 1e-9) */
const DUAL_EPS = 1e-9;
/** 方向が定まらないとみなす長さの下限(nm) */
const LEN_EPS = 1e-6;
/** ドラッグ点の添字 */
const HANDLE_A1 = 0;
const HANDLE_A2 = 1;
/** ベクトルラベル用フォント(矢印ラベルは 14px — §6.5) */
const VECTOR_LABEL_FONT = CANVAS_FONT.replace("12px", "14px");

const TAU = Math.PI * 2;

/** プリセット(§5.5: 正方 / 長方 / 斜交。補間なしで即時反映) */
type LatticePreset = "square" | "rect" | "oblique";
const PRESET_INIT: LatticePreset = "square";
/** トグルの初期値(単位胞表示・直交補助線とも on — §5.5) */
const CELL_INIT = true;
const ORTHO_INIT = true;

/** x を (−π, π] へ折り返す */
function wrapPi(x: number): number {
  let t = x % TAU;
  if (t > Math.PI) t -= TAU;
  else if (t <= -Math.PI) t += TAU;
  return t;
}

/** u から v への符号付き角(rad。反時計回りが正) */
function signedAngle(u: Vec2, v: Vec2): number {
  return Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
}

/** v を反時計回りに delta(rad)回転して out へ書き込む(out === v 可) */
function rotate2(out: Vec2, v: Vec2, delta: number): Vec2 {
  const c = Math.cos(delta);
  const s = Math.sin(delta);
  const x = v.x * c - v.y * s;
  const y = v.x * s + v.y * c;
  out.x = x;
  out.y = y;
  return out;
}

/**
 * 候補ベクトル cand を操作規約(長さ 0.25〜0.60 nm、γ 25°〜155°)へ
 * クランプして out へ書き込む。γ は a1 から a2 への符号付き角で、
 * candIsA1 = true なら cand が a1(other = a2)、false なら cand が a2
 * (other = a1)。まず長さをクランプし、γ が範囲外なら長さを保ったまま
 * 円周上で近い方の境界角へ回転して張り付ける(実装指示のクランプ規約)。
 * 候補が原点に重なり方向が定まらないときは false を返して何も書かない。
 */
function clampBasisVector(
  out: Vec2,
  cand: Vec2,
  other: Vec2,
  candIsA1: boolean,
): boolean {
  const len = Math.hypot(cand.x, cand.y);
  if (len < LEN_EPS) return false;
  const scale = clamp(len, LEN_MIN, LEN_MAX) / len;
  out.x = cand.x * scale;
  out.y = cand.y * scale;
  const gamma = candIsA1 ? signedAngle(out, other) : signedAngle(other, out);
  if (gamma >= GAMMA_MIN && gamma <= GAMMA_MAX) return true;
  // ±180° 跨ぎを考慮し、円周上で近い方の境界角を選ぶ
  const toMin = Math.abs(wrapPi(gamma - GAMMA_MIN));
  const toMax = Math.abs(wrapPi(gamma - GAMMA_MAX));
  const bound = toMin <= toMax ? GAMMA_MIN : GAMMA_MAX;
  // a1 を回すと γ = ∠(a1→a2) は逆向きに、a2 を回すと同じ向きに変わる
  rotate2(out, out, candIsA1 ? gamma - bound : bound - gamma);
  return true;
}

export default function basis2d(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(§6.2)
  const matrixFill = matColor("matrix");
  /** a1, a2 の矢印本体(matrix を 20% 暗くした色 — §5.5) */
  const arrowAColor = darken(matrixFill, EDGE_DARKEN);
  const recipFill = matColor("recip");
  const accent = uiColor("accent");
  const accentEdge = darken(accent, EDGE_DARKEN);
  const text2 = uiColor("text2");

  /* ---- 状態 ---- */

  const a1 = vec2(A_INIT, 0);
  const a2 = vec2(0, A_INIT);
  let showCell = CELL_INIT;
  let showOrtho = ORTHO_INIT;

  /* ---- 派生量(基底の変更時にのみ再計算し、描画では再利用する) ---- */

  const b1 = vec2();
  const b2 = vec2();
  /** 単位胞面積 S(nm²。γ の制約により常に正) */
  let cellS = 0;
  const realXY = new Float64Array(MAX_REAL_POINTS * 2);
  const recipXY = new Float64Array(MAX_RECIP_POINTS * 2);
  let realCount = 0;
  let recipCount = 0;
  /** ドラッグ・キー操作の候補ベクトル用スクラッチ(毎操作の割当て回避) */
  const scratch = vec2();

  /** 左パネル(実空間)の座標変換。レイアウト依存なので都度作り直す */
  function realMapperNow(): PanelMapper {
    const panel = splitPanels(host.size).first;
    return makeMapper(
      panel,
      Math.min(panel.w, panel.h) / 2 / REAL_VIEW_RADIUS_NM,
    );
  }

  /* ---- 読み取り値(§5.5: |a₁|, |a₂|, γ, S, 1/S) ---- */

  const readout = createReadout(host);
  const a1Item = readout.item("|a₁|");
  const a2Item = readout.item("|a₂|");
  const gammaItem = readout.item("γ");
  const sItem = readout.item("S");
  const invSItem = readout.item("1/S");

  function updateReadout(): void {
    a1Item.set(`${len2(a1).toFixed(2)} nm`);
    a2Item.set(`${len2(a2).toFixed(2)} nm`);
    gammaItem.set(`${Math.round(signedAngle(a1, a2) / DEG)}°`);
    sItem.set(`${cellS.toFixed(3)} nm²`);
    invSItem.set(`${(1 / cellS).toFixed(2)} nm⁻²`);
  }

  /** 基底の変更を派生量へ反映する(dualBasis2 = 式 E8。lattice.ts) */
  function updateDerived(): void {
    const dual = dualBasis2(a1, a2);
    copy2(b1, dual.b1);
    copy2(b2, dual.b2);
    cellS = dual.S;
    realCount = latticePointsInDisk(a1, a2, REAL_WINDOW_NM, realXY);
    recipCount = latticePointsInDisk(b1, b2, RECIP_WINDOW, recipXY);
    if (import.meta.env.DEV) {
      // §5.5: 更新のたびに a_i·b_j = δ_ij の誤差 < 1e-9 を検証する
      const err = Math.max(
        Math.abs(dot2(a1, b1) - 1),
        Math.abs(dot2(a1, b2)),
        Math.abs(dot2(a2, b1)),
        Math.abs(dot2(a2, b2) - 1),
      );
      console.assert(
        err < DUAL_EPS,
        `basis-2d: a_i·b_j の誤差が許容を超過しています (${err})`,
      );
    }
    updateReadout();
  }

  /** 基底の変更後の共通処理(派生量の更新 + 代理ボタンの追従 — §5.0) */
  function onBasisChanged(): void {
    updateDerived();
    dragPoints.sync();
  }

  /* ---- 描画 ---- */

  /** 平行四辺形 (0,0)-u-(u+v)-v を淡く塗る(単位胞・逆単位胞 — §5.5) */
  function drawCell(
    m: PanelMapper,
    u: Vec2,
    v: Vec2,
    fill: string,
    alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(m.toPxX(0), m.toPxY(0));
    ctx.lineTo(m.toPxX(u.x), m.toPxY(u.y));
    ctx.lineTo(m.toPxX(u.x + v.x), m.toPxY(u.y + v.y));
    ctx.lineTo(m.toPxX(v.x), m.toPxY(v.y));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 原点からベクトル v の先端への矢印(線幅 2px + 塗り三角 — §6.5) */
  function drawBasisArrow(m: PanelMapper, v: Vec2, color: string): void {
    drawArrow(ctx, m.toPxX(0), m.toPxY(0), m.toPxX(v.x), m.toPxY(v.y), {
      color,
    });
  }

  /** a_i 先端のハンドル(--color-accent の塗り円 20px + 暗縁 — §5.5) */
  function drawHandle(m: PanelMapper, v: Vec2): void {
    ctx.beginPath();
    ctx.arc(m.toPxX(v.x), m.toPxY(v.y), HANDLE_RADIUS_PX, 0, TAU);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.lineWidth = EDGE_WIDTH;
    ctx.strokeStyle = accentEdge;
    ctx.stroke();
  }

  /** ベクトル先端の外側にラベルを描く(14px — §6.5) */
  function drawVectorLabel(
    m: PanelMapper,
    v: Vec2,
    text: string,
    color: string,
    offsetPx: number,
  ): void {
    const len = Math.hypot(v.x, v.y);
    if (len < LEN_EPS) return;
    // 画面座標での外向き単位ベクトル(y は下向きへ反転)
    const ux = v.x / len;
    const uy = -v.y / len;
    ctx.font = VECTOR_LABEL_FONT;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      text,
      m.toPxX(v.x) + ux * offsetPx,
      m.toPxY(v.y) + uy * offsetPx,
    );
  }

  /** 原点を通り v 方向へ伸びる直線をパスへ追加する(クリップ前提) */
  function addGuideLine(m: PanelMapper, v: Vec2): void {
    const len = Math.hypot(v.x, v.y);
    if (len < LEN_EPS) return;
    const gx = (v.x / len) * GUIDE_HALF_LEN;
    const gy = (v.y / len) * GUIDE_HALF_LEN;
    ctx.moveTo(m.toPxX(-gx), m.toPxY(-gy));
    ctx.lineTo(m.toPxX(gx), m.toPxY(gy));
  }

  /** u 方向と v 方向のなす直角を示す小さい四角をパスへ追加する */
  function addRightAngleMark(m: PanelMapper, u: Vec2, v: Vec2): void {
    const lu = Math.hypot(u.x, u.y);
    const lv = Math.hypot(v.x, v.y);
    if (lu < LEN_EPS || lv < LEN_EPS) return;
    const ox = m.toPxX(0);
    const oy = m.toPxY(0);
    // 画面座標の単位ベクトル(y 反転)× マーク一辺
    const ux = (u.x / lu) * RIGHT_ANGLE_MARK_PX;
    const uy = (-u.y / lu) * RIGHT_ANGLE_MARK_PX;
    const vx = (v.x / lv) * RIGHT_ANGLE_MARK_PX;
    const vy = (-v.y / lv) * RIGHT_ANGLE_MARK_PX;
    ctx.moveTo(ox + ux, oy + uy);
    ctx.lineTo(ox + ux + vx, oy + uy + vy);
    ctx.lineTo(ox + vx, oy + vy);
  }

  /**
   * 直交補助線(§5.5)。右パネルに a2 方向・a1 方向の破線を原点から引き、
   * b1 ⊥ a2・b2 ⊥ a1 を直角マークで目視確認できるようにする。
   */
  function drawOrthoGuides(m: PanelMapper): void {
    ctx.strokeStyle = text2; // hairline より濃い色(§5.5)
    ctx.lineWidth = 1;
    ctx.setLineDash(GUIDE_DASH);
    ctx.beginPath();
    addGuideLine(m, a2);
    addGuideLine(m, a1);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.beginPath();
    addRightAngleMark(m, a2, b1);
    addRightAngleMark(m, a1, b2);
    ctx.stroke();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const split = splitPanels(host.size);
    drawPanelDivider(ctx, host.size, split);

    // 左パネル = 実空間(格子点 + a1, a2 + 単位胞)
    const real = split.first;
    const realMap = makeMapper(
      real,
      Math.min(real.w, real.h) / 2 / REAL_VIEW_RADIUS_NM,
    );
    withClip(ctx, real, () => {
      if (showCell) drawCell(realMap, a1, a2, matrixFill, CELL_ALPHA_REAL);
      drawAtoms(ctx, realXY, realCount, realMap, ATOM_RADIUS_PX, matrixFill);
      drawBasisArrow(realMap, a1, arrowAColor);
      drawBasisArrow(realMap, a2, arrowAColor);
      drawHandle(realMap, a1);
      drawHandle(realMap, a2);
      drawVectorLabel(realMap, a1, "a₁", text2, A_LABEL_OFFSET_PX);
      drawVectorLabel(realMap, a2, "a₂", text2, A_LABEL_OFFSET_PX);
    });
    // フォーカスリングはクリップの外で描く(端でも欠けないように)
    const focused = dragPoints.focusedIndex();
    if (focused === HANDLE_A1) {
      drawFocusRing(ctx, realMap.toPxX(a1.x), realMap.toPxY(a1.y));
    } else if (focused === HANDLE_A2) {
      drawFocusRing(ctx, realMap.toPxX(a2.x), realMap.toPxY(a2.y));
    }
    drawPanelLabel(ctx, real, "実空間");
    drawScaleBar(ctx, real, realMap.pxPerUnit, SCALEBAR_REAL_NM, "0.5 nm");

    // 右パネル = 逆空間(逆格子点 + b1, b2 + 逆単位胞 + 直交補助線)
    const recip = split.second;
    const recipMap = makeMapper(
      recip,
      Math.min(recip.w, recip.h) / 2 / RECIP_VIEW_RADIUS,
    );
    withClip(ctx, recip, () => {
      if (showCell) drawCell(recipMap, b1, b2, recipFill, CELL_ALPHA_RECIP);
      if (showOrtho) drawOrthoGuides(recipMap);
      drawAtoms(
        ctx,
        recipXY,
        recipCount,
        recipMap,
        RECIP_POINT_RADIUS_PX,
        recipFill,
      );
      drawBasisArrow(recipMap, b1, recipFill);
      drawBasisArrow(recipMap, b2, recipFill);
      // b_i のラベルは recip 色(§2.3 の色の書き分け。AA を満たす濃度)
      drawVectorLabel(recipMap, b1, "b₁", recipFill, B_LABEL_OFFSET_PX);
      drawVectorLabel(recipMap, b2, "b₂", recipFill, B_LABEL_OFFSET_PX);
    });
    drawPanelLabel(ctx, recip, "逆空間");
    drawScaleBar(ctx, recip, recipMap.pxPerUnit, SCALEBAR_RECIP, "5 nm⁻¹");
  }

  /* ---- 操作部品(§5.5) ---- */

  /** プリセットを即時反映する(補間なし — 省モーション配慮 §5.5) */
  function applyPreset(p: LatticePreset): void {
    set2(a1, A_INIT, 0);
    if (p === "square") {
      set2(a2, 0, A_INIT);
    } else if (p === "rect") {
      set2(a2, 0, RECT_A2_LEN);
    } else {
      set2(
        a2,
        OBLIQUE_A2_LEN * Math.cos(OBLIQUE_GAMMA),
        OBLIQUE_A2_LEN * Math.sin(OBLIQUE_GAMMA),
      );
    }
    onBasisChanged();
  }

  const presetSeg = host.controls.segmented<LatticePreset>({
    id: "preset",
    label: "プリセット",
    options: [
      { value: "square", label: "正方" },
      { value: "rect", label: "長方" },
      { value: "oblique", label: "斜交" },
    ],
    value: PRESET_INIT,
  });
  presetSeg.onChange(applyPreset);

  const cellToggle = host.controls.toggle({
    id: "cell",
    label: "単位胞を表示",
    value: CELL_INIT,
  });
  cellToggle.onChange((v) => {
    showCell = v;
  });

  const orthoToggle = host.controls.toggle({
    id: "ortho",
    label: "直交補助線",
    value: ORTHO_INIT,
  });
  orthoToggle.onChange((v) => {
    showOrtho = v;
  });

  host.controls.reset(() => {
    // §5.5: 基底・プリセット選択・トグルをすべて初期値(正方 0.40 nm)へ
    cellToggle.set(CELL_INIT);
    orthoToggle.set(ORTHO_INIT);
    presetSeg.set(PRESET_INIT); // 既に正方が選択済みのときは発火しない
    applyPreset(PRESET_INIT); // ドラッグで変形した基底も確実に戻す
  });

  /* ---- 先端ハンドルのドラッグ(§5.0 規約: attachDragPoints) ---- */

  const handleA1: DragPoint = {
    label: "基本ベクトル a1",
    x: () => realMapperNow().toPxX(a1.x),
    y: () => realMapperNow().toPxY(a1.y),
    drag(xPx: number, yPx: number): void {
      const m = realMapperNow();
      set2(scratch, m.toUnitX(xPx), m.toUnitY(yPx));
      if (clampBasisVector(a1, scratch, a2, true)) onBasisChanged();
    },
    key(dx: number, dy: number, coarse: boolean): void {
      const step = coarse ? KEY_STEP_COARSE : KEY_STEP_FINE;
      set2(scratch, a1.x + dx * step, a1.y + dy * step);
      if (clampBasisVector(a1, scratch, a2, true)) onBasisChanged();
    },
  };
  const handleA2: DragPoint = {
    label: "基本ベクトル a2",
    x: () => realMapperNow().toPxX(a2.x),
    y: () => realMapperNow().toPxY(a2.y),
    drag(xPx: number, yPx: number): void {
      const m = realMapperNow();
      set2(scratch, m.toUnitX(xPx), m.toUnitY(yPx));
      if (clampBasisVector(a2, scratch, a1, false)) onBasisChanged();
    },
    key(dx: number, dy: number, coarse: boolean): void {
      const step = coarse ? KEY_STEP_COARSE : KEY_STEP_FINE;
      set2(scratch, a2.x + dx * step, a2.y + dy * step);
      if (clampBasisVector(a2, scratch, a1, false)) onBasisChanged();
    },
  };
  const dragPoints = attachDragPoints(host, [handleA1, handleA2]);

  /* ---- 登録・初期状態 ---- */

  host.onRender(draw); // requestRender 型(自動再生なし — §5.5)

  updateDerived();
  dragPoints.sync();

  return {
    resize(): void {
      // レイアウト依存値は draw() 内で毎回再計算する(engine が 1 フレーム
      // 描く)。代理ボタンの位置のみここで追従させる(§5.0)
      dragPoints.sync();
    },
    destroy(): void {
      dragPoints.dispose();
      readout.el.remove();
    },
  };
}
