/**
 * two-mechanisms.ts — 図1「二種類の分かれ方」(記事仕様書 09 §5.1)
 *
 * 左右(狭幅では上下)に濃度場を 2 枚。どちらも T/Tc = 2/3 の同じカーン・
 * ヒリアード方程式で、組成だけが違う。
 * - 左(核生成・成長): c0 = 0.12(準安定)。ゆらぎは育たないので、核の発生を
 *   乱数で模擬する — 平均 0.6 秒(時間 18)に 1 個、シード固定の位置に半径 4 の
 *   B リッチの円を置く(最大 10 個)。核の B は母相から集めたものとし(平均
 *   組成を保存)、母相の過飽和が半分まで下がったら新しい核はもうできない
 *   (過飽和が下がると核生成の頻度は急に落ちる)。置いた核は育ち、離散した
 *   島の組織になる。
 * - 右(スピノーダル): c0 = 0.5。初期の微小なゆらぎ(振幅 0.01)だけから、
 *   一斉に迷路が現れる。
 * 同じ色(2 色補間)・同じ描き方で、違いは形(島か迷路か)だけで見せる(§0-1)。
 *
 * 格子は 128² × 2 枚。仕様の 64² では、組成 0.12 の B リッチ相の量(5.7%)が
 * 島 1 個ぶんにしかならず、オストワルド成長ですぐ 1 個に減ってしまう(試作で
 * 確認)ため、島が複数残る大きさにした。1 フレームの計算は 8 ms 以内に自動で
 * 抑える。
 *
 * 実装方式: 2D Canvas / onFrame。初期は停止・時刻 0。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { mulberry32 } from "../../core/mathx";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { CahnHilliard, DT } from "./lib/cahnhilliard";
import { StepBudget } from "./lib/budget";
import { FieldImage, fmtSig, font, resolvePalette } from "./lib/draw";
import { binodal, chiFromT, T_REP } from "./lib/regular";

const GRID_N = 128;
const FALLBACK_N = 64;
const CHI = chiFromT(T_REP);
/** 左右の組成(§5.1) */
const C_NUCLEATION = 0.12;
const C_SPINODAL = 0.5;
const NOISE = 0.01;
const SEED_LEFT = 11;
const SEED_RIGHT = 12;
const SEED_EVENTS = 1906;
/** 核の半径(臨界半径 2〜3 より大きい)・最大個数・平均の発生間隔 [時間] */
const NUCLEUS_R = 4;
const NUCLEUS_MAX = 10;
const MEAN_INTERVAL = 18;
/** 既存の島から離す距離(核の半径 + この値の範囲に B リッチがあれば置かない) */
const CLEARANCE = 4;
/** 置く位置を探す回数 */
const PLACE_TRIES = 20;
/**
 * 1 フレームのステップ数(左右それぞれ。Δt = 0.5 なので 60 fps で時間 30 / 秒)。
 * 迷路が数秒で粗くなりすぎず、核の発生(0.6 秒に 1 個)と見比べられる速さ
 */
const STEPS_PER_FRAME = 1;
/** 島の数を数える間隔 [フレーム] */
const COUNT_EVERY = 10;

