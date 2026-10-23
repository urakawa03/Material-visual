/**
 * structurefactor.ts — 構造因子・強度・多重度・粉末図形(仕様書 08 §5.0 の純関数)
 *
 * 記事「構造因子と消滅則」の全図版が共有する計算をここに集約する。DOM・
 * Canvas・three.js に依存しない純粋関数のみを置き、単体テスト
 * (structurefactor.test.ts)の対象とする。
 *
 * 慣習(仕様書 08 §2.3 — 逆格子空間・エヴァルト球の記事と同一):
 * - |k| = 1/λ、|g_hkl| = 1/d_hkl。2π は付けない。
 * - 構造因子の位相は分率座標で 2π(hx_j + ky_j + lz_j)(式 E1)。この 2π は
 *   分率座標を角度に直すためのもので、慣習によらず付く(逆格子空間の記事の
 *   e^{2πi q·r} と同じ形)。
 * - s = sinθ/λ = 1/(2d) [nm⁻¹](式 E7)。
 *
 * 線の位置(2θ)はエヴァルト球の記事の twoThetaDeg をそのまま使い、
 * 環のまとめ方・多重度の数え方は同じ記事の powderRings と一致させる
 * (仕様書 08 §5.8 T6・T7)。
 */

import { dCubic, isAllowed } from "../../reciprocal-lattice/lattice";
import { twoThetaDeg } from "../../ewald-sphere/ewald";
import { formatHkl } from "../../ewald-sphere/constants";
import { scatteringAmplitude, type Radiation } from "./formfactors";
import type { CrystalStructure, Site } from "./structures";

export type { Radiation };
/** (h k l) の表示は前の 2 記事と同じ空白区切り(ewald-sphere/constants.ts) */
export { formatHkl };

/** 複素数(構造因子の値) */
export interface Complex {
  re: number;
  im: number;
}

const TAU = Math.PI * 2;
/** 1/4 回転の整数倍とみなす許容差(分率座標が ¼ の倍数の構造で位相を厳密にする) */
const QUARTER_EPS = 1e-9;

/**
 * 位相の回転数 t = hx + ky + lz を [0, 1) に畳み込んだもの
 * (位相 = 2πt。図3 の時計の針・矢の向き)。
 */
export function phaseTurns(
  site: Site,
  h: number,
  k: number,
  l: number,
): number {
  const t = h * site.x + k * site.y + l * site.z;
  const w = t - Math.floor(t);
  return w > 1 - 1e-12 ? 0 : w;
}

/** スクラッチ(cos, sin)。structureFactor の内側で割当てを避ける */
const unitScratch = { c: 0, s: 0 };

/**
 * 回転数 t の単位複素数 e^{2πit} を unitScratch へ書く。t が ¼ の整数倍なら
 * 厳密な値(±1, ±i)を使う — 消滅則の F = 0 を丸め誤差なしで出すため。
 */
function unitPhasor(t: number): void {
  const q = t * 4;
  const qi = Math.round(q);
  if (Math.abs(q - qi) < QUARTER_EPS) {
    switch (((qi % 4) + 4) % 4) {
      case 0:
        unitScratch.c = 1;
        unitScratch.s = 0;
        return;
      case 1:
        unitScratch.c = 0;
        unitScratch.s = 1;
        return;
      case 2:
        unitScratch.c = -1;
        unitScratch.s = 0;
        return;
      default:
        unitScratch.c = 0;
        unitScratch.s = -1;
        return;
    }
  }
  unitScratch.c = Math.cos(TAU * t);
  unitScratch.s = Math.sin(TAU * t);
}

/**
 * サイトの平均の散乱の強さ f̄ = Σ p_el f_el(s)(占有率つき — 仕様書 08 §5.7)。
 * X 線は電子数、中性子は fm。
 */
export function siteAmplitude(site: Site, sNm: number, rad: Radiation): number {
  let f = 0;
  for (const o of site.occ) f += o.p * scatteringAmplitude(o.el, sNm, rad);
  return f;
}

/**
 * 構造因子 F_hkl = Σ_j f_j e^{2πi(hx_j + ky_j + lz_j)}(式 E1)。
 * sNm は f(s) を評価する s = sinθ/λ [nm⁻¹](図3・図4 は s = 0)。
 * out を渡すとそこへ書いて返す(割当てなし)。
 */
