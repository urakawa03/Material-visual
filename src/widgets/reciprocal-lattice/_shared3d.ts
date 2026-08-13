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
 * - 単一 canvas を 1〜2 ビューポート(2 分割は左右、狭幅では上下)に分ける
 *   scissor 描画のシーン雛形(白背景・半球光 + 弱い平行光 — §6.5)
 * - 各ビューポートで連動するオービット(ドラッグ + 慣性 + ピンチ/ホイール
 *   ズーム + キーボード: 矢印 3°/押下・+/− 10% ズーム — §5.6)。
 *   描画はダーティ方式: 変化があったときだけ onChange → requestRender で
 *   1 フレーム描き、静止時の GPU 消費はゼロ(§5.6)。慣性はヘルパ内部の
 *   rAF で進め、prefers-reduced-motion では慣性を使わない
 * - ラベルスプライト・3D 矢印・ポリゴン束(面束)・線分群・パネルの単位
 *   ラベルなどの小物
 *
 * 記事「エヴァルト球」(仕様書 04 §5.0・付録 A-2)のために、
 * createMultiView でビュー数 1 と「ビューごとにカメラ連動を切る」(固定
 * カメラ)に対応した。createDualView / DualViewKit は従来どおりの薄い
 * ラッパーで、公開 API と挙動は変えていない。
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

/* --------------------------------------------------------- 1〜2 ビュー雛形 */

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MultiViewOptions {
  /** 各ビューのカメラ距離(要素数がビュー数。1 または 2) */
  dists: readonly number[];
  /**
   * 連動オービットから外すビュー(true = 正面固定カメラ)。省略時は
   * すべて連動する。図6 の検出器ビューが使う(仕様書 04 §5.6)。
   */
  fixed?: readonly boolean[];
  /** 初期方位角(度)。既定 30(§5.6) */
  azimuthDeg?: number;
  /** 初期仰角(度)。既定 20(§5.6) */
  elevationDeg?: number;
  /** 視点変更時に呼ばれる(host.requestRender を渡すこと) */
  onChange: () => void;
  /** stage の aria-label(キーボード視点操作の説明) */
  ariaLabel: string;
}

export interface MultiViewKit {
  renderer: THREE.WebGLRenderer;
  /** ビューごとのシーン(要素数 = dists.length) */
  scenes: THREE.Scene[];
  /** ビューごとのカメラ */
  cameras: THREE.PerspectiveCamera[];
  /** 現在のビューポート矩形(CSS px、上原点)。resize() で更新される */
  rects: ViewRect[];
  /** 縦積みかどうか(ビュー数 1 では常に false) */
  stacked: boolean;
  /** engine の resize 通知から呼ぶ(host.size を読む) */
  resize(): void;
  /** 全ビューを scissor で描く(host.onRender に渡す) */
  render(): void;
  /** 視点を初期値へ戻す */
  resetView(): void;
  dispose(): void;
}

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

export interface DualViewKit extends MultiViewKit {
  sceneFirst: THREE.Scene;
  sceneSecond: THREE.Scene;
  camFirst: THREE.PerspectiveCamera;
  camSecond: THREE.PerspectiveCamera;
}

export interface SingleViewOptions {
  /** カメラ距離 */
  dist: number;
  azimuthDeg?: number;
  elevationDeg?: number;
  onChange: () => void;
  ariaLabel: string;
}

