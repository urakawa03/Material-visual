/**
 * formfactors.ts — 原子散乱因子と中性子散乱長の表(仕様書 08 §5.0)
 *
 * X 線: 国際結晶学表 Vol. C(Table 6.1.1.4)の Cromer–Mann 係数。
 *   f(s) = Σ_{i=1}^{4} a_i exp(−b_i s²) + c、s = sinθ/λ [Å⁻¹]
 * この記事では s を nm⁻¹ で扱う(仕様書 08 §2.3)ので、内部で Å⁻¹ に
 * 換算する(1 nm⁻¹ = 0.1 Å⁻¹)。イオン(Na⁺・Cl⁻・K⁺)は区別せず中性原子の
 * 値で代用する(図注で明示 — 付録 A-2)。
 *
 * 中性子: NIST Center for Neutron Research の干渉性散乱長 b_c [fm]
 * (V. F. Sears, Neutron News 3 (1992) 26 の表)。天然同位体組成の値。
 *
 * 転記ミスは f(0) = Σa_i + c が原子番号 Z と 0.1 以内で一致することで
 * 検出する(formfactors.test.ts — 仕様書 08 §5.8 T5)。
 */

/** 放射線の種類(仕様書 08 §5.0 の rad 引数) */
export type Radiation = "xray" | "neutron";

/** この記事で扱う元素(図5 の並び順 = 原子番号順) */
export type ElementId =
  "H" | "Na" | "Si" | "Cl" | "K" | "Fe" | "Cu" | "Zn" | "Cs" | "Au";

/** 図5 のトグルの並び(原子番号順) */
export const ELEMENT_IDS: readonly ElementId[] = [
  "H",
  "Na",
  "Si",
  "Cl",
  "K",
  "Fe",
  "Cu",
  "Zn",
  "Cs",
  "Au",
];

/** Cromer–Mann 係数(s は Å⁻¹) */
export interface CromerMann {
  a: readonly [number, number, number, number];
  b: readonly [number, number, number, number];
  c: number;
}

export interface ElementData {
  /** 元素記号 */
  symbol: ElementId;
  /** 日本語名 */
  name: string;
  /** 原子番号(= 中性原子の電子数) */
  Z: number;
  /** X 線の原子散乱因子の係数 */
  cm: CromerMann;
  /** 中性子の干渉性散乱長 b_c [fm](H は負) */
  bFm: number;
}

/** 元素ごとの表(1 箇所にまとめる — 仕様書 08 §5.0) */
export const ELEMENTS: Readonly<Record<ElementId, ElementData>> = {
  H: {
    symbol: "H",
    name: "水素",
    Z: 1,
    cm: {
      a: [0.493002, 0.322912, 0.140191, 0.04081],
      b: [10.5109, 26.1257, 3.14236, 57.7997],
      c: 0.003038,
    },
    bFm: -3.739,
  },
  Na: {
    symbol: "Na",
    name: "ナトリウム",
    Z: 11,
    cm: {
      a: [4.7626, 3.1736, 1.2674, 1.1128],
      b: [3.285, 8.8422, 0.3136, 129.424],
      c: 0.676,
    },
    bFm: 3.63,
  },
  Si: {
    symbol: "Si",
    name: "ケイ素",
    Z: 14,
    cm: {
      a: [6.2915, 3.0353, 1.9891, 1.541],
      b: [2.4386, 32.3337, 0.6785, 81.6937],
      c: 1.1407,
    },
    bFm: 4.1491,
  },
  Cl: {
    symbol: "Cl",
    name: "塩素",
    Z: 17,
    cm: {
      a: [11.4604, 7.1964, 6.2556, 1.6455],
      b: [0.0104, 1.1662, 18.5194, 47.7784],
      c: -9.5574,
    },
    bFm: 9.577,
  },
  K: {
    symbol: "K",
    name: "カリウム",
    Z: 19,
    cm: {
      a: [8.2186, 7.4398, 1.0519, 0.8659],
      b: [12.7949, 0.7748, 213.187, 41.6841],
      c: 1.4228,
    },
    bFm: 3.67,
  },
  Fe: {
    symbol: "Fe",
    name: "鉄",
    Z: 26,
    cm: {
      a: [11.7695, 7.3573, 3.5222, 2.3045],
      b: [4.7611, 0.3072, 15.3535, 76.8805],
      c: 1.0369,
    },
    bFm: 9.45,
  },
  Cu: {
    symbol: "Cu",
    name: "銅",
    Z: 29,
    cm: {
      a: [13.338, 7.1676, 5.6158, 1.6735],
      b: [3.5828, 0.247, 11.3966, 64.8126],
      c: 1.191,
    },
    bFm: 7.718,
  },
  Zn: {
    symbol: "Zn",
    name: "亜鉛",
    Z: 30,
    cm: {
      a: [14.0743, 7.0318, 5.1652, 2.41],
      b: [3.2655, 0.2333, 10.3163, 58.7097],
      c: 1.3041,
    },
    bFm: 5.68,
  },
  Cs: {
    symbol: "Cs",
    name: "セシウム",
    Z: 55,
    cm: {
      a: [20.3892, 19.1062, 10.662, 1.4953],
      b: [3.569, 0.3107, 24.3879, 213.904],
      c: 3.3352,
    },
    bFm: 5.42,
  },
  Au: {
    symbol: "Au",
    name: "金",
    Z: 79,
    cm: {
      a: [16.8819, 18.5913, 25.5582, 5.86],
      b: [0.4611, 8.6216, 1.4826, 36.3956],
      c: 12.0658,
    },
    bFm: 7.63,
  },
};

