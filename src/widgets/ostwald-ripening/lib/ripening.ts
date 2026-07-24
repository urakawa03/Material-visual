/**
 * ripening.ts — 平均場アンサンブルエンジン(記事仕様書 03 §5.0)
 *
 * 各粒子は成長方程式
 *   dr/dτ = (A/r)(1/r* − 1/r)、 r* = ⟨r⟩(体積保存閉包)
 * に従う。長さは nm、時間 τ は「200 °C 換算の秒」(constants.ts 参照)。
 *
 * 数値処理:
 * - 積分は体積空間 v = r³ で行う: dv/dτ = 3A(r/r* − 1)。
 *   r → 0 の極限でも dv/dτ → −3A と有界なので、半径空間の 1/r² の
 *   スティフネスが消える。
 * - Heun 法(2 次)。中点評価でも r* を再計算するため、溶解イベントの
 *   ない区間では Σr³ が機械精度で保存される(受け入れテスト (b))。
 * - r < r_dis で「溶解」としてアンサンブルから除去し、dissolvedNow で
 *   ウィジェットに通知する(フェード演出用)。溶解粒子の残余体積と
 *   クランプ誤差は、毎サブステップ末尾の再スケーリングで生存粒子へ
 *   吸収する(残った溶質は母相を介して他の粒子に配られる、の数値版)。
 *   これにより Σr³ は溶解イベントをまたいでも厳密に一定に保たれる。
 */

import { mulberry32, gaussian } from "../../../core/mathx";
import { K_REF_NM3S, R_DIS_NM, R0_MEDIAN_NM, R0_SIGMA_LN } from "./constants";

/**
 * エンジンの成長係数 A [nm³/s]。
 * LSW の漸近則では d r̄³/dτ = (4/9)A なので A = (9/4)K が名目値。
 * 実際のアンサンブル(対数正規の初期分布・有限 N)では過渡域の実効
 * 速度がわずかにずれるため、前係数を「r̄(τ=10 h) ≈ 15 nm」となるよう
 * 校正している(§5.0。校正はリポジトリ外の検証スクリプトで測定)。
 */
const CALIBRATION = 0.7172;
export const A_GROWTH_NM3S = (9 / 4) * K_REF_NM3S * CALIBRATION;

/** 1 サブステップで許す r̄³ に対する変化量の割合(精度パラメータ) */
const STEP_FRAC = 0.02;
/** step() 1 回あたりのサブステップ数の上限(フレーム暴走の保険) */
const MAX_SUBSTEPS = 4000;

export interface EnsembleOptions {
  /** 粒子数 N₀ */
  count: number;
  /** 乱数シード(reset で完全に同じ初期状態に戻る — 母体仕様 §8.2) */
  seed: number;
  /** 初期半径の中央値 [nm](既定 5) */
  medianNm?: number;
  /** 初期半径の対数標準偏差(既定 0.25) */
  sigmaLn?: number;
  /**
   * 初期半径列 [nm] を直接指定する(2 粒子テストなど)。
   * 指定時は対数正規生成を使わず、count はこの長さに一致させること。
   */
  radii?: ArrayLike<number>;
}

/** シード付き対数正規分布の半径列を生成する [nm] */
export function lognormalRadii(
  count: number,
  seed: number,
  medianNm: number = R0_MEDIAN_NM,
  sigmaLn: number = R0_SIGMA_LN,
): Float64Array {
  const rand = mulberry32(seed);
  const gauss = gaussian(rand);
  const out = new Float64Array(count);
  const mu = Math.log(medianNm);
  for (let i = 0; i < count; i++) {
    out[i] = Math.exp(mu + sigmaLn * gauss());
  }
  return out;
}

export class RipeningEnsemble {
  readonly count: number;
  /** 半径 [nm]。溶解済みは 0 */
  readonly r: Float64Array;
  /** 1 = 生存、0 = 溶解済み */
  readonly alive: Uint8Array;
  /** エンジン時間 τ [200 °C 換算の秒] */
  tau = 0;
  /** 生存粒子数 */
  aliveCount: number;
  /** 直前の step() で溶解した粒子のインデックス(呼び出しごとに書き換わる) */
  readonly dissolvedNow: number[] = [];

