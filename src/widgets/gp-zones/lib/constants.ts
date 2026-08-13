/**
 * constants.ts — GPゾーン記事の物理定数・モデル定数(記事仕様書 07 §5.0)
 *
 * モデルは Al–4 wt% Cu を想定した「典型値による現象論モデル」であり、
 * 実測データではない。校正値はすべてこのファイル内で導出し、各図版には
 * マジックナンバーを置かない。
 *
 * 転位量(μ, b)はフランク・リード源記事・オストワルド成長記事と同値に
 * 揃えてある(記事をまたいだ記号・数値の一貫性 — 母体仕様 §2-2)。
 */

/** ボルツマン定数 [eV/K] */
export const KB_EV = 8.617e-5;
/** セ氏 → ケルビン */
export const KELVIN = 273.15;

/* ------------------------------------------------------------ 材料定数(Al) */

/** Al の剛性率 μ [GPa] */
export const MU_GPA = 26;
/** Al のバーガースベクトル b [nm] */
export const B_NM = 0.286;
/** μb [MPa·nm](オロワン応力の分子) */
export const MU_B_MPA_NM = MU_GPA * 1e3 * B_NM;

/* ------------------------------------------------- Al–Cu 状態図(§5.2 図2) */

/** 合金の Cu 量 c0 [wt%] */
export const C0_WT = 4.0;
/** θ 相(Al₂Cu)の Cu 量 [wt%] */
export const C_THETA_WT = 53.5;
/** 共晶組成 [wt%](α 相の最大固溶量) */
export const C_EUT_WT = 5.65;
/** 共晶温度 [°C] */
export const T_EUT_C = 548;
/** 固溶限の前指数 c_s0 [wt%] */
export const CS0_WT = 1552;
/** 固溶限の見かけの活性化エネルギー Q_s [eV] */
export const Q_S_EV = 0.397;

/**
 * α 相の固溶限(solvus)c_s(T) [wt%]。
 * c_s0 と Q_s は「548 °C で 5.65 wt%(共晶点)」「300 °C で約 0.5 wt%」に
 * 合わせた 2 点フィット。共晶温度以上は α の最大固溶量で頭打ちにする。
 */
export function solubilityWt(tKelvin: number): number {
  const c = CS0_WT * Math.exp(-Q_S_EV / (KB_EV * tKelvin));
  return Math.min(c, C_EUT_WT);
}

/**
 * 組成 c [wt%] の固溶限に対応する温度(solvus 曲線の逆関数)[K]。
 * c ≥ 共晶組成では共晶温度を返す。
 */
export function solvusTemperatureK(cWt: number): number {
  if (cWt >= C_EUT_WT) return T_EUT_C + KELVIN;
  return Q_S_EV / (KB_EV * Math.log(CS0_WT / Math.max(cWt, 1e-9)));
}

/** 過飽和度 c0/c_s(T)(上限は表示の都合で 10⁶ 倍にクランプ) */
export function supersaturation(tKelvin: number, c0Wt: number = C0_WT): number {
  return Math.min(c0Wt / solubilityWt(tKelvin), 1e6);
}

/* ------------------------------------------------------- 空孔(§5.3 図3) */

/** Al の空孔生成エネルギー E_f [eV] */
export const EF_VAC_EV = 0.67;
/** 空孔の移動エネルギー E_m [eV](消滅の時定数に使う) */
export const EM_VAC_EV = 0.62;

/** 平衡空孔濃度 c_v^eq(T) = e^(−E_f/k_BT)(サイトあたり) */
export function vacancyEq(tKelvin: number): number {
  return Math.exp(-EF_VAC_EV / (KB_EV * tKelvin));
}

/** 空孔消滅の時定数 τ_ann(T) = τ0 e^(E_m/k_BT) [s]。低温では凍結される */
export const TAU_ANN0_S = 1e-11;
export function vacancyAnnealTime(tKelvin: number): number {
  return TAU_ANN0_S * Math.exp(EM_VAC_EV / (KB_EV * tKelvin));
}

/* ------------------------------------------------- 時効モデル(§5.0・aging.ts) */

