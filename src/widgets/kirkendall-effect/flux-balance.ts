/**
 * flux-balance.ts — 図4「3 本の流束と格子の移動」(記事仕様書 06 §5.4)
 *
 * 上段: X_Zn(x)(--mat-second)と X_Cu(x)(--mat-matrix)のプロファイル +
 *       観察位置の縦線(accent)。
 * 中段: その位置での 3 本の流束。J_Zn(second)・J_Cu(matrix)・J_V(破線の
 *       輪郭矢印)。J_V = −(J_A + J_B) をその場に注記する。
 * 下段: 格子面(縦線の列)とマーカー、格子の移動方向の矢印(accent)。
 *
 * モデル(定数 D̃ の誤差関数解による断面スナップショット — §5.4):
 *   X(x,t) = (X_brass/2)[1 + erf(x/2√(D̃t))]
 *   J_A = −C D_A ∂X_A/∂x,  J_B = +C D_B ∂X_A/∂x,  J_V = −(J_A + J_B)
 *   v = (D_A − D_B) ∂X_A/∂x = J_V / C
 * 比を振るときは相互拡散係数 D̃ を一定に保つ(プロファイルの広がり方を
 * 変えずに、比の効きを流束と格子速度だけに現す)。
 *
 * 実装方式: 2D / requestRender(操作時のみ再描画。アイドル時の消費はゼロ)。
 * 簡略化(図注): 空孔の生成・消滅(転位・粒界)は「必要なだけ起こる」と仮定。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import {
  CELSIUS_OFFSET,
  T_ANNEAL_C,
  T_ANNEAL_S,
  X_BRASS,
  dCu,
  dZn,
} from "./lib/constants";
import {
  coupleGradientAnalytic,
  coupleProfileAnalytic,
  dPairAtFixedDTilde,
  fluxes,
  interdiffusionD,
  markerShiftAnalytic,
  markerVelocity,
} from "./lib/diffusion";
import {
  type Pane,
  arrow,
  dashedArrow,
  dashedLine,
  font,
  fmtSig,
  linTicks,
  outlinedText,
  paneFrame,
  resolvePalette,
} from "./lib/draw";

/** 表示・計算する視野の半幅 [m] */
const VIEW_HALF = 300e-6;
/** 観察位置スライダー(§5.4) */
const X_MIN_UM = -300;
const X_MAX_UM = 300;
const X_STEP_UM = 5;
const X_INIT_UM = 0;
/** D_Zn/D_Cu 比(1.0 が必ず選べる刻み) */
const RATIO_MIN = 0.5;
const RATIO_MAX = 8;
const RATIO_STEP = 0.1;
const RATIO_INIT = 4;
/** 経過時間スライダー [日](対数) */
const DAY_MIN = 1;
const DAY_MAX = 200;
const DAY_INIT = 20;
/** 格子面の本数(下段の模式) */
const PLANE_COUNT = 15;
/** 格子の移動速度の矢印を最大長にする速さ [m/s] */
const V_ARROW_FULL = 2e-11;

