/**
 * phasor-sum.ts — 図3「散乱波を足し合わせる」(中心図版 — 仕様書 08 §5.3)
 *
 * 左: 単位胞を [001] 方向(真上)から見た投影図。各原子に高さ z(0・¼・½・¾)
 * のラベルと、その位置での縞の位相を示す小さな時計の針。(hkl) の縞は
 * 逆格子空間の記事の図3 と同じ描き方(drawStripes)で、高さ z = 0 の面で描く。
 * 右: 複素平面。各原子の矢(長さ f_j、向き 2π(hx_j + ky_j + lz_j)、その原子の
 * 色)を頭と尾でつなぎ、始点から終点への矢 F を --mat-beam の太い矢で描く。
 * 和がゼロなら始点に中抜きの丸と「F = 0」。
 *
 * 「矢を 1 本ずつ足す」で途中経過を見せる。矢の長さは各原子の電子数
 * (s = 0 の f = Z)で描く(角度依存は 5 節で導入 — 図注で明示)。
 *
 * 時計の針と右の矢は同じ phasorChain の turns から描くので、向きは原子ごとに
 * 厳密に一致する(受け入れ基準)。
 *
 * 実装方式: requestRender 型。乱数不使用。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { font } from "../../core/plot";
import {
  createReadout,
  createStepper,
  drawArrow,
  drawPanelDivider,
  drawPanelLabel,
  drawStripes,
  makeMapper,
  splitPanels,
  type ArrowOptions,
  type PanelMapper,
  type PanelRect,
  type PanelSplit,
} from "../reciprocal-lattice/_shared2d";
import {
  CSCL,
  CU,
  FE,
  NACL,
  SI,
  isSecondSpecies,
  majorElement,
  type CrystalStructure,
} from "./lib/structures";
import {
  formatHkl,
  phasorChain,
  siteAmplitude,
  type PhasorStep,
} from "./lib/structurefactor";
import {
  allowReadoutWrap,
  degLabel,
  drawAtom,
  fracLabel,
  haloText,
  hollowCircle,
  resolvePalette,
} from "./lib/draw";

type MaterialId = "fe" | "cu" | "si" | "nacl" | "cscl";
const MATERIALS: Readonly<Record<MaterialId, CrystalStructure>> = {
  fe: FE,
  cu: CU,
  si: SI,
  nacl: NACL,
  cscl: CSCL,
};
const MATERIAL_INIT: MaterialId = "si";
const HKL_MIN = 0;
const HKL_MAX = 4;
const H_INIT = 1;
const K_INIT = 1;
const L_INIT = 1;

/** 左パネルの幅の割合(広幅 — 仕様書 08 §5.3: 45%) */
const LEFT_FRACTION = 0.45;
/** 狭幅で上パネルに割り当てる高さの割合 */
const TOP_FRACTION = 0.46;
/** パネル間の隙間(px) */
const GAP = 16;
/** 投影図の単位胞の周りの余白(px) */
const CELL_PAD = 38;
/** 原子の半径(px)。セルの一辺に対する割合と上下限 */
const ATOM_R_FRACTION = 0.045;
const ATOM_R_MIN = 6;
const ATOM_R_MAX = 11;
/** 時計の半径 = 原子半径 × この倍率 */
const CLOCK_SCALE = 0.85;
/** 投影で重なる 2 原子(NaCl)の横ずらし(単位胞の割合) */
const OVERLAP_SHIFT = 0.075;
/** 単位胞の外周上の像(角・辺)の不透明度 */
const IMAGE_ALPHA = 0.35;
/** まだ足していない原子の不透明度(1 本ずつ足すとき) */
const PENDING_ALPHA = 0.3;
/** 複素平面の余白(px) */
const PLANE_PAD = 30;
/** 原子の矢 1 本の長さの上限(パネルの短辺に対する割合) */
const MAX_ARROW_FRACTION = 0.3;
/** 矢の太さ: 原子の矢 2px、F の矢 3.5px(母体仕様 §6.5 の 2px を基本に) */
const F_ARROW_WIDTH = 3.5;
const F_ARROW_HEAD = 12;
/** F = 0 の印の半径 */
const ZERO_MARK_R = 8;
/** |F| を 0 とみなす相対値 */
const ZERO_REL = 1e-9;
/** 「矢 1 本の長さ」の目安の円の破線と、破線の解除 */
const GUIDE_DASH = [3, 4];
const NO_DASH: number[] = [];

