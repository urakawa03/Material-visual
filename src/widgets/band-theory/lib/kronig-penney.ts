/**
 * kronig-penney.ts — クローニッヒ・ペニー模型のバンド計算(仕様書 11 §5.4)
 *
 * 周期 a の 1 次元結晶に、高さ U₀・幅 b の障壁を並べる(井戸幅 w = a − b)。
 * 井戸の中心が原子核の位置である。ブロッホの定理と接続条件から、許される
 * エネルギー E は次の超越方程式(式 E7)を満たすものに限られる:
 *
 *   cos(ka) = f(E)
 *
 *   f(E) = cos(αw)cosh(βb) + (β²−α²)/(2αβ)·sin(αw)sinh(βb)   (E < U₀)
 *   f(E) = cos(αw)cos(γb)  − (α²+γ²)/(2αγ)·sin(αw)sin(γb)    (E > U₀)
 *
 *   α = √(E/C), β = √((U₀−E)/C), γ = √((E−U₀)/C), C = ħ²/2m
 *
 * |f(E)| > 1 の E には実の k が存在しない = 禁制帯である(式 E8)。
 * 根の探索はすべて区間二分法(反復回数固定)で行い、フレーム内の新規割当てを
 * 避けるため呼び出し側が用意した配列へ書き込む API を用意する(母体仕様 §8.3)。
 *
 * すべて純関数。単体テスト(kronig-penney.test.ts)が
 * 「U₀ → 0 で自由電子 E = ħ²k²/2m に収束すること」を担保する。
 */

import { HBAR2_OVER_2M } from "./constants";

export interface KPParams {
  /** 周期 [nm] */
  a: number;
  /** 障壁の幅 [nm](0 ≤ b < a) */
  b: number;
  /** 障壁の高さ [eV](0 以上) */
  u0: number;
}

/** 許容帯(バンド)1 本 */
export interface Band {
  /** 下端 [eV](k = 0 または k = π/a のどちらか) */
  eLow: number;
  /** 上端 [eV] */
  eHigh: number;
}

/** 二分法の反復回数(固定。フレーム内での可変ループを避ける)。
    区間幅の 2⁻⁴⁰ 倍まで詰まるので、eV 単位では倍精度の限界に近い */
const BISECT_ITERATIONS = 40;
/** バンド端探索のエネルギー走査点数 */
const SCAN_SAMPLES = 4000;
/**
 * |f| がこれだけ 1 に近い極値は「ギャップ 0 の接触」とみなし、そこでバンドを
 * 分割する(U₀ → 0 の極限。f は ±1 に接するだけで符号を変えない)。
 * これより大きなギャップは走査で |f| > 1 として検出されるので、
 * 分割の取りこぼしにも過剰分割にもならない。
 */
const TOUCH_TOL = 2e-3;
/** E = 0 の特異点を避ける下限 [eV] */
const E_FLOOR = 1e-9;

/** sin(x)/x(x → 0 で 1)。α → 0・γ → 0 での 0/0 を避ける */
function sinc(x: number): number {
  if (Math.abs(x) < 1e-8) return 1 - (x * x) / 6;
  return Math.sin(x) / x;
}

/**
 * 判別関数 f(E)(式 E7)。cos(ka) = f(E) の右辺。
 * 障壁がない(b = 0 または U₀ = 0)ときは f(E) = cos(αa) となり、
 * 自由電子の分散がそのまま出る。
 */