export interface SingleViewKit extends MultiViewKit {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/**
 * 単一 canvas を 1〜2 ビューポートに分割し、連動カメラで描く雛形を作る
 * (§5.6)。ドラッグ・ピンチ・ホイール・キーボードの視点操作つき。
 * opts.fixed[i] が true のビューは連動せず、正面(+z 方向)から見た
 * 固定カメラになる(仕様書 04 §5.6 の検出器ビュー)。
 */
export function createMultiView(
  host: FigureHost,
  opts: MultiViewOptions,
): MultiViewKit {
  const viewCount = opts.dists.length;
  const isFixed = (i: number): boolean => opts.fixed?.[i] === true;

  const renderer = new THREE.WebGLRenderer({
    canvas: host.canvas,
    antialias: true,
  });
  renderer.setClearColor(0xffffff, 1);

  const makeScene = (): THREE.Scene => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.add(new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY));
    const dir = new THREE.DirectionalLight(0xffffff, DIR_INTENSITY);
    dir.position.set(3, 6, 4);
    scene.add(dir);
    return scene;
  };
  const scenes = Array.from({ length: viewCount }, makeScene);
  const cameras = Array.from(
    { length: viewCount },
    () =>
      new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR),
  );

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
    for (let i = 0; i < viewCount; i++) {
      const cam = cameras[i];
      if (isFixed(i)) {
        // 固定カメラ: 常に +z から原点を正面に見る(検出器の正面図)
        cam.position.set(0, 0, opts.dists[i]);
      } else {
        const d = opts.dists[i] * zoom;
        cam.position.set(d * ce * sa, d * se, d * ce * ca);
      }
      cam.lookAt(0, 0, 0);
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
    host.canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velAz = 0;
      velEl = 0;
      if (inertiaRaf !== 0) {
        cancelAnimationFrame(inertiaRaf);
        inertiaRaf = 0;
      }
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

  host.canvas.addEventListener("pointerdown", down);
  host.canvas.addEventListener("pointermove", move);
  host.canvas.addEventListener("pointerup", up);
  host.canvas.addEventListener("pointercancel", up);
  host.canvas.addEventListener("wheel", wheel, { passive: false });
  host.stage.addEventListener("keydown", keydown);

  /* ---- レイアウトと描画 ---- */
  const rects: ViewRect[] = Array.from({ length: viewCount }, () => ({
    x: 0,
    y: 0,
    w: 1,
    h: 1,
  }));

  const kit: MultiViewKit = {
    renderer,
    scenes,
    cameras,
    rects,
    stacked: false,
    resize(): void {
      const { w, h, dpr } = host.size;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      if (viewCount === 1) {
        kit.stacked = false;
        rects[0] = { x: 0, y: 0, w, h };
      } else if (w >= h * SIDE_BY_SIDE_MIN_ASPECT) {
        kit.stacked = false;
        // 初期化直後などキャンバスが極小のときに負の幅にならないよう下限を置く
        const pw = Math.max(1, (w - VIEW_GAP) / 2);
        rects[0] = { x: 0, y: 0, w: pw, h };
        rects[1] = { x: pw + VIEW_GAP, y: 0, w: pw, h };
      } else {
        kit.stacked = true;
        const ph = Math.max(1, (h - VIEW_GAP) / 2);
        rects[0] = { x: 0, y: 0, w, h: ph };
        rects[1] = { x: 0, y: ph + VIEW_GAP, w, h: ph };
      }
      for (let i = 0; i < viewCount; i++) {
        cameras[i].aspect = rects[i].w / rects[i].h;
        cameras[i].updateProjectionMatrix();
      }
      applyCameras();
    },
    render(): void {
      const { h } = host.size;
      renderer.setScissorTest(true);
      for (let i = 0; i < viewCount; i++) {
        const r = rects[i];
        // three の viewport は左下原点(CSS px 単位、DPR は renderer が掛ける)
        const yGl = h - (r.y + r.h);
        renderer.setViewport(r.x, yGl, r.w, r.h);
        renderer.setScissor(r.x, yGl, r.w, r.h);
        renderer.render(scenes[i], cameras[i]);
      }
      renderer.setScissorTest(false);
    },
    resetView(): void {
      azimuth = az0;
      elevation = el0;
      zoom = 1;
      velAz = 0;
      velEl = 0;
      if (inertiaRaf !== 0) {
        cancelAnimationFrame(inertiaRaf);
        inertiaRaf = 0;
      }
      applyCameras();
      opts.onChange();
    },
    dispose(): void {
      if (inertiaRaf !== 0) cancelAnimationFrame(inertiaRaf);
      host.canvas.removeEventListener("pointerdown", down);
      host.canvas.removeEventListener("pointermove", move);
      host.canvas.removeEventListener("pointerup", up);
      host.canvas.removeEventListener("pointercancel", up);
      host.canvas.removeEventListener("wheel", wheel);
      host.stage.removeEventListener("keydown", keydown);
      const disposeScene = (scene: THREE.Scene): void => {
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
      };
      for (const scene of scenes) disposeScene(scene);
      renderer.dispose();
    },
  };

  kit.resize();
  applyCameras();
  return kit;
}

/**
 * 2 ビューポート(左 = 実空間、右 = 逆空間)の雛形(§5.6)。
 * createMultiView の薄いラッパーで、従来の名前でシーン・カメラを参照できる。
 */
export function createDualView(
  host: FigureHost,
  opts: DualViewOptions,
): DualViewKit {
  const kit = createMultiView(host, {
    dists: [opts.distFirst, opts.distSecond],
    azimuthDeg: opts.azimuthDeg,
    elevationDeg: opts.elevationDeg,
    onChange: opts.onChange,
    ariaLabel: opts.ariaLabel,
  });
  return Object.assign(kit, {
    sceneFirst: kit.scenes[0],
    sceneSecond: kit.scenes[1],
    camFirst: kit.cameras[0],
    camSecond: kit.cameras[1],
  });
}

/**
 * 単一ビューポートの雛形(仕様書 04 §5.0)。エヴァルト球の 3D 図版のように
 * 逆空間だけを描く図版が使う。
 */
export function createSingleView(
  host: FigureHost,
  opts: SingleViewOptions,
): SingleViewKit {
  const kit = createMultiView(host, {
    dists: [opts.dist],
    azimuthDeg: opts.azimuthDeg,
    elevationDeg: opts.elevationDeg,
    onChange: opts.onChange,
    ariaLabel: opts.ariaLabel,
  });
  return Object.assign(kit, { scene: kit.scenes[0], camera: kit.cameras[0] });
}

/* --------------------------------------------------- パネルの単位ラベル */

export interface PanelTags {
  update(rects: readonly ViewRect[]): void;
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
  labels: readonly string[],
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
