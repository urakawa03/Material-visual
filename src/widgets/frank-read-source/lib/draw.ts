/**
 * draw.ts — フランク・リード源テーマの描画共通ヘルパ(記事仕様書 02 §5.0)
 *
 * - 転位線・⊥記号は --mat-defect、固定点は --mat-precip の小さな点
 * - すべり面(上面図)は白地 + 薄い --color-hairline のグリッド
 * - 線の向き表示は線上の小さな矢羽根
 * - 各図の隅に視点アイコン(側面 / 上面)
 */

import { darken, matColor, uiColor } from "../../../core/colors";

/** 図版内テキストの標準フォント */
export const FIG_FONT = "13px system-ui, sans-serif";
export const FIG_FONT_SMALL = "11px system-ui, sans-serif";

/** 描画色をまとめて解決する(初期化時に一度だけ呼ぶ — §6.2) */
export interface FigPalette {
  defect: string;
  defectDark: string;
  precip: string;
  matrix: string;
  matrixDark: string;
  solute: string;
  hairline: string;
  text: string;
  text2: string;
  accent: string;
  bg: string;
  /** 引張応力場の塗り(「引き返せない」領域などの強調にも使う) */
  tensionFill: string;
}

export function resolvePalette(): FigPalette {
  const defect = matColor("defect");
  const matrix = matColor("matrix");
  return {
    defect,
    defectDark: darken(defect, 0.2),
    precip: matColor("precip"),
    matrix,
    matrixDark: darken(matrix, 0.2),
    solute: matColor("solute"),
    hairline: uiColor("hairline"),
    text: uiColor("text"),
    text2: uiColor("text2"),
    accent: uiColor("accent"),
    bg: uiColor("bg"),
    tensionFill: matColor("tension"),
  };
}

/** すべり面のグリッド(上面図の背景)を描く */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spacing: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = spacing / 2; x < w; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = spacing / 2; y < h; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

/** 視点アイコン(側面 / 上面)を図の隅に置く(§5.0 座標系) */
export function drawViewBadge(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: "side" | "top",
  pal: FigPalette,
): void {
  const label = view === "side" ? "側面から見た図" : "すべり面を真上から見た図";
  ctx.font = FIG_FONT_SMALL;
  const tw = ctx.measureText(label).width;
  const pad = 6;
  const bx = w - tw - pad * 2 - 8;
  const by = 8;
  const bh = 20;
  ctx.fillStyle = pal.bg;
  ctx.strokeStyle = pal.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw + pad * 2, bh, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = pal.text2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, bx + pad, by + bh / 2 + 0.5);
}

/** 矢印(線幅 2px、先端は塗り三角 — §6.5) */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 2,
  headLen = 7,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x1 - ux * headLen;
  const by = y1 - uy * headLen;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(bx, by);
  ctx.stroke();
  const hw = headLen * 0.55;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx - uy * hw, by + ux * hw);
  ctx.lineTo(bx + uy * hw, by - ux * hw);
  ctx.closePath();
  ctx.fill();
}

/**
 * 折れ線上に等間隔で小さな矢羽根(向き表示)を描く。
 * points は画面座標の平坦配列 [x0, y0, x1, y1, ...]。
 */
export function drawSenseChevrons(
  ctx: CanvasRenderingContext2D,
  pts: ArrayLike<number>,
  count: number,
  closed: boolean,
  color: string,
): void {
  const n = Math.floor(pts.length / 2);
  if (n < 2 || count < 1) return;
  // 総長を測る
  const segCount = closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n;
    total += Math.hypot(
      pts[2 * j] - pts[2 * i],
      pts[2 * j + 1] - pts[2 * i + 1],
    );
  }
  if (total < 1e-6) return;
  const size = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let k = 0; k < count; k++) {
    const target = ((k + 0.5) / count) * total;
    // 弧長 target の位置と向きを求める
    let acc = 0;
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % n;
      const dx = pts[2 * j] - pts[2 * i];
      const dy = pts[2 * j + 1] - pts[2 * i + 1];
      const len = Math.hypot(dx, dy);
      if (acc + len >= target && len > 1e-6) {
        const t = (target - acc) / len;
        const px = pts[2 * i] + dx * t;
        const py = pts[2 * i + 1] + dy * t;
        const ux = dx / len;
        const uy = dy / len;
        ctx.beginPath();
        ctx.moveTo(
          px - ux * size - uy * size * 0.8,
          py - uy * size + ux * size * 0.8,
        );
        ctx.lineTo(px, py);
        ctx.lineTo(
          px - ux * size + uy * size * 0.8,
          py - uy * size - ux * size * 0.8,
        );
        ctx.stroke();
        break;
      }
      acc += len;
    }
  }
  ctx.lineCap = "butt";
}

