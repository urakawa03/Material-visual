/**
 * bravais-3d.ts — 図7「結晶が変われば逆格子も変わる」(仕様書 05 §5.7)
 *
 * 左ビュー = 選択したブラベー格子(単純立方 / 体心立方 / 面心立方)の慣用
 * 単位胞 2×2×2 個分の原子(単一元素として全て母相色)と胞の稜線。
 * 右ビュー = その逆格子点((h,k,l)/a、|h|,|k|,|l| ≤ 3。存在則 isAllowed で
 * フィルタ)。BCC の逆格子が FCC 配列に、FCC の逆格子が BCC 配列になる
 * 入れ替わりを見せ、照会ステッパで「現れない点」を中抜きマーカーと
 * 読み取り値で示す。トグルで単純立方の全整数点をゴースト表示し、
 * 不在位置を視認できるようにする。
 *
 * 簡略化(§5.7。図注に明示): 格子定数は a = 0.40 nm 固定。回折強度・
 * 構造因子は扱わず、点の有無(存在則)だけを示す。原子球の大きさは
 * 見やすさ優先で実寸比ではない。
 *
 * 実装方式: 3D / requestRender 型。描画は host.onRender(kit.render)に登録し、
 * パラメータ変更・視点変更(createDualView の onChange)で host.requestRender()
 * を呼ぶ。onFrame は使わないので静止時の GPU 消費はゼロ(§5.6 と同じ)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import { conventionalCellAtoms, isAllowed, type CubicLattice } from "./lattice";
import { createReadout, createStepper } from "./_shared2d";
import {
  THREE,
  createDualView,
  createInstancedAtoms,
  createLineSegments,
  createPanelTags,
  makeRingSprite,
} from "./_shared3d";

/** 格子定数(nm)。本図では固定(§5.7) */
const A_NM = 0.4;
/** 慣用単位胞の個数(各軸)。座標は ±1 の範囲・原点中心になる */
const CELLS = 2;
/** 胞座標(格子定数 = 1 単位)の半幅と格子線の位置(-1, 0, 1) */
const CELL_HALF = 1;
const CELL_GRID: readonly number[] = [-CELL_HALF, 0, CELL_HALF];
/** 左の原子インスタンス上限 = FCC 2×2×2 の 63 個(角 27 + 面心 36) */
const CELL_ATOM_CAPACITY = 63;
/** 左の原子球の半径(格子定数 = 1 単位。見やすさ優先で実寸比ではない) */
const CELL_ATOM_RADIUS = 0.13;

/** 照会・表示する指数の範囲(§5.7: |h|,|k|,|l| ≤ 3) */
const HKL_MIN = -3;
const HKL_MAX = 3;
/** 右の逆格子点インスタンス上限 = 全整数点 7³ = 343 個 */
const RECIP_CAPACITY = 343;
/** 逆格子点の球の半径(1/a 単位。隣接点間隔 = 1) */
const RECIP_RADIUS = 0.09;
/** 原点 000 の点の拡大率(§5.7: ひと回り大きく) */
const ORIGIN_SCALE = 1.5;

/** ゴースト点(単純立方の全整数点)の半径と球の分割数(微小点なので粗く) */
const GHOST_RADIUS = 0.035;
const GHOST_WIDTH_SEGMENTS = 8;
const GHOST_HEIGHT_SEGMENTS = 6;
/** ゴースト点の色: hairline をやや暗めにして白背景でも視認できるようにする */
const GHOST_DARKEN = 0.15;

/** 照会マーカー(存在時の強調球)の半径と分割数 */
const QUERY_RADIUS = 0.14;
const QUERY_WIDTH_SEGMENTS = 24;
const QUERY_HEIGHT_SEGMENTS = 18;
/** 不在マーカー(中抜きリング)の大きさ(1/a 単位) */
const RING_WORLD_SIZE = 0.55;

/** カメラ距離(図6 と同系の雛形。左 = nm スケール、右 = nm⁻¹ スケール)。
 * 右はバウンディング球 (3/a)√3 ≈ 13 nm⁻¹ が FOV 40° に収まるよう
 * dist ≈ r / sin(20°) ≈ 38 で見積もる */
const DIST_FIRST = 2.5;
const DIST_SECOND = 38;

/** 初期状態(reset で全てここへ戻る — §5.0) */
const LATTICE_INIT: CubicLattice = "sc";
const QUERY_H_INIT = 1;
const QUERY_K_INIT = 0;
const QUERY_L_INIT = 0;
const OVERLAY_INIT = false;

/** 格子名の表示ラベル(読み取り値・segmented 共通) */
const LATTICE_NAMES: Record<CubicLattice, string> = {
  sc: "単純立方",
  bcc: "体心立方",
  fcc: "面心立方",
};

/**
 * 胞の稜線の線分列 [x0,y0,z0, x1,y1,z1, …] を作る。
 * x / y / z 各方向に、他 2 軸の座標が -1, 0, 1 の格子線(9 本 × 3 方向)。
 */
