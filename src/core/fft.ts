/**
 * fft.ts — 汎用の高速フーリエ変換(2 のべき乗・複素 in-place・1D / 2D)
 *
 * 記事「スピノーダル分解」(仕様書 09 §5.0)のカーン・ヒリアード方程式の
 * 半陰的スペクトル法のために新設した。記事に依存しない汎用部品なので
 * src/core に置く。
 *
 * - 実部と虚部を別々の Float64Array で持つ(割当てを避けるため、変換は
 *   すべて渡した配列を書き換える in-place)。
 * - 長さは 2 のべき乗に限る(基数 2 の反復型 Cooley–Tukey)。
 * - 符号の約束: 順変換 X_k = Σ_n x_n e^{−2πi kn/N}、
 *   逆変換 x_n = (1/N) Σ_k X_k e^{+2πi kn/N}(逆変換で 1/N を掛ける)。
 * - 回転因子・ビット反転の表は計画(plan)の作成時に 1 度だけ作る。
 *   変換の呼び出しでは新しい配列を割り当てない(母体仕様 §8.3)。
 *
 * 2D は行優先(index = y·nx + x)。行方向の変換をしてから列方向の変換を
 * する(列は作業用の配列に写して変換し、書き戻す)。
 */

/** n が 2 のべき乗(1 を含む)か */
export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
}

/** 1 次元 FFT の計画(長さ n の変換を繰り返し行うための表) */
export interface FFT1D {
  readonly n: number;
  /**
   * 順変換。re・im の [offset, offset + n) を書き換える。
   * offset は 2D の行変換のため(既定 0)。
   */
  forward(re: Float64Array, im: Float64Array, offset?: number): void;
  /** 逆変換(1/n の規格化つき)。引数は forward と同じ */
  inverse(re: Float64Array, im: Float64Array, offset?: number): void;
}

/** 長さ n(2 のべき乗)の 1 次元 FFT の計画を作る */
export function createFFT(n: number): FFT1D {
  if (!isPowerOfTwo(n)) {
    throw new Error(`createFFT: 長さは 2 のべき乗に限ります(n = ${n})`);
  }
  const half = n >> 1;
  // 回転因子 e^{−2πi k/n} の cos と sin(k = 0 … n/2 − 1)
  const cosT = new Float64Array(Math.max(half, 1));
  const sinT = new Float64Array(Math.max(half, 1));
  for (let k = 0; k < half; k++) {
    const a = (2 * Math.PI * k) / n;
    cosT[k] = Math.cos(a);
    sinT[k] = Math.sin(a);
  }
  // ビット反転の入れ替え対(i < j のものだけ)
  const swaps: number[] = [];
  let bits = 0;
  while (1 << bits < n) bits++;
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    if (i < r) swaps.push(i, r);
  }
  const swapTable = Int32Array.from(swaps);

  /**
   * dir = +1: 順変換(回転因子 e^{−iθ})、−1: 逆変換(e^{+iθ}・規格化なし)
   */
  function transform(
    re: Float64Array,
    im: Float64Array,
    offset: number,
    dir: number,
  ): void {
    for (let s = 0; s < swapTable.length; s += 2) {
      const a = offset + swapTable[s];
      const b = offset + swapTable[s + 1];
      const tr = re[a];
      re[a] = re[b];
      re[b] = tr;
      const ti = im[a];
      im[a] = im[b];
      im[b] = ti;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const h = size >> 1;
      const step = n / size;
      for (let start = offset; start < offset + n; start += size) {
        for (let j = 0, k = 0; j < h; j++, k += step) {
          const wr = cosT[k];
          const wi = dir * sinT[k];
          const p = start + j;
          const q = p + h;
          // t = (wr − i·wi) · x[q]: 順変換は e^{−iθ}、逆変換は e^{+iθ}
          const xr = re[q];
          const xi = im[q];
          const tr = wr * xr + wi * xi;
          const ti = wr * xi - wi * xr;
          re[q] = re[p] - tr;
          im[q] = im[p] - ti;
          re[p] += tr;
          im[p] += ti;
        }
      }
    }
  }

  return {
    n,
    forward(re, im, offset = 0): void {
      transform(re, im, offset, 1);
    },
    inverse(re, im, offset = 0): void {
      transform(re, im, offset, -1);
      const s = 1 / n;
      for (let i = offset; i < offset + n; i++) {
        re[i] *= s;
        im[i] *= s;
      }
    },
  };
}

