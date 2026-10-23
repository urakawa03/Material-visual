/**
 * basis-in-cell.ts — 図2「格子点には何が置いてあるか」(仕様書 08 §5.2)
 *
 * 3D の慣用単位胞(立方体の稜線)と、その中の原子(種類ごとに --mat-matrix /
 * --mat-second)。格子点には小さな十字、基底の原子は球。「格子 + 基底に分けて
 * 表示」で、格子点の十字と、各格子点から伸びる基底の組(細い線)を出す。
 * Fe では「体心立方の格子 + 1 原子」と「単純立方の格子 + 2 原子」の見方を
 * 切り替えられる — 原子の並びは 1 つも動かず、印の付き方だけが変わる。
 * 原子はクリック、またはステッパ「原子を選ぶ」(キーボード)で選び、分率座標を
 * ラベルと読み取り値で示す。
 *
 * 座標: 分率座標 (x, y, z) を、z が上になるよう three の (X, Y, Z) =
 * (x − ½, z − ½, −(y − ½)) へ写す(右手系を保つ)。一辺 1 の立方体。
 *
 * 簡略化(図注に明示): 原子の半径は見やすさのための値で、実際の原子半径の
 * 比ではない。
 *
 * 実装方式: 3D / requestRender 型(視点変更・操作時だけ 1 フレーム描く —
 * _shared3d.ts のダーティ方式)。three.js はこのモジュールの動的 import で
 * 初めて読み込まれる。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import { createReadout, createStepper } from "../reciprocal-lattice/_shared2d";
import {
  THREE,
  createInstancedAtoms,
  createLineSegments,
  createPanelTags,
  createSingleView,
  makeLabelSprite,
  makeRingSprite,
} from "../reciprocal-lattice/_shared3d";
import {
  CSCL,
  CU,
  FE,
  FE_AS_SC,
  LATTICE_NAMES,
  LATTICE_POINTS,
  NACL,
  SI,
  cellImages,
  isSecondSpecies,
  majorElement,
  type CellImage,
  type CrystalStructure,
} from "./lib/structures";
import { allowReadoutWrap, fracLabel, setControlEnabled } from "./lib/draw";

type MaterialId = "fe" | "cu" | "si" | "nacl" | "cscl";
type FeView = "bcc1" | "sc2";

const MATERIAL_INIT: MaterialId = "si";
const FE_VIEW_INIT: FeView = "bcc1";
const SPLIT_INIT = true;

/** カメラ距離(一辺 1 の立方体とラベルが収まる距離) */
const CAMERA_DIST = 3.6;
/** 原子の半径(一辺 1 に対する値。見やすさのため — 実寸比ではない) */
const ATOM_RADIUS = 0.1;
/** 原子のインスタンス上限(NaCl の 27 像を種類ごとに収める) */
const ATOM_CAPACITY = 32;
/** 格子点の十字の腕の長さ(片側。球の半径より長くして球の外に出す) */
const CROSS_ARM = 0.17;
/** 選んだ原子の輪(スプライト)の大きさと、座標ラベルの高さ */
const RING_SIZE = 0.36;
const LABEL_HEIGHT = 0.11;
const AXIS_LABEL_HEIGHT = 0.1;
/** 稜線を白地で見えるようにする暗さ(hairline から) */
const EDGE_DARKEN = 0.3;

const MATERIAL_NAMES: Readonly<Record<MaterialId, string>> = {
  fe: "Fe",
  cu: "Cu",
  si: "Si",
  nacl: "NaCl",
  cscl: "CsCl",
};

/** 分率座標 → three の座標(z を上に) */
function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x - 0.5, z - 0.5, -(y - 0.5)];
}

/** 立方体の 12 本の稜線 */
function cubeEdges(): number[] {
  const c: Array<[number, number, number]> = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const e: Array<[number, number]> = [
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
  const out: number[] = [];
  for (const [a, b] of e) {
    out.push(...toThree(...c[a]), ...toThree(...c[b]));
  }
  return out;
}

/** 0〜1 の範囲に入っているか(端を含む) */
function inCell(v: number): boolean {
  return v > -1e-9 && v < 1 + 1e-9;
}

/** 単位胞の中に描く格子点(角・面心・体心の像を含む) */
function latticePointImages(
  st: CrystalStructure,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const [lx, ly, lz] of LATTICE_POINTS[st.lattice]) {
    const xs = lx === 0 ? [0, 1] : [lx];
    const ys = ly === 0 ? [0, 1] : [ly];
    const zs = lz === 0 ? [0, 1] : [lz];
    for (const x of xs)
      for (const y of ys) for (const z of zs) out.push([x, y, z]);
  }
  return out;
}