export default function fluxBalance(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();

  /**
   * 相互拡散係数 D̃(785 °C の値)を固定したまま比だけを振る(§5.4)。
   * プロファイルの広がり方は比によらず一定になるので、比の効きが
   * 「3 本の流束と格子の速度」だけに現れる。
   */
  const D_TILDE_FIXED = interdiffusionD(
    X_BRASS / 2,
    dZn(T_ANNEAL_C + CELSIUS_OFFSET),
    dCu(T_ANNEAL_C + CELSIUS_OFFSET),
  );

  let xObsUm = X_INIT_UM;
  let ratio = RATIO_INIT;
  let days = DAY_INIT;
  let showVacancy = true;

  function currentD(): { dA: number; dB: number } {
    return dPairAtFixedDTilde(ratio, D_TILDE_FIXED, X_BRASS / 2);
  }

  /** 定数 D̃(比を振っても一定 — プロファイルの形は変わらない) */
  function dTilde(): number {
    return D_TILDE_FIXED;
  }

  function timeS(): number {
    return days * 86400;
  }

  /* ---- 操作部品(§7.2) ---- */

  const xSlider = host.controls.slider({
    id: "xobs",
    label: "観察位置 x",
    min: X_MIN_UM,
    max: X_MAX_UM,
    step: X_STEP_UM,
    value: X_INIT_UM,
    unit: "μm",
  });
  xSlider.onChange((v) => {
    xObsUm = v;
    host.requestRender();
  });

  const ratioSlider = host.controls.slider({
    id: "ratio",
    label: "D_Zn / D_Cu",
    min: RATIO_MIN,
    max: RATIO_MAX,
    step: RATIO_STEP,
    value: RATIO_INIT,
    format: (v) => v.toFixed(1),
  });
  ratioSlider.onChange((v) => {
    ratio = v;
    host.requestRender();
  });

  const daySlider = host.controls.slider({
    id: "days",
    label: "経過時間 t",
    min: DAY_MIN,
    max: DAY_MAX,
    value: DAY_INIT,
    unit: "日",
    scale: "log",
  });
  daySlider.onChange((v) => {
    days = v;
    host.requestRender();
  });

  const vacToggle = host.controls.toggle({
    id: "vac",
    label: "空孔の流れを表示",
    value: true,
  });
  vacToggle.onChange((v) => {
    showVacancy = v;
    host.requestRender();
  });

  const evenBtn = host.controls.button({ label: "D を等しくする(比 1.0)" });
  evenBtn.onClick(() => {
    ratioSlider.set(1);
    host.requestRender();
  });

  /* ---- レイアウト ---- */

  function layout(): {
    profile: Pane;
    flux: Pane;
    lattice: Pane;
    narrow: boolean;
  } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const gap = narrow ? 6 : 10;
    const usable = h - 2 * pad - 2 * gap;
    const profileH = usable * 0.42;
    const fluxH = usable * 0.34;
    const latticeH = usable - profileH - fluxH;
    return {
      profile: { x: pad, y: pad, w: w - 2 * pad, h: profileH },
      flux: { x: pad, y: pad + profileH + gap, w: w - 2 * pad, h: fluxH },
      lattice: {
        x: pad,
        y: pad + profileH + gap + fluxH + gap,
        w: w - 2 * pad,
        h: latticeH,
      },
      narrow,
    };
  }

  /** 物理 x [m] → パネル内の px(3 つのパネルで x 軸を共有する) */
  function mapX(p: Pane, x: number): number {
    const left = p.x + 36;
    const width = p.w - 36 - 8;
    return left + ((x + VIEW_HALF) / (2 * VIEW_HALF)) * width;
  }

  /* ---- 描画 ---- */

  function drawProfile(p: Pane): void {
    const yTop = p.y + 16;
    const yBot = p.y + p.h - 16;
    const t = timeS();
    const d = dTilde();
    const mapC = (c: number): number => yBot - (yBot - yTop) * c;

    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mapX(p, -VIEW_HALF) + 0.5, yTop);
    ctx.lineTo(mapX(p, -VIEW_HALF) + 0.5, yBot);
    ctx.lineTo(mapX(p, VIEW_HALF), yBot);
    ctx.stroke();
    ctx.font = font(10.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, 1, 2)) {
      const y = mapC(v);
      ctx.fillText(v.toFixed(1), mapX(p, -VIEW_HALF) - 5, y);
    }

    // X_Cu(matrix)と X_Zn(second)。X_Cu = 1 − X_Zn
    const curve = (getter: (x: number) => number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 140; k++) {
        const x = -VIEW_HALF + (2 * VIEW_HALF * k) / 140;
        const sx = mapX(p, x);
        const sy = mapC(getter(x));
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    };
    curve((x) => 1 - coupleProfileAnalytic(x, t, d), pal.matrix);
    curve((x) => coupleProfileAnalytic(x, t, d), pal.second);

    // 観察位置
    const xo = mapX(p, xObsUm * 1e-6);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xo, yTop - 6);
    ctx.lineTo(xo, yBot);
    ctx.stroke();

    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    outlinedText(
      ctx,
      "X_Cu",
      mapX(p, -VIEW_HALF) + 30,
      yTop - 2,
      pal.matrix,
      pal.bg,
    );
    outlinedText(
      ctx,
      "X_Zn(真鍮側 0.3)",
      mapX(p, 60e-6),
      yTop - 2,
      pal.second,
      pal.bg,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    outlinedText(ctx, `x = ${xObsUm} μm`, xo, yTop - 3, pal.accent, pal.bg);
    ctx.textAlign = "left";
  }

  function drawFlux(p: Pane): void {
    paneFrame(ctx, p, pal.hairline);
    const t = timeS();
    const d = dTilde();
    const { dA, dB } = currentD();
    const grad = coupleGradientAnalytic(xObsUm * 1e-6, t, d);
    const gradMax = coupleGradientAnalytic(0, t, d);
    const f = fluxes(dA, dB, grad);
    // 矢印の長さは「同じ時刻の界面での最大流束」を 1 とした相対値
    const jRef = (dA + dB) * gradMax;
    const maxLen = Math.min(p.w * 0.3, 150);
    const x0 = mapX(p, xObsUm * 1e-6);
    const rows = [
      { label: "J_Zn(速い)", j: f.jA, color: pal.second, dashed: false },
      { label: "J_Cu(遅い)", j: f.jB, color: pal.matrix, dashed: false },
    ];
    if (showVacancy) {
      rows.push({
        label: "J_V(空孔)",
        j: f.jV,
        color: pal.text2,
        dashed: true,
      });
    }
    const rowH = p.h / (rows.length + 0.6);
    ctx.font = font(11.5);
    rows.forEach((row, i) => {
      const y = p.y + rowH * (i + 0.7);
      const len = clamp((row.j / jRef) * maxLen, -maxLen, maxLen);
      if (Math.abs(len) < 1.5) {
        // 流束ゼロ: 短い縦棒で「動かない」ことを示す
        ctx.strokeStyle = row.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y - 5);
        ctx.lineTo(x0, y + 5);
        ctx.stroke();
      } else if (row.dashed) {
        dashedArrow(ctx, x0, y, x0 + len, y, row.color);
      } else {
        arrow(ctx, x0, y, x0 + len, y, row.color);
      }
      ctx.textBaseline = "middle";
      ctx.textAlign = len >= 0 ? "right" : "left";
      const tx = len >= 0 ? x0 - 8 : x0 + 8;
      outlinedText(
        ctx,
        `${row.label} ${(row.j / jRef).toFixed(2)}`,
        tx,
        y,
        row.color,
        pal.bg,
      );
    });

    // 差し引きの注記
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const note =
      Math.abs(f.jNet / jRef) < 5e-3
        ? "J_Zn + J_Cu = 0 → 空孔の流れも 0(釣り合っている)"
        : `J_Zn + J_Cu = ${(f.jNet / jRef).toFixed(2)} → J_V = −(J_Zn + J_Cu) = ${(f.jV / jRef).toFixed(2)}`;
    outlinedText(ctx, note, p.x + 8, p.y + p.h - 5, pal.text, pal.bg);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    outlinedText(
      ctx,
      "矢印の長さ = 同じ時刻の界面での最大流束を 1 とした相対値",
      p.x + p.w - 6,
      p.y + 4,
      pal.text2,
      pal.bg,
    );
    ctx.textAlign = "left";
  }

  function drawLattice(p: Pane): void {
    const t = timeS();
    const d = dTilde();
    const { dA, dB } = currentD();
    const grad = coupleGradientAnalytic(xObsUm * 1e-6, t, d);
    const v = markerVelocity(dA, dB, grad);
    const yTop = p.y + 6;
    const yBot = p.y + p.h - 18;

    // 格子面(縦線の列)
    ctx.strokeStyle = pal.matrix;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < PLANE_COUNT; i++) {
      const x =
        mapX(p, -VIEW_HALF) +
        ((mapX(p, VIEW_HALF) - mapX(p, -VIEW_HALF)) * (i + 0.5)) / PLANE_COUNT;
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
    }
    ctx.stroke();

    // 観察位置のマーカー(格子に固定された目印)
    const x0 = mapX(p, xObsUm * 1e-6);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, yTop);
    ctx.lineTo(x0, yBot);
    ctx.stroke();

    // 格子の移動を示す矢印
    ctx.font = font(11);
    ctx.textBaseline = "bottom";
    const yMid = (yTop + yBot) / 2;
    if (Math.abs(v) > V_ARROW_FULL * 1e-3) {
      const len = clamp((v / V_ARROW_FULL) * 60, -70, 70);
      arrow(ctx, x0, yMid, x0 + len, yMid, pal.accent);
      ctx.textAlign = len >= 0 ? "left" : "right";
      outlinedText(
        ctx,
        `格子が動く v = ${fmtSig(v * 1e9)} nm/s`,
        x0 + len + (len >= 0 ? 6 : -6),
        yMid - 2,
        pal.accent,
        pal.bg,
      );
    } else {
      ctx.textAlign = "left";
      outlinedText(
        ctx,
        "格子は動かない(v = 0)",
        x0 + 8,
        yMid - 2,
        pal.text2,
        pal.bg,
      );
    }

    // 56 日換算の移動量(桁の感覚)。x 軸目盛と重ならないよう上端に置く
    const shift56 = markerShiftAnalytic(dA, dB, T_ANNEAL_S) * 1e6;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    outlinedText(
      ctx,
      `格子面(模式)と目印 — 56 日ぶんに直すと Δ ≈ ${shift56.toFixed(0)} μm`,
      p.x + p.w - 6,
      yTop,
      pal.text2,
      pal.bg,
    );
    ctx.textAlign = "left";
  }

  function drawAxis(p: Pane): void {
    // 下段の下に共通の x 軸目盛を置く
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.font = font(10.5);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const y = p.y + p.h - 14;
    for (const xu of [-300, -150, 0, 150, 300]) {
      const x = mapX(p, xu * 1e-6);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + 3);
      ctx.stroke();
      ctx.fillText(`${xu}`, x, y + 4);
    }
    ctx.textAlign = "left";
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    // 界面の位置(x = 0)を 3 パネル共通の参照線として引く
    const x0 = mapX(l.profile, 0);
    dashedLine(
      ctx,
      x0,
      l.profile.y,
      x0,
      l.lattice.y + l.lattice.h - 16,
      pal.hairline,
      [4, 4],
    );
    drawProfile(l.profile);
    drawFlux(l.flux);
    drawLattice(l.lattice);
    drawAxis(l.lattice);
  }

  host.onRender(draw);

  return {
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
