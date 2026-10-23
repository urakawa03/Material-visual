/**
 * classical-vs-quantum.ts — 図1「越えられない壁を越える」(仕様書 14 §5.1)
 *
 * 上段(古典): 壁と同じ高さ・同じ頂上の幅の坂に、エネルギー E の玉を転がす。
 *   E < V なら坂の途中で止まって戻り、E > V なら越える。
 * 下段(量子): 同じ E の電子を波束として送り、確率密度 |ψ|² を塗りで描く。
 *   1 次元の時間依存シュレーディンガー方程式をクランク=ニコルソン法で解く
 *   (lib/wavepacket.ts)。壁にぶつかると反射波と透過波に分かれる。
 *
 * 透過する山は既定(E/V = 0.5、d = 0.5 nm)で入射の 0.3% しかなく、そのままでは
 * 見えないので、壁の右側だけを 10 の冪の倍率で拡大して描き、倍率を必ず図中に
 * 書く(図2 と同じ規約 — 黙って拡大しない)。
 *
 * 実装方式: onFrame(発射後、散乱が終わるまで)。終わったら止まり、読み取りが
 * 確定する。省モーション時は「発射」で最終状態を一度に計算して 1 フレームで描く。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { font } from "../../core/plot";
import {
  fmtPercent,
  haloText,
  rect,
  resolvePalette,
  setRect,
  tooSmall,
  type Rect,
} from "./lib/draw";
import { transmission } from "./lib/tunneling";
import {
  averagedTransmission,
  ballPosition,
  classicalOutcome,
  hillHeight,
  WavePacket,
  type Hill,
} from "./lib/wavepacket";

/** 壁の高さ V [eV](固定)と壁の左端 [nm](§5.1) */
const BARRIER_V = 4;
const BARRIER_START = 9.5;
/** 上段の坂の斜面の水平距離 [nm] */
const HILL_SLOPE = 1.2;
/** 表示する x の範囲 [nm] */
const X_MIN = 0;
const X_MAX = 20;

/** スライダー(§5.1 の表) */
const EV_MIN = 0.3;
const EV_MAX = 1.5;
const EV_STEP = 0.05;
const EV_INIT = 0.5;
const D_MIN = 0.2;
const D_MAX = 1.2;
const D_STEP = 0.05;
const D_INIT = 0.5;

/** 1 秒あたりのクランク=ニコルソンのステップ数(60 fps で 1 フレーム 2 ステップ) */
const STEPS_PER_SECOND = 120;
/** 1 フレームで進めるステップ数の上限(処理落ちのときに雪だるまにしない) */
const MAX_STEPS_PER_FRAME = 4;

/** 余白と段の配分(CSS px) */
const PAD_X = 14;
const PAD_TOP = 8;
const AXIS_H = 34;
const ROW_GAP = 14;
const TOP_ROW_FRACTION = 0.34;
/** 上段: 表示するエネルギーの上限(V の何倍か)。E/V = 1.5 の玉まで収める */
const TOP_U_MAX = 1.75;
/** 下段: 壁の高さ V を段の高さの何割に描くか */
const WALL_FRACTION = 0.48;
/** 下段: 初期の波束の山の高さを段の高さの何割に描くか */
const PEAK_FRACTION = 0.26;
/** 玉の半径(px) */
const BALL_R = 7;
/** 透過した山が、拡大後に入射の山のおよそこの割合になるように倍率を選ぶ */
const MAGNIFY_TARGET = 0.4;

type Phase = "ready" | "running" | "done";

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 拡大倍率(10 の冪)。⟨T⟩ が大きければ 1(拡大しない) */
function magnification(tAvg: number): number {
  if (!(tAvg > 0)) return 1;
  const e = Math.round(Math.log10(MAGNIFY_TARGET / tAvg));
  return e > 0 ? 10 ** e : 1;
}

/** 倍率のラベル(×100、×10⁸ など) */
function magnifyLabel(m: number): string {
  const e = Math.round(Math.log10(m));
  if (e <= 4) return `×${m}`;
  return `×10${String(e)
    .split("")
    .map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(c)])
    .join("")}`;
}

