/**
 * fft.test.ts — 汎用 FFT の単体テスト(仕様書 09 §5.8 T9)
 *
 * 往復で元に戻ること(1e-12)、パーセバルの等式、既知の正弦波のスペクトル、
 * 素朴な DFT との一致、実数 FFT(半分のスペクトル)と複素 FFT の一致を確かめる。
 */

import { describe, expect, it } from "vitest";
import { mulberry32 } from "./mathx";
import {
  angularWavenumber,
  createFFT,
  createFFT2D,
  createRealFFT2D,
  isPowerOfTwo,
} from "./fft";

function randomArray(n: number, seed: number): Float64Array {
  const rand = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  return out;
}

function maxAbsDiff(a: Float64Array, b: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** 素朴な 2D DFT(順変換。テストの基準) */
function naiveDFT2D(
  re: Float64Array,
  im: Float64Array,
  nx: number,
  ny: number,
): { re: Float64Array; im: Float64Array } {
  const outRe = new Float64Array(nx * ny);
  const outIm = new Float64Array(nx * ny);
  for (let ky = 0; ky < ny; ky++) {
    for (let kx = 0; kx < nx; kx++) {
      let sr = 0;
      let si = 0;
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const a = -2 * Math.PI * ((kx * x) / nx + (ky * y) / ny);
          const c = Math.cos(a);
          const s = Math.sin(a);
          const i = y * nx + x;
          sr += re[i] * c - im[i] * s;
          si += re[i] * s + im[i] * c;
        }
      }
      outRe[ky * nx + kx] = sr;
      outIm[ky * nx + kx] = si;
    }
  }
  return { re: outRe, im: outIm };
}

describe("isPowerOfTwo / 計画の作成", () => {
  it("2 のべき乗だけを受け付ける", () => {
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(64)).toBe(true);
    expect(isPowerOfTwo(96)).toBe(false);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(() => createFFT(96)).toThrow();
    expect(() => createFFT2D(64, 48)).toThrow();
  });

  it("角波数は −n/2 … n/2−1 に折り返した 2πm/n", () => {
    expect(angularWavenumber(0, 8)).toBe(0);
    expect(angularWavenumber(1, 8)).toBeCloseTo(Math.PI / 4, 15);
    expect(angularWavenumber(4, 8)).toBeCloseTo(-Math.PI, 15);
    expect(angularWavenumber(7, 8)).toBeCloseTo(-Math.PI / 4, 15);
  });
});

describe("1 次元 FFT", () => {
  const n = 64;
  const plan = createFFT(n);

  it("順変換 → 逆変換で元に戻る(1e-12)", () => {
    const re0 = randomArray(n, 1);
    const im0 = randomArray(n, 2);
    const re = re0.slice();
    const im = im0.slice();
    plan.forward(re, im);
    plan.inverse(re, im);
    expect(maxAbsDiff(re, re0)).toBeLessThan(1e-12);
    expect(maxAbsDiff(im, im0)).toBeLessThan(1e-12);
  });

  it("素朴な DFT と一致する", () => {
    const re0 = randomArray(n, 3);
    const im0 = randomArray(n, 4);
    const ref = naiveDFT2D(re0, im0, n, 1);
    const re = re0.slice();
    const im = im0.slice();
    plan.forward(re, im);
    expect(maxAbsDiff(re, ref.re)).toBeLessThan(1e-10);
    expect(maxAbsDiff(im, ref.im)).toBeLessThan(1e-10);
  });

  it("パーセバルの等式 Σ|x|² = (1/N) Σ|X|²", () => {
    const re = randomArray(n, 5);
    const im = randomArray(n, 6);
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += re[i] ** 2 + im[i] ** 2;
    plan.forward(re, im);
    let e1 = 0;
    for (let i = 0; i < n; i++) e1 += re[i] ** 2 + im[i] ** 2;
    expect(e1 / n).toBeCloseTo(e0, 10);
  });

  it("cos(2π·5n/N) のスペクトルは ±5 に N/2 ずつ、ほかは 0", () => {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    plan.forward(re, im);
    for (let k = 0; k < n; k++) {
      const expected = k === 5 || k === n - 5 ? n / 2 : 0;
      expect(re[k]).toBeCloseTo(expected, 10);
      expect(im[k]).toBeCloseTo(0, 10);
    }
  });

  it("offset を渡すと配列の途中の n 個だけを変換する", () => {
    const re = new Float64Array(3 * n);
    const im = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) re[n + i] = Math.sin((2 * Math.PI * 3 * i) / n);
    plan.forward(re, im, n);
    // sin → 虚部に ∓N/2
    expect(im[n + 3]).toBeCloseTo(-n / 2, 10);
    expect(im[n + n - 3]).toBeCloseTo(n / 2, 10);
    // 範囲外は触らない
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBe(0);
      expect(re[2 * n + i]).toBe(0);
    }
  });

  it("長さ 1 は恒等変換", () => {
    const p = createFFT(1);
    const re = Float64Array.of(2.5);
    const im = Float64Array.of(-1);
    p.forward(re, im);
    expect(re[0]).toBe(2.5);
    expect(im[0]).toBe(-1);
    p.inverse(re, im);
    expect(re[0]).toBe(2.5);
  });
});

