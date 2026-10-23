/**
 * superlattice.ts — 図7「消えていた反射が現れるとき」(発展 — 仕様書 08 §5.7)
 *
 * 左: 2 種類の原子の並び(8×8 サイトの模式図)。規則度 η に応じて、各副格子
 * の原子をシード固定の乱数の順位で決める(η = 0 で完全にランダム、η = 1 で
 * 完全な規則配列)。CuZn は市松模様(α = i+j 偶数)、Cu₃Au は L1₂ を [001]
 * から見た並び(α = i, j とも偶数 — Au の席)。各副格子の原子数は占有率から
 * 決めるので組成は η によらず厳密に保たれ、η を上げると原子は単調に
 * 入れ替わる(ちらつかない)。
 * 右: 粉末図形。基本反射(--mat-recip の塗り)と、超格子反射(同じ色の中抜き
 * の山 → η とともに塗りが濃くなる)。超格子反射の高さを読めるよう、縦軸の
 * 拡大(×1・×10・×100・×1000)を選べる(倍率は常に表示)。
 *
 * モデル: 占有率つきの構造因子(lib/structures.ts の orderedAlloy)。超格子
 * 反射の F ∝ η(f_A − f_B)、強度 ∝ η²(式 E6)。規則度と温度の関係
 * (秩序-無秩序転移)は扱わず η を直接動かす。強度には図6 と同じ多重度と
 * ローレンツ偏光因子を掛ける(中性子では偏光の項を除く)。中性子も同じ波長
 * 0.154 nm を仮定し、線の位置を X 線とそろえる(図注で明示)。
 *
 * 実装方式: requestRender 型。乱数は mulberry32(シード固定)で、初期化時に
 * 1 度だけ順位を決める — reset で同じ配置の絵に戻る。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { mulberry32 } from "../../core/mathx";
import { fmtSci, fmtSig, font, linTicks } from "../../core/plot";
import { isAllowed } from "../reciprocal-lattice/lattice";
import {
  createReadout,
  drawPanelDivider,
  drawPanelLabel,
  type PanelRect,
  type PanelSplit,
} from "../reciprocal-lattice/_shared2d";
import { ALLOYS, orderedAlloy, type AlloyId } from "./lib/structures";
import {
  formatHkl,
  maxIndexFor,
  powderPattern,
  structureFactor2,
  type PowderLine,
} from "./lib/structurefactor";
import type { Radiation } from "./lib/formfactors";
import {
  PEAK_FWHM_DEG,
  allowReadoutWrap,
  createPlotArea,
  drawAtom,
  drawHklLabel,
  drawIntensityAxis,
  drawPeakShape,
  drawRotatedLabel,
  drawTwoThetaAxis,
  haloText,
  hollowCircle,
  labelsCollide,
  peakSigmaDeg,
  plotX,
  plotY,
  resolvePalette,
  setPlotArea,
  tooSmall,
  withPlotClip,
} from "./lib/draw";

type Zoom = "1" | "10" | "100" | "1000";

const ALLOY_INIT: AlloyId = "CuZn";
const ETA_INIT = 0;
const RAD_INIT: Radiation = "xray";
const ZOOM_INIT: Zoom = "1";

/** 波長(X 線は Cu Kα。中性子も同じ値を仮定して線の位置をそろえる) */
const LAMBDA = 0.15406;
const TT_MIN = 20;
const TT_MAX = 140;
/** 模式図のサイト数(一辺) */
const GRID = 8;
/** 乱数のシード(合金ごと。値そのものに意味はない) */
const SEED: Readonly<Record<AlloyId, number>> = {
  CuZn: 0x5eed1,
  Cu3Au: 0x5eed2,
};
/** 山の画面上の最小半値幅(px)。中抜きと塗りの違いが見える幅にする */
const MIN_FWHM_PX = 6;
const LEFT_FRACTION = 0.38;
const TOP_FRACTION = 0.44;
const GAP = 14;
/** 粉末図形のプロットの上端(パネル上端から。題・凡例・倍率の行の下) */
const PLOT_TOP = 58;
/** 超格子反射の塗りの濃さの上限(η = 1 でも基本反射と見分けられるように) */
const SUPER_FILL_MAX = 0.7;
/** ラベルを 2 段に置くときの上の段の持ち上げ(px) */
const ROW_LIFT = 26;

