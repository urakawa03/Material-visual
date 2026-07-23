/**
 * anim.ts — requestRender 型図版のための短い遷移ヘルパ(記事仕様書 02 §5.3, §5.4)
 *
 * τ 変更時の 150ms イージングなど、操作直後だけ走る短い遷移を自前の
 * requestAnimationFrame で駆動する。engine の onFrame を使わないのは、
 * requestRender 型図版のアイドル時消費をゼロに保つため(§8.2)。
 * 遷移はユーザー操作直後にのみ発生し、長くても数秒で終わる。
 *
 * prefers-reduced-motion: reduce のときは即座に最終値へジャンプする(§7.1)。
 */

import { clamp, easeInOutCubic } from "../../../core/mathx";

export interface Tween {
  /** 進行中の遷移を破棄する(destroy 時に必ず呼ぶ) */
  cancel(): void;
  /** 遷移中か */
  readonly active: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * value を from → to へ durationMs かけて補間し、毎フレーム onUpdate を呼ぶ。
 * onUpdate 内で描画(または host.requestRender)すること。
 * 完了時(または省モーション時は即座)に onUpdate(to) → onDone。
 */
export function tween(
  from: number,
  to: number,
  durationMs: number,
  onUpdate: (value: number) => void,
  onDone?: () => void,
): Tween {
  if (prefersReducedMotion() || durationMs <= 0) {
    onUpdate(to);
    onDone?.();
    return { cancel: () => undefined, active: false };
  }
  let rafId: number | null = null;
  let start = -1;
  let done = false;
  const step = (ts: number): void => {
    rafId = null;
    if (start < 0) start = ts;
    const t = clamp((ts - start) / durationMs, 0, 1);
    onUpdate(from + (to - from) * easeInOutCubic(t));
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      done = true;
      onDone?.();
    }
  };
  rafId = requestAnimationFrame(step);
  return {
    cancel(): void {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      done = true;
    },
    get active(): boolean {
      return !done && rafId !== null;
    },
  };
}