export default function phasorSum(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /** 矢の描画設定(使い回す) */
  const arrowOpts: ArrowOptions = { color: pal.beam, width: 2, head: 8 };

  /* ---- 状態 ---- */

  let material: MaterialId = MATERIAL_INIT;
  let h = H_INIT;
  let k = K_INIT;
  let l = L_INIT;
  /** 表示する矢の本数(全部 = サイト数) */
  let shown = 0;

  /* ---- 派生量(状態の変更時にだけ作り直す) ---- */

  let st: CrystalStructure = MATERIALS[material];
  let chain: PhasorStep[] = [];
  /** 全部の矢がそろったときの |F|(= Σ f_j) */
  let fSum = 1;
  /** 矢 1 本の最大の長さ(単位円の目安) */
  let fMax = 1;
  /** 投影図の原子の配置(重なりは横にずらす)。サイトごとに 1 つ */
  let projX = new Float64Array(0);
  let projY = new Float64Array(0);
  /** サイトごとの色(塗り・縁 = 矢と時計の針の色) */
  let siteFill: string[] = [];
  let siteEdge: string[] = [];
  /** 外周上の像([x, y, site] の並び) */
  let images: number[] = [];

  function rebuildStructure(): void {
    st = MATERIALS[material];
    const n = st.sites.length;
    projX = new Float64Array(n);
    projY = new Float64Array(n);
    fSum = 0;
    fMax = 0;
    st.sites.forEach((s, i) => {
      const f = siteAmplitude(s, 0, "xray");
      fSum += f;
      fMax = Math.max(fMax, f);
      projX[i] = s.x;
      projY[i] = s.y;
    });
    siteFill = st.sites.map((s) =>
      isSecondSpecies(majorElement(s)) ? pal.second : pal.matrix,
    );
    siteEdge = st.sites.map((s) =>
      isSecondSpecies(majorElement(s)) ? pal.secondEdge : pal.matrixEdge,
    );
    // 投影で同じ位置に来る原子(NaCl の Na と Cl)は左右にずらして並べる
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = st.sites[i];
        const b = st.sites[j];
        if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) {
          projX[i] = a.x - OVERLAP_SHIFT;
          projX[j] = b.x + OVERLAP_SHIFT;
        }
      }
    }
    // 単位胞の外周(x = 1 や y = 1)にも同じ原子の像を薄く描く
    images = [];
    for (let i = 0; i < n; i++) {
      const s = st.sites[i];
      const xs = Math.abs(s.x) < 1e-9 ? [0, 1] : [s.x];
      const ys = Math.abs(s.y) < 1e-9 ? [0, 1] : [s.y];
      for (const x of xs) {
        for (const y of ys) {
          if (x === s.x && y === s.y) continue;
          images.push(projX[i] - s.x + x, projY[i] - s.y + y, i);
        }
      }
    }
  }

  /** 矢の列と「矢 1 本の長さ」の円を囲む範囲(複素平面の表示範囲を決める) */
  let boxMinX = -1;
  let boxMaxX = 1;
  let boxMinY = -1;
  let boxMaxY = 1;

  function rebuildChain(): void {
    chain = phasorChain(st, h, k, l, 0, "xray");
    shown = chain.length;
    boxMinX = -fMax;
    boxMaxX = fMax;
    boxMinY = -fMax;
    boxMaxY = fMax;
    for (const c of chain) {
      boxMinX = Math.min(boxMinX, c.x1);
      boxMaxX = Math.max(boxMaxX, c.x1);
      boxMinY = Math.min(boxMinY, c.y1);
      boxMaxY = Math.max(boxMaxY, c.y1);
    }
  }

  /* ---- 読み取り値(仕様書 08 §5.3) ---- */

  const readout = createReadout(host);
  const hklItem = readout.item("(hkl)", { color: "recip" });
  const fItem = readout.item("|F|(電子の数)", { color: "beam" });
  const f2Item = readout.item("|F|²(全部そろったときを 1)", { color: "beam" });
  const verdictItem = readout.item("この反射は");
  const phaseItem = readout.item("各原子の位相");
  allowReadoutWrap(readout.el);

  function updateReadout(): void {
    const full = chain[chain.length - 1];
    const absF = full ? Math.hypot(full.x1, full.y1) : 0;
    const zero = absF <= fSum * ZERO_REL;
    hklItem.set(formatHkl(h, k, l));
    fItem.set(zero ? "0" : absF.toFixed(1));
    f2Item.set(zero ? "0" : ((absF * absF) / (fSum * fSum)).toFixed(3));
    verdictItem.set(
      h === 0 && k === 0 && l === 0
        ? "透過波(すべての矢がそろう)"
        : zero
          ? "消える(矢が閉じて F = 0)"
          : "現れる",
    );
    phaseItem.set(chain.map((c) => degLabel(c.turns)).join("、"));
    stepBtn.el.textContent =
      shown >= chain.length
        ? "矢を 1 本ずつ足す"
        : `次の矢を足す(${shown}/${chain.length})`;
  }

  /* ---- 描画 ---- */

  /* ---- レイアウト(寸法が変わったときだけ作り直す) ---- */

  const split: PanelSplit = {
    first: rect(0, 0, 1, 1),
    second: rect(0, 0, 1, 1),
    stacked: false,
  };
  /** 縞を描くための仮のパネル(単位胞の原点を中心にする — drawStripes 用) */
  let stripeMapper: PanelMapper = makeMapper(rect(0, 0, 1, 1), 1);
  /** 投影図の単位胞の左下(画面)と一辺(px) */
  let cellX = 0;
  let cellY = 0;
  let cellSide = 1;

  function rect(x: number, y: number, w: number, hh: number): PanelRect {
    return { x, y, w, h: hh, cx: x + w / 2, cy: y + hh / 2 };
  }

  /** 広幅は左 45%・右 55%、狭幅は上下(splitPanels の判定に合わせる) */
  function relayout(): void {
    const { w, h: hh } = host.size;
    split.stacked = splitPanels(host.size).stacked;
    if (!split.stacked) {
      const lw = (w - GAP) * LEFT_FRACTION;
      split.first = rect(0, 0, lw, hh);
      split.second = rect(lw + GAP, 0, w - lw - GAP, hh);
    } else {
      const th = (hh - GAP) * TOP_FRACTION;
      split.first = rect(0, 0, w, th);
      split.second = rect(0, th + GAP, w, hh - th - GAP);
    }
    const p = split.first;
    cellSide = Math.max(10, Math.min(p.w, p.h) - CELL_PAD * 2);
    cellX = p.cx - cellSide / 2;
    cellY = p.cy + cellSide / 2;
    stripeMapper = makeMapper(
      rect(cellX - cellSide, cellY - cellSide, cellSide * 2, cellSide * 2),
      cellSide,
    );
  }

  function toX(fx: number): number {
    return cellX + fx * cellSide;
  }

  function toY(fy: number): number {
    return cellY - fy * cellSide;
  }

  function drawProjection(panel: PanelRect): void {
    const side = cellSide;
    const ox = cellX;
    const oy = cellY;
    const r = Math.min(
      ATOM_R_MAX,
      Math.max(ATOM_R_MIN, side * ATOM_R_FRACTION),
    );
    const clockR = r * CLOCK_SCALE;

    // 縞(z = 0 の面)。原点が山の中心線に乗るよう、単位胞の原点を中心とした
    // 仮のパネルで drawStripes を呼び、単位胞の正方形でクリップする
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy - side, side, side);
    ctx.clip();
    drawStripes(ctx, stripeMapper, h, k);
    ctx.restore();

    // 単位胞の枠
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy - side + 0.5, side - 1, side - 1);
    // 軸の名前(x 右・y 上)。原子の並ばない ¾ の位置の外側に置く
    ctx.font = font(12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("x →", ox + side * 0.875, oy + 6);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("y ↑", panel.x + 4, oy - side * 0.875);

    // 外周の像(同じ原子 — 薄く)
    ctx.globalAlpha = IMAGE_ALPHA;
    for (let i = 0; i < images.length; i += 3) {
      const site = images[i + 2];
      drawAtom(
        ctx,
        toX(images[i]),
        toY(images[i + 1]),
        r,
        siteFill[site],
        siteEdge[site],
      );
    }
    ctx.globalAlpha = 1;

    // 原子・高さ z・時計の針
    const latest = shown < chain.length ? shown - 1 : -1;
    for (let i = 0; i < st.sites.length; i++) {
      const s = st.sites[i];
      const x = toX(projX[i]);
      const y = toY(projY[i]);
      const pending = i >= shown;
      ctx.globalAlpha = pending ? PENDING_ALPHA : 1;
      drawAtom(ctx, x, y, r, siteFill[i], siteEdge[i]);
      // 時計(原子の真上): 0 の向き(3 時)に目盛り、針は位相 2πt の向き
      const cx = x;
      const cy = y - r - clockR - 3;
      ctx.strokeStyle = pal.text2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, clockR, 0, Math.PI * 2);
      ctx.moveTo(cx + clockR, cy);
      ctx.lineTo(cx + clockR + 3, cy);
      ctx.stroke();
      const th = chain[i] ? chain[i].turns * Math.PI * 2 : 0;
      ctx.strokeStyle = siteEdge[i];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(th) * clockR, cy - Math.sin(th) * clockR);
      ctx.stroke();
      // 高さ z(原子の下)
      ctx.font = font(11);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      haloText(ctx, fracLabel(s.z), x, y + r + 2, pal.text2, pal.bg);
      ctx.globalAlpha = 1;
      if (i === latest) hollowCircle(ctx, x, y, r + 4, pal.accent, 2);
    }

    // 注記(縞は z = 0 の面で描いている)
    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const note =
      l === 0
        ? "数字は原子の高さ z"
        : "数字は高さ z。縞は z = 0 の面(高い原子ほど lz だけ位相が進む)";
    ctx.fillText(note, panel.x + 10, panel.y + panel.h - 6);
  }

  /** 複素平面の原点(画面)と 1 電子あたりの px(drawPlane で決める) */
  let planeOx = 0;
  let planeOy = 0;
  let planeScale = 1;

  function X(v: number): number {
    return planeOx + v * planeScale;
  }

  function Y(v: number): number {
    return planeOy - v * planeScale;
  }

  function drawPlane(panel: PanelRect): void {
    // 矢の列が収まる最大の縮尺。ただし矢 1 本がパネルの短辺の 30% を
    // 超えないようにする(和が小さい反射で矢が大きくなりすぎないように)
    const availW = Math.max(10, panel.w - PLANE_PAD * 2);
    const availH = Math.max(10, panel.h - PLANE_PAD * 2 - 16);
    planeScale = Math.min(
      availW / (boxMaxX - boxMinX),
      availH / (boxMaxY - boxMinY),
      (MAX_ARROW_FRACTION * Math.min(panel.w, panel.h)) / fMax,
    );
    planeOx = panel.cx - ((boxMinX + boxMaxX) / 2) * planeScale;
    planeOy = panel.cy + 8 + ((boxMinY + boxMaxY) / 2) * planeScale;
    const scale = planeScale;
    const ox = planeOx;
    const oy = planeOy;

    // 実軸・虚軸と、矢 1 本の長さの目安の円
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panel.x + 8, oy + 0.5);
    ctx.lineTo(panel.x + panel.w - 8, oy + 0.5);
    ctx.moveTo(ox + 0.5, panel.y + 8);
    ctx.lineTo(ox + 0.5, panel.y + panel.h - 8);
    ctx.stroke();
    ctx.setLineDash(GUIDE_DASH);
    ctx.beginPath();
    ctx.arc(ox, oy, fMax * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.font = font(12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("実部", panel.x + panel.w - 8, oy - 4);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("虚部", ox + 6, panel.y + 30);
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    haloText(
      ctx,
      `矢 1 本の長さ(f = ${Math.round(fMax)})`,
      ox + fMax * scale * 0.72 + 4,
      oy - fMax * scale * 0.72 - 2,
      pal.text2,
      pal.bg,
    );

    // 原子の矢(頭と尾をつなぐ)
    const latest = shown < chain.length ? shown - 1 : -1;
    for (let i = 0; i < shown && i < chain.length; i++) {
      const c = chain[i];
      arrowOpts.color = siteEdge[c.site];
      arrowOpts.width = i === latest ? 3 : 2;
      arrowOpts.head = 8;
      drawArrow(ctx, X(c.x0), Y(c.y0), X(c.x1), Y(c.y1), arrowOpts);
    }

    // 始点から終点への矢 F(途中なら「途中の和」)
    const last = chain[Math.max(0, shown - 1)];
    const endX = last ? last.x1 : 0;
    const endY = last ? last.y1 : 0;
    const len = Math.hypot(endX, endY);
    const partial = shown < chain.length;
    if (len <= fSum * ZERO_REL) {
      hollowCircle(ctx, ox, oy, ZERO_MARK_R, pal.beam, 2);
      ctx.font = font(14, 600);
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      haloText(
        ctx,
        partial ? "途中の和 = 0" : "F = 0",
        ox + ZERO_MARK_R + 4,
        oy - ZERO_MARK_R,
        pal.beamInk,
        pal.bg,
      );
      return;
    }
    arrowOpts.color = pal.beam;
    arrowOpts.width = partial ? 2.5 : F_ARROW_WIDTH;
    arrowOpts.head = F_ARROW_HEAD;
    drawArrow(ctx, ox, oy, X(endX), Y(endY), arrowOpts);
    // ラベル(矢の中点の横)
    const mx = (ox + X(endX)) / 2;
    const my = (oy + Y(endY)) / 2;
    const nx = -(Y(endY) - oy) / (len * scale);
    const ny = (X(endX) - ox) / (len * scale);
    ctx.font = font(14, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    haloText(
      ctx,
      partial ? "途中の和" : "F",
      mx + nx * 16,
      my + ny * 16,
      pal.beamInk,
      pal.bg,
    );
  }

  function draw(): void {
    const { w, h: hh, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    drawPanelDivider(ctx, host.size, split);
    drawProjection(split.first);
    drawPanelLabel(ctx, split.first, "単位胞を真上から見た図");
    drawPlane(split.second);
    drawPanelLabel(ctx, split.second, "矢の足し算(複素平面)");
  }

  /* ---- 操作部品(仕様書 08 §5.3) ---- */

  const materialSeg = host.controls.segmented<MaterialId>({
    id: "material",
    label: "物質",
    options: [
      { value: "fe", label: "Fe" },
      { value: "cu", label: "Cu" },
      { value: "si", label: "Si" },
      { value: "nacl", label: "NaCl" },
      { value: "cscl", label: "CsCl" },
    ],
    value: MATERIAL_INIT,
  });
  materialSeg.onChange((v) => {
    material = v;
    rebuildStructure();
    rebuildChain();
    updateReadout();
  });

  const hStepper = createStepper(host, {
    label: "h",
    min: HKL_MIN,
    max: HKL_MAX,
    value: H_INIT,
  });
  hStepper.onChange((v) => {
    h = v;
    rebuildChain();
    updateReadout();
  });
  const kStepper = createStepper(host, {
    label: "k",
    min: HKL_MIN,
    max: HKL_MAX,
    value: K_INIT,
  });
  kStepper.onChange((v) => {
    k = v;
    rebuildChain();
    updateReadout();
  });
  const lStepper = createStepper(host, {
    label: "l",
    min: HKL_MIN,
    max: HKL_MAX,
    value: L_INIT,
  });
  lStepper.onChange((v) => {
    l = v;
    rebuildChain();
    updateReadout();
  });

  const stepBtn = host.controls.button({ label: "矢を 1 本ずつ足す" });
  stepBtn.onClick(() => {
    shown = shown >= chain.length ? 1 : shown + 1;
    updateReadout();
    host.requestRender();
  });

  host.controls.reset(() => {
    materialSeg.set(MATERIAL_INIT);
    hStepper.set(H_INIT);
    kStepper.set(K_INIT);
    lStepper.set(L_INIT);
    shown = chain.length;
    updateReadout();
  });

  /* ---- 登録・初期状態(requestRender 型) ---- */

  host.onRender(draw);
  relayout();
  rebuildStructure();
  rebuildChain();
  updateReadout();

  return {
    resize(): void {
      relayout(); // 直後に engine が 1 フレーム描く
    },
    destroy(): void {
      readout.el.remove();
      hStepper.el.remove();
      kStepper.el.remove();
      lStepper.el.remove();
    },
  };
}