describe("2 次元 FFT", () => {
  it("素朴な 2D DFT と一致する(8 × 4)", () => {
    const nx = 8;
    const ny = 4;
    const re0 = randomArray(nx * ny, 7);
    const im0 = randomArray(nx * ny, 8);
    const ref = naiveDFT2D(re0, im0, nx, ny);
    const re = re0.slice();
    const im = im0.slice();
    createFFT2D(nx, ny).forward(re, im);
    expect(maxAbsDiff(re, ref.re)).toBeLessThan(1e-10);
    expect(maxAbsDiff(im, ref.im)).toBeLessThan(1e-10);
  });

  it("往復で元に戻り(1e-12)、パーセバルの等式が成り立つ(64 × 64)", () => {
    const n = 64;
    const plan = createFFT2D(n, n);
    const re0 = randomArray(n * n, 9);
    const im0 = randomArray(n * n, 10);
    const re = re0.slice();
    const im = im0.slice();
    let e0 = 0;
    for (let i = 0; i < n * n; i++) e0 += re[i] ** 2 + im[i] ** 2;
    plan.forward(re, im);
    let e1 = 0;
    for (let i = 0; i < n * n; i++) e1 += re[i] ** 2 + im[i] ** 2;
    expect(e1 / (n * n)).toBeCloseTo(e0, 8);
    plan.inverse(re, im);
    expect(maxAbsDiff(re, re0)).toBeLessThan(1e-12);
    expect(maxAbsDiff(im, im0)).toBeLessThan(1e-12);
  });

  it("平面波 cos(k·r) のスペクトルは (kx, ky) と (−kx, −ky) だけ", () => {
    const nx = 32;
    const ny = 16;
    const re = new Float64Array(nx * ny);
    const im = new Float64Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        re[y * nx + x] = Math.cos(2 * Math.PI * ((3 * x) / nx + (2 * y) / ny));
      }
    }
    createFFT2D(nx, ny).forward(re, im);
    const peak = (nx * ny) / 2;
    for (let ky = 0; ky < ny; ky++) {
      for (let kx = 0; kx < nx; kx++) {
        const i = ky * nx + kx;
        const isPeak =
          (kx === 3 && ky === 2) || (kx === nx - 3 && ky === ny - 2);
        expect(re[i]).toBeCloseTo(isPeak ? peak : 0, 9);
        expect(im[i]).toBeCloseTo(0, 9);
      }
    }
  });
});

describe("実数 2D FFT(半分のスペクトル)", () => {
  function check(nx: number, ny: number, seed: number): void {
    const plan = createRealFFT2D(nx, ny);
    const input = randomArray(nx * ny, seed);
    const re = input.slice();
    const im = new Float64Array(nx * ny);
    createFFT2D(nx, ny).forward(re, im);
    const hRe = new Float64Array(ny * plan.hx);
    const hIm = new Float64Array(ny * plan.hx);
    const before = input.slice();
    plan.forward(input, hRe, hIm);
    // 入力は書き換えない
    expect(maxAbsDiff(input, before)).toBe(0);
    let err = 0;
    for (let ky = 0; ky < ny; ky++) {
      for (let kx = 0; kx < plan.hx; kx++) {
        const a = ky * plan.hx + kx;
        const b = ky * nx + kx;
        err = Math.max(err, Math.abs(hRe[a] - re[b]), Math.abs(hIm[a] - im[b]));
      }
    }
    expect(err).toBeLessThan(1e-10);
    // 逆変換で元に戻る(スペクトルは書き換えない)
    const specBefore = hRe.slice();
    const out = new Float64Array(nx * ny);
    plan.inverse(hRe, hIm, out);
    expect(maxAbsDiff(hRe, specBefore)).toBe(0);
    expect(maxAbsDiff(out, input)).toBeLessThan(1e-12);
  }

  it("複素 2D FFT の kx = 0 … nx/2 と一致し、往復で戻る(64 × 64)", () => {
    check(64, 64, 11);
  });

  it("長方形(32 × 8)・1 次元(16 × 1)でも同じ", () => {
    check(32, 8, 12);
    check(16, 1, 13);
  });

  it("nx < 2 は作れない", () => {
    expect(() => createRealFFT2D(1, 4)).toThrow();
  });
});