/** 単位胞の原子数の内訳(角・辺・面・内部) */
function shareBreakdown(images: readonly CellImage[]): string {
  let corner = 0;
  let edge = 0;
  let face = 0;
  let inner = 0;
  for (const im of images) {
    if (im.share === 1 / 8) corner++;
    else if (im.share === 1 / 4) edge++;
    else if (im.share === 1 / 2) face++;
    else inner++;
  }
  const total = corner / 8 + edge / 4 + face / 2 + inner;
  const parts: string[] = [];
  if (corner) parts.push(`角 ${corner}×⅛`);
  if (edge) parts.push(`辺 ${edge}×¼`);
  if (face) parts.push(`面 ${face}×½`);
  if (inner) parts.push(`内部 ${inner}`);
  return `${total} 個(${parts.join(" + ")})`;
}

function coordLabel(x: number, y: number, z: number): string {
  return `(${fracLabel(x)}, ${fracLabel(y)}, ${fracLabel(z)})`;
}

export default function basisInCell(host: FigureHost): WidgetHandle {
  const matrixFill = matColor("matrix");
  const secondFill = matColor("second");
  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const edgeColor = darken(uiColor("hairline"), EDGE_DARKEN);

  /* ---- 状態 ---- */

  let material: MaterialId = MATERIAL_INIT;
  let feView: FeView = FE_VIEW_INIT;
  let split = SPLIT_INIT;
  /** 選んだサイト(−1 = なし) */
  let selected = -1;

  function structure(): CrystalStructure {
    switch (material) {
      case "fe":
        return feView === "bcc1" ? FE : FE_AS_SC;
      case "cu":
        return CU;
      case "si":
        return SI;
      case "nacl":
        return NACL;
      case "cscl":
        return CSCL;
    }
  }

  let st = structure();
  let images: CellImage[] = cellImages(st);

  /* ---- 3D シーン ---- */

  const kit = createSingleView(host, {
    dist: CAMERA_DIST,
    azimuthDeg: 32,
    elevationDeg: 22,
    ariaLabel:
      "3D 視点。ドラッグまたは矢印キーで回転、+ と − でズーム。" +
      "立方体の単位胞と、その中の原子を表示している",
    onChange: () => host.requestRender(),
  });
  const scene = kit.scene;
  const root = new THREE.Group();
  scene.add(root);

  root.add(createLineSegments(cubeEdges(), edgeColor));

  const atomsA = createInstancedAtoms(ATOM_CAPACITY, ATOM_RADIUS, matrixFill);
  const atomsB = createInstancedAtoms(ATOM_CAPACITY, ATOM_RADIUS, secondFill);
  root.add(atomsA.mesh, atomsB.mesh);
  /** インスタンス番号 → 像の番号 */
  const imageOfA = new Int32Array(ATOM_CAPACITY);
  const imageOfB = new Int32Array(ATOM_CAPACITY);

  // 格子点の十字と基底の組の線(物質・見方を変えるたびに作り直す)
  let crosses: THREE.LineSegments | null = null;
  let basisLines: THREE.LineSegments | null = null;

  // 軸の名前(原点の角から伸びる 3 辺の先)
  const axisLabels = [
    { text: "x", pos: toThree(1.13, 0, 0) },
    { text: "y", pos: toThree(0, 1.13, 0) },
    { text: "z", pos: toThree(0, 0, 1.13) },
    { text: "O", pos: toThree(-0.07, -0.07, -0.07) },
  ].map(({ text: t, pos }) => {
    const s = makeLabelSprite(t, text2, AXIS_LABEL_HEIGHT);
    s.position.set(...pos);
    root.add(s);
    return s;
  });

  // 選んだ原子の輪(像ごと)と座標ラベル
  const rings: THREE.Sprite[] = [];
  for (let i = 0; i < 8; i++) {
    const r = makeRingSprite(accent, RING_SIZE);
    r.visible = false;
    root.add(r);
    rings.push(r);
  }
  let coordSprite: THREE.Sprite | null = null;

  const tags = createPanelTags(host.stage, [""]);
  tags.update(kit.rects);
  const legend = document.createElement("span");
  legend.className = "ix-panel-tag";
  legend.style.left = "10px";
  legend.style.bottom = "8px";
  host.stage.appendChild(legend);

  /* ---- 読み取り値(仕様書 08 §5.2) ---- */

  const readout = createReadout(host);
  const countItem = readout.item("単位胞の原子数");
  const latticeItem = readout.item("格子");
  const basisItem = readout.item("基底");
  const selItem = readout.item("選んだ原子");
  allowReadoutWrap(readout.el);

  /* ---- 状態 → シーン ---- */

  function rebuild(): void {
    st = structure();
    images = cellImages(st);
    let na = 0;
    let nb = 0;
    images.forEach((im, i) => {
      const [X, Y, Z] = toThree(im.x, im.y, im.z);
      if (isSecondSpecies(majorElement(st.sites[im.site]))) {
        atomsB.setAtom(nb, X, Y, Z);
        imageOfB[nb++] = i;
      } else {
        atomsA.setAtom(na, X, Y, Z);
        imageOfA[na++] = i;
      }
    });
    atomsA.mesh.count = na;
    atomsB.mesh.count = nb;
    atomsA.commit();
    atomsB.commit();
    atomsA.mesh.computeBoundingSphere();
    atomsB.mesh.computeBoundingSphere();

    // 格子点の十字
    if (crosses) {
      root.remove(crosses);
      crosses.geometry.dispose();
      (crosses.material as THREE.Material).dispose();
    }
    const cross: number[] = [];
    for (const [x, y, z] of latticePointImages(st)) {
      const [X, Y, Z] = toThree(x, y, z);
      cross.push(X - CROSS_ARM, Y, Z, X + CROSS_ARM, Y, Z);
      cross.push(X, Y - CROSS_ARM, Z, X, Y + CROSS_ARM, Z);
      cross.push(X, Y, Z - CROSS_ARM, X, Y, Z + CROSS_ARM);
    }
    crosses = createLineSegments(cross, text);
    root.add(crosses);

    // 基底の組: 格子点 L から L + b_j へ(組の全原子が単位胞に入るものだけ)
    if (basisLines) {
      root.remove(basisLines);
      basisLines.geometry.dispose();
      (basisLines.material as THREE.Material).dispose();
    }
    const seg: number[] = [];
    if (st.basis.length > 1) {
      for (const [x, y, z] of latticePointImages(st)) {
        const all = st.basis.every(
          (b) => inCell(x + b.dx) && inCell(y + b.dy) && inCell(z + b.dz),
        );
        if (!all) continue;
        for (const b of st.basis) {
          if (b.dx === 0 && b.dy === 0 && b.dz === 0) continue;
          seg.push(
            ...toThree(x, y, z),
            ...toThree(x + b.dx, y + b.dy, z + b.dz),
          );
        }
      }
    }
    basisLines = createLineSegments(seg, text);
    root.add(basisLines);
    applySplit();

    if (selected >= st.sites.length) selected = -1;
    atomStepper.setMax(st.sites.length);
    updateSelection();
    updateReadout();
  }

  function applySplit(): void {
    if (crosses) crosses.visible = split;
    if (basisLines) basisLines.visible = split;
    legend.textContent = split
      ? "十字 = 格子点 ・ 細い線 = 基底の組"
      : "球 = 原子";
  }

  function updateSelection(): void {
    for (const r of rings) r.visible = false;
    if (coordSprite) {
      root.remove(coordSprite);
      coordSprite.material.map?.dispose();
      coordSprite.material.dispose();
      coordSprite = null;
    }
    if (selected < 0) return;
    const s = st.sites[selected];
    let n = 0;
    for (const im of images) {
      if (im.site !== selected || n >= rings.length) continue;
      rings[n].position.set(...toThree(im.x, im.y, im.z));
      rings[n].visible = true;
      n++;
    }
    coordSprite = makeLabelSprite(
      `${majorElement(s)} ${coordLabel(s.x, s.y, s.z)}`,
      text,
      LABEL_HEIGHT,
    );
    const [X, Y, Z] = toThree(s.x, s.y, s.z);
    coordSprite.position.set(X, Y + ATOM_RADIUS + LABEL_HEIGHT * 0.9, Z);
    root.add(coordSprite);
  }

  function updateReadout(): void {
    tags.set(
      0,
      `慣用単位胞(一辺 a = ${st.a.toFixed(4)} nm を 1 とした分率座標)`,
    );
    countItem.set(shareBreakdown(images));
    latticeItem.set(
      `${LATTICE_NAMES[st.lattice]}(単位胞に格子点 ${LATTICE_POINTS[st.lattice].length} 個)`,
    );
    basisItem.set(
      `${st.basis.length} 原子 — ` +
        st.basis
          .map((b) => `${b.occ[0].el} ${coordLabel(b.dx, b.dy, b.dz)}`)
          .join("、"),
    );
    if (selected < 0) {
      selItem.set("—(クリックか「原子を選ぶ」で選ぶ)");
    } else {
      const s = st.sites[selected];
      selItem.set(`${majorElement(s)} ${coordLabel(s.x, s.y, s.z)}`);
    }
  }

  /* ---- 操作部品(仕様書 08 §5.2) ---- */

  const materialSeg = host.controls.segmented<MaterialId>({
    id: "material",
    label: "物質",
    options: (Object.keys(MATERIAL_NAMES) as MaterialId[]).map((id) => ({
      value: id,
      label: MATERIAL_NAMES[id],
    })),
    value: MATERIAL_INIT,
  });
  materialSeg.onChange((v) => {
    material = v;
    setControlEnabled(viewSeg.el, material === "fe");
    rebuild();
    host.requestRender();
  });

  const splitToggle = host.controls.toggle({
    id: "split",
    label: "格子 + 基底に分けて表示",
    value: SPLIT_INIT,
  });
  splitToggle.onChange((v) => {
    split = v;
    applySplit();
    host.requestRender();
  });

  // 選択肢の文は狭い画面でも 1 行に収まる長さにする(格子の名前は読み取り値に出る)
  const viewSeg = host.controls.segmented<FeView>({
    id: "fe-view",
    label: "見方",
    options: [
      { value: "bcc1", label: "体心立方 + 1 原子" },
      { value: "sc2", label: "単純立方 + 2 原子" },
    ],
    value: FE_VIEW_INIT,
  });
  viewSeg.onChange((v) => {
    feView = v;
    rebuild();
    host.requestRender();
  });

  const atomStepper = createStepper(host, {
    label: "原子を選ぶ",
    min: 0,
    max: st.sites.length,
    value: 0,
    format: (v) => (v === 0 ? "なし" : `${v} / ${st.sites.length}`),
  });
  atomStepper.onChange((v) => {
    selected = v - 1;
    updateSelection();
    updateReadout();
  });

  host.controls.reset(() => {
    materialSeg.set(MATERIAL_INIT);
    viewSeg.set(FE_VIEW_INIT);
    splitToggle.set(SPLIT_INIT);
    atomStepper.set(0);
    kit.resetView();
  });

  /* ---- クリックで原子を選ぶ(ドラッグとは動いた距離で区別する) ---- */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  const CLICK_SLOP_PX = 5;

  function onPointerDown(e: PointerEvent): void {
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP_PX)
      return;
    const r = host.canvas.getBoundingClientRect();
    ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, kit.camera);
    const hits = raycaster.intersectObjects([atomsA.mesh, atomsB.mesh], false);
    const hit = hits.find((x) => x.instanceId !== undefined);
    if (!hit || hit.instanceId === undefined) return;
    const image =
      hit.object === atomsA.mesh
        ? imageOfA[hit.instanceId]
        : imageOfB[hit.instanceId];
    atomStepper.set(images[image].site + 1);
  }

  host.canvas.addEventListener("pointerdown", onPointerDown);
  host.canvas.addEventListener("pointerup", onPointerUp);

  /* ---- 初期化と描画登録(requestRender 型) ---- */

  host.onRender(() => kit.render());
  setControlEnabled(viewSeg.el, material === "fe");
  rebuild();

  return {
    resize(): void {
      kit.resize();
      tags.update(kit.rects);
    },
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
      host.canvas.removeEventListener("pointerup", onPointerUp);
      atomsA.mesh.dispose();
      atomsB.mesh.dispose();
      for (const s of [...axisLabels, ...rings]) s.material.map?.dispose();
      if (coordSprite) coordSprite.material.map?.dispose();
      tags.dispose();
      legend.remove();
      kit.dispose();
      readout.el.remove();
      atomStepper.el.remove();
    },
  };
}
