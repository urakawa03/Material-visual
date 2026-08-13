/**
 * diffusion.ts — 拡散とダルケンの関係の数値モデル(記事仕様 §5.0)
 *
 * 図1(ランダムウォークの統計)・図3(拡散対)・図4(3 本の流束)・
 * 図5(マーカー移動量の測定)・図6(ボイド生成)・図7(中空化)で共用する。
 *
 * 座標系(記事仕様 §5.0): x 右向きを正、**左 = 純銅側・右 = 真鍮(Zn)側**。
 * 組成は Zn の原子分率 X ≡ X_Zn を使う(A = Zn、B = Cu)。したがって
 * ∂X_A/∂x > 0 であり、D_A > D_B ならマーカー速度 v > 0(真鍮側へ動く)。
 *
 * 簡略化(母体仕様 §2-5): 1 次元・格子点密度一定・モル体積の変化や応力・
 * 粒界拡散は無視。すべて「典型値による現象論モデル」であり実測値ではない。
 */

import { clamp, mulberry32 } from "../../../core/mathx";
import { DOMAIN_HALF_M, GRID_N, X_BRASS } from "./constants";

/* ------------------------------------------------------------ 誤差関数 */

/** 誤差関数 erf(z)(Abramowitz & Stegun 7.1.26。絶対誤差 < 1.5×10⁻⁷) */
export function erf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

/** 相補誤差関数 erfc(z) = 1 − erf(z) */
export function erfc(z: number): number {
  return 1 - erf(z);
}

/* -------------------------------------------------- ランダムウォークの統計 */

/**
 * 2D 格子ランダムウォーク(4 方向・等確率)の拡散係数 D = ℓ²Γ/4。
 * 1 軸あたりの平均二乗変位は ⟨x²⟩ = 2Dt = ℓ²n/2(n = 跳躍回数)。
 * 単位は呼び出し側に委ねる(ℓ の単位の 2 乗 / 時間の単位)。
 */
export function walkDiffusivity(stepLen: number, hopRate: number): number {
  return (stepLen * stepLen * hopRate) / 4;
}

/** 1 軸あたりの平均二乗変位 ⟨x²⟩ = ℓ²n/2(n 回跳躍後) */
export function meanSquareDisplacement1D(
  stepLen: number,
  hops: number,
): number {
  return (stepLen * stepLen * hops) / 2;
}

/**
 * 段差初期条件(x < 0 に C₀、x > 0 に 0)の解析解(無限媒質):
 *   C(x, t)/C₀ = ½ erfc( x / (2√(Dt)) )
 * dt には Dt(拡散長の 2 乗)を渡す。Dt ≤ 0 では段差そのものを返す。
 */
export function stepProfile(x: number, dTimesT: number): number {
  if (dTimesT <= 0) return x < 0 ? 1 : 0;
  return 0.5 * erfc(x / (2 * Math.sqrt(dTimesT)));
}

/* ------------------------------------------------ ダルケンの関係(§5.4・§5.5) */

/**
 * 相互拡散係数 D̃ = X_B D_A + X_A D_B(記事仕様 §5.5)。
 * xA は A(= Zn)の原子分率。xA = 0(純 Cu 側)で D_A、xA = 1 で D_B になる。
 */
export function interdiffusionD(xA: number, dA: number, dB: number): number {
  const x = clamp(xA, 0, 1);
  return (1 - x) * dA + x * dB;
}

/**
 * マーカー(格子)速度 v = (D_A − D_B) ∂X_A/∂x [m/s](記事仕様 §5.5)。
 * D_A > D_B かつ ∂X_A/∂x > 0(右が Zn 側)で v > 0 = 真鍮側へ動く。
 */
export function markerVelocity(dA: number, dB: number, gradXA: number): number {
  return (dA - dB) * gradXA;
}

/**
 * 格子固定座標系の 3 本の流束(記事仕様 §5.4)。格子点密度 C は 1 に
 * 正規化する(表示は相対値なので絶対値は不要)。X_B = 1 − X_A より
 * ∂X_B/∂x = −∂X_A/∂x なので、J_B は符号が反転する。
 *   J_A = −D_A ∂X_A/∂x, J_B = +D_B ∂X_A/∂x, J_V = −(J_A + J_B)
 */
export interface FluxTriple {
  /** A(Zn)の流束 */
  jA: number;
  /** B(Cu)の流束 */
  jB: number;
  /** 正味の原子流束 J_A + J_B */
  jNet: number;
  /** 空孔の流束 −(J_A + J_B) */
  jV: number;
}