export function structureFactor(
  structure: CrystalStructure,
  h: number,
  k: number,
  l: number,
  sNm: number,
  rad: Radiation,
  out: Complex = { re: 0, im: 0 },
): Complex {
  let re = 0;
  let im = 0;
  for (const site of structure.sites) {
    const f = siteAmplitude(site, sNm, rad);
    unitPhasor(phaseTurns(site, h, k, l));
    re += f * unitScratch.c;
    im += f * unitScratch.s;
  }
  out.re = re;
  out.im = im;
  return out;
}

/** structureFactor2 の書き込み先(割当てを避ける) */
const scratchF: Complex = { re: 0, im: 0 };

/** |F|² */
export function structureFactor2(
  structure: CrystalStructure,
  h: number,
  k: number,
  l: number,
  sNm: number,
  rad: Radiation,
): number {
  const F = structureFactor(structure, h, k, l, sNm, rad, scratchF);
  return F.re * F.re + F.im * F.im;
}

/**
 * |F|² を「0」とみなす基準: (Σ_j |f̄_j(0)|)²(全部の矢がそろったときの
 * |F|² の上限)。消滅の判定はこれに F2_ZERO_EPS を掛けた値で行う。
 */
export function referenceF2(
  structure: CrystalStructure,
  rad: Radiation,
): number {
  let sum = 0;
  for (const site of structure.sites) {
    for (const o of site.occ) {
      sum += o.p * Math.abs(scatteringAmplitude(o.el, 0, rad));
    }
  }
  return sum * sum;
}

/** |F|² を 0 とみなす閾値(referenceF2 に対する相対値) */
export const F2_ZERO_EPS = 1e-12;

/** その反射が消えるか(|F|² ≤ referenceF2 × F2_ZERO_EPS) */
export function isExtinct(
  structure: CrystalStructure,
  h: number,
  k: number,
  l: number,
  sNm: number,
  rad: Radiation,
): boolean {
  return (
    structureFactor2(structure, h, k, l, sNm, rad) <=
    referenceF2(structure, rad) * F2_ZERO_EPS
  );
}

