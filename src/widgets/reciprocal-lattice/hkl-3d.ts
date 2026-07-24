/**
 * hkl-3d.ts — 図6「3次元へ」(仕様書 05 §5.6)
 *
 * 左ビューポートに単純立方格子 5×5×5 と選択中 (hkl) の面束・面法線の
 * 矢印、右ビューポートに逆格子点 |h|,|k|,|l| ≤ 2 と選択点の g 矢印を、
 * 連動カメラ(createDualView)で描く。幾何は格子定数 = 1 の無次元座標で
 * 組み、実空間側はルート Group の scale = a、逆空間側は scale = 1/a と
 * することで、a スライダーに対して「左は伸び・右は縮む」単位の逆転を
 * 視覚化する。d = a/√(h²+k²+l²)(式 E10)と d×|g| = 1.00 を読み取り値で
 * 検算する。
 *
 * 簡略化(§5.6): 面束は中央(|n| の小さい順)から最大 9 枚まで。原子球の
 * 半径は見やすさ優先で実寸比ではない。(000) は「面なし」の表示を出し、
 * 面束・法線矢印・選択強調を描かない。
 *
 * three.js は _shared3d 経由でのみ import する(§5.0)。描画は
 * requestRender 型: host.onRender に kit.render を登録し、パラメータ
 * 変更・視点変更(createDualView の onChange)のときだけ
 * host.requestRender() を呼ぶ。onFrame は使わないため静止時の GPU 消費は
 * ゼロ(慣性は _shared3d が内部 rAF で処理して onChange を呼んでくる)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { set3, vec3, type Vec3 } from "../../core/mathx";
import { matColor, uiColor } from "../../core/colors";
import { dCubic, planeBoxPolygon } from "./lattice";
import { createReadout, createStepper } from "./_shared2d";
import {
  THREE,
  createArrow3D,
  createDualView,
  createInstancedAtoms,
  createLineSegments,
  createPanelTags,
  createPlaneStack,
  makeLabelSprite,
} from "./_shared3d";

/** ミラー指数 h, k, l の範囲・初期値(§5.6: −2〜2、初期 (1, 0, 0)) */
const HKL_MIN = -2;
const HKL_MAX = 2;
const H_INIT = 1;
const K_INIT = 0;
const L_INIT = 0;
/** 格子定数 a の範囲・初期値・刻み(nm) */
const A_MIN = 0.3;
const A_MAX = 0.5;
const A_STEP = 0.01;
const A_INIT = 0.4;
/** 「面を表示」トグルの初期値(§5.6: on) */
const PLANES_INIT = true;
/** 格子点の指数範囲(−2..2)と総数(5×5×5 = 125) */
const GRID_HALF = 2;
const GRID_COUNT = (GRID_HALF * 2 + 1) ** 3;
/** カメラ距離(左 = 実空間、右 = 逆空間)。バウンディング球
 * (左: 2a√3 + 原子半径 ≈ 1.5〜1.9 nm、右: (2/a)√3 ≈ 8.7〜11.5 nm⁻¹)が
 * FOV 40° に収まるよう dist ≈ r / sin(20°) で見積もる */
const DIST_FIRST = 5.0;
const DIST_SECOND = 26;
/** 原子球の半径(無次元。見やすさ優先で実寸比ではない — §5.6) */
const ATOM_RADIUS = 0.16;
/** 面上原子の縁取り球の拡大率(§5.6) */
const RIM_SCALE = 1.3;
/** 逆格子点の半径(無次元)と原点 000 の拡大率(§5.6) */
const RECIP_RADIUS = 0.09;
const ORIGIN_SCALE = 1.6;
/** 選択点の強調球の半径(無次元)と分割数 */
const SELECTED_RADIUS = 0.13;
const SELECTED_SEGMENTS_W = 24;
const SELECTED_SEGMENTS_H = 18;
/** 面束: 交差判定の箱の半径(原子箱 ±2 をわずかに覆う)と最大枚数 */
const PLANE_BOX_HALF = 2.02;
const MAX_PLANES = 9;
/** 面束の塗りの不透明度(§5.6: recip 12%) */
const PLANE_FILL_OPACITY = 0.12;
/** 面法線矢印の軸半径と長さ(無次元) */
const NORMAL_SHAFT_RADIUS = 0.045;
const NORMAL_ARROW_LEN = 1.3;
/** g 矢印の軸半径(無次元) */
const G_SHAFT_RADIUS = 0.03;
/** 逆空間の軸線の片側長さとラベル位置(無次元) */
const AXIS_HALF = 2.6;
const AXIS_LABEL_POS = 2.9;
/** 軸ラベルスプライトの高さ(無次元) */
const AXIS_LABEL_HEIGHT = 0.45;