  private readonly opts: Required<Omit<EnsembleOptions, "radii">> &
    Pick<EnsembleOptions, "radii">;
  /** 体積 v = r³ [nm³] */
  private readonly v: Float64Array;
  private readonly k1: Float64Array;
  private readonly r1: Float64Array;
  /** 初期の Σr³(体積分率の読み出し基準) */
  private sumV0 = 0;

  constructor(opts: EnsembleOptions) {
    this.opts = {
      medianNm: R0_MEDIAN_NM,
      sigmaLn: R0_SIGMA_LN,
      ...opts,
    };
    this.count = opts.count;
    this.r = new Float64Array(this.count);
    this.v = new Float64Array(this.count);
    this.alive = new Uint8Array(this.count);
    this.k1 = new Float64Array(this.count);
    this.r1 = new Float64Array(this.count);
    this.aliveCount = this.count;
    this.reset();
  }

  /** シード固定の初期状態へ戻す(毎回完全に同一) */
  reset(): void {
    const radii =
      this.opts.radii ??
      lognormalRadii(
        this.count,
        this.opts.seed,
        this.opts.medianNm,
        this.opts.sigmaLn,
      );
    this.sumV0 = 0;
    for (let i = 0; i < this.count; i++) {
      this.r[i] = radii[i];
      this.v[i] = radii[i] ** 3;
      this.alive[i] = 1;
      this.sumV0 += this.v[i];
    }
    this.aliveCount = this.count;
    this.tau = 0;
    this.dissolvedNow.length = 0;
  }

  /** 臨界半径 r* = ⟨r⟩(体積保存の帰結 — §S5) */
  rStar(): number {
    return this.meanR();
  }

  /** 生存粒子の平均半径 r̄ [nm] */
  meanR(): number {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i]) {
        sum += this.r[i];
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  }

  /** Σr³ [nm³](体積の代理。保存則の確認用) */
  sumR3(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i]) sum += this.v[i];
    }
    return sum;
  }

  /** 体積分率の初期値に対する比(≈ 1 のまま。読み出しカード用) */
  volumeRatio(): number {
    return this.sumR3() / this.sumV0;
  }

  /**
   * 生存粒子を半径順に並べたときの百分位 p(0〜1)にあたる粒子の
   * インデックスを返す(図5 の追跡対象の選択用)。生存粒子がなければ -1。
   */
  aliveIndexAtPercentile(p: number): number {
    const idx: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i]) idx.push(i);
    }
    if (idx.length === 0) return -1;
    idx.sort((a, b) => this.r[a] - this.r[b]);
    const k = Math.min(
      idx.length - 1,
      Math.max(0, Math.round(p * (idx.length - 1))),
    );
    return idx[k];
  }

  /**
   * エンジン時間を dTau [τ 秒] だけ進める。内部で適応サブステップに分割。
   * 溶解した粒子は dissolvedNow に積まれる(呼び出しごとにクリア)。
   */
  step(dTau: number): void {
    this.dissolvedNow.length = 0;
    if (dTau <= 0 || this.aliveCount <= 1) {
      this.tau += Math.max(dTau, 0);
      return;
    }
    const A = A_GROWTH_NM3S;
    let remaining = dTau;
    let guard = 0;

    const vDis = R_DIS_NM ** 3;

    while (remaining > 0 && this.aliveCount > 1) {
      if (++guard > MAX_SUBSTEPS) break;

      // r* と Σv(このサブステップの保存目標)
      let sumR = 0;
      let sumVBefore = 0;
      let n = 0;
      for (let i = 0; i < this.count; i++) {
        if (!this.alive[i]) continue;
        sumR += this.r[i];
        sumVBefore += this.v[i];
        n++;
      }
      const rStar = sumR / n;
      const h = Math.min((STEP_FRAC * rStar ** 3) / A, remaining);

      // Heun 法(中点でも r* を再計算 → 通常ステップでは Σv が厳密保存)
      let sumR1 = 0;
      for (let i = 0; i < this.count; i++) {
        if (!this.alive[i]) continue;
        const k = 3 * A * (this.r[i] / rStar - 1);
        this.k1[i] = k;
        const v1 = Math.max(this.v[i] + h * k, 0);
        this.r1[i] = Math.cbrt(v1);
        sumR1 += this.r1[i];
      }
      const rStar1 = sumR1 / n;
      let sumVAfter = 0;
      for (let i = 0; i < this.count; i++) {
        if (!this.alive[i]) continue;
        const k2 = 3 * A * (this.r1[i] / rStar1 - 1);
        const v = Math.max(this.v[i] + (h * (this.k1[i] + k2)) / 2, 0);
        if (v < vDis) {
          // 溶解: アンサンブルから除去。残余体積は下の再スケーリングで
          // 生存粒子に吸収される(母相を介した再配分の数値版 — §5.0)
          this.v[i] = 0;
          this.r[i] = 0;
          this.alive[i] = 0;
          this.aliveCount--;
          this.dissolvedNow.push(i);
        } else {
          this.v[i] = v;
          sumVAfter += v;
        }
      }

      // 体積保存の再スケーリング(溶解の残余とクランプ誤差を吸収)
      if (sumVAfter > 0 && this.aliveCount > 0) {
        const scale = sumVBefore / sumVAfter;
        for (let i = 0; i < this.count; i++) {
          if (!this.alive[i]) continue;
          this.v[i] *= scale;
          this.r[i] = Math.cbrt(this.v[i]);
        }
      }

      remaining -= h;
      this.tau += h;
    }
  }
}

