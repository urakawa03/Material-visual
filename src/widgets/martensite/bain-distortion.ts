/**
 * bain-distortion.ts — 図3「ベイン対応 FCC → BCT → BCC」(記事仕様書 10 §5.3)
 *
 * 面心立方の慣用単位胞 2×2×1 個分の鉄原子(createInstancedAtoms)と、その
 * 中に埋まっている体心正方の胞の稜線(--color-accent の太線)。変形量 s を
 * 動かすと、体心正方の胞が縦(c)に縮み横(a)に伸び、s = 1 で体心立方になる。
 *
 * 変形前の最近接の原子どうしを結ぶ細い線は、変形の全過程で**同じ原子どうしに
 * 張ったまま付け替えない**(lib/bain.ts の結合表は s に依存しない)。原子は
 * 全員が同じ一次変換で一斉に動き、入れ替わらない(無拡散 — プロンプト 10 の
 * 最重要の注意。lib/bain.test.ts の T4 で担保)。中央の原子の 12 本は濃く描き、
 * s = 1 でそのうち 8 本が最近接、4 本が第 2 近接になることを読み取りで示す。
 *
 * 「炭素を入れる」で、体心正方の c 軸の稜の中点などの八面体位置に炭素
 * (--mat-solute)を置く。炭素も格子と一緒に運ばれ、s = 1 で c/a = 1.036 の
 * 体心正方(マルテンサイト)が残る(図6 の伏線)。
 *
 * 簡略化(図注): ベイン対応は格子の対応の説明で、実際の原子の経路そのもの
 * ではない(実際は格子不変せん断を伴う — PTMC)。原子の球の大きさは見やすさ
 * 優先。格子定数は共析鋼(0.8% C)のオーステナイトの値。
 *
 * 実装方式: 3D / requestRender(視点・スライダーの変更時だけ 1 フレーム)。
 * three.js は reciprocal-lattice/_shared3d.ts 経由でのみ import し、この図版の
 * チャンクだけに入る(registry の動的 import — 図版に接近したときに読み込む)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  THREE,
  createInstancedAtoms,
  createLineSegments,
  createPanelTags,
  createSingleView,
} from "../reciprocal-lattice/_shared3d";
import {
  bainStrain,
  bondLengths,
  buildBainBlock,
  deformInto,
} from "./lib/bain";
import { fmtSignedPercent } from "./lib/draw";

/** 世界座標の単位: 1 nm = 10(three の単位) */
const WORLD_PER_NM = 10;
/** 原子球の半径(世界単位。見やすさ優先で実寸比ではない) */
const FE_RADIUS = 0.36;
const C_RADIUS = 0.27;
/** 体心正方の胞の稜線(円柱)の半径 */
const EDGE_RADIUS = 0.065;
/** カメラ距離・初期の視点(§5.3) */
const CAMERA_DIST = 16;
const AZIMUTH_DEG = 28;
const ELEVATION_DEG = 22;
/**
 * 横に広いブロックがちょうど収まる縦横比。これより縦長のキャンバス(狭い幅の
 * 1:1 など)では、横がはみ出さないようにカメラのズームを引く
 */
const FIT_ASPECT = 1.3;
/** 初期状態(§5.3: s = 0・胞の強調 on・炭素 off) */
const S_INIT = 0;
const HIGHLIGHT_INIT = true;
const CARBON_INIT = false;

