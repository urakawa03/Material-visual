/**
 * structures.ts — 記事「構造因子と消滅則」のモデル物質(仕様書 08 §2.3)
 *
 * 分率座標・格子定数・規則化の占有率を 1 箇所だけに置く。各物質は
 * 「格子(慣用単位胞の格子点)+ 基底(各格子点に置く原子の組)」として
 * 定義し、単位胞の原子(サイト)はその組み合わせで作る。こうしておくと、
 * 図2 の「格子 + 基底に分けて表示」と構造因子の計算が同じデータから出る。
 *
 * 規則化合金(CuZn・Cu₃Au — 図7)は、各サイトの占有率を規則度 η で
 * 線形に決める(仕様書 08 §5.7)。
 *
 * 慣習: 分率座標は慣用単位胞の辺 a を 1 とする。長さは nm。
 */

import type { CubicLattice } from "../../reciprocal-lattice/lattice";
import type { ElementId } from "./formfactors";

export type { CubicLattice };

/** サイトを占める元素と、その確率(占有率) */
export interface Occupant {
  el: ElementId;
  p: number;
}

/** 単位胞の中の原子 1 個(またはサイト 1 個)。分率座標は [0, 1) */
export interface Site {
  x: number;
  y: number;
  z: number;
  occ: readonly Occupant[];
}

/** 基底の原子 1 個(格子点からの変位 + 占有) */
export interface BasisAtom {
  dx: number;
  dy: number;
  dz: number;
  occ: readonly Occupant[];
}

export interface CrystalStructure {
  /** 物質の識別子 */
  id: string;
  /** 化学式・元素名(表示用。例 "Si") */
  label: string;
  /** 構造の名前(表示用。例 "ダイヤモンド構造") */
  structureName: string;
  /** 格子定数 a [nm] */
  a: number;
  /** 格子(慣用単位胞のブラベー格子)。逆格子空間の記事の isAllowed と同じ名前 */
  lattice: CubicLattice;
  /** 基底(格子点 1 個あたりに置く原子の組) */
  basis: readonly BasisAtom[];
  /** 単位胞の中の全原子(格子点 × 基底。分率座標は [0, 1) に畳み込み済み) */
  sites: readonly Site[];
}

/** 慣用単位胞の中の格子点(分率座標)— 逆格子空間の記事の §5.7 と同じ */
export const LATTICE_POINTS: Readonly<
  Record<CubicLattice, ReadonlyArray<readonly [number, number, number]>>
