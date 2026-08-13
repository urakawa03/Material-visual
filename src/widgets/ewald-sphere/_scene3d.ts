/**
 * _scene3d.ts — 記事「エヴァルト球」3D 図版(図3〜図6)の共通シーン部品
 * (仕様書 04 §5.0)
 *
 * three.js とシーン雛形・連動オービット・ラベル・矢印・線分群は、前提記事
 * 「逆格子空間」の `_shared3d.ts` から**再利用する**(再実装しない)。
 * ここに置くのは、エヴァルト球の作図に固有の部品だけである。
 *
 * - 半透明のエヴァルト球(内部の逆格子点が透けて見えることを最優先 — §5.0)
 * - ワイヤの球(限界球・粉末の球殻)
 * - 逆格子点の雲(InstancedMesh)と、点灯した反射のマーカー
 * - 球の中心 C から反射点へ伸びる回折波の矢の束
 * - 逆空間の軸(h / k / l)
 *
 * 座標系(§5.0): 逆空間 [nm⁻¹]、原点 O = 000、入射波は +x 方向に進むので
 * エヴァルト球の中心は C = (−1/λ, 0, 0)。
 */

import {
  THREE,
  createArrow3D,
  createInstancedAtoms,
  createLineSegments,
  makeLabelSprite,
  type Arrow3D,
  type InstancedAtoms,
} from "../reciprocal-lattice/_shared3d";
import type { Vec3 } from "../../core/mathx";
import { HIGHLIGHT_SCALE, RECIP_RADIUS } from "./constants";

/** 球のグリッド線: 緯線の本数・経線(大円)の本数・1 本あたりの分割数 */
const SPHERE_LAT_LINES = 5;
const SPHERE_LON_LINES = 6;
const SPHERE_LINE_SEGMENTS = 64;
/** 球面(塗り)の分割数。滑らかさより軽さを優先しつつ輪郭が角ばらない値 */
const SPHERE_WIDTH_SEGMENTS = 48;
const SPHERE_HEIGHT_SEGMENTS = 32;
/** 球のグリッド線の不透明度(点が透けることを優先 — §5.0) */
const SPHERE_WIRE_OPACITY = 0.55;

/**
 * `rgba(r, g, b, a)` 形式のトークンを three が解釈できる色と不透明度に分ける。
 * `--mat-sphere-fill` が rgba なので、塗りのマテリアルを作る前に通す。
 */
