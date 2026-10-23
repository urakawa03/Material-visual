/**
 * constants.ts — 記事「pn 接合」で追加する定数(仕様書 13 §2.3)
 *
 * 材料定数(E_g・N_c・N_v・移動度・比誘電率)は #12 の `_shared/semiconductor.ts`
 * の `SILICON` に 1 箇所だけ置いてあり、ここには本記事で増える値だけを置く
 * (母体仕様 §4: マジックナンバー禁止)。
 *
 * 向きと符号(§2.3): p 型を左(x < 0)、n 型を右(x > 0)、接合面を x = 0。
 * バイアス V は p 側が正のとき正(= 順方向)。
 */

/** 少数キャリアの寿命 τ_n・τ_p [s] */
export interface CarrierLifetimes {
  /** p 側に入った電子の寿命 τ_n [s] */
  tauN: number;
  /** n 側に入った正孔の寿命 τ_p [s] */
  tauP: number;
}

/**
 * 本記事の Si の寿命(τ_n = τ_p = 1 μs)。拡散係数 D = μk_BT/q(D_n = 34.9、
 * D_p = 12.4 cm²/s)と合わせて、拡散長 L = √(Dτ) は L_n ≈ 59 μm・L_p ≈ 35 μm。
 */
export const SI_LIFETIMES: Readonly<CarrierLifetimes> = Object.freeze({
  tauN: 1e-6,
  tauP: 1e-6,
});

/** 温度 [K](全図版とも室温) */
export const ROOM_T = 300;

/** 既定のドーピング N_A = N_D [cm⁻³] */
export const DOPING_INIT = 1e16;

/** 光電流(太陽 1 個分)J_L [A/cm²](= 35 mA/cm²。図6 の太陽電池モードのみ) */
export const J_LIGHT_ONE_SUN = 0.035;

/**
 * 空乏層近似を打ち切る余裕 [V]。V ≥ V_bi − 0.02 では近似の適用外として、
 * 空乏層の両端の電位差を 0.02 V に止める(§5.0 の depletion)。
 */
export const DEPLETION_MARGIN = 0.02;

/** ダイオード式の指数の引数 qV/k_BT のクランプ(e^80 ≈ 5.5 × 10³⁴ は有限) */
export const EXP_ARG_MAX = 80;

/** hc [eV·nm](λ = hc/E_g。式 E12) */
export const HC_EV_NM = 1239.84;

/** 位置軸の表示範囲の下限 [μm](§5.0: 範囲 = max(1.5W, 0.6 μm) を左右に) */
export const MIN_HALF_RANGE_UM = 0.6;

/** 表示範囲を空乏層の幅の何倍にとるか(§5.0) */
export const RANGE_PER_W = 1.5;

/** LED の材料(仕様書 13 §5.6)。InGaN の E_g は組成で変わる代表値 */
export interface LedMaterial {
  id: "Si" | "GaAs" | "InGaN";
  label: string;
  /** バンドギャップ [eV] */
  eg: number;
  /** 直接遷移か */
  direct: boolean;
}

export const LED_MATERIALS: readonly LedMaterial[] = Object.freeze([
  { id: "Si", label: "Si", eg: 1.12, direct: false },
  { id: "GaAs", label: "GaAs", eg: 1.42, direct: true },
  { id: "InGaN", label: "InGaN", eg: 2.7, direct: true },
]);
