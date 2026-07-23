/**
 * colors.ts — 意味パレットの TS 側定義(仕様書 §6.2)
 *
 * Canvas / WebGL は CSS 変数を直接参照できないため、TS 側にも同値を持つ。
 * 値は src/styles/tokens.css と必ず一致させること(片方を変えたら両方変える)。
 * 実行時は matColor() / uiColor() が CSS 変数を優先して解決するので、
 * 将来ダークモード等でトークン値を上書きしても図版の色は追従する(§13)。
 */

/** 意味パレット(図版用・全記事共通)。tokens.css の --mat-* と同値 */
export const MAT_COLORS = {
  /** 母相の原子・格子 */
  matrix: "#9aa7b8",
  /** 溶質・不純物原子(Fe 中の C、Al 中の Cu など) */
  solute: "#e07a2f",
  /** 拡散対のもう一方の元素(カーケンドールの B 原子など) */
  second: "#4f83cc",
  /** 転位線・欠陥 */
  defect: "#d1483f",
  /** 析出物・クラスター・GP ゾーン */
  precip: "#7d5bc7",
  /** 入射・回折ビーム(X 線・電子線) */
  beam: "#d99000",
  /** 逆格子点 */
  recip: "#2f3a4a",
  /** エヴァルト球面(塗り) */
  sphereFill: "rgba(15, 138, 138, 0.14)",
  /** エヴァルト球面(線) */
  sphereLine: "#0f8a8a",
  /** 引張応力場の塗り */
  tension: "rgba(209, 72, 63, 0.12)",
  /** 圧縮応力場の塗り */
  compression: "rgba(79, 131, 204, 0.12)",
} as const;

/** UI カラートークン。tokens.css の --color-* と同値(§6.1) */
export const UI_COLORS = {
  bg: "#ffffff",
  text: "#1c1e21",
  text2: "#55606e",
  hairline: "#e6e8eb",
  accent: "#2e6f95",
  accentStrong: "#1f5573",
} as const;

export type MatColorName = keyof typeof MAT_COLORS;
export type UiColorName = keyof typeof UI_COLORS;

const MAT_CSS_VARS: Record<MatColorName, string> = {
  matrix: "--mat-matrix",
  solute: "--mat-solute",
  second: "--mat-second",
  defect: "--mat-defect",
  precip: "--mat-precip",
  beam: "--mat-beam",
  recip: "--mat-recip",
  sphereFill: "--mat-sphere-fill",
  sphereLine: "--mat-sphere-line",
  tension: "--mat-tension",
  compression: "--mat-compression",
};

const UI_CSS_VARS: Record<UiColorName, string> = {
  bg: "--color-bg",
  text: "--color-text",
  text2: "--color-text-2",
  hairline: "--color-hairline",
  accent: "--color-accent",
  accentStrong: "--color-accent-strong",
};

function readCssVar(name: string): string {
  if (typeof window === "undefined" || typeof document === "undefined")
    return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * 意味パレットの色を返す。CSS 変数(tokens.css)が解決できればその値、
 * できなければ TS 側の定数を返す。Canvas 描画の初期化時に一度だけ呼ぶこと
 * (毎フレーム getComputedStyle を呼ばない)。
 */
export function matColor(name: MatColorName): string {
  return readCssVar(MAT_CSS_VARS[name]) || MAT_COLORS[name];
}

/** UI カラートークンの色を返す(解決規則は matColor と同じ) */
export function uiColor(name: UiColorName): string {
  return readCssVar(UI_CSS_VARS[name]) || UI_COLORS[name];
}

/**
 * `#rrggbb` 形式の色を amount(0〜1)だけ暗くする。
 * 原子の縁取り(同系色を約 20% 暗くした 1.5px — §6.5)用。
 * hex 以外の形式はそのまま返す。
 */
export function darken(hex: string, amount = 0.2): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const f = 1 - amount;
  const r = Math.round(((v >> 16) & 0xff) * f);
  const g = Math.round(((v >> 8) & 0xff) * f);
  const b = Math.round((v & 0xff) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
