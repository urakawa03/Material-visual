/**
 * vacancy-hop.ts — 図2「空孔が渡り歩く」(記事仕様書 06 §5.2)
 *
 * 左: `_shared/lattice2d.ts` の完全正方格子(rigid モード)を下敷きにした
 * サイト格子。ほとんどが A 原子(Cu)、数個が B 原子(Zn)、そして
 * **空孔は塗らずに破線の輪郭だけ**で描く(全記事共通の約束)。
 * 追跡原子(accent のリング)は空孔が隣に来たときだけ動く。
 * 右: アレニウスプロット(log D vs 1000/T)。置換型と侵入型の 2 本 + 現在点。
 *
 * 実装方式: 2D / onFrame + fixedStep。移動は約 80ms のイージング補間、
 * ×100 では補間を省略して即時表示にする。
 *
 * 簡略化(図注に明示): 2D 正方格子・空孔濃度は実際(〜10⁻⁴)より桁で多い・
 * 跳躍にエネルギー的なバイアスなし・時間は強く加速。実時間換算は
 * 「現実の空孔濃度に直したらどれだけかかるか」を表示する。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { clamp, easeOutCubic } from "../../core/mathx";
import {
  C_VACANCY_REAL,
  dInterstitial,
  dZn,
  formatDuration,
  formatSci,
  interstitialHopRate,
  vacancyHopRate,
} from "./lib/constants";
import {
  InterstitialWalkers,
  SITE_B,
  SITE_VACANCY,
  VacancyExchange,
  buildInterstitialGrid,
  buildSiteGrid,
} from "./lib/lattice";
import {
  type LatticeView,
  type Pane,
  drawAtoms,
  drawRing,
  drawVacancies,
  font,
  makeLatticeView,
  outlinedText,
  paneFrame,
  resolvePalette,
  viewX,
  viewY,
} from "./lib/draw";

/** 格子の列数と上下半分あたりの行数(合計 13 × 10 サイト) */
const COLS = 13;
const ROWS_PER_HALF = 5;
/** 空孔の個数(誇張値。図注で明示する) */
const VACANCY_COUNT = 3;
/** B 原子(Zn)の個数 */
const B_COUNT = 8;
/** 侵入型原子の個数 */
const INTERSTITIAL_COUNT = 3;
/** 乱数シード(reset で完全に同じ初期配置へ — §8.2) */
const SEED = 20470513;

/** 温度スライダー(§5.2: 600〜1300 K・step 10・初期 900) */
const TEMP_MIN = 600;
const TEMP_MAX = 1300;
const TEMP_STEP = 10;
const TEMP_INIT = 900;

type Mechanism = "sub" | "inter";
const MECH_INIT: Mechanism = "sub";

type SpeedValue = "1" | "10" | "100";
const SPEED_INIT: SpeedValue = "10";
/**
 * この倍率以上では補間を省略して即時表示する。×10 以上で補間を切るのは、
 * 同時に何十個も飛行中の原子が描かれて格子が崩れて見えるのを避けるため
 * (原子どうしは同じ色なので、補間を切っても「空孔が動く」ように見える)。
 */
const ANIM_SKIP_MULT = 10;
/** 侵入型は画面上のレートを置換型の 3 倍に抑える(図注で明示 — §5.2) */
const INTER_SCREEN_MULT = 3;

/**
 * MC の固定タイムステップ [ms]。×1 で 1 秒あたり約 6 ステップとし、
 * 空孔 1 個ぶんの跳躍を目で追えるようにする(§5.2 の受け入れ基準)。
 */
const STEP_MS = 160;
/** サイト間移動のイージング補間の所要時間 [s] */
const HOP_ANIM_S = 0.08;
/** 原子の半径(格子間隔に対する割合) */
const ATOM_RADIUS_RATIO = 0.34;
/** 侵入型原子は母相原子の 0.5 倍 */
const INTER_RADIUS_RATIO = 0.5 * ATOM_RADIUS_RATIO;