export function splitAlpha(css: string): { color: string; alpha: number } {
  const m =
    /^rgba\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,/\s]+([\d.]+)\s*\)$/i.exec(
      css.trim(),
    );
  if (!m) return { color: css, alpha: 1 };
  return {
    color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`,
    alpha: Number(m[4]),
  };
}

/** 単位球の緯線・経線の線分列([x0,y0,z0, x1,y1,z1, …]) */
function sphereGridPositions(): number[] {
  const out: number[] = [];
  const seg = SPHERE_LINE_SEGMENTS;
  // 緯線(y = cos φ 一定の円)
  for (let i = 1; i <= SPHERE_LAT_LINES; i++) {
    const phi = (Math.PI * i) / (SPHERE_LAT_LINES + 1);
    const r = Math.sin(phi);
    const y = Math.cos(phi);
    for (let j = 0; j < seg; j++) {
      const t0 = (2 * Math.PI * j) / seg;
      const t1 = (2 * Math.PI * (j + 1)) / seg;
      out.push(
        r * Math.cos(t0),
        y,
        r * Math.sin(t0),
        r * Math.cos(t1),
        y,
        r * Math.sin(t1),
      );
    }
  }
  // 経線(y 軸を含む大円)
  for (let i = 0; i < SPHERE_LON_LINES; i++) {
    const th = (Math.PI * i) / SPHERE_LON_LINES;
    const cx = Math.cos(th);
    const cz = Math.sin(th);
    for (let j = 0; j < seg; j++) {
      const a0 = (2 * Math.PI * j) / seg;
      const a1 = (2 * Math.PI * (j + 1)) / seg;
      out.push(
        cx * Math.cos(a0),
        Math.sin(a0),
        cz * Math.cos(a0),
        cx * Math.cos(a1),
        Math.sin(a1),
        cz * Math.cos(a1),
      );
    }
  }
  return out;
}

/* ------------------------------------------------------------ エヴァルト球 */

export interface EwaldSphere {
  group: THREE.Group;
  /**
   * 半径 R [nm⁻¹] を設定する。中心は自動的に C = (−R, 0, 0) に置かれ、
   * 球は必ず原点 O を通る(式 E9)。
   */
  setRadius(r: number): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

/**
 * 半透明のエヴァルト球(塗り + 緯経線のワイヤ)。
 * 塗りは `depthWrite: false` + 両面描画で、**内部の逆格子点が必ず透けて
 * 見える**ようにする(§5.0 の最優先事項)。単位球で作り、scale で半径を
 * 変えるのでジオメトリの作り直しは起きない。
 */
export function createEwaldSphere(
  fillCss: string,
  lineCss: string,
): EwaldSphere {
  const { color, alpha } = splitAlpha(fillCss);
  const geom = new THREE.SphereGeometry(
    1,
    SPHERE_WIDTH_SEGMENTS,
    SPHERE_HEIGHT_SEGMENTS,
  );
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: alpha,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  const wire = createLineSegments(
    sphereGridPositions(),
    lineCss,
    SPHERE_WIRE_OPACITY,
  );
  const group = new THREE.Group();
  group.add(mesh, wire);
  return {
    group,
    setRadius(r: number): void {
      group.scale.setScalar(r);
      group.position.set(-r, 0, 0);
    },
    setVisible(v: boolean): void {
      group.visible = v;
    },
    dispose(): void {
      geom.dispose();
      mat.dispose();
      wire.geometry.dispose();
      const wireMat = wire.material;
      if (Array.isArray(wireMat)) {
        for (const m of wireMat) m.dispose();
      } else {
        wireMat.dispose();
      }
    },
  };
}

/* ------------------------------------------ ワイヤの球(限界球・粉末の殻) */

export interface WireSphere {
  lines: THREE.LineSegments;
  /** 原点中心・半径 r の球にする(限界球・粉末の球殻はどちらも原点中心) */
  setRadius(r: number): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

/** 原点中心のワイヤ球(限界球 — §5.5、粉末の球殻 — §5.6) */
export function createWireSphere(
  colorCss: string,
  opacity: number,
): WireSphere {
  const lines = createLineSegments(sphereGridPositions(), colorCss, opacity);
  return {
    lines,
    setRadius(r: number): void {
      lines.scale.setScalar(r);
    },
    setVisible(v: boolean): void {
      lines.visible = v;
    },
    dispose(): void {
      lines.geometry.dispose();
      const mat = lines.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else {
        mat.dispose();
      }
    },
  };
}

/* ------------------------------------------------ 半透明の球(粉末の球殻) */

export interface ShellSphere {
  mesh: THREE.Mesh;
  setRadius(r: number): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

/** 原点中心の半透明球(粉末で 1 つの逆格子点が塗り広げられた球殻 — §5.6) */
export function createShellSphere(
  colorCss: string,
  opacity: number,
): ShellSphere {
  const geom = new THREE.SphereGeometry(1, 40, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorCss),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  return {
    mesh,
    setRadius(r: number): void {
      mesh.scale.setScalar(r);
    },
    setVisible(v: boolean): void {
      mesh.visible = v;
    },
    dispose(): void {
      geom.dispose();
      mat.dispose();
    },
  };
}

/* ----------------------------------------------------------- 逆格子点の雲 */

/**
 * 逆格子点の雲。位置は初期化時に 1 回だけ書き込み、以降は親 Group の回転
 * だけで結晶方位を変える(毎フレームのインスタンス行列の書き換えを避ける
 * — 母体仕様 §8.3)。
 */
export function createRecipCloud(
  points: readonly { g: Vec3; n2: number }[],
  radius: number,
  colorCss: string,
  originScale: number,
): InstancedAtoms {
  const atoms = createInstancedAtoms(points.length, radius, colorCss);
  points.forEach((p, i) => {
    atoms.setAtom(i, p.g.x, p.g.y, p.g.z, p.n2 === 0 ? originScale : 1);
  });
  atoms.commit();
  return atoms;
}

/**
 * 点灯した反射のマーカー。位置は結晶方位を適用したあとの座標を毎更新で
 * 書き込むので、初期位置は原点でよい。表示本数は `mesh.count` で変える
 * (§5.0 の性能規約)。
 */
export function createHighlightCloud(
  capacity: number,
  colorCss: string,
): InstancedAtoms {
  const atoms = createInstancedAtoms(
    capacity,
    RECIP_RADIUS * HIGHLIGHT_SCALE,
    colorCss,
  );
  atoms.mesh.count = 0;
  return atoms;
}

/* --------------------------------------------------- 回折波の矢の束(C 起点) */

export interface ArrowBundle {
  group: THREE.Group;
  /**
   * i 本目を球の中心 C から到達点 (x, y, z) へ向ける。
   * radius を渡すとその矢だけ別の球(半径 radius、中心 (−radius, 0, 0))の
   * 中心から引く — 白色 X 線では点ごとに乗る球が違うため(§5.5)。
   */
  setArrow(i: number, x: number, y: number, z: number, radius?: number): void;
  /** 使う本数(残りは非表示になる) */
  setCount(n: number): void;
  /** 既定の球の中心 C = (−R, 0, 0) を設定する */
  setOrigin(r: number): void;
  dispose(): void;
}

/**
 * エヴァルト球の中心 C から反射点へ伸びる回折波 k′ の矢の束(§5.3)。
 * 矢は `createArrow3D`(_shared3d)を再利用し、束ごと C に平行移動する。
 */
export function createArrowBundle(
  count: number,
  colorCss: string,
  shaftRadius: number,
): ArrowBundle {
  const group = new THREE.Group();
  const arrows: Arrow3D[] = [];
  for (let i = 0; i < count; i++) {
    const arrow = createArrow3D(colorCss, shaftRadius);
    arrow.group.visible = false;
    group.add(arrow.group);
    arrows.push(arrow);
  }
  let defaultOx = 0;
  return {
    group,
    setArrow(
      i: number,
      x: number,
      y: number,
      z: number,
      radius?: number,
    ): void {
      if (i >= arrows.length) return;
      const ox = radius === undefined ? defaultOx : -radius;
      // 矢は自分の球の中心に置き、そこからの相対ベクトルで向ける
      // (Arrow3D.set は長さ 0 のとき自身を非表示にする)
      arrows[i].group.position.set(ox, 0, 0);
      arrows[i].set(x - ox, y, z);
    },
    setCount(n: number): void {
      // setArrow で向けなかった残りを隠す(表示は setArrow 側が担当する)
      for (let i = n; i < arrows.length; i++) {
        arrows[i].group.visible = false;
      }
    },
    setOrigin(r: number): void {
      defaultOx = -r;
    },
    dispose(): void {
      for (const arrow of arrows) arrow.dispose();
    },
  };
}

/* ---------------------------------------------------------------- 軸と枠 */

export interface RecipAxes {
  group: THREE.Group;
  dispose(): void;
}

/**
 * 逆空間の軸 3 本(±half)と端の h / k / l ラベル。前提記事の図6・図7 と
 * 同じ見せ方をそのまま引き継ぐ(§2.3 の視覚言語の継承)。
 */
export function createRecipAxes(
  half: number,
  lineCss: string,
  labelCss: string,
  labelHeight: number,
): RecipAxes {
  const group = new THREE.Group();
  const lines = createLineSegments(
    [
      -half,
      0,
      0,
      half,
      0,
      0, //
      0,
      -half,
      0,
      0,
      half,
      0, //
      0,
      0,
      -half,
      0,
      0,
      half,
    ],
    lineCss,
  );
  group.add(lines);
  const labelPos = half * 1.1;
  const sprites: THREE.Sprite[] = [];
  const specs: ReadonlyArray<readonly [string, number, number, number]> = [
    ["h", labelPos, 0, 0],
    ["k", 0, labelPos, 0],
    ["l", 0, 0, labelPos],
  ];
  for (const [text, x, y, z] of specs) {
    const sprite = makeLabelSprite(text, labelCss, labelHeight);
    sprite.position.set(x, y, z);
    group.add(sprite);
    sprites.push(sprite);
  }
  return {
    group,
    dispose(): void {
      lines.geometry.dispose();
      const mat = lines.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else {
        mat.dispose();
      }
      for (const sprite of sprites) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
    },
  };
}

/* ------------------------------------------------------- 結晶方位の適用 */

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const Q_Y = new THREE.Quaternion();
const Q_Z = new THREE.Quaternion();

/**
 * 逆格子の Group に結晶方位 R = R_z(χ)·R_y(φ) を適用する。
 * `ewald.ts` の rotateOrientation と同じ順序・同じ符号であること
 * (数値判定と見た目がずれないよう、必ずこの関数を通す)。角度はラジアン。
 */
export function applyOrientation(
  group: THREE.Object3D,
  phi: number,
  chi: number,
): void {
  Q_Y.setFromAxisAngle(AXIS_Y, phi);
  Q_Z.setFromAxisAngle(AXIS_Z, chi);
  group.quaternion.copy(Q_Z).multiply(Q_Y);
}

/* ------------------------------------------------------------ ラベルの器 */

export interface LabelPool {
  group: THREE.Group;
  /** i 番目のラベルを (x, y, z) に text で表示する */
  show(i: number, text: string, x: number, y: number, z: number): void;
  /** 使う個数(残りは非表示) */
  setCount(n: number): void;
  dispose(): void;
}

/**
 * 点灯した反射の (h k l) ラベル。スプライトはテキストごとにテクスチャを
 * 作り直す必要があるため、同じ文字列なら作り直さないキャッシュを持つ。
 */
export function createLabelPool(
  count: number,
  colorCss: string,
  worldHeight: number,
): LabelPool {
  const group = new THREE.Group();
  const sprites: Array<THREE.Sprite | null> = new Array(count).fill(null);
  const texts: string[] = new Array(count).fill("");

  const disposeSprite = (sprite: THREE.Sprite): void => {
    sprite.material.map?.dispose();
    sprite.material.dispose();
    group.remove(sprite);
  };

  return {
    group,
    show(i: number, text: string, x: number, y: number, z: number): void {
      if (i >= count) return;
      let sprite = sprites[i];
      if (!sprite || texts[i] !== text) {
        if (sprite) disposeSprite(sprite);
        sprite = makeLabelSprite(text, colorCss, worldHeight);
        group.add(sprite);
        sprites[i] = sprite;
        texts[i] = text;
      }
      sprite.position.set(x, y, z);
      sprite.visible = true;
    },
    setCount(n: number): void {
      for (let i = n; i < count; i++) {
        const sprite = sprites[i];
        if (sprite) sprite.visible = false;
      }
    },
    dispose(): void {
      for (const sprite of sprites) {
        if (sprite) disposeSprite(sprite);
      }
    },
  };
}
