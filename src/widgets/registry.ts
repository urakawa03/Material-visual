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
  // 記事「逆格子空間」(仕様書 05 §4)。図6・図7 のみ three.js を含む
  "reciprocal-lattice/intro-duality": () =>
    import("./reciprocal-lattice/intro-duality"),
  "reciprocal-lattice/wave-1d": () => import("./reciprocal-lattice/wave-1d"),
  "reciprocal-lattice/stripes-2d": () =>
    import("./reciprocal-lattice/stripes-2d"),
  "reciprocal-lattice/planes-2d": () =>
    import("./reciprocal-lattice/planes-2d"),
  "reciprocal-lattice/basis-2d": () => import("./reciprocal-lattice/basis-2d"),
  "reciprocal-lattice/hkl-3d": () => import("./reciprocal-lattice/hkl-3d"),
  "reciprocal-lattice/bravais-3d": () =>
    import("./reciprocal-lattice/bravais-3d"),
};
