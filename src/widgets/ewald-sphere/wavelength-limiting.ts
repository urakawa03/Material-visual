/**
 * wavelength-limiting.ts — 図5「波長を変える」(仕様書 04 §5.5)
 *
 * λ を変えるとエヴァルト球の半径 1/λ が変わる。球は必ず原点 O を通るので、
 * 球面が到達しうる逆格子点は原点まわりの半径 2/λ の**限界球**の内側だけに
 * 限られる(式 E11: |g| ≤ 2/λ ⟺ d ≥ λ/2)。
 *
 * 「白色(連続波長)」に切り替えると、λ_min〜λ_max に対応する 2 つの球の
 * あいだの**殻**になり、静止した単結晶からでも多数の反射が同時に出る
 * (ラウエ法)。判定は殻の見た目ではなく、点ごとに条件を満たす波長
 * λ_hkl = −2 k̂·g/|g|²(式 E17)が範囲に入るかで行う。
 *
 * 簡略化(図注に明示): 連続スペクトルの強度分布は無視し、範囲内の波長を
 * 等価に扱っている。構造因子・強度は扱わない。
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
  createRecipAxes,
  createRecipCloud,
  createWireSphere,
} from "./_scene3d";
import {
  createReflectionScan,
  cubicReciprocalPoints,
  excitationError,
  lambdaForReflection,
  limitingRadius,
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
  MAX_INDEX,
  ORIGIN_SCALE,
  PHI_MAX,
  PHI_MIN,
  PHI_STEP,
  RECIP_RADIUS,
  TAG_RECIP,
} from "./constants";

/** カメラ距離。限界球(最大 2/0.12 ≈ 16.7 nm⁻¹)まで見渡せる距離 */
const DIST = 50;
/** 単色モードの λ の範囲・初期値(nm) */
const LAMBDA_MIN = 0.12;
const LAMBDA_MAX = 0.34;
const LAMBDA_STEP = 0.002;
const LAMBDA_INIT = 0.154;
/** 白色モードの λ_min / λ_max の範囲(nm)。範囲を重ねないので常に λ_min < λ_max */
const WHITE_MIN_LOW = 0.1;
const WHITE_MIN_HIGH = 0.2;
const WHITE_MIN_INIT = 0.12;
const WHITE_MAX_LOW = 0.22;
const WHITE_MAX_HIGH = 0.34;
const WHITE_MAX_INIT = 0.26;
/** 結晶方位(§5.5 の初期値)。χ はこの図では固定する */
const PHI_INIT = 20;
const CHI_FIXED = 10;
/** 結晶の厚さ(nm)。単色モードの許容幅は 1/t(図3 と同じ) */
const THICKNESS_NM = 12;
/** 限界球のワイヤの不透明度 */
const LIMIT_WIRE_OPACITY = 0.35;

const DEG = Math.PI / 180;

type Source = "mono" | "white";