/** パネルの単位ラベル(§5.0: 両パネルに単位を常に目に入れる) */
const TAG_REAL = "実空間 [nm]";
const TAG_REAL_ZERO = "実空間 [nm] — (000) に面はありません";
const TAG_RECIP = "逆空間 [nm⁻¹]";
/** stage の aria-label(キーボード視点操作の説明 — §5.6) */
const ARIA_LABEL =
  "3D 視点。ドラッグまたは矢印キーで回転、+ と − でズーム。" +
  "左が実格子と (hkl) 面、右が逆格子";

/** 立方体(原点中心)の 8 頂点の符号 */
const CUBE_SIGNS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

/** 立方体の 12 稜線(CUBE_SIGNS の添字ペア) */
const CUBE_EDGE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/** 一辺 2·half の立方体の稜線の線分列([x0,y0,z0, x1,y1,z1, …]) */
function cubeEdgePositions(half: number): number[] {
  const out: number[] = [];
  for (const [i, j] of CUBE_EDGE_PAIRS) {
    const p = CUBE_SIGNS[i];
    const q = CUBE_SIGNS[j];
    out.push(
      p[0] * half,
      p[1] * half,
      p[2] * half,
      q[0] * half,
      q[1] * half,
      q[2] * half,
    );
  }
  return out;
}

/** x・y・z 軸それぞれ ±half の 3 本の線分列 */
function axisLinePositions(half: number): number[] {
  return [
    -half,
    0,
    0,
    half,
    0,
    0,
    0,
    -half,
    0,
    0,
    half,
    0,
    0,
    0,
    -half,
    0,
    0,
    half,
  ];
}

