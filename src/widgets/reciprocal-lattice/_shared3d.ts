/**
 * _shared3d.ts — 記事「逆格子空間」3D 図版(図6・図7)の共通ヘルパ
 * (仕様書 05 §5.0・§5.6・§5.7)
 *
 * 重要: three.js の import はこのモジュールの内部に閉じる(§5.0)。
 * 図6・図7 のモジュールだけがここを参照し、それらは registry の動的
 * import 経由でのみ読み込まれるため、2D 図版のチャンクに three は
 * 1 バイトも混入しない。
 *
 * 提供するもの:
 * - 単一 canvas を左右(狭幅では上下)2 ビューポートに分割する scissor
 *   描画のシーン雛形(白背景・半球光 + 弱い平行光 — §6.5)
 * - 両ビューポートで連動するオービット(ドラッグ + 慣性 + ピンチ/ホイール
 *   ズーム + キーボード: 矢印 3°/押下・+/− 10% ズーム — §5.6)。
 *   描画はダーティ方式: 変化があったときだけ onChange → requestRender で
 *   1 フレーム描き、静止時の GPU 消費はゼロ(§5.6)。慣性はヘルパ内部の
 *   rAF で進め、prefers-reduced-motion では慣性を使わない
 * - ラベルスプライト・3D 矢印・ポリゴン束(面束)・線分群・パネルの単位
 *   ラベルなどの小物
 */

import * as THREE from "three";
import type { FigureHost } from "../types";
import type { Vec3 } from "../../core/mathx";
import { clamp } from "../../core/mathx";

export { THREE };
export {
  createInstancedAtoms,
  type InstancedAtoms,
} from "../../core/three-helpers";

/* ---------------------------------------------------------------- 定数 */

const CAMERA_FOV_DEG = 40;
const CAMERA_NEAR = 0.01;
const CAMERA_FAR = 1000;
/** 半球光(three-helpers と同じ値 — §6.5) */
const HEMI_SKY = 0xffffff;
const HEMI_GROUND = 0xdde3ea;
const HEMI_INTENSITY = 1.1;
const DIR_INTENSITY = 0.5;
/** ビューポート間の隙間(CSS px) */
const VIEW_GAP = 16;
/** 横並びと判定するアスペクト比の下限(_shared2d と同じ) */
const SIDE_BY_SIDE_MIN_ASPECT = 1.25;
/** ドラッグ回転の感度(rad / px) */
const ROTATE_SPEED = 0.005;
/** 慣性の減衰(1/s) */
const INERTIA_DECAY = 6;
/** 慣性を打ち切る角速度(rad/s) */
const MIN_VELOCITY = 0.02;
/** キーボード: 矢印 1 押下の回転角(§5.6) */
const KEY_ROTATE_DEG = 3;
/** キーボード: +/− 1 押下のズーム率(§5.6) */
const KEY_ZOOM_FACTOR = 1.1;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.5;
/** 仰角の制限(±80° — §5.6) */
const ELEVATION_MAX_DEG = 80;

const DEG = Math.PI / 180;

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ------------------------------------------------- オービット(視点操作) */

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** オービットが動かすカメラと、その基準距離 */
interface OrbitTarget {
  cam: THREE.PerspectiveCamera;
  dist: number;
}

interface OrbitOptions {
  /** 初期方位角(度)。既定 30(§5.6) */
  azimuthDeg?: number;
  /** 初期仰角(度)。既定 20(§5.6) */
  elevationDeg?: number;
  /** 視点変更時に呼ばれる(host.requestRender を渡すこと) */
  onChange: () => void;
  /** stage の aria-label(キーボード視点操作の説明) */
  ariaLabel: string;
  /** ポインタ操作を受けるキャンバス(既定 host.canvas) */
  canvas?: HTMLCanvasElement;
}

interface OrbitController {
  /** 現在の角度・ズームをカメラへ反映する */
  apply(): void;
  /** 初期の視点へ戻す */
  reset(): void;
  dispose(): void;
}

/**
 * ドラッグ(慣性つき)・ピンチ / ホイールズーム・キーボードによる視点操作。
 * 単一ビュー(createSingleView)と 2 ビュー(createDualView)で共用する。
 * 描画はダーティ方式で、変化があったときだけ onChange を呼ぶ(§5.6)。
 */
