/**
 * lattice.ts — 逆格子の数理(仕様書 05 §6.2 の式 E2〜E10 に対応する純粋関数群)
 *
 * 記事「逆格子空間」の全図版が共有する計算をここに集約する。DOM・Canvas・
 * three.js に依存しない純粋関数のみを置き、単体テスト(lattice.test.ts)の
 * 対象とする。
 *
 * 慣習(仕様書 05 §2.3): 結晶学の慣習を採用する。a_i·b_j = δ_ij、
 * |g_hkl| = 1/d_hkl、空間周波数 q = 1/λ(2π を付けない)。
 */

import { vec2, vec3, type Vec2, type Vec3 } from "../../core/mathx";

/* ------------------------------------------------------------- 双対基底 */

export interface DualBasis2 {
  b1: Vec2;
  b2: Vec2;
  /** 単位胞面積(符号付き。a1 → a2 が反時計回りなら正) */
  S: number;
}

/**
 * 2 次元の双対基底(式 E8)。
 * b1 = (a2y, −a2x)/S, b2 = (−a1y, a1x)/S, S = a1x·a2y − a1y·a2x。
 * a_i·b_j = δ_ij を満たす。
 */
export function dualBasis2(a1: Vec2, a2: Vec2): DualBasis2 {
  const S = a1.x * a2.y - a1.y * a2.x;
  return {
    b1: vec2(a2.y / S, -a2.x / S),
    b2: vec2(-a1.y / S, a1.x / S),
    S,
  };
}

export interface DualBasis3 {
  b1: Vec3;
  b2: Vec3;
  b3: Vec3;
  /** 単位胞体積(符号付き) */
  V: number;
}

/**
 * 3 次元の双対基底(式 E9)。
 * b1 = (a2×a3)/V, b2 = (a3×a1)/V, b3 = (a1×a2)/V,
 * V = a1·(a2×a3)。a_i·b_j = δ_ij を満たす。
 */
export function dualBasis3(a1: Vec3, a2: Vec3, a3: Vec3): DualBasis3 {
  const cx = a2.y * a3.z - a2.z * a3.y;
  const cy = a2.z * a3.x - a2.x * a3.z;
  const cz = a2.x * a3.y - a2.y * a3.x;
  const V = a1.x * cx + a1.y * cy + a1.z * cz;
  return {
    b1: vec3(cx / V, cy / V, cz / V),
    b2: vec3(
      (a3.y * a1.z - a3.z * a1.y) / V,
      (a3.z * a1.x - a3.x * a1.z) / V,
      (a3.x * a1.y - a3.y * a1.x) / V,
    ),
    b3: vec3(
      (a1.y * a2.z - a1.z * a2.y) / V,
      (a1.z * a2.x - a1.x * a2.z) / V,
      (a1.x * a2.y - a1.y * a2.x) / V,
    ),
    V,
  };
}

/* ------------------------------------------------------- 一致度(ラウエ関数) */

const TAU = Math.PI * 2;

/**
 * 1 次元の一致度 M(q)(式 E2)。x_j = j·a の完全格子 N 個に対する
 * M(q) = (1/N)|Σ_j e^{2πi q x_j}|。q = n/a でちょうど 1 になる。
 */
export function laue1D(q: number, a: number, n: number): number {
  let re = 0;
  let im = 0;
  for (let j = 0; j < n; j++) {
    const ph = TAU * q * a * j;
    re += Math.cos(ph);
    im += Math.sin(ph);
  }
  return Math.hypot(re, im) / n;
}

/**
 * 2 次元の一致度 M(q)(式 E4)。原子位置は平坦配列 xy = [x0, y0, x1, y1, …]
 * の先頭 count 個を使う。
 */
export function laue2D(
  qx: number,
  qy: number,
  xy: Float64Array,
  count: number,
): number {
  let re = 0;
  let im = 0;
  for (let j = 0; j < count; j++) {
    const ph = TAU * (qx * xy[j * 2] + qy * xy[j * 2 + 1]);
    re += Math.cos(ph);
    im += Math.sin(ph);
  }
  return count === 0 ? 0 : Math.hypot(re, im) / count;
}

/* ------------------------------------------------------------- 立方格子 */

/** 立方格子の面間隔(式 E10): d = a/√(h²+k²+l²) */
export function dCubic(h: number, k: number, l: number, a: number): number {
  return a / Math.sqrt(h * h + k * k + l * l);
}

export type CubicLattice = "sc" | "bcc" | "fcc";

