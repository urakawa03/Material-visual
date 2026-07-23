/**
 * interface-budget.ts — 図2「同じ量、違う分け方」(記事仕様書 03 §5.2)
 *
 * 一定の総量(V_tot = 半径 40 nm の球 1 個ぶん)を N 個の等サイズ球に
 * 分割すると、1 個あたりは r(N) = 40 / N^(1/3) nm に縮み、総界面積は
 * A_tot ∝ N^(1/3) で増える(N を 8 倍にすると A_tot はちょうど 2 倍)。
 * 左: N 個の粒子(シード付きジッターグリッド配置)+バッジ「総量はいつも
 * 同じ」。右: A_tot と γA_tot の倍率バー(N=1 を ×1)、「界面にいる原子の
 * 割合 ≈ 3δ/r」の読み出し、数式パネル(A/V = 3/r と現在の r)。
 *
 * 純粋な requestRender 型(host.onRender のみ。アイドル時の消費ゼロ)。
 *
 * 簡略化(図注で明示):
 * - 描画は 2D 断面(円)だが、数値(r・A_tot・割合)は球として計算する。
 *   そのため画面上の円の合計面積は一定に見えない(一定なのは体積)。
 * - 「界面にいる原子の割合」は厚さ δ = 0.25 nm の球殻の体積比 3δ/r に
 *   よる概算(100 % でクランプ)。
 * - 粒子の配置は模式であり、位置に物理的な意味はない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import { clamp, mulberry32 } from "../../core/mathx";
import { GAMMA_JM2 } from "./lib/constants";
import { fmtSig, font } from "./lib/draw";

/** 乱数シード(ジッター配置。N ごとに派生させる — 母体仕様 §8.2) */
const SEED = 42;
/** N = 1 のときの半径 [nm](V_tot はこの球 1 個ぶんに固定 — §5.2) */
const R1_NM = 40;
/** 界面とみなす殻の厚さ δ [nm](割合 ≈ 3δ/r) */
const DELTA_NM = 0.25;
/** 粒子の数 N = 2^e の指数スライダー範囲と初期値(N: 1〜512、初期 8) */
const EXP_MIN = 0;
const EXP_MAX = 9;
const EXP_INIT = 3;
const N_MAX = 2 ** EXP_MAX;
/** 配置時に粒子の周りへ確保する余白 [nm](粒子間すき間はこの 2 倍) */
const MARGIN_NM = 1.5;
/** ジッター幅のセル寸法に対する上限(グリッドの読み取りやすさを保つ) */
const JITTER_MAX_FRAC = 0.22;
/** 倍率バーのフルスケール(= N=512 のときの N^(1/3)) */
const MULT_MAX = 8;
/** 倍率バーの目盛り(N = 1, 8, 64, 512 で到達する倍率) */
const TICK_MULTS = [1, 2, 4, 8] as const;
/** 倍率バーの高さ [px] */
const BAR_H = 10;
/** ステージのスケールバーの長さ [nm] */
const SCALE_BAR_NM = 40;
/** ステージ左上のバッジ文言(§5.2) */
const BADGE_TEXT = "総量はいつも同じ";

const TAU = Math.PI * 2;

/** 描画領域 */
interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 右パネルの寸法セット(広い/狭いの 2 種。初期化時に固定) */
interface Metrics {
  /** ラベルのフォントサイズ */
  labelSize: number;
  /** 現在値(×2.0 など)のフォントサイズ */
  valueSize: number;
  /** ラベル行の高さ */
  labelH: number;
  /** 目盛り・注記行の高さ */
  rowH: number;
  /** ラベル行とバーの間隔 */
  barGap: number;
  /** 数式パネルの高さ */
  formulaH: number;
  /** ブロック間の最小間隔 */
  gapMin: number;
}

const M_WIDE: Metrics = {
  labelSize: 12.5,
  valueSize: 13,
  labelH: 17,
  rowH: 18,
  barGap: 7,
  formulaH: 58,
  gapMin: 14,
};

const M_NARROW: Metrics = {
  labelSize: 11,
  valueSize: 12,
  labelH: 14,
  rowH: 15,
  barGap: 5,
  formulaH: 46,
  gapMin: 10,
};

