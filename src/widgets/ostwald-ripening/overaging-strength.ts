/**
 * overaging-strength.ts — 図7「間隔が開けば、するり」(記事仕様書 03 §5.7)
 *
 * 左: 時効時間 t・温度 T に応じた組織スナップショット(LSW 分布による模式)。
 * すべり面(水平破線)上の障害物列(間隔 L)を転位線(--mat-defect)が
 * 張り出して通過するループアニメ + 応力メーター。
 * 右: 強さ(モデル強度)vs log t 曲線と現在点(accent)、比較用ゴースト線
 * 「もし粗大化しなかったら」(matrix 淡色の水平線)。
 *
 * モデル(§5.7 の解析式で代用する側):
 *   r̄(t;T) = (r̄0³ + K(T)·t)^(1/3)、L = β r̄/√f、Δτ = μb/L、
 *   表示強度 = σ0 + C·Δτ(strength.ts の共通校正。図1 と同一)。
 *
 * 簡略化(図注で明示):
 * - 過時効側のみのモデル(切断機構=登り側は GP ゾーン記事に委ねる)。
 * - オロワン式は対数係数を落とした簡略形 Δτ = μb/L。
 * - 組織は LSW 分布の代表半径列による模式で、粒子位置は計算に入らない。
 *   視野は間隔 L で規格化してある(視野幅 = 7L)ため t/T を変えても図形は
 *   相似のままで、絶対寸法の変化はスケールバーと L の寸法線で伝える。
 * - 転位の張り出しは紙面内に誇張した模式(実際の張り出しはすべり面内)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import { clamp, easeOutCubic, mulberry32, smoothstep } from "../../core/mathx";
import {
  BETA,
  F_VOLUME,
  KELVIN,
  R0_MEDIAN_NM,
  formatDuration,
  meanRadiusAnalytic,
} from "./lib/constants";
import { lswRadii } from "./lib/ripening";
import { displayStrengthMPa, orowanMPa, spacingNm } from "./lib/strength";
import { arrow, fmtPow10, fmtSig, font, linTicks, logTicks } from "./lib/draw";

/** 乱数シード(reset で同一の組織を再現 — 母体仕様 §8.2) */
const SEED = 7107;
/** 組織スナップショットの粒子数(§5.7 確定パラメータ) */
const N_PARTICLES = 36;
/** すべり面上の障害物粒子の数(視野幅 7L に間隔 L で並べる) */
const N_OBSTACLES = 7;
/** 視野の寸法 [L 単位](幅 = 7×L — §5.7) */
const FIELD_W = 7;
const FIELD_H = 5.6;
/** すべり面の縦位置 [L 単位] */
const PLANE_Y = FIELD_H / 2;
/** 半径/間隔の比 r̄/L = √f/β(規格化ビューでは定数) */
const U_R = Math.sqrt(F_VOLUME) / BETA;
/** 障害物以外の粒子を置くジッターグリッドの行(すべり面帯を避ける)[L 単位] */
const ROW_Y = [0.7, 1.65, 4.15, 5.0] as const;
const GRID_COLS = 8;
/** ジッター幅 [L 単位] と配置の最小すき間・試行回数 */
const JITTER_X = 0.52;
const JITTER_Y = 0.44;
const MIN_GAP_L = 0.05;
const PLACE_TRIES = 50;

/** 時効時間スライダー範囲 [s](§5.7) */
const T_AGE_MIN_S = 1e3;
const T_AGE_MAX_S = 1e9;
const T_AGE_INIT_S = 1e5;
/** 温度スライダー範囲 [°C] */
const TEMP_MIN = 150;
const TEMP_MAX = 300;
const TEMP_STEP = 5;
const TEMP_INIT = 200;

/** 強さプロットの縦軸上限 [MPa](§5.7: 0〜450) */
const Y_MAX_MPA = 450;
/** 応力メーターの上限 [MPa](パラメータ全域の Δτ ≲ 350 を収める固定目盛) */
const METER_MAX_MPA = 400;
/** 強さ曲線のサンプル数 */
const CURVE_SAMPLES = 96;

