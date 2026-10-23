/**
 * carriers1d.ts — 1 次元のキャリア粒子の集合(カテゴリ D 共通。仕様書 12 §0-1・§5.0)
 *
 * 記事「フェルミ準位」の図4(生成と再結合)と、記事「pn 接合」の図1
 * (接合の形成)・図4(坂を越える)が使う。粒子の位置 x は結晶の幅を 1 と
 * した無次元量(区間は呼び出し側が bounds で与える)。
 *
 * - 位置・速度は事前確保した Float64Array に持ち、削除は末尾との入れ替え
 *   (フレーム内の新規割当てなし — 母体仕様 §8.3)
 * - 熱運動は速度に揺らぎを与えるオルンシュタイン=ウーレンベック過程。
 *   位置にじかに乱数を足す方式は画面上でガタつくので使わない(仕様書 12 §5.4)
 * - 乱数は呼び出し側が渡す一様乱数(mulberry32 など)だけを使い、モジュールに
 *   状態を持たない(同じページの別の図版と乱数列が混ざらない = シード固定で
 *   同じ軌跡になる)
 */

/** 熱運動のパラメータ */
export interface ThermalParams {
  /** 速さの目安 = 定常状態での速度の標準偏差 [幅/秒] */
  speed: number;
  /** 方向の記憶時間 = 速度の相関時間 [秒] */
  tau: number;
}

/** 粒子が動ける区間(両端で反射する) */
export interface Bounds {
  min: number;
  max: number;
}

/**
 * 位置 x・速度 v を事前確保した粒子の集合。
 *
 * aux は粒子ごとの付随値のチャンネル(描画の縦位置・生まれた時刻・
 * エネルギーなど)で、`removeAt` で x・v と一緒に入れ替わる。
 * `new CarrierSet(capacity)` のように省略すればチャンネルなし。
 */
export class CarrierSet {
  readonly capacity: number;
  readonly x: Float64Array;
  readonly v: Float64Array;
  readonly aux: readonly Float64Array[];
  /** 現在の粒子数(添字 0〜count−1 が有効) */
  count = 0;

  constructor(capacity: number, auxChannels = 0) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.x = new Float64Array(this.capacity);
    this.v = new Float64Array(this.capacity);
    const aux: Float64Array[] = [];
    for (let c = 0; c < auxChannels; c++) {
      aux.push(new Float64Array(this.capacity));
    }
    this.aux = aux;
  }

  /**
   * 粒子を末尾に足し、その添字を返す(満杯なら −1 で何もしない)。
   * aux の値は 0 で初期化されるので、必要なら返った添字に書き込む。
   */
  add(x: number, v: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.x[i] = x;
    this.v[i] = v;
    for (let c = 0; c < this.aux.length; c++) this.aux[c][i] = 0;
    return i;
  }

  /**
   * 添字 i の粒子を消す。末尾の粒子を i に移すので、残りの粒子の
   * (位置・速度・aux)の組は保たれるが、添字の順序は変わる。
   * 走査しながら消すときは添字の大きい方から回すこと。
   */
  removeAt(i: number): void {
    if (i < 0 || i >= this.count) return;
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.v[i] = this.v[last];
    for (let c = 0; c < this.aux.length; c++) {
      const a = this.aux[c];
      a[i] = a[last];
    }
  }

  /** すべての粒子を消す */
  clear(): void {
    this.count = 0;
  }
}

/**
 * 滑らかな熱運動で 1 ステップ進める(オルンシュタイン=ウーレンベック過程の
 * 厳密な離散化)。
 *
 *   v ← v·a + speed·√(1 − a²)·ξ,  a = e^{−dt/τ},  ξ ~ N(0, 1)
 *   x ← x + v·dt(区間の端では鏡映して反射し、速度の向きを反転)
 *
 * 速度の分散は speed² に保たれる(初期値によらず τ 程度で収束する)。
 * rand は [0, 1) の一様乱数。正規乱数はボックス=ミュラー法で 2 粒子ぶんずつ
 * 作る(モジュールに状態を残さない)。
 */
export function thermalStep(
  set: CarrierSet,
  dt: number,
  params: ThermalParams,
  rand: () => number,
  bounds: Bounds,
): void {
  const n = set.count;
  if (n === 0 || !(dt > 0)) return;
  const a = params.tau > 0 ? Math.exp(-dt / params.tau) : 0;
  const s = params.speed * Math.sqrt(Math.max(0, 1 - a * a));
  const xs = set.x;
  const vs = set.v;
  const lo = bounds.min;
  const hi = bounds.max;
  for (let i = 0; i < n; i += 2) {
    // ボックス=ミュラー: 一様乱数 2 つから独立な標準正規乱数 2 つ
    let u1 = rand();
    if (u1 < 1e-300) u1 = 1e-300;
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * u2;
    for (let k = 0; k < 2 && i + k < n; k++) {
      const j = i + k;
      const z = k === 0 ? r * Math.cos(th) : r * Math.sin(th);
      let v = vs[j] * a + s * z;
      let x = xs[j] + v * dt;
      if (x < lo) {
        x = 2 * lo - x;
        v = -v;
      } else if (x > hi) {
        x = 2 * hi - x;
        v = -v;
      }
      // 1 ステップで区間幅を超える異常な速さでも区間の外に出さない
      if (x < lo) x = lo;
      else if (x > hi) x = hi;
      xs[j] = x;
      vs[j] = v;
    }
  }
}

/**
 * 位置に依存する加速度(電場による力 — pn 接合の記事)を速度に足す。
 * accel(x) は [幅/秒²]。正孔は電場の向き、電子は逆向きになるよう、
 * 符号は呼び出し側で与える。
 */
export function addDrift(
  set: CarrierSet,
  dt: number,
  accel: (x: number) => number,
): void {
  const n = set.count;
  for (let i = 0; i < n; i++) set.v[i] += accel(set.x[i]) * dt;
}

/** nearestWithin の結果 */
export interface NearestResult {
  /** 最も近い粒子の添字(w 以内にいなければ −1) */
  index: number;
  /** w 以内(距離 ≤ w)にいる粒子の数 */
  count: number;
}

/** out を省略したときに使い回す結果(呼んだ直後に読むこと) */
const scratch: NearestResult = { index: -1, count: 0 };

/**
 * 位置 x から w 以内で最も近い粒子の添字と、w 以内の粒子の数を返す
 * (再結合の相手探し)。exclude には除外する添字(同じ集合の中で探すとき
 * 自分自身)を渡す。結果は out(省略時は使い回しの共有オブジェクト)に
 * 書き込んで返すので、フレーム内の新規割当ては起きない。
 */
export function nearestWithin(
  set: CarrierSet,
  x: number,
  w: number,
  exclude = -1,
  out: NearestResult = scratch,
): NearestResult {
  let best = -1;
  let bestD = Infinity;
  let count = 0;
  const xs = set.x;
  for (let i = 0; i < set.count; i++) {
    if (i === exclude) continue;
    const d = Math.abs(xs[i] - x);
    if (d <= w) {
      count++;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  out.index = best;
  out.count = count;
  return out;
}
