/**
 * stm-scan.ts — 図5「探針で表面をなぞる — STM」(仕様書 14 §5.5・中心図版)
 *
 * 左(狭幅では上): 横から見た図。いまの走査線に沿った表面の原子の断面と、
 *   探針の先端の軌跡(--mat-electron の線 = 定電流の等高線)、探針。
 *   設定電流と現在の電流の小さな棒(--mat-beam、対数)。
 * 右(狭幅では下): 上から見た像。64×64 画素の高さの地図を、走査に合わせて
 *   1 行ずつ描いていく(ラスタ走査)。色は背景色と --mat-matrix の 2 色の補間で、
 *   高いところほど濃い。濃淡は欠陥から離れた場所の高さの最小〜最大に
 *   自動で合わせ(実際の装置と同じ)、その幅(= 実際の凹凸)を読み取りに出す。
 *
 * 模型は lib/stm.ts(点の探針・対数比例のフィードバック・振動ノイズ 3 pm・
 * 接触したら 0.5 nm 引き上げる)。乱数(欠陥の位置・振動ノイズ)はシード固定で、
 * reset で同じ表面・同じノイズ列から描き直す。
 *
 * 実装方式: onFrame(走査中のみ)。像は ImageData に直接書き込み、64×64 の
 * 裏のキャンバスから拡大して描く(画素ごとの fillRect を使わない — 母体 §8.3)。
 * 省モーション時は「走査を始める」で全 64 行を一度に計算した完成像を出す。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { MAT_COLORS, UI_COLORS } from "../../core/colors";
import { font, fmtSig } from "../../core/plot";
import {
  I_SET_NA,
  NOISE_SEED,
  PM_PER_NM,
  SPACING_METAL_NM,
  SPACING_SEMI_NM,
  SURFACE_SEED,
  Z_REF_NM,
} from "./lib/constants";
import {
  drawDivider,
  haloText,
  ownLine,
  parseHex,
  rect,
  resolvePalette,
  setRect,
  splitTwo,
  tooSmall,
  type Rect,
} from "./lib/draw";
import {
  createSurface,
  imageRange,
  RETRACT_NM,
  StmScanner,
  type ImageRange,
  type ScanStatus,
  type Surface,
} from "./lib/stm";

/** スライダー・切り替え(§5.5 の表) */
const GAIN_MIN = 0.05;
const GAIN_MAX = 2.5;
const GAIN_STEP = 0.05;
const GAIN_INIT = 0.5;
type Speed = "slow" | "medium" | "fast";
const SUBSTEPS: Record<Speed, number> = { slow: 12, medium: 4, fast: 1 };
type SurfaceKind = "semi" | "metal";
const SPACING: Record<SurfaceKind, number> = {
  semi: SPACING_SEMI_NM,
  metal: SPACING_METAL_NM,
};

/**
 * 1 秒あたりのフィードバックの回数(画面上の時間の速さ)。速さの切り替えは
 * 1 画素あたりの回数を変えるので、「速い」ほど 1 画素の時間が短い:
 * 遅い 27 秒・中 9 秒・速い 2.3 秒で 1 枚。実際の走査(数分〜数十分)より大きく速い
 */
const FEEDBACK_PER_SECOND = 1800;
/** 1 フレームで進める画素数の上限(1 行) */
const MAX_PIXELS_PER_FRAME = 64;

/** 原子の見た目の半径 [nm] */
const ATOM_R = 0.12;
/** 探針の三角の高さと幅 [nm] */
const TIP_H = 0.62;
const TIP_W = 0.5;
/**
 * 横から見た図の上下の表示範囲 [nm]: 原子の中心より下 0.32 nm、上は
 * ふつうの高さ(0.6 nm)にいる探針の三角の上端まで
 */
const SIDE_Z_BELOW = 0.32;
const SIDE_Z_ABOVE = Z_REF_NM + TIP_H + 0.08;
/** 横から見た図の余白 [px](上: 題、下: 横軸・目盛り・軸の名前) */
const SIDE_PAD_X = 12;
const SIDE_PAD_TOP = 30;
const SIDE_PAD_BOTTOM = 44;
/** 電流の棒の対数の範囲(log₁₀ nA)と寸法 [px] */
const BAR_LOG_MIN = -2;
const BAR_LOG_MAX = 2;
const BAR_W = 14;
const BAR_GAP = 10;
/** 棒の列(2 本 + 間 + 左右の余白)の幅 [px] */
const BAR_COLUMN_W = 2 * BAR_W + BAR_GAP + 30;