/** 割合 [%] の表示(10 % 未満は小数 1 桁) */
function fmtPct(p: number): string {
  return p < 10 ? p.toFixed(1) : String(Math.round(p));
}

export default function interfaceBudget(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色(初期化時に一度だけ解決 — colors.ts の注意書き)
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill, 0.2);
  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");
  const bg = uiColor("bg");

  /** 粒子の数の指数(N = 2^nExp) */
  let nExp = EXP_INIT;

  /** 粒子中心の px 座標(最大 N 分を確保して再利用 — 母体仕様 §8.3) */
  const xs = new Float64Array(N_MAX);
  const ys = new Float64Array(N_MAX);

  /* ---- 操作部品(§7.2)— 2 の冪スナップの指数スライダー 1 本 ---- */

  const nSlider = host.controls.slider({
    id: "n",
    label: "粒子の数 N",
    min: EXP_MIN,
    max: EXP_MAX,
    step: 1,
    value: EXP_INIT,
    format: (v) => String(2 ** Math.round(v)),
  });
  nSlider.onChange((v) => {
    // requestRender 型: 値変更時は controls が 1 フレーム描画を要求する
    nExp = Math.round(v);
  });

  /* ---- レイアウト(毎回 host.size から計算 — 保持しない) ---- */

  function layout(): { stage: Pane; right: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    // 左 6 割にステージ、右 4 割にメーター群(狭い画面では右を広めに)
    const stageW = (w - pad * 3) * (narrow ? 0.52 : 0.6);
    return {
      stage: { x: pad, y: pad, w: stageW, h: h - pad * 2 },
      right: {
        x: pad * 2 + stageW,
        y: pad,
        w: w - pad * 3 - stageW,
        h: h - pad * 2,
      },
      narrow,
    };
  }

  /* ---- ステージ(粒子場) ---- */

  /** N 粒子を w×h に敷くときのグリッド列数(領域のアスペクトに合わせる) */
  function gridCols(n: number, w: number, h: number): number {
    return clamp(Math.round(Math.sqrt((n * w) / h)), 1, n);
  }

  /**
   * nm → px の変換係数。スライダーで取りうるすべての N(2^0〜2^9)が
   * 同じ縮尺で収まる最大値を選ぶ — N を変えても縮尺が変わらないので、
   * 粒子の大きさを N 間で直接比べられる(N=1 と N=512 の対比 — §5.2)。
   */
  function fitScale(w: number, h: number): number {
    let s = Infinity;
    for (let e = EXP_MIN; e <= EXP_MAX; e++) {
      const n = 2 ** e;
      const r = R1_NM / Math.cbrt(n);
      const cols = gridCols(n, w, h);
      const rows = Math.ceil(n / cols);
      const cell = Math.min(w / cols, h / rows);
      s = Math.min(s, cell / (2 * (r + MARGIN_NM)));
    }
    return s;
  }

  /**
   * シード付きジッターグリッド配置。ジッター幅を「セル/2 − r − 余白」に
   * 制限するので、粒子どうし・粒子と枠は決して重ならない(§5.2)。
   * グリッド列数は N とともに再計算する。
   */
  function placeParticles(p: Pane, n: number, rNm: number, s: number): void {
    const rand = mulberry32(SEED + n);
    const cols = gridCols(n, p.w, p.h);
    const rows = Math.ceil(n / cols);
    const cellW = p.w / cols;
    const cellH = p.h / rows;
    const need = (rNm + MARGIN_NM) * s;
    const ampX = Math.min(
      Math.max(0, cellW / 2 - need),
      cellW * JITTER_MAX_FRAC,
    );
    const ampY = Math.min(
      Math.max(0, cellH / 2 - need),
      cellH * JITTER_MAX_FRAC,
    );
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const col = i - row * cols;
      const inRow = Math.min(cols, n - row * cols);
      const offX = ((cols - inRow) * cellW) / 2; // 端数の最終行は中央寄せ
      xs[i] = p.x + offX + (col + 0.5) * cellW + (rand() * 2 - 1) * ampX;
      ys[i] = p.y + (row + 0.5) * cellH + (rand() * 2 - 1) * ampY;
    }
  }

  function drawScaleBar(p: Pane, s: number): void {
    const len = SCALE_BAR_NM * s;
    const x0 = p.x + p.w - 10 - len;
    const y = p.y + p.h - 12;
    // 粒子と重なっても読めるように下敷きを敷く
    ctx.fillStyle = bg;
    ctx.fillRect(x0 - 6, y - 19, len + 12, 26);
    ctx.strokeStyle = text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x0 + len, y + 0.5);
    ctx.moveTo(x0 + 0.5, y - 3);
    ctx.lineTo(x0 + 0.5, y + 4);
    ctx.moveTo(x0 + len - 0.5, y - 3);
    ctx.lineTo(x0 + len - 0.5, y + 4);
    ctx.stroke();
    ctx.fillStyle = text2;
    ctx.font = font(11);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${SCALE_BAR_NM} nm`, x0 + len / 2, y - 4);
    ctx.textAlign = "left";
  }

  function drawStage(p: Pane, narrow: boolean, n: number, rNm: number): void {
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

    const s = fitScale(p.w, p.h);
    placeParticles(p, n, rNm, s);
    const rPx = rNm * s;

    // 粒子(solute 塗り + 20% 暗い縁)は 1 パスでまとめ描き(母体仕様 §8.3)
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(xs[i] + rPx, ys[i]);
      ctx.arc(xs[i], ys[i], rPx, 0, TAU);
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();

    if (!narrow) drawScaleBar(p, s);

    // バッジ「総量はいつも同じ」(左上に小さく — §5.2)
    ctx.font = font(11);
    const bw = ctx.measureText(BADGE_TEXT).width + 14;
    const bh = 20;
    const bx = p.x + 6;
    const by = p.y + 6;
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(BADGE_TEXT, bx + 7, by + bh / 2 + 0.5);
  }

  /* ---- 右パネル(メーター群 + 数式パネル) ---- */

  /** 「A」+ 下付き「tot」のような添字つきラベルを描く(baseline 基準) */
  function textWithSub(
    x: number,
    baseY: number,
    pre: string,
    sub: string,
    size: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(size);
    ctx.fillText(pre, x, baseY);
    const cx = x + ctx.measureText(pre).width + 0.5;
    ctx.font = font(Math.max(9, size - 3));
    ctx.fillText(sub, cx, baseY + 3);
  }

  /**
   * 倍率バー 1 本(×1〜×8)。N=1 の位置(×1)に accent の参照線を立て、
   * ticks 指定時は ×1/×2/×4/×8 の目盛り、note 指定時は注記を添える。
   */
  function drawMeter(
    x: number,
    yTop: number,
    w: number,
    m: Metrics,
    labelPre: string,
    mult: number,
    ticks: boolean,
    note: string | null,
  ): void {
    const baseY = yTop + m.labelH - 3;
    textWithSub(x, baseY, labelPre, "tot", m.labelSize, text2);
    // 現在値(「×2.0」等 — §5.2 受け入れ基準の読み出し)
    ctx.font = font(m.valueSize, 600);
    ctx.fillStyle = text;
    ctx.textAlign = "right";
    ctx.fillText(`×${mult.toFixed(1)}`, x + w, baseY);
    ctx.textAlign = "left";

    const barY = yTop + m.labelH + m.barGap;
    ctx.fillStyle = hairline;
    ctx.fillRect(x, barY, w, BAR_H);
    ctx.fillStyle = soluteFill;
    ctx.fillRect(x, barY, (w * mult) / MULT_MAX, BAR_H);

    // ×1(N=1)の参照線(accent — §5.0 の意味色)
    const x1 = x + w / MULT_MAX;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, barY - 2.5);
    ctx.lineTo(x1, barY + BAR_H + 2.5);
    ctx.stroke();

    const below = barY + BAR_H + 4;
    ctx.textBaseline = "top";
    if (ticks) {
      ctx.font = font(11);
      ctx.strokeStyle = text2;
      ctx.lineWidth = 1;
      for (const t of TICK_MULTS) {
        const tx = x + (w * t) / MULT_MAX;
        if (t !== 1) {
          ctx.beginPath();
          ctx.moveTo(tx + 0.5, barY + BAR_H);
          ctx.lineTo(tx + 0.5, barY + BAR_H + 3);
          ctx.stroke();
        }
        ctx.fillStyle = t === 1 ? accent : text2;
        ctx.textAlign = t === MULT_MAX ? "right" : "center";
        ctx.fillText(`×${t}`, tx, below);
      }
      ctx.textAlign = "left";
    } else if (note !== null) {
      ctx.font = font(11);
      ctx.fillStyle = text2;
      ctx.fillText(note, x, below);
    }
  }

  /** 読み出し「界面にいる原子の割合 ≈ 12 %」(§5.2) */
  function drawFraction(
    x: number,
    yTop: number,
    w: number,
    m: Metrics,
    narrow: boolean,
    fracPct: number,
  ): void {
    const baseY = yTop + m.labelH - 3;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(m.labelSize);
    ctx.fillStyle = text2;
    ctx.fillText(narrow ? "界面原子の割合" : "界面にいる原子の割合", x, baseY);
    ctx.font = font(m.valueSize, 600);
    ctx.fillStyle = text;
    ctx.textAlign = "right";
    ctx.fillText(`≈ ${fmtPct(fracPct)} %`, x + w, baseY);
    ctx.textAlign = "left";
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.fillText(
      narrow
        ? `3δ/r、δ = ${DELTA_NM} nm`
        : `厚さ δ = ${DELTA_NM} nm の殻の体積比 ≈ 3δ/r`,
      x,
      baseY + m.rowH,
    );
  }

  /** 数式パネル: A/V = 3/r と現在の r(§5.2) */
  function drawFormula(
    p: Pane,
    m: Metrics,
    narrow: boolean,
    rNm: number,
  ): void {
    const yTop = p.y + p.h - m.formulaH;
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, yTop + 0.5, p.w - 1, m.formulaH - 1);
    const padIn = narrow ? 8 : 10;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(13, 600);
    ctx.fillStyle = text;
    ctx.fillText("A / V = 3 / r", p.x + padIn, yTop + padIn + 11);
    const y2 = yTop + m.formulaH - padIn - 2;
    let x2 = p.x + padIn;
    if (!narrow) {
      ctx.font = font(m.labelSize);
      ctx.fillStyle = text2;
      const pre = "いまの ";
      ctx.fillText(pre, x2, y2);
      x2 += ctx.measureText(pre).width;
    }
    ctx.font = font(m.labelSize, 600);
    ctx.fillStyle = text;
    ctx.fillText(`r = ${fmtSig(rNm)} nm`, x2, y2);
  }

  function drawRightPane(
    p: Pane,
    narrow: boolean,
    mult: number,
    rNm: number,
    fracPct: number,
  ): void {
    const m = narrow ? M_NARROW : M_WIDE;
    const meterH = m.labelH + m.barGap + BAR_H + m.rowH;
    const fracH = m.labelH + m.rowH;
    // 数式パネルは下端に固定し、残りの空きを 3 つの間隔へ均等配分する
    const content = meterH * 2 + fracH;
    const avail = p.h - m.formulaH - 8;
    const gap = Math.max(m.gapMin, (avail - content) / 3);

    let y = p.y;
    drawMeter(p.x, y, p.w, m, "総界面積 A", mult, true, null);
    y += meterH + gap;
    drawMeter(
      p.x,
      y,
      p.w,
      m,
      narrow ? "界面エネルギー γA" : "総界面エネルギー γA",
      mult,
      false,
      narrow ? `γ = ${GAMMA_JM2} J/m²` : `γ = ${GAMMA_JM2} J/m²(一定)`,
    );
    y += meterH + gap;
    drawFraction(p.x, y, p.w, m, narrow, fracPct);
    drawFormula(p, m, narrow, rNm);
  }

  /* ---- 描画(requestRender 時のみ呼ばれる) ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const n = 2 ** nExp;
    const rNm = R1_NM / Math.cbrt(n); // r(N) = 40 / N^(1/3)
    const mult = Math.cbrt(n); // A_tot 倍率 = N^(1/3)(N=1 を ×1)
    const fracPct = Math.min(100, (300 * DELTA_NM) / rNm); // 3δ/r [%]

    const l = layout();
    drawStage(l.stage, l.narrow, n, rNm);
    drawRightPane(l.right, l.narrow, mult, rNm, fracPct);
  }

  host.onRender(draw);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
