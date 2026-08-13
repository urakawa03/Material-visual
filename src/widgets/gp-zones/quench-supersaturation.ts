/**
 * quench-supersaturation.ts — 図3「焼入れで凍結されるもの」(記事仕様書 07 §5.3)
 *
 * 左: 2D 格子の模式(母相 Al・溶質 Cu・空孔)。右上: 温度の履歴(対数時間)。
 * 右下: 2 本の対数メーター(空孔濃度・固溶している Cu)と、その温度での
 * 平衡値の参照マーク。
 *
 * モデル(実時間 [s] で解く。表示は強く加速している):
 *   T(t)  = T_room + (T0 − T_room) e^(−t/τ_cool)
 *   ċ_v   = −(c_v − c_v^eq(T))/τ_ann(T)、τ_ann(T) = τ_ref e^(E_ann/k_B)(1/T − 1/T_ref)
 *   ċ_sol = −(c_sol − c_s(T))/τ_ppt(T)(粗大な平衡析出物への吐き出し)
 * 緩和は各サブステップで解析解 c ← c_eq + (c − c_eq)e^(−Δt/τ) として進めるので、
 * 大きな Δt でも安定。
 *
 * 急冷では τ_ann・τ_ppt が追いつかず、**過剰空孔と過飽和がまとめて凍結される**。
 * 徐冷では空孔は消え、Cu は粗大な θ として析出してしまう(だから硬くならない)。
 *
 * 簡略化(図注): 2D 模式・原子数は大幅に削減・時間は強く加速。空孔の消滅先
 * (粒界・転位)は描かない。格子中の空孔の個数は模式で、濃度はメーターの値。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp, mulberry32 } from "../../core/mathx";
import { C0_WT, KB_EV, KELVIN, solubilityWt, vacancyEq } from "./lib/constants";
import {
  type Pane,
  atom,
  badge,
  drawReadouts,
  fmtSig,
  font,
  linTicks,
  logTicks,
  resolvePalette,
  vacancy,
} from "./lib/draw";

/** 溶体化温度 [°C] と室温 [°C] */
const T_HOLD_C = 500;
const T_ROOM_C = 20;

/** 冷却の時定数 [実秒] */
const TAU_QUENCH_S = 0.5;
const TAU_SLOW_S = 3600;
/** 冷却アニメの長さ [壁時計秒](どちらのモードでも同じ体感速度にする) */
const COOL_WALL_S = 3.2;
/** 冷却を追いかける時間 [τ_cool 単位] */
const COOL_TAUS = 10;
/** 1 フレームあたりのサブステップ数 */
const SUBSTEPS = 8;

/** 空孔消滅の時定数(400 °C で 1 秒、実効の活性化エネルギー 0.82 eV) */
const T_ANN_REF_K = 400 + KELVIN;
const TAU_ANN_REF_S = 1;
const E_ANN_EV = 0.82;
/** 粗大な平衡析出の時定数(400 °C で 100 秒、活性化エネルギー 1.0 eV) */
const T_PPT_REF_K = 400 + KELVIN;
const TAU_PPT_REF_S = 100;
const E_PPT_EV = 1.0;

/** メーターの範囲 */
const CV_MIN = 1e-13;
const CV_MAX = 1e-4;
const CSOL_MIN = 1e-4;
const CSOL_MAX = 6;
/** 履歴プロットの時間軸 [s] */
const HIST_T_MIN = 1e-2;
const HIST_T_MAX = 1e4;

/** 格子の寸法(模式) */
const COLS = 16;
const ROWS = 9;
/** 溶質原子の数(c0 = 4 wt% を代表) */
const N_SOLUTE = 12;
/** 描画する空孔の最大個数(模式) */
const N_VAC_MAX = 5;
/** 粗大な θ 粒子の最大個数 */
const N_THETA = 3;
const SEED = 30731;

const TAU2 = Math.PI * 2;

type Mode = "quench" | "slow";
type Stage = "hold" | "cooling" | "done";

/** 空孔消滅の時定数 [s] */
function tauAnneal(tK: number): number {
  return (
    TAU_ANN_REF_S * Math.exp((E_ANN_EV / KB_EV) * (1 / tK - 1 / T_ANN_REF_K))
  );
}
/** 粗大析出の時定数 [s] */
function tauPrecip(tK: number): number {
  return (
    TAU_PPT_REF_S * Math.exp((E_PPT_EV / KB_EV) * (1 / tK - 1 / T_PPT_REF_K))
  );
}