/** 2 次元 FFT の計画(nx × ny、行優先) */
export interface FFT2D {
  readonly nx: number;
  readonly ny: number;
  /** 順変換(re・im は長さ nx·ny、行優先) */
  forward(re: Float64Array, im: Float64Array): void;
  /** 逆変換(1/(nx·ny) の規格化つき) */
  inverse(re: Float64Array, im: Float64Array): void;
}

/**
 * nx × ny(どちらも 2 のべき乗)の 2 次元 FFT の計画を作る。
 * ny = 1 なら 1 次元の変換と同じになる。
 */
export function createFFT2D(nx: number, ny: number): FFT2D {
  const rowPlan = createFFT(nx);
  const colPlan = createFFT(ny);
  const colRe = new Float64Array(ny);
  const colIm = new Float64Array(ny);

  function columns(re: Float64Array, im: Float64Array, inverse: boolean) {
    if (ny === 1) return;
    for (let x = 0; x < nx; x++) {
      for (let y = 0, i = x; y < ny; y++, i += nx) {
        colRe[y] = re[i];
        colIm[y] = im[i];
      }
      if (inverse) colPlan.inverse(colRe, colIm);
      else colPlan.forward(colRe, colIm);
      for (let y = 0, i = x; y < ny; y++, i += nx) {
        re[i] = colRe[y];
        im[i] = colIm[y];
      }
    }
  }

  return {
    nx,
    ny,
    forward(re, im): void {
      for (let y = 0; y < ny; y++) rowPlan.forward(re, im, y * nx);
      columns(re, im, false);
    },
    inverse(re, im): void {
      for (let y = 0; y < ny; y++) rowPlan.inverse(re, im, y * nx);
      columns(re, im, true);
    },
  };
}

/**
 * 実数の 2 次元配列の FFT(半分のスペクトル)の計画。
 *
 * 実数の場のスペクトルはエルミート対称(X(−k) = X(k)*)なので、x 方向の
 * 波数は 0 … nx/2 の hx = nx/2 + 1 列だけを持てば足りる。複素 2D FFT の
 * ほぼ半分の計算量で済む(行は 2 本ずつ 1 本の複素 FFT に詰めて変換する)。
 * スペクトルの配置は行優先で index = ky·hx + kx(ky は 0 … ny−1)。
 */
export interface RealFFT2D {
  readonly nx: number;
  readonly ny: number;
  /** x 方向に持つ波数の数 nx/2 + 1 */
  readonly hx: number;
  /**
   * 順変換。input(長さ nx·ny の実数の場)は書き換えない。
   * outRe・outIm(長さ ny·hx)に半分のスペクトルを書く。
   */
  forward(input: Float64Array, outRe: Float64Array, outIm: Float64Array): void;
  /**
   * 逆変換(1/(nx·ny) の規格化つき)。inRe・inIm は書き換えない。
   * output(長さ nx·ny)に実数の場を書く。
   */
  inverse(inRe: Float64Array, inIm: Float64Array, output: Float64Array): void;
}

/**
 * nx × ny(どちらも 2 のべき乗、nx ≥ 2)の実数 2D FFT の計画を作る。
 * ny = 1 なら 1 次元の実数 FFT になる。
 */