export function fluxes(dA: number, dB: number, gradXA: number): FluxTriple {
  const jA = -dA * gradXA;
  const jB = dB * gradXA;
  const jNet = jA + jB;
  return { jA, jB, jNet, jV: -jNet };
}

/**
 * D_A / D_B = ratio を保ちつつ D_A + D_B = sum に固定した組を返す。
 * (和を固定して比だけを振る単純な組。図7 の相対拡散係数に使う)
 */
export function dPairFromRatio(
  ratio: number,
  sum: number,
): { dA: number; dB: number } {
  const dB = sum / (1 + ratio);
  return { dA: sum - dB, dB };
}

/**
 * D_A / D_B = ratio を保ちつつ、組成 xA での相互拡散係数
 * D̃ = (1 − xA)D_A + xA D_B を dTilde に固定した組を返す(図4・図5 — §5.4)。
 *
 * こうすると「比を振っても拡散の速さ(= プロファイルの広がり)は変わらず、
 * マーカー速度だけが変わる」状態を作れる。マーカー移動量が D_A − D_B に
 * **正比例**するので、図5 の測定点が原点を通る直線に並ぶ。
 */
export function dPairAtFixedDTilde(
  ratio: number,
  dTilde: number,
  xA: number,
): { dA: number; dB: number } {
  const dB = dTilde / ((1 - xA) * ratio + xA);
  return { dA: ratio * dB, dB };
}

/* ------------------------------------------------ 拡散対の解析解(図4・図5) */

/**
 * 定数 D̃ を仮定した拡散対の組成プロファイル(記事仕様 §5.4):
 *   X(x, t) = (X_brass / 2)[1 + erf(x / 2√(D̃t))]
 * 左(x < 0)が純 Cu(X = 0)、右が真鍮(X = X_brass)。
 */
export function coupleProfileAnalytic(
  x: number,
  t: number,
  dTilde: number,
  xBrass = X_BRASS,
): number {
  if (t <= 0) return x < 0 ? 0 : xBrass;
  return (xBrass / 2) * (1 + erf(x / (2 * Math.sqrt(dTilde * t))));
}

/**
 * 上式の勾配 ∂X/∂x = (X_brass / 2√(π D̃ t)) exp(−x² / 4D̃t) [1/m]。
 */
export function coupleGradientAnalytic(
  x: number,
  t: number,
  dTilde: number,
  xBrass = X_BRASS,
): number {
  if (t <= 0) return 0;
  const l = Math.sqrt(dTilde * t);
  return (
    ((xBrass / 2) * Math.exp(-(x * x) / (4 * dTilde * t))) /
    (Math.sqrt(Math.PI) * l)
  );
}

/**
 * マーカー移動量の解析予測(図5 の理論線 — 記事仕様 §5.5):
 *   Δ(t) = X_brass (D_A − D_B) √(t / π D̃)
 * v = (D_A − D_B)∂X_A/∂x を x_m ≈ 0 で積分した結果。Δ ∝ √t。
 */
export function markerShiftAnalytic(
  dA: number,
  dB: number,
  t: number,
  xBrass = X_BRASS,
): number {
  const dTilde = interdiffusionD(xBrass / 2, dA, dB);
  return xBrass * (dA - dB) * Math.sqrt(t / (Math.PI * dTilde));
}

/* ------------------------------------------------ 拡散対の数値解(図3・図5) */

/** 陽解法の安定条件の安全係数(dt ≤ SAFETY·Δx²/D̃max) */
const CFL_SAFETY = 0.4;
/** 1 回の step() で許すサブステップ数の上限(発散防止) */
const MAX_SUBSTEPS = 4000;

export interface DiffusionCoupleOptions {
  /** 格子点数(既定 GRID_N) */
  n?: number;
  /** 計算領域の半幅 [m](既定 DOMAIN_HALF_M) */
  halfWidth?: number;
  /** 真鍮側の Zn 原子分率(既定 X_BRASS) */
  xBrass?: number;
}

/**
 * 1 次元相互拡散(実験室座標系)+ マーカー(格子)の移動。
 *
 *   ∂X/∂t = ∂/∂x( D̃(X) ∂X/∂x ),  D̃ = X_B D_A + X_A D_B
 *   dx_m/dt = (D_A − D_B) ∂X/∂x|_{x_m}
 *
 * 陽解法(中心差分・境界は零流束)。面上の D̃ は両隣の算術平均。
 * 質量 Σ X Δx は差分の telescoping により厳密に保存する。
 */