export function kpDiscriminant(e: number, p: KPParams): number {
  const w = p.a - p.b;
  const alpha = Math.sqrt(Math.max(e, 0) / HBAR2_OVER_2M);
  // 障壁がない場合は 1 セルまるごと自由伝播
  if (p.b <= 0 || p.u0 <= 0) return Math.cos(alpha * p.a);

  const cosAw = Math.cos(alpha * w);
  // sin(αw)/α = w·sinc(αw) の形で持ち、α → 0 でも安全に評価する
  const sinAwOverAlpha = w * sinc(alpha * w);

  if (e < p.u0) {
    const beta = Math.sqrt((p.u0 - e) / HBAR2_OVER_2M);
    const bb = beta * p.b;
    // (β²−α²)/(2αβ)·sin(αw)sinh(βb)
    //   = (β²−α²)/(2β)·[sin(αw)/α]·sinh(βb)
    const coef = (beta * beta - alpha * alpha) / (2 * beta);
    return cosAw * Math.cosh(bb) + coef * sinAwOverAlpha * Math.sinh(bb);
  }
  const gamma = Math.sqrt((e - p.u0) / HBAR2_OVER_2M);
  const gb = gamma * p.b;
  // (α²+γ²)/(2αγ)·sin(αw)sin(γb)
  //   = (α²+γ²)/2·[sin(αw)/α]·[sin(γb)/γ]
  const coef = (alpha * alpha + gamma * gamma) / 2;
  return cosAw * Math.cos(gb) - coef * sinAwOverAlpha * (p.b * sinc(gb));
}

/**
 * f(E) = target の根を [lo, hi] で二分法により求める(f は区間内で単調)。
 * 単調の向きは両端の値から決める。端点で f = target ちょうどになる場合
 * (バンド端 k = 0 や k = π/a)でも正しい端点へ収束させるため、片側の値だけで
 * 向きを判定してはいけない。
 */
