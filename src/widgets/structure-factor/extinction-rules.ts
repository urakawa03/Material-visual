/**
 * extinction-rules.ts — 図4「消滅則を自分で見つける」(仕様書 08 §5.4)
 *
 * 主領域: 逆格子の 1 枚の層(l 一定、h, k = −4〜4)の点を、|F|² に比例した
 * 面積の円(--mat-recip)で描く — 逆格子に明るさの重みが付いた地図。|F| = 0 の
 * 点は中抜きの小円(逆格子空間の記事の「現れない点」と同じ描き方)。
 * 右(狭幅では下): 発見の表。「この点を記録」で (hkl)・h+k+l・偶奇・|F|² を
 * 追記する(最大 12 行)。3 行たまると「規則の候補」が選べるようになり、
 * 選ぶと |h|,|k|,|l| ≤ 4 の全点で構造因子と照合して正誤を出す。
 * 「格子の言葉の答えを重ねる」で、逆格子空間の記事の isAllowed が許す点に
 * 細い外周を描く(体心・面心では完全に重なり、ダイヤモンドでは重ならない)。
 *
 * 表は「記録した点」の一覧で、|F|² の列はいま選んでいる物質の値を出す
 * (物質を切り替えると、同じ点の値がどう変わるかをその場で比べられる)。
 *
 * 実装方式: requestRender 型。乱数不使用。キーボード: 図をフォーカスして
 * 矢印キーで点を選び、Enter(またはスペース)で記録する。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fmtSig, font } from "../../core/plot";
import { isAllowed } from "../reciprocal-lattice/lattice";
import {
  createReadout,
  createStepper,
  drawPanelDivider,
  drawPanelLabel,
  type PanelRect,
  type PanelSplit,
} from "../reciprocal-lattice/_shared2d";
import {
  CSCL,
  CU,
  FE,
  LATTICE_NAMES,
  NACL,
  SI,
  type CrystalStructure,
} from "./lib/structures";
import {
  F2_ZERO_EPS,
  formatHkl,
  referenceF2,
  structureFactor2,
} from "./lib/structurefactor";
import { RULES, checkRule, type RuleId } from "./lib/rules";
import { createChoiceList } from "./lib/choice";
import {
  allowReadoutWrap,
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
const MATERIAL_INIT: MaterialId = "fe";

/** 層の点の範囲(h, k = −4〜4)と層 l の範囲(仕様書 08 §5.4) */
const N = 4;
const L_INIT = 0;
const SEL_H_INIT = 1;
const SEL_K_INIT = 1;
const OVERLAY_INIT = false;
/** 表の最大行数 */
const MAX_ROWS = 12;
/** 規則の候補が選べるようになる行数 */
const ROWS_FOR_RULES = 3;

/** 広幅の主領域の割合(右 30% が表) */
const MAIN_FRACTION = 0.7;
/** 狭幅で上(格子)に割り当てる高さの割合 */
const TOP_FRACTION = 0.6;
const GAP = 14;
/** 格子の周りの余白(上 = パネルの題、左と下 = 軸の数字と名前) */
const GRID_PAD_TOP = 30;
const GRID_PAD_BOTTOM = 34;
const GRID_PAD_LEFT = 30;
const GRID_PAD_RIGHT = 12;
/** 最大の円の半径(点の間隔に対する割合) */
const R_MAX_FRACTION = 0.42;
/** 原点 000 はひと回り大きく */
const ORIGIN_SCALE = 1.12;
/** 消える点の中抜きの小円の半径(px) */
const ZERO_R = 3.5;
/** 「格子の言葉の答え」の外周の半径(点の間隔に対する割合) */
const LATTICE_RING_FRACTION = 0.47;

interface Row {
  h: number;
  k: number;
  l: number;
}

function parityChar(n: number): string {
  return Math.abs(n) % 2 === 1 ? "奇" : "偶";
}

