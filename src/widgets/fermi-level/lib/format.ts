/**
 * format.ts — 記事「フェルミ準位」の読み取り値の書式
 *
 * 密度は P0 の src/core/plot.ts の fmtSci(有効数字 2 桁 —「1.2 × 10⁴ cm⁻³」)、
 * 「何分の 1」「何倍」は万・億・兆を使う日本語の数で書く(仕様書 12 §5.5)。
 */

import { fmtSci } from "../../../core/plot";

/** 負号(U+2212) */
const MINUS = "−";

/** 密度の読み取り「1.2 × 10⁴ cm⁻³」(非有限は「—」) */
export function formatDensity(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${fmtSci(v, 2)} cm⁻³`;
}

/** 積 np などの読み取り「1.2 × 10²⁰ cm⁻⁶」 */
export function formatDensitySquared(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${fmtSci(v, 2)} cm⁻⁶`;
}

/** eV の読み取り(小数 digits 桁、負号は「−」) */
export function formatEvFixed(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  const zero = Number(s) === 0;
  return `${v < 0 && !zero ? MINUS : ""}${s} eV`;
}

/** 符号つきの eV「+0.355 eV」「−0.355 eV」(丸めて 0 なら符号なし) */
export function formatEvSigned(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return `${s} eV`;
  return `${v < 0 ? MINUS : "+"}${s} eV`;
}

/** 万・億・兆で区切った数(有効数字 digits 桁)。unit は「万」などか空文字 */
export function japaneseNumber(
  v: number,
  digits: number,
): { num: string; unit: string } {
  if (!Number.isFinite(v)) return { num: "—", unit: "" };
  const r = Number(v.toPrecision(digits));
  const units: ReadonlyArray<[number, string]> = [
    [1e12, "兆"],
    [1e8, "億"],
    [1e4, "万"],
  ];
  for (const [scale, unit] of units) {
    if (Math.abs(r) >= scale) {
      const q = Math.round((r / scale) * 1e6) / 1e6;
      return { num: String(q), unit };
    }
  }
  return { num: String(r), unit: "" };
}

/** 万・億・兆で書くのはこの値まで(1 万兆 = 10¹⁶ 以上は「× 10ⁿ」で書く) */
const JAPANESE_LIMIT = 1e16;

/** 「Si 原子の 500 万分の 1」のような不純物の割合(ratio = 原子密度 / 不純物密度) */
export function formatOneIn(ratio: number, prefix = "Si 原子の "): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  if (ratio >= JAPANESE_LIMIT) return `${prefix}${fmtSci(ratio, 2)} 分の 1`;
  const { num, unit } = japaneseNumber(ratio, 2);
  return unit ? `${prefix}${num} ${unit}分の 1` : `${prefix}${num} 分の 1`;
}

/**
 * 「約 70 万倍」のような倍率(有効数字 1 桁 — 移動度を一定とした目安の値なので
 * 桁だけを伝える。仕様書 12 §5.5)。低温で真性の導電率が事実上 0 になると
 * 倍率は天文学的になるので、10¹⁶ 以上は「約 6 × 10⁵² 倍」と書く。
 */
export function formatTimesRough(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  if (ratio >= JAPANESE_LIMIT) return `約 ${fmtSci(ratio, 1)} 倍`;
  const { num, unit } = japaneseNumber(ratio, 1);
  return unit ? `約 ${num} ${unit}倍` : `約 ${num} 倍`;
}

/** 0〜1 の割合を「99.6 %」の形に(1% 以上は小数 1 桁、それ未満は有効数字 2 桁) */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  if (pct >= 99.95 && pct < 100) return "> 99.9 %";
  if (pct >= 1) return `${pct.toFixed(1)} %`;
  return `${pct.toPrecision(2)} %`;
}
