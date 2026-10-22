/**
 * plot.ts — 図中の文字・軸の目盛り・数値の書式(docs/specs/90_remaining_work.md §3.2)
 *
 * カーケンドール効果・GP ゾーン・オストワルド成長の各記事の lib/draw.ts に
 * 同じ内容でコピーされていたものを 1 箇所にまとめた。3 記事の lib/draw.ts は
 * ここから再エクスポートしている。
 */

/** 図中ラベルのフォントスタック(tokens.css の --font-sans と同値) */
export const FONT_SANS =
  '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic Medium", Meiryo, sans-serif';

/** `12px …` 形式のフォント指定を返す */
export function font(sizePx: number, weight = 400): string {
  return `${weight === 400 ? "" : `${weight} `}${sizePx}px ${FONT_SANS}`;
}

/** 線形軸の「きれいな」目盛り列(1/2/5 刻み) */
export function linTicks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (
    let v = Math.ceil(min / step) * step;
    v <= max + step * 1e-9;
    v += step
  ) {
    out.push(v);
  }
  return out;
}

/** 対数軸の 10 の冪の目盛り列(min ≤ 0 は空配列 — log10(0) の発散防止) */
export function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  if (min <= 0 || max <= 0 || max < min) return out;
  for (
    let e = Math.ceil(Math.log10(min) - 1e-9);
    e <= Math.floor(Math.log10(max) + 1e-9);
    e++
  ) {
    out.push(10 ** e);
  }
  return out;
}

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** 指数 e を「10³」「10⁻⁵」の形にする */
export function pow10Label(exponent: number): string {
  const digits = String(Math.abs(exponent))
    .split("")
    .map((d) => SUPERSCRIPT_DIGITS[Number(d)])
    .join("");
  return `10${exponent < 0 ? "⁻" : ""}${digits}`;
}

/** 10 の冪を「10³」形式で表示する(対数軸ラベル用) */
export function fmtPow10(v: number): string {
  return pow10Label(Math.round(Math.log10(v)));
}

/** 有効数字 digits 桁程度の読みやすい数値表示(10^(digits−1) 以上は整数に丸める) */
export function fmtSig(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (Math.abs(v) >= 10 ** (digits - 1)) return String(Math.round(v));
  return String(Number(v.toPrecision(digits)));
}

/**
 * 「1.2 × 10⁴」形式の表示(仮数の有効数字 digits 桁)。
 * 仮数が丸めて 1 になるときは「10⁴」とだけ書く。負号は「−」。
 */
export function fmtSci(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  let exponent = Math.floor(Math.log10(abs));
  let mantissa = abs / 10 ** exponent;
  if (mantissa < 1) {
    mantissa *= 10;
    exponent -= 1;
  }
  mantissa = Number(mantissa.toPrecision(digits));
  if (mantissa >= 10) {
    mantissa = Number((mantissa / 10).toPrecision(digits));
    exponent += 1;
  }
  const head = mantissa === 1 ? "" : `${mantissa} × `;
  return `${sign}${head}${pow10Label(exponent)}`;
}
