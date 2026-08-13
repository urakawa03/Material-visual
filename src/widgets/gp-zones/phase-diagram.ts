/**
 * phase-diagram.ts — 図2「Al–Cu 状態図と熱処理経路」(記事仕様書 07 §5.2)
 *
 * Al 側の状態図(0〜8 wt% Cu、0〜700 °C)。固溶限(solvus)c_s(T) の上を
 * 状態点がどう動くかで、溶体化 → 焼入れ → 時効という熱処理を読ませる。
 * 状態点はドラッグでき、キーボードだけでも 2 本のスライダーで操作できる。
 *
 * モデル: c_s(T) = c_s0 e^(−Q_s/k_BT)(共晶組成 5.65 wt% で頭打ち)。
 *
 * 簡略化(図注): 液相側(固相線・液相線)は共晶点へ向かう直線近似の模式。
 * θ′ などの準安定相の溶解度線は描かない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp, easeInOutCubic, mulberry32 } from "../../core/mathx";
import {
  C0_WT,
  C_EUT_WT,
  KELVIN,
  T_EUT_C,
  solubilityWt,
  supersaturation,
} from "./lib/constants";
import {
  type Pane,
  arrow,
  atom,
  drawReadouts,
  fmtSig,
  font,
  linTicks,
  resolvePalette,
} from "./lib/draw";

/** 軸の範囲 */
const C_MAX_WT = 8;
const T_MAX_C = 700;
/** Al の融点 [°C] */
const T_MELT_C = 660;
/** 共晶組成での液相線の傾きを決める参照点(Al–Cu の共晶は 33 wt%) */
const C_LIQ_EUT = 33;
/** 状態点スライダー */
const C_MIN_SLIDER = 0.5;
const T_MIN_SLIDER = 20;
const T_STEP = 5;
/** 熱処理経路の各点 [°C] */
const T_SOLUTION = 500;
const T_AGE = 130;
const T_ROOM = 20;
/** 経路 1 区間のアニメ時間 [s] */
const LEG_SECONDS = 0.9;
/** 組織アイコンの原子数 */
const ICON_ATOMS = 26;
const ICON_SEED = 20713;

const TAU2 = Math.PI * 2;

/** 経路の区間(到達温度とラベル) */
const LEGS: ReadonlyArray<{ t: number; label: string }> = [
  { t: T_SOLUTION, label: "溶体化" },
  { t: T_ROOM, label: "焼入れ" },
  { t: T_AGE, label: "時効" },
];
/** 区間ごとの横ずらし [px](上りと下りが重ならないように) */
const LEG_OFFSET_PX = [-9, 9, 30] as const;
/** ラベルを置く位置(区間の始点から終点への比) */
const LEG_LABEL_FRAC = [0.4, 0.62, 0.5] as const;

