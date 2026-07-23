/**
 * three-helpers.ts — 3D 図版(逆格子・エヴァルト球)専用ヘルパ(仕様書 §7.4)
 *
 * 重要: このモジュールは three を静的 import している。必ずウィジェット側から
 * 動的 import(registry 経由)で読み込むこと。2D のみのページのバンドルには
 * 1 バイトも含まれない(§4)。
 *
 * 描画方針(§6.5): 白背景・単色マテリアル + 半球光 + 弱い平行光。質感より判読性。
 */

import * as THREE from "three";
import { clamp } from "./mathx";
import type { FigureSize } from "../widgets/types";

const CAMERA_FOV_DEG = 40;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
/** 半球光: 上方は白、下方は淡い青灰(判読性のための最小限の陰影) */
const HEMI_SKY = 0xffffff;
const HEMI_GROUND = 0xdde3ea;
const HEMI_INTENSITY = 1.1;
const DIR_INTENSITY = 0.5;

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** engine の resize 通知(WidgetHandle.resize)から host.size を渡して呼ぶ */
  resize(size: FigureSize): void;
  render(): void;
  dispose(): void;
}

/**
 * 白背景・ライト・DPR 設定済みのシーン雛形を作る。
 */
export function createSceneKit(
  canvas: HTMLCanvasElement,
  size: FigureSize,
): SceneKit {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0xffffff, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    size.w / size.h,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  camera.position.set(6, 4, 8);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY));
  const dir = new THREE.DirectionalLight(0xffffff, DIR_INTENSITY);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  const kit: SceneKit = {
    renderer,
    scene,
    camera,
    resize(s: FigureSize): void {
      renderer.setPixelRatio(s.dpr);
      renderer.setSize(s.w, s.h, false);
      camera.aspect = s.w / s.h;
      camera.updateProjectionMatrix();
    },
    render(): void {
      renderer.render(scene, camera);
    },
    dispose(): void {
      renderer.dispose();
    },
  };
  kit.resize(size);
  return kit;
}

export interface OrbitOptions {
  /** 注視点。既定は原点 */
  target?: THREE.Vector3;
  /** 初期距離。既定は現在のカメラ位置から算出 */
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  /** 上下角の制限(ラジアン)。既定 0.15π〜0.85π */
  minPolar?: number;
  maxPolar?: number;
  /** 変更時コールバック(requestRender を渡す) */
  onChange?: () => void;
}

const ORBIT_ROTATE_SPEED = 0.005; // rad / px
const ORBIT_INERTIA_DECAY = 6; // 1/s(大きいほど早く止まる)
const ORBIT_WHEEL_ZOOM = 0.001;
const ORBIT_MIN_VELOCITY = 0.02; // rad/s 以下で慣性停止

/**
 * 簡易オービット操作: 慣性つきドラッグ回転 + ピンチ/ホイールズーム。
 * タッチ・マウス両対応(Pointer Events)。上下角に制限あり(§7.4)。
 */
export class SimpleOrbit {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly target: THREE.Vector3;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly minPolar: number;
  private readonly maxPolar: number;
  private readonly onChange: (() => void) | null;

