/**
 * atomic-form-factor.ts — 図5「原子ごとの散乱能」(仕様書 08 §5.5)
 *
 * 左(主領域): 横軸 s = sinθ/λ = 0〜6 nm⁻¹、縦軸 f(電子の数)。選んだ元素
 * (最大 4)の f(s) を重ねる。色は --mat-matrix の濃淡と線種で区別し、新しい
 * 色は作らない。s = 0 の端に「Z = …」のラベル。上の副軸に Cu Kα での 2θ。
 * 右(狭幅では下): 「中性子では」— 同じ元素の中性子散乱長 b の棒(H は負の
 * 側へ伸ばし「負」と注記)と、薄い X 線の f(0) = Z の棒を並べ、順番が
 * ばらばらであることを見せる。
 *
 * モデル: Cromer–Mann の近似式(lib/formfactors.ts)。熱振動による減衰
 * (デバイ・ワラー因子)は入れていない(図注に明示)。
 *
 * 実装方式: requestRender 型。乱数不使用。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken } from "../../core/colors";
import { fmtSig, font, linTicks } from "../../core/plot";
import {
  createReadout,
  drawPanelDivider,
  drawPanelLabel,
  type PanelRect,
  type PanelSplit,
} from "../reciprocal-lattice/_shared2d";
import {
  DEUTERIUM_B_FM,
  ELEMENTS,
  ELEMENT_IDS,
  halfFormFactorS,
  neutronLength,
  xrayFormFactor,
  type ElementId,
} from "./lib/formfactors";
import { createChipGroup } from "./lib/choice";
import { drawRotatedLabel, haloText, resolvePalette } from "./lib/draw";

const SELECTED_INIT: readonly ElementId[] = ["H", "Si", "Cu", "Au"];
const MAX_SELECTED = 4;
const NEUTRON_INIT = true;

/** 横軸 s の範囲 [nm⁻¹] と曲線の標本数 */
const S_MAX = 6;
const SAMPLES = 121;
/** 副軸の 2θ に使う波長(Cu Kα) */
const LAMBDA = 0.15406;
/** 副軸の 2θ の目盛り(度) */
const TWO_THETA_TICKS = [20, 40, 60, 80, 100, 120];

/** 曲線の線種(濃淡と組み合わせて 4 本を区別する) */
const DASHES: readonly number[][] = [[], [7, 4], [2, 3], [9, 3, 2, 3]];
/** 曲線の濃さ(--mat-matrix をこの割合だけ暗くする) */
const SHADES = [0.25, 0.42, 0.58, 0.72];
/** 中性子の棒の目盛り [fm] */
const B_MIN = -5;
const B_MAX = 10;
/** X 線の棒の目盛り(電子の数) */
const Z_MAX = 80;

/** 縦軸の上端の候補(電子の数) */
const Y_MAX_CANDIDATES = [1.2, 2, 5, 10, 20, 30, 40, 60, 80, 90, 100];

const GAP = 14;
const MAIN_FRACTION = 0.66;
const TOP_FRACTION = 0.58;

