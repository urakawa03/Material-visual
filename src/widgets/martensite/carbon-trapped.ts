/**
 * carbon-trapped.ts — 図2「炭素が逃げられない」(記事仕様書 10 §5.2)
 *
 * 左: 面心立方の鉄の (100) 面(`_shared/lattice2d.ts` の rigid モードの正方
 * 格子を、カーケンドール効果の記事の buildSiteGrid 経由で使う)。格子点の
 * 市松の半分が鉄、残り半分が八面体位置(隙間)で、炭素はそこに入っている。
 * 炭素は隣の八面体位置(斜め隣)へランダムに跳ぶ。直近の軌跡を薄く残す。
 * 右上: 温度計と、1 秒あたりの跳躍回数(実際の値)の対数目盛り。
 * 右下: 冷却中に炭素が動けた距離 √(2∫D dt) と、パーライトの縞の間隔の目安。
 *
 * 画面上の跳躍は「実際の頻度の対数に比例した見かけの頻度」で描く(§5.2。
 * 実際の比で描くと高温では速すぎ、低温では止まって見える)。温度が
 * 150 ℃ を下回り跳躍がほぼ止まったら描画も止める。冷却は図1 と同じ
 * ニュートン冷却で、画面の時間は冷やし方ごとに伸び縮みさせる(図注)。
 *
 * 動けた距離は 2 本の棒で示す(仕様書からの変更点 — 下記)。
 * - 薄い棒: A₁ 以下の合計(仕様書 §5.2 の定義どおり)
 * - 濃い棒: C 曲線が 10 秒より左にある温度域(鼻のまわり、約 420〜620 ℃)を
 *   通る間の分。炭化物の核ができうるのはこの温度域だけなので、パーライトの
 *   縞の間隔と比べる意味があるのはこちら。Callister の D では水冷でも A₁ 以下の
 *   合計は約 0.2 μm になり、そのほとんどは A₁ のすぐ下(まだ核ができない温度)で
 *   稼がれる(lib/kinetics.test.ts の T3)。
 *
 * 実装方式: 2D / onFrame(冷却中と、温度が高く跳躍が見える間)。乱数は
 * mulberry32(シード固定)で、reset で同じ初期配置に戻る。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp, easeOutCubic, mulberry32 } from "../../core/mathx";
import { formatDuration } from "../../core/units";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { buildSiteGrid } from "../kirkendall-effect/lib/lattice";
import {
  A1_C,
  T_AUSTENITIZE_C,
  coolingMedium,
  toK,
  type CoolingId,
} from "./lib/constants";
import {
  createDiffusionTable,
  fastPearliteWindowC,
  hopFrequency,
  newtonTempC,
  newtonTimeS,
} from "./lib/kinetics";
import {
  MIN_CANVAS_PX,
  type Pane,
  context2d,
  fmtPow10,
  fmtSci,
  font,
  makeScale,
  mapScale,
  plateText,
  prefersReducedMotion,
  resolvePalette,
  subLabel,
} from "./lib/draw";

/** 格子の列数と上下半分の行数(rigid モードの正方格子) */
const COLS = 15;
const ROWS_PER_HALF = 6;
/** 炭素原子の数(§5.2) */
const CARBON_COUNT = 12;
/** 乱数シード(reset で同じ初期配置へ — §8.2) */
const SEED = 1077;
/** 軌跡に残す直近の位置の数 */
const TRAIL = 10;
/** 跳躍の補間時間 [s](見た目のみ) */
const HOP_ANIM_S = 0.12;
/** 850 ℃ での見かけの跳躍頻度 [回/秒・1 原子](画面上) */
const SCREEN_RATE_MAX = 3.2;
/** 跳躍が止まったとみなして描画を止める温度 [℃](§5.2) */
const STOP_C = 150;
/** 850 ℃ → STOP_C の冷却を画面上で何秒かけて見せるか(冷やし方によらず) */
const COOL_WALL_S = 8;
/** 跳躍回数の目盛りの範囲 [回/秒](§5.2: 10⁻¹⁰〜10⁸) */
const HOP_LOG_MIN = -10;
const HOP_LOG_MAX = 8;
/** 動けた距離の軸の範囲 [μm] */
const DIST_MIN_UM = 1e-3;
const DIST_MAX_UM = 10;
/** パーライトの縞の間隔の目安 [μm](§5.2: 0.1〜1 μm) */
const LAMELLA_MIN_UM = 0.1;
const LAMELLA_MAX_UM = 1;
/** 初期状態(§5.2: 水・850 ℃・停止) */
const INIT_MEDIUM: CoolingId = "water";

