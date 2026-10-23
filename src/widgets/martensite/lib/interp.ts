/**
 * interp.ts — 実測値の表の補間(記事仕様書 10 §2.3)
 *
 * 硬さの表のような「単調に増える実測値」を、折れ線より滑らかに、しかも
 * 単調性を壊さずにつなぐための単調 3 次エルミート補間(Fritsch–Carlson)。
 * 隣り合う 2 点が同じ値なら、その区間は水平になる(頭打ちの表現)。
 */

export type Table = ReadonlyArray<readonly [number, number]>;

/**
 * 表 [[x0, y0], [x1, y1], …](x は昇順)から、単調性を保つ補間関数を作る。
 * 表の範囲の外は端の値で一定にする。
 */
export function monotoneCubic(table: Table): (x: number) => number {
  const n = table.length;
  if (n < 2) throw new Error("monotoneCubic: 2 点以上が必要です");
  const xs = table.map((p) => p[0]);
  const ys = table.map((p) => p[1]);
  for (let i = 1; i < n; i++) {
    if (!(xs[i] > xs[i - 1])) {
      throw new Error("monotoneCubic: x は狭義の昇順であること");
    }
  }
  // 区間の傾き
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  // 節点の傾き(端は片側、内側は平均。符号が変わる・どちらかが 0 なら 0)
  const m: number[] = new Array<number>(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  // Fritsch–Carlson の制限(α² + β² ≤ 9)で行き過ぎを抑える
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }
  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
  };
}

/**
 * 表の点を折れ線でつなぐ補間関数(x は狭義の昇順)。表の範囲の外は端の値で
 * 一定にする。点のあいだに表にない山や谷を作らない(単調な表なら単調)。
 */
export function piecewiseLinear(table: Table): (x: number) => number {
  const n = table.length;
  if (n < 2) throw new Error("piecewiseLinear: 2 点以上が必要です");
  for (let i = 1; i < n; i++) {
    if (!(table[i][0] > table[i - 1][0])) {
      throw new Error("piecewiseLinear: x は狭義の昇順であること");
    }
  }
  return (x: number): number => {
    if (x <= table[0][0]) return table[0][1];
    if (x >= table[n - 1][0]) return table[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > table[i + 1][0]) i++;
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
}
