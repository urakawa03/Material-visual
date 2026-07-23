/**
 * registry.ts — 図版 ID → 動的 import の対応表(仕様書 §8.2)
 *
 * 図版 ID は "<slug>/<name>" 形式。engine が IntersectionObserver で
 * 図版へ接近したときに初めて import されるので、ここに登録しただけでは
 * ページの初期バンドルには含まれない。
 */

import type { WidgetFactory } from "./types";

export const registry: Record<
  string,
  () => Promise<{ default: WidgetFactory }>
> = {
  "_sample/brownian": () => import("./_sample/brownian"),
  "frank-read-source/theoretical-strength": () =>
    import("./frank-read-source/theoretical-strength"),
  "frank-read-source/glide-step": () =>
    import("./frank-read-source/glide-step"),
  "frank-read-source/line-tension-bow": () =>
    import("./frank-read-source/line-tension-bow"),
  "frank-read-source/critical-semicircle": () =>
    import("./frank-read-source/critical-semicircle"),
  "frank-read-source/source-operation": () =>
    import("./frank-read-source/source-operation"),
  "frank-read-source/critical-stress-explorer": () =>
    import("./frank-read-source/critical-stress-explorer"),
  "frank-read-source/pileup-backstress": () =>
    import("./frank-read-source/pileup-backstress"),
};
