/**
 * construction.ts — 図3「球を描く」(仕様書 04 §5.3・中心図版)
 *
 * 逆空間に、単純立方の逆格子点(|h|,|k|,|l| ≤ 3)と、半径 1/λ・中心
 * C = −k = (−1/λ, 0, 0) のエヴァルト球を描く(式 E9)。球は必ず原点 O を
 * 通る。**球面に乗った逆格子点だけが回折する** — 初期状態(φ = χ = 0)では
 * 1 点も乗っておらず、読者が結晶方位を回して初めて反射が点灯する。
 *
 * 「厳密に球面に乗る点などあるのか」という当然の疑問には、結晶が有限の
 * 厚さ t をもつために逆格子点が ±1/t 程度に広がっている(励起誤差の許容、
 * 式 E12)と答え、スライダー「結晶の厚さ t」で体感させる。これは幾何を
 * 甘くする便法ではなく、実際に起きていることである(§5.3)。
 *
 * three.js は _shared3d(前提記事)経由でのみ import する。描画は
 * requestRender 型で、パラメータ変更・視点変更のときだけ 1 フレーム描く。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { matColor, uiColor } from "../../core/colors";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  THREE,
  createArrow3D,
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
  nearestToSphere,
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

/** カメラ距離。逆格子(±7.5 nm⁻¹)と λ = 0.154 nm の球(x ∈ [−13, 0])が
 * FOV 40° に収まる距離。λ を短くしたときは − キー/ピンチで引ける */
const DIST = 38;
/** 波長 λ の初期値(Cu Kα) */
const LAMBDA_INIT = 0.154;
/** 結晶の厚さ t の範囲・初期値(nm)。許容幅は 1/t(式 E12) */
const T_MIN = 5;
const T_MAX = 40;
const T_INIT = 12;
/** 「いちばん近い反射に合わせる」の探索範囲と刻み(°) */
const SNAP_RANGE_DEG = 60;
const SNAP_STEP_DEG = 0.05;

const DEG = Math.PI / 180;