/** 4 つの斜め隣(八面体位置 → 八面体位置。(100) 面内の跳躍) */
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

type Stage = "hold" | "cooling" | "done";

/** 見かけの跳躍頻度の目盛りの両端(実際の頻度の対数で線形に縮める) */
const LOG_RATE_TOP = Math.log10(hopFrequency(toK(T_AUSTENITIZE_C)));
const LOG_RATE_BOTTOM = Math.log10(hopFrequency(toK(STOP_C)));

/** 実際の跳躍頻度 Γ から、画面上の見かけの跳躍頻度 [回/秒] を作る(§5.2) */
function screenHopRate(tempC: number): number {
  const lg = Math.log10(hopFrequency(toK(tempC)));
  return (
    SCREEN_RATE_MAX *
    clamp((lg - LOG_RATE_BOTTOM) / (LOG_RATE_TOP - LOG_RATE_BOTTOM), 0, 1)
  );
}

export default function carbonTrapped(host: FigureHost): WidgetHandle {
  const ctx = context2d(host.canvas);
  const pal = resolvePalette();
  const reduced = prefersReducedMotion();
  /** 鼻のまわり(C 曲線が 10 秒より左)の温度域 */
  const noseWin = fastPearliteWindowC();
  /** 冷却中の拡散距離の表(毎フレームの積分を避ける) */
  const diffTable = createDiffusionTable(STOP_C);

  /* ---- 格子(rigid モードの正方格子を市松に分ける)---- */
  const grid = buildSiteGrid(COLS, ROWS_PER_HALF);
  const cols = grid.cols;
  const rows = grid.rows;
  const isFe = (s: number): boolean =>
    ((s % cols) + Math.floor(s / cols)) % 2 === 0;
  /** 八面体位置(縁を除く)の一覧 */
  const octSites: number[] = [];
  for (let s = 0; s < grid.count; s++) {
    const c = s % cols;
    const r = Math.floor(s / cols);
    if (!isFe(s) && c > 0 && c < cols - 1 && r > 0 && r < rows - 1) {
      octSites.push(s);
    }
  }

  /* ---- 炭素の状態 ---- */
  const site = new Int32Array(CARBON_COUNT);
  const fromSite = new Int32Array(CARBON_COUNT);
  const hopT = new Float64Array(CARBON_COUNT);
  const trail = new Int32Array(CARBON_COUNT * TRAIL);
  const trailLen = new Int32Array(CARBON_COUNT);
  const occupied = new Uint8Array(grid.count);
  let rand = mulberry32(SEED);

  function initCarbon(): void {
    rand = mulberry32(SEED);
    occupied.fill(0);
    for (let i = 0; i < CARBON_COUNT; i++) {
      let s = octSites[Math.floor(rand() * octSites.length)];
      while (occupied[s]) s = octSites[Math.floor(rand() * octSites.length)];
      occupied[s] = 1;
      site[i] = s;
      fromSite[i] = -1;
      hopT[i] = 0;
      trail[i * TRAIL] = s;
      trailLen[i] = 1;
    }
  }

  /** 炭素 i を斜め隣の空いた八面体位置へ 1 回跳ばす(格子の外・占有は棄却) */
  function tryHop(i: number, animate: boolean): void {
    const s = site[i];
    const c = s % cols;
    const r = Math.floor(s / cols);
    const d = DIAG[Math.floor(rand() * 4)];
    const nc = c + d[0];
    const nr = r + d[1];
    if (nc < 1 || nc > cols - 2 || nr < 1 || nr > rows - 2) return;
    const ns = nr * cols + nc;
    if (occupied[ns]) return;
    occupied[s] = 0;
    occupied[ns] = 1;
    site[i] = ns;
    fromSite[i] = animate ? s : -1;
    hopT[i] = 0;
    // 軌跡(リングではなく末尾に足して古いものを押し出す)
    const base = i * TRAIL;
    if (trailLen[i] < TRAIL) {
      trail[base + trailLen[i]] = ns;
      trailLen[i]++;
    } else {
      for (let k = 0; k < TRAIL - 1; k++) trail[base + k] = trail[base + k + 1];
      trail[base + TRAIL - 1] = ns;
    }
  }

  /* ---- 冷却の状態 ---- */
  let medium: CoolingId = INIT_MEDIUM;
  let stage: Stage = "hold";
  /** 冷却開始からの実時間 [s] */
  let tReal = 0;
  let tempC = T_AUSTENITIZE_C;

  const tau = (): number => coolingMedium(medium).tauS;
  /** 画面 1 秒あたりの実時間 [s](850 → 150 ℃ を COOL_WALL_S 秒で見せる) */
  const realPerWall = (): number => newtonTimeS(STOP_C, tau()) / COOL_WALL_S;

  function resetState(): void {
    stage = "hold";
    tReal = 0;
    tempC = T_AUSTENITIZE_C;
    initCarbon();
  }

  /* ---- 読み取り値(§5.2) ---- */
  const readout = createReadout(host);
  const rTemp = readout.item("温度");
  const rHop = readout.item("1 秒あたりの跳躍回数");
  const rTime = readout.item("冷やし始めてから");
  const rNose = readout.item("動けた距離(鼻のまわりで)");
  const rTotal = readout.item("(A₁ 以下の合計)");

  function distances(): { nose: number; total: number } {
    if (stage === "hold") return { nose: 0, total: 0 };
    const t = tau();
    return {
      nose: diffTable.length(t, Math.max(tempC, noseWin.loC), noseWin.hiC),
      total: diffTable.length(t, tempC, A1_C),
    };
  }

  function fmtUm(m: number): string {
    const um = m * 1e6;
    if (um === 0) return "0";
    if (um < 0.01) return um.toPrecision(1);
    return um < 1 ? um.toFixed(2) : um.toPrecision(2);
  }

  function updateReadouts(): void {
    rTemp.set(`${Math.round(tempC)} ℃`);
    rHop.set(`${fmtSci(hopFrequency(toK(tempC)), 2)} 回`);
    rTime.set(stage === "hold" ? "—" : formatDuration(tReal));
    const d = distances();
    rNose.set(stage === "hold" ? "—" : `${fmtUm(d.nose)} μm`);
    rTotal.set(stage === "hold" ? "—" : `${fmtUm(d.total)} μm`);
  }

  /* ---- 操作部品(§5.2) ---- */
  const seg = host.controls.segmented<CoolingId>({
    id: "medium",
    label: "冷やし方",
    options: [
      { value: "air", label: "空気" },
      { value: "water", label: "水" },
    ],
    value: INIT_MEDIUM,
  });
  seg.onChange((v) => {
    medium = v;
    resetState();
    host.setPlaying(false);
    updateReadouts();
    host.requestRender();
  });

  const coolBtn = host.controls.button({ label: "冷やす" });
  coolBtn.onClick(() => {
    resetState();
    stage = "cooling";
    if (reduced) {
      // 省モーション: 冷却を一気に進め、炭素がその場に残った最終状態を描く
      finishInstantly();
      updateReadouts();
      host.requestRender();
      return;
    }
    host.setPlaying(true);
  });

  host.controls.playPause();
  host.controls.reset(() => {
    seg.set(INIT_MEDIUM);
    medium = INIT_MEDIUM;
    resetState();
    host.setPlaying(false);
    updateReadouts();
  });

  /* ---- 時間発展 ---- */

  /** 画面の dt 秒ぶん進める(冷却中なら温度も下げる) */
  function advance(dt: number, animate: boolean): void {
    if (stage === "done") return;
    if (stage === "cooling") {
      tReal += dt * realPerWall();
      tempC = newtonTempC(tReal, tau());
      if (tempC <= STOP_C) {
        tempC = STOP_C;
        tReal = newtonTimeS(STOP_C, tau());
        stage = "done";
      }
    }
    const rate = screenHopRate(tempC);
    const p = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < CARBON_COUNT; i++) {
      if (animate && fromSite[i] >= 0) {
        hopT[i] += dt;
        if (hopT[i] >= HOP_ANIM_S) fromSite[i] = -1;
      }
      if (rand() < p) tryHop(i, animate);
    }
  }

  /** 省モーション用: 同じ規則で最後まで一気に進める(補間なし) */
  function finishInstantly(): void {
    const dt = 1 / 30;
    let guard = 0;
    while (stage !== "done" && guard < 10000) {
      advance(dt, false);
      guard++;
    }
    fromSite.fill(-1);
  }

  /* ---- レイアウト ---- */

  interface Layout {
    lattice: Pane;
    gauge: Pane;
    dist: Pane;
    narrow: boolean;
  }

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const latH = Math.round(h * 0.55);
      const rowY = latH + pad;
      const rowH = h - rowY - pad;
      const gW = Math.round((w - 3 * pad) * 0.44);
      return {
        lattice: { x: pad, y: pad, w: w - 2 * pad, h: latH - pad },
        gauge: { x: pad, y: rowY, w: gW, h: rowH },
        dist: { x: 2 * pad + gW, y: rowY, w: w - 3 * pad - gW, h: rowH },
        narrow,
      };
    }
    const latW = Math.round((w - 3 * pad) * 0.58);
    const colX = 2 * pad + latW;
    const colW = w - colX - pad;
    const gH = Math.round((h - 3 * pad) * 0.6);
    return {
      lattice: { x: pad, y: pad, w: latW, h: h - 2 * pad },
      gauge: { x: colX, y: pad, w: colW, h: gH },
      dist: { x: colX, y: 2 * pad + gH, w: colW, h: h - 3 * pad - gH },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  const posTmp = { x: 0, y: 0 };

  function drawLattice(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const top = p.y + fs + 10;
    const usableH = p.h - (top - p.y) - fs - 10;
    const spacing = Math.max(
      Math.min((p.w - 8) / (cols + 0.2), usableH / (rows + 0.2)),
      1,
    );
    const cx = p.x + p.w / 2;
    const cy = top + usableH / 2;
    const X = (lx: number): number => cx + lx * spacing;
    const Y = (ly: number): number => cy - ly * spacing;

    // 八面体位置(空き)の目印
    ctx.fillStyle = pal.hairline;
    ctx.beginPath();
    for (const s of octSites) {
      const x = X(grid.px[s]);
      const y = Y(grid.py[s]);
      ctx.moveTo(x + 1.6, y);
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    }
    ctx.fill();

    // 鉄原子(1 パスでまとめ描き)
    const rFe = spacing * 0.44;
    ctx.beginPath();
    for (let s = 0; s < grid.count; s++) {
      if (!isFe(s)) continue;
      const x = X(grid.px[s]);
      const y = Y(grid.py[s]);
      ctx.moveTo(x + rFe, y);
      ctx.arc(x, y, rFe, 0, Math.PI * 2);
    }
    ctx.fillStyle = pal.matrix;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.matrixEdge;
    ctx.stroke();

    // 炭素の軌跡(直近 TRAIL 個の位置)
    ctx.strokeStyle = pal.solute;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (let i = 0; i < CARBON_COUNT; i++) {
      const n = trailLen[i];
      if (n < 2) continue;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const s = trail[i * TRAIL + k];
        const x = X(grid.px[s]);
        const y = Y(grid.py[s]);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 炭素原子(跳躍中は補間)
    const rC = spacing * 0.25;
    ctx.beginPath();
    for (let i = 0; i < CARBON_COUNT; i++) {
      carbonPos(i, posTmp);
      const x = X(posTmp.x);
      const y = Y(posTmp.y);
      ctx.moveTo(x + rC, y);
      ctx.arc(x, y, rC, 0, Math.PI * 2);
    }
    ctx.fillStyle = pal.solute;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.soluteEdge;
    ctx.stroke();

    // 状態の一言
    let status: string;
    if (stage === "hold") {
      status = `${T_AUSTENITIZE_C} ℃(オーステナイト)— 「冷やす」を押す`;
    } else if (stage === "cooling") {
      const k = realPerWall();
      status =
        k < 1
          ? `冷却中(画面は実際の約 1/${Math.round(1 / k)} の速さ)`
          : `冷却中(画面は実際の約 ${Math.round(k)} 倍の速さ)`;
    } else if (medium === "water") {
      status = `${STOP_C} ℃ 以下: 跳躍はほぼ止まった — 炭素は閉じ込められた`;
    } else {
      status = narrow
        ? "空冷: 鼻のまわりで炭素は十分に動けた"
        : "空冷: 鼻のまわりで炭素は十分に動けた(実際はそこでパーライトになる)";
    }
    ctx.font = font(fs);
    ctx.fillStyle = stage === "done" ? pal.text : pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(status, p.x, p.y);
    ctx.fillStyle = pal.text2;
    ctx.textBaseline = "bottom";
    ctx.fillText(
      narrow
        ? "面心立方の鉄の (100) 面。灰 = 鉄、橙 = 炭素"
        : "面心立方の鉄の (100) 面。灰 = 鉄、橙 = 炭素、小さな点 = 空いた隙間",
      p.x,
      p.y + p.h,
    );
  }

  function carbonPos(i: number, out: { x: number; y: number }): void {
    const s = site[i];
    let x = grid.px[s];
    let y = grid.py[s];
    const f = fromSite[i];
    if (f >= 0 && hopT[i] < HOP_ANIM_S) {
      const e = easeOutCubic(hopT[i] / HOP_ANIM_S);
      x = grid.px[f] + (x - grid.px[f]) * e;
      y = grid.py[f] + (y - grid.py[f]) * e;
    }
    out.x = x;
    out.y = y;
  }

  function drawGauge(p: Pane, narrow: boolean): void {
    const fs = narrow ? 9.5 : 11;
    const top = p.y + fs + 16;
    const bottom = p.y + p.h - 8;
    // 温度計(0〜900 ℃)
    const thermoX = p.x + (narrow ? 26 : 32);
    const thermoW = narrow ? 10 : 12;
    const ts = makeScale(0, 900, bottom, top);
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("温度 [℃]", p.x, p.y);
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.strokeRect(thermoX + 0.5, top + 0.5, thermoW, bottom - top);
    ctx.globalAlpha = 1;
    const yT = mapScale(ts, tempC);
    ctx.fillStyle = pal.accent;
    ctx.fillRect(thermoX + 2, yT, thermoW - 3, bottom - yT);
    // 鼻のまわりの温度域(温度計の右のかぎ括弧と「鼻」)
    const yHi = Math.round(mapScale(ts, noseWin.hiC)) + 0.5;
    const yLo = Math.round(mapScale(ts, noseWin.loC)) + 0.5;
    const bx = thermoX + thermoW + 5.5;
    ctx.strokeStyle = pal.precip;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - 3, yHi);
    ctx.lineTo(bx, yHi);
    ctx.lineTo(bx, yLo);
    ctx.lineTo(bx - 3, yLo);
    ctx.stroke();
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.precip;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("鼻", bx + 3, (yHi + yLo) / 2);
    // 目盛り
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [0, 300, 600, 900]) {
      ctx.fillText(String(v), thermoX - 4, mapScale(ts, v));
    }
    // A₁ の印(温度計の左に)
    const yA1 = mapScale(ts, A1_C);
    ctx.strokeStyle = pal.text2;
    ctx.beginPath();
    ctx.moveTo(thermoX - 3, Math.round(yA1) + 0.5);
    ctx.lineTo(thermoX + thermoW + 3, Math.round(yA1) + 0.5);
    ctx.stroke();
    subLabel(
      ctx,
      "A",
      "1",
      "",
      thermoX - 5,
      yA1 + 3,
      pal.text,
      fs - 1,
      "right",
    );

    // 跳躍回数の対数目盛り(10⁻¹⁰〜10⁸)
    const hx = thermoX + thermoW + (narrow ? 50 : 62);
    const hs = makeScale(HOP_LOG_MIN, HOP_LOG_MAX, bottom, top);
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("1 秒あたりの跳躍回数", hx - (narrow ? 26 : 30), p.y);
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(hx + 0.5, top);
    ctx.lineTo(hx + 0.5, bottom);
    for (let e = HOP_LOG_MIN; e <= HOP_LOG_MAX; e += 2) {
      const y = Math.round(mapScale(hs, e)) + 0.5;
      ctx.moveTo(hx - 3, y);
      ctx.lineTo(hx + 3, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = font(fs - 1);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let e = HOP_LOG_MIN; e <= HOP_LOG_MAX; e += 2) {
      ctx.fillText(fmtPow10(10 ** e), hx - 5, mapScale(hs, e));
    }
    // 1 回/秒 の目安
    ctx.textAlign = "left";
    ctx.fillText("1 秒に 1 回", hx + 6, mapScale(hs, 0));
    // 現在値
    const lg = clamp(
      Math.log10(hopFrequency(toK(tempC))),
      HOP_LOG_MIN,
      HOP_LOG_MAX,
    );
    const yh = mapScale(hs, lg);
    ctx.beginPath();
    ctx.moveTo(hx + 1, yh);
    ctx.lineTo(hx + 10, yh - 6);
    ctx.lineTo(hx + 10, yh + 6);
    ctx.closePath();
    ctx.fillStyle = pal.solute;
    ctx.fill();
    plateText(
      ctx,
      pal,
      `${fmtSci(hopFrequency(toK(tempC)), 2)} 回`,
      hx + 14,
      yh,
      pal.soluteEdge,
      fs,
      "left",
    );
  }

  function drawDistances(p: Pane, narrow: boolean): void {
    const fs = narrow ? 9.5 : 11;
    const left = p.x + 4;
    const right = p.x + p.w - 8;
    const barH = narrow ? 14 : 18;
    const gap = narrow ? 20 : 24;
    const bandTop = p.y + (narrow ? 2 * fs + 14 : fs + 10);
    const y1 = bandTop + fs + 12;
    const y2 = y1 + barH + gap;
    const axisY = Math.min(y2 + barH + 14, p.y + p.h - fs - 8);
    const xs = makeScale(DIST_MIN_UM, DIST_MAX_UM, left, right, true);
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    if (narrow) {
      ctx.fillText("炭素が動けた距離", p.x, p.y);
      ctx.fillText("√(2∫D dt) [μm]", p.x, p.y + fs + 4);
    } else {
      ctx.fillText("炭素が動けた距離 √(2∫D dt) [μm]", p.x, p.y);
    }

    // パーライトの縞の間隔の目安(帯)
    const bx0 = mapScale(xs, LAMELLA_MIN_UM);
    const bx1 = mapScale(xs, LAMELLA_MAX_UM);
    ctx.fillStyle = pal.precip;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(bx0, bandTop, bx1 - bx0, axisY - bandTop);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.precip;
    ctx.font = font(fs - 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("パーライトの縞の間隔", (bx0 + bx1) / 2, bandTop + 2);

    // 軸
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(axisY) + 0.5);
    ctx.lineTo(right, Math.round(axisY) + 0.5);
    for (const v of [1e-3, 1e-2, 1e-1, 1, 10]) {
      const x = Math.round(mapScale(xs, v)) + 0.5;
      ctx.moveTo(x, axisY);
      ctx.lineTo(x, axisY + 4);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.text2;
    ctx.font = font(fs - 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of [1e-3, 1e-2, 1e-1, 1, 10]) {
      ctx.fillText(String(v), mapScale(xs, v), axisY + 5);
    }

    // 2 本の棒(薄 = A₁ 以下の合計、濃 = 鼻のまわり)
    const d = distances();
    const barTo = (m: number): number =>
      m > 0 ? mapScale(xs, clamp(m * 1e6, DIST_MIN_UM, DIST_MAX_UM)) : left;
    ctx.fillStyle = pal.solute;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(left, y1, barTo(d.total) - left, barH);
    ctx.globalAlpha = 1;
    ctx.fillRect(left, y2, barTo(d.nose) - left, barH);
    ctx.font = font(fs - 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = pal.text2;
    ctx.fillText(`A₁ 以下の合計  ${fmtUm(d.total)} μm`, left, y1 - 2);
    ctx.fillStyle = pal.text;
    ctx.fillText(
      narrow
        ? `鼻のまわりで  ${fmtUm(d.nose)} μm`
        : `鼻のまわり(${Math.round(noseWin.loC)}〜${Math.round(noseWin.hiC)} ℃)で  ${fmtUm(d.nose)} μm`,
      left,
      y2 - 2,
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // レイアウト前の極小キャンバスでは描かない(負の半径などを避ける)
    if (w < MIN_CANVAS_PX || h < MIN_CANVAS_PX) return;
    const l = layout();
    drawLattice(l.lattice, l.narrow);
    drawGauge(l.gauge, l.narrow);
    drawDistances(l.dist, l.narrow);
  }

  /* ---- フレームループ ---- */
  host.onFrame((dt) => {
    if (dt > 0) advance(dt, true);
    updateReadouts();
    draw();
    // 跳躍が止まったら描画も止める(§5.2)
    if (stage === "done") host.setPlaying(false);
  });
  host.onRender(() => {
    updateReadouts();
    draw();
  });

  resetState();
  updateReadouts();
  host.setPlaying(false);

  return {
    destroy(): void {
      /* キャンバスへのイベントリスナーは持たない */
    },
  };
}