export default function atomicFormFactor(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const shades = SHADES.map((a) => darken(pal.matrix, a));

  /* ---- 前計算: 元素ごとの f(s) の標本 ---- */

  const curves = new Map<ElementId, Float64Array>();
  for (const el of ELEMENT_IDS) {
    const ys = new Float64Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      ys[i] = xrayFormFactor(el, (S_MAX * i) / (SAMPLES - 1));
    }
    curves.set(el, ys);
  }

  /* ---- 状態 ---- */

  let selected: ElementId[] = [...SELECTED_INIT];
  let showNeutron = NEUTRON_INIT;
  /** 原子番号の順に並べた選択(描画・読み取り値の順) */
  let ordered: ElementId[] = [];

  /* ---- 読み取り値(仕様書 08 §5.5) ---- */

  const readout = createReadout(host);
  const items = Array.from({ length: MAX_SELECTED }, () => {
    const it = readout.item("");
    it.el.style.whiteSpace = "normal";
    return it;
  });

  function update(): void {
    ordered = [...selected].sort((a, b) => ELEMENTS[a].Z - ELEMENTS[b].Z);
    items.forEach((it, i) => {
      const el = ordered[i];
      if (!el) {
        it.el.style.display = "none";
        return;
      }
      it.el.style.display = "";
      const label = it.el.firstElementChild;
      if (label) label.textContent = `${ELEMENTS[el].name}(${el})`;
      const half = halfFormFactorS(el);
      const halfText =
        half === null
          ? "—"
          : `${half.toFixed(1)} nm⁻¹${half > S_MAX ? "(図の右の外)" : ""}`;
      it.set(
        `f(0) = ${xrayFormFactor(el, 0).toFixed(1)}、f が半分になる s = ${halfText}、` +
          `中性子 b = ${neutronLength(el).toFixed(2)} fm`,
      );
    });
  }

  /* ---- レイアウト ---- */

  const split: PanelSplit = {
    first: rect(0, 0, 1, 1),
    second: rect(0, 0, 1, 1),
    stacked: false,
  };

  function rect(x: number, y: number, w: number, h: number): PanelRect {
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  function relayout(): void {
    const { w, h } = host.size;
    split.stacked = w < h * 1.25;
    if (!showNeutron) {
      split.first = rect(0, 0, w, h);
      split.second = rect(w, 0, 0, h);
      return;
    }
    if (!split.stacked) {
      const mw = (w - GAP) * MAIN_FRACTION;
      split.first = rect(0, 0, mw, h);
      split.second = rect(mw + GAP, 0, w - mw - GAP, h);
    } else {
      const th = (h - GAP) * TOP_FRACTION;
      split.first = rect(0, 0, w, th);
      split.second = rect(0, th + GAP, w, h - th - GAP);
    }
  }

  /* ---- 描画 ---- */

  function styleIndex(el: ElementId): number {
    return Math.max(0, ordered.indexOf(el));
  }

  function drawCurves(panel: PanelRect): void {
    const ml = 44;
    const mr = 46;
    const mt = 50;
    const mb = 40;
    const x0 = panel.x + ml;
    const x1 = panel.x + panel.w - mr;
    const y0 = panel.y + mt;
    const y1 = panel.y + panel.h - mb;
    const maxZ = ordered.length
      ? Math.max(...ordered.map((el) => ELEMENTS[el].Z))
      : 10;
    const yMax =
      Y_MAX_CANDIDATES.find((c) => c >= maxZ * 1.05) ??
      Y_MAX_CANDIDATES[Y_MAX_CANDIDATES.length - 1];
    const X = (s: number): number => x0 + (s / S_MAX) * (x1 - x0);
    const Y = (f: number): number => y1 - (f / yMax) * (y1 - y0);

    // 軸と目盛り
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 - 0.5, y0);
    ctx.lineTo(x0 - 0.5, y1 + 0.5);
    ctx.lineTo(x1, y1 + 0.5);
    ctx.stroke();
    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of linTicks(0, S_MAX, 6)) {
      ctx.fillText(String(t), X(t), y1 + 5);
    }
    ctx.textAlign = "right";
    ctx.fillText("s = sinθ/λ [nm⁻¹]", x1 + mr - 4, y1 + 20);
    ctx.textBaseline = "middle";
    for (const t of linTicks(0, yMax, 4)) {
      ctx.fillText(fmtSig(t), x0 - 6, Y(t));
      ctx.strokeStyle = pal.hairline;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(t)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(t)) + 0.5);
      ctx.stroke();
    }
    drawRotatedLabel(
      ctx,
      "f(電子の数)",
      panel.x + 11,
      (y0 + y1) / 2,
      pal.text2,
    );

    // 上の副軸: Cu Kα での 2θ(s = sinθ/λ)
    ctx.strokeStyle = pal.text2;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 0.5);
    ctx.lineTo(x1, y0 - 0.5);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const tt of TWO_THETA_TICKS) {
      const s = Math.sin((tt * Math.PI) / 360) / LAMBDA;
      if (s > S_MAX) continue;
      const x = Math.round(X(s)) + 0.5;
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 - 4);
      ctx.fillText(`${tt}°`, x, y0 - 5);
    }
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText("2θ(Cu Kα)", x1 + mr - 4, y0 - 18);

    // 曲線
    ctx.lineWidth = 2;
    for (const el of ordered) {
      const i = styleIndex(el);
      const ys = curves.get(el);
      if (!ys) continue;
      ctx.strokeStyle = shades[i];
      ctx.setLineDash(DASHES[i]);
      ctx.beginPath();
      for (let j = 0; j < SAMPLES; j++) {
        const x = X((S_MAX * j) / (SAMPLES - 1));
        const y = Y(ys[j]);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash(NO_DASH);

    // ラベル: 左端「元素 Z = …」と右端「元素」(重なりは上下にずらす)
    placeLabels(
      ordered.map((el) => Y(curves.get(el)?.[0] ?? 0)),
      y0,
      y1,
    ).forEach((y, i) => {
      const el = ordered[i];
      ctx.font = font(12, 600);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      haloText(
        ctx,
        `${el}: Z = ${ELEMENTS[el].Z}`,
        x0 + 6,
        y - 9,
        shades[styleIndex(el)],
        pal.bg,
      );
    });
    placeLabels(
      ordered.map((el) => Y(curves.get(el)?.[SAMPLES - 1] ?? 0)),
      y0,
      y1,
    ).forEach((y, i) => {
      const el = ordered[i];
      ctx.font = font(12, 600);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      haloText(ctx, el, x1 + 5, y, shades[styleIndex(el)], pal.bg);
    });
  }

  /** ラベルの縦位置を、間隔 14px 以上になるよう上下にずらす */
  function placeLabels(ys: number[], top: number, bottom: number): number[] {
    const minGap = 15;
    const idx = ys.map((y, i) => ({ y, i })).sort((a, b) => b.y - a.y);
    const out = new Array<number>(ys.length);
    let last = bottom + minGap;
    for (const e of idx) {
      const y = Math.min(e.y, last - minGap);
      out[e.i] = y;
      last = y;
    }
    // 上にはみ出したら全体を下げる
    const minY = Math.min(...out);
    if (minY < top + 6) {
      const d = top + 6 - minY;
      for (let i = 0; i < out.length; i++) out[i] += d;
    }
    return out;
  }

  function drawBars(panel: PanelRect): void {
    if (panel.w < 10) return;
    const top = panel.y + 58;
    const colGap = 28;
    const xLabel = panel.x + 12;
    const xZ = panel.x + 46; // X 線の列の左端
    const colW = (panel.x + panel.w - 12 - xZ - colGap) / 2;
    const xB = xZ + colW + colGap; // 中性子の列の左端
    const wB = colW - 30; // 値の文字を棒の右に置く余白
    const zeroB = xB + ((0 - B_MIN) / (B_MAX - B_MIN)) * wB;
    const n = Math.max(1, ordered.length);
    const rowH = Math.min(46, (panel.y + panel.h - top - 44) / n);

    // 列の見出し
    ctx.font = font(12, 600);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("X 線 f(0) = Z", xZ, top - 8);
    ctx.fillText("中性子 b [fm]", xB, top - 8);

    // 中性子の 0 の線と目盛り
    const yEnd = top + rowH * n;
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(zeroB) + 0.5, top);
    ctx.lineTo(Math.round(zeroB) + 0.5, yEnd + 4);
    ctx.moveTo(xZ - 0.5, top);
    ctx.lineTo(xZ - 0.5, yEnd + 4);
    ctx.stroke();
    ctx.font = font(10);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of [B_MIN, 0, 5, B_MAX]) {
      ctx.fillText(
        String(t),
        xB + ((t - B_MIN) / (B_MAX - B_MIN)) * wB,
        yEnd + 6,
      );
    }
    for (const t of [0, 40, Z_MAX]) {
      ctx.fillText(String(t), xZ + (t / Z_MAX) * (colW - 24), yEnd + 6);
    }

    ordered.forEach((el, i) => {
      const y = top + i * rowH + rowH / 2;
      const color = shades[styleIndex(el)];
      const bh = Math.min(16, rowH * 0.5);
      ctx.font = font(13, 600);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(el, xLabel, y);
      // X 線(薄い棒)
      const z = ELEMENTS[el].Z;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(xZ, y - bh / 2, Math.max(1, (z / Z_MAX) * (colW - 24)), bh);
      ctx.globalAlpha = 1;
      ctx.font = font(11);
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "left";
      haloText(
        ctx,
        String(z),
        xZ + Math.max(1, (z / Z_MAX) * (colW - 24)) + 3,
        y,
        pal.text2,
        pal.bg,
      );
      // 中性子(濃い棒。負なら 0 の左へ)
      const b = neutronLength(el);
      const xb = xB + ((b - B_MIN) / (B_MAX - B_MIN)) * wB;
      ctx.fillStyle = color;
      ctx.fillRect(Math.min(zeroB, xb), y - bh / 2, Math.abs(xb - zeroB), bh);
      ctx.font = font(11);
      if (b < 0) {
        ctx.textAlign = "left";
        haloText(ctx, `${b.toFixed(2)}(負)`, zeroB + 4, y, pal.text, pal.bg);
      } else {
        ctx.textAlign = "left";
        haloText(ctx, b.toFixed(2), xb + 3, y, pal.text2, pal.bg);
      }
    });

    if (ordered.includes("H")) {
      ctx.font = font(11);
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(
        `中性子では、重水素 D の b は +${DEUTERIUM_B_FM.toFixed(2)} fm`,
        xLabel,
        yEnd + 24,
      );
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawCurves(split.first);
    drawPanelLabel(ctx, split.first, "X 線の原子散乱因子 f(s)");
    if (showNeutron) {
      drawPanelDivider(ctx, host.size, split);
      drawBars(split.second);
      drawPanelLabel(ctx, split.second, "中性子では");
    }
  }

  /* ---- 操作部品(仕様書 08 §5.5) ---- */

  const chips = createChipGroup<ElementId>(host, {
    label: "表示する元素(最大 4)",
    options: ELEMENT_IDS.map((el) => ({ value: el, label: el })),
    values: SELECTED_INIT,
    max: MAX_SELECTED,
  });
  chips.onChange((v) => {
    selected = [...v];
    update();
  });

  const neutronToggle = host.controls.toggle({
    id: "neutron",
    label: "中性子を表示",
    value: NEUTRON_INIT,
  });
  neutronToggle.onChange((v) => {
    showNeutron = v;
    relayout();
  });

  host.controls.reset(() => {
    chips.set(SELECTED_INIT);
    neutronToggle.set(NEUTRON_INIT);
  });

  /* ---- 登録・初期状態(requestRender 型) ---- */

  host.onRender(draw);
  relayout();
  update();

  return {
    resize(): void {
      relayout();
    },
    destroy(): void {
      readout.el.remove();
      chips.el.remove();
    },
  };
}

const NO_DASH: number[] = [];