export class DiffusionCouple {
  readonly n: number;
  readonly dx: number;
  /** 格子点座標 [m](−halfWidth 〜 +halfWidth) */
  readonly x: Float64Array;
  /** Zn 原子分率 X(x) */
  readonly xZn: Float64Array;
  readonly xBrass: number;
  /** 固有拡散係数 [m²/s](温度・比の変更で書き換える) */
  dA: number;
  dB: number;
  /** 経過時間 [s] */
  time = 0;
  /** マーカー(格子)の位置 [m]。初期は 0 = 初期界面 */
  markerX = 0;
  private readonly flux: Float64Array;

  constructor(dA: number, dB: number, opts: DiffusionCoupleOptions = {}) {
    this.n = opts.n ?? GRID_N;
    const half = opts.halfWidth ?? DOMAIN_HALF_M;
    this.xBrass = opts.xBrass ?? X_BRASS;
    this.dx = (2 * half) / (this.n - 1);
    this.x = new Float64Array(this.n);
    this.xZn = new Float64Array(this.n);
    this.flux = new Float64Array(this.n + 1);
    for (let i = 0; i < this.n; i++) this.x[i] = -half + i * this.dx;
    this.dA = dA;
    this.dB = dB;
    this.reset();
  }

  /** 段差初期条件(左 = 純 Cu、右 = 真鍮)へ戻す。t = 0、マーカーも原点へ */
  reset(): void {
    for (let i = 0; i < this.n; i++) {
      // x = 0 の格子点は界面上なので中間値を置く(段差の対称性を保つ)
      this.xZn[i] =
        this.x[i] < 0 ? 0 : this.x[i] > 0 ? this.xBrass : this.xBrass / 2;
    }
    this.time = 0;
    this.markerX = 0;
  }

  /** 現在の D̃ の最大値 [m²/s](安定条件の評価用) */
  private maxDTilde(): number {
    return Math.max(this.dA, this.dB);
  }

  /** 安定条件を満たす最大サブステップ [s] */
  stableDt(): number {
    return (CFL_SAFETY * this.dx * this.dx) / this.maxDTilde();
  }

  /** 位置 x [m] の組成を線形補間で返す */
  compositionAt(xPos: number): number {
    const t = (xPos - this.x[0]) / this.dx;
    if (t <= 0) return this.xZn[0];
    if (t >= this.n - 1) return this.xZn[this.n - 1];
    const i = Math.floor(t);
    const f = t - i;
    return this.xZn[i] * (1 - f) + this.xZn[i + 1] * f;
  }

  /** 位置 x [m] の勾配 ∂X/∂x [1/m](中心差分 + 線形補間) */
  gradientAt(xPos: number): number {
    const t = clamp((xPos - this.x[0]) / this.dx, 0, this.n - 1);
    const i = clamp(Math.round(t), 1, this.n - 2);
    return (this.xZn[i + 1] - this.xZn[i - 1]) / (2 * this.dx);
  }

  /** Σ X Δx [m](質量保存の検証用) */
  totalSolute(): number {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.xZn[i];
    return s * this.dx;
  }

  /** 時間を dtTotal [s] 進める(内部で安定条件を満たすサブステップに分割) */
  step(dtTotal: number): void {
    if (dtTotal <= 0) return;
    const hMax = this.stableDt();
    const steps = Math.min(Math.ceil(dtTotal / hMax), MAX_SUBSTEPS);
    const h = dtTotal / steps;
    for (let s = 0; s < steps; s++) this.substep(h);
  }

  /** 1 サブステップ(陽解法)。マーカーも同じ刻みで積分する */
  private substep(h: number): void {
    const { n, dx, xZn, flux } = this;
    // 面上の流束 F_{i+1/2} = −D̃_{i+1/2}(X_{i+1} − X_i)/Δx。両端は零流束
    flux[0] = 0;
    flux[n] = 0;
    for (let i = 0; i < n - 1; i++) {
      const dL = interdiffusionD(xZn[i], this.dA, this.dB);
      const dR = interdiffusionD(xZn[i + 1], this.dA, this.dB);
      flux[i + 1] = (-0.5 * (dL + dR) * (xZn[i + 1] - xZn[i])) / dx;
    }
    // マーカーは更新前の勾配で動かす(格子に固定された目印 — §5.4)
    const v = markerVelocity(this.dA, this.dB, this.gradientAt(this.markerX));
    for (let i = 0; i < n; i++) {
      xZn[i] += (h * (flux[i] - flux[i + 1])) / dx;
    }
    this.markerX = clamp(this.markerX + v * h, this.x[0], this.x[n - 1]);
    this.time += h;
  }
}

