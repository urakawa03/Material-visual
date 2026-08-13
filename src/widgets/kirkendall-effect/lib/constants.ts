/**
 * constants.ts — カーケンドール効果記事の物理定数・モデル定数(記事仕様 §5.0)
 *
 * モデルは Cu–α真鍮(Cu–30 at% Zn)を想定した「典型値による現象論モデル」で
 * あり、実測データではない(母体仕様 §2-5)。エネルギーは eV、温度は K、
 * 長さは m(表示は μm / nm)、時間は s を単位とする。
 */

/** ボルツマン定数 [eV/K] */
export const KB_EV = 8.617e-5;

/** 摂氏 → 絶対温度 [K] */
export const CELSIUS_OFFSET = 273.15;

/** 気体定数 [J/(mol K)](Q の kJ/mol 表示にのみ使う) */
export const R_GAS = 8.314;

/** 1 eV [kJ/mol](Q の表示単位換算) */
export const EV_TO_KJ_PER_MOL = 96.485;

/* ---------------------------------------------------- 拡散の定数(Cu–Zn) */

/** α真鍮中の Zn: 前指数因子 D0 [m²/s] と活性化エネルギー Q [eV] */
export const D0_ZN = 3.0e-5;
export const Q_ZN_EV = 1.97;

/** α真鍮中の Cu: 前指数因子 D0 [m²/s] と活性化エネルギー Q [eV] */
export const D0_CU = 7.0e-5;
export const Q_CU_EV = 2.18;

/** 侵入型(C)の比較用(図2): D0 [m²/s] と Q [eV] */
export const D0_C = 1.0e-6;
export const Q_C_EV = 0.85;

/** 空孔 1 個の移動の活性化エネルギー [eV](図2 の空孔の跳躍頻度) */
export const Q_MIGRATION_EV = 0.75;

/** 跳躍の試行頻度 ν0 [1/s] */
export const ATTEMPT_FREQ = 1e13;

/**
 * 現実の空孔濃度の目安(高温で 10⁻⁴ 程度)。
 * 図2 は空孔を桁で多く描いているので、実時間換算にこの値を使って
 * 「現実の空孔濃度ならどれだけかかるか」に直す(記事仕様 §5.2)。
 */
export const C_VACANCY_REAL = 1e-4;

/* ------------------------------------------------------------ 拡散対の設定 */

/** 真鍮側の Zn 原子分率(反対側は純 Cu で 0 — 記事仕様 §5.0) */
export const X_BRASS = 0.3;

/** 史実の焼鈍温度 [°C](Smigelskas & Kirkendall, 1947) */
export const T_ANNEAL_C = 785;

/** 史実の焼鈍時間 [s](56 日) */
export const T_ANNEAL_S = 56 * 86400;

/**
 * 拡散対の計算領域の半幅 [m](±600 μm)。
 * 785 °C・56 日の拡散距離 2√(D̃t) ≈ 400 μm が収まる。
 */
export const DOMAIN_HALF_M = 600e-6;

/** 拡散対の格子点数(Δx = 6 μm) */
export const GRID_N = 201;

/* ------------------------------------------------------------ 評価関数 */

/** アレニウス型の拡散係数 D(T) = D0 exp(−Q / kB T) [m²/s] */
export function arrheniusD(d0: number, qEv: number, tempK: number): number {
  return d0 * Math.exp(-qEv / (KB_EV * tempK));
}

/** α真鍮中の Zn の拡散係数 [m²/s] */
export function dZn(tempK: number): number {
  return arrheniusD(D0_ZN, Q_ZN_EV, tempK);
}

/** α真鍮中の Cu の拡散係数 [m²/s] */
export function dCu(tempK: number): number {
  return arrheniusD(D0_CU, Q_CU_EV, tempK);
}

/** 侵入型(C)の拡散係数 [m²/s](図2 の対比用) */
export function dInterstitial(tempK: number): number {
  return arrheniusD(D0_C, Q_C_EV, tempK);
}

/** 空孔の跳躍頻度 Γ(T) = ν0 exp(−Q_m / kB T) [1/s] */
export function vacancyHopRate(tempK: number): number {
  return ATTEMPT_FREQ * Math.exp(-Q_MIGRATION_EV / (KB_EV * tempK));
}

/** 侵入型原子の跳躍頻度 [1/s](Q_C を使う。図2 の実時間換算用) */
export function interstitialHopRate(tempK: number): number {
  return ATTEMPT_FREQ * Math.exp(-Q_C_EV / (KB_EV * tempK));
}

/** eV → kJ/mol(活性化エネルギーの表示用) */
export function evToKJPerMol(qEv: number): number {
  return qEv * EV_TO_KJ_PER_MOL;
}

/**
 * 経過時間(秒)を「4.1 分」「2.3 年」のように自動整形する
 * (実時間換算表示。コットレル記事・オストワルド記事と同じ流儀)。
 */
export function formatDuration(seconds: number): string {
  const MINUTE = 60;
  const HOUR = 3600;
  const DAY = 86400;
  const YEAR = 365 * DAY;
  const fmt = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Number(v.toPrecision(3)));
  if (seconds < 1e-6) return `${fmt(seconds * 1e9)} ns`;
  if (seconds < 1e-3) return `${fmt(seconds * 1e6)} μs`;
  if (seconds < 1) return `${fmt(seconds * 1e3)} ms`;
  if (seconds < MINUTE) return `${fmt(seconds)} 秒`;
  if (seconds < HOUR) return `${fmt(seconds / MINUTE)} 分`;
  if (seconds < DAY) return `${fmt(seconds / HOUR)} 時間`;
  if (seconds < YEAR) return `${fmt(seconds / DAY)} 日`;
  const years = seconds / YEAR;
  if (years >= 1e4) return `${fmt(years / 1e4)} 万年`;
  return `${fmt(years)} 年`;
}

/**
 * 10 の冪を含む値を「3.0×10⁻¹⁴」形式に整形する(D の読み出し用)。
 */
export function formatSci(value: number, digits = 1): string {
  if (value === 0) return "0";
  const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const e = Math.floor(Math.log10(Math.abs(value)));
  const m = value / 10 ** e;
  const sup = String(Math.abs(e))
    .split("")
    .map((d) => SUP[Number(d)])
    .join("");
  return `${m.toFixed(digits)}×10${e < 0 ? "⁻" : ""}${sup}`;
}