/**
 * 重水素 D の中性子散乱長 [fm](NIST)。本文で「水素(重水素)は中性子で
 * 見える」と述べるときの値。X 線では H と区別できない(電子 1 個)ので、
 * 図5 の元素の並びには入れていない。
 */
export const DEUTERIUM_B_FM = 6.671;

/** nm⁻¹ → Å⁻¹ */
const NM_INV_TO_A_INV = 0.1;

/**
 * X 線の原子散乱因子 f(s)(電子数単位)。s = sinθ/λ [nm⁻¹]。
 * Cromer–Mann の 4 ガウス + 定数(s ≤ 20 nm⁻¹ で有効)。
 */
export function xrayFormFactor(el: ElementId, sNm: number): number {
  const { a, b, c } = ELEMENTS[el].cm;
  const sA = sNm * NM_INV_TO_A_INV;
  const s2 = sA * sA;
  return (
    a[0] * Math.exp(-b[0] * s2) +
    a[1] * Math.exp(-b[1] * s2) +
    a[2] * Math.exp(-b[2] * s2) +
    a[3] * Math.exp(-b[3] * s2) +
    c
  );
}

/** 中性子の散乱長 b [fm](角度によらない — 原子核は点とみなせる) */
export function neutronLength(el: ElementId): number {
  return ELEMENTS[el].bFm;
}

/**
 * 放射線ごとの「散乱の強さ」: X 線は f(s) [電子]、中性子は b [fm]。
 * 構造因子(structurefactor.ts)の矢の長さとして使う。
 */
export function scatteringAmplitude(
  el: ElementId,
  sNm: number,
  rad: Radiation,
): number {
  return rad === "xray" ? xrayFormFactor(el, sNm) : neutronLength(el);
}

/** halfFormFactorS の探索上限 [nm⁻¹](Cromer–Mann の有効範囲 2 Å⁻¹) */
const HALF_SEARCH_MAX_NM = 20;
/** 二分法の反復回数(区間 20 nm⁻¹ を 2⁻⁴⁰ まで詰める) */
const BISECTION_STEPS = 40;

/**
 * f(s) が f(0) の半分になる s [nm⁻¹](図5 の読み取り値)。f は s に対して
 * 単調減少なので二分法で求める。探索範囲内で半分に届かなければ null。
 */
export function halfFormFactorS(el: ElementId): number | null {
  const target = xrayFormFactor(el, 0) / 2;
  if (xrayFormFactor(el, HALF_SEARCH_MAX_NM) > target) return null;
  let lo = 0;
  let hi = HALF_SEARCH_MAX_NM;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (xrayFormFactor(el, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