/** 体心正方の胞の 12 本の稜(bctCorners の添字の組: 下面 4・上面 4・縦 4) */
const BCT_EDGES: ReadonlyArray<readonly [number, number]> = [
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

export default function bainDistortion(host: FigureHost): WidgetHandle {
  const block = buildBainBlock();
  const nAtoms = block.count;
  const nBonds = block.bonds.length / 2;
  const nCarbon = block.carbonSites.length / 3;

  /* ---- 状態 ---- */
  let s = S_INIT;
  let highlight = HIGHLIGHT_INIT;
  let carbon = CARBON_INIT;

  /** 変形後の位置 [nm](毎回の割当てを避ける) */
  const pos = new Float64Array(block.ref.length);
  const cPos = new Float64Array(block.carbonSites.length);
  /** ブロックの中心(参照配置で y = 0.5 a_γ)を回転の中心にする */
  const centerRef = new Float64Array([0, 0.5, 0]);
  const centerNm = new Float64Array(3);

  /* ---- 3D の雛形(白背景・半球光 — §6.5)---- */
  const kit = createSingleView(host, {
    dist: CAMERA_DIST,
    azimuthDeg: AZIMUTH_DEG,
    elevationDeg: ELEVATION_DEG,
    onChange: () => host.requestRender(),
    ariaLabel:
      "3D 視点。ドラッグまたは矢印キーで回転、+ と − でズーム。面心立方の鉄の格子と、その中の体心正方の胞",
  });
  const tags = createPanelTags(host.stage, ["面心立方(fcc)"]);
  tags.update(kit.rects);

  /** 縦横比に応じてズームを引く(FIT_ASPECT より縦長のときだけ) */
  function fitZoom(): void {
    const { w, h } = host.size;
    const aspect = w > 0 && h > 0 ? w / h : FIT_ASPECT;
    kit.camera.zoom = Math.min(1, aspect / FIT_ASPECT);
    kit.camera.updateProjectionMatrix();
  }
  fitZoom();

  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");

  const atoms = createInstancedAtoms(nAtoms, FE_RADIUS, matColor("matrix"));
  kit.scene.add(atoms.mesh);
  const carbons = createInstancedAtoms(nCarbon, C_RADIUS, matColor("solute"));
  kit.scene.add(carbons.mesh);

  // 結合: 中央の原子の 12 本(濃い)と、それ以外(淡い)に分ける
  const centerBondIdx: number[] = [];
  const otherBondIdx: number[] = [];
  for (let k = 0; k < nBonds; k++) {
    const i = block.bonds[2 * k];
    const j = block.bonds[2 * k + 1];
    if (i === block.center || j === block.center) centerBondIdx.push(k);
    else otherBondIdx.push(k);
  }
  const otherBonds = createLineSegments(
    new Array<number>(otherBondIdx.length * 6).fill(0),
    text2,
    0.45,
  );
  const centerBonds = createLineSegments(
    new Array<number>(centerBondIdx.length * 6).fill(0),
    text,
    0.9,
  );
  otherBonds.frustumCulled = false;
  centerBonds.frustumCulled = false;
  kit.scene.add(otherBonds, centerBonds);

  // 体心正方の胞の稜線(太線 = 円柱のインスタンス)
  const edgeGeom = new THREE.CylinderGeometry(EDGE_RADIUS, EDGE_RADIUS, 1, 10);
  edgeGeom.translate(0, 0.5, 0); // 根元を原点に、+y 方向へ長さ 1
  const edgeMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(accent),
  });
  const edges = new THREE.InstancedMesh(edgeGeom, edgeMat, BCT_EDGES.length);
  edges.frustumCulled = false;
  kit.scene.add(edges);

  const mtx = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** 格子座標 [nm](z = c 軸)→ three の座標(y を上に)。右手系を保つ写像 */
  function toWorld(x: number, y: number, z: number, out: THREE.Vector3): void {
    out.set(
      (x - centerNm[0]) * WORLD_PER_NM,
      (z - centerNm[2]) * WORLD_PER_NM,
      -(y - centerNm[1]) * WORLD_PER_NM,
    );
  }

  const wA = new THREE.Vector3();
  const wB = new THREE.Vector3();

  function writeBonds(seg: THREE.LineSegments, idx: readonly number[]): void {
    const attr = seg.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    idx.forEach((k, n) => {
      const i = block.bonds[2 * k];
      const j = block.bonds[2 * k + 1];
      toWorld(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], wA);
      toWorld(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2], wB);
      arr[n * 6] = wA.x;
      arr[n * 6 + 1] = wA.y;
      arr[n * 6 + 2] = wA.z;
      arr[n * 6 + 3] = wB.x;
      arr[n * 6 + 4] = wB.y;
      arr[n * 6 + 5] = wB.z;
    });
    attr.needsUpdate = true;
  }

  /** 状態から全オブジェクトの位置を更新する(変化時のみ呼ぶ) */
  function rebuild(): void {
    deformInto(block.ref, s, carbon, pos);
    deformInto(block.carbonSites, s, carbon, cPos);
    deformInto(centerRef, s, carbon, centerNm);
    for (let i = 0; i < nAtoms; i++) {
      toWorld(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], wA);
      atoms.setAtom(i, wA.x, wA.y, wA.z);
    }
    atoms.commit();
    for (let c = 0; c < nCarbon; c++) {
      toWorld(cPos[c * 3], cPos[c * 3 + 1], cPos[c * 3 + 2], wA);
      carbons.setAtom(c, wA.x, wA.y, wA.z);
    }
    carbons.commit();
    carbons.mesh.visible = carbon;
    writeBonds(otherBonds, otherBondIdx);
    writeBonds(centerBonds, centerBondIdx);
    // 稜線の円柱を 2 点の間に張る
    BCT_EDGES.forEach(([a, b], k) => {
      const ia = block.bctCorners[a];
      const ib = block.bctCorners[b];
      toWorld(pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2], p0);
      toWorld(pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2], wB);
      dir.subVectors(wB, p0);
      const len = dir.length();
      quat.setFromUnitVectors(UP, dir.normalize());
      scl.set(1, len, 1);
      mtx.compose(p0, quat, scl);
      edges.setMatrixAt(k, mtx);
    });
    edges.instanceMatrix.needsUpdate = true;
    edges.visible = highlight;
    updateReadouts();
  }

  /* ---- 読み取り値(§5.3) ---- */
  const readout = createReadout(host);
  const rC = readout.item("c 方向のひずみ");
  const rA = readout.item("a 方向のひずみ");
  const rRatio = readout.item("c/a");
  const rVol = readout.item("体積変化");
  // 中央の原子から出る 12 本の長さ(狭い幅でも 1 行に収まるよう 2 つに分ける)
  const rBondDiag = readout.item("中央の原子から斜めの 8 本");
  const rBondFlat = readout.item("水平の 4 本");

  function updateReadouts(): void {
    const st = bainStrain(s, carbon);
    rC.set(fmtSignedPercent(st.epsC));
    rA.set(fmtSignedPercent(st.epsA));
    rRatio.set(st.cOverA.toFixed(3));
    rVol.set(fmtSignedPercent(st.dVol));
    const bl = bondLengths(s, carbon);
    rBondDiag.set(`${bl.outOfPlane.toFixed(3)} nm`);
    rBondFlat.set(`${bl.inPlane.toFixed(3)} nm`);
    let label: string;
    if (s <= 0) label = "面心立方(fcc)— 体心正方の胞は c/a = 1.414";
    else if (s >= 1)
      label = carbon
        ? "体心正方のマルテンサイト(c/a = 1.036)"
        : "体心立方(bcc)— c/a = 1";
    else label = `変形の途中(体心正方 c/a = ${st.cOverA.toFixed(3)})`;
    tags.set(0, label);
  }

  /* ---- 操作部品(§5.3) ---- */
  const sSlider = host.controls.slider({
    id: "s",
    label: "変形量 s",
    min: 0,
    max: 1,
    step: 0.01,
    value: S_INIT,
    format: (v) => v.toFixed(2),
  });
  sSlider.onChange((v) => {
    s = v;
    rebuild();
    host.requestRender();
  });
  const hlToggle = host.controls.toggle({
    id: "bct",
    label: "体心正方の胞を強調",
    value: HIGHLIGHT_INIT,
  });
  hlToggle.onChange((v) => {
    highlight = v;
    rebuild();
    host.requestRender();
  });
  const cToggle = host.controls.toggle({
    id: "carbon",
    label: "炭素を入れる",
    value: CARBON_INIT,
  });
  cToggle.onChange((v) => {
    carbon = v;
    rebuild();
    host.requestRender();
  });
  host.controls.reset(() => {
    sSlider.set(S_INIT);
    hlToggle.set(HIGHLIGHT_INIT);
    cToggle.set(CARBON_INIT);
    s = S_INIT;
    highlight = HIGHLIGHT_INIT;
    carbon = CARBON_INIT;
    rebuild();
    kit.resetView();
  });

  rebuild();
  host.onRender(() => kit.render());

  return {
    resize(): void {
      kit.resize();
      fitZoom();
      tags.update(kit.rects);
    },
    destroy(): void {
      tags.dispose();
      atoms.dispose();
      carbons.dispose();
      edgeGeom.dispose();
      edgeMat.dispose();
      kit.dispose();
    },
  };
}