/** 張り出しアニメの位相の長さ [実秒](1 周期 ≈ 2〜4 s — §5.7) */
const ENTER_D = 0.5;
const PASS_D = 0.7;
const REST_D = 0.35;
/** 応力ランプの長さ [実秒]。Δτ の対数に応じて内挿(L 大 → 早く通る) */
const RAMP_MIN_D = 1.0;
const RAMP_MAX_D = 2.4;
/** ランプ長の対数マップに使う Δτ の範囲 [MPa](スライダー全域の概算) */
const DTAU_LO_MPA = 0.3;
const DTAU_HI_MPA = 400;
/** オロワンループのフェード時間 [実秒] */
const LOOP_FADE_S = 1.4;
/** 張り出し量の応力依存の見た目イージング指数 */
const BOW_EASE = 1.35;
/** 省モーション・初期静止画に使うランプ位相(張り出し途中の形) */
const INIT_RAMP_FRAC = 0.75;

/** ゴースト線「もし粗大化しなかったら」[MPa](r̄ = r̄0 のときの表示強度) */
const GHOST_MPA = displayStrengthMPa(R0_MEDIAN_NM);

const TAU2 = Math.PI * 2;

/** 描画領域(CSS px) */
interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 張り出しアニメの位相 */
type Phase = "enter" | "ramp" | "pass" | "rest" | "done";

/** nm 長さの表示(1000 nm 以上は µm に切り替え) */
function lenLabel(nm: number): string {
  return nm >= 1000 ? `${fmtSig(nm / 1000)} µm` : `${fmtSig(nm)} nm`;
}

/** maxNm 以下で最大の「きりのよい」長さ(1/2/5×10^k)[nm] */
function niceBarNm(maxNm: number): number {
  const base = 10 ** Math.floor(Math.log10(maxNm));
  if (5 * base <= maxNm) return 5 * base;
  if (2 * base <= maxNm) return 2 * base;
  return base;
}

