/**
 * uphill-diffusion.ts — 図4「上り坂拡散」(記事の山場 — 記事仕様書 09 §5.4)
 *
 * 上段: 64 × 32 の正方格子の原子(A = --mat-matrix、B = --mat-second の丸。
 * カーケンドール効果の記事の buildSiteGrid・drawAtoms と同じ描き方)。
 * 「原子の入れ替わりを表示」が on のとき、直近 0.3 秒(18 掃引)に入れ替わった
 * 対を細い線で結ぶ(入れ替わりがどの向きにもランダムに起きていることを見せる。
 * 線が混み合わないよう、受け入れた入れ替えを間引いて記録する)。
 * 下段: 列ごとの B の割合(濃度プロファイル)。現在(--mat-second)と初期の
 * ゴースト(--color-hairline)、波の成分(なめらかな線)。右端に、初期に入れた
 * 波(波長 16)の振幅の時間変化の小さなグラフ。
 *
 * 模型は lib/latticegas.ts(カワサキ動力学)。1 フレームあたり 1 掃引
 * (2048 回の試行)。試行の向きは 4 方向から一様に選ぶ — 偏っているのは
 * 受け入れの確率だけ。省モーション時は自動再生せず、「再生」で 300 掃引ぶんを
 * 内部で進めた状態を 1 フレームで描く。
 *
 * 簡略化(図注): 空孔を介さず隣どうしが直接入れ替わる模型、2 次元、時間は
 * 大きく加速。格子気体ではゆらぎのため、育つか消えるかの境目は T_c 付近で
 * 曖昧になる。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { buildSiteGrid } from "../kirkendall-effect/lib/lattice";
import {
  drawAtoms,
  makeLatticeView,
  viewX,
  viewY,
} from "../kirkendall-effect/lib/draw";
import { ATOM_B, LatticeGas } from "./lib/latticegas";
import { fmtSig, font, resolvePalette } from "./lib/draw";

/** 格子と初期の波(§5.4) */
const COLS = 64;
const ROWS = 32;
const MEAN_B = 0.5;
const WAVE_AMP = 0.15;
const WAVELENGTH = 16;
/** シード(単体テスト T8 と同じ。T/Tc = 0.6 で 300 掃引後 1.65 倍・1.5 で 0.09 倍) */
const SEED = 20261023;
/** 温度スライダー(0.4〜2.0・step 0.05・初期 0.6) */
const T_INIT = 0.6;
/** 入れ替わりの線を残す掃引数(1 掃引 / フレーム → 約 0.3 秒) */
const SWAP_WINDOW = 18;
/** 画面に出す入れ替わりの線のおおよその本数 */
const SWAP_LINES_TARGET = 160;
/**
 * 「濃い列へ向かう正味の移動」の向きを言い切るしきい値 [個]。リセット(または
 * 温度の変更)からの累計で数える — 数掃引の窓では雑音に埋もれるため
 */
