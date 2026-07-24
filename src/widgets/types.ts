/**
 * types.ts — ウィジェット契約(仕様書 §8.2)
 *
 * 1 図版 = 1 モジュール。src/widgets/<slug>/<name>.ts が WidgetFactory を
 * default export し、registry.ts に登録する。
 */

import type { Controls } from "../core/controls";

/** キャンバスの CSS ピクセル寸法と devicePixelRatio(上限 2) */
export interface FigureSize {
  w: number;
  h: number;
  dpr: number;
}

export interface FigureHost {
  /** 図版のステージ要素(.ix-stage)。オーバーレイ UI の追加先 */
  stage: HTMLElement;
  /** 描画先キャンバス。バッキングストア寸法は engine が管理する */
  canvas: HTMLCanvasElement;
  /** 操作部品のファクトリ(§7.2) */
  controls: Controls;
  /**
   * 現在の寸法。engine が「同一オブジェクトを」更新し続けるので、
   * 保持せず毎回このプロパティを読むこと。
   */
  size: FigureSize;
  /**
   * 連続アニメ用のフレームコールバックを登録する。
   * dt: 前フレームからの経過秒(50ms でクランプ済み)、t: 累積再生秒。
   * 再生中のみ呼ばれる(画面外・タブ非表示・一時停止中は呼ばれない)。
   */
  onFrame(cb: (dt: number, t: number) => void): void;
  /**
   * 操作時のみ再描画する図版用: requestRender 時に呼ばれる描画関数を
   * 登録する(連続アニメが不要な図版は onFrame を使わずこちらを使い、
   * アイドル時の消費をゼロにする — §8.2)。
   */
  onRender(cb: () => void): void;
  /**
   * 1 フレームだけ再描画を要求する(次の rAF で合流・重複要求は合体)。
   * onRender 登録があればそれを、なければ onFrame コールバックを
   * dt = 0 で呼ぶ。
   */
  requestRender(): void;
  /**
   * 再生状態をユーザー操作として設定する。初期状態を「一時停止」に
   * したい図版が初期化時に setPlaying(false) を呼ぶ(playPause ボタンの
   * 表示も連動する)。
   */
  setPlaying(playing: boolean): void;
}

export interface WidgetHandle {
  /** キャンバス寸法変更時に呼ばれる(直後に engine が 1 フレーム描画する) */
  resize?(): void;
  /** 再生状態の変化通知(rAF の開始/停止自体は engine が行う) */
  setPlaying?(playing: boolean): void;
  /** 図版の破棄。イベントリスナー等を解放する */
  destroy(): void;
}

export type WidgetFactory = (
  host: FigureHost,
) => WidgetHandle | Promise<WidgetHandle>;