export default function wavelengthLimiting(host: FigureHost): WidgetHandle {
  const recipFill = matColor("recip");
  const beamFill = matColor("beam");
  const sphereFill = matColor("sphereFill");
  const sphereLine = matColor("sphereLine");
  const hairline = uiColor("hairline");

  /* ---- 状態(§5.5) ---- */

  let source: Source = "mono";
  let lambda = LAMBDA_INIT;
  let lambdaMin = WHITE_MIN_INIT;
  let lambdaMax = WHITE_MAX_INIT;
  let phi = PHI_INIT;
  let showLimit = true;

  const points = cubicReciprocalPoints("sc", A_NM, MAX_INDEX);
  const scan = createReflectionScan(points);

  /** いま使っている「いちばん短い波長」(限界球の半径 2/λ を決める) */
  function shortestLambda(): number {
    return source === "mono" ? lambda : lambdaMin;
  }

  /* ---- シーン ---- */

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

  const highlights = createHighlightCloud(points.length, beamFill);
  kit.scene.add(highlights.mesh);

  // 単色モードの球 / 白色モードの殻の内側・外側(どちらも原点 O を通る)
  const sphereInner = createEwaldSphere(sphereFill, sphereLine);
  const sphereOuter = createEwaldSphere(sphereFill, sphereLine);
  kit.scene.add(sphereInner.group, sphereOuter.group);

  // 限界球(原点中心・半径 2/λ のワイヤ球 — 式 E11)
  const limitSphere = createWireSphere(hairline, LIMIT_WIRE_OPACITY);
  kit.scene.add(limitSphere.lines);

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

  const tags = createPanelTags(host.stage, [TAG_RECIP]);
  tags.update(kit.rects);

  /* ---- 読み取り値(§5.5) ---- */

  const readout = createReadout(host);
  const lambdaItem = readout.item("λ", { color: "beam" });
  const radiusItem = readout.item("球の半径 1/λ", { color: "sphere" });
  const limitItem = readout.item("限界球の半径 2/λ");
  const reachItem = readout.item("観測しうる点の数");
  const litItem = readout.item("点灯中の反射");
  const dMinItem = readout.item("測れる最小の d = λ/2");

  /* ---- 状態 → シーン ---- */

  const gTmp = { x: 0, y: 0, z: 0 };

  function updateScene(): void {
    const shortest = shortestLambda();
    const rLimit = limitingRadius(shortest);
    const rInner = waveNumber(source === "mono" ? lambda : lambdaMax);
    const rOuter = waveNumber(shortest);

    sphereInner.setRadius(rInner);
    sphereOuter.setRadius(rOuter);
    sphereOuter.setVisible(source === "white");
    limitSphere.setRadius(rLimit);
    limitSphere.setVisible(showLimit);

    // 入射波と回折波の起点は「いちばん長い波長の球」の中心にそろえる
    diffracted.setOrigin(rInner);
    kArrow.group.position.set(-rInner, 0, 0);
    kArrow.set(rInner, 0, 0);
    const attr = incidentLine.geometry.getAttribute("position");
    const array = attr.array as Float32Array;
    array[0] = -rInner - INCIDENT_DASH_LENGTH;
    array[3] = -rInner;
    attr.needsUpdate = true;

    applyOrientation(latticeGroup, phi * DEG, CHI_FIXED * DEG);
    const sMax = 1 / THICKNESS_NM;
    scan.update(phi * DEG, CHI_FIXED * DEG, (x, y, z, i) => {
      if (points[i].n2 === 0) return false;
      gTmp.x = x;
      gTmp.y = y;
      gTmp.z = z;
      if (source === "mono") {
        return Math.abs(excitationError(gTmp, rInner)) <= sMax;
      }
      // 白色: この点が球面に乗る波長が、光源の波長範囲に入っているか(式 E17)
      const need = lambdaForReflection(gTmp);
      return need !== null && need >= lambdaMin && need <= lambdaMax;
    });

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

    // 回折波の矢は、その点が実際に乗る球の中心から引く(白色では点ごとに違う)
    const arrowCount = Math.min(scan.count, DIFFRACTED_ARROW_MAX);
    for (let i = 0; i < arrowCount; i++) {
      const j = scan.indices[i];
      const x = scan.rotated[j * 3];
      const y = scan.rotated[j * 3 + 1];
      const z = scan.rotated[j * 3 + 2];
      if (source === "mono") {
        diffracted.setArrow(i, x, y, z);
      } else {
        gTmp.x = x;
        gTmp.y = y;
        gTmp.z = z;
        const need = lambdaForReflection(gTmp);
        diffracted.setArrow(
          i,
          x,
          y,
          z,
          need === null ? rInner : waveNumber(need),
        );
      }
    }
    diffracted.setCount(arrowCount);

    updateReadout(shortest, rInner, rLimit);
  }

  /** 限界球の内側にある(= 原理的に観測しうる)点の数 */
  function countReachable(rLimit: number): number {
    let n = 0;
    for (const p of points) {
      if (p.n2 > 0 && p.len <= rLimit) n++;
    }
    return n;
  }

  function updateReadout(
    shortest: number,
    rInner: number,
    rLimit: number,
  ): void {
    if (source === "mono") {
      lambdaItem.set(`${lambda.toFixed(3)} nm`);
      radiusItem.set(`${rInner.toFixed(2)} nm⁻¹`);
    } else {
      lambdaItem.set(`${lambdaMin.toFixed(3)}〜${lambdaMax.toFixed(3)} nm`);
      radiusItem.set(
        `${rInner.toFixed(2)}〜${waveNumber(lambdaMin).toFixed(2)} nm⁻¹(殻)`,
      );
    }
    limitItem.set(`${rLimit.toFixed(2)} nm⁻¹`);
    reachItem.set(`${countReachable(rLimit)} 個`);
    litItem.set(`${scan.count} 個`);
    dMinItem.set(`${(shortest / 2).toFixed(3)} nm`);
  }

  /* ---- 操作部品(§5.5) ---- */

  const sourceControl = host.controls.segmented<Source>({
    id: "source",
    label: "光源",
    options: [
      { value: "mono", label: "単色" },
      { value: "white", label: "白色(連続波長)" },
    ],
    value: "mono",
  });
  sourceControl.onChange((v) => {
    source = v;
    updateSliderVisibility();
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

  const minSlider = host.controls.slider({
    id: "lambdaMin",
    label: "最短波長 λ_min",
    min: WHITE_MIN_LOW,
    max: WHITE_MIN_HIGH,
    step: LAMBDA_STEP,
    value: WHITE_MIN_INIT,
    unit: "nm",
  });
  minSlider.onChange((v) => {
    lambdaMin = v;
    updateScene();
    host.requestRender();
  });

  const maxSlider = host.controls.slider({
    id: "lambdaMax",
    label: "最長波長 λ_max",
    min: WHITE_MAX_LOW,
    max: WHITE_MAX_HIGH,
    step: LAMBDA_STEP,
    value: WHITE_MAX_INIT,
    unit: "nm",
  });
  maxSlider.onChange((v) => {
    lambdaMax = v;
    updateScene();
    host.requestRender();
  });

  /** モードに応じて波長スライダーを出し分ける(不要な操作を出さない) */
  function updateSliderVisibility(): void {
    const mono = source === "mono";
    lambdaSlider.el.style.display = mono ? "" : "none";
    minSlider.el.style.display = mono ? "none" : "";
    maxSlider.el.style.display = mono ? "none" : "";
  }

  const phiSlider = host.controls.slider({
    id: "phi",
    label: "結晶の向き φ",
    min: PHI_MIN,
    max: PHI_MAX,
    step: PHI_STEP,
    value: PHI_INIT,
    unit: "°",
  });
  phiSlider.onChange((v) => {
    phi = v;
    updateScene();
    host.requestRender();
  });

  const limitToggle = host.controls.toggle({
    id: "limit",
    label: "限界球を表示",
    value: true,
  });
  limitToggle.onChange((v) => {
    showLimit = v;
    limitSphere.setVisible(v);
    host.requestRender();
  });

  host.controls.reset(() => {
    sourceControl.set("mono");
    lambdaSlider.set(LAMBDA_INIT);
    minSlider.set(WHITE_MIN_INIT);
    maxSlider.set(WHITE_MAX_INIT);
    phiSlider.set(PHI_INIT);
    limitToggle.set(true);
    kit.resetView();
  });

  /* ---- 初期化と描画登録(requestRender 型 — §5.5) ---- */

  host.onRender(() => kit.render());
  updateSliderVisibility();
  updateScene();

  return {
    resize(): void {
      kit.resize();
      tags.update(kit.rects);
    },
    destroy(): void {
      sphereInner.dispose();
      sphereOuter.dispose();
      limitSphere.dispose();
      kArrow.dispose();
      incidentLine.geometry.dispose();
      diffracted.dispose();
      axes.dispose();
      cloud.dispose();
      highlights.dispose();
      tags.dispose();
      kit.dispose();
      readout.el.remove();
    },
  };
}