function buildCellEdgePositions(): number[] {
  const pos: number[] = [];
  for (const u of CELL_GRID) {
    for (const v of CELL_GRID) {
      // x 方向の線(y = u, z = v)
      pos.push(-CELL_HALF, u, v, CELL_HALF, u, v);
      // y 方向の線(x = u, z = v)
      pos.push(u, -CELL_HALF, v, u, CELL_HALF, v);
      // z 方向の線(x = u, y = v)
      pos.push(u, v, -CELL_HALF, u, v, CELL_HALF);
    }
  }
  return pos;
}

export default function bravais3d(host: FigureHost): WidgetHandle {
  // 色は初期化時に一度だけ解決する(§6.2)
  const matrixFill = matColor("matrix");
  const recipFill = matColor("recip");
  const hairline = uiColor("hairline");

  /* ---- 状態 ---- */

  let lattice: CubicLattice = LATTICE_INIT; // 選択中のブラベー格子
  let qh = QUERY_H_INIT; // 照会 (hkl)
  let qk = QUERY_K_INIT;
  let ql = QUERY_L_INIT;

  /* ---- 2 ビュー雛形(図6 と同じ連動カメラ — §5.7) ---- */

  const kit = createDualView(host, {
    distFirst: DIST_FIRST,
    distSecond: DIST_SECOND,
    ariaLabel:
      "3D 視点。ドラッグまたは矢印キーで回転、+ と − でズーム。左がブラベー格子の単位胞、右がその逆格子",
    onChange: () => host.requestRender(),
  });
  const tags = createPanelTags(host.stage, ["実空間 [nm]", "逆空間 [nm⁻¹]"]);
  tags.update(kit.rects);

  // 左ルート: 格子定数 1 の胞座標を nm へ。右ルート: 整数指数を 1/a で nm⁻¹ へ
  const rootFirst = new THREE.Group();
  rootFirst.scale.setScalar(A_NM);
  kit.sceneFirst.add(rootFirst);
  const rootSecond = new THREE.Group();
  rootSecond.scale.setScalar(1 / A_NM);
  kit.sceneSecond.add(rootSecond);

  /* ---- 左: 慣用単位胞 2×2×2 の原子(全て同色 = 単一元素 — §5.7)と稜線 ---- */

  const cellAtoms = createInstancedAtoms(
    CELL_ATOM_CAPACITY,
    CELL_ATOM_RADIUS,
    matrixFill,
  );
  rootFirst.add(cellAtoms.mesh);
  const cellEdges = createLineSegments(buildCellEdgePositions(), hairline);
  rootFirst.add(cellEdges);

  /* ---- 右: 存在則を満たす逆格子点(mesh.count で個数を切り替え) ---- */

  const recipPoints = createInstancedAtoms(
    RECIP_CAPACITY,
    RECIP_RADIUS,
    recipFill,
  );
  rootSecond.add(recipPoints.mesh);

  /* ---- 右: 単純立方の全整数点のゴースト(重ね表示トグル — §5.7)。
     位置は不変なので初期化時に一度だけ書き込み、visible だけを切り替える。
     ライティングの影響を受けない MeshBasicMaterial で
     「--color-hairline 系の微小点」を正確に出す ---- */

  const ghostGeom = new THREE.SphereGeometry(
    GHOST_RADIUS,
    GHOST_WIDTH_SEGMENTS,
    GHOST_HEIGHT_SEGMENTS,
  );
  const ghostMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(darken(hairline, GHOST_DARKEN)),
  });
  const ghost = new THREE.InstancedMesh(ghostGeom, ghostMat, RECIP_CAPACITY);
  {
    const m = new THREE.Matrix4();
    let n = 0;
    for (let h = HKL_MIN; h <= HKL_MAX; h++) {
      for (let k = HKL_MIN; k <= HKL_MAX; k++) {
        for (let l = HKL_MIN; l <= HKL_MAX; l++) {
          m.setPosition(h, k, l);
          ghost.setMatrixAt(n++, m);
        }
      }
    }
    ghost.instanceMatrix.needsUpdate = true;
  }
  ghost.visible = OVERLAY_INIT;
  rootSecond.add(ghost);

  /* ---- 照会マーカー: 存在すれば強調球、不在なら中抜きリング(§5.7) ---- */

  const queryGeom = new THREE.SphereGeometry(
    QUERY_RADIUS,
    QUERY_WIDTH_SEGMENTS,
    QUERY_HEIGHT_SEGMENTS,
  );
  const queryMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(recipFill),
  });
  const queryMark = new THREE.Mesh(queryGeom, queryMat);
  rootSecond.add(queryMark);
  const absentMark = makeRingSprite(recipFill, RING_WORLD_SIZE);
  rootSecond.add(absentMark);

  /* ---- 読み取り値(§5.7: 格子 / 照会 (hkl) / 判定) ---- */

  const readout = createReadout(host);
  const latticeItem = readout.item("格子");
  const hklItem = readout.item("照会 (hkl)");
  const verdictItem = readout.item("判定", { color: "recip" });

  /** 格子切替: 左の原子・右の点群を組み直す(§5.7) */
  function rebuildLattice(): void {
    // 左: 慣用単位胞の原子(座標は ±1 の範囲・原点中心 — lattice.ts)
    const atoms = conventionalCellAtoms(lattice, CELLS);
    for (let i = 0; i < atoms.length; i++) {
      cellAtoms.setAtom(i, atoms[i].x, atoms[i].y, atoms[i].z);
    }
    cellAtoms.mesh.count = atoms.length;
    cellAtoms.commit();

    // 右: 存在則(SC: 全て / BCC: h+k+l 偶数 / FCC: 偶奇が揃う)を満たす点。
    // 偶奇則と式 E9 由来の点集合の一致は lattice.test.ts で確認済み(§5.7)
    let n = 0;
    for (let h = HKL_MIN; h <= HKL_MAX; h++) {
      for (let k = HKL_MIN; k <= HKL_MAX; k++) {
        for (let l = HKL_MIN; l <= HKL_MAX; l++) {
          if (!isAllowed(lattice, h, k, l)) continue;
          const isOrigin = h === 0 && k === 0 && l === 0;
          recipPoints.setAtom(n++, h, k, l, isOrigin ? ORIGIN_SCALE : 1);
        }
      }
    }
    recipPoints.mesh.count = n;
    recipPoints.commit();
  }

  /** 照会 (hkl) の判定・マーカー・読み取り値を更新する */
  function updateQuery(): void {
    const allowed = isAllowed(lattice, qh, qk, ql);
    queryMark.position.set(qh, qk, ql);
    queryMark.visible = allowed;
    absentMark.position.set(qh, qk, ql);
    absentMark.visible = !allowed;
    latticeItem.set(LATTICE_NAMES[lattice]);
    hklItem.set(`(${qh} ${qk} ${ql})`);
    verdictItem.set(allowed ? "現れる" : "この点は現れない");
  }

  /* ---- 操作部品(§5.7) ---- */

  const latticeSeg = host.controls.segmented<CubicLattice>({
    id: "lattice",
    label: "格子",
    options: [
      { value: "sc", label: LATTICE_NAMES.sc },
      { value: "bcc", label: LATTICE_NAMES.bcc },
      { value: "fcc", label: LATTICE_NAMES.fcc },
    ],
    value: LATTICE_INIT,
  });
  latticeSeg.onChange((v) => {
    lattice = v;
    rebuildLattice();
    updateQuery();
    host.requestRender();
  });

  const hStepper = createStepper(host, {
    label: "照会 h",
    min: HKL_MIN,
    max: HKL_MAX,
    value: QUERY_H_INIT,
  });
  hStepper.onChange((v) => {
    qh = v;
    updateQuery();
    host.requestRender();
  });

  const kStepper = createStepper(host, {
    label: "照会 k",
    min: HKL_MIN,
    max: HKL_MAX,
    value: QUERY_K_INIT,
  });
  kStepper.onChange((v) => {
    qk = v;
    updateQuery();
    host.requestRender();
  });

  const lStepper = createStepper(host, {
    label: "照会 l",
    min: HKL_MIN,
    max: HKL_MAX,
    value: QUERY_L_INIT,
  });
  lStepper.onChange((v) => {
    ql = v;
    updateQuery();
    host.requestRender();
  });

  const overlayToggle = host.controls.toggle({
    id: "sc-overlay",
    label: "単純立方の逆格子を重ねる",
    value: OVERLAY_INIT,
  });
  overlayToggle.onChange((v) => {
    ghost.visible = v;
    host.requestRender();
  });

  host.controls.reset(() => {
    // set() は値が変わったときだけ onChange 経由で状態を更新する
    latticeSeg.set(LATTICE_INIT);
    hStepper.set(QUERY_H_INIT);
    kStepper.set(QUERY_K_INIT);
    lStepper.set(QUERY_L_INIT);
    overlayToggle.set(OVERLAY_INIT);
    kit.resetView(); // 視点も初期値へ(内部で onChange → requestRender)
  });

  /* ---- 初期化と描画登録(requestRender 型 — §5.7) ---- */

  host.onRender(() => kit.render());
  rebuildLattice();
  updateQuery();

  return {
    resize(): void {
      // 直後に engine が 1 フレーム描画する(§8.2)
      kit.resize();
      tags.update(kit.rects);
    },
    destroy(): void {
      // シーン内の geometry / material は kit.dispose() が走査して解放する。
      // 走査で拾えないもの(インスタンス属性・スプライトのテクスチャ)を先に解放する
      cellAtoms.mesh.dispose();
      recipPoints.mesh.dispose();
      ghost.dispose();
      absentMark.material.map?.dispose();
      tags.dispose();
      kit.dispose();
      readout.el.remove();
      hStepper.el.remove();
      kStepper.el.remove();
      lStepper.el.remove();
    },
  };
}
