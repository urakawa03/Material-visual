/**
 * intrinsic-carriers.ts — 図4「生成と再結合」(仕様書 12 §5.4)
 *
 * 左(主領域): 横軸を結晶内の位置、縦軸をエネルギーに取ったバンド図。
 * 価電子帯は電子の丸を格子状に敷き詰めて「満席」を表す(背景として 1 回だけ
 * 描いたオフスクリーン画像を使い回す)。熱で価電子帯の電子が伝導帯へ縦に
 * 跳び(生成)、跡に正孔が残る。同じ位置で電子と正孔が出会うと、電子が
 * 価電子帯へ落ちて両方消える(再結合)。
 * 右(幅 38%、狭幅では下): 測定グラフ。「この条件を記録」で時間平均を点として
 * 打ち、3 点以上たまったら傾き −1/2 に固定した直線を切片だけ合わせて重ねる。
 *
 * モデルは lib/genrec.ts の GenRecSim(シード固定)。n = p ∝ e^{−x/2}
 * (x = E_g/k_BT)の「2」は、生成 ∝ e^{−x} と再結合 ∝ n·p = n² のつり合いから
 * 来る。
 *
 * 誠実な簡略化(図注に明示): 温度の代わりに比 E_g/k_BT を動かしている(実際の
 * Si は 43)。位置は 1 次元・時間は加速。正孔は空席の集団的なふるまいを粒子と
 * して描いたもの。実際の Si の再結合は多くが欠陥を介する。
 *
 * 実装方式: 2D Canvas / onFrame(連続)+ fixedStep(1/60 秒)。画面外・タブ
 * 非表示で停止(engine)。省モーション時は自動再生せず、内部で 3000 ステップ
 * 進めた定常状態の静止フレームを表示する。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { smoothstep } from "../../core/mathx";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawBandBox,
  drawElectronDots,
  drawPlotFrame,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import {
  AUX_BORN,
  AUX_JITTER,
  fitInterceptFixedSlope,
  fitLogSlope,
  GENREC_DT,
  GenRecSim,
  JUMP_SECONDS,
  MAX_CARRIERS,
} from "./lib/genrec";
import {
  drawFermiLine,
  drawLabel,
  drawSplitDivider,
  fermiColors,
  insertNote,
  splitByFraction,
} from "./lib/draw";

/** ギャップと熱の比のスライダー(§5.4 の表) */
const RATIO_MIN = 4;
const RATIO_MAX = 12;
const RATIO_STEP = 0.5;
const RATIO_INIT = 5;
/** 平均が数個以下になり時間平均が揺らぐ比(注記を出す) */
const RATIO_NOISY = 10;
/** バンド図の縦軸(E_v = 0・E_c = 1 に規格化した模式) */
const E_MIN = -1;
const E_MAX = 2;
const EV = 0;
const EC = 1;
/** キャリアを描く高さ: バンド端から内側へ BASE + SPREAD·ばらつき */
const DOT_BASE = 0.1;
const DOT_SPREAD = 0.55;
/** 測定グラフの縦軸(log₁₀ の平均キャリア数)と横軸 */
const LOG_MIN = -1;
const LOG_MAX = 2;
const X_PAD = 0.4;
/** 記録できる点の上限 */
const MAX_POINTS = 40;
/** 理論直線の傾き(自然対数で −1/2) */
const THEORY_SLOPE = -0.5;
/** 理論直線を重ねるのに必要な点の数 */
const MIN_POINTS_FOR_FIT = 3;
const NARROW_WIDTH_PX = 480;
/** 価電子帯の「満席」の丸の間隔と半径(px) */
const SEA_SPACING = 11;
const SEA_RADIUS = 2.1;

const RATIO_TICKS: readonly AxisTick[] = [4, 6, 8, 10, 12].map((v) => ({
  value: v,
  label: String(v),
}));
const COUNT_TICKS: readonly AxisTick[] = [
  { value: -1, label: "0.1" },
  { value: 0, label: "1" },
  { value: 1, label: "10" },
  { value: 2, label: "100" },
];
const BAND_TICKS: readonly AxisTick[] = [
  { value: EV, label: "E_v" },
  { value: EC, label: "E_c" },
];

/** 伝導帯の電子を描く高さ */
function electronLevel(jitter: number): number {
  return EC + DOT_BASE + DOT_SPREAD * jitter;
}
/** 価電子帯の正孔を描く高さ */
function holeLevel(jitter: number): number {
  return EV - DOT_BASE - DOT_SPREAD * jitter;
}

