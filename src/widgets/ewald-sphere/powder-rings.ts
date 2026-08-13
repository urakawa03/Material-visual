/**
 * powder-rings.ts — 図6「粉末にする」(仕様書 04 §5.6)
 *
 * 左ビュー(逆空間・オービット操作あり): エヴァルト球と、選択中の反射に
 * 対応する**球殻**(あらゆる方位の結晶を集めると、1 つの逆格子点は原点
 * まわりの半径 |g| の球殻に塗り広げられる)。両者の交わりは 1 つの円で、
 * その円へ向かう回折波は円錐をなす。
 *
 * 右ビュー(検出器・正面固定カメラ): 中心の透過スポットと、許される反射の
 * 環(半径 r = L tan 2θ、式 E16)。選択中の環にはキャリパー(半径線)と
 * (h k l) ラベルが付き、読み取り値で「測った d = λ/(2 sinθ)」と「式の d」を
 * 突き合わせられる。
 *
 * 幾何: 球殻(原点中心・半径 G)とエヴァルト球(半径 R、中心 (−R,0,0))の
 * 交線は、平面 x = −G²/(2R) 上の半径 √(G² − x²) の円になる。
 *
 * 簡略化(図注に明示): 強度(多重度・構造因子・偏光・吸収)は扱わないので
 * 環の濃さはすべて同じ。検出器は平板で、試料からの距離 L を単位にとる。
 * 粒子は十分多いものとして連続な環で描く。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { createReadout, createStepper } from "../reciprocal-lattice/_shared2d";
import {
  THREE,
  createArrow3D,
  createLineSegments,
  createMultiView,
  createPanelTags,
  makeLabelSprite,
} from "../reciprocal-lattice/_shared3d";
import {
  createArrowBundle,
  createEwaldSphere,
  createRecipCloud,
  createShellSphere,
} from "./_scene3d";
import {
  cubicReciprocalPoints,
  dFromTwoThetaDeg,
  powderRings,
  ringRadiusOverL,
  twoThetaDeg,
  waveNumber,
  type CubicLattice,
  type PowderRing,
} from "./ewald";
import {
  A_NM,
  ARROW_SHAFT_RADIUS,
  INCIDENT_DASH_LENGTH,
  MAX_INDEX,
  ORIGIN_SCALE,
  RECIP_RADIUS,
  TAG_DETECTOR,
  TAG_RECIP,
  formatHkl,
} from "./constants";

/** 左(逆空間)ビューのカメラ距離 */
const DIST_RECIP = 34;
/** 右(検出器)ビューのカメラ距離。半径 3.4 L の環まで収まる */
const DIST_DETECTOR = 10;
/** 描画する環の半径の上限(L 単位)。これを超える環は平板検出器から外れる */
const MAX_RING_RADIUS = 3.4;
/** 環として確保する LineLoop の本数(単純立方・maxIndex 3 の本数を覆う) */
const RING_CAPACITY = 32;
/** 円周の分割数 */
const CIRCLE_SEGMENTS = 128;
/** 波長 λ の範囲・初期値(nm) */
const LAMBDA_MIN = 0.1;
const LAMBDA_MAX = 0.3;
const LAMBDA_STEP = 0.002;
const LAMBDA_INIT = 0.154;
/** 円錐を示す回折波の矢の本数 */
const CONE_ARROWS = 12;
/** 球殻の塗りの不透明度(内部が透けること優先 — §5.0) */
const SHELL_OPACITY = 0.1;
/** 検出器の透過スポットの半径(L 単位) */
const CENTER_SPOT_RADIUS = 0.055;
/** 検出器のラベルの高さ(L 単位) */
const DETECTOR_LABEL_HEIGHT = 0.28;
/** 単結晶モードで描く逆格子点の方位(°)。図3 の初期値の近くにそろえる */
const SINGLE_PHI_DEG = 20;

const ARIA_LABEL =
  "3D 視点。左のビューをドラッグまたは矢印キーで回転、+ と − でズーム。" +
  "左が逆空間の作図、右は検出器を正面から見た環";

/** 単位円(x-y 平面、半径 1)の頂点列 */
function unitCirclePositions(): number[] {
  const out: number[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    out.push(Math.cos(t), Math.sin(t), 0);
  }
  return out;
}