/**
 * 世界座標(+y 上向き)の節点列を画面座標へ変換して out に書き込む。
 * out は長さ 2n 以上の平坦配列 [x0, y0, ...]。
 */
export function projectCurve(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  n: number,
  originX: number,
  originY: number,
  scale: number,
  out: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    out[2 * i] = originX + xs[i] * scale;
    out[2 * i + 1] = originY - ys[i] * scale;
  }
}

/** 平坦配列 [x0, y0, ...] の折れ線を stroke する */
export function strokePts(
  ctx: CanvasRenderingContext2D,
  pts: ArrayLike<number>,
  n: number,
  closed: boolean,
): void {
  if (n < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
  if (closed) ctx.closePath();
  ctx.stroke();
}

/** 固定点(析出物・林転位の交点)を --mat-precip の点で描く(§5.0) */
export function drawPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pal: FigPalette,
  r = 5,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = pal.precip;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = darken(pal.precip, 0.2);
  ctx.stroke();
}

/** ⊥ 記号(刃状転位)を描く。angle は記号の回転(既定は半原子面が上) */
export function drawTeeSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  lineWidth = 2.5,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y);
  ctx.moveTo(x - size * 0.7, y);
  ctx.lineTo(x + size * 0.7, y);
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** 読み出しテキスト(左上などに置く数値表示) */
export function drawReadout(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  x: number,
  y: number,
  pal: FigPalette,
): void {
  ctx.font = FIG_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = pal.text2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * 19);
  }
}

/** 中央寄せのメッセージボックス(完了メッセージなど) */
export function drawMessage(
  ctx: CanvasRenderingContext2D,
  w: number,
  y: number,
  text: string,
  pal: FigPalette,
): void {
  ctx.font = FIG_FONT;
  const tw = ctx.measureText(text).width;
  const pad = 10;
  const bx = (w - tw) / 2 - pad;
  const bh = 26;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = pal.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, y, tw + pad * 2, bh, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = pal.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, y + bh / 2 + 0.5);
}

/**
 * 操作部品の有効/無効を切り替える(モード切替や測定中ロック用)。
 * controls.ts が生成した行要素(ctl.el)を渡す。
 */
export function setControlEnabled(rowEl: HTMLElement, enabled: boolean): void {
  const inputs = rowEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    "input, button",
  );
  inputs.forEach((el) => {
    el.disabled = !enabled;
  });
  rowEl.classList.toggle("is-disabled", !enabled);
}

/**
 * スライダーのトラック上に目盛マーク(τ_c の位置表示など)を重ねる。
 * fraction はトラック上の位置(0〜1)。位置はトラックのつまみ可動域
 * (つまみ半径 10px を除いた範囲)に合わせ、リサイズにも追従する。
 * 返り値の関数で破棄できる。
 */
export function addSliderTick(
  sliderRowEl: HTMLElement,
  fraction: number,
  label: string,
): () => void {
  const input = sliderRowEl.querySelector<HTMLInputElement>(
    'input[type="range"]',
  );
  if (!input) return () => undefined;
  const tick = document.createElement("span");
  tick.className = "ctl-slider-tick";
  tick.setAttribute("aria-hidden", "true");
  tick.textContent = label;
  sliderRowEl.style.position = "relative";
  sliderRowEl.appendChild(tick);

  const THUMB_RADIUS = 10;
  const place = (): void => {
    const left =
      input.offsetLeft +
      THUMB_RADIUS +
      fraction * Math.max(input.offsetWidth - THUMB_RADIUS * 2, 0);
    tick.style.left = `${left}px`;
    tick.style.top = `${input.offsetTop + input.offsetHeight / 2}px`;
  };
  place();
  const ro = new ResizeObserver(place);
  ro.observe(input);
  return () => {
    ro.disconnect();
    tick.remove();
  };
}