function createOrbit(
  host: FigureHost,
  targets: readonly OrbitTarget[],
  opts: OrbitOptions,
): OrbitController {
  const canvas = opts.canvas ?? host.canvas;
  const az0 = (opts.azimuthDeg ?? 30) * DEG;
  const el0 = (opts.elevationDeg ?? 20) * DEG;
  let azimuth = az0;
  let elevation = el0;
  let zoom = 1;
  let velAz = 0;
  let velEl = 0;

  const applyCameras = (): void => {
    const ce = Math.cos(elevation);
    const se = Math.sin(elevation);
    const sa = Math.sin(azimuth);
    const ca = Math.cos(azimuth);
    for (const t of targets) {
      const d = t.dist * zoom;
      t.cam.position.set(d * ce * sa, d * se, d * ce * ca);
      t.cam.lookAt(0, 0, 0);
    }
  };

  const rotate = (dAz: number, dEl: number): void => {
    azimuth += dAz;
    elevation = clamp(
      elevation + dEl,
      -ELEVATION_MAX_DEG * DEG,
      ELEVATION_MAX_DEG * DEG,
    );
    applyCameras();
    opts.onChange();
  };

  const zoomBy = (factor: number): void => {
    zoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
    applyCameras();
    opts.onChange();
  };

  /* ---- 慣性(内部 rAF。静止したら完全に止まる) ---- */
  let inertiaRaf = 0;
  let inertiaLast = 0;
  const inertiaTick = (ts: number): void => {
    inertiaRaf = 0;
    const dt = Math.min((ts - inertiaLast) / 1000, 0.05);
    inertiaLast = ts;
    const speed = Math.hypot(velAz, velEl);
    if (speed < MIN_VELOCITY) return;
    rotate(velAz * dt, velEl * dt);
    const decay = Math.exp(-INERTIA_DECAY * dt);
    velAz *= decay;
    velEl *= decay;
    inertiaRaf = requestAnimationFrame(inertiaTick);
  };
  const startInertia = (): void => {
    if (prefersReducedMotion()) return; // 省モーションでは慣性を使わない
    if (inertiaRaf === 0) {
      inertiaLast = performance.now();
      inertiaRaf = requestAnimationFrame(inertiaTick);
    }
  };
  const stopInertia = (): void => {
    if (inertiaRaf !== 0) {
      cancelAnimationFrame(inertiaRaf);
      inertiaRaf = 0;
    }
  };

  /* ---- ポインタ操作(タッチ・マウス両対応) ---- */
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinchDist = 0;

  const pinchDistance = (): number => {
    if (pointers.size < 2) return 0;
    const pts = [...pointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const down = (e: PointerEvent): void => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velAz = 0;
      velEl = 0;
      stopInertia();
    } else if (pointers.size === 2) {
      dragging = false;
      pinchDist = pinchDistance();
    }
    e.preventDefault();
  };
  const move = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1 && dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      rotate(-dx * ROTATE_SPEED, dy * ROTATE_SPEED);
      velAz = -dx * ROTATE_SPEED * 60;
      velEl = dy * ROTATE_SPEED * 60;
    } else if (pointers.size === 2) {
      const d = pinchDistance();
      if (pinchDist > 0 && d > 0) {
        zoomBy(pinchDist / d);
        pinchDist = d;
      }
    }
  };
  const up = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (dragging) startInertia();
      dragging = false;
    }
    if (pointers.size < 2) pinchDist = 0;
  };
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.001));
  };

  /* ---- キーボード視点操作(stage 自体をフォーカス対象にする — §5.6) ---- */
  host.stage.tabIndex = 0;
  host.stage.setAttribute("role", "application");
  host.stage.setAttribute("aria-label", opts.ariaLabel);
  const keydown = (e: KeyboardEvent): void => {
    const step = KEY_ROTATE_DEG * DEG;
    switch (e.key) {
      case "ArrowLeft":
        rotate(step, 0);
        break;
      case "ArrowRight":
        rotate(-step, 0);
        break;
      case "ArrowUp":
        rotate(0, step);
        break;
      case "ArrowDown":
        rotate(0, -step);
        break;
      case "+":
      case "=":
        zoomBy(1 / KEY_ZOOM_FACTOR);
        break;
      case "-":
      case "_":
        zoomBy(KEY_ZOOM_FACTOR);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  host.stage.addEventListener("keydown", keydown);

  applyCameras();

  return {
    apply: applyCameras,
    reset(): void {
      azimuth = az0;
      elevation = el0;
      zoom = 1;
      velAz = 0;
      velEl = 0;
      stopInertia();
      applyCameras();
      opts.onChange();
    },
    dispose(): void {
      stopInertia();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      host.stage.removeEventListener("keydown", keydown);
    },
  };
}

/** 白背景・半球光 + 弱い平行光のシーン雛形(§6.5) */
function makeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY));
  const dir = new THREE.DirectionalLight(0xffffff, DIR_INTENSITY);
  dir.position.set(3, 6, 4);
  scene.add(dir);
  return scene;
}