/**
 * LSW の自己相似サイズ分布(拡散律速)の確率密度(u = r/r̄、u < 3/2)。
 * 実装用の解析式であり本文には掲載しない(§6)。規格化は数値で行うこと
 * (この関数は規格化前の形を返す)。
 */
export function lswPdf(u: number): number {
  if (u <= 0 || u >= 1.5) return 0;
  return (
    u *
    u *
    Math.pow(3 / (3 + u), 7 / 3) *
    Math.pow(1.5 / (1.5 - u), 11 / 3) *
    Math.exp(-u / (1.5 - u))
  );
}

/**
 * LSW 分布に従うシード付き半径列を生成する(平均 meanNm)。
 * 逆関数法(数値 CDF)による。図7 の組織スナップショットなど、
 * 「十分粗大化が進んだ後」の代表組織を作るのに使う。
 */
export function lswRadii(
  count: number,
  seed: number,
  meanNm: number,
): Float64Array {
  // 数値 CDF(u = r/r̄、0〜1.5)
  const N_TAB = 600;
  const cdf = new Float64Array(N_TAB + 1);
  const du = 1.5 / N_TAB;
  for (let i = 1; i <= N_TAB; i++) {
    cdf[i] = cdf[i - 1] + lswPdf((i - 0.5) * du) * du;
  }
  const total = cdf[N_TAB];
  const rand = mulberry32(seed);
  const out = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const target = rand() * total;
    // 二分探索
    let lo = 0;
    let hi = N_TAB;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid;
      else hi = mid;
    }
    const t = (target - cdf[lo]) / (cdf[hi] - cdf[lo] || 1);
    out[k] = (lo + t) * du * meanNm;
  }
  return out;
}

/**
 * 時系列の記録バッファ(図5・図1 のプロット用)。
 * 容量に達したら 1 点おきに間引いて記録間隔を 2 倍にする(対数時間軸に
 * 都合のよい「初期ほど密」なサンプリングが自然に得られる)。
 */
export class SeriesBuffer {
  readonly t: Float64Array;
  readonly v: Float64Array;
  length = 0;
  private interval: number;
  private readonly interval0: number;
  private lastT = -Infinity;

  constructor(capacity = 720, initialInterval = 1) {
    this.t = new Float64Array(capacity);
    this.v = new Float64Array(capacity);
    this.interval = initialInterval;
    this.interval0 = initialInterval;
  }

  clear(): void {
    this.length = 0;
    this.interval = this.interval0;
    this.lastT = -Infinity;
  }

  push(t: number, value: number): void {
    if (t - this.lastT < this.interval) return;
    if (this.length >= this.t.length) {
      // 半分に間引いて間隔を 2 倍にする
      const half = this.t.length >> 1;
      for (let i = 0; i < half; i++) {
        this.t[i] = this.t[i * 2];
        this.v[i] = this.v[i * 2];
      }
      this.length = half;
      this.interval *= 2;
    }
    this.t[this.length] = t;
    this.v[this.length] = value;
    this.length++;
    this.lastT = t;
  }
}
