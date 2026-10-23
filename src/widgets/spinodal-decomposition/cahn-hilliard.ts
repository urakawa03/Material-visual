/**
 * cahn-hilliard.ts — 図6「迷路が育つ — カーン・ヒリアード」(中心図版)
 * (記事仕様書 09 §5.6)
 *
 * 主領域: 128² の濃度場(--mat-matrix ↔ --mat-second の 2 色補間)。
 * 右上: 状態図の縮小版と現在の状態点(図3 と同じ線)。
 * 右下: 濃度場の散乱強度 S(k)(放射方向に平均)と、予測の k_m の縦線。
 * 準安定の領域では「核を置く」モード(ボタンで中央に / 画面をクリックした
 * 位置に、半径スライダーの大きさの B リッチの円を置く)。置いた核の輪郭を
 * --color-accent の輪でしばらく示し、その後の運命(溶ける / 育つ)を見せる。
 *
 * 組成・温度を変えたら、その条件の一様な初期状態(+ シード固定のゆらぎ)から
 * やり直す。核の B は円の外の母相から一様に集めたものとし、平均組成は
 * 保存される(lib/cahnhilliard.ts の addDisk)。
 *
 * 数値: 半陰的フーリエ・スペクトル法(Δt = 0.5 固定、線形段階だけ細かく —
 * lib/cahnhilliard.ts)。1 フレームの計算は 8 ms 以内に収まるようステップ数を
 * 自動で減らし、1 ステップでも超える端末では格子を 64² に縮小する。
 * 散乱強度と自由エネルギーの計算は 10 フレームに 1 回。
 *
 * 簡略化(図注): 2 次元の計算(3 次元の組織の断面ではない)、弾性ひずみなし、
 * 熱ゆらぎなし(準安定域で自然に核ができないのはこのため — 核は読者が置く)、
 * 長さ・時間は無次元。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { setControlEnabled } from "../kirkendall-effect/lib/draw";
import {
  CahnHilliard,
  DT,
  earlyDt,
  linearStageDuration,
} from "./lib/cahnhilliard";
import { StepBudget } from "./lib/budget";
import {
  type Axes,
  FieldImage,
  axX,
  axY,
  drawAxisLines,
  drawDomes,
  drawStateRing,
  fmtFixed,
  fmtSig,
  font,
  resolvePalette,
} from "./lib/draw";
import {
  type Region,
  binodal,
  chiFromT,
  fastestK,
  regionAt,
  sliderToTOverTc,
} from "./lib/regular";

/** 格子(2 のべき乗。遅い端末では FALLBACK_N に縮小) */
const GRID_N = 128;
const FALLBACK_N = 64;
/** 初期のゆらぎの振幅とシード(§5.6) */
const NOISE = 0.01;
const SEED = 20261023;
/** 1 フレームのステップ数(§5.0: 図6 は 4) */
const STEPS_PER_FRAME = 4;
/**
 * 準安定・安定の領域でのステップ数。置いた核が溶ける(約時間 50〜100)
 * 様子が 1 秒ほどかけて見えるように、不安定の領域より遅く回す
 */
const STEPS_PER_FRAME_SLOW = 2;
/** 「模様がある」とみなす濃度の分散(標準偏差 0.02)。それ未満は初期のゆらぎだけ */
const PATTERN_VARIANCE = 4e-4;
/** 散乱強度・自由エネルギーを計算する間隔 [フレーム] */
const ANALYSIS_EVERY = 10;
/** 組成・温度・核の半径のスライダー(§5.6。組成の下限は本文の注を参照) */
const C_MIN = 0.1;
const C_MAX = 0.9;
const C_INIT = 0.5;
const T_INIT = 0.67;
const R_MIN = 2;
const R_MAX = 14;
const R_INIT = 8;
/** 縮小した格子で置ける核の半径の上限(母相の B を枯らさないため) */
const R_MAX_FALLBACK = 7;
/** 置いた核の目印の輪を見せる時間 [s](再生中に薄れていく) */
const RING_SECONDS = 1.6;
/** 散乱強度のグラフの波数の上限 */
const SK_K_MAX = 1.6;

const REGION_TEXT: Record<Region, string> = {
  stable: "安定",
  metastable: "準安定",
  unstable: "不安定",
};

const HEADER_TEXT: Record<Region, string> = {
  unstable: "不安定: どんな小さなゆらぎも育つ(核は要らない)",
  metastable: "準安定: ゆらぎは育たない — 核を置いてみよう",
  stable: "安定: 混ざったまま(ゆらぎは消える)",
};