export function createRealFFT2D(nx: number, ny: number): RealFFT2D {
  if (nx < 2) throw new Error("createRealFFT2D: nx は 2 以上にしてください");
  const rowPlan = createFFT(nx);
  const colPlan = createFFT(ny);
  const hx = (nx >> 1) + 1;
  const rowRe = new Float64Array(nx);
  const rowIm = new Float64Array(nx);
  const colRe = new Float64Array(ny);
  const colIm = new Float64Array(ny);
  const workRe = new Float64Array(ny * hx);
  const workIm = new Float64Array(ny * hx);
  const mask = nx - 1;

  /** 半分のスペクトルの列(kx 固定)を y 方向に変換する */
  function columns(re: Float64Array, im: Float64Array, inverse: boolean) {
    if (ny === 1) return;
    for (let kx = 0; kx < hx; kx++) {
      for (let y = 0, i = kx; y < ny; y++, i += hx) {
        colRe[y] = re[i];
        colIm[y] = im[i];
      }
      if (inverse) colPlan.inverse(colRe, colIm);
      else colPlan.forward(colRe, colIm);
      for (let y = 0, i = kx; y < ny; y++, i += hx) {
        re[i] = colRe[y];
        im[i] = colIm[y];
      }
    }
  }

  return {
    nx,
    ny,
    hx,
    forward(input, outRe, outIm): void {
      // 行 y0 = 2j を実部、y1 = 2j+1 を虚部に詰めて 1 回の複素 FFT で変換し、
      // エルミート対称を使って 2 本に分ける:
      //   A(k) = (Z(k) + Z(−k)*)/2、 B(k) = (Z(k) − Z(−k)*)/(2i)
      for (let y0 = 0; y0 < ny; y0 += 2) {
        const y1 = y0 + 1;
        const base0 = y0 * nx;
        const base1 = y1 * nx;
        const hasPair = y1 < ny;
        for (let x = 0; x < nx; x++) {
          rowRe[x] = input[base0 + x];
          rowIm[x] = hasPair ? input[base1 + x] : 0;
        }
        rowPlan.forward(rowRe, rowIm);
        const o0 = y0 * hx;
        const o1 = y1 * hx;
        for (let kx = 0; kx < hx; kx++) {
          const m = (nx - kx) & mask;
          const zr = rowRe[kx];
          const zi = rowIm[kx];
          const mr = rowRe[m];
          const mi = rowIm[m];
          outRe[o0 + kx] = 0.5 * (zr + mr);
          outIm[o0 + kx] = 0.5 * (zi - mi);
          if (hasPair) {
            outRe[o1 + kx] = 0.5 * (zi + mi);
            outIm[o1 + kx] = 0.5 * (mr - zr);
          }
        }
      }
      columns(outRe, outIm, false);
    },
    inverse(inRe, inIm, output): void {
      workRe.set(inRe);
      workIm.set(inIm);
      columns(workRe, workIm, true);
      // 行 y0・y1 の(x 方向の)半分のスペクトル A・B から Z = A + iB を
      // 組み立てて逆変換すると、実部が行 y0、虚部が行 y1 になる
      for (let y0 = 0; y0 < ny; y0 += 2) {
        const y1 = y0 + 1;
        const hasPair = y1 < ny;
        const o0 = y0 * hx;
        const o1 = y1 * hx;
        for (let kx = 0; kx < hx; kx++) {
          const ar = workRe[o0 + kx];
          const ai = workIm[o0 + kx];
          const br = hasPair ? workRe[o1 + kx] : 0;
          const bi = hasPair ? workIm[o1 + kx] : 0;
          rowRe[kx] = ar - bi;
          rowIm[kx] = ai + br;
          if (kx > 0 && kx < nx - kx) {
            // 負の波数 −kx の成分: A* + iB*
            rowRe[nx - kx] = ar + bi;
            rowIm[nx - kx] = br - ai;
          }
        }
        rowPlan.inverse(rowRe, rowIm);
        const base0 = y0 * nx;
        const base1 = y1 * nx;
        for (let x = 0; x < nx; x++) {
          output[base0 + x] = rowRe[x];
          if (hasPair) output[base1 + x] = rowIm[x];
        }
      }
    },
  };
}

/**
 * 離散フーリエ変換の添字 m(0 … n−1)に対応する角波数 k = 2π m'/n を返す。
 * m' は −n/2 … n/2−1 に折り返した値(numpy の fftfreq × 2π と同じ)。
 * 格子間隔は 1 とする。
 */
export function angularWavenumber(m: number, n: number): number {
  const mm = m < n / 2 ? m : m - n;
  return (2 * Math.PI * mm) / n;
}