export default function quenchSupersaturation(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const c = resolvePalette();

  let mode: Mode = "quench";
  let stage: Stage = "hold";
  /** 冷却開始からの実時間 [s] */
  let tReal = 0;
  let tempC = T_HOLD_C;
  let cv = vacancyEq(T_HOLD_C + KELVIN);
  let cSol = C0_WT;
  /** 履歴(log10 t, T) */
  const hist: number[] = [];
  /** 原子の熱振動の位相(シード固定) */
  const phase = new Float64Array(COLS * ROWS);
  /** 溶質・空孔が座る格子サイトの番号(シード固定) */
  const soluteSite: number[] = [];
  const vacSite: number[] = [];
  {
    const rand = mulberry32(SEED);
    for (let i = 0; i < phase.length; i++) phase[i] = rand() * TAU2;
    const used = new Set<number>();
    while (soluteSite.length < N_SOLUTE) {
      const s = Math.floor(rand() * COLS * ROWS);
      if (!used.has(s)) {
        used.add(s);
        soluteSite.push(s);
      }
    }
    while (vacSite.length < N_VAC_MAX) {
      const s = Math.floor(rand() * COLS * ROWS);
      if (!used.has(s)) {
        used.add(s);
        vacSite.push(s);
      }
    }
  }
  /** 粗大 θ の位置(格子座標の相対値) */
  const thetaPos = [
    [0.24, 0.28],
    [0.62, 0.66],
    [0.84, 0.22],
  ] as const;

  const tauCool = (): number => (mode === "quench" ? TAU_QUENCH_S : TAU_SLOW_S);

  function resetState(): void {
    stage = "hold";
    tReal = 0;
    tempC = T_HOLD_C;
    cv = vacancyEq(T_HOLD_C + KELVIN);
    cSol = C0_WT;
    hist.length = 0;
  }

  /* ---- 操作部品(§7.2) ---- */

  const modeSeg = host.controls.segmented<Mode>({
    id: "mode",
    label: "冷却の速さ",
    options: [
      { value: "quench", label: "急冷(水焼入れ)" },
      { value: "slow", label: "徐冷(炉冷)" },
    ],
    value: "quench",
  });
  modeSeg.onChange((v) => {
    mode = v;
    resetState();
    host.setPlaying(false);
    host.requestRender();
  });

  const coolBtn = host.controls.button({ label: "冷やす" });
  coolBtn.onClick(() => {
    resetState();
    stage = "cooling";
    host.setPlaying(true);
  });

  host.controls.playPause();
  host.controls.reset(() => {
    modeSeg.set("quench");
    resetState();
    host.setPlaying(false);
  });

  /* ---- シミュレーション ---- */

  function advance(dtWall: number): void {
    if (stage !== "cooling") return;
    const tau = tauCool();
    const total = COOL_TAUS * tau;
    const dReal = (total / COOL_WALL_S) * dtWall;
    for (let i = 0; i < SUBSTEPS; i++) {
      const dt = dReal / SUBSTEPS;
      tReal += dt;
      tempC = T_ROOM_C + (T_HOLD_C - T_ROOM_C) * Math.exp(-tReal / tau);
      const tK = tempC + KELVIN;
      // 空孔: 平衡値へ緩和(低温では τ_ann が伸びて追従できない = 凍結)
      const cvEq = vacancyEq(tK);
      cv = cvEq + (cv - cvEq) * Math.exp(-dt / tauAnneal(tK));
      // 溶質: 固溶限を超えた分が粗大な θ として抜けていく
      const cEq = Math.min(solubilityWt(tK), cSol);
      cSol = cEq + (cSol - cEq) * Math.exp(-dt / tauPrecip(tK));
    }
    hist.push(Math.log10(Math.max(tReal, HIST_T_MIN)), tempC);
    if (tReal >= COOL_TAUS * tau) {
      stage = "done";
      host.setPlaying(false);
    }
  }

  /* ---- レイアウト ---- */

  interface Layout {
    field: Pane;
    hist: Pane;
    meters: Pane;
    narrow: boolean;
    readoutY: number;
  }

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 32 : 22;
    const top = pad + strip;
    const leftW = (w - pad * 3) * (narrow ? 0.48 : 0.54);
    const rightX = pad * 2 + leftW;
    const rightW = w - rightX - pad;
    const histH = (h - top - pad) * 0.46;
    return {
      field: { x: pad, y: top, w: leftW, h: h - top - pad },
      hist: { x: rightX, y: top, w: rightW, h: histH - 6 },
      meters: {
        x: rightX,
        y: top + histH + 6,
        w: rightW,
        h: h - top - pad - histH - 6,
      },
      narrow,
      readoutY: pad,
    };
  }

  /* ---- 描画 ---- */

  function drawField(p: Pane, t: number): void {
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    const s = Math.min((p.w - 16) / COLS, (p.h - 26) / ROWS);
    const ox = p.x + (p.w - s * COLS) / 2 + s / 2;
    const oy = p.y + (p.h - s * ROWS) / 2 + s / 2;
    const rAtom = s * 0.3;
    // 熱振動の振幅(温度の平方根に比例する模式)
    const amp = s * 0.09 * Math.sqrt(clamp(tempC / T_HOLD_C, 0, 1));
    const nVacShown = Math.round(
      clamp(
        (N_VAC_MAX * (Math.log(cv) - Math.log(CV_MIN))) /
          (Math.log(CV_MAX) - Math.log(CV_MIN)),
        0,
        N_VAC_MAX,
      ),
    );
    const nSoluteShown = Math.round((N_SOLUTE * cSol) / C0_WT);
    const isSolute = new Uint8Array(COLS * ROWS);
    for (let i = 0; i < nSoluteShown; i++) isSolute[soluteSite[i]] = 1;
    const isVac = new Uint8Array(COLS * ROWS);
    for (let i = 0; i < nVacShown; i++) isVac[vacSite[i]] = 1;

    // 母相原子(1 パスでまとめ描き — 母体仕様 §8.3)
    ctx.beginPath();
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const k = j * COLS + i;
        if (isSolute[k] || isVac[k]) continue;
        const x = ox + i * s + amp * Math.cos(t * 6 + phase[k]);
        const y = oy + j * s + amp * Math.sin(t * 7 + phase[k]);
        ctx.moveTo(x + rAtom, y);
        ctx.arc(x, y, rAtom, 0, TAU2);
      }
    }
    ctx.fillStyle = c.matrix;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.matrixEdge;
    ctx.stroke();

    // 溶質原子(Cu)
    for (let k = 0; k < COLS * ROWS; k++) {
      if (!isSolute[k]) continue;
      const i = k % COLS;
      const j = (k / COLS) | 0;
      atom(
        ctx,
        ox + i * s + amp * Math.cos(t * 6 + phase[k]),
        oy + j * s + amp * Math.sin(t * 7 + phase[k]),
        rAtom * 1.05,
        c.solute,
        c.soluteEdge,
      );
    }
    // 空孔(塗りなし + 破線縁)
    for (let k = 0; k < COLS * ROWS; k++) {
      if (!isVac[k]) continue;
      const i = k % COLS;
      const j = (k / COLS) | 0;
      vacancy(ctx, ox + i * s, oy + j * s, rAtom, c.matrixEdge);
    }
    // 徐冷で吐き出された粗大な θ 粒子
    const lost = clamp((C0_WT - cSol) / C0_WT, 0, 1);
    if (lost > 0.05) {
      for (let k = 0; k < N_THETA; k++) {
        const r = s * 0.85 * Math.cbrt(lost) * (k === 1 ? 1.15 : 0.9);
        atom(
          ctx,
          p.x + thetaPos[k][0] * p.w,
          p.y + thetaPos[k][1] * p.h,
          r,
          c.precip,
          c.precipEdge,
        );
      }
    }
    ctx.font = font(11);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${Math.round(tempC)} °C`, p.x + 6, p.y + p.h - 6);
  }

  function drawHistory(p: Pane, narrow: boolean): void {
    const axisX = p.x + (narrow ? 26 : 32);
    const axisY = p.y + p.h - 16;
    const y0 = p.y + 14;
    const xR = p.x + p.w - 6;
    const lnMin = Math.log10(HIST_T_MIN);
    const lnMax = Math.log10(HIST_T_MAX);
    const mapX = (logT: number): number =>
      axisX + ((xR - axisX) * (logT - lnMin)) / (lnMax - lnMin);
    const mapY = (tC: number): number => axisY - ((axisY - y0) * tC) / T_HOLD_C;

    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("温度の履歴 [°C]", axisX, p.y);

    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, y0);
    ctx.lineTo(axisX + 0.5, axisY + 0.5);
    ctx.lineTo(xR, axisY + 0.5);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, T_HOLD_C, 3)) {
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), axisX - 4, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const tick of logTicks(HIST_T_MIN, HIST_T_MAX)) {
      const x = mapX(Math.log10(tick));
      ctx.beginPath();
      ctx.moveTo(x, axisY + 0.5);
      ctx.lineTo(x, axisY + 3);
      ctx.stroke();
    }
    ctx.fillText("時間(対数)→", (axisX + xR) / 2, axisY + 4);

    ctx.beginPath();
    ctx.moveTo(mapX(lnMin), mapY(T_HOLD_C));
    for (let i = 0; i < hist.length; i += 2) {
      ctx.lineTo(mapX(clamp(hist[i], lnMin, lnMax)), mapY(hist[i + 1]));
    }
    if (hist.length === 0) ctx.lineTo(mapX(lnMin + 0.2), mapY(T_HOLD_C));
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.text;
    ctx.stroke();
    if (hist.length >= 2) {
      ctx.beginPath();
      ctx.arc(
        mapX(clamp(hist[hist.length - 2], lnMin, lnMax)),
        mapY(hist[hist.length - 1]),
        3.5,
        0,
        TAU2,
      );
      ctx.fillStyle = c.accent;
      ctx.fill();
    }
  }

  /** 対数メーター 1 本(現在値のバー + 平衡値の参照マーク) */
  function drawMeter(
    p: Pane,
    title: string,
    value: number,
    eq: number,
    min: number,
    max: number,
    color: string,
    valueLabel: string,
    narrow: boolean,
  ): void {
    const barW = narrow ? 14 : 18;
    const bx = p.x + (p.w - barW) / 2;
    const y0 = p.y + 26;
    const y1 = p.y + p.h - 16;
    const toY = (v: number): number =>
      y1 -
      ((y1 - y0) *
        clamp(Math.log(v) - Math.log(min), 0, Math.log(max) - Math.log(min))) /
        (Math.log(max) - Math.log(min));

    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(title, p.x + p.w / 2, p.y);

    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y0 + 0.5, barW - 1, y1 - y0 - 1);
    const yv = toY(value);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bx + 1, yv, barW - 2, y1 - yv - 1);
    ctx.globalAlpha = 1;
    // 平衡値の参照マーク(accent の破線)
    const ye = toY(eq);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - 7, ye + 0.5);
    ctx.lineTo(bx + barW + 7, ye + 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.font = font(narrow ? 9.5 : 10);
    ctx.fillStyle = c.accent;
    ctx.textAlign = "center";
    ctx.textBaseline = ye < yv ? "bottom" : "top";
    ctx.fillText("平衡値", p.x + p.w / 2, ye + (ye < yv ? -3 : 4));
    ctx.fillStyle = c.text;
    ctx.textBaseline = "top";
    ctx.fillText(valueLabel, p.x + p.w / 2, y1 + 2);
  }

  function draw(t: number): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    const tK = tempC + KELVIN;
    const cvEq = vacancyEq(tK);
    const excess = cv / vacancyEq(T_ROOM_C + KELVIN);
    const ss = cSol / solubilityWt(T_ROOM_C + KELVIN);

    drawReadouts(
      ctx,
      [
        [`${Math.round(tempC)} °C`, c.text],
        [`固溶 Cu ${fmtSig(cSol)} wt%`, c.soluteEdge],
        [`空孔 ${cv.toExponential(1)}`, c.text],
        [
          stage === "hold"
            ? "溶体化保持中 — 「冷やす」を押す"
            : `室温平衡の ${excess.toExponential(1)} 倍の空孔`,
          c.text2,
        ],
      ],
      l.narrow ? 8 : 12,
      l.readoutY,
      w - 8,
      l.narrow,
    );

    drawField(l.field, t);
    drawHistory(l.hist, l.narrow);

    const half = l.meters.w / 2;
    drawMeter(
      { ...l.meters, w: half },
      "空孔濃度",
      cv,
      cvEq,
      CV_MIN,
      CV_MAX,
      c.matrixEdge,
      cv.toExponential(0),
      l.narrow,
    );
    drawMeter(
      { ...l.meters, x: l.meters.x + half, w: half },
      "固溶した Cu",
      cSol,
      solubilityWt(tK),
      CSOL_MIN,
      CSOL_MAX,
      c.solute,
      `${fmtSig(cSol)} wt%`,
      l.narrow,
    );

    // 冷却が終わったら結果のバッジ
    if (stage === "done") {
      const x = l.field.x + 8;
      const y = l.field.y + 8;
      const w1 = badge(
        ctx,
        `過剰空孔 ${excess.toExponential(0)} 倍`,
        x,
        y,
        c.text,
        c.matrix,
      );
      badge(
        ctx,
        `過飽和 ${ss.toExponential(0)} 倍`,
        x + w1 + 6,
        y,
        c.soluteEdge,
        c.solute,
      );
    }
  }

  host.onFrame((dt, t) => {
    advance(dt);
    draw(t);
  });
  host.onRender(() => draw(0));
  host.setPlaying(false);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