/**
 * 逆格子点の存在則(仕様書 05 §5.7)。
 * SC: すべての整数 (hkl)。BCC: h+k+l が偶数。FCC: h, k, l の偶奇が揃う。
 */
export function isAllowed(
  lattice: CubicLattice,
  h: number,
  k: number,
  l: number,
): boolean {
  const ph = Math.abs(h) % 2;
  const pk = Math.abs(k) % 2;
  const pl = Math.abs(l) % 2;
  switch (lattice) {
    case "sc":
      return true;
    case "bcc":
      return (ph + pk + pl) % 2 === 0;
    case "fcc":
      return ph === pk && pk === pl;
  }
}

/**
 * 基本並進ベクトル(格子定数 a = 1 の単位)。
 * BCC: a/2(−1,1,1) ほか、FCC: a/2(0,1,1) ほか(仕様書 05 §5.7)。
 */
export function primitiveVectors(lattice: CubicLattice): [Vec3, Vec3, Vec3] {
  switch (lattice) {
    case "sc":
      return [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)];
    case "bcc":
      return [
        vec3(-0.5, 0.5, 0.5),
        vec3(0.5, -0.5, 0.5),
        vec3(0.5, 0.5, -0.5),
      ];
    case "fcc":
      return [vec3(0, 0.5, 0.5), vec3(0.5, 0, 0.5), vec3(0.5, 0.5, 0)];
  }
}

/** 座標の一致判定に使う丸め(浮動小数の誤差吸収) */
const COORD_EPS = 1e-9;

/**
 * 基本並進ベクトルから式 E9 で作った逆格子点の集合(1/a 単位)。
 * 双対基底の整数結合 m1 b1 + m2 b2 + m3 b3 のうち、全成分の絶対値が
 * maxIndex 以下のものを返す。偶奇則(isAllowed)との一致を単体テストで
 * 確認するための参照実装で、実行時の描画には偶奇則を直接使ってよい。
 */
export function recipPointsFromPrimitive(
  lattice: CubicLattice,
  maxIndex: number,
): Vec3[] {
  const [a1, a2, a3] = primitiveVectors(lattice);
  const { b1, b2, b3 } = dualBasis3(a1, a2, a3);
  // 双対基底の各成分は最大でも 2 程度(FCC の逆基底 = (−1,1,1) など)なので、
  // m の探索範囲は maxIndex を余裕をもって覆う 2·maxIndex + 2 で十分
  const range = 2 * maxIndex + 2;
  const pts: Vec3[] = [];
  const lim = maxIndex + COORD_EPS;
  for (let m1 = -range; m1 <= range; m1++) {
    for (let m2 = -range; m2 <= range; m2++) {
      for (let m3 = -range; m3 <= range; m3++) {
        const x = m1 * b1.x + m2 * b2.x + m3 * b3.x;
        const y = m1 * b1.y + m2 * b2.y + m3 * b3.y;
        const z = m1 * b1.z + m2 * b2.z + m3 * b3.z;
        if (Math.abs(x) <= lim && Math.abs(y) <= lim && Math.abs(z) <= lim) {
          pts.push(vec3(x, y, z));
        }
      }
    }
  }
  return pts;
}

/**
 * 慣用単位胞 cells×cells×cells 個分の原子位置(a = 1 の単位、原点中心)。
 * 共有される角・面心の重複は除いてある。図7 の左パネル用。
 */
