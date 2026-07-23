/**
 * stripes-2d.ts — 図3「縞に向きが生まれる」(仕様書 05 §5.3。本記事の中核)
 *
 * 左パネルに正方格子(a = 0.40 nm 固定)と平面波 cos(2π q·r) の縞、
 * 右パネルに q 平面(±8 nm⁻¹)とドラッグ可能なプローブを描く。
 * 「矢 1 本 ⇄ 縞 1 枚」の対応を手で覚えさせ、q 平面を探検して
 * 一致点(2D 逆格子)を発見させる。
 *
 * 一致度 M は式 E4(laue2D。円形窓内の約 130 原子の複素和)で厳密に
 * 計算する。縞の原点はパネル中心 = 原子位置にアンカーされるため、
 * 一致時には山の中心線が中央列の原子中心を正確に貫く(受け入れ基準)。
 *
 * 実装方式: requestRender 型(自動再生なし)。乱数不使用(決定論的)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp, vec2 } from "../../core/mathx";
import { darken, matColor, uiColor } from "../../core/colors";
import { laue2D, latticePointsInDisk } from "./lattice";
import {
  attachDragPoints,
  createReadout,
  drawArrow,
  drawAtoms,
  drawFocusRing,
  drawPanelDivider,
  drawPanelLabel,
  drawScaleBar,
  drawStripes,
  makeMapper,
  splitPanels,
  withClip,
  type DragPoint,
  type PanelMapper,
} from "./_shared2d";

/** 格子定数(nm)。本図では固定する(§5.3: 探索を q に集中させる) */
const A_NM = 0.4;
/** 実空間の円形窓の半径(nm)。この中の原子だけを使う(約 130 点) */
const DISK_RADIUS_NM = 2.6;
/** 実空間パネルの表示半径(nm)。パネル短辺の半分がこの長さに対応する */
const REAL_VIEW_RADIUS_NM = 2.75;
/** 逆空間パネルの表示半径(nm⁻¹)。±8 の q 平面 + 余白 */
const RECIP_VIEW_RADIUS = 8.5;
/** q の可動範囲(±、nm⁻¹)。スライダー・プローブ・方眼の範囲を兼ねる */
const Q_MAX = 8;
/** q スライダーの刻み(nm⁻¹) */
const Q_STEP = 0.05;
/** q の初期値(nm⁻¹)。最寄りの一致点 (2.5, 0) のすぐ近くに置く(§5.3) */
const QX_INIT = 2.2;
const QY_INIT = 0.3;
/** 縞表示の初期値 */
const STRIPES_INIT = true;
/** プローブの矢印キーの移動量(nm⁻¹。粗動 = Shift 併用 — §5.3) */
const KEY_STEP_FINE = 0.05;
const KEY_STEP_COARSE = 0.5;
/** 点灯条件(§5.3): 最寄りの (h/a, k/a) との距離の上限(nm⁻¹) */
const MATCH_DIST_MAX = 0.06;
/** 点灯条件(§5.3): 一致度 M の下限 */
const MATCH_M_MIN = 0.97;
/** 縞の山の中心線を強調表示する M の下限(§5.3) */
const EMPHASIZE_M_MIN = 0.9;
/** 発見対象の指数の上限(|h|,|k| ≤ Q_MAX·a = 3.2 → 整数では 3 まで) */
const DISCOVER_HK_MAX = Q_MAX * A_NM;
/** 「すべての一致点を表示」で点灯する指数範囲(|h|,|k| ≤ 3 の 49 点) */
const SHOW_ALL_HK_MAX = 3;
/** 原子の見た目半径(CSS px) */
const ATOM_RADIUS_PX = 6;
/** 発見済み g 点の見た目半径(CSS px) */
const G_POINT_RADIUS_PX = 4.5;
/** プローブ先端の円の見た目半径(CSS px) */
const PROBE_RADIUS_PX = 7;
/** 縁取り(同系色を約 20% 暗く・1.5px — §6.5) */
const EDGE_WIDTH = 1.5;
const EDGE_DARKEN = 0.2;
/** スケールバーの長さ(左: nm、右: nm⁻¹ — §5.0) */
const SCALEBAR_REAL_NM = 1;
const SCALEBAR_RECIP = 5;
/** 原子バッファの上限(点数)。r = 2.6 nm・a = 0.4 nm では 137 点 */
const MAX_ATOMS = 160;
/** プローブのドラッグ点の添字(1 点のみ) */
const PROBE_INDEX = 0;

const TAU = Math.PI * 2;

