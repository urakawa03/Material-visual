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

  // 記事「フランク・リード源」(仕様書 02)
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

  // 記事「オストワルド成長」(仕様書 03)
  "ostwald-ripening/coarsening-timelapse": () =>
    import("./ostwald-ripening/coarsening-timelapse"),
  "ostwald-ripening/interface-budget": () =>
    import("./ostwald-ripening/interface-budget"),
  "ostwald-ripening/gibbs-thomson-probe": () =>
    import("./ostwald-ripening/gibbs-thomson-probe"),
  "ostwald-ripening/two-particle-tug": () =>
    import("./ostwald-ripening/two-particle-tug"),
  "ostwald-ripening/ripening-arena": () =>
    import("./ostwald-ripening/ripening-arena"),
  "ostwald-ripening/one-third-law": () =>
    import("./ostwald-ripening/one-third-law"),
  "ostwald-ripening/overaging-strength": () =>
    import("./ostwald-ripening/overaging-strength"),
  "ostwald-ripening/coarsening-design": () =>
    import("./ostwald-ripening/coarsening-design"),
};
