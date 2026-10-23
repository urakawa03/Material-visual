/**
 * coarsening-transition.ts — 図7「その後 — 粗大化」(記事仕様書 09 §5.7)
 *
 * 左: 長時間の濃度場(c0 = 0.5、T/Tc = 2/3、128²)。時間とともに迷路の模様が
 * 粗くなる。
 * 右: 代表長さ L(散乱強度の一次のモーメントから)と時間 t の両対数グラフ。
 * 点を時間の対数で等間隔に自動で打ち、傾き 1/3 の参照直線(オストワルド成長の
 * 記事の図6 と同じ描き方: --color-accent の破線)を重ねる。初期(線形の段階)・
 * 中間・後期の 3 区間を薄いラベルで示し、L が箱の大きさに近づいた範囲には
 * 「箱の大きさの影響」の斜線を引く。
 *
 * 早送り ×1 / ×4 / ×16 は 1 フレームのステップ数(2 / 8 / 32)。1 フレームの
 * 計算が 8 ms を超えないよう、端末の性能に合わせて自動で抑える(Δt は変えない)。
 *
 * 実装方式: 2D Canvas / onFrame。初期は停止・時刻 0。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  CahnHilliard,
  DT,
  earlyDt,
  linearStageDuration,
} from "./lib/cahnhilliard";
import { StepBudget } from "./lib/budget";
import {
  FieldImage,
  fmtSig,
  font,
  outlinedText,
  resolvePalette,
} from "./lib/draw";
import { fmtPow10 } from "../../core/plot";
import { T_REP, chiFromT } from "./lib/regular";

const GRID_N = 128;
const FALLBACK_N = 64;
const CHI = chiFromT(T_REP);
const C0 = 0.5;
const NOISE = 0.01;
const SEED = 20261023;
/** 点を打つ間隔(時間の対数で 1 桁あたり 12 点) */
const SAMPLES_PER_DECADE = 12;
const MAX_SAMPLES = 80;
/** 両対数グラフの範囲 */
const LOG_T_MIN = 0;
const LOG_T_MAX = 4;
const L_MIN = 8;
const L_MAX = 80;
/** 区間の境目 [時間](初期 = 線形の段階、後期 = 粗大化) */
const T_LATE = 200;
/** 傾き 1/3 の参照直線を合わせる時刻(データがなければ既定の L) */
const T_ANCHOR = 200;
const L_ANCHOR_DEFAULT = 20;
/** 箱の大きさの影響とみなす L(格子の一辺に対する割合) */
const BOX_FRACTION = 0.3;
/** 局所的な傾きを見る幅(サンプル数 = 1/4 桁) */
const LOCAL_SPAN = 3;

type Speed = "1" | "4" | "16";
const SPEED_STEPS: Record<Speed, number> = { "1": 2, "4": 8, "16": 32 };
const SPEED_INIT: Speed = "4";