/**
 * 析出(クラスタリング)の**見かけの**活性化エネルギー Q_p [eV]。
 *
 * Al 中の Cu の格子拡散は 1.3 eV 級だが、時効初期は焼入れで凍結された
 * 過剰空孔に助けられるため、室温側が Arrhenius から見て異常に速い。
 * その結果、室温〜200 °C の「クラスタが育ちきるまでの時間」を 1 本の
 * 指数で近似すると、見かけの活性化エネルギーはずっと小さくなる。
 * ここでは古典的な時効時間(室温で約 1 日、150 °C で数時間)に合うよう
 * 0.2 eV を採る。過剰空孔の効果を丸め込んだ実効値である(§5.0)。
 */
export const Q_P_EV = 0.2;
/**
 * 粗大化(分散が粗くなる過程)の**見かけの**活性化エネルギー Q_K [eV]。
 *
 * 同じく実効値。古典的なピーク時効時間(130 °C で約 11 時間、190 °C で
 * 約 1 時間、250 °C で十数分)に合うよう 0.6 eV を採る。
 * **Q_K > Q_p が本記事の温度依存の要**である: 高温ほど粗大化のほうが
 * 析出より速く加速するので、体積分率が育ちきる前に粒子が交点半径を
 * 越えてしまい、ピークは早く来るが低くなる。
 */
export const Q_K_EV = 0.6;
/** Avrami 指数 n */
export const AVRAMI_N = 1.2;
/** クラスタの初期半径 r0 [nm] */
export const R0_NM = 0.7;
/** 析出が完了した時点の半径 r1 [nm](粗大化前) */
export const R1_NM = 2.0;
/** 粒子間隔の実効幾何係数 β(L = β r/√f)。板状粒子と対数係数をまとめた値 */
export const BETA = 4.0;
/** 交点半径 r×(せん断 = 迂回)[nm]。k_cut をこの値に校正する */
export const R_CROSS_NM = 3.0;

/** 校正点 1: 20 °C で析出の時定数が 1 日(Wilm の「週明け」) */
const T_NATURAL_K = 20 + KELVIN;
const T_NATURAL_S = 86400;
/** t_p(T) = t_p0 e^(Q_p/k_BT) の前指数 [s] */
export const TP0_S = T_NATURAL_S * Math.exp(-Q_P_EV / (KB_EV * T_NATURAL_K));

/** 析出の時定数 t_p(T) [s] */
export function precipitationTime(tKelvin: number): number {
  return TP0_S * Math.exp(Q_P_EV / (KB_EV * tKelvin));
}

/** 校正点 2: 150 °C で 5 時間かけて半径が交点半径 r× に達する(T6 の目安) */
const T_ART_K = 150 + KELVIN;
const T_ART_S = 5 * 3600;
/** K(T) = K0 e^(−Q_K/k_BT) の前指数 [nm³/s] */
export const K0_NM3S =
  ((R_CROSS_NM ** 3 - R1_NM ** 3) / T_ART_S) *
  Math.exp(Q_K_EV / (KB_EV * T_ART_K));

/** 粗大化の速度定数 K(T) [nm³/s] */
export function coarseningK(tKelvin: number): number {
  return K0_NM3S * Math.exp(-Q_K_EV / (KB_EV * tKelvin));
}

/** 硬さの校正温度 [K](130 °C のピークで HV = HV_PEAK とする) */
export const T_CALIB_K = 130 + KELVIN;

/** 焼入れまま(過飽和固溶体)の硬さ [HV 相当] */
export const HV0 = 60;
/** 130 °C ピーク時効の硬さ [HV 相当](校正目標) */
export const HV_PEAK = 135;

/* ------------------------------------------------------------ 時間表示の整形 */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const YEAR = 365.25 * DAY;

function fmt(v: number): string {
  return v < 10 ? v.toFixed(1) : String(Math.round(v));
}

/**
 * 秒数の日本語表示(秒/分/時間/日/年で自動整形)。
 * オストワルド成長記事 `constants.ts` の formatDuration と同じ流儀。
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