const FLUX_THRESHOLD = 10;
/** 省モーション時に 1 回の「再生」で進める掃引数 */
const REDUCED_SWEEPS = 300;
/** 振幅の履歴の長さ [掃引] */
const HISTORY = 4000;
/** 原子の半径(格子間隔に対する割合) */
const ATOM_RATIO = 0.36;

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function uphillDiffusion(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  const grid = buildSiteGrid(COLS, ROWS / 2);
  const gas = new LatticeGas(COLS, ROWS);
  const profile = new Float64Array(COLS);
  const profile0 = new Float64Array(COLS);
  const wave = { a: 0, b: 0 };
  const history = new Float64Array(HISTORY);
  /** 描画バッファ(毎フレームの割当てを避ける — §8.3) */
  const bufAX = new Float64Array(grid.count);
  const bufAY = new Float64Array(grid.count);
  const bufBX = new Float64Array(grid.count);
  const bufBY = new Float64Array(grid.count);

  let tOverTc = T_INIT;
  let showSwaps = true;
  let amp0 = 1;
  let historyLen = 0;
  let acceptedEma = 50;
  /** 濃い列の側へ動いた B の正味の数と、数え始めてからの掃引数 */
  let fluxTotal = 0;
  let fluxSweeps = 0;

  const readout = createReadout(host);
  const roAmp = readout.item("波の振幅");
  const roFlux = readout.item("濃い列へ向かう正味の移動");
  const roAcc = readout.item("受け入れられた入れ替わり");
  const roSweeps = readout.item("掃引");

  const tCtl = host.controls.slider({
    id: "t",
    label: "温度 T/Tc",
    min: 0.4,
    max: 2,
    step: 0.05,
    value: T_INIT,
  });
  tCtl.onChange((v) => {
    tOverTc = v;
    gas.setTemperature(v);
    // 温度を変えたら、正味の移動はそこから数え直す
    fluxTotal = 0;
    fluxSweeps = 0;
  });
  const swapCtl = host.controls.toggle({
    id: "swaps",
    label: "原子の入れ替わりを表示",
    value: true,
  });
  swapCtl.onChange((v) => {
    showSwaps = v;
  });
  host.controls.playPause();
  host.controls.reset(() => {
    tCtl.set(T_INIT);
    swapCtl.set(true);
    init();
    host.setPlaying(false);
  });

  function init(): void {
    gas.setTemperature(tOverTc);
    gas.initWave(MEAN_B, WAVE_AMP, WAVELENGTH, SEED);
    gas.columnProfile(profile0);
    profile.set(profile0);
    amp0 = gas.waveComponent(profile0, WAVELENGTH, wave);
    history[0] = 1;
    historyLen = 1;
    fluxTotal = 0;
    fluxSweeps = 0;
    acceptedEma = 50;
  }

  /** 1 掃引進め、プロファイル・振幅・正味の移動を更新する */
  function sweepOnce(): void {
    // 線の数がおおよそ一定になるよう、記録の間引きを受け入れの頻度に合わせる
    gas.swapLogStride = Math.max(
      1,
      Math.round((acceptedEma * SWAP_WINDOW) / SWAP_LINES_TARGET),
    );
    const acc0 = gas.accepted;
    gas.resetFlux();
    gas.sweep(1);
    acceptedEma += 0.2 * (gas.accepted - acc0 - acceptedEma);
    // 正味の移動を、いまの波の向き(単位振幅の cos)に射影する
    const k = (2 * Math.PI) / WAVELENGTH;
    const phase = Math.atan2(wave.b, wave.a);
    let s = 0;
    for (let x = 0; x < COLS; x++) {
      const d = Math.cos(k * (x + 1) - phase) - Math.cos(k * x - phase);
      s += gas.netFlux[x] * d;
    }
    fluxTotal += s;
    fluxSweeps++;
    gas.columnProfile(profile);
    const a = gas.waveComponent(profile, WAVELENGTH, wave);
    if (historyLen < HISTORY) history[historyLen++] = a / amp0;
  }

  /* ---- レイアウト ---- */
  interface Layout {
    narrow: boolean;
    lattice: { x: number; y: number; w: number; h: number };
    prof: { x: number; y: number; w: number; h: number };
    amp: { x: number; y: number; w: number; h: number };
  }

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const header = 20;
    // 格子(64 × 32 = 横 2 : 縦 1)が収まる高さ以上は取らない(余白を下段に回す)
    const latticeNatural = ((w - 2 * pad) / COLS) * ROWS + 6;
    const topH = Math.round(Math.min((h - header) * 0.6, latticeNatural + pad));
    const latticeBox = {
      x: pad,
      y: pad + header,
      w: w - 2 * pad,
      h: topH - pad,
    };
    const bottomY = pad + header + topH + 30;
    // 下段: 軸の文字と凡例の行のぶん(34px)を下に残す
    const bottomH = h - bottomY - 36;
    if (narrow) {
      return {
        narrow,
        lattice: latticeBox,
        prof: { x: 36, y: bottomY, w: w * 0.6 - 36, h: bottomH },
        amp: { x: w * 0.6 + 34, y: bottomY, w: w * 0.4 - 34 - pad, h: bottomH },
      };
    }
    return {
      narrow,
      lattice: latticeBox,
      prof: { x: 44, y: bottomY, w: w * 0.68 - 44, h: bottomH },
      amp: { x: w * 0.68 + 44, y: bottomY, w: w * 0.32 - 44 - pad, h: bottomH },
    };
  }

  /* ---- 描画 ---- */
  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout();
    drawLattice(L);
    drawProfile(L);
    drawAmplitude(L);

    const ratio = history[historyLen - 1];
    roAmp.set(`初期の ${ratio.toFixed(2)} 倍`);
    const s = fluxTotal;
    roFlux.set(
      fluxSweeps === 0
        ? "—"
        : s >= FLUX_THRESHOLD
          ? `濃い方へ(正味 +${Math.round(s)} 個)`
          : s <= -FLUX_THRESHOLD
            ? `薄い方へ(正味 −${Math.round(-s)} 個)`
            : "はっきりしない(ほぼ釣り合い)",
    );
    roAcc.set(
      gas.attempted > 0
        ? `${Math.round((100 * gas.accepted) / gas.attempted)}%`
        : "—",
    );
    roSweeps.set(String(gas.sweeps));
  }

  function drawLattice(L: Layout): void {
    const box = L.lattice;
    // 凡例(上の帯)
    ctx.font = font(L.narrow ? 10.5 : 11.5);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const ly = box.y - 11;
    let lx = box.x + 2;
    const legend: Array<[string, string, string]> = [
      [pal.matrix, pal.matrixEdge, "A 原子"],
      [pal.second, pal.secondEdge, "B 原子"],
    ];
    for (const [fill, edge, label] of legend) {
      ctx.beginPath();
      ctx.arc(lx + 5, ly, 5, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.fillStyle = pal.text2;
      ctx.fillText(label, lx + 14, ly);
      lx += 14 + ctx.measureText(label).width + 16;
    }
    if (showSwaps) {
      ctx.strokeStyle = pal.text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 14, ly);
      ctx.stroke();
      ctx.fillStyle = pal.text2;
      ctx.fillText(
        L.narrow ? "入れ替わった対" : "直近に入れ替わった隣どうしの対",
        lx + 20,
        ly,
      );
    }
    ctx.textAlign = "right";
    ctx.fillText(`T/Tc = ${tOverTc.toFixed(2)}`, box.x + box.w - 2, ly);

    const view = makeLatticeView(box.x, box.y, box.w, box.h, COLS, ROWS);
    const r = Math.max(1.2, ATOM_RATIO * view.scale);
    let na = 0;
    let nb = 0;
    for (let i = 0; i < grid.count; i++) {
      const x = viewX(view, grid.px[i]);
      const y = viewY(view, grid.py[i]);
      if (gas.occ[i] === ATOM_B) {
        bufBX[nb] = x;
        bufBY[nb] = y;
        nb++;
      } else {
        bufAX[na] = x;
        bufAY[na] = y;
        na++;
      }
    }
    drawAtoms(ctx, bufAX, bufAY, na, r, pal.matrix, pal.matrixEdge);
    drawAtoms(ctx, bufBX, bufBY, nb, r, pal.second, pal.secondEdge);

    if (!showSwaps) return;
    const now = gas.sweeps;
    const cap = gas.swapSiteA.length;
    const count = Math.min(gas.swapLogCount, cap);
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = Math.max(1.25, Math.min(2, view.scale * 0.18));
    ctx.lineCap = "round";
    // 古さで 3 段に分けて薄くする(パスをまとめて描く — §8.3)
    for (let band = 0; band < 3; band++) {
      ctx.globalAlpha = [0.85, 0.5, 0.22][band];
      ctx.beginPath();
      for (let k = 0; k < count; k++) {
        const age = now - gas.swapTime[k];
        if (age < 0 || age > SWAP_WINDOW) continue;
        if (Math.min(2, Math.floor((age / SWAP_WINDOW) * 3)) !== band) continue;
        const a = gas.swapSiteA[k];
        const b = gas.swapSiteB[k];
        // 周期境界をまたぐ対は描かない(画面の端から端へ線が伸びるため)
        if (Math.abs(grid.px[a] - grid.px[b]) > 1.5) continue;
        if (Math.abs(grid.py[a] - grid.py[b]) > 1.5) continue;
        ctx.moveTo(viewX(view, grid.px[a]), viewY(view, grid.py[a]));
        ctx.lineTo(viewX(view, grid.px[b]), viewY(view, grid.py[b]));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  function drawProfile(L: Layout): void {
    const p = L.prof;
    const mapX = (x: number): number => p.x + ((x + 0.5) / COLS) * p.w;
    const mapY = (v: number): number => p.y + p.h - v * p.h;
    ctx.font = font(L.narrow ? 10.5 : 11.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      L.narrow ? "列ごとの B の割合" : "列ごとの B の割合(濃度プロファイル)",
      p.x - 30,
      p.y - 10,
    );
    // 軸
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y);
    ctx.lineTo(p.x + 0.5, p.y + p.h + 0.5);
    ctx.lineTo(p.x + p.w, p.y + p.h + 0.5);
    ctx.moveTo(p.x, mapY(0.5) + 0.5);
    ctx.lineTo(p.x + p.w, mapY(0.5) + 0.5);
    ctx.stroke();
    ctx.font = font(10);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [0, 0.5, 1]) ctx.fillText(v.toFixed(1), p.x - 4, mapY(v));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("列(左右の位置)", p.x + p.w / 2, p.y + p.h + 4);

    const line = (data: Float64Array, color: string, width: number) => {
      ctx.beginPath();
      for (let x = 0; x < COLS; x++) {
        if (x === 0) ctx.moveTo(mapX(x), mapY(data[x]));
        else ctx.lineTo(mapX(x), mapY(data[x]));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    // 初期のゴースト・現在・波の成分
    line(profile0, pal.hairline, 3);
    line(profile, pal.second, 1.5);
    const k = (2 * Math.PI) / WAVELENGTH;
    ctx.beginPath();
    for (let s = 0; s <= COLS * 4; s++) {
      const x = s / 4 - 0.5;
      const v = MEAN_B + wave.a * Math.cos(k * x) + wave.b * Math.sin(k * x);
      if (s === 0) ctx.moveTo(mapX(x), mapY(v));
      else ctx.lineTo(mapX(x), mapY(v));
    }
    ctx.strokeStyle = pal.secondEdge;
    ctx.lineWidth = 2.25;
    ctx.stroke();

    // 凡例(軸の文字の下に 1 行: 線の見本 + 名前)
    ctx.font = font(10);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const items: Array<[string, number, string]> = [
      [pal.hairline, 3, "初期"],
      [pal.second, 1.5, "現在"],
      [pal.secondEdge, 2.25, "波の成分"],
    ];
    let lx = p.x - 30;
    const ly = p.y + p.h + 25;
    for (const [color, width, label] of items) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 16, ly);
      ctx.stroke();
      ctx.fillStyle = pal.text2;
      ctx.fillText(label, lx + 20, ly);
      lx += 20 + ctx.measureText(label).width + 12;
    }
  }

  function drawAmplitude(L: Layout): void {
    const p = L.amp;
    const span = Math.max(600, historyLen);
    const yMax = 2.5;
    const mapX = (i: number): number => p.x + (i / span) * p.w;
    const mapY = (v: number): number =>
      p.y + p.h - (Math.min(v, yMax) / yMax) * p.h;
    ctx.font = font(L.narrow ? 10.5 : 11.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("波の振幅(初期 = 1)", p.x - 26, p.y - 10);
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y);
    ctx.lineTo(p.x + 0.5, p.y + p.h + 0.5);
    ctx.lineTo(p.x + p.w, p.y + p.h + 0.5);
    ctx.moveTo(p.x, mapY(1) + 0.5);
    ctx.lineTo(p.x + p.w, mapY(1) + 0.5);
    ctx.stroke();
    ctx.font = font(10);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [0, 1, 2]) ctx.fillText(String(v), p.x - 4, mapY(v));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`掃引(0〜${fmtSig(span, 2)})`, p.x + p.w / 2, p.y + p.h + 4);
    ctx.beginPath();
    for (let i = 0; i < historyLen; i++) {
      if (i === 0) ctx.moveTo(mapX(i), mapY(history[i]));
      else ctx.lineTo(mapX(i), mapY(history[i]));
    }
    ctx.strokeStyle = pal.second;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ---- フレームループ ---- */
  const reduced = prefersReducedMotion();
  host.onFrame((dt) => {
    if (dt > 0) {
      if (reduced) {
        for (let s = 0; s < REDUCED_SWEEPS; s++) sweepOnce();
        draw();
        host.setPlaying(false);
        return;
      }
      sweepOnce();
    }
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