/** 図3 の矢 1 本(原子 1 個の寄与) */
export interface PhasorStep {
  /** structure.sites の添字 */
  site: number;
  /** 矢の長さ f_j */
  f: number;
  /** 位相の回転数(位相 = 2π × turns) */
  turns: number;
  /** 矢の始点・終点(複素平面。始点 = 前の矢の終点) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 図3 の矢の列(頭と尾をつないだ各原子の寄与)。最後の終点が F と一致する
 * (structureFactor と同じ順序・同じ演算で足すので丸め誤差まで一致 — T9)。
 */
export function phasorChain(
  structure: CrystalStructure,
  h: number,
  k: number,
  l: number,
  sNm: number,
  rad: Radiation,
): PhasorStep[] {
  const steps: PhasorStep[] = [];
  let re = 0;
  let im = 0;
  structure.sites.forEach((site, i) => {
    const f = siteAmplitude(site, sNm, rad);
    const turns = phaseTurns(site, h, k, l);
    unitPhasor(turns);
    const x0 = re;
    const y0 = im;
    re += f * unitScratch.c;
    im += f * unitScratch.s;
    steps.push({ site: i, f, turns, x0, y0, x1: re, y1: im });
  });
  return steps;
}

/* ------------------------------------------------------- 粉末回折の強度 */

/** 立方晶の多重度: (±h, ±k, ±l) の並べ替えで作れる異なる反射の数 */
export function multiplicity(h: number, k: number, l: number): number {
  const v = [h, k, l];
  const seen = new Set<string>();
  for (const [i, j, m] of PERMUTATIONS) {
    for (const sx of SIGNS) {
      for (const sy of SIGNS) {
        for (const sz of SIGNS) {
          seen.add(`${sx * v[i]},${sy * v[j]},${sz * v[m]}`);
        }
      }
    }
  }
  return seen.size;
}

const PERMUTATIONS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const SIGNS: readonly number[] = [1, -1];

/**
 * ローレンツ偏光因子(式 E5)。θ は度(ブラッグ角。2θ の半分)。
 * X 線: L_p = (1 + cos²2θ)/(sin²θ cosθ)。
 * 中性子は偏光の項がないのでローレンツ因子 1/(sin²θ cosθ) だけを使う。
 */
export function lorentzPolarization(thetaDeg: number, rad: Radiation): number {
  const th = (thetaDeg * Math.PI) / 180;
  const sin = Math.sin(th);
  const lorentz = 1 / (sin * sin * Math.cos(th));
  if (rad === "neutron") return lorentz;
  const c2 = Math.cos(2 * th);
  return (1 + c2 * c2) * lorentz;
}

/** 1 本の反射の強度の内訳(式 E5) */
export interface IntensityTerms {
  /** |F|²(s = 1/(2d) の f で評価) */
  F2: number;
  /** 多重度 */
  m: number;
  /** ローレンツ偏光因子 */
  Lp: number;
  /** I = |F|² m L_p(相対値) */
  I: number;
  /** 散乱角 2θ [度] */
  twoTheta: number;
  /** 面間隔 d [nm] */
  d: number;
  /** s = 1/(2d) [nm⁻¹] */
  s: number;
}

/**
 * 反射 (hkl) の強度の内訳(式 E5)。λ [nm] で届かない反射(λ > 2d)と
 * 000 は null。
 */
export function intensityTerms(
  structure: CrystalStructure,
  h: number,
  k: number,
  l: number,
  lambda: number,
  rad: Radiation = "xray",
): IntensityTerms | null {
  if (h === 0 && k === 0 && l === 0) return null;
  const d = dCubic(h, k, l, structure.a);
  const tt = twoThetaDeg(d, lambda);
  if (tt === null) return null;
  const s = 1 / (2 * d);
  const F2 = structureFactor2(structure, h, k, l, s, rad);
  const m = multiplicity(h, k, l);
  const Lp = lorentzPolarization(tt / 2, rad);
  return { F2, m, Lp, I: F2 * m * Lp, twoTheta: tt, d, s };
}

/* ------------------------------------------------------------ 粉末図形 */

/** 同じ h²+k²+l² をもつ反射の族 {hkl} 1 つ */
export interface HklForm {
  /** |h| ≥ |k| ≥ |l| の非負の組 */
  h: number;
  k: number;
  l: number;
  /** 族の多重度 */
  m: number;
}

/** 粉末図形の環(線)1 本の、波長によらない部分 */
export interface PowderRingBase {
  /** h² + k² + l²(環の並び順) */
  n2: number;
  /** 代表の指数(ewald.ts の powderRings と同じ: 先頭の族) */
  h: number;
  k: number;
  l: number;
  /** この環に重なる族(n2 = 9 の {300} と {221} など。先頭が代表) */
  forms: HklForm[];
  /** 面間隔 d = a/√n2 [nm] */
  d: number;
  /** s = 1/(2d) [nm⁻¹] */
  s: number;
  /** 格子(structure.lattice)が許す反射の数(= powderRings の多重度) */
  m: number;
  /** 構造因子が 0 でない反射の数 */
  mNonzero: number;
  /** 環の全反射の |F|² の和 */
  sumF2: number;
  /** 反射 1 本あたりの |F|²(0 でない反射の平均。全部 0 なら 0) */
  F2: number;
  /** 格子の言葉で許される環か(逆格子空間の記事の isAllowed) */
  latticeAllowed: boolean;
}

/** 波長を決めた粉末図形の線 1 本(仕様書 08 §5.0 の {2θ, d, hkl, m, I}) */
export interface PowderLine extends PowderRingBase {
  /** 散乱角 2θ [度](エヴァルト球の記事の twoThetaDeg) */
  twoTheta: number;
  /** ローレンツ偏光因子 */
  Lp: number;
  /** I = Σ|F|² × L_p(= |F|² m L_p。相対値) */
  I: number;
}

/**
 * 環ごとの、波長によらない量を求める(|h|,|k|,|l| ≤ maxIndex の全反射を
 * 数える)。環のまとめ方は ewald.ts の powderRings と同じ: 同じ h²+k²+l² の
 * 反射を 1 本にまとめる。|F|² は環の全反射について個別に計算して足す。
 * 消える環(F = 0)・格子が禁じる環も含めて返す(図1 の「欠けた線」用)。
 */
export function powderRingBase(
  structure: CrystalStructure,
  maxIndex: number,
  rad: Radiation = "xray",
): PowderRingBase[] {
  interface Acc {
    n2: number;
    forms: Map<string, HklForm>;
    m: number;
    mNonzero: number;
    sumF2: number;
  }
  const byN2 = new Map<number, Acc>();
  const a = structure.a;
  const zero = referenceF2(structure, rad) * F2_ZERO_EPS;
  for (let h = -maxIndex; h <= maxIndex; h++) {
    for (let k = -maxIndex; k <= maxIndex; k++) {
      for (let l = -maxIndex; l <= maxIndex; l++) {
        const n2 = h * h + k * k + l * l;
        if (n2 === 0) continue;
        let acc = byN2.get(n2);
        if (!acc) {
          acc = { n2, forms: new Map(), m: 0, mNonzero: 0, sumF2: 0 };
          byN2.set(n2, acc);
        }
        const sorted = [Math.abs(h), Math.abs(k), Math.abs(l)].sort(
          (p, q) => q - p,
        );
        const key = sorted.join(",");
        if (!acc.forms.has(key)) {
          acc.forms.set(key, {
            h: sorted[0],
            k: sorted[1],
            l: sorted[2],
            m: multiplicity(sorted[0], sorted[1], sorted[2]),
          });
        }
        if (!isAllowed(structure.lattice, h, k, l)) continue;
        acc.m++;
        const s = Math.sqrt(n2) / (2 * a);
        const F2 = structureFactor2(structure, h, k, l, s, rad);
        if (F2 > zero) {
          acc.sumF2 += F2;
          acc.mNonzero++;
        }
      }
    }
  }

  const rings: PowderRingBase[] = [];
  for (const acc of byN2.values()) {
    // 代表は先頭の族(|h| の大きい順 — powderRings の走査順で最初に出る族)
    const forms = [...acc.forms.values()].sort(
      (p, q) => q.h - p.h || q.k - p.k || q.l - p.l,
    );
    const rep = forms[0];
    const d = a / Math.sqrt(acc.n2);
    rings.push({
      n2: acc.n2,
      h: rep.h,
      k: rep.k,
      l: rep.l,
      forms,
      d,
      s: 1 / (2 * d),
      m: acc.m,
      mNonzero: acc.mNonzero,
      sumF2: acc.sumF2,
      F2: acc.mNonzero > 0 ? acc.sumF2 / acc.mNonzero : 0,
      latticeAllowed: acc.m > 0,
    });
  }
  return rings.sort((p, q) => p.n2 - q.n2);
}

/**
 * 波長 λ [nm] で届く環だけを選び、2θ・L_p・I を付ける(I = Σ|F|² × L_p)。
 * powderRingBase の結果を使い回せば、λ を動かすたびに |F|² を数え直さずに済む。
 */
export function applyWavelength(
  base: readonly PowderRingBase[],
  lambda: number,
  rad: Radiation = "xray",
): PowderLine[] {
  const out: PowderLine[] = [];
  for (const r of base) {
    const tt = twoThetaDeg(r.d, lambda);
    if (tt === null) continue;
    const Lp = lorentzPolarization(tt / 2, rad);
    out.push({ ...r, twoTheta: tt, Lp, I: r.sumF2 * Lp });
  }
  return out;
}

/**
 * 粉末図形(仕様書 08 §5.0): 環ごとの {2θ, d, hkl, m, I}。λ で届く環を
 * 低角から順に返す。消える環(I = 0)も含むので、描くときは I > 0 で選ぶ。
 */
export function powderPattern(
  structure: CrystalStructure,
  lambda: number,
  maxIndex: number,
  rad: Radiation = "xray",
): PowderLine[] {
  return applyWavelength(powderRingBase(structure, maxIndex, rad), lambda, rad);
}

/**
 * 2θ の上限 twoThetaMaxDeg [度] までの環を数えるのに必要な指数の上限。
 * sinθ_max = λ√n2/(2a) から n2_max を出し、その平方根を切り上げる。
 */
export function maxIndexFor(
  aNm: number,
  lambda: number,
  twoThetaMaxDeg: number,
): number {
  const sinMax = Math.sin((twoThetaMaxDeg * Math.PI) / 360);
  return Math.max(1, Math.ceil((2 * aNm * sinMax) / lambda));
}

/** 環の全ての族を並べた表示(例 "(5 1 1)/(3 3 3)") */
export function formatRing(ring: Pick<PowderRingBase, "forms">): string {
  return ring.forms.map((f) => formatHkl(f.h, f.k, f.l)).join("/");
}