export default function extinctionRules(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /* ---- 状態 ---- */

  let material: MaterialId = MATERIAL_INIT;
  let layer = L_INIT;
  let selH = SEL_H_INIT;
  let selK = SEL_K_INIT;
  let overlay = OVERLAY_INIT;
  const rows: Row[] = [];
  let rule: RuleId | null = null;

  /* ---- 派生量 ---- */

  let st: CrystalStructure = MATERIALS[material];
  /** |F|²/|F(000)|²(s = 0)の表。添字は (h+N)·(2N+1)² + (k+N)·(2N+1) + (l+N) */
  const SIDE = 2 * N + 1;
  const rel = new Float64Array(SIDE * SIDE * SIDE);
  /** 規則の照合で食い違った点(同じ添字) */
  const mismatch = new Uint8Array(SIDE * SIDE * SIDE);
  let mismatchCount = 0;

  function idx(h: number, k: number, l: number): number {
    return (h + N) * SIDE * SIDE + (k + N) * SIDE + (l + N);
  }

  function rebuild(): void {
    st = MATERIALS[material];
    const ref = structureFactor2(st, 0, 0, 0, 0, "xray");
    const zero = referenceF2(st, "xray") * F2_ZERO_EPS;
    for (let h = -N; h <= N; h++) {
      for (let k = -N; k <= N; k++) {
        for (let l = -N; l <= N; l++) {
          const F2 = structureFactor2(st, h, k, l, 0, "xray");
          rel[idx(h, k, l)] = F2 <= zero ? 0 : F2 / ref;
        }
      }
    }
  }

  function verify(): void {
    mismatch.fill(0);
    mismatchCount = 0;
    const r = RULES.find((x) => x.id === rule);
    if (!r) {
      verdictItem.set("—");
      return;
    }
    const res = checkRule(st, r, N, "xray", Infinity);
    mismatchCount = res.mismatchCount;
    for (const m of res.mismatches) mismatch[idx(m.h, m.k, m.l)] = 1;
    if (res.mismatchCount === 0) {
      verdictItem.set(
        `${res.total} 点すべてで一致 — ${st.label}ではこの規則が正しい`,
      );
    } else {
      const ex = res.mismatches[0];
      verdictItem.set(
        `合わない点が ${res.mismatchCount} 点。たとえば ${formatHkl(ex.h, ex.k, ex.l)} は` +
          (ex.actualZero
            ? "規則では残るはずが、実際は消える"
            : "規則では消えるはずが、実際は現れる"),
      );
    }
  }

  /* ---- 読み取り値(仕様書 08 §5.4) ---- */

  const readout = createReadout(host);
  const selItem = readout.item("選んだ点", { color: "recip" });
  const f2Item = readout.item("|F|²(000 を 1)", { color: "beam" });
  const latticeItem = readout.item("格子の言葉では");
  const verdictItem = readout.item("照合の結果");
  allowReadoutWrap(readout.el);

  function updateReadout(): void {
    selItem.set(formatHkl(selH, selK, layer));
    const v = rel[idx(selH, selK, layer)];
    f2Item.set(v === 0 ? "0(消える)" : fmtSig(v, 3));
    latticeItem.set(
      `${LATTICE_NAMES[st.lattice]}の格子で` +
        (isAllowed(st.lattice, selH, selK, layer) ? "現れる点" : "現れない点"),
    );
  }

  /* ---- レイアウト ---- */

  const split: PanelSplit = {
    first: rect(0, 0, 1, 1),
    second: rect(0, 0, 1, 1),
    stacked: false,
  };
  /** 格子の原点(画面)と点の間隔(px) */
  let gridCx = 0;
  let gridCy = 0;
  let spacing = 1;

  function rect(x: number, y: number, w: number, h: number): PanelRect {
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  function relayout(): void {
    const { w, h } = host.size;
    split.stacked = w < h * 1.25;
    if (!split.stacked) {
      const mw = (w - GAP) * MAIN_FRACTION;
      split.first = rect(0, 0, mw, h);
      split.second = rect(mw + GAP, 0, w - mw - GAP, h);
    } else {
      const th = (h - GAP) * TOP_FRACTION;
      split.first = rect(0, 0, w, th);
      split.second = rect(0, th + GAP, w, h - th - GAP);
    }
    // 格子全体(点の間隔 2N 個ぶん + 両端の円・輪)と軸の数字が収まるように
    const p = split.first;
    const extent = 2 * N + 2 * LATTICE_RING_FRACTION;
    const availW = p.w - GRID_PAD_LEFT - GRID_PAD_RIGHT;
    const availH = p.h - GRID_PAD_TOP - GRID_PAD_BOTTOM;
    spacing = Math.max(8, Math.min(availW, availH) / extent);
    gridCx = p.x + GRID_PAD_LEFT + availW / 2;
    gridCy = p.y + GRID_PAD_TOP + availH / 2;
  }

  function px(hh: number): number {
    return gridCx + hh * spacing;
  }

  function py(kk: number): number {
    return gridCy - kk * spacing;
  }

  /* ---- 描画 ---- */

  function drawGrid(): void {
    const rMax = spacing * R_MAX_FRACTION;
    // 軸の数字(h は下、k は左)
    ctx.font = font(spacing < 30 ? 10 : 11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let hh = -N; hh <= N; hh++) {
      ctx.fillText(String(hh), px(hh), py(-N) + rMax + 4);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let kk = -N; kk <= N; kk++) {
      ctx.fillText(String(kk), px(-N) - rMax - 4, py(kk));
    }
    ctx.font = font(12);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("h →", px(N) + rMax, py(-N) + rMax + 18);
    ctx.textBaseline = "middle";
    ctx.fillText("k ↑", px(-N) - rMax - 22, py(N));

    // 点(面積 ∝ |F|²、消える点は中抜き)
    ctx.fillStyle = pal.recip;
    ctx.beginPath();
    for (let hh = -N; hh <= N; hh++) {
      for (let kk = -N; kk <= N; kk++) {
        const v = rel[idx(hh, kk, layer)];
        if (v === 0) continue;
        let r = rMax * Math.sqrt(v);
        if (hh === 0 && kk === 0 && layer === 0) r *= ORIGIN_SCALE;
        ctx.moveTo(px(hh) + r, py(kk));
        ctx.arc(px(hh), py(kk), r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    for (let hh = -N; hh <= N; hh++) {
      for (let kk = -N; kk <= N; kk++) {
        if (rel[idx(hh, kk, layer)] === 0) {
          hollowCircle(ctx, px(hh), py(kk), ZERO_R, pal.recip);
        }
      }
    }

    // 格子の言葉の答え(isAllowed が許す点に細い外周)
    if (overlay) {
      ctx.strokeStyle = pal.text2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rr = spacing * LATTICE_RING_FRACTION;
      for (let hh = -N; hh <= N; hh++) {
        for (let kk = -N; kk <= N; kk++) {
          if (!isAllowed(st.lattice, hh, kk, layer)) continue;
          ctx.moveTo(px(hh) + rr, py(kk));
          ctx.arc(px(hh), py(kk), rr, 0, Math.PI * 2);
        }
      }
      ctx.stroke();
    }

    // 規則の照合で食い違った点(破線の四角)
    if (mismatchCount > 0) {
      ctx.save();
      ctx.setLineDash(MISMATCH_DASH);
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      const half = spacing * 0.48;
      for (let hh = -N; hh <= N; hh++) {
        for (let kk = -N; kk <= N; kk++) {
          if (!mismatch[idx(hh, kk, layer)]) continue;
          ctx.strokeRect(px(hh) - half, py(kk) - half, half * 2, half * 2);
        }
      }
      ctx.restore();
    }

    // 選んだ点(アクセント色の輪とラベル)
    const sx = px(selH);
    const sy = py(selK);
    hollowCircle(ctx, sx, sy, rMax + 4, pal.accent, 2);
    if (host.stage === document.activeElement) {
      hollowCircle(ctx, sx, sy, rMax + 8, pal.accent, 1);
    }
    ctx.font = font(12, 600);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    haloText(
      ctx,
      formatHkl(selH, selK, layer),
      sx + rMax + 6,
      sy - rMax - 2,
      pal.recip,
      pal.bg,
    );
  }

  function drawTable(panel: PanelRect): void {
    const narrow = split.stacked;
    const fs = narrow ? 11 : 12;
    const rowH = narrow ? 15 : 19;
    const blocks = narrow ? 2 : 1;
    const perBlock = Math.ceil(MAX_ROWS / blocks);
    const blockW = (panel.w - 16) / blocks;
    const top = panel.y + 38;
    // 列の位置(ブロックの幅に対する割合)
    const cols = [0.02, 0.36, 0.6, 0.98];

    for (let b = 0; b < blocks; b++) {
      const x0 = panel.x + 8 + b * blockW;
      ctx.font = font(fs, 600);
      ctx.fillStyle = pal.text2;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText("(hkl)", x0 + cols[0] * blockW, top);
      ctx.textAlign = "center";
      ctx.fillText("h+k+l", x0 + cols[1] * blockW, top);
      ctx.fillText("偶奇", x0 + cols[2] * blockW, top);
      ctx.textAlign = "right";
      ctx.fillText("|F|²", x0 + cols[3] * blockW, top);
      ctx.strokeStyle = pal.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, top + rowH / 2 + 0.5);
      ctx.lineTo(x0 + blockW - 6, top + rowH / 2 + 0.5);
      ctx.stroke();

      ctx.font = font(fs);
      for (let i = 0; i < perBlock; i++) {
        const r = rows[b * perBlock + i];
        if (!r) break;
        const y = top + (i + 1) * rowH;
        const v = rel[idx(r.h, r.k, r.l)];
        ctx.fillStyle = pal.text;
        ctx.textAlign = "left";
        ctx.fillText(formatHkl(r.h, r.k, r.l), x0 + cols[0] * blockW, y);
        ctx.textAlign = "center";
        ctx.fillText(String(r.h + r.k + r.l), x0 + cols[1] * blockW, y);
        ctx.fillText(
          `${parityChar(r.h)}${parityChar(r.k)}${parityChar(r.l)}`,
          x0 + cols[2] * blockW,
          y,
        );
        ctx.textAlign = "right";
        ctx.fillStyle = v === 0 ? pal.text2 : pal.text;
        ctx.fillText(v === 0 ? "0" : fmtSig(v, 2), x0 + cols[3] * blockW, y);
      }
    }
    if (rows.length === 0) {
      ctx.font = font(fs);
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "点を選んで「この点を記録」",
        panel.x + 10,
        top + rowH * 1.4,
      );
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawPanelDivider(ctx, host.size, split);
    drawGrid();
    drawPanelLabel(
      ctx,
      split.first,
      `逆格子の層 l = ${layer}(${st.label}・点の面積 ∝ |F|²)`,
    );
    drawTable(split.second);
    drawPanelLabel(ctx, split.second, "発見の表(記録した点)");
  }

  /* ---- 操作部品(仕様書 08 §5.4) ---- */

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
    rebuild();
    verify();
    updateReadout();
  });

  const layerStepper = createStepper(host, {
    label: "層 l",
    min: -N,
    max: N,
    value: L_INIT,
  });
  layerStepper.onChange((v) => {
    layer = v;
    updateReadout();
  });

  const recordBtn = host.controls.button({ label: "この点を記録" });
  recordBtn.onClick(() => record());

  const overlayToggle = host.controls.toggle({
    id: "overlay",
    label: "格子の言葉の答えを重ねる",
    value: OVERLAY_INIT,
  });
  overlayToggle.onChange((v) => {
    overlay = v;
  });

  const ruleList = createChoiceList<RuleId>(host, {
    label: "規則の候補",
    options: RULES.map((r) => ({ value: r.id, label: r.text })),
  });
  ruleList.onChange((v) => {
    rule = v;
    verify();
  });

  function syncRuleList(): void {
    const enabled = rows.length >= ROWS_FOR_RULES;
    ruleList.setEnabled(enabled);
    ruleList.setLegend(
      enabled
        ? "規則の候補(選ぶと全点で照合する)"
        : `規則の候補(点を ${ROWS_FOR_RULES} つ以上記録すると選べる — いま ${rows.length})`,
    );
  }

  function record(): void {
    const exists = rows.some(
      (r) => r.h === selH && r.k === selK && r.l === layer,
    );
    if (!exists) {
      rows.push({ h: selH, k: selK, l: layer });
      if (rows.length > MAX_ROWS) rows.shift();
    }
    syncRuleList();
    host.requestRender();
  }

  host.controls.reset(() => {
    rows.length = 0;
    ruleList.set(null);
    materialSeg.set(MATERIAL_INIT);
    layerStepper.set(L_INIT);
    overlayToggle.set(OVERLAY_INIT);
    selH = SEL_H_INIT;
    selK = SEL_K_INIT;
    rebuild();
    verify();
    syncRuleList();
    updateReadout();
  });

  /* ---- 点の選択(クリック・キーボード) ---- */

  host.stage.tabIndex = 0;
  host.stage.setAttribute("role", "application");
  host.stage.setAttribute(
    "aria-label",
    "逆格子の層の点。矢印キーで点を選び、Enter で表に記録する",
  );

  function select(hh: number, kk: number): void {
    const nh = Math.max(-N, Math.min(N, hh));
    const nk = Math.max(-N, Math.min(N, kk));
    if (nh === selH && nk === selK) return;
    selH = nh;
    selK = nk;
    updateReadout();
    host.requestRender();
  }

  function onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowLeft":
        select(selH - 1, selK);
        break;
      case "ArrowRight":
        select(selH + 1, selK);
        break;
      case "ArrowUp":
        select(selH, selK + 1);
        break;
      case "ArrowDown":
        select(selH, selK - 1);
        break;
      case "Enter":
      case " ":
        record();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function onClick(e: MouseEvent): void {
    const rectEl = host.canvas.getBoundingClientRect();
    const x = e.clientX - rectEl.left;
    const y = e.clientY - rectEl.top;
    const hh = Math.round((x - gridCx) / spacing);
    const kk = Math.round((gridCy - y) / spacing);
    if (Math.abs(hh) > N || Math.abs(kk) > N) return;
    if (Math.hypot(px(hh) - x, py(kk) - y) > spacing * 0.5) return;
    select(hh, kk);
  }

  const onFocusChange = (): void => host.requestRender();
  host.stage.addEventListener("keydown", onKey);
  host.stage.addEventListener("focus", onFocusChange);
  host.stage.addEventListener("blur", onFocusChange);
  host.canvas.addEventListener("click", onClick);

  /* ---- 登録・初期状態(requestRender 型) ---- */

  host.onRender(draw);
  relayout();
  rebuild();
  syncRuleList();
  updateReadout();
  verify();

  return {
    resize(): void {
      relayout();
    },
    destroy(): void {
      host.stage.removeEventListener("keydown", onKey);
      host.stage.removeEventListener("focus", onFocusChange);
      host.stage.removeEventListener("blur", onFocusChange);
      host.canvas.removeEventListener("click", onClick);
      readout.el.remove();
      layerStepper.el.remove();
      ruleList.el.remove();
    },
  };
}

/** 照合で食い違った点の印の破線 */
const MISMATCH_DASH = [4, 3];
