/**
 * rules.ts — 図4「消滅則を自分で見つける」の規則の候補と照合(仕様書 08 §5.4)
 *
 * 読者が表を埋めたあとに選ぶ「規則の候補」を、指数だけで判定できる述語と
 * して置く。照合は構造因子(s = 0)で実際に消えるかどうかと、全点で
 * 突き合わせる。体心・面心の規則は逆格子空間の記事の isAllowed と同値だが、
 * ここでは読者が見つける「文」として独立に書く(単体テストで一致を確認)。
 */

import type { Radiation } from "./formfactors";
import type { CrystalStructure } from "./structures";
import { F2_ZERO_EPS, referenceF2, structureFactor2 } from "./structurefactor";

export type RuleId = "odd-sum" | "mixed" | "diamond" | "none";

export interface ExtinctionRule {
  id: RuleId;
  /** 選択肢に出す規則の文 */
  text: string;
  /** この規則が (hkl) を「消える」と予言するか */
  predictsZero(h: number, k: number, l: number): boolean;
}

function parity(n: number): number {
  return Math.abs(n) % 2;
}

/** h, k, l の偶奇がそろわない(混在する) */
function mixedParity(h: number, k: number, l: number): boolean {
  const p = parity(h);
  return parity(k) !== p || parity(l) !== p;
}

/** すべて偶数で h + k + l が 4 の倍数でない(= 4n + 2) */
function evenFourNPlusTwo(h: number, k: number, l: number): boolean {
  if (parity(h) || parity(k) || parity(l)) return false;
  return (((h + k + l) % 4) + 4) % 4 === 2;
}

/** 規則の候補(図4 の選択肢の並び) */
export const RULES: readonly ExtinctionRule[] = [
  {
    id: "odd-sum",
    text: "h + k + l が奇数のとき消える",
    predictsZero: (h, k, l) => parity(h + k + l) === 1,
  },
  {
    id: "mixed",
    text: "h, k, l の偶奇がそろわないとき消える",
    predictsZero: mixedParity,
  },
  {
    id: "diamond",
    text: "偶奇がそろわないとき、またはすべて偶数で h + k + l = 4n + 2 のとき消える",
    predictsZero: (h, k, l) =>
      mixedParity(h, k, l) || evenFourNPlusTwo(h, k, l),
  },
  {
    id: "none",
    text: "消える点はない",
    predictsZero: () => false,
  },
];

/** 照合で食い違った点 1 つ */
export interface RuleMismatch {
  h: number;
  k: number;
  l: number;
  /** 実際に消えるか(構造因子で判定) */
  actualZero: boolean;
}

export interface RuleCheck {
  /** 照合した点の数(000 を除く) */
  total: number;
  /** 食い違った点(先頭から最大 limit 個) */
  mismatches: RuleMismatch[];
  /** 食い違った点の総数 */
  mismatchCount: number;
}

/**
 * 規則の候補を、|h|,|k|,|l| ≤ maxIndex の全点(000 を除く)で構造因子
 * (s = 0)と照合する。食い違いの例は低指数(h²+k²+l² の小さい順)から
 * 最大 limit 個を返す。
 */
export function checkRule(
  structure: CrystalStructure,
  rule: ExtinctionRule,
  maxIndex: number,
  rad: Radiation = "xray",
  limit = 6,
): RuleCheck {
  const all: RuleMismatch[] = [];
  const zero = referenceF2(structure, rad) * F2_ZERO_EPS;
  let total = 0;
  for (let h = -maxIndex; h <= maxIndex; h++) {
    for (let k = -maxIndex; k <= maxIndex; k++) {
      for (let l = -maxIndex; l <= maxIndex; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        total++;
        const actualZero = structureFactor2(structure, h, k, l, 0, rad) <= zero;
        if (actualZero !== rule.predictsZero(h, k, l)) {
          all.push({ h, k, l, actualZero });
        }
      }
    }
  }
  const order = (m: RuleMismatch): number => m.h * m.h + m.k * m.k + m.l * m.l;
  all.sort(
    (p, q) => order(p) - order(q) || q.h - p.h || q.k - p.k || q.l - p.l,
  );
  return {
    total,
    mismatches: all.slice(0, limit),
    mismatchCount: all.length,
  };
}