> = {
  sc: [[0, 0, 0]],
  bcc: [
    [0, 0, 0],
    [0.5, 0.5, 0.5],
  ],
  fcc: [
    [0, 0, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
    [0.5, 0.5, 0],
  ],
};

/** 格子の日本語名(読み取り値・凡例) */
export const LATTICE_NAMES: Readonly<Record<CubicLattice, string>> = {
  sc: "単純立方",
  bcc: "体心立方",
  fcc: "面心立方",
};

/** 分率座標を [0, 1) へ畳み込む(1 → 0 の丸め誤差も吸収する) */
function wrap01(v: number): number {
  const w = v - Math.floor(v);
  return w > 1 - 1e-12 ? 0 : w;
}

/**
 * 格子 + 基底から単位胞の全サイトを作る。並び順は「基底の原子ごとに、
 * 格子点を順に」— 図3 の矢の列が「1 つめの副格子 → 2 つめの副格子」の
 * 順に継ぎ足されるようにするため。
 */
export function buildSites(
  lattice: CubicLattice,
  basis: readonly BasisAtom[],
): Site[] {
  const sites: Site[] = [];
  for (const b of basis) {
    for (const [lx, ly, lz] of LATTICE_POINTS[lattice]) {
      sites.push({
        x: wrap01(lx + b.dx),
        y: wrap01(ly + b.dy),
        z: wrap01(lz + b.dz),
        occ: b.occ,
      });
    }
  }
  return sites;
}

function pure(el: ElementId): readonly Occupant[] {
  return [{ el, p: 1 }];
}

function make(
  id: string,
  label: string,
  structureName: string,
  a: number,
  lattice: CubicLattice,
  basis: readonly BasisAtom[],
): CrystalStructure {
  return {
    id,
    label,
    structureName,
    a,
    lattice,
    basis,
    sites: buildSites(lattice, basis),
  };
}

const ORIGIN = { dx: 0, dy: 0, dz: 0 } as const;
const BODY_CENTER = { dx: 0.5, dy: 0.5, dz: 0.5 } as const;
const QUARTER = { dx: 0.25, dy: 0.25, dz: 0.25 } as const;

/** 単純立方(仮想)。a = 0.30 nm、Cu の原子 1 個(仕様書 08 §2.3) */
export const SIMPLE_CUBIC = make("sc", "単純立方", "単純立方", 0.3, "sc", [
  { ...ORIGIN, occ: pure("Cu") },
]);

/** Fe(体心立方)a = 0.2867 nm */
export const FE = make("fe", "Fe", "体心立方", 0.2867, "bcc", [
  { ...ORIGIN, occ: pure("Fe") },
]);

/**
 * Fe の別の見方: 単純立方の格子 + 2 原子の基底(角と体心を 1 組)。
 * 原子の並びは FE と同じ(図2 の「体心立方の見方」— 仕様書 08 §5.2)。
 */
export const FE_AS_SC = make("fe-sc", "Fe", "体心立方", 0.2867, "sc", [
  { ...ORIGIN, occ: pure("Fe") },
  { ...BODY_CENTER, occ: pure("Fe") },
]);

/** Cu(面心立方)a = 0.3615 nm */
export const CU = make("cu", "Cu", "面心立方", 0.3615, "fcc", [
  { ...ORIGIN, occ: pure("Cu") },
]);

/** Si(ダイヤモンド構造)= 面心立方 + 2 原子の基底 (0,0,0)・(¼,¼,¼)。a = 0.5431 nm */
export const SI = make("si", "Si", "ダイヤモンド構造", 0.5431, "fcc", [
  { ...ORIGIN, occ: pure("Si") },
  { ...QUARTER, occ: pure("Si") },
]);

/** NaCl(岩塩型)= 面心立方 + Na (0,0,0)・Cl (½,½,½)。a = 0.5640 nm */
export const NACL = make("nacl", "NaCl", "岩塩型", 0.564, "fcc", [
  { ...ORIGIN, occ: pure("Na") },
  { ...BODY_CENTER, occ: pure("Cl") },
]);

/** KCl(岩塩型)。K⁺ と Cl⁻ はどちらも 18 電子(図6)。a = 0.6293 nm */
export const KCL = make("kcl", "KCl", "岩塩型", 0.6293, "fcc", [
  { ...ORIGIN, occ: pure("K") },
  { ...BODY_CENTER, occ: pure("Cl") },
]);

/** CsCl(CsCl 型)= 単純立方 + Cs (0,0,0)・Cl (½,½,½)。a = 0.4123 nm */
export const CSCL = make("cscl", "CsCl", "CsCl 型", 0.4123, "sc", [
  { ...ORIGIN, occ: pure("Cs") },
  { ...BODY_CENTER, occ: pure("Cl") },
]);

/* ------------------------------------------------- 規則化合金(図7) */

export type AlloyId = "CuZn" | "Cu3Au";

export interface AlloyInfo {
  id: AlloyId;
  /** 表示名 */
  label: string;
  /** 格子定数 a [nm] */
  a: number;
  /** 1 種類目(--mat-matrix)と 2 種類目(--mat-second)の元素 */
  elA: ElementId;
  elB: ElementId;
  /** 不規則状態の格子(基本反射の存在則)。超格子反射はこれが禁じる反射 */
  disorderedLattice: CubicLattice;
  /** 規則状態の構造の名前 */
  orderedName: string;
  /** 不規則状態の構造の名前 */
  disorderedName: string;
}

export const ALLOYS: Readonly<Record<AlloyId, AlloyInfo>> = {
  CuZn: {
    id: "CuZn",
    label: "CuZn",
    a: 0.2952,
    elA: "Cu",
    elB: "Zn",
    disorderedLattice: "bcc",
    orderedName: "CsCl 型",
    disorderedName: "体心立方",
  },
  Cu3Au: {
    id: "Cu3Au",
    label: "Cu₃Au",
    a: 0.3749,
    elA: "Cu",
    elB: "Au",
    disorderedLattice: "fcc",
    orderedName: "L1₂ 型",
    disorderedName: "面心立方",
  },
};

/**
 * 規則度 η(0〜1)の合金の構造。どちらも単純立方の格子 + 占有率つきの
 * 基底として書く(η = 0 で全サイトが平均組成 = 不規則、η = 1 で完全な
 * 規則配列 — 仕様書 08 §5.7)。
 *
 * CuZn(B2): α = (0,0,0)、β = (½,½,½)。p_Cu(α) = (1+η)/2、p_Cu(β) = (1−η)/2。
 * Cu₃Au(L1₂): α = (0,0,0) が Au の席、β = 3 つの面心が Cu の席。
 *   p_Au(α) = ¼ + ¾η、p_Au(β) = ¼ − ¼η(平均組成 Au 25% を保つ)。
 * いずれも超格子反射の F は η(f_A − f_B) に比例する(式 E6)。
 */
export function orderedAlloy(id: AlloyId, eta: number): CrystalStructure {
  const info = ALLOYS[id];
  const { elA, elB } = info;
  if (id === "CuZn") {
    const pAlpha = (1 + eta) / 2;
    const pBeta = (1 - eta) / 2;
    return make(id, info.label, info.orderedName, info.a, "sc", [
      {
        ...ORIGIN,
        occ: [
          { el: elA, p: pAlpha },
          { el: elB, p: 1 - pAlpha },
        ],
      },
      {
        ...BODY_CENTER,
        occ: [
          { el: elA, p: pBeta },
          { el: elB, p: 1 - pBeta },
        ],
      },
    ]);
  }
  // Cu₃Au: B = Au(少数派)の占有率で書く
  const pAuAlpha = 0.25 + 0.75 * eta;
  const pAuBeta = 0.25 - 0.25 * eta;
  const alphaOcc: readonly Occupant[] = [
    { el: elA, p: 1 - pAuAlpha },
    { el: elB, p: pAuAlpha },
  ];
  const betaOcc: readonly Occupant[] = [
    { el: elA, p: 1 - pAuBeta },
    { el: elB, p: pAuBeta },
  ];
  return make(id, info.label, info.orderedName, info.a, "sc", [
    { ...ORIGIN, occ: alphaOcc },
    { dx: 0, dy: 0.5, dz: 0.5, occ: betaOcc },
    { dx: 0.5, dy: 0, dz: 0.5, occ: betaOcc },
    { dx: 0.5, dy: 0.5, dz: 0, occ: betaOcc },
  ]);
}

/* ------------------------------------------- 単位胞の絵(図2・図3 用) */

/** 慣用単位胞 [0,1]³ の中に描く原子の像 1 個 */
export interface CellImage {
  /** 分率座標(0〜1。角・辺・面の上の像は 1 も取る) */
  x: number;
  y: number;
  z: number;
  /** 何番目のサイトの像か(structure.sites の添字) */
  site: number;
  /**
   * 単位胞への寄与の割合(角 1/8・辺 1/4・面 1/2・内部 1)。
   * 全像の合計がサイトの数(単位胞の原子数)になる。
   */
  share: number;
}

/** 0 または 1 とみなす許容差 */
const FACE_EPS = 1e-9;

/**
 * 慣用単位胞 [0,1]³ に描く原子の像を列挙する。座標が 0 の成分は 1 にも
 * 像を置く(角は 8 か所、辺の中点は 4 か所、面心は 2 か所に現れる)。
 * share の合計は単位胞の原子数(Fe 2・Cu 4・Si 8・NaCl 8・CsCl 2)。
 */
export function cellImages(structure: CrystalStructure): CellImage[] {
  const out: CellImage[] = [];
  structure.sites.forEach((s, site) => {
    const xs = Math.abs(s.x) < FACE_EPS ? [0, 1] : [s.x];
    const ys = Math.abs(s.y) < FACE_EPS ? [0, 1] : [s.y];
    const zs = Math.abs(s.z) < FACE_EPS ? [0, 1] : [s.z];
    const share = 1 / (xs.length * ys.length * zs.length);
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          out.push({ x, y, z, site, share });
        }
      }
    }
  });
  return out;
}

/** 単位胞の原子数(像の share の合計 = サイト数) */
export function atomsPerCell(structure: CrystalStructure): number {
  return cellImages(structure).reduce((sum, im) => sum + im.share, 0);
}

/** サイトの主な元素(占有率が最大のもの) */
export function majorElement(site: Site): ElementId {
  let best = site.occ[0];
  for (const o of site.occ) if (o.p > best.p) best = o;
  return best.el;
}

/**
 * 図中で「2 種類目の原子」(--mat-second)として描く元素か。
 * 仕様書 08 §2.3: 1 種類目(Fe・Cu・Si・Na・K・Cs)は --mat-matrix、
 * 2 種類目(Cl・Zn・Au)は --mat-second(カーケンドールの B 原子と同じ意味)。
 */
export function isSecondSpecies(el: ElementId): boolean {
  return el === "Cl" || el === "Zn" || el === "Au";
}
