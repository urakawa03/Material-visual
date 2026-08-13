/**
 * rotation-method.ts — 図4「結晶を回す」(仕様書 04 §5.4)
 *
 * 図3 と同じ作図のまま、結晶方位 φ を時間とともに進める。逆格子が回り、
 * 点が次々とエヴァルト球の面を横切る。**横切った一瞬だけ反射が光る** —
 * 回折は「常に起きている」のではなく「条件を満たした一瞬に起きる」という
 * 感覚を作るのがこの図の目的。
 *
 * 光っている時間に幅があるのは、結晶が有限の厚さ t をもち、逆格子点が
 * およそ 1/t だけ広がっているからである(式 E12。§5.3 の続き)。
 *
 * 一度点灯した反射は記録として残す(逆格子側に付くので、結晶と一緒に回る)。
 * 実装方式は onFrame(本記事で唯一の連続アニメ図版 — §5.0)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  THREE,
  createArrow3D,
  createInstancedAtoms,
  createLineSegments,
  createPanelTags,
  createSingleView,
} from "../reciprocal-lattice/_shared3d";
import {
  applyOrientation,
  createArrowBundle,
  createEwaldSphere,
  createHighlightCloud,
  createLabelPool,
  createRecipAxes,
  createRecipCloud,
} from "./_scene3d";
import {
  createReflectionScan,
  cubicReciprocalPoints,
  excitationError,
  waveNumber,
} from "./ewald";
import {
  A_NM,
  ARIA_LABEL_3D,
  ARROW_SHAFT_RADIUS,
  AXIS_HALF,
  AXIS_LABEL_HEIGHT,
  DIFFRACTED_ARROW_MAX,
  INCIDENT_DASH_LENGTH,
  LABEL_HEIGHT,
  LABEL_MAX,
  LAMBDA_MAX,
  LAMBDA_MIN,
  LAMBDA_STEP,
  MAX_INDEX,
  ORIGIN_SCALE,
  PHI_MAX,
  PHI_MIN,
  PHI_STEP,
  RECIP_RADIUS,
  TAG_RECIP,
  formatHkl,
} from "./constants";

/** カメラ距離(図3 と同じ) */
const DIST = 38;
/** 波長 λ の初期値(Cu Kα) */
const LAMBDA_INIT = 0.154;
/** 回転速度の範囲・初期値(°/s — §5.4) */
const SPEED_MIN = 0;
const SPEED_MAX = 60;
const SPEED_INIT = 12;
/** 結晶の傾き χ の初期値(°)。軸対称すぎる配置を避ける(§5.4) */
const CHI_INIT = 10;
/** 結晶の厚さ t(nm)。図3 の初期値と同じ。許容幅は 1/t */
const THICKNESS_NM = 12;
/** 記録マーカーの拡大率(点灯マーカーより控えめにする) */
const RECORD_SCALE = 1.25;

const DEG = Math.PI / 180;