/** Fisher–Yates で 0..n−1 の並べ替えを作る(シード固定の乱数) */
function shuffled(n: number, rand: () => number): Int32Array {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** 副格子 α のサイトか(CuZn: 市松の一方、Cu₃Au: i, j とも偶数) */
function isAlpha(id: AlloyId, i: number, j: number): boolean {
  return id === "CuZn" ? (i + j) % 2 === 0 : i % 2 === 0 && j % 2 === 0;
}

export default function superlattice(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /* ---- 模式図のサイトと、シード固定の順位(初期化時に 1 度だけ) ---- */

  interface SiteOrder {
    /** α・β のサイト(行優先の通し番号) */
    alpha: Int32Array;
    beta: Int32Array;
  }
  const orders = {} as Record<AlloyId, SiteOrder>;
  for (const id of ["CuZn", "Cu3Au"] as const) {
    const alpha: number[] = [];
    const beta: number[] = [];
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        (isAlpha(id, i, j) ? alpha : beta).push(j * GRID + i);
      }
    }
    const rand = mulberry32(SEED[id]);
    const pa = shuffled(alpha.length, rand);
    const pb = shuffled(beta.length, rand);
    orders[id] = {
      alpha: Int32Array.from(pa, (k) => alpha[k]),
      beta: Int32Array.from(pb, (k) => beta[k]),
    };
  }
  /** サイトごとの原子(0 = A(--mat-matrix)、1 = B(--mat-second)) */
  const atomB = new Uint8Array(GRID * GRID);

  /* ---- 状態 ---- */

  let alloy: AlloyId = ALLOY_INIT;
  let eta = ETA_INIT;
  let rad: Radiation = RAD_INIT;
  let zoom: Zoom = ZOOM_INIT;

  /* ---- 派生量 ---- */

  let lines: PowderLine[] = [];
  /** 基本反射か(不規則状態の格子が許す反射) */
  let fundamental = new Uint8Array(0);
  /** 相対強度(最強の基本反射 = 100) */
  let rel = new Float64Array(0);
  let labelText: string[][] = [];
  /** 線ごとのラベル幅(横書き) */
  let labelW = new Float64Array(0);
  /** ラベルを付ける線(描画ごとに書き換える) */
  let labelIdx = new Int32Array(0);
  let labelXs = new Float64Array(0);
  let labelWs = new Float64Array(0);
  /** 最強の基本反射の添字 */
  let strongestFund = -1;

  /** 占有率から各副格子の B 原子の数を決め、順位の先頭から B を置く */
  function updateArrangement(): void {
    const o = orders[alloy];
    const nAlpha = o.alpha.length;
    const nBeta = o.beta.length;
    let bAlpha: number;
    let bBeta: number;
    if (alloy === "CuZn") {
      // B = Zn。α の Zn 占有率 (1 − η)/2、組成 50%
      bAlpha = Math.round((nAlpha * (1 - eta)) / 2);
      bBeta = (nAlpha + nBeta) / 2 - bAlpha;
    } else {
      // B = Au。α の Au 占有率 ¼ + ¾η、組成 25%
      bAlpha = Math.round(nAlpha * (0.25 + 0.75 * eta));
      bBeta = (nAlpha + nBeta) / 4 - bAlpha;
    }
    atomB.fill(0);
    for (let k = 0; k < bAlpha; k++) atomB[o.alpha[k]] = 1;
    for (let k = 0; k < bBeta; k++) atomB[o.beta[k]] = 1;
  }

  function recompute(): void {
    const info = ALLOYS[alloy];
    const st = orderedAlloy(alloy, eta);
    lines = powderPattern(
      st,
      LAMBDA,
      maxIndexFor(info.a, LAMBDA, TT_MAX),
      rad,
    ).filter((r) => r.twoTheta >= TT_MIN && r.twoTheta <= TT_MAX);
    fundamental = Uint8Array.from(lines, (r) =>
      isAllowed(info.disorderedLattice, r.h, r.k, r.l) ? 1 : 0,
    );
    let maxFund = 0;
    strongestFund = -1;
    lines.forEach((r, i) => {
      if (fundamental[i] && r.I > maxFund) {
        maxFund = r.I;
        strongestFund = i;
      }
    });
    rel = Float64Array.from(lines, (r) => (100 * r.I) / maxFund);
    ctx.font = font(11);
    labelText = lines.map((r) => r.forms.map((f) => formatHkl(f.h, f.k, f.l)));
    labelW = Float64Array.from(labelText, (ls) =>
      Math.max(...ls.map((s) => ctx.measureText(s).width)),
    );
    labelIdx = new Int32Array(lines.length);
    labelXs = new Float64Array(lines.length);
    labelWs = new Float64Array(lines.length);
    updateArrangement();
    updateReadout();
  }

  /* ---- 読み取り値(仕様書 08 §5.7) ---- */

  const readout = createReadout(host);
  const strongestItem = readout.item("最も強い超格子反射", { color: "recip" });
  const ratioItem = readout.item("|F超格子|² / |F基本|²(s = 0、η = 1)", {
    color: "beam",
  });
  const zoomItem = readout.item("縦軸");
  allowReadoutWrap(readout.el);

  /** 超格子 / 基本の |F|² 比(s = 0、η = 1)。仕様書 08 §5.7 の表の値 */
  function ratioAtOrder(r: Radiation): number {
    const st = orderedAlloy(alloy, 1);
    const fund: [number, number, number] =
      ALLOYS[alloy].disorderedLattice === "bcc" ? [1, 1, 0] : [1, 1, 1];
    return (
      structureFactor2(st, 1, 0, 0, 0, r) /
      structureFactor2(st, fund[0], fund[1], fund[2], 0, r)
    );
  }

  function fmtRatio(v: number): string {
    return v < 0.01 ? fmtSci(v, 2) : fmtSig(v, 2);
  }

  function updateReadout(): void {
    let best = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!fundamental[i] && (best < 0 || rel[i] > rel[best])) best = i;
    }
    if (best < 0 || rel[best] <= 0) {
      strongestItem.set("なし(η = 0 では超格子反射は消えている)");
    } else {
      const v = rel[best];
      strongestItem.set(
        `${labelText[best].join("/")}、相対強度 ${v < 0.01 ? fmtSci(v, 2) : fmtSig(v, 3)}` +
          "(最強の基本反射 = 100)",
      );
    }
    ratioItem.set(
      `X 線 ${fmtRatio(ratioAtOrder("xray"))}、中性子 ${fmtRatio(ratioAtOrder("neutron"))}`,
    );
    zoomItem.set(`×${zoom}(倍率を変えても相対強度の値は変わらない)`);
  }

  /* ---- レイアウト ---- */

  const split: PanelSplit = {
    first: rect(0, 0, 1, 1),
    second: rect(0, 0, 1, 1),
    stacked: false,
  };
  const plot = createPlotArea();

  function rect(x: number, y: number, w: number, h: number): PanelRect {
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  function relayout(): void {
    const { w, h } = host.size;
    split.stacked = w < h * 1.25;
    if (!split.stacked) {
      const lw = (w - GAP) * LEFT_FRACTION;
      split.first = rect(0, 0, lw, h);
      split.second = rect(lw + GAP, 0, w - lw - GAP, h);
    } else {
      const th = (h - GAP) * TOP_FRACTION;
      split.first = rect(0, 0, w, th);
      split.second = rect(0, th + GAP, w, h - th - GAP);
    }
  }

  /* ---- 描画 ---- */

  function drawArrangement(panel: PanelRect): void {
    const top = panel.y + 32;
    const bottom = panel.y + panel.h - 30;
    // 寸法が一瞬だけ極小になっても半径が負にならないよう下限を置く
    const side = Math.max(16, Math.min(panel.w - 24, bottom - top));
    const cell = side / GRID;
    const x0 = panel.cx - side / 2;
    const y0 = top + (bottom - top - side) / 2;
    const r = cell * 0.38;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const b = atomB[j * GRID + i] === 1;
        drawAtom(
          ctx,
          x0 + (i + 0.5) * cell,
          y0 + (GRID - j - 0.5) * cell,
          r,
          b ? pal.second : pal.matrix,
          b ? pal.secondEdge : pal.matrixEdge,
        );
      }
    }
    // 凡例
    const info = ALLOYS[alloy];
    const ly = panel.y + panel.h - 14;
    ctx.font = font(12);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let x = panel.x + 12;
    drawAtom(ctx, x + 6, ly, 6, pal.matrix, pal.matrixEdge);
    ctx.fillStyle = pal.text;
    ctx.fillText(info.elA, x + 16, ly);
    x += 16 + ctx.measureText(info.elA).width + 16;
    drawAtom(ctx, x + 6, ly, 6, pal.second, pal.secondEdge);
    ctx.fillStyle = pal.text;
    ctx.fillText(info.elB, x + 16, ly);
    x += 16 + ctx.measureText(info.elB).width + 16;
    ctx.fillStyle = pal.text2;
    ctx.fillText(
      eta >= 0.995
        ? `規則配列(${info.orderedName})`
        : eta <= 0.005
          ? `不規則(平均は${info.disorderedName})`
          : "一部が規則化",
      x,
      ly,
    );
  }

  function drawPattern(panel: PanelRect): void {
    const ml = 52;
    const mr = 14;
    const factor = Number(zoom);
    setPlotArea(
      plot,
      panel.x + ml,
      panel.y + PLOT_TOP,
      panel.w - ml - mr,
      panel.h - PLOT_TOP - 36,
      TT_MIN,
      TT_MAX,
      100 / factor,
    );
    const ticks = linTicks(0, 100 / factor, 4);
    drawIntensityAxis(ctx, plot, pal, ticks, (v) => fmtSig(v, 3));
    drawRotatedLabel(
      ctx,
      "相対強度",
      panel.x + 12,
      plot.y + plot.h / 2,
      pal.text2,
    );
    drawTwoThetaAxis(ctx, plot, pal, true);

    const sigma = peakSigmaDeg(plot, PEAK_FWHM_DEG, MIN_FWHM_PX);
    const base = plotY(plot, 0);
    withPlotClip(ctx, plot, () => {
      lines.forEach((r, i) => {
        const fund = fundamental[i] === 1;
        if (rel[i] <= 0) return;
        drawPeakShape(
          ctx,
          plot,
          r.twoTheta,
          rel[i],
          sigma,
          pal.recip,
          pal.recip,
          fund ? 1 : SUPER_FILL_MAX * eta,
        );
      });
    });
    // 超格子反射の位置(η = 0 では消えている — 中抜きの小円)
    lines.forEach((r, i) => {
      if (fundamental[i]) return;
      hollowCircle(ctx, plotX(plot, r.twoTheta), base - 6, 3.5, pal.recip);
    });

    // (hkl) ラベル: 超格子反射すべてと、基準にする最強の基本反射(拡大して
    // 枠からはみ出しているときは、塗りの山 = 基本反射と凡例で分かるので付けない)
    let nLab = 0;
    lines.forEach((r, i) => {
      if (fundamental[i] && (i !== strongestFund || rel[i] > plot.yMax)) {
        return;
      }
      labelIdx[nLab] = i;
      labelXs[nLab] = plotX(plot, r.twoTheta);
      labelWs[nLab] = labelW[i];
      nLab++;
    });
    // 1 段で重なるなら 2 段に互い違いに置き、それでも重なるなら縦書きにする
    const twoRows = labelsCollide(labelXs, labelWs, nLab);
    const rotated = twoRows && labelsCollide(labelXs, labelWs, nLab, 4, 2);
    const sigmaPx = sigma * (plot.w / (plot.xMax - plot.xMin));
    for (let j = 0; j < nLab; j++) {
      const i = labelIdx[j];
      const fund = fundamental[i] === 1;
      const top = plotY(plot, Math.min(rel[i], plot.yMax));
      drawHklLabel(
        ctx,
        labelText[i],
        labelXs[j],
        Math.max(plot.y + 14, fund ? top : Math.min(top, base - 11)),
        base,
        rotated,
        fund ? pal.text2 : pal.recip,
        pal.bg,
        plot.y,
        twoRows && j % 2 === 1 ? ROW_LIFT : 0,
        3 * sigmaPx + 3,
      );
    }

    // 倍率(常に表示)と凡例
    ctx.font = font(14, 600);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    haloText(
      ctx,
      `縦軸 ×${zoom}`,
      panel.x + panel.w - mr,
      panel.y + 8,
      pal.text,
      pal.bg,
    );
    ctx.font = font(11);
    ctx.textAlign = "left";
    haloText(
      ctx,
      "塗りの山 = 基本反射、中抜きの山 = 超格子反射",
      panel.x + 12,
      panel.y + 26,
      pal.text2,
      pal.bg,
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    drawPanelDivider(ctx, host.size, split);
    drawArrangement(split.first);
    drawPanelLabel(ctx, split.first, "原子の並び(模式図)");
    drawPattern(split.second);
    drawPanelLabel(ctx, split.second, "粉末回折図形");
  }

  /* ---- 操作部品(仕様書 08 §5.7) ---- */

  const alloySeg = host.controls.segmented<AlloyId>({
    id: "alloy",
    label: "合金",
    options: [
      { value: "CuZn", label: "CuZn" },
      { value: "Cu3Au", label: "Cu₃Au" },
    ],
    value: ALLOY_INIT,
  });
  alloySeg.onChange((v) => {
    alloy = v;
    recompute();
  });

  const etaSlider = host.controls.slider({
    id: "eta",
    label: "規則度 η",
    min: 0,
    max: 1,
    step: 0.01,
    value: ETA_INIT,
  });
  etaSlider.onChange((v) => {
    eta = v;
    recompute();
  });

  const radSeg = host.controls.segmented<Radiation>({
    id: "rad",
    label: "放射線",
    options: [
      { value: "xray", label: "X 線" },
      { value: "neutron", label: "中性子" },
    ],
    value: RAD_INIT,
  });
  radSeg.onChange((v) => {
    rad = v;
    recompute();
  });

  const zoomSeg = host.controls.segmented<Zoom>({
    id: "zoom",
    label: "縦軸の拡大",
    options: [
      { value: "1", label: "×1" },
      { value: "10", label: "×10" },
      { value: "100", label: "×100" },
      { value: "1000", label: "×1000" },
    ],
    value: ZOOM_INIT,
  });
  zoomSeg.onChange((v) => {
    zoom = v;
    updateReadout();
  });

  host.controls.reset(() => {
    alloySeg.set(ALLOY_INIT);
    etaSlider.set(ETA_INIT);
    radSeg.set(RAD_INIT);
    zoomSeg.set(ZOOM_INIT);
  });

  /* ---- 登録・初期状態(requestRender 型) ---- */

  host.onRender(draw);
  relayout();
  recompute();

  return {
    resize(): void {
      relayout();
    },
    destroy(): void {
      readout.el.remove();
    },
  };
}