export default function powderRingsWidget(host: FigureHost): WidgetHandle {
  const recipFill = matColor("recip");
  const beamFill = matColor("beam");
  const sphereFill = matColor("sphereFill");
  const sphereLine = matColor("sphereLine");
  const matrixFill = matColor("matrix");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");

  /* ---- 状態(§5.6) ---- */

  let lattice: CubicLattice = "sc";
  let lambda = LAMBDA_INIT;
  let ringIndex = 1; // 内側から何番目の環か(1 始まり)
  let powder = true;
  /** 現在の格子の環(λ には依存しない。λ で「測れるか」だけが変わる) */
  let rings: PowderRing[] = powderRings(lattice, A_NM, MAX_INDEX);

  /* ---- シーン(左 = オービット、右 = 固定カメラ — §5.0 の拡張) ---- */

  const kit = createMultiView(host, {
    dists: [DIST_RECIP, DIST_DETECTOR],
    fixed: [false, true],
    ariaLabel: ARIA_LABEL,
    onChange: () => host.requestRender(),
  });
  const recipScene = kit.scenes[0];
  const detectorScene = kit.scenes[1];

  /* -- 左: 逆空間 -- */

  const sphere = createEwaldSphere(sphereFill, sphereLine);
  recipScene.add(sphere.group);

  const shell = createShellSphere(matrixFill, SHELL_OPACITY);
  recipScene.add(shell.mesh);

  const circleGeom = new THREE.BufferGeometry();
  circleGeom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(unitCirclePositions()), 3),
  );

  // 球殻とエヴァルト球の交線(y-z 平面に立てるので y 軸まわりに 90° 回す)
  const intersectionMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(beamFill),
  });
  const intersection = new THREE.LineLoop(circleGeom, intersectionMat);
  intersection.rotation.y = Math.PI / 2;
  recipScene.add(intersection);

  const cone = createArrowBundle(
    CONE_ARROWS,
    beamFill,
    ARROW_SHAFT_RADIUS * 0.6,
  );
  recipScene.add(cone.group);

  const kArrow = createArrow3D(beamFill, ARROW_SHAFT_RADIUS);
  recipScene.add(kArrow.group);
  const incidentLine = createLineSegments([-1, 0, 0, 0, 0, 0], beamFill, 0.45);
  recipScene.add(incidentLine);

  // 単結晶モード(粉末 off)で見せる逆格子点
  const singlePoints = cubicReciprocalPoints(lattice, A_NM, MAX_INDEX);
  const singleGroup = new THREE.Group();
  singleGroup.rotation.y = SINGLE_PHI_DEG * (Math.PI / 180);
  recipScene.add(singleGroup);
  let singleCloud = createRecipCloud(
    singlePoints,
    RECIP_RADIUS,
    recipFill,
    ORIGIN_SCALE,
  );
  singleGroup.add(singleCloud.mesh);

  /* -- 右: 検出器 -- */

  const ringMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(beamFill),
    transparent: true,
    opacity: 0.4,
  });
  const selectedRingMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(beamFill),
  });
  const ringLoops: THREE.LineLoop[] = [];
  for (let i = 0; i < RING_CAPACITY; i++) {
    const loop = new THREE.LineLoop(circleGeom, ringMat);
    loop.visible = false;
    detectorScene.add(loop);
    ringLoops.push(loop);
  }

  // 透過スポット(検出器中心)
  const spotGeom = new THREE.CircleGeometry(CENTER_SPOT_RADIUS, 24);
  const spotMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(text2),
  });
  const spot = new THREE.Mesh(spotGeom, spotMat);
  detectorScene.add(spot);

  // キャリパー(中心から選択中の環へ引く半径線)
  const caliper = createLineSegments([0, 0, 0, 1, 0, 0], sphereLine, 1);
  detectorScene.add(caliper);
  // 検出器の目盛(0.5 L ごとの薄い十字)
  const detectorCross = createLineSegments(
    [
      -MAX_RING_RADIUS,
      0,
      0,
      MAX_RING_RADIUS,
      0,
      0,
      0,
      -MAX_RING_RADIUS,
      0,
      0,
      MAX_RING_RADIUS,
      0,
    ],
    hairline,
    1,
  );
  detectorScene.add(detectorCross);

  let ringLabel: THREE.Sprite | null = null;
  let ringLabelText = "";

  const tags = createPanelTags(host.stage, [TAG_RECIP, TAG_DETECTOR]);
  tags.update(kit.rects);

  /* ---- 読み取り値(§5.6) ---- */

  const readout = createReadout(host);
  const ringItem = readout.item("選択中の環", { color: "recip" });
  const twoThetaItem = readout.item("2θ");
  const measuredItem = readout.item("測った d = λ/(2 sinθ)");
  const formulaItem = readout.item("式の d = a/√(h²+k²+l²)");
  const radiusItem = readout.item("環の半径 / L");

  /* ---- 状態 → シーン ---- */

  /** 検出器に出る環(2θ が求まり、半径が上限内のもの)だけを返す */
  function measurableRings(): PowderRing[] {
    return rings.filter((r) => {
      const tt = twoThetaDeg(r.d, lambda);
      return tt !== null && ringRadiusOverL(tt) <= MAX_RING_RADIUS && tt < 90;
    });
  }

  function updateScene(): void {
    const radius = waveNumber(lambda);
    sphere.setRadius(radius);
    cone.setOrigin(radius);
    kArrow.group.position.set(-radius, 0, 0);
    kArrow.set(radius, 0, 0);
    const attr = incidentLine.geometry.getAttribute("position");
    const array = attr.array as Float32Array;
    array[0] = -radius - INCIDENT_DASH_LENGTH;
    array[3] = -radius;
    attr.needsUpdate = true;

    singleGroup.visible = !powder;
    shell.setVisible(powder);
    intersection.visible = powder;

    const visible = measurableRings();
    const selected = visible[Math.min(ringIndex, visible.length) - 1];

    // 検出器の環
    for (let i = 0; i < ringLoops.length; i++) {
      const ring = visible[i];
      const loop = ringLoops[i];
      if (!ring) {
        loop.visible = false;
        continue;
      }
      const tt = twoThetaDeg(ring.d, lambda) as number;
      const r = ringRadiusOverL(tt);
      loop.visible = true;
      loop.scale.setScalar(r);
      loop.material = ring === selected ? selectedRingMat : ringMat;
    }

    if (selected) {
      const tt = twoThetaDeg(selected.d, lambda) as number;
      const r = ringRadiusOverL(tt);
      // キャリパー(中心 → 環)
      caliper.visible = true;
      caliper.scale.set(r, 1, 1);
      // ラベル
      const text = formatHkl(selected.h, selected.k, selected.l);
      if (!ringLabel || ringLabelText !== text) {
        if (ringLabel) {
          ringLabel.material.map?.dispose();
          ringLabel.material.dispose();
          detectorScene.remove(ringLabel);
        }
        ringLabel = makeLabelSprite(text, beamFill, DETECTOR_LABEL_HEIGHT);
        detectorScene.add(ringLabel);
        ringLabelText = text;
      }
      ringLabel.visible = true;
      // ラベルは選択中の環のすぐ外側(+x 側)に置く
      ringLabel.position.set(r + 0.34, DETECTOR_LABEL_HEIGHT * 0.6, 0);

      // 左ビュー: 球殻と交線・円錐
      const G = selected.g;
      shell.setRadius(G);
      const x0 = -(G * G) / (2 * radius);
      const rho = Math.sqrt(Math.max(0, G * G - x0 * x0));
      intersection.position.set(x0, 0, 0);
      intersection.scale.setScalar(rho);
      for (let i = 0; i < CONE_ARROWS; i++) {
        const t = (2 * Math.PI * i) / CONE_ARROWS;
        cone.setArrow(i, x0, rho * Math.cos(t), rho * Math.sin(t));
      }
      // 単結晶モードでは球殻も交線も円錐も描かない
      cone.setCount(powder ? CONE_ARROWS : 0);
    } else {
      caliper.visible = false;
      if (ringLabel) ringLabel.visible = false;
      shell.setVisible(false);
      intersection.visible = false;
      cone.setCount(0);
    }

    updateReadout(selected);
  }

  function updateReadout(selected: PowderRing | undefined): void {
    if (!selected) {
      ringItem.set("—");
      twoThetaItem.set("この波長で出る環がありません");
      measuredItem.set("—");
      formulaItem.set("—");
      radiusItem.set("—");
      return;
    }
    const tt = twoThetaDeg(selected.d, lambda) as number;
    ringItem.set(
      `${formatHkl(selected.h, selected.k, selected.l)}(多重度 ${selected.multiplicity})`,
    );
    twoThetaItem.set(`${tt.toFixed(2)}°`);
    measuredItem.set(`${dFromTwoThetaDeg(tt, lambda).toFixed(4)} nm`);
    formulaItem.set(`${selected.d.toFixed(4)} nm`);
    radiusItem.set(ringRadiusOverL(tt).toFixed(3));
  }

  /** 格子を変えたら環の一覧・単結晶モードの点配列・ステッパの上限を作り直す */
  function rebuildLattice(): void {
    rings = powderRings(lattice, A_NM, MAX_INDEX);
    singleGroup.remove(singleCloud.mesh);
    singleCloud.dispose();
    singleCloud = createRecipCloud(
      cubicReciprocalPoints(lattice, A_NM, MAX_INDEX),
      RECIP_RADIUS,
      recipFill,
      ORIGIN_SCALE,
    );
    singleGroup.add(singleCloud.mesh);
    syncStepperMax();
  }

  /** 「測る環」ステッパの上限を、いま検出器に出ている環の本数に合わせる */
  function syncStepperMax(): void {
    ringStepper.setMax(Math.max(1, measurableRings().length));
  }

  /* ---- 操作部品(§5.6) ---- */

  const latticeControl = host.controls.segmented<CubicLattice>({
    id: "lattice",
    label: "格子",
    options: [
      { value: "sc", label: "単純立方" },
      { value: "bcc", label: "体心立方" },
      { value: "fcc", label: "面心立方" },
    ],
    value: "sc",
  });
  latticeControl.onChange((v) => {
    lattice = v;
    rebuildLattice();
    updateScene();
    host.requestRender();
  });

  const lambdaSlider = host.controls.slider({
    id: "lambda",
    label: "波長 λ",
    min: LAMBDA_MIN,
    max: LAMBDA_MAX,
    step: LAMBDA_STEP,
    value: LAMBDA_INIT,
    unit: "nm",
  });
  lambdaSlider.onChange((v) => {
    lambda = v;
    syncStepperMax();
    updateScene();
    host.requestRender();
  });

  const ringStepper = createStepper(host, {
    label: "測る環(内側から)",
    min: 1,
    max: RING_CAPACITY,
    value: 1,
  });
  ringStepper.onChange((v) => {
    ringIndex = v;
    updateScene();
    // 再描画はステッパ内部の host.requestRender() が要求する
  });

  const powderToggle = host.controls.toggle({
    id: "powder",
    label: "粉末にする(あらゆる方位の結晶)",
    value: true,
  });
  powderToggle.onChange((v) => {
    powder = v;
    updateScene();
    host.requestRender();
  });

  host.controls.reset(() => {
    latticeControl.set("sc");
    lambdaSlider.set(LAMBDA_INIT);
    ringStepper.set(1);
    powderToggle.set(true);
    kit.resetView();
  });

  /* ---- 初期化と描画登録(requestRender 型 — §5.6) ---- */

  host.onRender(() => kit.render());
  syncStepperMax();
  updateScene();

  return {
    resize(): void {
      kit.resize();
      tags.update(kit.rects);
    },
    destroy(): void {
      sphere.dispose();
      shell.dispose();
      cone.dispose();
      kArrow.dispose();
      incidentLine.geometry.dispose();
      caliper.geometry.dispose();
      detectorCross.geometry.dispose();
      circleGeom.dispose();
      intersectionMat.dispose();
      ringMat.dispose();
      selectedRingMat.dispose();
      spotGeom.dispose();
      spotMat.dispose();
      singleCloud.dispose();
      if (ringLabel) {
        ringLabel.material.map?.dispose();
        ringLabel.material.dispose();
      }
      tags.dispose();
      kit.dispose();
      readout.el.remove();
      ringStepper.el.remove();
    },
  };
}
