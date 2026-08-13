/**
 * curves.ts — バンドを E-k 曲線としてサンプルするヘルパ(仕様書 11 §5.0)
 *
 * 図2・図4・図5・図6 が共通で使う。呼び出し側が用意したバッファへ書き込み、
 * フレーム内の新規割当てを避ける(母体仕様 §8.3)。
 */

import { bandEnergyAt, type Band, type KPParams } from "./kronig-penney";

export interface CurveBuffer {
  k: Float64Array;
  e: Float64Array;
  /** 有効な点数 */
  count: number;
}

export function createCurveBuffer(capacity: number): CurveBuffer {
  return {
    k: new Float64Array(capacity),
    e: new Float64Array(capacity),
    count: 0,
  };
}

/**
 * 還元ゾーン表示: バンドを −π/a 〜 π/a の範囲でサンプルする。
 */
export function fillReducedBand(
  buf: CurveBuffer,
  samples: number,
  band: Band,
  p: KPParams,
): void {
  const boundary = Math.PI / p.a;
  const n = Math.min(samples, buf.k.length);
  for (let i = 0; i < n; i++) {
    const k = -boundary + (2 * boundary * i) / (n - 1);
    buf.k[i] = k;
    buf.e[i] = bandEnergyAt(k, band, p);
  }
  buf.count = n;
}

/**
 * 拡張ゾーン表示: 第 index バンド(1 始まり)を
 * (index−1)π/a 〜 index·π/a の区間へ展開してサンプルする。
 * sign = +1 で正の k 側、−1 で負の k 側。
 */
export function fillExtendedSegment(
  buf: CurveBuffer,
  samples: number,
  band: Band,
  p: KPParams,
  index: number,
  sign: 1 | -1,
): void {
  const boundary = Math.PI / p.a;
  const kStart = (index - 1) * boundary;
  const kEnd = index * boundary;
  const n = Math.min(samples, buf.k.length);
  for (let i = 0; i < n; i++) {
    const k = kStart + ((kEnd - kStart) * i) / (n - 1);
    buf.k[i] = sign * k;
    // E(k) は偶関数かつ G 周期なので、正の k で計算して符号を付ければよい
    buf.e[i] = bandEnergyAt(k, band, p);
  }
  buf.count = n;
}
