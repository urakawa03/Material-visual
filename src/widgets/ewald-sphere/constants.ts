/**
 * constants.ts — 記事「エヴァルト球」の 3D 図版で共有する定数と小さな整形関数
 * (仕様書 04 §5.0)
 *
 * 図3〜図6 は同じ逆格子・同じ座標系・同じ見た目の約束の上に立つので、
 * マジックナンバーはここに名前を付けて置く(母体仕様 §4 のコーディング規約)。
 */

/** 格子定数(nm)。前提記事「逆格子空間」と同値(§5.0) */
export const A_NM = 0.4;
/** 逆格子点の指数の範囲(|h|,|k|,|l| ≤ MAX_INDEX) */
export const MAX_INDEX = 3;

/** 波長 λ の範囲・刻み(nm。図3・図4 で共通 — §5.3) */
export const LAMBDA_MIN = 0.1;
export const LAMBDA_MAX = 0.3;
export const LAMBDA_STEP = 0.002;

/** 結晶方位 φ の範囲・刻み(°)。χ は ±90° で同じ刻みを使う */
export const PHI_MIN = -180;
export const PHI_MAX = 180;
export const PHI_STEP = 0.25;

/** 逆格子点の半径(nm⁻¹ 単位の見た目)と原点 000 の拡大率(前提記事に合わせる) */
export const RECIP_RADIUS = 0.2;
export const ORIGIN_SCALE = 1.6;
/** 点灯した反射のマーカーの拡大率(発光ではなく大きさで区別する — §5.0) */
export const HIGHLIGHT_SCALE = 1.8;

/** 逆空間の軸の片側長さとラベルの高さ(nm⁻¹) */
export const AXIS_HALF = 8.6;
export const AXIS_LABEL_HEIGHT = 0.7;
/** 点灯した反射の (h k l) ラベルの高さ(nm⁻¹) */
export const LABEL_HEIGHT = 1;

/** 矢の軸半径(nm⁻¹) */
export const ARROW_SHAFT_RADIUS = 0.12;
/** 描く回折波の矢の最大本数と、(h k l) ラベルの最大個数(見やすさの上限) */
export const DIFFRACTED_ARROW_MAX = 6;
export const LABEL_MAX = 3;
/** 入射ビームを球の中心 C の手前へどれだけ伸ばすか(nm⁻¹) */
export const INCIDENT_DASH_LENGTH = 5;

/** パネルの単位ラベル(§5.0: 単位を常に目に入れる) */
export const TAG_RECIP = "逆空間 [nm⁻¹]";
export const TAG_DETECTOR = "検出器(正面から)";

/** 3D 図版の stage の aria-label(キーボード視点操作の説明 — §5.0) */
export const ARIA_LABEL_3D =
  "3D 視点。ドラッグまたは矢印キーで回転、+ と − でズーム。" +
  "逆格子の点と、原点を通る半透明のエヴァルト球を表示している";

/** (h k l) の表示(前提記事と同じ空白区切りの表記 — §2.3) */
export function formatHkl(h: number, k: number, l: number): string {
  return `(${h} ${k} ${l})`;
}