/** φ を (−180, 180] に折り返す */
function wrapAngle(deg: number): number {
  const wrapped = (((deg + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

export default function rotationMethod(host: FigureHost): WidgetHandle {
  const recipFill = matColor("recip");
  const beamFill = matColor("beam");
  const sphereFill = matColor("sphereFill");
  const sphereLine = matColor("sphereLine");
  const hairline = uiColor("hairline");

  /* ---- 状態(§5.4) ---- */

  let phi = 0; // 結晶の向き(°)
  let chi = CHI_INIT; // 結晶の傾き(°)
  let lambda = LAMBDA_INIT; // 波長(nm)
  let speed = SPEED_INIT; // 回転速度(°/s)
  let recording = true;
  /** φ スライダーを自前で追従させている最中(onChange の二重実行を防ぐ) */
  let syncingSlider = false;

  const points = cubicReciprocalPoints("sc", A_NM, MAX_INDEX);
  const scan = createReflectionScan(points);
  /** 一度でも点灯した反射(points の添字) */
  const recorded = new Set<number>();
  /** 直近に点灯した反射の表示文字列(変化したときだけ組み立てる) */
  let lastLitLabel = "—";
  let prevLitTop = -1;

  /* ---- シーン(図3 と同じ構成 — §5.4) ---- */

  const kit = createSingleView(host, {
    dist: DIST,
    ariaLabel: ARIA_LABEL_3D,
    onChange: () => host.requestRender(),
  });

  const latticeGroup = new THREE.Group();
  kit.scene.add(latticeGroup);
  const cloud = createRecipCloud(points, RECIP_RADIUS, recipFill, ORIGIN_SCALE);
  latticeGroup.add(cloud.mesh);
  const axes = createRecipAxes(
    AXIS_HALF,
    hairline,
    recipFill,
    AXIS_LABEL_HEIGHT,
  );
  latticeGroup.add(axes.group);

  // 記録マーカーは逆格子側に付ける(結晶と一緒に回る — §5.4)
  const recordMarks = createInstancedAtoms(
    points.length,
    RECIP_RADIUS * RECORD_SCALE,
    beamFill,
  );
  recordMarks.mesh.count = 0;
  latticeGroup.add(recordMarks.mesh);

  const highlights = createHighlightCloud(points.length, beamFill);
  kit.scene.add(highlights.mesh);

  const sphere = createEwaldSphere(sphereFill, sphereLine);
  kit.scene.add(sphere.group);

  const kArrow = createArrow3D(beamFill, ARROW_SHAFT_RADIUS);
  kit.scene.add(kArrow.group);
  const incidentLine = createLineSegments([-1, 0, 0, 0, 0, 0], beamFill, 0.45);
  kit.scene.add(incidentLine);

  const diffracted = createArrowBundle(
    DIFFRACTED_ARROW_MAX,
    beamFill,
    ARROW_SHAFT_RADIUS * 0.8,
  );
  kit.scene.add(diffracted.group);
  const labels = createLabelPool(LABEL_MAX, beamFill, LABEL_HEIGHT);
  kit.scene.add(labels.group);

  const tags = createPanelTags(host.stage, [TAG_RECIP]);
  tags.update(kit.rects);

  /* ---- 読み取り値(§5.4) ---- */

  const readout = createReadout(host);
  const phiItem = readout.item("φ");
  const litItem = readout.item("点灯中");
  const recordedItem = readout.item("記録済み");
  const lastItem = readout.item("直近に点灯した反射", { color: "recip" });

  /* ---- 状態 → シーン ---- */

  const gTmp = { x: 0, y: 0, z: 0 };

  /** 球・入射波など λ にだけ依存する部分を更新する */
  function updateWave(): void {
    const radius = waveNumber(lambda);
    sphere.setRadius(radius);
    diffracted.setOrigin(radius);
    kArrow.group.position.set(-radius, 0, 0);
    kArrow.set(radius, 0, 0);
    const attr = incidentLine.geometry.getAttribute("position");
    const array = attr.array as Float32Array;
    array[0] = -radius - INCIDENT_DASH_LENGTH;
    array[3] = -radius;
    attr.needsUpdate = true;
  }

  /** 結晶方位に応じて点灯集合・記録・矢・ラベル・読み取り値を更新する */
  function updateScene(): void {
    const radius = waveNumber(lambda);
    const sMax = 1 / THICKNESS_NM;
    applyOrientation(latticeGroup, phi * DEG, chi * DEG);
    scan.update(phi * DEG, chi * DEG, (x, y, z, i) => {
      if (points[i].n2 === 0) return false;
      gTmp.x = x;
      gTmp.y = y;
      gTmp.z = z;
      return Math.abs(excitationError(gTmp, radius)) <= sMax;
    });

    for (let i = 0; i < scan.count; i++) {
      const j = scan.indices[i];
      highlights.setAtom(
        i,
        scan.rotated[j * 3],
        scan.rotated[j * 3 + 1],
        scan.rotated[j * 3 + 2],
      );
      if (recording) recorded.add(j);
    }
    highlights.mesh.count = scan.count;
    highlights.commit();

    const arrowCount = Math.min(scan.count, DIFFRACTED_ARROW_MAX);
    for (let i = 0; i < arrowCount; i++) {
      const j = scan.indices[i];
      diffracted.setArrow(
        i,
        scan.rotated[j * 3],
        scan.rotated[j * 3 + 1],
        scan.rotated[j * 3 + 2],
      );
    }
    diffracted.setCount(arrowCount);

    const labelCount = Math.min(scan.count, LABEL_MAX);
    for (let i = 0; i < labelCount; i++) {
      const j = scan.indices[i];
      const p = points[j];
      labels.show(
        i,
        formatHkl(p.h, p.k, p.l),
        scan.rotated[j * 3] * 1.06,
        scan.rotated[j * 3 + 1] * 1.06 + LABEL_HEIGHT,
        scan.rotated[j * 3 + 2] * 1.06,
      );
    }
    labels.setCount(labelCount);

    rebuildRecordMarks();

    // 文字列の組み立ては点灯集合が変わったときだけ(毎フレームの連結を避ける)
    const top = scan.count > 0 ? scan.indices[0] : -1;
    if (top !== prevLitTop) {
      prevLitTop = top;
      if (top >= 0) {
        const p = points[top];
        lastLitLabel = formatHkl(p.h, p.k, p.l);
      }
    }
    updateReadout();
  }

  /** 記録マーカーの位置(未回転の逆格子座標)を並べ直す */
  function rebuildRecordMarks(): void {
    if (recordMarks.mesh.count === recorded.size) return;
    let i = 0;
    for (const j of recorded) {
      const g = points[j].g;
      recordMarks.setAtom(i++, g.x, g.y, g.z);
    }
    recordMarks.mesh.count = recorded.size;
    recordMarks.commit();
  }

  function updateReadout(): void {
    phiItem.set(`${phi.toFixed(1)}°`);
    litItem.set(
      scan.count === 0 ? "0(いまは光っていない)" : `${scan.count} 個`,
    );
    recordedItem.set(`${recorded.size} 個`);
    lastItem.set(lastLitLabel);
  }

  /* ---- 操作部品(§5.4) ---- */

  const speedSlider = host.controls.slider({
    id: "speed",
    label: "回転速度",
    min: SPEED_MIN,
    max: SPEED_MAX,
    step: 1,
    value: SPEED_INIT,
    unit: "°/s",
  });
  speedSlider.onChange((v) => {
    speed = v;
  });

  const phiSlider = host.controls.slider({
    id: "phi",
    label: "結晶の向き φ",
    min: PHI_MIN,
    max: PHI_MAX,
    step: PHI_STEP,
    value: 0,
    unit: "°",
  });
  phiSlider.onChange((v) => {
    if (syncingSlider) return; // 再生中の追従表示。ユーザー操作ではない
    phi = v;
    host.setPlaying(false); // 手で送りはじめたら自動回転を止める(§5.4)
    updateScene();
    host.requestRender();
  });

  const chiSlider = host.controls.slider({
    id: "chi",
    label: "結晶の傾き χ",
    min: -90,
    max: 90,
    step: PHI_STEP,
    value: CHI_INIT,
    unit: "°",
  });
  chiSlider.onChange((v) => {
    chi = v;
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
    updateWave();
    updateScene();
    host.requestRender();
  });

  const recordToggle = host.controls.toggle({
    id: "record",
    label: "記録を残す",
    value: true,
  });
  recordToggle.onChange((v) => {
    recording = v;
    if (!v) {
      recorded.clear();
      recordMarks.mesh.count = 0;
      updateReadout();
    }
    host.requestRender();
  });

  host.controls.playPause();
  host.controls.reset(() => {
    recorded.clear();
    recordMarks.mesh.count = 0;
    lastLitLabel = "—";
    prevLitTop = -1;
    speedSlider.set(SPEED_INIT);
    chiSlider.set(CHI_INIT);
    lambdaSlider.set(LAMBDA_INIT);
    recordToggle.set(true);
    phiSlider.set(0);
    kit.resetView();
    host.setPlaying(true);
  });

  /* ---- フレーム(onFrame 型 — §5.4) ---- */

  host.onFrame((dt) => {
    if (speed !== 0) {
      phi = wrapAngle(phi + speed * dt);
      syncingSlider = true;
      phiSlider.set(phi); // 表示の追従(onChange は syncingSlider で抑止)
      syncingSlider = false;
    }
    updateScene();
    kit.render();
  });

  /* ---- 初期化 ---- */

  updateWave();
  updateScene();

  return {
    resize(): void {
      kit.resize();
      tags.update(kit.rects);
    },
    destroy(): void {
      sphere.dispose();
      kArrow.dispose();
      incidentLine.geometry.dispose();
      diffracted.dispose();
      labels.dispose();
      axes.dispose();
      cloud.dispose();
      highlights.dispose();
      recordMarks.dispose();
      tags.dispose();
      kit.dispose();
      readout.el.remove();
    },
  };
}
