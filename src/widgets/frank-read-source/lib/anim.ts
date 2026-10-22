/**
 * anim.ts — 短い遷移ヘルパ(記事仕様書 02 §5.3, §5.4)
 *
 * 記事に依存しない部品なので src/core/anim.ts へ移した。既存の import を
 * 変えずに済むよう、ここから再エクスポートする。
 */

export { tween, type Tween } from "../../../core/anim";