interface Ring {
  x: number;
  y: number;
  r: number;
  age: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function cahnHilliard(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const field = new FieldImage(pal.matrix, pal.second);
  const budget = new StepBudget();

  let n = GRID_N;
  let sim = new CahnHilliard({ nx: n, ny: n, chi: 3 });
  let sk = new Float64Array(n / 2);
  let skCount = new Float64Array(n / 2);

  let c0 = C_INIT;
  let tSlider = T_INIT;
  let radius = R_INIT;
  let chi = chiFromT(sliderToTOverTc(T_INIT));
  let region: Region = regionAt(c0, chi);
  let tLinear = 0;
  let f0 = 0;
  let fNow = 0;
  let lengthL = NaN;
  let frame = 0;
  const rings: Ring[] = [];

  /* ---- 読み取り値(§5.6) ---- */
  const readout = createReadout(host);
  const roRegion = readout.item("領域");
  const roTime = readout.item("経過時間");
  const roL = readout.item("代表長さ L");
  const roLm = readout.item("予測 λm");
  const roF = readout.item("自由エネルギーの減少");

  /* ---- 操作部品 ---- */
  const cCtl = host.controls.slider({
    id: "c0",
    label: "組成 c₀",
    min: C_MIN,
    max: C_MAX,
    step: 0.01,
    value: C_INIT,
  });
  const tCtl = host.controls.slider({
    id: "t",
    label: "温度 T/Tc",
    min: 0.5,
    max: 1.1,
    step: 0.01,
    value: T_INIT,
  });
  const rCtl = host.controls.slider({
    id: "r",
    label: "核の半径",
    min: R_MIN,
    max: R_MAX,
    step: 1,
    value: R_INIT,
    unit: "格子",
  });
  const placeBtn = host.controls.button({ label: "核を置く" });
  host.controls.playPause();
  host.controls.reset(() => {
    cCtl.set(C_INIT);
    tCtl.set(T_INIT);
    rCtl.set(R_INIT);
    restart();
    host.setPlaying(false);
  });

  cCtl.onChange((v) => {
    c0 = v;
    restart();
  });
  tCtl.onChange((v) => {
    tSlider = v;
    restart();
  });
  rCtl.onChange((v) => {
    radius = v;
  });
  placeBtn.onClick(() => {
    placeNucleus(n / 2, n / 2);
  });

  /** その条件の一様な初期状態(+ シード固定のゆらぎ)からやり直す */
  function restart(): void {
    chi = chiFromT(sliderToTOverTc(tSlider));
    region = regionAt(c0, chi);
    sim.setChi(chi);
    sim.initUniform(c0, NOISE, SEED);
    tLinear = linearStageDuration(c0, chi, sim.kappa);
    f0 = sim.freeEnergy();
    fNow = f0;
    lengthL = NaN;
    rings.length = 0;
    analyze();
    syncControls();
  }

  function syncControls(): void {
    const meta = region === "metastable";
    setControlEnabled(rCtl.el, meta);
    placeBtn.el.disabled = !meta;
    placeBtn.el.setAttribute("aria-disabled", meta ? "false" : "true");
    // 無効のボタンも行と同じ薄さに(controls.css の .ctl.is-disabled と揃える)
    placeBtn.el.style.opacity = meta ? "" : "0.45";
    placeBtn.el.style.cursor = meta ? "" : "default";
  }

  /** 格子座標 (cx, cy) に B リッチの核を置く(準安定のときのみ) */
  function placeNucleus(cx: number, cy: number): void {
    if (region !== "metastable") return;
    const r = n < GRID_N ? Math.min(radius, R_MAX_FALLBACK) : radius;
    sim.addDisk(cx, cy, r, 1 - binodal(chi), true);
    rings.push({ x: cx, y: cy, r, age: 0 });
    if (rings.length > 8) rings.shift();
    analyze();
    if (!prefersReducedMotion()) host.setPlaying(true);
    host.requestRender();
  }

  /** 散乱強度・代表長さ・自由エネルギー(10 フレームに 1 回) */
  function analyze(): void {
    sim.radialStructureFactor(sk, skCount);
    lengthL = sim.characteristicLength();
    fNow = sim.freeEnergy();
  }

  /** 遅い端末: 格子を縮小してやり直す */
  function shrinkGrid(): void {
    n = FALLBACK_N;
    sim = new CahnHilliard({ nx: n, ny: n, chi });
    sk = new Float64Array(n / 2);
    skCount = new Float64Array(n / 2);
    budget.reset(0.25);
    restart();
  }

  /* ---- レイアウト ---- */
  interface Layout {
    narrow: boolean;
    headerY: number;
    fx: number;
    fy: number;
    side: number;
    diagram: Axes;
    skPlot: Axes;
  }
  let layoutCache: Layout | null = null;

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560 || w < h * 1.15;
    const pad = narrow ? 8 : 12;
    const headerH = narrow ? 20 : 24;
    if (!narrow) {
      const side = Math.min(h - 2 * pad - headerH, w * 0.62);
      const fx = pad;
      const fy = pad + headerH;
      const rx = fx + side + 46;
      const rw = w - rx - pad;
      const colTop = fy + 16;
      const colH = h - pad - colTop;
      const diagH = colH * 0.46;
      return {
        narrow,
        headerY: pad,
        fx,
        fy,
        side,
        diagram: {
          x: rx,
          y: colTop,
          w: rw,
          h: diagH - 30,
          xMin: 0,
          xMax: 1,
          yMin: 0.45,
          yMax: 1.12,
        },
        skPlot: {
          x: rx,
          y: colTop + diagH + 18,
          w: rw,
          h: colH - diagH - 18 - 30,
          xMin: 0,
          xMax: SK_K_MAX,
          yMin: 0,
          yMax: 1.12,
        },
      };
    }
    const side = Math.min(w - 2 * pad, h * 0.6);
    const fx = (w - side) / 2;
    const fy = pad + headerH;
    const bottomTop = fy + side + 22;
    const bottomH = h - bottomTop - 26;
    const colW = (w - 2 * pad - 36) / 2;
    return {
      narrow,
      headerY: pad,
      fx,
      fy,
      side,
      diagram: {
        x: pad + 26,
        y: bottomTop,
        w: colW - 12,
        h: bottomH,
        xMin: 0,
        xMax: 1,
        yMin: 0.45,
        yMax: 1.12,
      },
      skPlot: {
        x: pad + 26 + colW + 22,
        y: bottomTop,
        w: colW - 12,
        h: bottomH,
        xMin: 0,
        xMax: SK_K_MAX,
        yMin: 0,
        yMax: 1.12,
      },
    };
  }

