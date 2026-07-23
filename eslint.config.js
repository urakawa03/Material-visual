import tseslint from "typescript-eslint";
import eslintPluginAstro from "eslint-plugin-astro";

export default tseslint.config(
  { ignores: ["dist/**", ".astro/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs["flat/recommended"],
  {
    rules: {
      // 仕様書 §4: any 禁止
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