  private theta: number; // 方位角
  private phi: number; // 極角
  private distance: number;
  private velTheta = 0;
  private velPhi = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinchDistance = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly disposers: Array<() => void> = [];

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    opts: OrbitOptions = {},
  ) {
    this.camera = camera;
    this.dom = dom;
    this.target = opts.target ?? new THREE.Vector3(0, 0, 0);
    this.onChange = opts.onChange ?? null;

    const offset = new THREE.Vector3().subVectors(camera.position, this.target);
    this.distance = opts.distance ?? offset.length();
    this.minDistance = opts.minDistance ?? this.distance * 0.4;
    this.maxDistance = opts.maxDistance ?? this.distance * 3;
    this.minPolar = opts.minPolar ?? Math.PI * 0.15;
    this.maxPolar = opts.maxPolar ?? Math.PI * 0.85;

    const spherical = new THREE.Spherical().setFromVector3(offset);
    this.theta = spherical.theta;
    this.phi = clamp(spherical.phi, this.minPolar, this.maxPolar);

    this.bind();
    this.apply();
  }

  private bind(): void {
    const down = (e: PointerEvent): void => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dom.setPointerCapture(e.pointerId);
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.velTheta = 0;
        this.velPhi = 0;
      } else if (this.pointers.size === 2) {
        this.dragging = false;
        this.pinchDistance = this.currentPinchDistance();
      }
    };
    const move = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1 && this.dragging) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.rotate(dx, dy);
        // 慣性用に直近の角速度を記録(60fps 相当で換算)
        this.velTheta = -dx * ORBIT_ROTATE_SPEED * 60;
        this.velPhi = -dy * ORBIT_ROTATE_SPEED * 60;
      } else if (this.pointers.size === 2) {
        const d = this.currentPinchDistance();
        if (this.pinchDistance > 0 && d > 0) {
          this.zoomBy(this.pinchDistance / d);
          this.pinchDistance = d;
        }
      }
    };
    const up = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) this.dragging = false;
      if (this.pointers.size < 2) this.pinchDistance = 0;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * ORBIT_WHEEL_ZOOM));
    };

    this.dom.addEventListener("pointerdown", down);
    this.dom.addEventListener("pointermove", move);
    this.dom.addEventListener("pointerup", up);
    this.dom.addEventListener("pointercancel", up);
    this.dom.addEventListener("wheel", wheel, { passive: false });
    this.disposers.push(() => {
      this.dom.removeEventListener("pointerdown", down);
      this.dom.removeEventListener("pointermove", move);
      this.dom.removeEventListener("pointerup", up);
      this.dom.removeEventListener("pointercancel", up);
      this.dom.removeEventListener("wheel", wheel);
    });
  }

  private currentPinchDistance(): number {
    if (this.pointers.size < 2) return 0;
    const pts = [...this.pointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private rotate(dxPx: number, dyPx: number): void {
    this.theta -= dxPx * ORBIT_ROTATE_SPEED;
    this.phi = clamp(
      this.phi - dyPx * ORBIT_ROTATE_SPEED,
      this.minPolar,
      this.maxPolar,
    );
    this.apply();
  }

  private zoomBy(factor: number): void {
    this.distance = clamp(
      this.distance * factor,
      this.minDistance,
      this.maxDistance,
    );
    this.apply();
  }

  private apply(): void {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.distance * sinPhi * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    this.onChange?.();
  }

  /**
   * 慣性を進める。毎フレーム呼び、true が返る間は再描画が必要。
   */
  update(dt: number): boolean {
    if (this.dragging) return true;
    const speed = Math.hypot(this.velTheta, this.velPhi);
    if (speed < ORBIT_MIN_VELOCITY) return false;
    const decay = Math.exp(-ORBIT_INERTIA_DECAY * dt);
    this.theta += this.velTheta * dt;
    this.phi = clamp(this.phi + this.velPhi * dt, this.minPolar, this.maxPolar);
    this.velTheta *= decay;
    this.velPhi *= decay;
    this.apply();
    return true;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.pointers.clear();
  }
}

export interface InstancedAtoms {
  mesh: THREE.InstancedMesh;
  /** i 番目の原子の位置(と任意のスケール)を設定する */
  setAtom(i: number, x: number, y: number, z: number, scale?: number): void;
  /** setAtom をまとめて呼んだ後に 1 回呼ぶ(GPU への反映) */
  commit(): void;
  dispose(): void;
}

const ATOM_SPHERE_SEGMENTS = 24;

/**
 * InstancedMesh で原子群(数千個)を 1 ドローコールで描くヘルパ(§7.4, §8.3)。
 */
export function createInstancedAtoms(
  count: number,
  radius: number,
  color: string,
): InstancedAtoms {
  const geometry = new THREE.SphereGeometry(
    radius,
    ATOM_SPHERE_SEGMENTS,
    Math.ceil(ATOM_SPHERE_SEGMENTS * 0.75),
  );
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color),
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const matrix = new THREE.Matrix4();

  return {
    mesh,
    setAtom(i: number, x: number, y: number, z: number, scale = 1): void {
      matrix.makeScale(scale, scale, scale);
      matrix.setPosition(x, y, z);
      mesh.setMatrixAt(i, matrix);
    },
    commit(): void {
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
