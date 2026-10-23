/**
 * mass-action.ts — 図6「積は変わらない」(仕様書 12 §5.6)
 *
 * 左(幅 35%): 小さなバンド図(帯と E_i・E_F の線)。「光を当てる」が on の
 * ときは E_F の代わりに擬フェルミ準位 E_Fn(電子の破線)と E_Fp(正孔の破線)を
 * 描き、上から光(`--mat-beam`)の短い波線の矢印を 3 本置く。
 * 右(主領域): 縦の対数軸(10⁰〜10²⁰ cm⁻³)に n と p の 2 本の棒、n_i の高さに
 * 水平の破線。両者の対数の中点(√np)に菱形の目印を置き、それが n_i の線上に
 * あること(np = n_i²)を示す。光を当てると線から上に離れる。
 *
 * モデル: 光 off は与えた E_F から electronDensity・holeDensity。範囲 ±0.40 eV は
 * 非縮退域に限ってあり、np = n_i² が 1% 以内で成り立つ(§5.8 T6)。光 on は
 * 平衡の値に一定の過剰キャリア Δn = Δp = 10¹⁴ cm⁻³ を足す(生成と再結合の
 * つり合いを解かない簡略化 — 図注に明示)。擬フェルミ準位は密度の逆関数で
 * 求め、分離 E_Fn − E_Fp は quasiFermiSplit(式 E13)で読む。
 *
 * 実装方式: 2D Canvas / requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fmtSci } from "../../core/plot";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawBandBox,
  drawLevelLine,
  drawPlotFrame,
  pow10Ticks,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import {
  electronDensity,
  fermiLevelForElectrons,
  fermiLevelForHoles,
  holeDensity,
  intrinsicDensity,
  intrinsicLevel,
  quasiFermiSplit,
  SILICON,
} from "../_shared/semiconductor";
import {
  drawBoxedLabel,
  drawFermiLine,
  drawLabel,
  drawLevelLabel,
  drawSplitDivider,
  drawThinLevel,
  fermiColors,
  labelCrossedBy,
  splitByFraction,
} from "./lib/draw";
import {
  formatDensity,
  formatDensitySquared,
  formatEvFixed,
} from "./lib/format";

/** 操作パラメータ(§5.6 の表) */
const OFFSET_MIN = -0.4;
const OFFSET_MAX = 0.4;
const OFFSET_STEP = 0.005;
const OFFSET_INIT = 0;
const T_MIN = 200;
const T_MAX = 500;
const T_STEP = 10;
const T_INIT = 300;
/** 光で足す過剰キャリア Δn = Δp [cm⁻³] */
const EXCESS = 1e14;
/** 縦の対数軸(log₁₀ cm⁻³) */
const LOG_MIN = 0;
const LOG_MAX = 20;
/** バンド図の縦軸 [eV] */
const E_MIN = -0.25;
const E_MAX = 1.37;
/** 光の矢印を置く上の余白(px) */
const LIGHT_BAND_PX = 34;
/** n と p がこの相対差より近ければ「どちらでもない(真性)」 */
const INTRINSIC_TOLERANCE = 1e-3;
const NARROW_WIDTH_PX = 480;

const BAND_TICKS: readonly AxisTick[] = [
  { value: 0, label: "E_v" },
  { value: SILICON.eg, label: "E_c" },
];