export default function twoMechanisms(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const fieldL = new FieldImage(pal.matrix, pal.second);
  const fieldR = new FieldImage(pal.matrix, pal.second);
  const budget = new StepBudget(8, 2);
  const cBeta = 1 - binodal(CHI);
  const cAlpha = binodal(CHI);
  /** 核ができなくなる母相の組成(過飽和が初期の半分) */
  const stopLevel = cAlpha + 0.5 * (C_NUCLEATION - cAlpha);

  let n = GRID_N;
  let left = new CahnHilliard({ nx: n, ny: n, chi: CHI, dt: DT });
  let right = new CahnHilliard({ nx: n, ny: n, chi: CHI, dt: DT });
  let labels = new Int32Array(n * n);
  let stack = new Int32Array(n * n);
  let rand = mulberry32(SEED_EVENTS);
  let nextEvent = 0;
  let placed = 0;
  let islands = 0;
  let areaFraction = 0;
  let frame = 0;

  const readout = createReadout(host);
  const roTime = readout.item("経過時間");
  const roIslands = readout.item("左の島の数");
  const roArea = readout.item("右の B リッチ相の面積");

  host.controls.playPause();
  host.controls.reset(() => {
    init();
    host.setPlaying(false);
  });

  function init(): void {
    left.initUniform(C_NUCLEATION, NOISE, SEED_LEFT);
    right.initUniform(C_SPINODAL, NOISE, SEED_RIGHT);
    rand = mulberry32(SEED_EVENTS);
    nextEvent = -MEAN_INTERVAL * Math.log(1 - rand());
    placed = 0;
    measure();
  }

  /** 平均の母相組成(c < 1/2 の格子点の平均) */
  function matrixMean(sim: CahnHilliard): number {
    let s = 0;
    let k = 0;
    for (let i = 0; i < sim.size; i++) {
      if (sim.c[i] < 0.5) {
        s += sim.c[i];
        k++;
      }
    }
    return k > 0 ? s / k : 0;
  }

  /** (cx, cy) の半径 r の近くに B リッチの格子点がないか */
  function isClear(cx: number, cy: number, r: number): boolean {
    const reach = Math.ceil(r);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = (((Math.round(cx) + dx) % n) + n) % n;
        const y = (((Math.round(cy) + dy) % n) + n) % n;
        if (left.c[y * n + x] > 0.5) return false;
      }
    }
    return true;
  }

  /** 核の発生(乱数で模擬)。時刻が来た事象を処理する */
  function nucleate(): void {
    while (left.time >= nextEvent && placed < NUCLEUS_MAX) {
      nextEvent += -MEAN_INTERVAL * Math.log(1 - rand());
      if (matrixMean(left) < stopLevel) continue;
      for (let k = 0; k < PLACE_TRIES; k++) {
        const cx = Math.floor(rand() * n);
        const cy = Math.floor(rand() * n);
        if (!isClear(cx, cy, NUCLEUS_R + CLEARANCE)) continue;
        left.addDisk(cx, cy, NUCLEUS_R, cBeta, true);
        placed++;
        break;
      }
    }
  }

  /** 左の島の数(周期境界のつながり)と右の B リッチ相の面積の割合 */
  function measure(): void {
    labels.fill(0);
    let count = 0;
    let top = 0;
    const c = left.c;
    const visit = (j: number): void => {
      if (labels[j] === 0 && c[j] > 0.5) {
        labels[j] = count;
        stack[top++] = j;
      }
    };
    for (let start = 0; start < n * n; start++) {
      if (labels[start] !== 0 || c[start] <= 0.5) continue;
      count++;
      top = 0;
      stack[top++] = start;
      labels[start] = count;
      while (top > 0) {
        const i = stack[--top];
        const x = i % n;
        const y = (i - x) / n;
        visit(y * n + ((x + 1) % n));
        visit(y * n + ((x + n - 1) % n));
        visit(((y + 1) % n) * n + x);
        visit(((y + n - 1) % n) * n + x);
      }
    }
    islands = count;
    let b = 0;
    for (let i = 0; i < right.size; i++) if (right.c[i] > 0.5) b++;
    areaFraction = b / right.size;
  }

  function shrinkGrid(): void {
    n = FALLBACK_N;
    left = new CahnHilliard({ nx: n, ny: n, chi: CHI, dt: DT });
    right = new CahnHilliard({ nx: n, ny: n, chi: CHI, dt: DT });
    labels = new Int32Array(n * n);
    stack = new Int32Array(n * n);
    budget.reset(0.5);
    init();
  }

  /* ---- レイアウト ---- */
  interface Panel {
    x: number;
    y: number;
    side: number;
  }

  function layout(): { left: Panel; right: Panel; narrow: boolean } {
    const { w, h } = host.size;
    const stacked = w < h * 1.25;
    const labelH = 26;
    if (!stacked) {
      const gap = 24;
      const side = Math.min((w - gap - 24) / 2, h - labelH - 16);
      const x0 = (w - 2 * side - gap) / 2;
      const y0 = labelH + (h - labelH - side) / 2;
      return {
        left: { x: x0, y: y0, side },
        right: { x: x0 + side + gap, y: y0, side },
        narrow: w < 560,
      };
    }
    const gap = labelH + 10;
    const side = Math.min(w - 16, (h - 2 * labelH - 18) / 2);
    const x0 = (w - side) / 2;
    return {
      left: { x: x0, y: labelH + 4, side },
      right: { x: x0, y: labelH + 4 + side + gap, side },
      narrow: true,
    };
  }

  function drawPanel(
    p: Panel,
    image: FieldImage,
    sim: CahnHilliard,
    title: string,
    sub: string,
    narrow: boolean,
  ): void {
    image.update(sim.c, n);
    image.draw(ctx, p.x, p.y, p.side);
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - 0.5, p.y - 0.5, p.side + 1, p.side + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.font = font(narrow ? 12.5 : 14, 600);
    ctx.fillStyle = pal.text;
    ctx.fillText(title, p.x, p.y - 6);
    const tw = ctx.measureText(title).width;
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = pal.text2;
    ctx.fillText(sub, p.x + tw + 10, p.y - 6);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout();
    drawPanel(
      L.left,
      fieldL,
      left,
      "準安定: 核が要る",
      `c₀ = ${C_NUCLEATION}`,
      L.narrow,
    );
    drawPanel(
      L.right,
      fieldR,
      right,
      "不安定: 核は要らない",
      `c₀ = ${C_SPINODAL}`,
      L.narrow,
    );

    roTime.set(fmtSig(left.time, 3));
    roIslands.set(`${islands} 個`);
    roArea.set(`${Math.round(areaFraction * 100)}%`);
  }

  host.onFrame(() => {
    const steps = budget.steps(STEPS_PER_FRAME);
    const t0 = performance.now();
    for (let s = 0; s < steps; s++) {
      nucleate();
      left.step(1);
      right.step(1);
    }
    budget.record(steps, performance.now() - t0);
    if (n === GRID_N && budget.overBudget()) shrinkGrid();
    frame++;
    if (frame % COUNT_EVERY === 0) measure();
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