/* ---------------------------------------------- ボイド生成モデル(図6 §5.6) */

/** ボイドの最大個数(配列を使い回すための上限) */
export const VOID_MAX = 24;
/** 核生成の間隔 [モデル秒](S > S* の間、この間隔で 1 個ずつ) */
const NUCLEATION_INTERVAL = 0.25;
/** ボイドの成長係数 [面積/モデル秒](過飽和 1 あたり) */
const GROWTH_COEF = 0.12;
/** ボイド 1 個あたりの過飽和の消費係数 */
const CONSUME_COEF = 0.35;
/** ボイド 1 個の面積の上限(合体を模した頭打ち) */
const AREA_MAX = 1.6;

/**
 * 空孔の過飽和とボイド生成の 0 次元速度式モデル(記事仕様 §5.6)。
 *
 *   dS/dt = g − k_sink (S − 1) − c_consume · N · max(S − 1, 0)
 *   dA_i/dt = c_grow · max(S − 1, 0)
 *
 * S = C_V / C_V^eq(過飽和度)。g は界面へ流れ込む空孔の供給(D_A − D_B が
 * 大きいほど大きい)、k_sink は転位・粒界が空孔を飲み込む能力。
 * S > S* の間だけ新しいボイドが核生成する。位置はシード固定で widget 側が持つ。
 */
export class VoidGrowthModel {
  /** 過飽和度 S = C_V / C_V^eq */
  s = 1;
  /** 空孔の供給 g */
  supply: number;
  /** 吸収源の効き k_sink */
  sink: number;
  /** 凝集のしきい値 S* */
  threshold: number;
  /** 発生済みボイドの個数 */
  count = 0;
  /** 各ボイドの面積(モデル単位) */
  readonly areas = new Float64Array(VOID_MAX);
  /** 累積時間 [モデル秒] */
  time = 0;
  private nucleationClock = 0;

  constructor(supply: number, sink: number, threshold: number) {
    this.supply = supply;
    this.sink = sink;
    this.threshold = threshold;
  }

  reset(): void {
    this.s = 1;
    this.count = 0;
    this.areas.fill(0);
    this.time = 0;
    this.nucleationClock = 0;
  }

  /** ボイドの総面積(モデル単位) */
  totalArea(): number {
    let a = 0;
    for (let i = 0; i < this.count; i++) a += this.areas[i];
    return a;
  }

  /**
   * 時間を h [モデル秒] 進める。新しくボイドが核生成したら true を返す
   * (widget 側が位置を決めるためのフック)。
   */
  step(h: number): boolean {
    const excess = Math.max(this.s - 1, 0);
    // 成長(面積上限で頭打ち。上限に達した分は過飽和を消費しない)
    let growing = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.areas[i] < AREA_MAX) {
        this.areas[i] = Math.min(
          this.areas[i] + GROWTH_COEF * excess * h,
          AREA_MAX,
        );
        growing++;
      }
    }
    // 過飽和の収支
    const ds =
      this.supply - this.sink * (this.s - 1) - CONSUME_COEF * growing * excess;
    this.s = Math.max(1, this.s + ds * h);
    this.time += h;
    // 核生成(S > S* の間だけ)
    let nucleated = false;
    if (this.s > this.threshold && this.count < VOID_MAX) {
      this.nucleationClock += h;
      if (this.nucleationClock >= NUCLEATION_INTERVAL) {
        this.nucleationClock = 0;
        this.areas[this.count] = 0;
        this.count++;
        nucleated = true;
      }
    } else {
      this.nucleationClock = 0;
    }
    return nucleated;
  }
}

/* -------------------------------------------- 中空ナノ粒子モデル(図7 §5.7) */

/** 殻の厚さの下限 [nm](h → 0 での発散を避ける数値処理) */
const SHELL_H_MIN_NM = 0.4;
/** 拡散律速の速度係数 [nm/モデル秒](殻を通る体積流量 = K·D_rel·A/h) */
const HOLLOW_RATE = 0.06;