export default function construction(host: FigureHost): WidgetHandle {
  // 色は初期化時に一度だけ解決する(母体仕様 §6.2)
  const recipFill = matColor("recip");
  const beamFill = matColor("beam");
  const sphereFill = matColor("sphereFill");
  const sphereLine = matColor("sphereLine");
  const hairline = uiColor("hairline");

  /* ---- 状態(§5.3) ---- */

  let phi = 0; // 結晶の向き(°)
  let chi = 0; // 結晶の傾き(°)
  let lambda = LAMBDA_INIT; // 波長(nm)
  let thickness = T_INIT; // 結晶の厚さ(nm)
  let showSphere = true;

  const points = cubicReciprocalPoints("sc", A_NM, MAX_INDEX);
  const scan = createReflectionScan(points);

  /* ---- シーン(単一ビュー + 連動オービット — §5.0) ---- */

  const kit = createSingleView(host, {
    dist: DIST,
    ariaLabel: ARIA_LABEL_3D,
    onChange: () => host.requestRender(),
  });

  // 逆格子(結晶方位で回る側)
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

  // 点灯した反射のマーカー。位置は結晶方位を適用した座標を毎更新で直接
  // 書き込むので、latticeGroup ではなくシーン直下に置く(§5.0)
  const highlights = createHighlightCloud(points.length, beamFill);
  kit.scene.add(highlights.mesh);

  // エヴァルト球
  const sphere = createEwaldSphere(sphereFill, sphereLine);
  kit.scene.add(sphere.group);

  // 入射波 k(C → O)と、その手前の入射ビーム(破線相当の細線)
  const kArrow = createArrow3D(beamFill, ARROW_SHAFT_RADIUS);
  kit.scene.add(kArrow.group);
  const incidentLine = createLineSegments([-1, 0, 0, 0, 0, 0], beamFill, 0.45);
  kit.scene.add(incidentLine);

  // 回折波 k′ の束(C 起点)と (h k l) ラベル
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

  /* ---- 読み取り値(§5.3) ---- */

  const readout = createReadout(host);
  const lambdaItem = readout.item("λ", { color: "beam" });
  const radiusItem = readout.item("球の半径 1/λ", { color: "sphere" });
  const litItem = readout.item("点灯中の反射");
  const nearestItem = readout.item("最寄りの反射", { color: "recip" });
  const toleranceItem = readout.item("許容幅 1/t");

  /* ---- 状態 → シーン ---- */

  /** いま点灯している反射を数え直し、マーカー・矢・ラベルを更新する */
  function updateScene(): void {
    const radius = waveNumber(lambda);
    const sMax = 1 / thickness;
    sphere.setRadius(radius);
    sphere.setVisible(showSphere);
    diffracted.setOrigin(radius);
    // 入射ビーム: C の手前から C まで(線分の位置を直接書き換える)
    setIncidentLine(radius);
    kArrow.group.position.set(-radius, 0, 0);
    kArrow.set(radius, 0, 0);

    applyOrientation(latticeGroup, phi * DEG, chi * DEG);
    const gTmp = { x: 0, y: 0, z: 0 };
    scan.update(phi * DEG, chi * DEG, (x, y, z, i) => {
      if (points[i].n2 === 0) return false; // 原点は常に球面上だが反射ではない
      gTmp.x = x;
      gTmp.y = y;
      gTmp.z = z;
      return Math.abs(excitationError(gTmp, radius)) <= sMax;
    });

    // 点灯マーカー
    for (let i = 0; i < scan.count; i++) {
      const j = scan.indices[i];
      highlights.setAtom(
        i,
        scan.rotated[j * 3],
        scan.rotated[j * 3 + 1],
        scan.rotated[j * 3 + 2],
      );
    }
    highlights.mesh.count = scan.count;
    highlights.commit();

    // 回折波の矢とラベル(見やすさのため本数を絞る — §5.3)
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

    updateReadout(radius, sMax);
  }

  /** 入射ビームの線分を C の手前から C まで引き直す */
  function setIncidentLine(radius: number): void {
    const attr = incidentLine.geometry.getAttribute("position");
    const array = attr.array as Float32Array;
    array[0] = -radius - INCIDENT_DASH_LENGTH;
    array[3] = -radius;
    attr.needsUpdate = true;
  }

  function updateReadout(radius: number, sMax: number): void {
    lambdaItem.set(`${lambda.toFixed(3)} nm`);
    radiusItem.set(`${radius.toFixed(2)} nm⁻¹`);
    litItem.set(scan.count === 0 ? "0(何も光らない)" : `${scan.count} 個`);
    toleranceItem.set(`${sMax.toFixed(3)} nm⁻¹`);
    const near = nearestToSphere(scan, points, radius);
    if (near.index < 0) {
      nearestItem.set("—");
      return;
    }
    const p = points[near.index];
    nearestItem.set(
      `${formatHkl(p.h, p.k, p.l)}  s = ${near.s >= 0 ? "+" : ""}${near.s.toFixed(3)} nm⁻¹`,
    );
  }

  /**
   * φ を細かく走査して、いちばん近い反射が球面に乗る角度を探す(§5.3)。
   * 「そもそも当たりを引けない」読者のための近道で、キーボードでも押せる。
   */
  function snapToNearest(): void {
    const radius = waveNumber(lambda);
    let bestPhi = phi;
    let bestAbs = Infinity;
    for (
      let delta = -SNAP_RANGE_DEG;
      delta <= SNAP_RANGE_DEG;
      delta += SNAP_STEP_DEG
    ) {
      const candidate = phi + delta;
      scan.update(candidate * DEG, chi * DEG, () => false);
      const near = nearestToSphere(scan, points, radius);
      if (near.index >= 0 && Math.abs(near.s) < bestAbs) {
        bestAbs = Math.abs(near.s);
        bestPhi = candidate;
      }
    }
    // set() が onChange 経由でシーンと読み取り値を更新する
    phiSlider.set(
      Math.max(
        PHI_MIN,
        Math.min(PHI_MAX, Math.round(bestPhi / PHI_STEP) * PHI_STEP),
      ),
    );
  }

  /* ---- 操作部品(§5.3) ---- */

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
    phi = v;
    updateScene();
    host.requestRender();
  });

  const chiSlider = host.controls.slider({
    id: "chi",
    label: "結晶の傾き χ",
    min: -90,
    max: 90,
    step: PHI_STEP,
    value: 0,
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
    updateScene();
    host.requestRender();
  });

  const thicknessSlider = host.controls.slider({
    id: "t",
    label: "結晶の厚さ t",
    min: T_MIN,
    max: T_MAX,
    step: 1,
    value: T_INIT,
    unit: "nm",
  });
  thicknessSlider.onChange((v) => {
    thickness = v;
    updateScene();
    host.requestRender();
  });

  const sphereToggle = host.controls.toggle({
    id: "sphere",
    label: "球を表示",
    value: true,
  });
  sphereToggle.onChange((v) => {
    showSphere = v;
    sphere.setVisible(v);
    host.requestRender();
  });

  const snapButton = host.controls.button({
    label: "いちばん近い反射に合わせる",
  });
  snapButton.onClick(snapToNearest);

  host.controls.reset(() => {
    phiSlider.set(0);
    chiSlider.set(0);
    lambdaSlider.set(LAMBDA_INIT);
    thicknessSlider.set(T_INIT);
    sphereToggle.set(true);
    kit.resetView();
  });

  /* ---- 初期化と描画登録(requestRender 型 — §5.3) ---- */

  host.onRender(() => kit.render());
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
      tags.dispose();
      kit.dispose();
      readout.el.remove();
    },
  };
}
