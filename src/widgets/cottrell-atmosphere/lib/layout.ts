/**
 * layout.ts — 「ステージ + 曲線プロット」横並び構成の補助(記事仕様 §5.0)
 *
 * 図1・6・7・8・9 の横並びレイアウトは、キャンバス幅 600px 以下で
 * 縦積みに切り替える。縦積み時はステージのアスペクト比も縦長に変えて
 * 描画領域を確保する(engine の ResizeObserver が追従する)。
 */

import type { FigureHost } from "../../types";
import type { Rect } from "./tensile";

/** 縦積みに切り替えるキャンバス幅のしきい値(CSS px — §5.0) */
export const STACK_BREAKPOINT_PX = 600;

export interface StackableStage {
  /** 現在縦積みかどうか(描画時にパネル分割の判断に使う) */
  isStacked(): boolean;
  /** WidgetHandle.resize と初期化時に呼ぶ(アスペクト比を切り替える) */
  update(): void;
}

/**
 * ステージのアスペクト比を幅に応じて切り替えるヘルパを作る。
 * tallAspect は縦積み時の値(例 "3 / 4")。update() は冪等で、
 * アスペクト変更 → ResizeObserver → resize() の再入でも安定する。
 */
export function makeStackableStage(
  host: FigureHost,
  tallAspect = "3 / 4",
): StackableStage {
  const wideAspect = host.stage.style.aspectRatio;
  let stacked: boolean | null = null;
  const update = (): void => {
    const next = host.size.w <= STACK_BREAKPOINT_PX;
    if (next === stacked) return;
    stacked = next;
    host.stage.style.aspectRatio = next ? tallAspect : wideAspect;
  };
  update();
  return { isStacked: () => stacked === true, update };
}

/** splitPanels の返り値(第 1・第 2 パネルの矩形) */
export interface Panels {
  a: Rect;
  b: Rect;
}

/**
 * キャンバスを左右(縦積み時は上下)2 パネルに分割する。
 * ratio は第 1 パネルの割合。gap は境界の余白(px)。
 */
export function splitPanels(
  w: number,
  h: number,
  stacked: boolean,
  ratio = 0.42,
  gap = 12,
): Panels {
  if (stacked) {
    const ah = Math.round(h * ratio) - gap / 2;
    return {
      a: { x: 0, y: 0, w, h: ah },
      b: { x: 0, y: ah + gap, w, h: h - ah - gap },
    };
  }
  const aw = Math.round(w * ratio) - gap / 2;
  return {
    a: { x: 0, y: 0, w: aw, h },
    b: { x: aw + gap, y: 0, w: w - aw - gap, h },
  };
}
