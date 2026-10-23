/**
 * tetragonality-hardness.ts — 図6「なぜ硬いのか」(記事仕様書 10 §5.6)
 *
 * 左: 体心正方の胞(2D の斜め投影)と、c 軸方向の八面体位置に入った炭素
 * (--mat-solute)。炭素量に応じて胞の縦横比 c/a = 1 + 0.045 C(式 E4)が
 * 変わる。実際の c/a は 1.04 程度なので、形は 5 倍に誇張して描き、その旨を
 * 常に表示する。胞のまわりに正方晶ひずみの場(--mat-tension / --mat-compression)。
 * 右: 炭素量と 100% マルテンサイトの硬さ(目安の点を結ぶ折れ線)、現在の点、
 * 参考に同じ炭素量の徐冷材(パーライト)の硬さ。炭素 0 には「焼入れても
 * 硬くならない」のラベル。
 *
 * 硬さの内訳(炭素による格子のひずみ・転位と双晶・細かい組織)は数値に
 * 分解しない(§5.6 — 研究上も分けるのが難しい)。
 *
 * 実装方式: 2D / requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { parseRgb } from "../cottrell-atmosphere/lib/lattice";
import { MARTENSITE_HV_TABLE, T_ROOM_C } from "./lib/constants";
import { tetragonality } from "./lib/bain";
import { martensiteFraction, msCelsius } from "./lib/kinetics";
import { martensiteHardness, slowCooledHardness } from "./lib/hardness";
import {
  MIN_CANVAS_PX,
  type Pane,
  atom,
  context2d,
  drawAxes,
  fmtCelsius,
  fmtPercent,
  font,
  makeScale,
  mapScale,
  plateText,
  resolvePalette,
  unmapScale,
} from "./lib/draw";

/** 炭素量の範囲 [wt%](§5.6: 0〜1.2、step 0.05) */
const C_MIN = 0;
const C_MAX = 1.2;
const C_STEP = 0.05;
const C_INIT = 0.4;
const FIELD_INIT = true;
/** 胞の形の誇張倍率(§5.6: ×5) */
const EXAGGERATION = 5;
/** 硬さの軸の上限 [HV] */
const HV_MAX = 900;
/** 曲線のサンプル数 */
const SAMPLES = 160;
/** 斜め投影の奥行きの向きと長さ(a に対する比) */
const DEPTH_DX = 0.5;
const DEPTH_DY = -0.36;
/** 鉄の原子の半径(a に対する比) */
const R_FE_PER_A = 0.085;
/** ひずみの場の塗りのセルの大きさ [px]・最大不透明度・届く範囲(a に対する比) */
const FIELD_CELL_PX = 6;
const FIELD_ALPHA_MAX = 0.4;
const FIELD_REACH = 0.8;
/** ひずみの場を枠の端に向けて薄くする幅 [px] */
const FIELD_EDGE_FADE_PX = 28;

const TAU2 = Math.PI * 2;