export default function stripes2d(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(§6.2)
  const matrixFill = matColor("matrix");
  const recipFill = matColor("recip");
  const beamFill = matColor("beam");
  const beamEdge = darken(beamFill, EDGE_DARKEN);
  const hairline = uiColor("hairline");

  /* ---- 状態 ---- */

  let qx = QX_INIT; // プローブ q(nm⁻¹)
  let qy = QY_INIT;
  let stripesOn = STRIPES_INIT;
  /** 現在の一致度 M(q 変更時にのみ再計算する — §5.3 性能) */
  let matchM = 0;
  /** 発見済みの一致点("h,k" のキー。reset まで保持 — §5.3) */
  const discovered = new Set<string>();
  // 描画用の並行配列(毎描画でのキー文字列の解析・割当てを避ける)
  const discoveredH: number[] = [];
  const discoveredK: number[] = [];

  // 原子座標は初期化時に 1 回だけ生成する(a 固定なので不変 — §5.3)
  const atomXY = new Float64Array(MAX_ATOMS * 2);
  const atomCount = latticePointsInDisk(
    vec2(A_NM, 0),
    vec2(0, A_NM),
    DISK_RADIUS_NM,
    atomXY,
  );

  /** 右パネル(q 平面)の座標変換。レイアウト依存なので毎回作り直す */
  function recipMapperNow(): PanelMapper {
    const panel = splitPanels(host.size).second;
    return makeMapper(
      panel,
      Math.min(panel.w, panel.h) / 2 / RECIP_VIEW_RADIUS,
    );
  }

  /* ---- 発見状態 ---- */

  function addDiscovery(hIdx: number, kIdx: number): void {
    const key = `${hIdx},${kIdx}`;
    if (discovered.has(key)) return;
    discovered.add(key);
    discoveredH.push(hIdx);
    discoveredK.push(kIdx);
  }

  /**
   * 点灯判定(§5.3)。最寄りの格子点 (h/a, k/a) との距離 ≤ 0.06 nm⁻¹
   * かつ M ≥ 0.97 で、その厳密な位置(q の現在値ではない)を点灯する。
   */
  function checkMatch(): void {
    const hIdx = Math.round(qx * A_NM);
    const kIdx = Math.round(qy * A_NM);
    if (Math.abs(hIdx) > DISCOVER_HK_MAX || Math.abs(kIdx) > DISCOVER_HK_MAX) {
      return;
    }
    const dist = Math.hypot(qx - hIdx / A_NM, qy - kIdx / A_NM);
    if (dist <= MATCH_DIST_MAX && matchM >= MATCH_M_MIN) {
      addDiscovery(hIdx, kIdx);
    }
  }

  /* ---- 読み取り値(§5.3: 一致度 M と q。ラベルは beam 色) ---- */

  const readout = createReadout(host);
  const mItem = readout.item("一致度 M", { color: "beam" });
  const qItem = readout.item("q", { color: "beam" });

  function updateReadout(): void {
    mItem.set(`${(matchM * 100).toFixed(1)} %`);
    qItem.set(`(${qx.toFixed(2)}, ${qy.toFixed(2)}) nm⁻¹`);
  }

  /** q 変更後の共通処理: M 再計算 → 点灯判定 → 読み取り値の更新 */
  function onQChanged(): void {
    matchM = laue2D(qx, qy, atomXY, atomCount);
    checkMatch();
    updateReadout();
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const split = splitPanels(host.size);
    drawPanelDivider(ctx, host.size, split);

    // 左パネル = 実空間(原子 + 縞)
    const real = split.first;
    const realMap = makeMapper(
      real,
      Math.min(real.w, real.h) / 2 / REAL_VIEW_RADIUS_NM,
    );
    withClip(ctx, real, () => {
      drawAtoms(ctx, atomXY, atomCount, realMap, ATOM_RADIUS_PX, matrixFill);
    });
    if (stripesOn) {
      // 縞は原子の上に重ねる。縞の原点はパネル中心 = 原子位置に
      // アンカーされるので、一致時には山の中心線が原子列を厳密に貫く
      drawStripes(ctx, realMap, qx, qy, {
        emphasize: matchM > EMPHASIZE_M_MIN,
      });
    }
    drawPanelLabel(ctx, real, "実空間");
    drawScaleBar(ctx, real, realMap.pxPerUnit, SCALEBAR_REAL_NM, "1 nm");

    // 右パネル = q 平面
    const recip = split.second;
    const recipMap = makeMapper(
      recip,
      Math.min(recip.w, recip.h) / 2 / RECIP_VIEW_RADIUS,
    );
    withClip(ctx, recip, () => {
      // 1 nm⁻¹ 間隔の薄い方眼(±Q_MAX の正方形)
      ctx.strokeStyle = hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -Q_MAX; i <= Q_MAX; i++) {
        ctx.moveTo(recipMap.toPxX(i), recipMap.toPxY(-Q_MAX));
        ctx.lineTo(recipMap.toPxX(i), recipMap.toPxY(Q_MAX));
        ctx.moveTo(recipMap.toPxX(-Q_MAX), recipMap.toPxY(i));
        ctx.lineTo(recipMap.toPxX(Q_MAX), recipMap.toPxY(i));
      }
      ctx.stroke();

      // 発見済みの g 点。厳密に (h/a, k/a) の位置に描く(受け入れ基準)
      ctx.beginPath();
      for (let i = 0; i < discoveredH.length; i++) {
        const x = recipMap.toPxX(discoveredH[i] / A_NM);
        const y = recipMap.toPxY(discoveredK[i] / A_NM);
        ctx.moveTo(x + G_POINT_RADIUS_PX, y);
        ctx.arc(x, y, G_POINT_RADIUS_PX, 0, TAU);
      }
      ctx.fillStyle = recipFill;
      ctx.fill();

      // プローブ: 原点からの矢印 + 先端の円(beam — §2.3 の色分け)
      const tipX = recipMap.toPxX(qx);
      const tipY = recipMap.toPxY(qy);
      drawArrow(ctx, recipMap.toPxX(0), recipMap.toPxY(0), tipX, tipY, {
        color: beamFill,
      });
      ctx.beginPath();
      ctx.arc(tipX, tipY, PROBE_RADIUS_PX, 0, TAU);
      ctx.fillStyle = beamFill;
      ctx.fill();
      ctx.lineWidth = EDGE_WIDTH;
      ctx.strokeStyle = beamEdge;
      ctx.stroke();
    });
    // フォーカスリングはクリップの外で描く(端の位置でも欠けないように)
    if (dragPoints.focusedIndex() === PROBE_INDEX) {
      drawFocusRing(ctx, recipMap.toPxX(qx), recipMap.toPxY(qy));
    }
    drawPanelLabel(ctx, recip, "逆空間(q 平面)");
    drawScaleBar(ctx, recip, recipMap.pxPerUnit, SCALEBAR_RECIP, "5 nm⁻¹");
  }

  /* ---- 操作部品(§5.3) ---- */

  /** プローブからのスライダー同期中は onChange を無視する(双方向同期) */
  let syncingQ = false;

  const qxSlider = host.controls.slider({
    id: "qx",
    label: "q_x",
    min: -Q_MAX,
    max: Q_MAX,
    step: Q_STEP,
    value: QX_INIT,
    unit: "nm⁻¹",
  });
  qxSlider.onChange((v) => {
    if (syncingQ) return;
    qx = v;
    onQChanged();
    dragPoints.sync(); // 代理ボタンをプローブへ追従させる(§5.0)
  });

  const qySlider = host.controls.slider({
    id: "qy",
    label: "q_y",
    min: -Q_MAX,
    max: Q_MAX,
    step: Q_STEP,
    value: QY_INIT,
    unit: "nm⁻¹",
  });
  qySlider.onChange((v) => {
    if (syncingQ) return;
    qy = v;
    onQChanged();
    dragPoints.sync();
  });

  /** プローブの現在値をスライダーへ反映する(ドラッグ・キー操作後) */
  function syncSliders(): void {
    syncingQ = true;
    qxSlider.set(qx);
    qySlider.set(qy);
    syncingQ = false;
  }

  const stripesToggle = host.controls.toggle({
    id: "stripes",
    label: "縞を表示",
    value: STRIPES_INIT,
  });
  stripesToggle.onChange((v) => {
    stripesOn = v;
  });

  const showAllBtn = host.controls.button({ label: "すべての一致点を表示" });
  showAllBtn.onClick(() => {
    for (let hh = -SHOW_ALL_HK_MAX; hh <= SHOW_ALL_HK_MAX; hh++) {
      for (let kk = -SHOW_ALL_HK_MAX; kk <= SHOW_ALL_HK_MAX; kk++) {
        addDiscovery(hh, kk);
      }
    }
    host.requestRender();
  });

  host.controls.reset(() => {
    // §5.3: q・縞表示・発見状態をすべて初期値へ戻す
    discovered.clear();
    discoveredH.length = 0;
    discoveredK.length = 0;
    stripesToggle.set(STRIPES_INIT);
    // set() の onChange 経由で q・M・読み取り値・代理ボタン位置も戻る
    qxSlider.set(QX_INIT);
    qySlider.set(QY_INIT);
  });

  /* ---- プローブのドラッグ(§5.0 規約: attachDragPoints) ---- */

  const probe: DragPoint = {
    label: "プローブ q",
    x: () => recipMapperNow().toPxX(qx),
    y: () => recipMapperNow().toPxY(qy),
    drag(xPx: number, yPx: number): void {
      const m = recipMapperNow();
      qx = clamp(m.toUnitX(xPx), -Q_MAX, Q_MAX);
      qy = clamp(m.toUnitY(yPx), -Q_MAX, Q_MAX);
      onQChanged();
      syncSliders();
    },
    key(dx: number, dy: number, coarse: boolean): void {
      const step = coarse ? KEY_STEP_COARSE : KEY_STEP_FINE;
      qx = clamp(qx + dx * step, -Q_MAX, Q_MAX);
      qy = clamp(qy + dy * step, -Q_MAX, Q_MAX);
      onQChanged();
      syncSliders();
    },
  };
  const dragPoints = attachDragPoints(host, [probe]);

  /* ---- 登録・初期状態 ---- */

  host.onRender(draw); // requestRender 型(自動再生なし — §5.3)

  onQChanged(); // 初期の M・読み取り値(初期 q は一致点ではない)
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