/** シーン内のジオメトリ・マテリアルをまとめて破棄する */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else if (mat) {
      mat.dispose();
    }
  });
}

/* ------------------------------------------------------------ 2 ビュー雛形 */

export interface DualViewOptions {
  /** 実空間(第 1)ビューのカメラ距離 */
  distFirst: number;
  /** 逆空間(第 2)ビューのカメラ距離 */
  distSecond: number;
  /** 初期方位角(度)。既定 30(§5.6) */
  azimuthDeg?: number;
  /** 初期仰角(度)。既定 20(§5.6) */
  elevationDeg?: number;
  /** 視点変更時に呼ばれる(host.requestRender を渡すこと) */
  onChange: () => void;
  /** stage の aria-label(キーボード視点操作の説明) */
  ariaLabel: string;
}

export interface DualViewKit {
  renderer: THREE.WebGLRenderer;
  sceneFirst: THREE.Scene;
  sceneSecond: THREE.Scene;
  camFirst: THREE.PerspectiveCamera;
  camSecond: THREE.PerspectiveCamera;
  /** 現在のビューポート矩形(CSS px、上原点)。resize() で更新される */
  rects: [ViewRect, ViewRect];
  /** 縦積みかどうか */
  stacked: boolean;
  /** engine の resize 通知から呼ぶ(host.size を読む) */
  resize(): void;
  /** 2 ビューを scissor で描く(host.onRender に渡す) */
  render(): void;
  /** 視点を初期値へ戻す */
  resetView(): void;
  dispose(): void;
}

/**
 * 単一 canvas を 2 ビューポートに分割し、連動カメラで描く雛形を作る
 * (§5.6)。ドラッグ・ピンチ・ホイール・キーボードの視点操作つき。
 */
export function createDualView(
  host: FigureHost,
  opts: DualViewOptions,
): DualViewKit {
  const renderer = new THREE.WebGLRenderer({
    canvas: host.canvas,
    antialias: true,
  });
  renderer.setClearColor(0xffffff, 1);

  const sceneFirst = makeScene();
  const sceneSecond = makeScene();

  const camFirst = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    1,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  const camSecond = camFirst.clone();

  const orbit = createOrbit(
    host,
    [
      { cam: camFirst, dist: opts.distFirst },
      { cam: camSecond, dist: opts.distSecond },
    ],
    {
      azimuthDeg: opts.azimuthDeg,
      elevationDeg: opts.elevationDeg,
      onChange: opts.onChange,
      ariaLabel: opts.ariaLabel,
    },
  );

  /* ---- レイアウトと描画 ---- */
  const rects: [ViewRect, ViewRect] = [
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: 1, h: 1 },
  ];

  const kit: DualViewKit = {
    renderer,
    sceneFirst,
    sceneSecond,
    camFirst,
    camSecond,
    rects,
    stacked: false,
    resize(): void {
      const { w, h, dpr } = host.size;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      if (w >= h * SIDE_BY_SIDE_MIN_ASPECT) {
        kit.stacked = false;
        const pw = (w - VIEW_GAP) / 2;
        rects[0] = { x: 0, y: 0, w: pw, h };
        rects[1] = { x: pw + VIEW_GAP, y: 0, w: pw, h };
      } else {
        kit.stacked = true;
        const ph = (h - VIEW_GAP) / 2;
        rects[0] = { x: 0, y: 0, w, h: ph };
        rects[1] = { x: 0, y: ph + VIEW_GAP, w, h: ph };
      }
      const aspect = rects[0].w / rects[0].h;
      camFirst.aspect = aspect;
      camFirst.updateProjectionMatrix();
      camSecond.aspect = aspect;
      camSecond.updateProjectionMatrix();
      orbit.apply();
    },
    render(): void {
      const { h } = host.size;
      renderer.setScissorTest(true);
      const views: Array<[ViewRect, THREE.Scene, THREE.PerspectiveCamera]> = [
        [rects[0], sceneFirst, camFirst],
        [rects[1], sceneSecond, camSecond],
      ];
      for (const [r, scene, cam] of views) {
        // three の viewport は左下原点(CSS px 単位、DPR は renderer が掛ける)
        const yGl = h - (r.y + r.h);
        renderer.setViewport(r.x, yGl, r.w, r.h);
        renderer.setScissor(r.x, yGl, r.w, r.h);
        renderer.render(scene, cam);
      }
      renderer.setScissorTest(false);
    },
    resetView(): void {
      orbit.reset();
    },
    dispose(): void {
      orbit.dispose();
      disposeScene(sceneFirst);
      disposeScene(sceneSecond);
      renderer.dispose();
    },
  };

  kit.resize();
  return kit;
}

