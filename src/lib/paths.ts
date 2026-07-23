/**
 * paths.ts — base path(import.meta.env.BASE_URL)対応の URL ヘルパ
 *
 * GitHub Pages のサブパス配信(例: /Material-visual/)でもリンクが壊れない
 * よう、サイト内 URL は必ずこのヘルパを通す(astro.config.mjs 参照)。
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  const p = path.startsWith("/") ? path.slice(1) : path;
  return base.endsWith("/") ? `${base}${p}` : `${base}/${p}`;
}
