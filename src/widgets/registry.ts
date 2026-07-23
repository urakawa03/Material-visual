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
  "cottrell-atmosphere/yield-tooth": () =>
    import("./cottrell-atmosphere/yield-tooth"),
  "cottrell-atmosphere/edge-dislocation-field": () =>
    import("./cottrell-atmosphere/edge-dislocation-field"),
  "cottrell-atmosphere/solute-energy-probe": () =>
    import("./cottrell-atmosphere/solute-energy-probe"),
  "cottrell-atmosphere/atmosphere-equilibrium": () =>
    import("./cottrell-atmosphere/atmosphere-equilibrium"),
  "cottrell-atmosphere/atmosphere-kinetics": () =>
    import("./cottrell-atmosphere/atmosphere-kinetics"),
  "cottrell-atmosphere/pinning-breakaway": () =>
    import("./cottrell-atmosphere/pinning-breakaway"),
  "cottrell-atmosphere/luders-band": () =>
    import("./cottrell-atmosphere/luders-band"),
  "cottrell-atmosphere/strain-aging-cycle": () =>
    import("./cottrell-atmosphere/strain-aging-cycle"),
  "cottrell-atmosphere/dsa-serrations": () =>
    import("./cottrell-atmosphere/dsa-serrations"),
};