function bisectDiscriminant(
  lo: number,
  hi: number,
  target: number,
  p: KPParams,
): number {
  let a = lo;
  let b = hi;
  const decreasing = kpDiscriminant(lo, p) > kpDiscriminant(hi, p);
  for (let i = 0; i < BISECT_ITERATIONS; i++) {
    const mid = (a + b) / 2;
    const fm = kpDiscriminant(mid, p) - target;
    if (decreasing ? fm > 0 : fm < 0) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/**
 * 下から nBands 本の許容帯を返す(仕様書 11 §5.4)。
 * eMax までに上端が見つからないバンドは含めないので、戻り値の本数が
 * nBands より少なくなることがある(eMax を十分に広く取ること)。
 *
 * |f(E)| ≤ 1 の区間を走査で拾い、境界を二分法で詰める。ギャップが 0 に
 * つぶれる極限(U₀ → 0)では f が ±1 に接するだけで符号を変えないため、
 * 区間内で |f| が 1 に達する極値を見つけてそこで区間を分割する。
 */
export function findBands(p: KPParams, nBands: number, eMax: number): Band[] {
  const bands: Band[] = [];
  const step = (eMax - E_FLOOR) / SCAN_SAMPLES;
  let prevE = E_FLOOR;
  let prevF = kpDiscriminant(prevE, p);
  let prevInside = Math.abs(prevF) <= 1;
  let start = prevInside ? prevE : Number.NaN;
  // 接触判定のために 1 つ前の値も持つ
  let prev2F = prevF;

  for (let i = 1; i <= SCAN_SAMPLES && bands.length < nBands; i++) {
    const e = E_FLOOR + i * step;
    const f = kpDiscriminant(e, p);
    const inside = Math.abs(f) <= 1;

    if (!prevInside && inside) {
      // 禁制帯 → 許容帯: バンドの下端
      const target = prevF > 1 ? 1 : -1;
      start = bisectDiscriminant(prevE, e, target, p);
    } else if (prevInside && !inside) {
      // 許容帯 → 禁制帯: バンドの上端
      const target = f > 1 ? 1 : -1;
      const end = bisectDiscriminant(prevE, e, target, p);
      if (Number.isFinite(start)) bands.push({ eLow: start, eHigh: end });
      start = Number.NaN;
    } else if (inside && prevInside && Number.isFinite(start)) {
      // 区間の内部で |f| が 1 に接する(ギャップ 0)なら、そこで分割する
      const touchesTop =
        prevF >= 1 - TOUCH_TOL && prevF >= prev2F && prevF >= f;
      const touchesBottom =
        prevF <= -1 + TOUCH_TOL && prevF <= prev2F && prevF <= f;
      if ((touchesTop || touchesBottom) && prevE > start) {
        const eTouch = parabolicExtremum(prev2F, prevE, prevF, e, f);
        bands.push({ eLow: start, eHigh: eTouch });
        start = eTouch;
      }
    }

    prev2F = prevF;
    prevE = e;
    prevF = f;
    prevInside = inside;
  }
  // eMax に届かず上端が見つからなかったバンドは返さない(不完全な帯を
  // 描かせないため)。呼び出し側は必要な本数より広い eMax を渡すこと。
  return bands;
}

/**
 * 等間隔の 3 点 (x1−h, y0), (x1, y1), (x1+h, y2) から放物線補間で極値の位置を
 * 推定する(接触点の精度向上用。h = x2 − x1)。
 */
function parabolicExtremum(
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const d = y0 - 2 * y1 + y2;
  if (Math.abs(d) < 1e-15) return x1;
  const shift = (0.5 * (y0 - y2)) / d;
  return x1 + shift * (x2 - x1);
}

/**
 * 指定したバンドの、波数 k [nm⁻¹] におけるエネルギー [eV]。
 * f(E) = cos(ka) を band の区間内で二分法により解く(f はバンド内で単調)。
 * k は還元ゾーンの外でもよい(cos の周期性でそのまま扱える)。
 */
export function bandEnergyAt(k: number, band: Band, p: KPParams): number {
  const target = Math.cos(k * p.a);
  return bisectDiscriminant(band.eLow, band.eHigh, target, p);
}

/** k を第 1 ブリルアンゾーン(−π/a, π/a] へ折り返す(式 E9) */
export function reduceToFirstZone(k: number, a: number): number {
  const g = (2 * Math.PI) / a;
  return k - g * Math.round(k / g);
}

/** 拡張ゾーン表示で、波数 k が属するバンドの番号(1 始まり) */
export function extendedZoneBandIndex(k: number, a: number): number {
  const boundary = Math.PI / a;
  return Math.max(1, Math.ceil(Math.abs(k) / boundary - 1e-12));
}

/**
 * 周期ポテンシャルの第 1 フーリエ成分 V₁ [eV](式 E6)。
 * 井戸の中心を原点に取ると、幅 b・高さ U₀ の障壁列に対して
 * V₁ = −U₀·sin(πb/a)/π(負 = cos 型の定在波が低エネルギー側になる)。
 */
export function firstFourierComponent(p: KPParams): number {
  return (-p.u0 * Math.sin((Math.PI * p.b) / p.a)) / Math.PI;
}

/** ゾーン境界での 2 つの定在波のエネルギー(式 E6)。cos 型が低い側 */
export function standingWaveEnergies(p: KPParams): {
  eCos: number;
  eSin: number;
  gap: number;
} {
  const kBoundary = Math.PI / p.a;
  const e0 = HBAR2_OVER_2M * kBoundary * kBoundary;
  const v1 = Math.abs(firstFourierComponent(p));
  return { eCos: e0 - v1, eSin: e0 + v1, gap: 2 * v1 };
}

/**
 * 価電子数 Z(1 原子 = 1 周期あたり)からバンドの埋まり方を求める(図6)。
 * 1 次元では 1 バンドに 1 周期あたり 2 個(スピン 2 重)入る。
 */
export interface Filling {
  /** 満杯になったバンドの本数 */
  fullBands: number;
  /** 部分的に埋まったバンドの番号(0 始まり)。なければ −1 */
  partialBand: number;
  /** 部分的に埋まったバンドの充填率(0〜1)。満杯どまりなら 0 */
  partialFraction: number;
}

export function fillingForValence(z: number): Filling {
  const fullBands = Math.floor(z / 2);
  const rest = z - fullBands * 2;
  return {
    fullBands,
    partialBand: rest > 0 ? fullBands : -1,
    partialFraction: rest / 2,
  };
}