export default function hkl3d(host: FigureHost): WidgetHandle {
  // 色は初期化時に一度だけ解決する(§6.2)
  const matrixFill = matColor("matrix");
  const recipFill = matColor("recip");
  const hairline = uiColor("hairline");

  /* ---- 状態(§5.6) ---- */

  let h = H_INIT; // ミラー指数 h
  let k = K_INIT; // ミラー指数 k
  let l = L_INIT; // ミラー指数 l
  let a = A_INIT; // 格子定数(nm)
  let showPlanes = PLANES_INIT; // 面束・法線矢印の表示

  /* ---- シーン雛形(2 ビューポート + 連動カメラ — §5.6) ---- */

  const kit = createDualView(host, {
    distFirst: DIST_FIRST,
    distSecond: DIST_SECOND,
    ariaLabel: ARIA_LABEL,
    onChange: () => host.requestRender(),
  });

  /* ---- 左 = 実空間。無次元で組み、ルートの scale = a で nm にする ---- */

  const realRoot = new THREE.Group();
  kit.sceneFirst.add(realRoot);

  // 面上原子の縁取り球(本体球より先に add し、後から本体球を重ねる)。
  // BackSide(内向きの面)で描くため、本体球の内側では常に本体が手前に
  // なり、輪郭の外側だけが recip 色の縁として見える(§5.6)
  const rimAtoms = createInstancedAtoms(
    GRID_COUNT,
    ATOM_RADIUS * RIM_SCALE,
    recipFill,
  );
  const rimMaterial = rimAtoms.mesh.material;
  if (!Array.isArray(rimMaterial)) rimMaterial.side = THREE.BackSide;
  realRoot.add(rimAtoms.mesh);

  // 単純立方 5×5×5 の原子(整数座標 −2..2。位置は固定 — §5.6)
  const bodyAtoms = createInstancedAtoms(GRID_COUNT, ATOM_RADIUS, matrixFill);
  {
    let i = 0;
    for (let x = -GRID_HALF; x <= GRID_HALF; x++) {
      for (let y = -GRID_HALF; y <= GRID_HALF; y++) {
        for (let z = -GRID_HALF; z <= GRID_HALF; z++) {
          bodyAtoms.setAtom(i++, x, y, z);
        }
      }
    }
    bodyAtoms.commit();
  }
  realRoot.add(bodyAtoms.mesh);

  // 外形の箱(一辺 4)の稜線(hairline — §5.6)
  const boxEdges = createLineSegments(cubeEdgePositions(GRID_HALF), hairline);
  realRoot.add(boxEdges);

  // 選択 (hkl) の面束と、原点から面法線方向の矢印
  const planeStack = createPlaneStack(recipFill, PLANE_FILL_OPACITY);
  realRoot.add(planeStack.group);
  const normalArrow = createArrow3D(recipFill, NORMAL_SHAFT_RADIUS);
  realRoot.add(normalArrow.group);

  /* ---- 右 = 逆空間。ルートの scale = 1/a で nm⁻¹ にする ---- */

  const recipRoot = new THREE.Group();
  kit.sceneSecond.add(recipRoot);

  // 逆格子点 5×5×5(000 だけ大きく描く — §5.6)
  const recipAtoms = createInstancedAtoms(GRID_COUNT, RECIP_RADIUS, recipFill);
  {
    let i = 0;
    for (let x = -GRID_HALF; x <= GRID_HALF; x++) {
      for (let y = -GRID_HALF; y <= GRID_HALF; y++) {
        for (let z = -GRID_HALF; z <= GRID_HALF; z++) {
          const isOrigin = x === 0 && y === 0 && z === 0;
          recipAtoms.setAtom(i++, x, y, z, isOrigin ? ORIGIN_SCALE : 1);
        }
      }
    }
    recipAtoms.commit();
  }
  recipRoot.add(recipAtoms.mesh);

  // 選択点の強調球と、原点からの g 矢印
  const selectedGeom = new THREE.SphereGeometry(
    SELECTED_RADIUS,
    SELECTED_SEGMENTS_W,
    SELECTED_SEGMENTS_H,
  );
  const selectedMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(recipFill),
  });
  const selectedMesh = new THREE.Mesh(selectedGeom, selectedMat);
  recipRoot.add(selectedMesh);
  const gArrow = createArrow3D(recipFill, G_SHAFT_RADIUS);
  recipRoot.add(gArrow.group);

  // 軸(±2.6 の 3 本の細線)と端の h / k / l ラベル
  const axes = createLineSegments(axisLinePositions(AXIS_HALF), hairline);
  recipRoot.add(axes);
  const axisLabels: ReadonlyArray<readonly [string, number, number, number]> = [
    ["h", AXIS_LABEL_POS, 0, 0],
    ["k", 0, AXIS_LABEL_POS, 0],
    ["l", 0, 0, AXIS_LABEL_POS],
  ];
  const axisSprites = axisLabels.map(([text, x, y, z]) => {
    const sprite = makeLabelSprite(text, recipFill, AXIS_LABEL_HEIGHT);
    sprite.position.set(x, y, z);
    recipRoot.add(sprite);
    return sprite;
  });

  /* ---- パネルの単位ラベル(HTML オーバーレイ — §5.0) ---- */

  const tags = createPanelTags(host.stage, [TAG_REAL, TAG_RECIP]);
  tags.update(kit.rects);

  /* ---- 読み取り値(§5.6: (hkl) / d / |g| / d×|g|) ---- */

  const readout = createReadout(host);
  const hklItem = readout.item("(hkl)");
  const dItem = readout.item("d");
  const gItem = readout.item("|g|", { color: "recip" });
  const prodItem = readout.item("d×|g|");

  /* ---- 状態 → シーンの反映 ---- */

  // 描画中の面(g·r = n)の n 集合とポリゴン列(再利用して割当てを抑える)
  const drawnN = new Set<number>();
  const polys: Vec3[][] = [];
  const gVec = vec3(H_INIT, K_INIT, L_INIT);

  /** 平面 g·r = n が箱と交わればポリゴンを面束へ追加する */
  function tryAddPlane(n: number): void {
    if (polys.length >= MAX_PLANES) return;
    const poly = planeBoxPolygon(gVec, n, PLANE_BOX_HALF);
    if (poly.length === 0) return;
    polys.push(poly);
    drawnN.add(n);
  }

  /** (000) と「面を表示」トグルから各要素の visible を決める(§5.6) */
  function updateVisibility(): void {
    const isOrigin = h === 0 && k === 0 && l === 0;
    planeStack.group.visible = showPlanes && !isOrigin;
    normalArrow.group.visible = showPlanes && !isOrigin;
    selectedMesh.visible = !isOrigin;
    gArrow.group.visible = !isOrigin;
  }

  /** 選択 (hkl) から面束・縁取り・矢印・タグを更新する */
  function updateSelection(): void {
    set3(gVec, h, k, l);
    // 面束: |n| の小さい順(中央から)に最大 MAX_PLANES 枚(§5.6)
    drawnN.clear();
    polys.length = 0;
    const nSpan = Math.ceil(
      (Math.abs(h) + Math.abs(k) + Math.abs(l)) * PLANE_BOX_HALF,
    );
    for (let m = 0; m <= nSpan && polys.length < MAX_PLANES; m++) {
      tryAddPlane(m);
      if (m > 0) tryAddPlane(-m);
    }
    planeStack.set(polys);

    // 面上原子の縁取り: h·i + k·j + l·m が描画中の n 集合に入る原子だけ
    let rims = 0;
    for (let x = -GRID_HALF; x <= GRID_HALF; x++) {
      for (let y = -GRID_HALF; y <= GRID_HALF; y++) {
        for (let z = -GRID_HALF; z <= GRID_HALF; z++) {
          if (drawnN.has(h * x + k * y + l * z)) {
            rimAtoms.setAtom(rims++, x, y, z);
          }
        }
      }
    }
    rimAtoms.mesh.count = rims;
    rimAtoms.commit();

    const isOrigin = h === 0 && k === 0 && l === 0;
    if (!isOrigin) {
      // 面法線方向の矢印(左)と g 矢印・選択点の強調(右)
      const inv = NORMAL_ARROW_LEN / Math.hypot(h, k, l);
      normalArrow.set(h * inv, k * inv, l * inv);
      gArrow.set(h, k, l);
      selectedMesh.position.set(h, k, l);
    }
    tags.set(0, isOrigin ? TAG_REAL_ZERO : TAG_REAL);
    updateVisibility();
  }

  /** ルート Group の scale(左 = a、右 = 1/a — 単位の逆転の視覚化) */
  function updateRootScale(): void {
    realRoot.scale.setScalar(a);
    recipRoot.scale.setScalar(1 / a);
  }

  /** 読み取り値の更新。(000) では d と d×|g| を定義しない(§5.6) */
  function updateReadout(): void {
    hklItem.set(`(${h} ${k} ${l})`);
    if (h === 0 && k === 0 && l === 0) {
      dItem.set("—");
      gItem.set("0");
      prodItem.set("—");
      return;
    }
    const d = dCubic(h, k, l, a);
    const gAbs = Math.hypot(h, k, l) / a;
    dItem.set(`${d.toFixed(3)} nm`);
    gItem.set(`${gAbs.toFixed(2)} nm⁻¹`);
    prodItem.set((d * gAbs).toFixed(2)); // 常に 1.00(式 E6・E10)
  }

  /* ---- 操作部品(§5.6) ---- */

  const hStepper = createStepper(host, {
    label: "h",
    min: HKL_MIN,
    max: HKL_MAX,
    value: H_INIT,
  });
  hStepper.onChange((v) => {
    h = v;
    updateSelection();
    updateReadout();
    // 再描画はステッパ内部の host.requestRender() が要求する
  });

  const kStepper = createStepper(host, {
    label: "k",
    min: HKL_MIN,
    max: HKL_MAX,
    value: K_INIT,
  });
  kStepper.onChange((v) => {
    k = v;
    updateSelection();
    updateReadout();
  });

  const lStepper = createStepper(host, {
    label: "l",
    min: HKL_MIN,
    max: HKL_MAX,
    value: L_INIT,
  });
  lStepper.onChange((v) => {
    l = v;
    updateSelection();
    updateReadout();
  });

  const aSlider = host.controls.slider({
    id: "a",
    label: "格子定数 a",
    min: A_MIN,
    max: A_MAX,
    step: A_STEP,
    value: A_INIT,
    unit: "nm",
  });
  aSlider.onChange((v) => {
    a = v;
    // 面束・矢印は無次元のまま変わらず、ルートの scale だけが変わる
    updateRootScale();
    updateReadout();
    host.requestRender();
  });

  const planesToggle = host.controls.toggle({
    id: "planes",
    label: "面を表示",
    value: PLANES_INIT,
  });
  planesToggle.onChange((v) => {
    showPlanes = v;
    updateVisibility();
    host.requestRender();
  });

  host.controls.reset(() => {
    // パラメータと視点をすべて初期値へ(§5.0)。set() が onChange 経由で
    // シーンと読み取り値を更新する(値が同じなら状態も既に初期値)
    hStepper.set(H_INIT);
    kStepper.set(K_INIT);
    lStepper.set(L_INIT);
    aSlider.set(A_INIT);
    planesToggle.set(PLANES_INIT);
    kit.resetView(); // onChange → host.requestRender() が呼ばれる
  });

  /* ---- 初期化と描画登録(requestRender 型 — §5.6) ---- */

  // 描画関数は kit.render() を呼ぶだけ。状態はすべてシーン側に反映済み
  host.onRender(() => kit.render());
  updateRootScale();
  updateSelection();
  updateReadout();

  return {
    resize(): void {
      kit.resize();
      tags.update(kit.rects);
      // この後 engine が 1 フレーム描く(§8.2)
    },
    destroy(): void {
      planeStack.dispose();
      normalArrow.dispose();
      gArrow.dispose();
      rimAtoms.dispose();
      bodyAtoms.dispose();
      recipAtoms.dispose();
      selectedGeom.dispose();
      selectedMat.dispose();
      for (const sprite of axisSprites) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      tags.dispose();
      kit.dispose(); // 残りのシーン内リソースとリスナーを解放する
      readout.el.remove();
      hStepper.el.remove();
      kStepper.el.remove();
      lStepper.el.remove();
    },
  };
}
