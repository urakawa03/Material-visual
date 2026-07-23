/**
 * constants.ts — コットレル雰囲気記事の物理定数・モデル定数(記事仕様 §5.0)
 *
 * モデルは α-Fe + C を想定した「典型値による現象論モデル」であり、
 * 実測データではない(母体仕様 §2-5)。エネルギーは eV、温度は K、
 * 長さは原則としてバーガースベクトル b を単位とする(b 単位系)。
 */

/** 剛性率 μ [GPa] */
export const MU_GPA = 82;

/** ポアソン比 ν */
export const POISSON = 0.29;

/** バーガースベクトルの大きさ b [nm] */
export const BURGERS_NM = 0.25;

/** 転位–炭素の結合エネルギー U_b [eV](モデル値。文献では 0.4〜0.8 eV) */
export const U_BIND_EV = 0.5;

/** 炭素の移動(拡散)の活性化エネルギー E_m [eV] */
export const E_MIGRATION_EV = 0.87;

/** 拡散ジャンプの試行頻度 ν0 [1/s] */
export const ATTEMPT_FREQ = 1e13;

/** 遠方の炭素サイト占有率 c0 */
export const C_FAR = 1e-4;

/** ボルツマン定数 [eV/K] */
export const KB_EV = 8.617e-5;

/**
 * ひずみ時効の時定数の前指数因子 τ0 [s](記事仕様 §5.8)。
 * τ(T) = τ0 exp(E_m / kB T)。τ(170 °C) ≈ 10 分、室温では年オーダー。
 */
export const AGING_TAU0_S = 8e-8;

/** 摂氏 → 絶対温度 [K] */
export const CELSIUS_OFFSET = 273.15;

/**
 * 場の評価の特異点処理(記事仕様 §5.0): r を b 以上にクランプし、
 * |U| を U_b 以下にキャップする。値は b 単位。
 */
export const FIELD_R_MIN_B = 1;

/**
 * 拡散のホップ率 Γ(T) = ν0 exp(−E_m / kB T) [1/s](アレニウス式)。
 */
export function hopRate(tempK: number): number {
  return ATTEMPT_FREQ * Math.exp(-E_MIGRATION_EV / (KB_EV * tempK));
}

/**
 * ひずみ時効の時定数 τ(T) = τ0 exp(E_m / kB T) [s](記事仕様 §5.8)。
 */
export function agingTau(tempK: number): number {
  return AGING_TAU0_S * Math.exp(E_MIGRATION_EV / (KB_EV * tempK));
}

/**
 * ひずみ時効の回復率 W(t, T) = 1 − exp[−(t/τ)^(2/3)](記事仕様 §5.8)。
 * コットレル・ビルビーの t^(2/3) 則を JMAK 形に取り込んだ現象論。
 */
export function agingRecovery(timeS: number, tempK: number): number {
  if (timeS <= 0) return 0;
  return 1 - Math.exp(-Math.pow(timeS / agingTau(tempK), 2 / 3));
}

/**
 * シミュレーション経過時間(秒)を「4.1 分」「2.3 年」のように自動整形する
 * (記事仕様 §5.5 実時間換算表示)。秒未満はミリ秒などに落とさず小数で示す。
 */
export function formatDuration(seconds: number): string {
  const MINUTE = 60;
  const HOUR = 3600;
  const DAY = 86400;
  const YEAR = 365 * DAY;
  const fmt = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Number(v.toPrecision(3)));
  if (seconds < MINUTE) return `${fmt(seconds)} 秒`;
  if (seconds < HOUR) return `${fmt(seconds / MINUTE)} 分`;
  if (seconds < DAY) return `${fmt(seconds / HOUR)} 時間`;
  if (seconds < YEAR) return `${fmt(seconds / DAY)} 日`;
  const years = seconds / YEAR;
  if (years >= 1e4) return `${fmt(years / 1e4)} 万年`;
  return `${fmt(years)} 年`;
}