export default function phaseDiagram(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const c = resolvePalette();

  let cWt = C0_WT;
  let tempC = T_ROOM;
  /** 焼入れで過飽和を凍結した状態か(経路の「焼入れ」を通った後) */
  let quenched = false;
  /** 経路アニメ: 実行中の区間と進行度。null で停止 */
  let leg = -1;
  let legT = 0;
  let legFrom = T_ROOM;
  /** 到達済みの区間数(経路の実線/破線の描き分け) */
  let legsDone = 0;

  let dragging = false;
  let dragPointerId = -1;

  /** アイコン用のシード付き配置(0〜1 の相対座標) */
  const iconPos = (() => {
    const rand = mulberry32(ICON_SEED);
    const out = new Float64Array(ICON_ATOMS * 2);
    for (let i = 0; i < ICON_ATOMS * 2; i++) out[i] = rand();
    return out;
  })();

  /* ---- 操作部品(§7.2) ---- */

  const cSlider = host.controls.slider({
    id: "c",
    label: "Cu 量",
    min: C_MIN_SLIDER,
    max: C_MAX_WT,
    step: 0.1,
    value: C0_WT,
    unit: "wt%",
  });
  cSlider.onChange((v) => {
    cWt = v;
    host.requestRender();
  });

  const tSlider = host.controls.slider({
    id: "T",
    label: "温度",
    min: T_MIN_SLIDER,
    max: T_MAX_C,
    step: T_STEP,
    value: T_ROOM,
    unit: "°C",
  });
  tSlider.onChange((v) => {
    tempC = v;
    if (tempC > solvusTempC(cWt)) quenched = false;
    host.requestRender();
  });

  const traceBtn = host.controls.button({ label: "熱処理をなぞる" });
  traceBtn.onClick(() => {
    leg = 0;
    legT = 0;
    legFrom = tempC;
    legsDone = 0;
    quenched = false;
    host.setPlaying(true);
  });

  host.controls.reset(() => {
    cSlider.set(C0_WT);
    tSlider.set(T_ROOM);
    leg = -1;
    legsDone = 0;
    quenched = false;
    host.setPlaying(false);
  });

  /* ---- 相の判定 ---- */

  /** 組成 c が単相 α になる最低温度 [°C](solvus の逆関数。上限は共晶温度) */
  function solvusTempC(cw: number): number {
    if (cw >= C_EUT_WT) return T_EUT_C;
    // solubilityWt の逆関数を二分法で解く(共晶で頭打ちなので単調)
    let lo = 0;
    let hi = T_EUT_C;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (solubilityWt(mid + KELVIN) < cw) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** 固相線・液相線(共晶点へ向かう直線近似) */
  function solidusT(cw: number): number {
    return T_MELT_C - ((T_MELT_C - T_EUT_C) * cw) / C_EUT_WT;
  }
  function liquidusT(cw: number): number {
    return T_MELT_C - ((T_MELT_C - T_EUT_C) * cw) / C_LIQ_EUT;
  }

  type PhaseName = "L" | "α+L" | "α" | "α+θ";
  function phaseAt(cw: number, tC: number): PhaseName {
    if (tC > liquidusT(cw)) return "L";
    if (tC > solidusT(cw) && tC > T_EUT_C) return "α+L";
    return tC >= solvusTempC(cw) ? "α" : "α+θ";
  }

  /* ---- レイアウト ---- */

  function layout(): { plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 34 : 22;
    const left = narrow ? 34 : 44;
    const bottom = narrow ? 30 : 34;
    const right = narrow ? 8 : 12;
    return {
      plot: {
        x: pad + left,
        y: pad + strip + 10,
        w: w - pad - left - right,
        h: h - pad * 2 - strip - 10 - bottom,
      },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { plot: p, narrow } = layout();

    const mapX = (cw: number): number => p.x + (p.w * cw) / C_MAX_WT;
    const mapY = (tC: number): number => p.y + p.h - (p.h * tC) / T_MAX_C;

    const cs = solubilityWt(tempC + KELVIN);
    const phase = phaseAt(cWt, tempC);

    /* 読み出し */
    drawReadouts(
      ctx,
      [
        [`${fmtSig(cWt)} wt% Cu / ${Math.round(tempC)} °C`, c.text],
        [`固溶限 ${cs < 0.01 ? "< 0.01" : fmtSig(cs)} wt%`, c.text],
        [
          phase === "α"
            ? "すべて固溶している(単相 α)"
            : phase === "α+θ"
              ? quenched
                ? `過飽和 ${fmtSig(supersaturation(tempC + KELVIN, cWt))} 倍(凍結)`
                : `平衡では θ が出る(過飽和 ${fmtSig(supersaturation(tempC + KELVIN, cWt))} 倍)`
              : "液相を含む",
          phase === "α" ? c.text2 : c.soluteEdge,
        ],
      ],
      narrow ? 8 : 12,
      narrow ? 6 : 8,
      w - 8,
      narrow,
    );

    /* 相領域の塗り(α = matrix 淡色、α+θ = precip 淡色) */
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(mapX(0), mapY(0));
    ctx.lineTo(mapX(0), mapY(T_MELT_C));
    ctx.lineTo(mapX(C_EUT_WT), mapY(T_EUT_C));
    for (let tC = T_EUT_C; tC >= 0; tC -= 5) {
      ctx.lineTo(mapX(solubilityWt(tC + KELVIN)), mapY(tC));
    }
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = c.matrix;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(mapX(C_MAX_WT), mapY(0));
    ctx.lineTo(mapX(0), mapY(0));
    for (let tC = 0; tC <= T_EUT_C; tC += 5) {
      ctx.lineTo(mapX(solubilityWt(tC + KELVIN)), mapY(tC));
    }
    ctx.lineTo(mapX(C_EUT_WT), mapY(T_EUT_C));
    ctx.lineTo(mapX(C_MAX_WT), mapY(T_EUT_C));
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = c.precip;
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 境界線 */
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = c.text2;
    // solvus
    ctx.beginPath();
    for (let tC = 0; tC <= T_EUT_C; tC += 4) {
      const x = mapX(solubilityWt(tC + KELVIN));
      const y = mapY(tC);
      if (tC === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // solidus / liquidus / 共晶水平線
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(mapX(0), mapY(T_MELT_C));
    ctx.lineTo(mapX(C_EUT_WT), mapY(T_EUT_C));
    ctx.moveTo(mapX(0), mapY(T_MELT_C));
    ctx.lineTo(mapX(C_MAX_WT), mapY(liquidusT(C_MAX_WT)));
    ctx.moveTo(mapX(C_EUT_WT), mapY(T_EUT_C));
    ctx.lineTo(mapX(C_MAX_WT), mapY(T_EUT_C));
    ctx.stroke();

    /* 領域ラベル */
    ctx.font = font(narrow ? 11 : 12.5, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = c.text2;
    ctx.fillText("L(液相)", mapX(1.6), mapY(T_MAX_C - 30));
    ctx.fillText("α + L", mapX(4.6), mapY(600));
    ctx.fillStyle = c.matrixEdge;
    ctx.fillText("α(固溶体)", mapX(1.5), mapY(430));
    ctx.fillStyle = c.precipEdge;
    ctx.fillText("α + θ", mapX(6.4), mapY(250));

    /* 熱処理経路(3 区間が重ならないよう横にずらして描く) */
    const px = mapX(C0_WT);
    ctx.lineWidth = 2;
    for (let i = 0; i < LEGS.length; i++) {
      const from = i === 0 ? T_ROOM : LEGS[i - 1].t;
      const to = LEGS[i].t;
      const done = i < legsDone;
      const lx = px + LEG_OFFSET_PX[i];
      ctx.save();
      ctx.strokeStyle = done ? c.accent : c.hairline;
      if (!done) ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lx, mapY(from));
      ctx.lineTo(lx, mapY(to));
      ctx.stroke();
      ctx.restore();
      if (done) {
        const y0 = mapY(from);
        const y1 = mapY(to);
        const yLabel = y0 + (y1 - y0) * LEG_LABEL_FRAC[i];
        arrow(ctx, lx, (y0 + y1) / 2, lx, y1, c.accent, 2, 8);
        ctx.font = font(narrow ? 10 : 11.5, 600);
        ctx.fillStyle = c.accent;
        ctx.textAlign = LEG_OFFSET_PX[i] < 0 ? "right" : "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
          LEGS[i].label,
          lx + (LEG_OFFSET_PX[i] < 0 ? -8 : 8),
          yLabel,
        );
      }
    }
    ctx.restore();

    /* 軸 */
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y);
    ctx.lineTo(p.x + 0.5, p.y + p.h + 0.5);
    ctx.lineTo(p.x + p.w, p.y + p.h + 0.5);
    ctx.stroke();
    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, T_MAX_C, 4)) {
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(p.x - 3, y + 0.5);
      ctx.lineTo(p.x + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), p.x - 5, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("温度 [°C]", p.x + 2, p.y - 4);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of linTicks(0, C_MAX_WT, 4)) {
      const x = mapX(v);
      ctx.beginPath();
      ctx.moveTo(x, p.y + p.h + 0.5);
      ctx.lineTo(x, p.y + p.h + 3.5);
      ctx.stroke();
      ctx.fillText(String(v), x, p.y + p.h + 5);
    }
    ctx.fillText("Cu 量 [wt%]", p.x + p.w / 2, p.y + p.h + (narrow ? 16 : 18));

    /* 組織アイコン(左下の小さな箱) */
    drawIcon(p, phase, narrow);

    /* 状態点 */
    const sx = mapX(cWt);
    const sy = mapY(tempC);
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, TAU2);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.accent;
    ctx.stroke();
  }

  /** 現在の相に対応する組織の模式(角の小さな箱) */
  function drawIcon(p: Pane, phase: string, narrow: boolean): void {
    const size = narrow ? 62 : 82;
    const x = p.x + 8;
    // ラベルのぶん軸から離す
    const y = p.y + p.h - size - 24;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.hairline;
    ctx.stroke();
    ctx.clip();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = c.matrix;
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 1;

    const twoPhase = phase === "α+θ" && !quenched;
    const n = twoPhase ? ICON_ATOMS / 2 : ICON_ATOMS;
    for (let i = 0; i < n; i++) {
      atom(
        ctx,
        x + 5 + iconPos[i * 2] * (size - 10),
        y + 5 + iconPos[i * 2 + 1] * (size - 10),
        2.4,
        c.solute,
        c.soluteEdge,
      );
    }
    if (twoPhase) {
      // 平衡では粗大な θ が出る
      for (let k = 0; k < 2; k++) {
        atom(
          ctx,
          x + size * (0.32 + 0.4 * k),
          y + size * (0.62 - 0.28 * k),
          size * 0.11,
          c.precip,
          c.precipEdge,
        );
      }
    }
    ctx.restore();
    ctx.font = font(10.5);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      phase === "α"
        ? "すべて固溶"
        : phase === "α+θ"
          ? quenched
            ? "過飽和のまま凍結"
            : "平衡では α + θ"
          : "液相を含む",
      x,
      y + size + 3,
    );
  }

  /* ---- ドラッグ(タッチ・マウス両対応) ---- */

  function setFromPointer(e: PointerEvent): void {
    const { plot: p } = layout();
    const cw = clamp(
      (C_MAX_WT * (e.offsetX - p.x)) / p.w,
      C_MIN_SLIDER,
      C_MAX_WT,
    );
    const tC = clamp(
      (T_MAX_C * (p.y + p.h - e.offsetY)) / p.h,
      T_MIN_SLIDER,
      T_MAX_C,
    );
    cSlider.set(Number(cw.toFixed(1)));
    tSlider.set(Math.round(tC / T_STEP) * T_STEP);
  }

  function onPointerDown(e: PointerEvent): void {
    if (leg >= 0) return; // 経路アニメ中は操作しない
    const { plot: p } = layout();
    if (
      e.offsetX < p.x - 10 ||
      e.offsetX > p.x + p.w + 10 ||
      e.offsetY < p.y - 10 ||
      e.offsetY > p.y + p.h + 10
    )
      return;
    dragging = true;
    dragPointerId = e.pointerId;
    host.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    setFromPointer(e);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    setFromPointer(e);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = -1;
  }

  host.canvas.addEventListener("pointerdown", onPointerDown);
  host.canvas.addEventListener("pointermove", onPointerMove);
  host.canvas.addEventListener("pointerup", onPointerUp);
  host.canvas.addEventListener("pointercancel", onPointerUp);

  /* ---- 経路アニメ(実行中だけ onFrame を回す) ---- */

  host.onFrame((dt) => {
    if (leg >= 0) {
      legT += dt;
      const u = clamp(legT / LEG_SECONDS, 0, 1);
      tempC = legFrom + (LEGS[leg].t - legFrom) * easeInOutCubic(u);
      if (cWt !== C0_WT) cSlider.set(C0_WT);
      if (u >= 1) {
        legsDone = leg + 1;
        tSlider.set(LEGS[leg].t); // スライダー表示を各区間の到達点に合わせる
        if (leg === 1) quenched = true; // 焼入れで過飽和を凍結
        legFrom = LEGS[leg].t;
        leg = leg + 1 < LEGS.length ? leg + 1 : -1;
        legT = 0;
        if (leg < 0) host.setPlaying(false);
      }
    }
    draw();
  });
  host.onRender(draw);
  host.setPlaying(false);

  return {
    destroy(): void {
      host.canvas.removeEventListener("pointerdown", onPointerDown);
      host.canvas.removeEventListener("pointermove", onPointerMove);
      host.canvas.removeEventListener("pointerup", onPointerUp);
      host.canvas.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