export default function intrinsicCarriers(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = fermiColors();
  const band = createPlotMapper();
  const graph = createPlotMapper();

  /* ---- 状態 ---- */
  const sim = new GenRecSim(undefined, RATIO_INIT);
  const pointX = new Float64Array(MAX_POINTS);
  const pointY = new Float64Array(MAX_POINTS);
  let pointCount = 0;
  let fitIntercept = NaN;
  let fitSlope = NaN;

  /* ---- 使い回す描画バッファ(電子・正孔 + 再結合中の 1 組ずつ) ---- */
  const capacity = MAX_CARRIERS + 64;
  const ex = new Float64Array(capacity);
  const ey = new Float64Array(capacity);
  const hx = new Float64Array(capacity);
  const hy = new Float64Array(capacity);

  /* ---- 価電子帯の「満席」(オフスクリーンに 1 回だけ描いて使い回す) ---- */
  const sea = document.createElement("canvas");
  const seaCtx = sea.getContext("2d");
  let seaW = 0;
  let seaH = 0;
  let seaDpr = 0;

  function renderSea(w: number, h: number, dpr: number): void {
    if (!seaCtx) return;
    if (w === seaW && h === seaH && dpr === seaDpr) return;
    seaW = w;
    seaH = h;
    seaDpr = dpr;
    sea.width = Math.max(1, Math.round(w * dpr));
    sea.height = Math.max(1, Math.round(h * dpr));
    seaCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seaCtx.clearRect(0, 0, w, h);
    seaCtx.fillStyle = colors.electron;
    seaCtx.globalAlpha = 0.45;
    seaCtx.beginPath();
    for (let y = SEA_SPACING * 0.5; y < h; y += SEA_SPACING) {
      const row = Math.round(y / SEA_SPACING);
      const offset = row % 2 === 0 ? 0 : SEA_SPACING / 2;
      for (let x = SEA_SPACING * 0.5 + offset; x < w; x += SEA_SPACING) {
        seaCtx.moveTo(x + SEA_RADIUS, y);
        seaCtx.arc(x, y, SEA_RADIUS, 0, Math.PI * 2);
      }
    }
    seaCtx.fill();
  }

  function updateFit(): void {
    if (pointCount >= MIN_POINTS_FOR_FIT) {
      fitIntercept = fitInterceptFixedSlope(
        pointX,
        pointY,
        pointCount,
        THEORY_SLOPE,
      );
      fitSlope = fitLogSlope(pointX, pointY, pointCount);
    } else {
      fitIntercept = NaN;
      fitSlope = NaN;
    }
  }

  /* ---- 描画 ---- */
  function drawBandPanel(narrow: boolean): void {
    const now = sim.time;
    const e = sim.electrons;
    const h = sim.holes;

    drawPlotFrame(ctx, band, {
      colors,
      yTicks: BAND_TICKS,
      xLabel: "結晶内の位置",
    });
    withPlotClip(ctx, band, () => {
      drawBandBox(ctx, band, 0, 1, EC, E_MAX + 1, {
        colors,
        label: undefined,
      });
      drawBandBox(ctx, band, 0, 1, E_MIN - 1, EV, { colors });
      // 価電子帯の満席(電子の海)
      const seaTop = band.toPxY(EV) + 3;
      const seaBottom = band.rect.y + band.rect.h;
      renderSea(band.rect.w, Math.max(1, seaBottom - seaTop), host.size.dpr);
      if (seaCtx) {
        ctx.drawImage(sea, band.rect.x, seaTop, seaW, seaH);
      }

      // 電子(生まれて JUMP_SECONDS の間は価電子帯から縦に跳ぶ途中)
      let ne = 0;
      for (let i = 0; i < e.count; i++) {
        const jitter = e.aux[AUX_JITTER][i];
        const age = now - e.aux[AUX_BORN][i];
        const target = electronLevel(jitter);
        ex[ne] = e.x[i];
        ey[ne] =
          age < JUMP_SECONDS
            ? holeLevel(jitter) +
              (target - holeLevel(jitter)) *
                smoothstep(0, JUMP_SECONDS, Math.max(0, age))
            : target;
        ne++;
      }
      // 正孔
      let nh = 0;
      for (let i = 0; i < h.count; i++) {
        hx[nh] = h.x[i];
        hy[nh] = holeLevel(h.aux[AUX_JITTER][i]);
        nh++;
      }
      // 再結合の途中(電子が価電子帯へ落ち、着いたら両方消える)
      for (let k = 0; k < sim.effectCount; k++) {
        const age = now - sim.effectT0[k];
        if (age < 0 || age >= JUMP_SECONDS) continue;
        const from = electronLevel(sim.effectJe[k]);
        const to = holeLevel(sim.effectJh[k]);
        ex[ne] = sim.effectXe[k];
        ey[ne] = from + (to - from) * smoothstep(0, JUMP_SECONDS, age);
        ne++;
        hx[nh] = sim.effectXh[k];
        hy[nh] = to;
        nh++;
      }

      // 正孔 = 満席の海に空いた穴: 背景色で海を抜いてから正孔の色で塗る
      ctx.save();
      ctx.fillStyle = colors.bg;
      ctx.beginPath();
      for (let i = 0; i < nh; i++) {
        const px = band.toPxX(hx[i]);
        const py = band.toPxY(hy[i]);
        ctx.moveTo(px + 6, py);
        ctx.arc(px, py, 6, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
      const radius = narrow ? 3.6 : 4.2;
      drawElectronDots(ctx, band, hx, hy, nh, {
        colors,
        radius,
        kind: "hole",
      });
      drawElectronDots(ctx, band, ex, ey, ne, { colors, radius });

      // 真性半導体の E_F(ギャップのほぼ中央)
      drawFermiLine(ctx, band, 0, 1, 0.5 * (EV + EC), colors);
    });
    drawLabel(
      ctx,
      "伝導帯",
      band.rect.x + band.rect.w - 6,
      band.toPxY(E_MAX) + 12,
      colors.text2,
      "right",
    );
    drawLabel(
      ctx,
      "価電子帯(満席)",
      band.rect.x + band.rect.w - 6,
      band.toPxY(E_MIN) - 10,
      colors.text2,
      "right",
    );
  }

  function drawGraphPanel(narrow: boolean): void {
    drawPlotFrame(ctx, graph, {
      colors,
      xTicks: RATIO_TICKS,
      yTicks: COUNT_TICKS,
      xLabel: "E_g / k_BT",
      yLabel: "平均の数(対数)",
    });
    const ratio = sim.ratio;
    const avg = sim.average;
    withPlotClip(ctx, graph, () => {
      // 現在の条件の縦線
      ctx.save();
      ctx.strokeStyle = colors.text2;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(graph.toPxX(ratio), graph.rect.y);
      ctx.lineTo(graph.toPxX(ratio), graph.rect.y + graph.rect.h);
      ctx.stroke();
      ctx.restore();

      // 理論直線(傾き −1/2 固定・切片だけ当てはめ)
      if (Number.isFinite(fitIntercept)) {
        const x0 = RATIO_MIN - X_PAD;
        const x1 = RATIO_MAX + X_PAD;
        ctx.save();
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(
          graph.toPxX(x0),
          graph.toPxY((fitIntercept + THEORY_SLOPE * x0) / Math.LN10),
        );
        ctx.lineTo(
          graph.toPxX(x1),
          graph.toPxY((fitIntercept + THEORY_SLOPE * x1) / Math.LN10),
        );
        ctx.stroke();
        ctx.restore();
      }

      // 記録した点
      ctx.save();
      ctx.fillStyle = colors.electron;
      ctx.beginPath();
      for (let i = 0; i < pointCount; i++) {
        if (!(pointY[i] > 0)) continue;
        const px = graph.toPxX(pointX[i]);
        const py = graph.toPxY(Math.log10(pointY[i]));
        ctx.moveTo(px + 4.5, py);
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();

      // いまの時間平均(まだ記録していない値)
      if (avg > 0) {
        ctx.save();
        ctx.strokeStyle = colors.electron;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(
          graph.toPxX(ratio),
          graph.toPxY(Math.log10(avg)),
          5.5,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      }
    });
    // 見出しと理論直線の凡例
    drawLabel(
      ctx,
      narrow ? "測定(○ = いまの平均)" : "測定(● 記録した点 / ○ いまの平均)",
      graph.rect.x + 6,
      graph.rect.y + 10,
      colors.text2,
      "left",
    );
    if (Number.isFinite(fitIntercept)) {
      drawLabel(
        ctx,
        narrow ? "— 傾き −1/2" : "— 傾き −1/2 の直線(切片だけ合わせた)",
        graph.rect.x + 6,
        graph.rect.y + 26,
        colors.accent,
        "left",
      );
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    const layout = splitByFraction(host.size, 0.62, 0.58);
    const a = layout.first;
    const b = layout.second;

    setPlotRange(
      band,
      a.x + 40,
      a.y + 10,
      a.w - 40 - 8,
      a.h - 10 - 34,
      0,
      1,
      E_MIN,
      E_MAX,
    );
    setPlotRange(
      graph,
      b.x + 54,
      b.y + 8,
      b.w - 54 - 10,
      b.h - 8 - 44,
      RATIO_MIN - X_PAD,
      RATIO_MAX + X_PAD,
      LOG_MIN,
      LOG_MAX,
    );
    drawBandPanel(narrow);
    drawSplitDivider(ctx, layout, colors);
    drawGraphPanel(narrow);
    updateReadouts();
  }

  /* ---- 読み取り値(値が変わったときだけ文字列を作る) ---- */
  let shownCount = -1;
  let shownAvg = -1;
  let recordEnabled = true;
  function updateReadouts(): void {
    const c = sim.count;
    if (c !== shownCount) {
      shownCount = c;
      countItem.set(`${c} 個`);
    }
    const avg = sim.average;
    const avgKey = Number.isFinite(avg) ? Math.round(avg * 10) : -2;
    if (avgKey !== shownAvg) {
      shownAvg = avgKey;
      averageItem.set(Number.isFinite(avg) ? `${avg.toFixed(1)} 個` : "—");
    }
    const canRecord = avg > 0;
    if (canRecord !== recordEnabled) {
      recordEnabled = canRecord;
      recordBtn.el.disabled = !canRecord;
    }
  }

  function updatePointReadouts(): void {
    pointsItem.set(`${pointCount} 点`);
    slopeItem.set(
      Number.isFinite(fitSlope)
        ? `${fitSlope < 0 ? "−" : ""}${Math.abs(fitSlope).toFixed(2)}(理論 −0.5)`
        : `—(${MIN_POINTS_FOR_FIT} 点から)`,
    );
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const countItem = readout.item("伝導帯の電子(= 正孔)", { color: "electron" });
  const averageItem = readout.item("時間平均(直近 15 秒)");
  const pointsItem = readout.item("記録した点");
  const slopeItem = readout.item("点の並びの傾き");

  const ratioSlider = host.controls.slider({
    id: "ratio",
    label: "ギャップと熱の比 E_g/k_BT",
    min: RATIO_MIN,
    max: RATIO_MAX,
    step: RATIO_STEP,
    value: RATIO_INIT,
    format: (v) => v.toFixed(1),
  });
  const SI_NOTE = "実際の Si(300 K)は E_g/k_BT ≈ 43 — この目盛りのはるか右";
  const note = insertNote(ratioSlider.el, SI_NOTE);
  function updateNote(): void {
    note.textContent =
      sim.ratio >= RATIO_NOISY
        ? `${SI_NOTE}。この条件では平均が数個以下になり揺らぐので、長めに待ってから記録してください`
        : SI_NOTE;
  }
  ratioSlider.onChange((v) => {
    sim.ratio = v;
    updateNote();
  });

  host.controls.playPause();
  const recordBtn = host.controls.button({ label: "この条件を記録" });
  recordBtn.onClick(() => {
    const avg = sim.average;
    if (!(avg > 0)) return;
    if (pointCount === MAX_POINTS) {
      // いちばん古い点を捨てる
      pointX.copyWithin(0, 1);
      pointY.copyWithin(0, 1);
      pointCount--;
    }
    pointX[pointCount] = sim.ratio;
    pointY[pointCount] = avg;
    pointCount++;
    updateFit();
    updatePointReadouts();
    host.requestRender();
  });

  host.controls.reset(() => {
    ratioSlider.set(RATIO_INIT);
    sim.reset(RATIO_INIT);
    pointCount = 0;
    updateFit();
    updatePointReadouts();
    updateNote();
  });

  updatePointReadouts();

  /* ---- フレームループ(固定刻み 1/60 秒) ---- */
  const stepper = fixedStep(GENREC_DT * 1000);
  host.onFrame((dt) => {
    stepper(dt, () => sim.step());
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
      note.remove();
    },
  };
}
