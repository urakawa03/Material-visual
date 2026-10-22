/**
 * units.ts — 物理定数と時間の書式(docs/specs/90_remaining_work.md §3.1)
 *
 * 記事をまたいで使う物理定数を 1 箇所に置く。値は CODATA 2018。
 *
 * 公開済みの記事の lib/constants.ts には、精度の違う同名の定数
 * (KB_EV = 8.617e-5 など)と、区切りの違う formatDuration が残っている。
 * 指数の中に入る定数を差し替えると図の数値が表示桁で動き得るので、
 * それらはあえて移行していない。新しい記事はこちらを使う。
 */

import { fmtSci } from "./plot";

/** ボルツマン定数 k_B [eV/K] */
export const KB_EV = 8.617333262e-5;

/** 0 ℃ の絶対温度 [K] */
export const KELVIN_OFFSET = 273.15;

/** 気体定数 R [J/(mol·K)] */
export const R_GAS = 8.314462618;

/** 1 粒子あたり 1 eV を 1 mol あたりに直した値 [kJ/mol] */
export const EV_TO_KJ_PER_MOL = 96.48533212;

/** 電気素量 q [C] */
export const Q_E = 1.602176634e-19;

/** 真空の誘電率 ε₀ [F/cm](半導体の慣習に合わせて cm 単位) */
export const EPS0_F_PER_CM = 8.8541878128e-14;

/** ħ²/(2mₑ) [eV·nm²](自由電子の E = ħ²k²/2mₑ。バンド理論記事の HBAR2_OVER_2M と同値) */
export const HBAR2_OVER_2ME = 0.0380998;

/** ħ [eV·fs] */
export const HBAR_EV_FS = 0.6582119569;

/** 1 年 [s](365.25 日) */
export const YEAR_S = 365.25 * 86400;

/** 宇宙の年齢 [s](138 億年) */
export const UNIVERSE_AGE_S = 138e8 * YEAR_S;

interface DurationUnit {
  name: string;
  /** 1 単位の秒数 */
  seconds: number;
  /** この単位で表す上限(丸めた値がこれ以上なら次の単位へ) */
  upper: number;
}

/** 秒未満は値が 0.1 以上、秒以上は 1 以上になる単位を選ぶ */
const DURATION_UNITS: readonly DurationUnit[] = [
  { name: "ナノ秒", seconds: 1e-9, upper: 100 },
  { name: "マイクロ秒", seconds: 1e-6, upper: 100 },
  { name: "ミリ秒", seconds: 1e-3, upper: 100 },
  { name: "秒", seconds: 1, upper: 60 },
  { name: "分", seconds: 60, upper: 60 },
  { name: "時間", seconds: 3600, upper: 24 },
  { name: "日", seconds: 86400, upper: 365.25 },
  { name: "年", seconds: YEAR_S, upper: 1e4 },
  { name: "万年", seconds: 1e4 * YEAR_S, upper: 1e4 },
  { name: "億年", seconds: 1e8 * YEAR_S, upper: 138 },
];

/**
 * 秒を、読者の感覚に合う単位の文字列にする(図の読み取り値・軸ラベル用)。
 *
 * 1.4e-4 →「0.14 ミリ秒」、0.3 →「0.3 秒」、720 →「12 分」、
 * 12600 →「3.5 時間」、2.4e11 →「7600 年」、3e15 →「9500 万年」、
 * 宇宙の年齢以上は「宇宙の年齢の 2.5 倍」「宇宙の年齢の 9.2 × 10⁸ 倍」。
 *
 * 有効数字は digits 桁。丸めた値が単位の上限に届いたら次の単位で表す
 * (59.96 秒 →「1 分」)。0.1 ナノ秒未満は「3 × 10⁻¹¹ 秒」の形にする。
 * 非有限・負の値は「—」。
 */
export function formatDuration(seconds: number, digits = 2): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds === 0) return "0 秒";
  if (seconds < 1e-10) return `${fmtSci(seconds, digits)} 秒`;
  for (const unit of DURATION_UNITS) {
    const value = Number((seconds / unit.seconds).toPrecision(digits));
    if (value < unit.upper) return `${value} ${unit.name}`;
  }
  const ratio = seconds / UNIVERSE_AGE_S;
  const rounded = Number(ratio.toPrecision(digits));
  const times = rounded < 1e4 ? String(rounded) : fmtSci(ratio, digits);
  return `宇宙の年齢の ${times} 倍`;
}
