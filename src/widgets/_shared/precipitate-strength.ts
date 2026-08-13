/**
 * precipitate-strength.ts — 析出強化(オロワン機構)の共有モジュール
 * (GPゾーン仕様書 07 §5.0。オストワルド成長テーマとも共用する)
 *
 * 粒子間隔 L = β r/√f と オロワン応力 Δτ = μb/L は、オストワルド成長記事
 * (過時効 = 間隔が開いて弱くなる側)と GPゾーン記事(ピーク時効 = 切断と
 * 迂回の交点)で完全に重複する概念なので、係数を引数で受け取る素の関数と
 * してここへ昇格させた(母体仕様 §5 / フランク・リード源仕様 §5.0 の
 * `_shared/lattice2d.ts` の前例に倣う)。
 *
 * 記事ごとの定数は各テーマの lib/ 側で束ねること。このモジュールは
 * 定数を持たない。
 *
 * オロワン式は対数係数を落とした簡略形であり、β は粒子形状(板 / 球)と
 * その対数係数をまとめた実効的な幾何係数である(各記事の図注で明示)。
 */

/** 粒子間隔 L = β r / √f [nm](r は平均半径 [nm]、f は体積分率) */
export function spacingNm(rNm: number, f: number, beta: number): number {
  return (beta * rNm) / Math.sqrt(f);
}

/**
 * オロワン応力 Δτ = μb/L [MPa](簡略形)。
 * muGPa [GPa]、bNm [nm]、rNm [nm] を渡すと MPa で返る。
 */
export function orowanMPa(
  rNm: number,
  f: number,
  beta: number,
  muGPa: number,
  bNm: number,
): number {
  return (muGPa * 1e3 * bNm) / spacingNm(rNm, f, beta);
}
