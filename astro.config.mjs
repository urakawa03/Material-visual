// @ts-check
import { defineConfig } from "astro/config";

// ホスティング先(GitHub Pages / Cloudflare Pages)に応じて base path と
// サイト URL を環境変数で切り替えられるようにしておく(仕様書 §14)。
// 例: BASE_PATH="/Material-visual/" SITE_URL="https://urakawa03.github.io" pnpm build
export default defineConfig({
  output: "static",
  site: process.env.SITE_URL || "https://example.com",
  base: process.env.BASE_PATH || "/",
  trailingSlash: "always",
});