/* ----------------------------------------------------------- 単一ビュー */

export interface SingleViewOptions {
  /** カメラ距離 */
  dist: number;
  /** 描画先キャンバス(省略時は host.canvas) */
  canvas?: HTMLCanvasElement;
  /** ビューポートの寸法。省略時は host.size を使う */
  size?: { w: number; h: number; dpr: number };
  azimuthDeg?: number;
  elevationDeg?: number;
  onChange: () => void;
  ariaLabel: string;
}

export interface SingleViewKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(): void;
  render(): void;
  resetView(): void;
  dispose(): void;
}

/**
 * 1 ビューだけの 3D 雛形(仕様書 11 §5.5 の図5 が使う)。
 * 視点操作は createDualView と同じ createOrbit を共用する(再実装しない)。
 * `canvas` / `size` を渡すと、図版の一部だけを占める専用キャンバスに描ける
 * (2D の canvas に 3D を重ねる図版のため)。
 */
export function createSingleView(
  host: FigureHost,
  opts: SingleViewOptions,
): SingleViewKit {
  const canvas = opts.canvas ?? host.canvas;
  const size = opts.size ?? host.size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0xffffff, 1);
  const scene = makeScene();
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    1,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  const orbit = createOrbit(host, [{ cam: camera, dist: opts.dist }], {
    azimuthDeg: opts.azimuthDeg,
    elevationDeg: opts.elevationDeg,
    onChange: opts.onChange,
    ariaLabel: opts.ariaLabel,
    canvas,
  });

  const kit: SingleViewKit = {
    renderer,
    scene,
    camera,
    resize(): void {
      renderer.setPixelRatio(size.dpr);
      renderer.setSize(size.w, size.h, false);
      camera.aspect = size.w / Math.max(1, size.h);
      camera.updateProjectionMatrix();
      orbit.apply();
    },
    render(): void {
      renderer.render(scene, camera);
    },
    resetView(): void {
      orbit.reset();
    },
    dispose(): void {
      orbit.dispose();
      disposeScene(scene);
      renderer.dispose();
    },
  };
  kit.resize();
  return kit;
}

/* --------------------------------------------------- パネルの単位ラベル */

export interface PanelTags {
  update(rects: readonly [ViewRect, ViewRect]): void;
  /** i 番目のラベル文字列を差し替える */
  set(i: number, text: string): void;
  dispose(): void;
}

/**
 * 各ビューポート左上に単位ラベル(例 「実空間 [nm]」「逆空間 [nm⁻¹]」)を
 * 置く。WebGL canvas に文字を描かず、HTML オーバーレイで済ませる
 * (§5.0 の「両パネルに単位を常に目に入れる」の 3D 版)。
 */
export function createPanelTags(
  stage: HTMLElement,
  labels: readonly [string, string],
): PanelTags {
  const els = labels.map((text) => {
    const el = document.createElement("span");
    el.className = "ix-panel-tag";
    el.textContent = text;
    stage.appendChild(el);
    return el;
  });
  return {
    update(rects): void {
      els.forEach((el, i) => {
        el.style.left = `${rects[i].x + 10}px`;
        el.style.top = `${rects[i].y + 8}px`;
      });
    },
    set(i, text): void {
      if (els[i] && els[i].textContent !== text) els[i].textContent = text;
    },
    dispose(): void {
      for (const el of els) el.remove();
    },
  };
}

/* -------------------------------------------------- ラベルスプライト */

/** ラベルスプライト描画用キャンバスの拡大率(にじみ防止) */
const SPRITE_SCALE = 3;

/**
 * テキストのスプライトを作る(3D 空間内のラベル用)。
 * worldHeight はスプライトの高さ(ワールド単位)。
 */
