/**
 * constants.ts — オストワルド成長記事の物理定数・モデル定数(記事仕様書 03 §5.0)
 *
 * モデルは Al–Cu 系の析出物を想定した「典型値による現象論モデル」であり、
 * 実測データではない(図8 のみ Ni 基相当の別系を使う — 各図版側で定義)。
 *
 * エンジン(ripening.ts)は長さ nm・時間「200 °C 換算の秒(τ)」で 1 本だけ
 * 走らせ、表示だけを温度に応じて実時間へ換算する。したがって本モデルでは
 * 温度は進化の「形」を変えず「時計の速さ」だけを変える(§5.0)。
 */

/** ボルツマン定数 [eV/K] */
export const KB_EV = 8.617e-5;
/** ボルツマン定数 [J/K](毛管長の計算用) */
export const KB_J = 1.380649e-23;
/** セ氏 → ケルビン */
export const KELVIN = 273.15;

/** 界面エネルギー γ [J/m²](半整合相当のモデル値) */
export const GAMMA_JM2 = 0.2;
/** 析出物の原子体積 Ω [m³] */
export const OMEGA_M3 = 1.66e-29;
/** 溶質拡散の活性化エネルギー Q_d [eV] */
export const Q_D_EV = 1.3;
/** 固溶度の温度依存 ΔH_s [eV] */
export const DH_S_EV = 0.4;
/** K のみかけの活性化エネルギー Q_K = Q_d + ΔH_s ≈ 1.7 eV */
export const Q_K_EV = Q_D_EV + DH_S_EV;
/** 固溶度の前指数 c_s0(平面界面。473 K で c∞ ≈ 1×10⁻³ となる) */
export const C_S0 = 20;
/** 析出物の体積分率(一定) */
export const F_VOLUME = 0.08;
/** Al の剛性率 μ [GPa](図1・7 で使用) */
export const MU_GPA = 26;
/** Al のバーガースベクトル b [nm](図1・7 で使用) */
export const B_NM = 0.286;
/** 粒子間隔の幾何係数 β(L = β r̄ / √f) */
export const BETA = 1.2;
/** 溶解とみなす半径 [nm](数値処理) */
export const R_DIS_NM = 0.5;

/** 校正温度 200 °C [K]。エンジン時間 τ はこの温度での実秒に等しい */
export const T_REF_K = 200 + KELVIN;

/** 初期組織の中央値半径 [nm](対数正規分布) */
export const R0_MEDIAN_NM = 5;
/** 初期組織の対数標準偏差 σ_ln */
export const R0_SIGMA_LN = 0.25;

/** 毛管長 lc(T) = 2γΩ/kBT [nm](473 K で ≈ 1.0 nm) */
export function lcNm(tKelvin: number): number {
  return ((2 * GAMMA_JM2 * OMEGA_M3) / (KB_J * tKelvin)) * 1e9;
}

/** 平面界面に対する固溶度 c∞(T) = c_s0 e^(−ΔHs/kBT)(473 K で ≈ 1×10⁻³) */
export function cInf(tKelvin: number): number {
  return C_S0 * Math.exp(-DH_S_EV / (KB_EV * tKelvin));
}

/**
 * LSW 速度定数 K(T) [nm³/s](r̄³ − r̄0³ = K t)。
 * 前係数は「r̄(200 °C・10 h) ≈ 15 nm(r̄0 = 5 nm)」となるよう校正し(§5.0)、
 * 温度依存はみかけの活性化エネルギー Q_K で与える。
 */
export const K_REF_NM3S = (15 ** 3 - 5 ** 3) / (10 * 3600); // ≈ 0.0903 nm³/s @ 473 K

export function kCoarsening(tKelvin: number): number {
  return K_REF_NM3S * Math.exp((-Q_K_EV / KB_EV) * (1 / tKelvin - 1 / T_REF_K));
}

/**
 * 実時間換算係数: t_real = τ × timeDilation(T)。
 * τ はエンジン時間(200 °C 換算の秒)。T を上げると係数が桁で小さくなる
 * (= 同じ組織変化が短時間で起きる)。
 */
export function timeDilation(tKelvin: number): number {
  return K_REF_NM3S / kCoarsening(tKelvin);
}

/** 解析解: r̄(t) = (r̄0³ + K(T)·t)^(1/3) [nm](t は温度 T での実秒) */
export function meanRadiusAnalytic(
  tSeconds: number,
  tKelvin: number,
  r0Nm: number = R0_MEDIAN_NM,
): number {
  return Math.cbrt(r0Nm ** 3 + kCoarsening(tKelvin) * tSeconds);
}

/** ギブス・トムソン効果: c(r)/c∞ = e^(lc/r)(r は nm。既定は 473 K の lc) */
export function gibbsThomsonRatio(
  rNm: number,
  tKelvin: number = T_REF_K,
): number {
  return Math.exp(lcNm(tKelvin) / rNm);
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const YEAR = 365.25 * DAY;

/** 値に応じて桁を整える(10 未満は小数 1 桁、それ以上は整数) */
function fmt(v: number): string {
  return v < 10 ? v.toFixed(1) : String(Math.round(v));
}

/**
 * 秒数の日本語表示(秒/分/時間/日/年で自動整形 — §5.0)。
 * 例: "45 秒" "3.2 分" "7.5 時間" "3.2 日" "1.5 年"
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 0.95) return `${seconds.toFixed(1)} 秒`;
  if (seconds < 120) return `${fmt(seconds)} 秒`;
  if (seconds < 120 * MINUTE) return `${fmt(seconds / MINUTE)} 分`;
  if (seconds < 48 * HOUR) return `${fmt(seconds / HOUR)} 時間`;
  if (seconds < 2 * YEAR) return `${fmt(seconds / DAY)} 日`;
  return `${fmt(seconds / YEAR)} 年`;
}
