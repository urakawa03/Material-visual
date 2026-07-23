/**
 * mathx.ts — 数学ユーティリティ(仕様書 §7.3)
 *
 * 毎フレームのオブジェクト割当てを避けるため、ベクトル演算は結果の
 * 書き込み先(out)を受け取る API を基本とする。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 新しい Vec2 を作る(初期化時のみ使い、フレーム内では使わないこと) */
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

/** 新しい Vec3 を作る(初期化時のみ使い、フレーム内では使わないこと) */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function set2(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copy2(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function add2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function sub2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scale2(out: Vec2, a: Vec2, s: number): Vec2 {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function len2(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 正規化。零ベクトルの場合は out を (0, 0) にする */
export function normalize2(out: Vec2, a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  out.x = a.x / l;
  out.y = a.y / l;
  return out;
}

export function lerp2(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

export function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy3(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function add3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale3(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function len3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** 正規化。零ベクトルの場合は out を (0, 0, 0) にする */
export function normalize3(out: Vec3, a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  out.x = a.x / l;
  out.y = a.y / l;
  out.z = a.z / l;
  return out;
}

export function lerp3(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** v を [lo, hi] に収める */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 線形補間 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** smoothstep(edge0 → edge1 で 0 → 1 に滑らかに変化) */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 区間 [inLo, inHi] の値 v を区間 [outLo, outHi] に写像する。
 * clampResult に true を渡すと出力区間に収める。
 */
export function remap(
  v: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
  clampResult = false,
): number {
  const t = (v - inLo) / (inHi - inLo);
  const r = outLo + (outHi - outLo) * t;
  return clampResult
    ? clamp(r, Math.min(outLo, outHi), Math.max(outLo, outHi))
    : r;
}

/**
 * シード付き乱数生成器(mulberry32)。
 * 同じシードからは常に同じ乱数列が得られる(§8.2: reset の再現性)。
 * 戻り値の関数は [0, 1) の一様乱数を返す。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 標準正規分布 N(0, 1) の乱数生成器(Marsaglia polar 法)。
 * 一様乱数源 rand(mulberry32 など)を渡す。シードを固定すれば再現可能。
 */
export function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
}

/* ---- イージング(t: 0〜1) ---- */

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}