export function makeLabelSprite(
  text: string,
  colorCss: string,
  worldHeight: number,
): THREE.Sprite {
  const fontPx = 24 * SPRITE_SCALE;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D コンテキストを取得できません");
  const font = `${fontPx}px "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  canvas.width = Math.ceil(metrics.width) + fontPx * 0.4;
  canvas.height = Math.ceil(fontPx * 1.4);
  ctx.font = font;
  ctx.fillStyle = colorCss;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(
    (worldHeight * canvas.width) / canvas.height,
    worldHeight,
    1,
  );
  return sprite;
}

/**
 * 中抜きの丸マーカー(図7 の「現れない点」— §5.7)。常にカメラを向く。
 */
export function makeRingSprite(
  colorCss: string,
  worldSize: number,
): THREE.Sprite {
  const size = 64 * SPRITE_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D コンテキストを取得できません");
  ctx.strokeStyle = colorCss;
  ctx.lineWidth = size * 0.09;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldSize, worldSize, 1);
  return sprite;
}

/* --------------------------------------------------------- 3D 矢印 */

export interface Arrow3D {
  group: THREE.Group;
  /** 原点から (x, y, z) へ向ける。長さ 0 なら非表示 */
  set(x: number, y: number, z: number): void;
  dispose(): void;
}

const ARROW_HEAD_RATIO = 0.22;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 原点から伸びる塗り矢印(円柱 + 円錐)。g ベクトルや面法線の表示用。
 * shaftRadius はワールド単位。
 */
export function createArrow3D(colorCss: string, shaftRadius: number): Arrow3D {
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(colorCss),
  });
  const shaftGeom = new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 12);
  shaftGeom.translate(0, 0.5, 0); // 根元を原点に
  const headGeom = new THREE.ConeGeometry(shaftRadius * 2.6, 1, 16);
  headGeom.translate(0, 0.5, 0);
  const shaft = new THREE.Mesh(shaftGeom, material);
  const head = new THREE.Mesh(headGeom, material);
  const group = new THREE.Group();
  group.add(shaft, head);
  const dir = new THREE.Vector3();
  return {
    group,
    set(x: number, y: number, z: number): void {
      const len = Math.hypot(x, y, z);
      if (len < 1e-9) {
        group.visible = false;
        return;
      }
      group.visible = true;
      dir.set(x / len, y / len, z / len);
      group.quaternion.setFromUnitVectors(UP, dir);
      const headLen = len * ARROW_HEAD_RATIO;
      shaft.scale.set(1, len - headLen, 1);
      head.scale.set(1, headLen, 1);
      head.position.set(0, len - headLen, 0);
    },
    dispose(): void {
      shaftGeom.dispose();
      headGeom.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------- 線分群 */

/** 線分群(単位胞の稜線・箱の外形など)。positions は [x0,y0,z0, x1,y1,z1, …] */
export function createLineSegments(
  positions: readonly number[],
  colorCss: string,
  opacity = 1,
): THREE.LineSegments {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorCss),
    transparent: opacity < 1,
    opacity,
  });
  return new THREE.LineSegments(geom, mat);
}

/* -------------------------------------------------- 面束(ポリゴン群) */

export interface PlaneStack {
  group: THREE.Group;
  /** ポリゴン群を差し替える(planeBoxPolygon の結果をそのまま渡す) */
  set(polygons: readonly Vec3[][]): void;
  dispose(): void;
}

/**
 * (hkl) 面束の描画(半透明の塗り + 縁線 — §5.6)。全ポリゴンを 1 つの
 * BufferGeometry(扇状三角形分割)+ 1 つの LineSegments にまとめる。
 */
export function createPlaneStack(
  colorCss: string,
  fillOpacity: number,
): PlaneStack {
  const fillGeom = new THREE.BufferGeometry();
  const edgeGeom = new THREE.BufferGeometry();
  const fillMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorCss),
    transparent: true,
    opacity: fillOpacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorCss),
    transparent: true,
    opacity: 0.6,
  });
  const fill = new THREE.Mesh(fillGeom, fillMat);
  const edges = new THREE.LineSegments(edgeGeom, edgeMat);
  const group = new THREE.Group();
  group.add(fill, edges);
  return {
    group,
    set(polygons: readonly Vec3[][]): void {
      const tri: number[] = [];
      const seg: number[] = [];
      for (const poly of polygons) {
        for (let i = 1; i + 1 < poly.length; i++) {
          tri.push(
            poly[0].x,
            poly[0].y,
            poly[0].z,
            poly[i].x,
            poly[i].y,
            poly[i].z,
            poly[i + 1].x,
            poly[i + 1].y,
            poly[i + 1].z,
          );
        }
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i];
          const q = poly[(i + 1) % poly.length];
          seg.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
      }
      fillGeom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(tri), 3),
      );
      edgeGeom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(seg), 3),
      );
      fillGeom.computeBoundingSphere();
      edgeGeom.computeBoundingSphere();
    },
    dispose(): void {
      fillGeom.dispose();
      edgeGeom.dispose();
      fillMat.dispose();
      edgeMat.dispose();
    },
  };
}