export function conventionalCellAtoms(
  lattice: CubicLattice,
  cells: number,
): Vec3[] {
  const pts: Vec3[] = [];
  const seen = new Set<string>();
  const half = cells / 2;
  const add = (x: number, y: number, z: number): void => {
    const key = `${Math.round(x * 4)},${Math.round(y * 4)},${Math.round(z * 4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    pts.push(vec3(x - half, y - half, z - half));
  };
  // 角(単純立方の格子点)
  for (let i = 0; i <= cells; i++) {
    for (let j = 0; j <= cells; j++) {
      for (let k = 0; k <= cells; k++) {
        add(i, j, k);
      }
    }
  }
  if (lattice === "bcc") {
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        for (let k = 0; k < cells; k++) {
          add(i + 0.5, j + 0.5, k + 0.5);
        }
      }
    }
  } else if (lattice === "fcc") {
    for (let i = 0; i <= cells; i++) {
      for (let j = 0; j < cells; j++) {
        for (let k = 0; k < cells; k++) {
          // x 一定面・y 一定面・z 一定面の面心(それぞれ i を法線方向に回す)
          add(i, j + 0.5, k + 0.5);
          add(j + 0.5, i, k + 0.5);
          add(j + 0.5, k + 0.5, i);
        }
      }
    }
  }
  return pts;
}

/* ------------------------------------------- 平面とボックスの交差(図6) */

/** 立方体の 8 頂点(±half)を列挙する(planeBoxPolygon 内部用) */
const CUBE_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

/** 立方体の 12 辺(CUBE_CORNERS の添字ペア) */
const CUBE_EDGES: ReadonlyArray<readonly [number, number]> = [
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

/**
 * 平面 n·r = d と、原点中心・一辺 2·half の軸平行立方体の交線ポリゴンを
 * 返す。交わらなければ空配列。頂点は面内で角度順に整列済み(3〜6 点)。
 * 図6 の (hkl) 面束の描画に使う。
 */
export function planeBoxPolygon(n: Vec3, d: number, half: number): Vec3[] {
  const nLen = Math.hypot(n.x, n.y, n.z);
  if (nLen === 0) return [];
  const eps = 1e-9 * Math.max(1, Math.abs(d));
  const signed: number[] = CUBE_CORNERS.map(
    ([cx, cy, cz]) =>
      n.x * cx * half + n.y * cy * half + n.z * cz * half - d,
  );
  const pts: Vec3[] = [];
  const push = (x: number, y: number, z: number): void => {
    for (const p of pts) {
      if (
        Math.abs(p.x - x) < 1e-7 &&
        Math.abs(p.y - y) < 1e-7 &&
        Math.abs(p.z - z) < 1e-7
      ) {
        return;
      }
    }
    pts.push(vec3(x, y, z));
  };
  for (const [ia, ib] of CUBE_EDGES) {
    const sa = signed[ia];
    const sb = signed[ib];
    const a = CUBE_CORNERS[ia];
    const b = CUBE_CORNERS[ib];
    if (Math.abs(sa) <= eps) push(a[0] * half, a[1] * half, a[2] * half);
    if (Math.abs(sb) <= eps) push(b[0] * half, b[1] * half, b[2] * half);
    if (sa * sb < -eps * eps) {
      const t = sa / (sa - sb);
      push(
        (a[0] + (b[0] - a[0]) * t) * half,
        (a[1] + (b[1] - a[1]) * t) * half,
        (a[2] + (b[2] - a[2]) * t) * half,
      );
    }
  }
  if (pts.length < 3) return [];

  // 面内基底 (u, v) を作り、重心まわりの角度で整列する
  const ux0 = Math.abs(n.x) < 0.9 ? 1 : 0;
  const uy0 = Math.abs(n.x) < 0.9 ? 0 : 1;
  // u = e × n(e は n と平行でない軸)
  let ux = uy0 * n.z - 0 * n.y;
  let uy = 0 * n.x - ux0 * n.z;
  let uz = ux0 * n.y - uy0 * n.x;
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  // v = n × u / |n|
  const vx = (n.y * uz - n.z * uy) / nLen;
  const vy = (n.z * ux - n.x * uz) / nLen;
  const vz = (n.x * uy - n.y * ux) / nLen;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  cx /= pts.length;
  cy /= pts.length;
  cz /= pts.length;
  return pts
    .map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      return {
        p,
        angle: Math.atan2(
          dx * vx + dy * vy + dz * vz,
          dx * ux + dy * uy + dz * uz,
        ),
      };
    })
    .sort((a, b) => a.angle - b.angle)
    .map((e) => e.p);
}

/* ------------------------------------------------- 2D 格子点の窓内列挙 */

/**
 * 基本ベクトル a1, a2 が張る 2D 格子のうち、原点中心・半径 r の円窓に
 * 入る点を out([x0, y0, x1, y1, …])へ書き込み、点数を返す。
 * out が足りない場合は入る分だけ書いて打ち切る。
 */
export function latticePointsInDisk(
  a1: Vec2,
  a2: Vec2,
  r: number,
  out: Float64Array,
): number {
  const { b1, b2 } = dualBasis2(a1, a2);
  // p = i·a1 + j·a2 のとき i = p·b1 なので |i| ≤ r|b1|(j も同様)
  const iMax = Math.ceil(r * Math.hypot(b1.x, b1.y));
  const jMax = Math.ceil(r * Math.hypot(b2.x, b2.y));
  const r2 = r * r;
  let n = 0;
  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      const x = i * a1.x + j * a2.x;
      const y = i * a1.y + j * a2.y;
      if (x * x + y * y > r2) continue;
      if (n * 2 + 1 >= out.length) return n;
      out[n * 2] = x;
      out[n * 2 + 1] = y;
      n++;
    }
  }
  return n;
}