export default function coarseningTransition(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const field = new FieldImage(pal.matrix, pal.second);
  const budget = new StepBudget();

  let n = GRID_N;
  let sim = new CahnHilliard({ nx: n, ny: n, chi: CHI });
  const tLinear = linearStageDuration(C0, CHI, sim.kappa);
  const sampleT = new Float64Array(MAX_SAMPLES);
  const sampleL = new Float64Array(MAX_SAMPLES);
  let samples = 0;
  let nextSample = 1;
  let speed: Speed = SPEED_INIT;

  const readout = createReadout(host);
  const roTime = readout.item("経過時間");
  const roL = readout.item("L");
  const roLocal = readout.item("直近の傾き");
  const roFit = readout.item("通しの傾き(後期)");

  const speedCtl = host.controls.segmented<Speed>({
    id: "speed",
    label: "早送り",
    options: [
      { value: "1", label: "×1" },
      { value: "4", label: "×4" },
      { value: "16", label: "×16" },
    ],
    value: SPEED_INIT,
  });
  speedCtl.onChange((v) => {
    speed = v;
  });
  host.controls.playPause();
  host.controls.reset(() => {
    speedCtl.set(SPEED_INIT);
    init();
    host.setPlaying(false);
  });

  function init(): void {
    sim.initUniform(C0, NOISE, SEED);
    samples = 0;
    nextSample = 1;
  }

  function shrinkGrid(): void {
    n = FALLBACK_N;
    sim = new CahnHilliard({ nx: n, ny: n, chi: CHI });
    budget.reset(0.25);
    init();
  }

  function recordSamples(): void {
    while (sim.time >= nextSample - 1e-9 && samples < MAX_SAMPLES) {
      sampleT[samples] = sim.time;
      sampleL[samples] = sim.characteristicLength();
      samples++;
      nextSample =
        10 **
        ((Math.round(Math.log10(nextSample) * SAMPLES_PER_DECADE) + 1) /
          SAMPLES_PER_DECADE);
    }
  }

  /** 箱の大きさの影響を受ける L の下限 */
  function boxL(): number {
    return BOX_FRACTION * n;
  }

  /** 直近の局所的な傾き d ln L / d ln t */
  function localSlope(): number {
    if (samples <= LOCAL_SPAN) return NaN;
    const i = samples - 1;
    const j = i - LOCAL_SPAN;
    return (
      Math.log(sampleL[i] / sampleL[j]) / Math.log(sampleT[i] / sampleT[j])
    );
  }

  /** 後期(t ≥ T_LATE、箱の影響の手前まで)の最小二乗の傾き */
  function lateSlope(): number {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let m = 0;
    const limit = boxL();
    for (let i = 0; i < samples; i++) {
      if (sampleT[i] < T_LATE) continue;
      if (sampleL[i] >= limit) break;
      const x = Math.log(sampleT[i]);
      const y = Math.log(sampleL[i]);
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
      m++;
    }
    if (m < 4) return NaN;
    return (m * sxy - sx * sy) / (m * sxx - sx * sx);
  }

  /* ---- レイアウト ---- */
  interface Layout {
    narrow: boolean;
    fx: number;
    fy: number;
    side: number;
    px: number;
    py: number;
    pw: number;
    ph: number;
  }

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560 || w < h * 1.2;
    const pad = narrow ? 8 : 12;
    if (!narrow) {
      const half = w / 2;
      const side = Math.min(half - 2 * pad, h - 2 * pad - 20);
      return {
        narrow,
        fx: pad,
        fy: pad + 20,
        side,
        px: half + 44,
        py: pad + 26,
        pw: w - half - 44 - pad - 4,
        ph: h - pad - 26 - 38,
      };
    }
    const side = Math.min(w - 2 * pad, h * 0.5);
    const top = pad + 20;
    const plotTop = top + side + 34;
    return {
      narrow,
      fx: (w - side) / 2,
      fy: top,
      side,
      px: 44,
      py: plotTop,
      pw: w - 44 - pad - 4,
      ph: h - plotTop - 36,
    };
  }

  /* ---- 描画 ---- */
  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout();

    // 濃度場
    ctx.font = font(L.narrow ? 12 : 13, 600);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`c₀ = ${C0}・T/Tc = 0.67(${n}² 格子)`, L.fx, L.fy - 5);
    field.update(sim.c, n);
    field.draw(ctx, L.fx, L.fy, L.side);
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(L.fx - 0.5, L.fy - 0.5, L.side + 1, L.side + 1);

    drawPlot(L);

    const last = samples > 0 ? sampleL[samples - 1] : NaN;
    roTime.set(fmtSig(sim.time, 3));
    roL.set(Number.isFinite(last) ? `${fmtSig(last, 3)} 格子` : "—");
    const ls = localSlope();
    roLocal.set(Number.isFinite(ls) ? ls.toFixed(2) : "—");
    const fs = lateSlope();
    roFit.set(Number.isFinite(fs) ? fs.toFixed(2) : "—(t ≥ 200 から)");
  }

  function drawPlot(L: Layout): void {
    const { px, py, pw, ph, narrow } = L;
    const lx = (t: number): number =>
      px + ((Math.log10(t) - LOG_T_MIN) / (LOG_T_MAX - LOG_T_MIN)) * pw;
    const ly = (v: number): number =>
      py +
      ph -
      ((Math.log10(v) - Math.log10(L_MIN)) /
        (Math.log10(L_MAX) - Math.log10(L_MIN))) *
        ph;

    // 区間の境目と薄いラベル
    const tEarly = Math.max(tLinear, 10);
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of [tEarly, T_LATE]) {
      ctx.moveTo(lx(t) + 0.5, py);
      ctx.lineTo(lx(t) + 0.5, py + ph);
    }
    ctx.stroke();
    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      narrow ? "初期" : "初期(線形)",
      (px + lx(tEarly)) / 2,
      py + ph - 4,
    );
    ctx.fillText("中間", (lx(tEarly) + lx(T_LATE)) / 2, py + ph - 4);
    ctx.fillText(
      narrow ? "後期" : "後期(粗大化)",
      (lx(T_LATE) + px + pw) / 2,
      py + ph - 4,
    );

    // 箱の大きさの影響(斜線)
    const yBox = ly(boxL());
    if (yBox > py) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, pw, yBox - py);
      ctx.clip();
      ctx.strokeStyle = pal.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = px - ph; x < px + pw; x += 9) {
        ctx.moveTo(x, yBox);
        ctx.lineTo(x + (yBox - py), py);
      }
      ctx.stroke();
      ctx.restore();
      ctx.font = font(narrow ? 10 : 11);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      outlinedText(ctx, "箱の大きさの影響", px + 6, py + 3, pal.text2, pal.bg);
    }

    // 軸
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py);
    ctx.lineTo(px + 0.5, py + ph + 0.5);
    ctx.lineTo(px + pw, py + ph + 0.5);
    ctx.stroke();
    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let e = LOG_T_MIN; e <= LOG_T_MAX; e++) {
      const x = lx(10 ** e);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, py + ph);
      ctx.lineTo(x + 0.5, py + ph + 4);
      ctx.stroke();
      ctx.fillText(fmtPow10(10 ** e), x, py + ph + 6);
    }
    ctx.fillText("時間 t(対数)", px + pw / 2, py + ph + 20);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [10, 20, 50]) {
      const y = ly(v);
      ctx.beginPath();
      ctx.moveTo(px - 4, y + 0.5);
      ctx.lineTo(px, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), px - 6, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("代表長さ L [格子](対数)", px - 38, py - 8);

    // 傾き 1/3 の参照直線(後期のデータに合わせる)
    let anchorL = L_ANCHOR_DEFAULT;
    for (let i = 0; i < samples; i++) {
      if (sampleT[i] >= T_ANCHOR) {
        anchorL = sampleL[i] * (T_ANCHOR / sampleT[i]) ** (1 / 3);
        break;
      }
    }
    const ref = (t: number): number => anchorL * (t / T_ANCHOR) ** (1 / 3);
    const tRef0 = 30;
    const tRef1 = 10 ** LOG_T_MAX;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(lx(tRef0), ly(ref(tRef0)));
    ctx.lineTo(lx(tRef1), ly(ref(tRef1)));
    ctx.stroke();
    ctx.restore();
    ctx.font = font(11);
    ctx.fillStyle = pal.accent;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const tLab = 10 ** (LOG_T_MAX - 0.25);
    outlinedText(
      ctx,
      "傾き 1/3",
      lx(tLab),
      ly(ref(tLab)) + 8,
      pal.accent,
      pal.bg,
    );

    // データ(線 + 点)
    if (samples > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px - 4, py - 4, pw + 8, ph + 8);
      ctx.clip();
      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const x = lx(sampleT[i]);
        const y = ly(sampleL[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = pal.second;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = pal.second;
      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const x = lx(sampleT[i]);
        const y = ly(sampleL[i]);
        ctx.moveTo(x + 3, y);
        ctx.arc(x, y, 3, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---- フレームループ ---- */
  host.onFrame(() => {
    const steps = budget.steps(SPEED_STEPS[speed]);
    const t0 = performance.now();
    for (let s = 0; s < steps; s++) {
      sim.setDt(sim.time < tLinear - 1e-9 ? earlyDt(sim.A) : DT);
      sim.step(1);
      recordSamples();
    }
    budget.record(steps, performance.now() - t0);
    if (n === GRID_N && budget.overBudget()) shrinkGrid();
    draw();
  });
  host.onRender(draw);

  init();
  host.setPlaying(false);

  return {
    resize(): void {
      host.requestRender();
    },
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