export default function massAction(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = fermiColors();
  const band = createPlotMapper();
  const bars = createPlotMapper();
  const ticksWide = pow10Ticks(LOG_MIN, LOG_MAX, 2);
  const ticksNarrow = pow10Ticks(LOG_MIN, LOG_MAX, 4);

  /* ---- 状態 ---- */
  let offset = OFFSET_INIT;
  let temperature = T_INIT;
  let light = false;

  /** パラメータから決まる量(変更時に計算) */
  const s = {
    eI: 0,
    eF: 0,
    n0: 0,
    p0: 0,
    n: 0,
    p: 0,
    ni: 0,
    eFn: 0,
    eFp: 0,
  };
  function recompute(): void {
    const T = temperature;
    s.eI = intrinsicLevel(SILICON, T);
    s.eF = s.eI + offset;
    s.n0 = electronDensity(SILICON, s.eF, T);
    s.p0 = holeDensity(SILICON, s.eF, T);
    s.n = light ? s.n0 + EXCESS : s.n0;
    s.p = light ? s.p0 + EXCESS : s.p0;
    s.ni = intrinsicDensity(SILICON, T);
    s.eFn = fermiLevelForElectrons(SILICON, s.n, T);
    s.eFp = fermiLevelForHoles(SILICON, s.p, T);
  }
  recompute();

  /** 光の波線の矢印(上から下へ) */
  function lightArrow(x: number, yTop: number, yBottom: number): void {
    const amp = 3;
    const waves = 3;
    const len = yBottom - yTop - 7;
    ctx.save();
    ctx.strokeStyle = colors.beam;
    ctx.fillStyle = colors.beam;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = yTop + len * t;
      const xx = x + amp * Math.sin(t * waves * 2 * Math.PI);
      if (i === 0) ctx.moveTo(xx, y);
      else ctx.lineTo(xx, y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, yBottom);
    ctx.lineTo(x - 4.5, yBottom - 8);
    ctx.lineTo(x + 4.5, yBottom - 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 準位線のラベル(左端)。E_i の線が文字を横切るときだけ線の下に置く */
  function levelLabel(text: string, e: number, color: string): void {
    drawLevelLabel(ctx, band, 0, e, text, color, labelCrossedBy(band, e, s.eI));
  }

  function drawBandPanel(): void {
    drawPlotFrame(ctx, band, { colors, yTicks: BAND_TICKS });
    withPlotClip(ctx, band, () => {
      drawBandBox(ctx, band, 0, 1, SILICON.eg, E_MAX + 1, { colors });
      drawBandBox(ctx, band, 0, 1, E_MIN - 1, 0, { colors });
      drawThinLevel(ctx, band, 0, 0.78, s.eI, colors, colors.level);
      if (light) {
        drawLevelLine(ctx, band, 0, 1, s.eFn, {
          colors,
          color: colors.electron,
          width: 2,
          dashed: true,
        });
        drawLevelLine(ctx, band, 0, 1, s.eFp, {
          colors,
          color: colors.hole,
          width: 2,
          dashed: true,
        });
        levelLabel("E_Fn", s.eFn, colors.electron);
        levelLabel("E_Fp", s.eFp, colors.hole);
      } else {
        drawFermiLine(ctx, band, 0, 1, s.eF, colors, "");
        levelLabel("E_F", s.eF, colors.electron);
      }
    });
    // E_F(や擬フェルミ準位)の破線と重なっても読めるよう、下地付きにする
    drawBoxedLabel(
      ctx,
      "E_i",
      band.toPxX(0.78) + 6,
      band.toPxY(s.eI),
      colors,
      "left",
      colors.level,
    );
    if (light) {
      const yTop = band.rect.y - LIGHT_BAND_PX + 2;
      const yBottom = band.rect.y + 12;
      for (const fx of [0.25, 0.5, 0.75]) {
        lightArrow(band.toPxX(fx), yTop, yBottom);
      }
      drawLabel(
        ctx,
        "光",
        band.toPxX(0.88),
        band.rect.y - LIGHT_BAND_PX / 2,
        colors.beamInk,
        "left",
      );
    }
  }

  function drawBarPanel(narrow: boolean): void {
    drawPlotFrame(ctx, bars, {
      colors,
      yTicks: narrow ? ticksNarrow : ticksWide,
      yLabel: "密度 [cm⁻³](対数)",
    });
    const ln = Math.log10(s.n);
    const lp = Math.log10(s.p);
    const lni = Math.log10(s.ni);
    const nX0 = 0.16;
    const nX1 = 0.36;
    const pX0 = 0.64;
    const pX1 = 0.84;
    withPlotClip(ctx, bars, () => {
      const base = bars.toPxY(LOG_MIN);
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = colors.electron;
      const yN = bars.toPxY(ln);
      ctx.fillRect(
        bars.toPxX(nX0),
        yN,
        bars.toPxX(nX1) - bars.toPxX(nX0),
        base - yN,
      );
      ctx.fillStyle = colors.hole;
      const yP = bars.toPxY(lp);
      ctx.fillRect(
        bars.toPxX(pX0),
        yP,
        bars.toPxX(pX1) - bars.toPxX(pX0),
        base - yP,
      );
      ctx.restore();

      // 光を当てる前(平衡)の高さの目印
      if (light) {
        ctx.save();
        ctx.strokeStyle = colors.bg;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const y0n = bars.toPxY(Math.log10(s.n0));
        const y0p = bars.toPxY(Math.log10(s.p0));
        ctx.moveTo(bars.toPxX(nX0), y0n);
        ctx.lineTo(bars.toPxX(nX1), y0n);
        ctx.moveTo(bars.toPxX(pX0), y0p);
        ctx.lineTo(bars.toPxX(pX1), y0p);
        ctx.stroke();
        ctx.restore();
      }

      // n_i の水平線
      drawLevelLine(ctx, bars, 0, 1, lni, {
        colors,
        color: colors.level,
        width: 1.4,
        dashed: true,
      });

      // 棒の頂点を結ぶ線と、その中点(対数の中点 = √np)の菱形
      const xa = bars.toPxX((nX0 + nX1) / 2);
      const xb = bars.toPxX((pX0 + pX1) / 2);
      const ya = bars.toPxY(ln);
      const yb = bars.toPxY(lp);
      ctx.save();
      ctx.strokeStyle = colors.text2;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
      ctx.stroke();
      ctx.restore();
      const xm = (xa + xb) / 2;
      const ym = bars.toPxY(0.5 * (ln + lp));
      const d = 7;
      ctx.save();
      ctx.fillStyle = colors.level;
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xm, ym - d);
      ctx.lineTo(xm + d, ym);
      ctx.lineTo(xm, ym + d);
      ctx.lineTo(xm - d, ym);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
    drawLabel(
      ctx,
      "n_i",
      bars.rect.x + bars.rect.w + 4,
      bars.toPxY(lni),
      colors.level,
      "left",
    );
    // √(np) のラベルは、棒の頂点を結ぶ破線にかからない側に置く
    // (破線が右上がり = 正孔が多いときは菱形の左上、そうでなければ右上)
    const rising = lp > ln;
    drawLabel(
      ctx,
      "√(np)",
      bars.toPxX(0.5) + (rising ? -10 : 10),
      bars.toPxY(0.5 * (ln + lp)) - 12,
      colors.text2,
      rising ? "right" : "left",
    );
    const yLab = bars.rect.y + bars.rect.h + 14;
    drawLabel(
      ctx,
      "電子 n",
      bars.toPxX((nX0 + nX1) / 2),
      yLab,
      colors.electron,
      "center",
    );
    drawLabel(
      ctx,
      "正孔 p",
      bars.toPxX((pX0 + pX1) / 2),
      yLab,
      colors.hole,
      "center",
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    const layout = splitByFraction(host.size, 0.35, 0.4);
    const a = layout.first;
    const b = layout.second;
    setPlotRange(
      band,
      a.x + 40,
      a.y + LIGHT_BAND_PX,
      a.w - 40 - 26,
      a.h - LIGHT_BAND_PX - 10,
      0,
      1,
      E_MIN,
      E_MAX,
    );
    setPlotRange(
      bars,
      b.x + 58,
      b.y + 14,
      b.w - 58 - 30,
      b.h - 14 - 30,
      0,
      1,
      LOG_MIN,
      LOG_MAX,
    );
    drawBandPanel();
    drawSplitDivider(ctx, layout, colors);
    drawBarPanel(narrow);

    // 読み取り値
    const np = s.n * s.p;
    const ratio = np / (s.ni * s.ni);
    nItem.set(formatDensity(s.n));
    pItem.set(formatDensity(s.p));
    npItem.set(formatDensitySquared(np));
    ni2Item.set(formatDensitySquared(s.ni * s.ni));
    ratioItem.set(ratio < 100 ? ratio.toFixed(2) : fmtSci(ratio, 2));
    const rel = Math.abs(s.n - s.p) / Math.max(s.n, s.p);
    roleItem.set(
      rel < INTRINSIC_TOLERANCE
        ? "どちらでもない(真性)"
        : s.n > s.p
          ? "多数 = 電子・少数 = 正孔"
          : "多数 = 正孔・少数 = 電子",
    );
    splitItem.set(
      light
        ? formatEvFixed(quasiFermiSplit(SILICON, s.n, s.p, temperature))
        : "—(平衡では 0)",
    );
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const nItem = readout.item("n", { color: "electron" });
  const pItem = readout.item("p", { color: "hole" });
  const npItem = readout.item("np");
  const ni2Item = readout.item("n_i²");
  const ratioItem = readout.item("np / n_i²");
  const roleItem = readout.item("キャリア");
  const splitItem = readout.item("E_Fn − E_Fp");

  const offsetSlider = host.controls.slider({
    id: "offset",
    label: "E_F − E_i",
    min: OFFSET_MIN,
    max: OFFSET_MAX,
    step: OFFSET_STEP,
    value: OFFSET_INIT,
    unit: "eV",
    format: (v) =>
      Math.abs(v) < 1e-9
        ? "0.000"
        : `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(3)}`,
  });
  offsetSlider.onChange((v) => {
    offset = v;
    recompute();
  });

  const tSlider = host.controls.slider({
    id: "temperature",
    label: "温度 T",
    min: T_MIN,
    max: T_MAX,
    step: T_STEP,
    value: T_INIT,
    unit: "K",
  });
  tSlider.onChange((v) => {
    temperature = v;
    recompute();
  });

  const lightToggle = host.controls.toggle({
    id: "light",
    label: "光を当てる(平衡を崩す)",
    value: false,
  });
  lightToggle.onChange((v) => {
    light = v;
    recompute();
  });

  host.controls.reset(() => {
    offsetSlider.set(OFFSET_INIT);
    tSlider.set(T_INIT);
    lightToggle.set(false);
    offset = OFFSET_INIT;
    temperature = T_INIT;
    light = false;
    recompute();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