  /* ---- 画面クリックで核を置く ---- */
  function onPointerDown(e: PointerEvent): void {
    const L = layoutCache;
    if (!L || region !== "metastable") return;
    const rect = host.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < L.fx || px > L.fx + L.side || py < L.fy || py > L.fy + L.side)
      return;
    e.preventDefault();
    placeNucleus(((px - L.fx) / L.side) * n, ((py - L.fy) / L.side) * n);
  }
  host.canvas.addEventListener("pointerdown", onPointerDown);

  /* ---- 描画 ---- */
  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout();
    layoutCache = L;

    // 見出し(領域の案内)
    ctx.font = font(L.narrow ? 12 : 13.5, 600);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = region === "metastable" ? pal.accent : pal.text;
    ctx.fillText(HEADER_TEXT[region], L.fx, L.headerY);

    // 濃度場
    field.update(sim.c, n);
    field.draw(ctx, L.fx, L.fy, L.side);
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(L.fx - 0.5, L.fy - 0.5, L.side + 1, L.side + 1);
    drawRings(L);
    drawScaleBar(L);

    drawDiagram(L);
    drawSk(L);

    // 読み取り値
    const km = fastestK(c0, chi, sim.kappa);
    roRegion.set(
      `${REGION_TEXT[region]}(c₀ = ${fmtFixed(c0, 2)}, T/Tc = ${fmtFixed(tSlider, 2)})`,
    );
    roTime.set(fmtSig(sim.time, 3));
    roL.set(
      Number.isFinite(lengthL) && patterned()
        ? `${fmtSig(lengthL, 3)} 格子`
        : "—(模様なし)",
    );
    roLm.set(
      Number.isFinite(km)
        ? `${fmtSig((2 * Math.PI) / km, 3)} 格子`
        : "—(育つ波なし)",
    );
    roF.set(`${formatEnergy(f0 - fNow)} RT/格子点`);
  }

  /** 初期のゆらぎより十分大きな濃度の模様があるか */
  function patterned(): boolean {
    return sim.variance() > PATTERN_VARIANCE;
  }

  /** 自由エネルギーの変化(小数 4 桁。負号は「−」) */
  function formatEnergy(v: number): string {
    if (Math.abs(v) < 5e-5) return "0.0000";
    return (v < 0 ? "−" : "") + Math.abs(v).toFixed(4);
  }

  function drawRings(L: Layout): void {
    const scale = L.side / n;
    for (const ring of rings) {
      const alpha = clamp(1 - ring.age / RING_SECONDS, 0, 1);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(
        L.fx + (ring.x + 0.5) * scale,
        L.fy + (ring.y + 0.5) * scale,
        ring.r * scale,
        0,
        Math.PI * 2,
      );
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.accent;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** 予測の特性波長 λm の長さの目盛り(不安定のときだけ) */
  function drawScaleBar(L: Layout): void {
    const km = fastestK(c0, chi, sim.kappa);
    if (!Number.isFinite(km)) return;
    const lambda = (2 * Math.PI) / km;
    const len = (lambda / n) * L.side;
    if (len > L.side * 0.6) return;
    const x0 = L.fx + 10;
    const y0 = L.fy + L.side - 12;
    ctx.fillStyle = pal.bg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x0 - 5, y0 - 21, Math.max(len, 96) + 10, 28);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 4);
    ctx.lineTo(x0, y0 + 4);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.moveTo(x0 + len, y0 - 4);
    ctx.lineTo(x0 + len, y0 + 4);
    ctx.stroke();
    ctx.font = font(11);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`予測 λm = ${fmtSig(lambda, 3)} 格子`, x0, y0 - 6);
  }

  function drawDiagram(L: Layout): void {
    const a = L.diagram;
    ctx.font = font(11.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("状態図と状態点", a.x - 26, a.y - 4);
    drawAxisLines(ctx, a, pal);
    drawDomes(ctx, a, pal, 1.75);
    ctx.font = font(10);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of [0, 0.5, 1])
      ctx.fillText(fmtFixed(v, 1), axX(a, v), a.y + a.h + 4);
    ctx.fillText("組成 X", a.x + a.w / 2, a.y + a.h + 16);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [0.5, 1]) ctx.fillText(fmtFixed(v, 1), a.x - 4, axY(a, v));
    ctx.save();
    ctx.translate(a.x - 18, a.y + a.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("T/Tc", 0, 0);
    ctx.restore();
    drawStateRing(ctx, axX(a, c0), axY(a, sliderToTOverTc(tSlider)), pal, 5.5);
  }

  function drawSk(L: Layout): void {
    const a = L.skPlot;
    ctx.font = font(11.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("散乱強度 S(k)(放射方向に平均)", a.x - 26, a.y - 4);
    drawAxisLines(ctx, a, pal);
    ctx.font = font(10);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of [0, 0.5, 1, 1.5])
      ctx.fillText(fmtFixed(v, 1), axX(a, v), a.y + a.h + 4);
    ctx.fillText("波数 k", a.x + a.w / 2, a.y + a.h + 16);

    // 予測の k_m
    const km = fastestK(c0, chi, sim.kappa);
    if (Number.isFinite(km) && km < SK_K_MAX) {
      const px = axX(a, km);
      ctx.save();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, a.y);
      ctx.lineTo(px, a.y + a.h);
      ctx.stroke();
      ctx.restore();
      ctx.font = font(10.5);
      ctx.fillStyle = pal.accent;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("予測 km", px + 4, a.y + 2);
    }

    // 散乱強度(最大で規格化)
    const nb = sk.length;
    let sMax = 0;
    for (let b = 1; b < nb; b++) {
      const k = (2 * Math.PI * b) / n;
      if (k > SK_K_MAX) break;
      if (sk[b] > sMax) sMax = sk[b];
    }
    if (sMax <= 0 || !patterned()) {
      ctx.font = font(10.5);
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("模様なし(小さなゆらぎだけ)", a.x + a.w / 2, a.y + a.h / 2);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(axX(a, 0), axY(a, 0));
    for (let b = 1; b < nb; b++) {
      const k = (2 * Math.PI * b) / n;
      if (k > SK_K_MAX + 0.1) break;
      ctx.lineTo(axX(a, k), axY(a, sk[b] / sMax));
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.second;
    ctx.stroke();
    ctx.restore();
  }

  /* ---- フレームループ ---- */
  host.onFrame((dt) => {
    const steps = budget.steps(
      region === "unstable" ? STEPS_PER_FRAME : STEPS_PER_FRAME_SLOW,
    );
    const t0 = performance.now();
    for (let s = 0; s < steps; s++) {
      sim.setDt(sim.time < tLinear - 1e-9 ? earlyDt(sim.A) : DT);
      sim.step(1);
    }
    budget.record(steps, performance.now() - t0);
    if (n === GRID_N && budget.overBudget()) shrinkGrid();
    for (const ring of rings) ring.age += dt;
    frame++;
    if (frame % ANALYSIS_EVERY === 0) analyze();
    draw();
  });
  host.onRender(draw);

  restart();
  host.setPlaying(false);

  return {
    resize(): void {
      host.requestRender();
    },
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