export default function vacancyHop(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  const grid = buildSiteGrid(COLS, ROWS_PER_HALF);
  const interGrid = buildInterstitialGrid(grid);
  const exchange = new VacancyExchange(grid, VACANCY_COUNT, B_COUNT, SEED);
  const walkers = new InterstitialWalkers(
    interGrid,
    INTERSTITIAL_COUNT,
    SEED + 7,
  );

  /** 描画バッファ(毎フレームの割当てを避ける — §8.3) */
  const bufAX = new Float64Array(grid.count);
  const bufAY = new Float64Array(grid.count);
  const bufBX = new Float64Array(B_COUNT);
  const bufBY = new Float64Array(B_COUNT);
  const bufVX = new Float64Array(VACANCY_COUNT);
  const bufVY = new Float64Array(VACANCY_COUNT);
  const bufIX = new Float64Array(INTERSTITIAL_COUNT);
  const bufIY = new Float64Array(INTERSTITIAL_COUNT);

  let tempK = TEMP_INIT;
  let mechanism: Mechanism = MECH_INIT;
  let speedMult = Number(SPEED_INIT);
  /** シミュレーション内の経過時間 [s](実時間換算・表示のみ) */
  let simTime = 0;

  /**
   * 1 MC ステップに対応する現実の時間 [s]。
   * 置換型: 画面の空孔は誇張されているので、現実の空孔濃度 C_V に直して
   * 換算する(空孔 n 個が 1 回跳ぶ時間 = n / (C_V · N_site · Γ))。
   * 侵入型: 空孔を待たないので 1 ステップ = 1/Γ_i。
   */
  function secondsPerStep(): number {
    if (mechanism === "inter") return 1 / interstitialHopRate(tempK);
    return (
      VACANCY_COUNT / (C_VACANCY_REAL * grid.count * vacancyHopRate(tempK))
    );
  }

  function resetSim(): void {
    exchange.init();
    walkers.init();
    simTime = 0;
  }

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "temp",
    label: "温度 T",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "K",
  });
  tempSlider.onChange((v) => {
    // T の変更で配置はリセットしない(温度の効きは読み出しと換算時間に出る)
    tempK = v;
  });

  const mechSeg = host.controls.segmented<Mechanism>({
    id: "mech",
    label: "機構",
    options: [
      { value: "sub", label: "置換型(空孔)" },
      { value: "inter", label: "侵入型(C・N)" },
    ],
    value: MECH_INIT,
  });
  mechSeg.onChange((v) => {
    mechanism = v;
  });

  const speedSeg = host.controls.segmented<SpeedValue>({
    id: "speed",
    label: "時間の進み",
    options: [
      { value: "1", label: "×1" },
      { value: "10", label: "×10" },
      { value: "100", label: "×100" },
    ],
    value: SPEED_INIT,
  });
  speedSeg.onChange((v) => {
    speedMult = Number(v);
  });

  host.controls.playPause();
  host.controls.reset(() => {
    tempSlider.set(TEMP_INIT);
    mechSeg.set(MECH_INIT);
    speedSeg.set(SPEED_INIT);
    resetSim();
  });

  /* ---- レイアウト ---- */

  function layout(): { stage: Pane; plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 620;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const plotH = Math.max(96, h * 0.32);
      return {
        stage: { x: pad, y: pad, w: w - 2 * pad, h: h - plotH - 3 * pad },
        plot: { x: pad, y: h - plotH - pad, w: w - 2 * pad, h: plotH },
        narrow,
      };
    }
    const plotW = Math.max(210, Math.min(300, w * 0.38));
    return {
      stage: { x: pad, y: pad, w: w - plotW - 3 * pad, h: h - 2 * pad },
      plot: { x: w - plotW - pad, y: pad, w: plotW, h: h - 2 * pad },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  /** サイト s の表示位置(補間込み)を out に書き込む */
  function sitePos(
    view: LatticeView,
    site: number,
    fromSite: number,
    hopT: number,
    out: { x: number; y: number },
  ): void {
    let lx = grid.px[site];
    let ly = grid.py[site];
    if (fromSite >= 0 && hopT < HOP_ANIM_S) {
      const e = easeOutCubic(hopT / HOP_ANIM_S);
      lx = grid.px[fromSite] + (lx - grid.px[fromSite]) * e;
      ly = grid.py[fromSite] + (ly - grid.py[fromSite]) * e;
    }
    out.x = viewX(view, lx);
    out.y = viewY(view, ly);
  }

  const tmp = { x: 0, y: 0 };

  function drawStage(p: Pane, narrow: boolean): void {
    paneFrame(ctx, p, pal.hairline);
    const view = makeLatticeView(
      p.x,
      p.y,
      p.w,
      p.h - (narrow ? 4 : 16),
      COLS + 0.8,
      ROWS_PER_HALF * 2 + 1.4,
    );
    const r = ATOM_RADIUS_RATIO * view.scale;

    // 隙間のサイト網(侵入型の通り道)を薄く示す
    if (mechanism === "inter") {
      ctx.fillStyle = pal.hairline;
      ctx.beginPath();
      for (let i = 0; i < interGrid.count; i++) {
        const x = viewX(view, interGrid.px[i]);
        const y = viewY(view, interGrid.py[i]);
        ctx.moveTo(x + 1.2, y);
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // 占有ごとに分類して 1 パスずつ描く(§8.3)
    let na = 0;
    let nb = 0;
    let nv = 0;
    for (let s = 0; s < grid.count; s++) {
      const occ = exchange.occupancy[s];
      sitePos(view, s, exchange.fromSite[s], exchange.hopT[s], tmp);
      if (occ === SITE_VACANCY) {
        bufVX[nv] = tmp.x;
        bufVY[nv] = tmp.y;
        nv++;
      } else if (occ === SITE_B) {
        bufBX[nb] = tmp.x;
        bufBY[nb] = tmp.y;
        nb++;
      } else {
        bufAX[na] = tmp.x;
        bufAY[na] = tmp.y;
        na++;
      }
    }
    drawAtoms(ctx, bufAX, bufAY, na, r, pal.matrix, pal.matrixEdge);
    drawAtoms(ctx, bufBX, bufBY, nb, r, pal.second, pal.secondEdge);
    // 空孔: 塗りなし + --mat-matrix の破線縁(依頼文 §4)
    drawVacancies(ctx, bufVX, bufVY, nv, r, pal.matrixEdge);

    // 侵入型原子
    if (mechanism === "inter") {
      for (let i = 0; i < INTERSTITIAL_COUNT; i++) {
        let lx = interGrid.px[walkers.site[i]];
        let ly = interGrid.py[walkers.site[i]];
        const f = walkers.fromSite[i];
        if (f >= 0 && walkers.hopT[i] < HOP_ANIM_S) {
          const e = easeOutCubic(walkers.hopT[i] / HOP_ANIM_S);
          lx = interGrid.px[f] + (lx - interGrid.px[f]) * e;
          ly = interGrid.py[f] + (ly - interGrid.py[f]) * e;
        }
        bufIX[i] = viewX(view, lx);
        bufIY[i] = viewY(view, ly);
      }
      drawAtoms(
        ctx,
        bufIX,
        bufIY,
        INTERSTITIAL_COUNT,
        Math.max(INTER_RADIUS_RATIO * view.scale, 2),
        pal.solute,
        pal.soluteEdge,
      );
    }

    // 追跡原子のリング(置換型のときだけ意味があるので常に表示する)
    sitePos(
      view,
      exchange.trackedSite,
      exchange.fromSite[exchange.trackedSite],
      exchange.hopT[exchange.trackedSite],
      tmp,
    );
    drawRing(ctx, tmp.x, tmp.y, r + 3.5, pal.accent);

    // ラベル
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const label =
      mechanism === "sub"
        ? "◯ 追跡する原子(空孔が隣に来たときだけ動く)"
        : "◯ 追跡する置換型原子(いまは動けない)/ 小さな点 = 侵入型原子";
    outlinedText(ctx, label, p.x + 6, p.y + 5, pal.text2, pal.bg);
    ctx.textBaseline = "bottom";
    outlinedText(
      ctx,
      `破線の円 = 空孔(${VACANCY_COUNT} 個。実際の濃度より桁で多く描いている)`,
      p.x + 6,
      p.y + p.h - 5,
      pal.text2,
      pal.bg,
    );
  }

  function drawPlot(p: Pane): void {
    // 読み出しはパネル上部に積み、プロットはその下に置く(重ならないように)
    const compact = p.h < 240;
    const readoutLines = compact ? 3 : 5;
    const lineH = compact ? 12.5 : 13.5;
    const readoutTop = p.y + 20;
    const axisX = p.x + 34;
    const axisY = p.y + p.h - 30;
    const yTop = readoutTop + readoutLines * lineH + 10;
    const plotW = p.x + p.w - 10 - axisX;
    // 横軸 1000/T [1/K]、縦軸 log10 D
    const invMin = 1000 / TEMP_MAX;
    const invMax = 1000 / TEMP_MIN;
    const logMin = -22;
    const logMax = -9;
    const mapX = (inv: number): number =>
      axisX + ((inv - invMin) / (invMax - invMin)) * plotW;
    const mapY = (logD: number): number =>
      axisY - ((logD - logMin) / (logMax - logMin)) * (axisY - yTop);

    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("拡散係数 D(アレニウスプロット)", p.x + 2, p.y + 4);

    // 軸
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, yTop);
    ctx.lineTo(axisX + 0.5, axisY + 0.5);
    ctx.lineTo(axisX + plotW, axisY + 0.5);
    ctx.stroke();
    ctx.font = font(10);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let e = logMin; e <= logMax; e += 3) {
      const y = mapY(e);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(`10${superscript(e)}`, axisX - 5, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of [1300, 1000, 800, 600]) {
      const x = mapX(1000 / t);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, axisY + 0.5);
      ctx.lineTo(x + 0.5, axisY + 4);
      ctx.stroke();
      ctx.fillText(`${t}`, x, axisY + 6);
    }
    ctx.fillText("温度 T [K](横軸は 1000/T)", axisX + plotW / 2, axisY + 18);

    // 2 本の直線(アレニウス式は log D が 1/T の直線になる)
    const drawLine = (
      f: (t: number) => number,
      color: string,
      label: string,
      labelAt: number,
    ): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const inv = invMin + ((invMax - invMin) * k) / 40;
        const t = 1000 / inv;
        const x = mapX(inv);
        const y = mapY(clamp(Math.log10(f(t)), logMin, logMax));
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.font = font(10.5);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const lx = mapX(invMin + (invMax - invMin) * labelAt);
      const ly = mapY(
        clamp(
          Math.log10(f(1000 / (invMin + (invMax - invMin) * labelAt))),
          logMin,
          logMax,
        ),
      );
      outlinedText(ctx, label, lx, ly - 4, color, pal.bg);
    };
    drawLine(dInterstitial, pal.solute, "侵入型(C)", 0.62);
    drawLine(dZn, pal.second, "置換型(Zn)", 0.62);

    // 現在点
    const dNow = mechanism === "inter" ? dInterstitial(tempK) : dZn(tempK);
    const cx = mapX(1000 / tempK);
    const cy = mapY(clamp(Math.log10(dNow), logMin, logMax));
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = mechanism === "inter" ? pal.solute : pal.second;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.bg;
    ctx.stroke();

    // 読み出し
    const gamma =
      mechanism === "inter"
        ? interstitialHopRate(tempK)
        : vacancyHopRate(tempK);
    const ratio = dInterstitial(tempK) / dZn(tempK);
    const lines = [
      `D = ${formatSci(dNow)} m²/s`,
      `跳躍頻度 Γ = ${formatSci(gamma)} 1/s`,
      `経過: ${formatDuration(simTime)}(${Math.round(tempK)} K 換算)`,
      `侵入型は置換型の約 ${formatSci(ratio, 0)} 倍速い`,
      mechanism === "sub"
        ? `追跡原子が動いた回数: ${exchange.trackedHops}`
        : "侵入型は空孔を待たない",
    ];
    ctx.font = font(compact ? 10.5 : 11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let i = 0; i < readoutLines; i++) {
      ctx.fillStyle = i === 0 ? pal.text : pal.text2;
      ctx.fillText(lines[i], p.x + 2, readoutTop + i * lineH);
    }
  }

  /** 指数を上付き文字にする(10⁻¹⁴ の表示用) */
  function superscript(e: number): string {
    const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
    const digits = String(Math.abs(e))
      .split("")
      .map((d) => SUP[Number(d)])
      .join("");
    return `${e < 0 ? "⁻" : ""}${digits}`;
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawStage(l.stage, l.narrow);
    drawPlot(l.plot);
  }

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    exchange.advanceAnimation(dt, HOP_ANIM_S);
    walkers.advanceAnimation(dt, HOP_ANIM_S);
    stepper(dt, () => {
      const animate = speedMult < ANIM_SKIP_MULT;
      if (mechanism === "sub") {
        for (let s = 0; s < speedMult; s++) exchange.step(animate);
        simTime += speedMult * secondsPerStep();
      } else {
        const steps = speedMult * INTER_SCREEN_MULT;
        for (let s = 0; s < steps; s++) walkers.step(animate);
        simTime += steps * secondsPerStep();
      }
    });
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