export default function overagingStrength(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色(初期化時に一度だけ解決 — colors.ts の注意書き)
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill, 0.2);
  const defect = matColor("defect");
  const matrix = matColor("matrix");
  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");
  const bg = uiColor("bg");

  /* ---- 組織スナップショットの配置(シード固定・L 規格化で 1 回だけ) ---- */

  /** 粒子中心・半径 [L 単位] */
  const xL = new Float64Array(N_PARTICLES);
  const yL = new Float64Array(N_PARTICLES);
  const radL = new Float64Array(N_PARTICLES);
  /** すべり面上の障害物(左から順)の中心 x と半径 [L 単位] */
  const obX = new Float64Array(N_OBSTACLES);
  const obR = new Float64Array(N_OBSTACLES);
  {
    // LSW 分布(平均 1)の半径列 × r̄/L で L 単位の半径に
    const u = lswRadii(N_PARTICLES, SEED, 1);
    for (let i = 0; i < N_PARTICLES; i++) radL[i] = u[i] * U_R;
    const order = Array.from({ length: N_PARTICLES }, (_, i) => i).sort(
      (a, b) => radL[a] - radL[b],
    );
    // 障害物は中央値付近の 7 個(間隔がそろって見えるように)
    const obstacleIdx = order.slice(14, 14 + N_OBSTACLES);
    const isObstacle = new Uint8Array(N_PARTICLES);
    obstacleIdx.forEach((idx, k) => {
      isObstacle[idx] = 1;
      xL[idx] = 0.5 + k;
      yL[idx] = PLANE_Y;
      obX[k] = 0.5 + k;
      obR[k] = radL[idx];
    });
    // 残りはすべり面帯を避けたジッターグリッド(シード付きシャッフル)
    const rand = mulberry32(SEED + 1);
    const cells: number[] = [];
    for (const ry of ROW_Y) {
      for (let c = 0; c < GRID_COLS; c++) {
        cells.push(((c + 0.5) * FIELD_W) / GRID_COLS, ry);
      }
    }
    const nCells = cells.length / 2;
    for (let i = nCells - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tx = cells[i * 2];
      const ty = cells[i * 2 + 1];
      cells[i * 2] = cells[j * 2];
      cells[i * 2 + 1] = cells[j * 2 + 1];
      cells[j * 2] = tx;
      cells[j * 2 + 1] = ty;
    }
    // 大きい粒子から順に、重なり最小の位置を選んで置く
    const placed: number[] = [...obstacleIdx];
    let ci = 0;
    for (let oi = order.length - 1; oi >= 0; oi--) {
      const i = order[oi];
      if (isObstacle[i]) continue;
      const cx = cells[ci * 2];
      const cy = cells[ci * 2 + 1];
      ci++;
      const ri = radL[i];
      let bestX = cx;
      let bestY = cy;
      let bestClear = -Infinity;
      for (let t = 0; t < PLACE_TRIES; t++) {
        const x = clamp(
          cx + (rand() - 0.5) * JITTER_X,
          ri + 0.06,
          FIELD_W - ri - 0.06,
        );
        const y = clamp(
          cy + (rand() - 0.5) * JITTER_Y,
          ri + 0.06,
          FIELD_H - ri - 0.06,
        );
        let clear = Infinity;
        for (const j of placed) {
          const d =
            Math.hypot(x - xL[j], y - yL[j]) - (ri + radL[j] + MIN_GAP_L);
          if (d < clear) clear = d;
        }
        if (clear > bestClear) {
          bestClear = clear;
          bestX = x;
          bestY = y;
        }
        if (clear >= 0) break;
      }
      xL[i] = bestX;
      yL[i] = bestY;
      placed.push(i);
    }
  }

  /** 転位が張り出す自由スパン(障害物表面の間)[L 単位]。両端は視野端 */
  const N_SPANS = N_OBSTACLES + 1;
  const spanX1 = new Float64Array(N_SPANS);
  const spanX2 = new Float64Array(N_SPANS);
  /** スパンごとの最大張り出し量(σ = Δτ で内側スパンが半円)[L 単位] */
  const sagAmp = new Float64Array(N_SPANS);
  {
    spanX1[0] = 0;
    spanX2[0] = obX[0] - obR[0];
    for (let k = 1; k < N_OBSTACLES; k++) {
      spanX1[k] = obX[k - 1] + obR[k - 1];
      spanX2[k] = obX[k] - obR[k];
    }
    spanX1[N_OBSTACLES] = obX[N_OBSTACLES - 1] + obR[N_OBSTACLES - 1];
    spanX2[N_OBSTACLES] = FIELD_W;
    let gRef = 0;
    for (let k = 1; k < N_OBSTACLES; k++) {
      const g = spanX2[k] - spanX1[k];
      if (g > gRef) gRef = g;
    }
    for (let k = 0; k < N_SPANS; k++) {
      const g = spanX2[k] - spanX1[k];
      sagAmp[k] = (g / 2) * Math.min(1, g / gRef);
    }
  }

  /* ---- モデル状態(解析式。操作のたびに再計算) ---- */

  let tAge = T_AGE_INIT_S;
  let tempC = TEMP_INIT;
  let rBarNm = 0;
  let lNm = 0;
  let dTauMPa = 0;
  let strengthMPa = 0;
  /** 応力ランプの長さ [s](Δτ が小さいほど短い = 早く通る) */
  let rampD = RAMP_MIN_D;

  function recompute(): void {
    rBarNm = meanRadiusAnalytic(tAge, tempC + KELVIN);
    lNm = spacingNm(rBarNm);
    dTauMPa = orowanMPa(rBarNm);
    strengthMPa = displayStrengthMPa(rBarNm);
    const f = clamp(
      Math.log(dTauMPa / DTAU_LO_MPA) / Math.log(DTAU_HI_MPA / DTAU_LO_MPA),
      0,
      1,
    );
    rampD = RAMP_MIN_D + (RAMP_MAX_D - RAMP_MIN_D) * f;
    if (phase === "ramp") phaseT = Math.min(phaseT, rampD);
  }

  /* ---- 張り出しアニメの位相 ---- */

  let phase: Phase = "ramp";
  let phaseT = 0;
  /** オロワンループの経過秒(Infinity = 非表示) */
  let loopAge = Infinity;
  /** ループ off の 1 回再生が終わって描画を停止済みか */
  let idleStopped = false;

  /** メーターに表示する現在応力 [MPa] */
  function currentStress(): number {
    if (phase === "ramp") return dTauMPa * (phaseT / rampD);
    if (phase === "pass") return dTauMPa;
    return 0;
  }

  /** 1 回再生の開始(ループ中は次周期を前倒しで再開) */
  function startCycle(): void {
    phase = "enter";
    phaseT = 0;
    idleStopped = false;
    host.setPlaying(true);
  }

  function advance(dt: number): void {
    if (Number.isFinite(loopAge)) loopAge += dt;
    switch (phase) {
      case "enter":
        phaseT += dt;
        if (phaseT >= ENTER_D) {
          phase = "ramp";
          phaseT = 0;
        }
        break;
      case "ramp":
        phaseT += dt;
        if (phaseT >= rampD) {
          phase = "pass";
          phaseT = 0;
          loopAge = 0; // 通過と同時にオロワンループが現れる
        }
        break;
      case "pass":
        phaseT += dt;
        if (phaseT >= PASS_D) {
          phase = loopToggle.value ? "rest" : "done";
          phaseT = 0;
        }
        break;
      case "rest":
        phaseT += dt;
        if (phaseT >= REST_D) {
          phase = "enter";
          phaseT = 0;
        }
        break;
      case "done":
        // ループの残像が消えたら描画を停止(スライダー操作は
        // controls の requestRender で静止画のまま更新される — §5.7)
        if (!idleStopped && loopAge > LOOP_FADE_S) {
          idleStopped = true;
          host.setPlaying(false);
        }
        break;
    }
  }

  /* ---- 操作部品(§7.2) ---- */

  const tSlider = host.controls.slider({
    id: "t",
    label: "時効時間",
    min: T_AGE_MIN_S,
    max: T_AGE_MAX_S,
    value: T_AGE_INIT_S,
    scale: "log",
    format: formatDuration,
  });
  tSlider.onChange((v) => {
    tAge = v;
    recompute();
  });

  const tempSlider = host.controls.slider({
    id: "T",
    label: "温度",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    tempC = v;
    recompute();
  });

  const loopToggle = host.controls.toggle({
    id: "loop",
    label: "ループ再生",
    value: true,
  });
  loopToggle.onChange((on) => {
    if (!on) return; // off は現在の周期を終えてから止まる
    if (phase === "done") startCycle();
    else {
      idleStopped = false;
      host.setPlaying(true);
    }
  });

  const fireBtn = host.controls.button({ label: "転位を通す" });
  fireBtn.onClick(() => {
    startCycle();
  });

  host.controls.reset(() => {
    tSlider.set(T_AGE_INIT_S);
    tempSlider.set(TEMP_INIT);
    loopToggle.set(true);
    phase = "ramp";
    phaseT = INIT_RAMP_FRAC * rampD;
    loopAge = Infinity;
    idleStopped = false;
    host.setPlaying(true);
  });

  /* ---- レイアウト(毎フレーム host.size から計算) ---- */

  function layout(): {
    meter: Pane;
    field: Pane;
    plot: Pane;
    readoutY: number;
    narrow: boolean;
  } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 34 : 24; // 読み出し行の高さ
    const top = pad + strip;
    const meterW = narrow ? 26 : 38;
    const leftW = (w - 3 * pad) * (narrow ? 0.56 : 0.54);
    const plotX = pad * 2 + leftW;
    return {
      meter: { x: pad, y: top, w: meterW, h: h - top - pad },
      field: {
        x: pad + meterW + 4,
        y: top,
        w: leftW - meterW - 4,
        h: h - top - pad,
      },
      plot: { x: plotX, y: top, w: w - plotX - pad, h: h - top - pad },
      readoutY: pad,
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function drawReadouts(y: number, narrow: boolean): void {
    const { w } = host.size;
    const size = narrow ? 11 : 12.5;
    ctx.font = font(size);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const parts: Array<[string, string]> = [
      [`r̄ ${fmtSig(rBarNm)} nm`, text],
      [`L ${lenLabel(lNm)}`, text],
      [`Δτ ${fmtSig(dTauMPa)} MPa`, text],
      [`強さ ${Math.round(strengthMPa)} MPa`, text],
      [`(${tempC} °C・${formatDuration(tAge)} 時効)`, text2],
    ];
    let x = narrow ? 8 : 12;
    let line = 0;
    for (const [s, color] of parts) {
      const tw = ctx.measureText(s).width;
      if (narrow && x + tw > w - 8 && line === 0) {
        line = 1;
        x = 8;
      }
      ctx.fillStyle = color;
      ctx.fillText(s, x, y + line * (size + 4));
      x += tw + (narrow ? 10 : 18);
    }
  }

  function drawMeter(p: Pane): void {
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("応力", p.x + p.w / 2, p.y);
    const barW = 10;
    const bx = p.x + (p.w - barW) / 2;
    const y0 = p.y + 16;
    const y1 = p.y + p.h - 8;
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y0 + 0.5, barW - 1, y1 - y0 - 1);
    // 現在応力(defect 色の縦バー)
    const sigma = currentStress();
    const hFill =
      (clamp(sigma, 0, METER_MAX_MPA) / METER_MAX_MPA) * (y1 - y0 - 2);
    if (hFill > 0.5) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = defect;
      ctx.fillRect(bx + 1, y1 - 1 - hFill, barW - 2, hFill);
      ctx.globalAlpha = 1;
    }
    // 通過に必要な応力 Δτ の目盛り線
    const yTh =
      y1 -
      1 -
      (clamp(dTauMPa, 0, METER_MAX_MPA) / METER_MAX_MPA) * (y1 - y0 - 2);
    ctx.strokeStyle = text;
    ctx.beginPath();
    ctx.moveTo(bx - 3, yTh + 0.5);
    ctx.lineTo(bx + barW + 3, yTh + 0.5);
    ctx.stroke();
    if (p.w >= 32) {
      ctx.font = font(10);
      ctx.fillStyle = text;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("Δτ", bx - 4, yTh);
    }
    ctx.textAlign = "left";
  }

  /** 弦 (x1,y)–(x2,y) の上に矢高 sag [px] の円弧を張る(パスに追加) */
  function bowPath(x1: number, x2: number, y: number, sag: number): void {
    ctx.moveTo(x1, y);
    if (sag < 0.4) {
      ctx.lineTo(x2, y);
      return;
    }
    const half = (x2 - x1) / 2;
    const r = (half * half + sag * sag) / (2 * sag);
    const cx = (x1 + x2) / 2;
    const cy = y + (r - sag);
    const a1 = Math.atan2(y - cy, x1 - cx);
    const a2 = Math.atan2(y - cy, x2 - cx);
    ctx.arc(cx, cy, r, a1, a2, false);
  }

  /** 転位線(位相に応じて: 進入 → 張り出し → 通過・離脱) */
  function drawDislocation(
    ox: number,
    py: number,
    s: number,
    fw: number,
  ): void {
    ctx.strokeStyle = defect;
    ctx.lineWidth = 2;
    if (phase === "enter") {
      // 左からすべり面に沿って進入(障害物の内側は描かない = ピン留め)
      const front = ox + fw * (phaseT / ENTER_D);
      ctx.beginPath();
      for (let k = 0; k < N_SPANS; k++) {
        const x1 = ox + spanX1[k] * s;
        if (front <= x1) break;
        ctx.moveTo(x1, py);
        ctx.lineTo(Math.min(ox + spanX2[k] * s, front), py);
      }
      ctx.stroke();
    } else if (phase === "ramp") {
      // 応力に応じて各スパンが張り出す(σ = Δτ で内側スパンが半円)
      const eased = Math.pow(phaseT / rampD, BOW_EASE);
      ctx.beginPath();
      for (let k = 0; k < N_SPANS; k++) {
        bowPath(
          ox + spanX1[k] * s,
          ox + spanX2[k] * s,
          py,
          sagAmp[k] * eased * s,
        );
      }
      ctx.stroke();
    } else if (phase === "pass") {
      // 半円を越えて通過: 解放された線が上方へ抜けていく(残りの垂みは減衰)
      const p = phaseT / PASS_D;
      const yFree = py - s * (0.5 + (PLANE_Y - 0.5 + 0.8) * easeOutCubic(p));
      const dip = 0.3 * s * (1 - p);
      ctx.globalAlpha = 1 - smoothstep(0.7, 1, p);
      ctx.beginPath();
      ctx.moveTo(ox, yFree);
      let prevX = ox;
      for (let k = 0; k < N_OBSTACLES; k++) {
        const pin = ox + obX[k] * s;
        ctx.quadraticCurveTo((prevX + pin) / 2, yFree + 2 * dip, pin, yFree);
        prevX = pin;
      }
      ctx.quadraticCurveTo(
        (prevX + ox + fw) / 2,
        yFree + 2 * dip,
        ox + fw,
        yFree,
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // rest / done: 転位はすでに通過済み(線なし)
  }

  /** L の寸法線(障害物 3–4 の間。両矢印 + ラベル) */
  function drawDimension(ox: number, py: number, s: number): void {
    const xa = ox + obX[3] * s;
    const xb = ox + obX[4] * s;
    const yd = py + Math.max(0.55 * s, 16);
    // 引き出し線(hairline)
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xa + 0.5, py + obR[3] * s + 2);
    ctx.lineTo(xa + 0.5, yd + 4);
    ctx.moveTo(xb + 0.5, py + obR[4] * s + 2);
    ctx.lineTo(xb + 0.5, yd + 4);
    ctx.stroke();
    // 両矢印(arrow ×2)
    const head = Math.min(7, (xb - xa) * 0.18);
    arrow(ctx, xa, yd, xb, yd, text2, 2, head);
    arrow(ctx, xb, yd, xa, yd, text2, 2, head);
    // ラベル「L = 25 nm」(ラベル text2・値 text)
    ctx.font = font(12);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const labL = "L = ";
    const labV = lenLabel(lNm);
    const w1 = ctx.measureText(labL).width;
    const w2 = ctx.measureText(labV).width;
    const lx = (xa + xb) / 2 - (w1 + w2) / 2;
    ctx.fillStyle = text2;
    ctx.fillText(labL, lx, yd + 5);
    ctx.fillStyle = text;
    ctx.fillText(labV, lx + w1, yd + 5);
  }

  /** スケールバー(視野の絶対寸法は t/T とともに変わる) */
  function drawScaleBar(
    ox: number,
    oy: number,
    s: number,
    fw: number,
    fh: number,
  ): void {
    const pxPerNm = s / lNm;
    const barNm = niceBarNm(0.35 * FIELD_W * lNm);
    const barPx = barNm * pxPerNm;
    const xe = ox + fw - 10;
    const xs = xe - barPx;
    const yb = oy + fh - 12;
    // 粒子と重なっても読めるように薄い下地を敷く
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = bg;
    ctx.fillRect(xs - 6, yb - 18, barPx + 12, 26);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xs, yb);
    ctx.lineTo(xe, yb);
    ctx.moveTo(xs, yb - 4);
    ctx.lineTo(xs, yb + 4);
    ctx.moveTo(xe, yb - 4);
    ctx.lineTo(xe, yb + 4);
    ctx.stroke();
    ctx.font = font(11);
    ctx.fillStyle = text;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(lenLabel(barNm), (xs + xe) / 2, yb - 4);
    ctx.textAlign = "left";
  }

  function drawFieldPane(p: Pane): void {
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    const s = Math.min(p.w / FIELD_W, p.h / FIELD_H);
    const ox = p.x + (p.w - FIELD_W * s) / 2;
    const oy = p.y + (p.h - FIELD_H * s) / 2;
    const fw = FIELD_W * s;
    const fh = FIELD_H * s;
    const py = oy + PLANE_Y * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    // 母相の薄い背景(matrix)
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = matrix;
    ctx.fillRect(ox, oy, fw, fh);
    ctx.globalAlpha = 1;
    // すべり面(水平の hairline 破線)
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(ox, py + 0.5);
    ctx.lineTo(ox + fw, py + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    // 析出粒子(1 パスでまとめ描き — 母体仕様 §8.3)
    ctx.beginPath();
    for (let i = 0; i < N_PARTICLES; i++) {
      const x = ox + xL[i] * s;
      const y = oy + yL[i] * s;
      const r = radL[i] * s;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU2);
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
    // L の寸法線
    drawDimension(ox, py, s);
    // オロワンループ(通過の名残。defect 色の輪が薄れて消える)
    if (Number.isFinite(loopAge) && loopAge < LOOP_FADE_S) {
      ctx.globalAlpha = 0.9 * (1 - loopAge / LOOP_FADE_S);
      ctx.strokeStyle = defect;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < N_OBSTACLES; k++) {
        const x = ox + obX[k] * s;
        const r = obR[k] * s + 0.12 * s;
        ctx.moveTo(x + r, py);
        ctx.arc(x, py, r, 0, TAU2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 転位線
    drawDislocation(ox, py, s, fw);
    // すべり面ラベル
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("すべり面", ox + fw - 4, py - 4);
    ctx.textAlign = "left";
    // スケールバー
    drawScaleBar(ox, oy, s, fw, fh);
    ctx.restore();
    // 見出し
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textBaseline = "bottom";
    ctx.fillText("組織スナップショット(模式)", p.x + 6, p.y + p.h - 5);
  }

  function drawPlotPane(p: Pane, narrow: boolean): void {
    const axisX = p.x + (narrow ? 28 : 34);
    const axisY = p.y + p.h - 18;
    const y0 = p.y + 16;
    const xRight = p.x + p.w - 14;
    const lnMin = Math.log(T_AGE_MIN_S);
    const lnMax = Math.log(T_AGE_MAX_S);
    const mapX = (t: number): number =>
      axisX + ((xRight - axisX) * (Math.log(t) - lnMin)) / (lnMax - lnMin);
    const mapY = (m: number): number => axisY - ((axisY - y0) * m) / Y_MAX_MPA;

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      narrow ? "強さ vs t [秒]" : "強さ(モデル)vs 時効時間 [秒]",
      axisX + 4,
      p.y,
    );

    // 軸と目盛り
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, y0);
    ctx.lineTo(axisX + 0.5, axisY + 0.5);
    ctx.lineTo(xRight, axisY + 0.5);
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const v of linTicks(0, Y_MAX_MPA, 4)) {
      if (v === 0) continue;
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), axisX - 5, y);
    }
    ctx.textAlign = "left";
    ctx.fillText("MPa", axisX - (narrow ? 24 : 30), y0 - 9);
    // 時間目盛り(10 の冪。狭い画面では 1 つおきにラベル)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const labelEvery = xRight - axisX < 240 ? 2 : 1;
    for (const tick of logTicks(T_AGE_MIN_S, T_AGE_MAX_S)) {
      const e = Math.round(Math.log10(tick));
      const x = mapX(tick);
      ctx.beginPath();
      ctx.moveTo(x, axisY + 0.5);
      ctx.lineTo(x, axisY + 3.5);
      ctx.stroke();
      if ((e - 3) % labelEvery === 0)
        ctx.fillText(fmtPow10(tick), x, axisY + 5);
    }

    // ゴースト線「もし粗大化しなかったら」(matrix 淡色の水平線)
    const yGhost = mapY(GHOST_MPA);
    ctx.strokeStyle = matrix;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(axisX + 1, yGhost + 0.5);
    ctx.lineTo(xRight, yGhost + 0.5);
    ctx.stroke();
    ctx.font = font(11);
    ctx.fillStyle = darken(matrix, 0.3);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("もし粗大化しなかったら", xRight - 2, yGhost + 4);

    // 現在温度での強さ曲線(text 色の実線。T を上げると左へ平行移動)
    ctx.beginPath();
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = Math.exp(lnMin + ((lnMax - lnMin) * i) / CURVE_SAMPLES);
      const m = displayStrengthMPa(meanRadiusAnalytic(t, tempC + KELVIN));
      const x = mapX(t);
      const y = mapY(m);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = text;
    ctx.lineWidth = 1.75;
    ctx.stroke();

    // ゴースト線との差(粗大化で失った強さ)と現在点(accent)
    const xPt = mapX(tAge);
    const yPt = mapY(strengthMPa);
    ctx.strokeStyle = matrix;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xPt + 0.5, yGhost);
    ctx.lineTo(xPt + 0.5, yPt);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(xPt, yPt, 4, 0, TAU2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.textAlign = "left";
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawReadouts(l.readoutY, l.narrow);
    drawMeter(l.meter);
    drawFieldPane(l.field);
    drawPlotPane(l.plot, l.narrow);
  }

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    advance(dt);
    draw();
  });
  // 一時停止中のスライダー操作・省モーション初期表示用(dt = 0 でも
  // 位相を保持しているので意味のある張り出し形状が描かれる)
  host.onRender(draw);

  // 初期状態: 張り出し途中の位相から(省モーションでは静止画として見える)
  recompute();
  phaseT = INIT_RAMP_FRAC * rampD;

  return {
    setPlaying(playing: boolean): void {
      // 停止後に外部から再生されたら次の周期を再武装する
      if (playing && phase === "done") {
        phase = "enter";
        phaseT = 0;
        idleStopped = false;
      }
    },
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