export default function classicalVsQuantum(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const reduced = prefersReducedMotion();

  /* ---- 状態 ---- */
  let eOverV = EV_INIT;
  let width = D_INIT;
  let phase: Phase = "ready";
  let stepAcc = 0;
  const packet = new WavePacket();
  const hill: Hill = {
    start: BARRIER_START,
    width: D_INIT,
    slope: HILL_SLOPE,
    height: BARRIER_V,
  };
  /** 設定ごとに 1 回だけ計算する値 */
  let tPlane = 0;
  let tAvg = 0;
  let magnify = 1;
  let magnifyText = "";
  let eLabel = "";
  let finalTransmitted = 0;

  /* ---- レイアウト(resize で 1 回だけ計算) ---- */
  const top: Rect = rect();
  const bottom: Rect = rect();
  let pxPerNm = 1;

  function layout(): void {
    const { w, h } = host.size;
    const plotW = w - PAD_X * 2;
    const plotH = h - PAD_TOP - AXIS_H;
    const topH = Math.round((plotH - ROW_GAP) * TOP_ROW_FRACTION);
    setRect(top, PAD_X, PAD_TOP, plotW, topH);
    setRect(
      bottom,
      PAD_X,
      PAD_TOP + topH + ROW_GAP,
      plotW,
      plotH - topH - ROW_GAP,
    );
    pxPerNm = plotW / (X_MAX - X_MIN);
  }

  const px = (x: number): number => top.x + (x - X_MIN) * pxPerNm;

  function configure(): void {
    const E = eOverV * BARRIER_V;
    packet.configure({
      energy: E,
      barrierHeight: BARRIER_V,
      barrierStart: BARRIER_START,
      barrierWidth: width,
    });
    hill.width = width;
    tPlane = transmission(E, BARRIER_V, width);
    tAvg = averagedTransmission(E, BARRIER_V, width);
    magnify = magnification(tAvg);
    magnifyText =
      magnify > 1 ? `壁の右側は ${magnifyLabel(magnify)} で表示` : "";
    eLabel = `E = ${E.toFixed(1)} eV`;
    phase = "ready";
    finalTransmitted = 0;
    stepAcc = 0;
    updateReadouts();
  }

  function launch(): void {
    packet.reset();
    phase = "running";
    stepAcc = 0;
    if (reduced) {
      // 省モーション: 散乱が終わるまで一度に計算し、最終状態だけを描く
      let guard = 0;
      while (!packet.isScatteringOver() && guard < 20000) {
        packet.step(2);
        guard++;
      }
      finish();
      host.setPlaying(false);
      host.requestRender();
    } else {
      host.setPlaying(true);
    }
    updateReadouts();
  }

  function finish(): void {
    phase = "done";
    finalTransmitted = packet.probabilityRight();
    updateReadouts();
  }

  /* ---- 描画 ---- */

  function drawTopRow(): void {
    const r = top;
    const uMax = TOP_U_MAX * BARRIER_V;
    const base = r.y + r.h - BALL_R * 0.4;
    const scale = (r.h - BALL_R * 3) / uMax;
    const uy = (u: number): number => base - u * scale;
    const a0 = BARRIER_START - HILL_SLOPE;
    const b1 = BARRIER_START + width + HILL_SLOPE;

    // 地面
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(r.x, base + 0.5);
    ctx.lineTo(r.x + r.w, base + 0.5);
    ctx.stroke();

    // 坂(壁と同じ高さ・同じ頂上の幅の山)
    ctx.beginPath();
    ctx.moveTo(px(a0), base);
    ctx.lineTo(px(BARRIER_START), uy(BARRIER_V));
    ctx.lineTo(px(BARRIER_START + width), uy(BARRIER_V));
    ctx.lineTo(px(b1), base);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = pal.matrix;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.matrixEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 玉のエネルギー E の線
    const yE = uy(eOverV * BARRIER_V);
    ctx.strokeStyle = pal.level;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(r.x, yE);
    ctx.lineTo(r.x + r.w, yE);
    ctx.stroke();
    ctx.setLineDash([]);

    // 玉(--color-text-2 の中立色。物質ではないため)
    const xb = ballPosition(phaseTime(), eOverV * BARRIER_V, packet.x0, hill);
    const ub = hillHeight(xb, hill);
    // 斜面の上では面に垂直な向きへ半径ぶんずらす
    let slopePx = 0;
    if (xb > a0 && xb < BARRIER_START)
      slopePx = -(BARRIER_V * scale) / (HILL_SLOPE * pxPerNm);
    else if (xb > BARRIER_START + width && xb < b1)
      slopePx = (BARRIER_V * scale) / (HILL_SLOPE * pxPerNm);
    const norm = Math.hypot(slopePx, 1);
    const cx = px(xb) + (BALL_R * slopePx) / norm;
    const cy = uy(ub) - BALL_R / norm;
    ctx.beginPath();
    ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = pal.text2;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.text;
    ctx.stroke();

    // ラベル
    ctx.font = font(12);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    haloText(ctx, "古典: 玉を坂に転がす", r.x + 2, r.y + 2, pal.text2, pal.bg);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    haloText(ctx, eLabel, r.x + r.w - 2, yE - 3, pal.level, pal.bg);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    haloText(
      ctx,
      `高さ V = ${BARRIER_V} eV`,
      px(BARRIER_START + width / 2),
      uy(BARRIER_V) - 4,
      pal.text2,
      pal.bg,
    );
  }

  function drawBottomRow(): void {
    const r = bottom;
    const base = r.y + r.h - 0.5;
    const wallTop = base - WALL_FRACTION * r.h;
    const ey = (e: number): number => base - (e / BARRIER_V) * (base - wallTop);
    // |ψ|² の目盛り: 初期の山 1/(√(2π)σ) を段の PEAK_FRACTION に
    const peak = 1 / (Math.sqrt(2 * Math.PI) * packet.sigma);
    const dScale = (PEAK_FRACTION * r.h) / peak;
    const xEnd = BARRIER_START + width;

    // 地面
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x, base);
    ctx.lineTo(r.x + r.w, base);
    ctx.stroke();

    // 壁
    const wx0 = px(BARRIER_START);
    const wx1 = px(xEnd);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = pal.matrix;
    ctx.fillRect(wx0, wallTop, wx1 - wx0, base - wallTop);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.matrixEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wx0, wallTop, wx1 - wx0, base - wallTop);

    // 拡大した領域の境(壁の右端)
    if (magnify > 1) {
      ctx.strokeStyle = pal.ghost;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(wx1 + 0.5, r.y);
      ctx.lineTo(wx1 + 0.5, base);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // |ψ|²(塗り)。壁の右側だけ magnify 倍
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y - 2, r.w, r.h + 2);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(px(packet.x(packet.jView0)), base);
    for (let j = packet.jView0; j < packet.jView1; j++) {
      const m = j >= packet.jEnd ? magnify : 1;
      ctx.lineTo(px(packet.x(j)), base - packet.density(j) * m * dScale);
    }
    ctx.lineTo(px(packet.x(packet.jView1 - 1)), base);
    ctx.closePath();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = pal.electron;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let j = packet.jView0; j < packet.jView1; j++) {
      const m = j >= packet.jEnd ? magnify : 1;
      const x = px(packet.x(j));
      const y = base - packet.density(j) * m * dScale;
      if (j === packet.jView0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pal.electron;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    // 壁の位置の E の線(エネルギーの比較)
    const yE = ey(eOverV * BARRIER_V);
    const ex0 = px(BARRIER_START - 1.6);
    const ex1 = px(xEnd + 1.6);
    ctx.strokeStyle = pal.level;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(ex0, yE);
    ctx.lineTo(ex1, yE);
    ctx.stroke();
    ctx.setLineDash([]);

    // ラベル
    ctx.font = font(12);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    haloText(
      ctx,
      "量子: 電子を波の塊として送る",
      r.x + 2,
      r.y + 2,
      pal.text2,
      pal.bg,
    );
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    haloText(ctx, "E", ex0 - 4, yE, pal.level, pal.bg);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    haloText(ctx, "壁", (wx0 + wx1) / 2, wallTop - 3, pal.text2, pal.bg);
    if (magnifyText) {
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      haloText(ctx, magnifyText, r.x + r.w - 2, r.y + 2, pal.electron, pal.bg);
    }
  }

  function drawAxis(): void {
    const y = bottom.y + bottom.h;
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.beginPath();
    for (let x = X_MIN; x <= X_MAX; x += 5) {
      ctx.moveTo(px(x) + 0.5, y);
      ctx.lineTo(px(x) + 0.5, y + 4);
    }
    ctx.stroke();
    for (let x = X_MIN; x <= X_MAX; x += 5) {
      ctx.fillText(String(x), px(x), y + 6);
    }
    ctx.textAlign = "right";
    ctx.fillText("位置 x [nm]", top.x + top.w, y + 19);
  }

  /** 玉と波束に共通の時刻 [fs](発射前は 0) */
  function phaseTime(): number {
    return phase === "ready" ? 0 : packet.time;
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    layout();
    drawTopRow();
    drawBottomRow();
    drawAxis();
  }

  /* ---- 読み取り値 ---- */
  const readout = createReadout(host);
  const simItem = readout.item("透過した割合(計算)", { color: "electron" });
  const theoryItem = readout.item("理論値 T(E₀)");
  const classicItem = readout.item("古典の玉");

  function updateReadouts(): void {
    if (phase === "ready") simItem.set("— (発射を押す)");
    else if (phase === "running") simItem.set("散乱中…");
    else simItem.set(fmtPercent(finalTransmitted));
    theoryItem.set(
      `${fmtPercent(tPlane)}(エネルギーの幅で平均すると ${fmtPercent(tAvg)})`,
    );
    const outcome = classicalOutcome(eOverV * BARRIER_V, BARRIER_V);
    classicItem.set(
      outcome === "cross"
        ? "越える"
        : outcome === "bounce"
          ? "跳ね返る"
          : "頂上で止まる",
    );
  }

  /* ---- 操作部品 ---- */
  const evSlider = host.controls.slider({
    id: "ev",
    label: "電子のエネルギー E/V",
    min: EV_MIN,
    max: EV_MAX,
    step: EV_STEP,
    value: EV_INIT,
    format: (v) => `${v.toFixed(2)}(${(v * BARRIER_V).toFixed(1)} eV)`,
  });
  evSlider.onChange((v) => {
    eOverV = v;
    configure();
    host.setPlaying(false);
  });

  const dSlider = host.controls.slider({
    id: "d",
    label: "壁の厚さ d",
    min: D_MIN,
    max: D_MAX,
    step: D_STEP,
    value: D_INIT,
    unit: "nm",
  });
  dSlider.onChange((v) => {
    width = v;
    configure();
    host.setPlaying(false);
  });

  const fireBtn = host.controls.button({ label: "発射" });
  fireBtn.onClick(launch);
  host.controls.playPause();
  host.controls.reset(() => {
    evSlider.set(EV_INIT);
    dSlider.set(D_INIT);
    eOverV = EV_INIT;
    width = D_INIT;
    configure();
    host.setPlaying(false);
  });

  /* ---- 実行 ---- */
  host.onFrame((dt) => {
    if (phase === "ready" || phase === "done") {
      // 再生ボタンで始めたとき(散乱が終わったあとなら、もう一度発射する)
      launch();
      if (reduced) return;
    }
    if (phase === "running") {
      stepAcc += dt * STEPS_PER_SECOND;
      const n = Math.min(MAX_STEPS_PER_FRAME, Math.floor(stepAcc));
      // 上限で切り捨てた分は持ち越さない(処理落ちのあとで一気に進めない)
      stepAcc = n === MAX_STEPS_PER_FRAME ? 0 : stepAcc - n;
      if (n > 0) packet.step(n);
      if (packet.isScatteringOver()) {
        finish();
        host.setPlaying(false);
      }
    }
    draw();
  });
  host.onRender(draw);

  configure();
  host.setPlaying(false);

  return {
    resize(): void {
      layout();
    },
    destroy(): void {
      readout.el.remove();
    },
  };
}
