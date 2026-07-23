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