const STATUS_TEXT: Record<ScanStatus, string> = {
  idle: "待機中",
  tracking: "追従中",
  lag: "にじみ: 追従が遅れています",
  oscillation: "振動: ゲインが強すぎます",
  contact: `接触!(探針を ${RETRACT_NM} nm 引き上げた)`,
};

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function stmScan(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const reduced = prefersReducedMotion();

  /* ---- 像の 2 色(背景色 → --mat-matrix) ---- */
  const [bgR, bgG, bgB] = parseHex(
    pal.bg,
    parseHex(UI_COLORS.bg, [255, 255, 255]),
  );
  const [mR, mG, mB] = parseHex(
    pal.matrix,
    parseHex(MAT_COLORS.matrix, [154, 167, 184]),
  );

  /* ---- 状態 ---- */
  let speed: Speed = "medium";
  const surfaces: Record<SurfaceKind, Surface> = {
    semi: createSurface(SPACING.semi, { defects: true, seed: SURFACE_SEED }),
    metal: createSurface(SPACING.metal, { defects: true, seed: SURFACE_SEED }),
  };
  const scanner = new StmScanner(surfaces.semi, {
    gain: GAIN_INIT,
    substeps: SUBSTEPS.medium,
    seed: NOISE_SEED,
  });
  /** ユーザーの意図としての「走査中」(画面外で止まっていても true のまま) */
  let running = false;
  let budget = 0;
  const range: ImageRange = { lo: 0, hi: 0, valid: false };
  let dirtyImage = true;

  /* ---- 像(64×64 の裏のキャンバス + ImageData。初期化時に 1 回だけ作る) ---- */
  const N = scanner.pixels;
  const off = document.createElement("canvas");
  off.width = N;
  off.height = N;
  const offCtx = off.getContext("2d");
  const imageData = offCtx ? offCtx.createImageData(N, N) : null;

  /** 像の画素の色を作り直す(走査が進んだとき・濃淡の範囲が変わったとき) */
  function paintImage(): void {
    if (!imageData || !offCtx) return;
    imageRange(scanner.image, N, scanner.size, scanner.surface, range);
    let lo = range.lo;
    let hi = range.hi;
    if (!range.valid) {
      // 走査の始め(3 行未満): 走査した画素の最小〜最大で代用する
      lo = Infinity;
      hi = -Infinity;
      for (let i = 0; i < N * N; i++) {
        const v = scanner.image[i];
        if (Number.isNaN(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = hi - lo > 1e-6 ? hi - lo : 1e-6;
    const data = imageData.data;
    for (let i = 0; i < N * N; i++) {
      const v = scanner.image[i];
      const o = i * 4;
      if (Number.isNaN(v)) {
        data[o] = bgR;
        data[o + 1] = bgG;
        data[o + 2] = bgB;
      } else {
        let t = (v - lo) / span;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        data[o] = bgR + (mR - bgR) * t;
        data[o + 1] = bgG + (mG - bgG) * t;
        data[o + 2] = bgB + (mB - bgB) * t;
      }
      data[o + 3] = 255;
    }
    offCtx.putImageData(imageData, 0, 0);
    dirtyImage = false;
  }

  /* ---- レイアウト ---- */
  const side: Rect = rect();
  const img: Rect = rect();
  const square: Rect = rect();
  let stacked = false;

  function layout(): void {
    const { w, h } = host.size;
    stacked = splitTwo(w, h, 0.45, 0.42, 14, side, img);
    const pad = 10;
    const labelTop = 24;
    const labelBottom = 34;
    const s = Math.max(
      10,
      Math.min(img.w - pad * 2, img.h - labelTop - labelBottom),
    );
    setRect(
      square,
      img.x + (img.w - s) / 2,
      img.y + labelTop + (img.h - labelTop - labelBottom - s) / 2,
      s,
      s,
    );
  }

  /* ---------------------------------------------------------- 横から見た図 */

  function drawSide(): void {
    const r = side;
    // 両端の画素でも探針の三角がはみ出さないよう、横は 3.2 nm + 三角の幅
    const span = scanner.size + TIP_W;
    const zSpan = SIDE_Z_BELOW + SIDE_Z_ABOVE;
    const scaleH = (r.h - SIDE_PAD_TOP - SIDE_PAD_BOTTOM) / zSpan;
    let plotW = r.w - SIDE_PAD_X * 2;
    let scale = Math.min(plotW / span, scaleH);
    // 電流の棒は右上に置く。探針の三角の上端が棒の高さまで届くほど縦が
    // 窮屈なとき(狭幅)は、棒のための列を右端に空けて残りの幅に収める
    const barH = Math.min(90, r.h * 0.32);
    const barsBottom = r.y + SIDE_PAD_TOP + barH + 18;
    if (r.y + r.h - SIDE_PAD_BOTTOM - zSpan * scale < barsBottom) {
      plotW -= BAR_COLUMN_W;
      scale = Math.min(plotW / span, scaleH);
    }
    const x0 = r.x + SIDE_PAD_X + (plotW - span * scale) / 2;
    const baseY = r.y + r.h - SIDE_PAD_BOTTOM - SIDE_Z_BELOW * scale;
    const X = (x: number): number => x0 + (x + TIP_W / 2) * scale;
    const Z = (z: number): number => baseY - z * scale;
    const s = scanner.surface;
    const lineRow = scanner.done ? N - 1 : scanner.row;
    const yLine = scanner.pixelY(lineRow);
    const rPx = ATOM_R * scale;

    // 走査線に近い原子の列(近いほど濃く)
    const jNear = Math.round((yLine - s.offset) / s.spacing);
    const dyNear = Math.abs(yLine - (s.offset + jNear * s.spacing));
    const alphaRow = Math.max(0.35, 1 - dyNear / s.spacing);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= s.cells; i++) {
      const x = s.offset + i * s.spacing;
      const idx = (i + s.margin) * s.side + (jNear + s.margin);
      const vacancy = s.weight[idx] === 0;
      ctx.beginPath();
      ctx.arc(X(x), Z(0), rPx, 0, Math.PI * 2);
      if (vacancy) {
        // 空孔: 塗りなし + --mat-matrix の破線縁(母体 §6.2)
        ctx.globalAlpha = alphaRow;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = pal.matrix;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.globalAlpha = alphaRow;
        ctx.fillStyle = pal.matrix;
        ctx.fill();
        ctx.strokeStyle = pal.matrixEdge;
        ctx.stroke();
      }
    }
    // 吸着原子(走査線から 0.75 間隔以内なら、近いほど濃く)
    if (s.adatom) {
      const dy = Math.abs(yLine - s.adatom.y);
      if (dy < s.spacing * 0.75) {
        ctx.globalAlpha = Math.max(0.35, 1 - dy / (s.spacing * 0.75));
        ctx.beginPath();
        ctx.arc(X(s.adatom.x), Z(s.extraZ[0]), rPx, 0, Math.PI * 2);
        ctx.fillStyle = pal.matrix;
        ctx.fill();
        ctx.strokeStyle = pal.matrixEdge;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // 探針の先端の軌跡(定電流の等高線)
    if (scanner.trajCount > 1) {
      ctx.beginPath();
      ctx.moveTo(X(scanner.trajX[0]), Z(scanner.trajZ[0]));
      for (let k = 1; k < scanner.trajCount; k++) {
        ctx.lineTo(X(scanner.trajX[k]), Z(scanner.trajZ[k]));
      }
      ctx.strokeStyle = pal.electron;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // 探針(先端を三角で)
    const tx =
      scanner.trajCount > 0 && !scanner.done
        ? scanner.trajX[scanner.trajCount - 1]
        : scanner.tipX();
    const tz = scanner.z;
    ctx.beginPath();
    ctx.moveTo(X(tx), Z(tz));
    ctx.lineTo(X(tx - TIP_W / 2), Z(tz + TIP_H));
    ctx.lineTo(X(tx + TIP_W / 2), Z(tz + TIP_H));
    ctx.closePath();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = pal.matrix;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.matrixEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 横軸(nm)。目盛りの数字の下の行に軸の名前
    const axisY = Math.round(r.y + r.h - SIDE_PAD_BOTTOM + 8) + 0.5;
    ctx.strokeStyle = pal.ghost;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(0), axisY);
    ctx.lineTo(X(scanner.size), axisY);
    for (let x = 0; x <= 3; x += 1) {
      ctx.moveTo(Math.round(X(x)) + 0.5, axisY);
      ctx.lineTo(Math.round(X(x)) + 0.5, axisY + 4);
    }
    ctx.stroke();
    ctx.font = font(11);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let x = 0; x <= 3; x += 1) ctx.fillText(String(x), X(x), axisY + 5);
    ctx.textAlign = "right";
    ctx.fillText("走査の向き x [nm] →", X(scanner.size), axisY + 20);

    // ラベル
    ctx.font = font(12);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    haloText(
      ctx,
      "横から見た図(いまの走査線)",
      r.x + 8,
      r.y + 6,
      pal.text2,
      pal.bg,
    );
    drawCurrentBars(r, barH);
  }

  /** 設定電流と現在の電流の棒(対数 0.01〜100 nA)。右上の隅に置く */
  function drawCurrentBars(r: Rect, barH: number): void {
    const barW = BAR_W;
    const x0 = r.x + r.w - 2 * BAR_W - BAR_GAP - 16;
    const yTop = r.y + SIDE_PAD_TOP;
    const yBot = yTop + barH;
    const toY = (lg: number): number => {
      const t =
        (Math.min(BAR_LOG_MAX, Math.max(BAR_LOG_MIN, lg)) - BAR_LOG_MIN) /
        (BAR_LOG_MAX - BAR_LOG_MIN);
      return yBot - t * barH;
    };
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    const x1 = x0 + barW + BAR_GAP;
    ctx.strokeRect(x0 - 0.5, yTop - 0.5, barW + 1, barH + 1);
    ctx.strokeRect(x1 - 0.5, yTop - 0.5, barW + 1, barH + 1);
    const ySet = toY(Math.log10(I_SET_NA));
    const yNow = toY(Math.log10(scanner.current));
    ctx.fillStyle = pal.beam;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x0, ySet, barW, yBot - ySet);
    ctx.globalAlpha = 1;
    ctx.fillRect(x1, yNow, barW, yBot - yNow);
    // 設定値の高さの線(現在の棒にも重ねて比べやすく)
    ctx.strokeStyle = pal.beamInk;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(x0 - 3, ySet);
    ctx.lineTo(x1 + barW + 3, ySet);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = font(11);
    ctx.fillStyle = pal.beamInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("設定", x0 + barW / 2, yBot + 3);
    ctx.fillText("現在", x1 + barW / 2, yBot + 3);
    ctx.textBaseline = "bottom";
    ctx.fillText("電流", (x0 + x1 + barW) / 2, yTop - 3);
  }

  /* ---------------------------------------------------------- 上から見た像 */

  function drawImage(): void {
    if (dirtyImage) paintImage();
    const q = square;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (offCtx) ctx.drawImage(off, q.x, q.y, q.w, q.h);
    ctx.restore();
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(q.x - 0.5, q.y - 0.5, q.w + 1, q.h + 1);

    // いまの走査線と探針の位置
    if (!scanner.done && scanner.scanned > 0) {
      const py = q.y + ((scanner.row + 0.5) / N) * q.h;
      ctx.strokeStyle = pal.electron;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q.x, py);
      ctx.lineTo(q.x + q.w, py);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const pxx = q.x + ((scanner.col + 0.5) / N) * q.w;
      ctx.beginPath();
      ctx.arc(pxx, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = pal.electron;
      ctx.fill();
    }

    // ラベル・スケールバー・濃淡の説明
    ctx.font = font(12);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("上から見た像(3.2 nm 四方・64×64 画素)", q.x, q.y - 6);
    const scaleLen = q.w / scanner.size; // 1 nm
    const sy = q.y + q.h + 12;
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(q.x, sy);
    ctx.lineTo(q.x + scaleLen, sy);
    ctx.moveTo(q.x, sy - 3);
    ctx.lineTo(q.x, sy + 3);
    ctx.moveTo(q.x + scaleLen, sy - 3);
    ctx.lineTo(q.x + scaleLen, sy + 3);
    ctx.stroke();
    ctx.font = font(11);
    ctx.textBaseline = "top";
    ctx.fillText("1 nm", q.x + scaleLen + 6, sy - 7);
    // 2 色の見本(低い / 高い)
    const kx = q.x + q.w;
    ctx.textAlign = "right";
    ctx.fillText("高い", kx, sy - 7);
    const hw = ctx.measureText("高い").width;
    ctx.fillStyle = pal.matrix;
    ctx.fillRect(kx - hw - 16, sy - 6, 11, 11);
    ctx.fillStyle = pal.text2;
    ctx.fillText("低い", kx - hw - 22, sy - 7);
    const lw = ctx.measureText("低い").width;
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(kx - hw - lw - 38.5, sy - 5.5, 11, 11);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (tooSmall(host.size)) return;
    layout();
    drawSide();
    drawDivider(ctx, side, img, stacked, pal.hairline);
    drawImage();
    updateReadouts();
  }

  /* ---- 読み取り値 ---- */
  const readout = createReadout(host);
  const iItem = readout.item("電流", { color: "beam" });
  const zItem = readout.item("探針の高さ");
  const corrItem = readout.item("実際の凹凸", { color: "electron" });
  const statusItem = readout.item("状態");

  // 状態は文の長さが変わるので、いつも自分の行に置く(走査を始めたときに
  // 読み取りの折り返しが変わって操作部品が動かないように)
  ownLine(statusItem.el);

  function updateReadouts(): void {
    const ratio = scanner.current / I_SET_NA;
    iItem.set(
      `${fmtSig(scanner.current, 2)} nA(設定の ${fmtSig(ratio, 2)} 倍)`,
    );
    zItem.set(`${scanner.z.toFixed(3)} nm`);
    corrItem.set(
      range.valid ? `${fmtSig((range.hi - range.lo) * PM_PER_NM, 2)} pm` : "—",
    );
    const st = STATUS_TEXT[scanner.status()];
    statusItem.set(
      scanner.done
        ? `走査完了 — ${scanner.contacts > 0 ? `接触 ${scanner.contacts} 回` : st}`
        : st,
    );
    startBtn.el.textContent = running
      ? "走査を止める"
      : scanner.scanned > 0 && !scanner.done
        ? "走査を続ける"
        : "走査を始める";
  }

  /* ---- 走査の制御 ---- */

  function start(): void {
    if (scanner.done) {
      scanner.reset();
      dirtyImage = true;
    }
    if (reduced) {
      // 省モーション: 全 64 行を一度に計算した完成像を出す
      scanner.runAll();
      dirtyImage = true;
      running = false;
      host.setPlaying(false);
      host.requestRender();
      return;
    }
    running = true;
    budget = 0;
    host.setPlaying(true);
  }

  function stop(): void {
    running = false;
    host.setPlaying(false);
    host.requestRender();
  }

  function restartScan(): void {
    running = false;
    host.setPlaying(false);
    scanner.reset();
    dirtyImage = true;
    budget = 0;
  }

  /* ---- 操作部品 ---- */
  const gainSlider = host.controls.slider({
    id: "gain",
    label: "制御の強さ(ゲイン)",
    min: GAIN_MIN,
    max: GAIN_MAX,
    step: GAIN_STEP,
    value: GAIN_INIT,
  });
  gainSlider.onChange((v) => {
    scanner.gain = v;
  });
  const speedSeg = host.controls.segmented<Speed>({
    id: "speed",
    label: "走査の速さ",
    options: [
      { value: "slow", label: "遅い" },
      { value: "medium", label: "中" },
      { value: "fast", label: "速い" },
    ],
    value: "medium",
  });
  speedSeg.onChange((v) => {
    speed = v;
    scanner.substeps = SUBSTEPS[v];
  });
  const surfaceSeg = host.controls.segmented<SurfaceKind>({
    id: "surface",
    label: "表面",
    options: [
      { value: "semi", label: "0.5 nm(半導体ふう)" },
      { value: "metal", label: "0.29 nm(金属ふう)" },
    ],
    value: "semi",
  });
  surfaceSeg.onChange((v) => {
    scanner.surface = surfaces[v];
    restartScan();
  });

  const startBtn = host.controls.button({ label: "走査を始める" });
  startBtn.onClick(() => {
    if (running) stop();
    else start();
  });
  const playBtn = host.controls.playPause();
  playBtn.el.addEventListener("click", () => {
    // engine が先に再生状態を切り替える(aria-pressed がユーザーの意図)
    running = playBtn.el.getAttribute("aria-pressed") === "true";
    if (running && scanner.done) {
      scanner.reset();
      dirtyImage = true;
    }
    host.requestRender();
  });
  host.controls.reset(() => {
    gainSlider.set(GAIN_INIT);
    speedSeg.set("medium");
    surfaceSeg.set("semi");
    scanner.gain = GAIN_INIT;
    speed = "medium";
    scanner.substeps = SUBSTEPS.medium;
    scanner.surface = surfaces.semi;
    restartScan();
  });

  /* ---- 実行 ---- */
  host.onFrame((dt) => {
    if (!running) {
      // 再生ボタン・省モーションの再生ボタンから始めたとき
      start();
      if (reduced) return;
    }
    budget += dt * FEEDBACK_PER_SECOND;
    let pixels = 0;
    const n = SUBSTEPS[speed];
    while (budget >= n && pixels < MAX_PIXELS_PER_FRAME && !scanner.done) {
      scanner.stepPixel();
      budget -= n;
      pixels++;
    }
    if (pixels === MAX_PIXELS_PER_FRAME) budget = 0;
    if (pixels > 0) dirtyImage = true;
    if (scanner.done) {
      running = false;
      host.setPlaying(false);
    }
    draw();
  });
  host.onRender(draw);
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