export default function tetragonalityHardness(host: FigureHost): WidgetHandle {
  const ctx = context2d(host.canvas);
  const pal = resolvePalette();
  const tensionRgb = parseRgb(pal.tension);
  const compressionRgb = parseRgb(pal.compression);

  /* ---- 状態 ---- */
  let carbon = C_INIT;
  let showField = FIELD_INIT;

  /* ---- 読み取り値(§5.6) ---- */
  const readout = createReadout(host);
  const rRatio = readout.item("c/a(実際の値)");
  const rHv = readout.item("硬さ");
  const rMs = readout.item("Ms");
  const rRa = readout.item("室温の残留オーステナイト");
  const rSrc = readout.item("硬さの源");

  function updateReadouts(): void {
    rRatio.set(tetragonality(carbon).toFixed(3));
    rHv.set(`約 ${Math.round(martensiteHardness(carbon) / 10) * 10} HV`);
    const ms = msCelsius(carbon);
    rMs.set(fmtCelsius(ms));
    rRa.set(fmtPercent(1 - martensiteFraction(T_ROOM_C, ms)));
    rSrc.set(
      carbon < 0.025
        ? "転位と細かい組織だけ(炭素がない)"
        : "炭素による格子のひずみ・転位と双晶・細かい組織",
    );
  }

  /* ---- 操作部品(§5.6) ---- */
  const cSlider = host.controls.slider({
    id: "carbon",
    label: "炭素量",
    min: C_MIN,
    max: C_MAX,
    step: C_STEP,
    value: C_INIT,
    unit: "wt%",
  });
  cSlider.onChange((v) => {
    carbon = v;
    updateReadouts();
    host.requestRender();
  });
  const fieldToggle = host.controls.toggle({
    id: "field",
    label: "ひずみの場を表示",
    value: FIELD_INIT,
  });
  fieldToggle.onChange((v) => {
    showField = v;
    host.requestRender();
  });
  host.controls.reset(() => {
    cSlider.set(C_INIT);
    fieldToggle.set(FIELD_INIT);
    carbon = C_INIT;
    showField = FIELD_INIT;
    updateReadouts();
  });

  /* ---- レイアウト ---- */

  function layout(): { cell: Pane; plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const ch = Math.round((h - 3 * pad) * 0.46);
      return {
        cell: { x: pad, y: pad, w: w - 2 * pad, h: ch },
        plot: { x: pad, y: 2 * pad + ch, w: w - 2 * pad, h: h - 3 * pad - ch },
        narrow,
      };
    }
    const cw = Math.round((w - 3 * pad) * 0.45);
    return {
      cell: { x: pad, y: pad, w: cw, h: h - 2 * pad },
      plot: { x: 2 * pad + cw, y: pad, w: w - 3 * pad - cw, h: h - 2 * pad },
      narrow,
    };
  }

  /* ---- 左: 体心正方の胞 ---- */

  /** ひずみの場を粗い格子で描いておく小さなキャンバス(補間つきで拡大して貼る) */
  let fieldCanvas: HTMLCanvasElement | null = null;

  /**
   * 炭素のまわりの正方晶ひずみの場(模式)。cos 2φ(φ は c 軸からの角)で
   * 符号を決め(c 軸方向は引張、横は圧縮)、強さは 1/(r² + r₀²)。届く範囲の
   * 端で 0 になるよう窓をかける。胞の枠の中だけに描く。
   */
  function drawField(
    p: Pane,
    a: number,
    sites: ReadonlyArray<{ x: number; y: number }>,
    n: number,
  ): void {
    const amp = Math.min(carbon / C_MAX, 1);
    const reach = a * FIELD_REACH;
    const r0 = a * 0.12;
    const gw = Math.ceil(p.w / FIELD_CELL_PX);
    const gh = Math.ceil(p.h / FIELD_CELL_PX);
    fieldCanvas ??= document.createElement("canvas");
    if (fieldCanvas.width !== gw) fieldCanvas.width = gw;
    if (fieldCanvas.height !== gh) fieldCanvas.height = gh;
    const fctx = fieldCanvas.getContext("2d");
    if (!fctx) return;
    const img = fctx.createImageData(gw, gh);
    const data = img.data;
    for (let gy = 0; gy < gh; gy++) {
      const y = p.y + (gy + 0.5) * FIELD_CELL_PX;
      for (let gx = 0; gx < gw; gx++) {
        const x = p.x + (gx + 0.5) * FIELD_CELL_PX;
        let v = 0;
        for (let k = 0; k < n; k++) {
          const cx = x - sites[k].x;
          const cy = y - sites[k].y;
          const r2 = cx * cx + cy * cy;
          if (r2 >= reach * reach) continue;
          const cos2 = (cy * cy - cx * cx) / Math.max(r2, 1e-9);
          const win = 1 - r2 / (reach * reach);
          v += ((amp * cos2 * r0 * r0 * 2.2) / (r2 + r0 * r0)) * win * win;
        }
        // 枠の端で切れた跡が見えないよう、端の手前で薄くする
        const edge = Math.min(x - p.x, p.x + p.w - x, y - p.y, p.y + p.h - y);
        const fade = Math.min(Math.max(edge / FIELD_EDGE_FADE_PX, 0), 1);
        const al = Math.min(Math.abs(v), 1) * FIELD_ALPHA_MAX * fade;
        if (al < 0.01) continue;
        const [rr, gg, bb] = v > 0 ? tensionRgb : compressionRgb;
        const o = 4 * (gy * gw + gx);
        data[o] = rr;
        data[o + 1] = gg;
        data[o + 2] = bb;
        data[o + 3] = Math.round(al * 255);
      }
    }
    fctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      fieldCanvas,
      p.x,
      p.y,
      gw * FIELD_CELL_PX,
      gh * FIELD_CELL_PX,
    );
    ctx.restore();
  }

  function drawCell(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const ratioDisp = 1 + EXAGGERATION * (tetragonality(carbon) - 1);
    /** 炭素量が最大のときの(誇張した)縦横比。胞の置き場所はこれで決める */
    const ratioMax = 1 + EXAGGERATION * (tetragonality(C_MAX) - 1);
    // 胞の大きさ a は炭素量によらず一定にし、縦 c だけを変える。
    // 奥行き (DEPTH_DX, DEPTH_DY)·a・原子の半径・寸法線の余白を含めて枠に収める
    const padL = 22; // 左: c の寸法線と文字
    const padR = 4;
    const titleH = 2 * fs + 26;
    // 下: a の寸法線と文字、炭素 0 のときの一言の行
    const dimBelow = 2 * fs + 18;
    const a = Math.max(
      Math.min(
        (p.w - padL - padR) / (1 + DEPTH_DX + 2 * R_FE_PER_A),
        (p.h - titleH - dimBelow) /
          (ratioMax + Math.abs(DEPTH_DY) + 2 * R_FE_PER_A),
      ),
      10,
    );
    const rFe = Math.max(a * R_FE_PER_A, 4);
    const c = a * ratioDisp;
    const dx = DEPTH_DX * a;
    const dy = DEPTH_DY * a;
    const usedW = padL + (1 + DEPTH_DX) * a + 2 * rFe + padR;
    const x0 = p.x + (p.w - usedW) / 2 + padL + rFe;
    const usedH = (ratioMax + Math.abs(DEPTH_DY)) * a + 2 * rFe + dimBelow;
    const yBase =
      p.y +
      titleH +
      Math.max(p.h - titleH - usedH, 0) / 2 +
      rFe +
      Math.abs(dy) +
      ratioMax * a;
    // 前面の左下を基準に、8 頂点(前 4・奥 4)
    const fbl = { x: x0, y: yBase };
    const fbr = { x: x0 + a, y: yBase };
    const ftl = { x: x0, y: yBase - c };
    const ftr = { x: x0 + a, y: yBase - c };
    const bbl = { x: fbl.x + dx, y: fbl.y + dy };
    const bbr = { x: fbr.x + dx, y: fbr.y + dy };
    const btl = { x: ftl.x + dx, y: ftl.y + dy };
    const btr = { x: ftr.x + dx, y: ftr.y + dy };
    const center = { x: (fbl.x + btr.x) / 2, y: (fbl.y + btr.y) / 2 };

    // 炭素の位置: c 軸方向の稜の中点(八面体位置のうち c 軸方向の 1 種類)
    const sites = [
      { x: (fbl.x + ftl.x) / 2, y: (fbl.y + ftl.y) / 2 },
      { x: (bbr.x + btr.x) / 2, y: (bbr.y + btr.y) / 2 },
    ];
    const nCarbon = carbon < 0.025 ? 0 : carbon < 0.6 ? 1 : 2;

    // ひずみの場(炭素のまわり: c 軸方向に引張、横に圧縮 — 模式)
    if (showField && nCarbon > 0) drawField(p, a, sites, nCarbon);

    // 稜線(奥の 3 本は細い破線、他は hairline より濃い text-2)
    const line = (
      pa: { x: number; y: number },
      pb: { x: number; y: number },
      hidden: boolean,
    ): void => {
      ctx.save();
      if (hidden) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = pal.text2;
      ctx.globalAlpha = hidden ? 0.45 : 0.8;
      ctx.lineWidth = hidden ? 1 : 1.4;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.restore();
    };
    line(bbl, btl, true);
    line(bbl, bbr, true);
    line(bbl, fbl, true);
    line(fbl, fbr, false);
    line(fbr, ftr, false);
    line(ftr, ftl, false);
    line(ftl, fbl, false);
    line(ftl, btl, false);
    line(btl, btr, false);
    line(btr, ftr, false);
    line(fbr, bbr, false);
    line(bbr, btr, false);

    // 原子: 奥の頂点 → 体心 → 炭素 → 手前の頂点(重なりの順)
    const rC = Math.max(rFe * 0.62, 3);
    for (const q of [bbl, bbr, btl, btr]) {
      atom(ctx, q.x, q.y, rFe, pal.matrix, pal.matrixEdge);
    }
    atom(ctx, center.x, center.y, rFe, pal.matrix, pal.matrixEdge);
    for (let k = 0; k < nCarbon; k++) {
      atom(ctx, sites[k].x, sites[k].y, rC, pal.solute, pal.soluteEdge);
    }
    for (const q of [fbl, fbr, ftl, ftr]) {
      atom(ctx, q.x, q.y, rFe, pal.matrix, pal.matrixEdge);
    }

    // 寸法(c と a)。原子の外側に引く
    const dimX = Math.round(fbl.x - rFe - 7) + 0.5;
    const dimY = Math.round(fbl.y + rFe + 7) + 0.5;
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dimX, fbl.y);
    ctx.lineTo(dimX, ftl.y);
    ctx.moveTo(dimX - 4, fbl.y);
    ctx.lineTo(dimX + 4, fbl.y);
    ctx.moveTo(dimX - 4, ftl.y);
    ctx.lineTo(dimX + 4, ftl.y);
    ctx.moveTo(fbl.x, dimY);
    ctx.lineTo(fbr.x, dimY);
    ctx.moveTo(fbl.x, dimY - 4);
    ctx.lineTo(fbl.x, dimY + 4);
    ctx.moveTo(fbr.x, dimY - 4);
    ctx.lineTo(fbr.x, dimY + 4);
    ctx.stroke();
    ctx.font = font(fs + 1, 600);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("c", dimX - 5, (fbl.y + ftl.y) / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("a", (fbl.x + fbr.x) / 2, dimY + 3);
    // 炭素が c 軸の向きに上下の鉄を押し広げることを示す小さな矢印
    if (nCarbon > 0) {
      const s0 = sites[0];
      const len = Math.max(a * 0.16, 10);
      const gapPx = rC + 4;
      ctx.strokeStyle = pal.soluteEdge;
      ctx.fillStyle = pal.soluteEdge;
      ctx.lineWidth = 1.5;
      for (const dir of [-1, 1]) {
        const y0 = s0.y + dir * gapPx;
        const y1 = s0.y + dir * (gapPx + len);
        ctx.beginPath();
        ctx.moveTo(s0.x + 14, y0);
        ctx.lineTo(s0.x + 14, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s0.x + 14, y1 + dir * 5);
        ctx.lineTo(s0.x + 10, y1);
        ctx.lineTo(s0.x + 18, y1);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 見出しと誇張の注意(常に表示 — §5.6 受け入れ基準)
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("体心正方の胞(c 軸方向の隙間に炭素)", p.x, p.y);
    plateText(
      ctx,
      pal,
      `形は ×${EXAGGERATION} に誇張(実際の c/a = ${tetragonality(carbon).toFixed(3)})`,
      p.x,
      p.y + fs + 14,
      pal.text,
      fs,
      "left",
    );
    if (nCarbon === 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = pal.text2;
      ctx.fillText(
        "炭素がないので体心立方のまま(c/a = 1)",
        p.x + p.w / 2,
        p.y + p.h - 2,
      );
    }
  }

  /* ---- 右: 炭素量と硬さ ---- */

  function drawPlot(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const left = p.x + (narrow ? 34 : 42);
    const right = p.x + p.w - 10;
    const top = p.y + fs + 18;
    const bottom = p.y + p.h - (narrow ? 32 : 36);
    const xs = makeScale(C_MIN, C_MAX, left, right);
    const ys = makeScale(0, HV_MAX, bottom, top);
    const X = (v: number): number => mapScale(xs, v);
    const Y = (v: number): number => mapScale(ys, v);

    drawAxes(ctx, pal, xs, ys, {
      xTicks: [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2],
      yTicks: [0, 200, 400, 600, 800],
      xFormat: (v) => v.toFixed(1),
      xTitle: "炭素量 [wt%]",
      yTitle: "硬さ [HV]",
      fontPx: fs,
      gridY: true,
    });

    // 徐冷(パーライト)の参考線
    ctx.beginPath();
    for (let i = 0; i <= SAMPLES; i++) {
      const cw = C_MIN + ((C_MAX - C_MIN) * i) / SAMPLES;
      const x = X(cw);
      const y = Y(slowCooledHardness(cw));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("徐冷(パーライト)", X(1.18), Y(slowCooledHardness(1.18)) - 3);

    // 100% マルテンサイト: 補間曲線と目安の点
    ctx.beginPath();
    for (let i = 0; i <= SAMPLES; i++) {
      const cw = C_MIN + ((C_MAX - C_MIN) * i) / SAMPLES;
      const x = X(cw);
      const y = Y(martensiteHardness(cw));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const [cw, hv] of MARTENSITE_HV_TABLE) {
      ctx.beginPath();
      ctx.arc(X(cw), Y(hv), 3.2, 0, TAU2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = pal.text;
      ctx.stroke();
    }
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("焼入れ(100% マルテンサイト)", X(1.18), Y(820) - 6);

    // 現在の点から横軸へ下ろす破線(ラベルの下地で隠れるよう先に描く)
    const hv = martensiteHardness(carbon);
    const px = X(carbon);
    const py = Y(hv);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, bottom);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.restore();

    // 炭素 0 のラベル。左端は急に立ち上がる 100% マルテンサイトの曲線の右、
    // 右端は徐冷の線より上に収まる位置を探す(どちらの線も右上がり)
    {
      const text = "炭素のない鉄: 焼入れても硬くならない";
      const fsz = fs - 0.5;
      ctx.font = font(fsz);
      const tw = ctx.measureText(text).width;
      const half = (fsz + 6) / 2;
      const prefer = Y(martensiteHardness(0)) - 14;
      let pos = { x: X(0) + 8, y: prefer };
      for (let off = 8; off <= 80; off += 2) {
        const xl = X(0) + off;
        const yMin = Y(martensiteHardness(unmapScale(xs, xl - 3))) + half + 3;
        const yMax =
          Y(slowCooledHardness(unmapScale(xs, xl + tw + 3))) - half - 3;
        if (yMin <= yMax) {
          pos = { x: xl, y: Math.min(Math.max(prefer, yMin), yMax) };
          break;
        }
      }
      plateText(ctx, pal, text, pos.x, pos.y, pal.text, fsz, "left");
    }

    // 現在の点
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, TAU2);
    ctx.fillStyle = pal.accent;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.bg;
    ctx.stroke();
    // 値のラベル: ふつうは点の右下。炭素が少ないと右下に炭素 0 のラベルと
    // 徐冷の線が来るので、点の真右に置く
    plateText(
      ctx,
      pal,
      `${Math.round(hv / 10) * 10} HV`,
      px + (carbon > 0.9 ? -10 : 10),
      carbon < 0.075 ? py : py + 16,
      pal.accent,
      fs + 1,
      carbon > 0.9 ? "right" : "left",
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // レイアウト前の極小キャンバスでは描かない(負の半径などを避ける)
    if (w < MIN_CANVAS_PX || h < MIN_CANVAS_PX) return;
    const l = layout();
    drawCell(l.cell, l.narrow);
    drawPlot(l.plot, l.narrow);
  }

  updateReadouts();
  host.onRender(draw);

  return {
    destroy(): void {
      /* 追加のイベントリスナーは持たない */
    },
  };
}