/**
 * 球対称の中空化モデル(ナノスケールカーケンドール効果 — 記事仕様 §5.7)。
 *
 * 生成物(化合物)の殻を通って、金属が外向きに、反応種が内向きに拡散する。
 * 反応は殻の両側で起きる: 外へ出た金属は外表面で反応種と出会い、内へ入った
 * 反応種は内側の界面でコアの金属と出会う。どちらもコアの金属を消費する。
 * 体積の勘定(モデルの化学量論として金属:反応種 = 1:1 の体積比を仮定):
 *   q_M = K·D_M·A/h(外向きに運ばれる金属)、q_X = K·D_X·A/h(内向きの反応種)
 *   dV_core/dt  = −(q_M + q_X)        コアの金属が消費される
 *   dV_shell/dt = +2(q_M + q_X)       生成物 = 金属 + 反応種
 *   dV_void/dt  = q_M − q_X           内側で「空いた分 − 埋まった分」= 空洞
 * したがって反応の速さは和(≈ 一定)で決まり、**空洞の大きさは差で決まる**。
 * D_M < D_X なら差が負になり空洞はできない(内側から埋まる)。
 */
export class HollowParticleModel {
  /** 初期半径 [nm] */
  readonly r0: number;
  /** 相対拡散係数(和を 2 に固定し、比だけを振る) */
  dMetal: number;
  dReactant: number;
  /** 未反応コアの体積 [nm³] */
  vCore: number;
  /** 生成物の殻の体積 [nm³] */
  vShell = 0;
  /** 中心空洞の体積 [nm³] */
  vVoid = 0;
  /** 経過時間 [モデル秒] */
  time = 0;

  constructor(r0: number, ratio: number) {
    this.r0 = r0;
    this.vCore = sphereVolume(r0);
    const pair = dPairFromRatio(ratio, 2);
    this.dMetal = pair.dA;
    this.dReactant = pair.dB;
  }

  setRatio(ratio: number): void {
    const pair = dPairFromRatio(ratio, 2);
    this.dMetal = pair.dA;
    this.dReactant = pair.dB;
  }

  reset(): void {
    this.vCore = sphereVolume(this.r0);
    this.vShell = 0;
    this.vVoid = 0;
    this.time = 0;
  }

  /** 空洞の半径 [nm] */
  voidRadius(): number {
    return radiusOfVolume(this.vVoid);
  }

  /** コアの外側半径 [nm](空洞 + コア) */
  coreRadius(): number {
    return radiusOfVolume(this.vVoid + this.vCore);
  }

  /** 粒子の外半径 [nm] */
  outerRadius(): number {
    return radiusOfVolume(this.vVoid + this.vCore + this.vShell);
  }

  /** 殻の厚さ [nm] */
  shellThickness(): number {
    return this.outerRadius() - this.coreRadius();
  }

  /** 反応率(0〜1) */
  conversion(): number {
    return 1 - this.vCore / sphereVolume(this.r0);
  }

  /** 反応が完了しているか */
  done(): boolean {
    return this.vCore <= 0;
  }

  /** 時間を h [モデル秒] 進める */
  step(h: number): void {
    if (this.done()) return;
    const rc = this.coreRadius();
    const ro = this.outerRadius();
    const hShell = Math.max(ro - rc, SHELL_H_MIN_NM);
    const rMid = (rc + ro) / 2;
    const area = 4 * Math.PI * rMid * rMid;
    const qM = (HOLLOW_RATE * this.dMetal * area * h) / hShell;
    const qX = (HOLLOW_RATE * this.dReactant * area * h) / hShell;
    // コアは両方の経路で消費される。尽きる直前は比を保って按分する
    const demand = qM + qX;
    const consumed = Math.min(demand, this.vCore);
    const f = demand > 0 ? consumed / demand : 0;
    this.vCore -= consumed;
    this.vShell += 2 * consumed;
    // 空洞は「内側で空いた分 − 内側から埋まった分」= 流出と流入の差
    this.vVoid = Math.max(0, this.vVoid + f * (qM - qX));
    if (this.vCore < 1e-9) this.vCore = 0;
    this.time += h;
  }
}

/** 半径 [nm] から球の体積 [nm³] */
export function sphereVolume(r: number): number {
  return (4 / 3) * Math.PI * r * r * r;
}

/** 球の体積 [nm³] から半径 [nm] */
export function radiusOfVolume(v: number): number {
  return v <= 0 ? 0 : Math.cbrt((3 * v) / (4 * Math.PI));
}

/* ------------------------------------------------------------ 補助 */

/**
 * シード固定の一様乱数列を配列に詰める(ディザ表現・粒子配置の再現性用)。
 * reset で完全に同じ初期状態へ戻すため、各図版はこれを使い回す(§8.2)。
 */
export function fillRandom(out: Float64Array, seed: number): void {
  const rand = mulberry32(seed);
  for (let i = 0; i < out.length; i++) out[i] = rand();
}
