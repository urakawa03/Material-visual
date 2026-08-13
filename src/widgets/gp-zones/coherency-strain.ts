/**
 * coherency-strain.ts — 図5「整合ひずみと析出シーケンス」(記事仕様書 07 §5.5)
 *
 * Cu は Al より小さいので、母相と整合な粒子は「引き伸ばされて」母相の格子に
 * 乗っている。そのぶん粒子の内部は引張(--mat-tension)、周囲の母相は
 * 引き込まれて圧縮(--mat-compression)になる。
 *
 * 段階を GP → θ″ → θ′ → θ と進めると整合度 φ が下がり、格子の歪みは弱まる
 * 一方、界面エネルギーは上がる:
 *   γ(φ) = γ_inc − (γ_inc − γ_coh)·φ、E_界面 = γ·4πr²
 *   E_ひずみ = 4μ(φδ)²·(4/3)πr³
 * 界面は r²、ひずみは r³ で効くので、小さいうちは整合が得・大きくなると
 * 非整合が得になる — これが析出シーケンスの駆動力である。
 *
 * 簡略化(図注): 2D 模式。変位場は弾性論の厳密解ではなく、見やすさのために
 * 誇張してある。粒子の描画サイズは対数的に圧縮してある。実在のシーケンスには
 * さらに中間段階があり、θ″/θ′ は板状。エネルギーは桁の関係を示すモデル値。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import { MU_GPA } from "./lib/constants";
import {
  type Pane,
  drawReadouts,
  fmtSig,
  font,
  resolvePalette,
} from "./lib/draw";

/** 析出シーケンスの段階(整合度 φ つき) */
const STAGES = [
  { id: "gp", label: "GP ゾーン", phi: 1.0, note: "整合" },
  { id: "t2", label: "θ″", phi: 0.8, note: "整合" },
  { id: "t1", label: "θ′", phi: 0.35, note: "半整合" },
  { id: "th", label: "θ", phi: 0.0, note: "非整合" },
] as const;
type StageId = (typeof STAGES)[number]["id"];

/** 界面エネルギー [J/m²](オストワルド成長記事 図8 のレバー値と同じ数値) */
const GAMMA_COH = 0.02;
const GAMMA_INC = 0.8;
/** 格子ミスフィット δ(Cu は Al より小さい) */
const MISFIT = 0.06;
/** 剛性率 [Pa] */
const MU_PA = MU_GPA * 1e9;

/** 半径スライダー [nm] */
const R_MIN = 1;
const R_MAX = 20;
const R_INIT = 2;

/** 格子の点の数と変位の誇張倍率(見やすさのため) */
const GRID_NX = 21;
const GRID_NY = 15;
const EXAGGERATION = 5;
/** 半整合のミスフィット転位の本数 */
const N_MISFIT = 6;

const TAU2 = Math.PI * 2;

/** 段階の界面エネルギー γ(φ) [J/m²] */
function gammaOf(phi: number): number {
  return GAMMA_INC - (GAMMA_INC - GAMMA_COH) * phi;
}
/** 界面エネルギー [aJ](r は nm) */
function surfaceEnergyAJ(rNm: number, phi: number): number {
  return gammaOf(phi) * 4 * Math.PI * rNm * rNm;
}
/** ひずみエネルギー [aJ](r は nm) */
function strainEnergyAJ(rNm: number, phi: number): number {
  const d = phi * MISFIT;
  return 4 * MU_PA * d * d * (4 / 3) * Math.PI * rNm ** 3 * 1e-9;
}

export default function coherencyStrain(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const c = resolvePalette();

  let stageId: StageId = "gp";
  let rNm = R_INIT;
  let showStrain = true;

  const stage = (): (typeof STAGES)[number] =>
    STAGES.find((s) => s.id === stageId) as (typeof STAGES)[number];

  /* ---- 操作部品(§7.2) ---- */

  const stageSeg = host.controls.segmented<StageId>({
    id: "stage",
    label: "段階",
    options: STAGES.map((s) => ({ value: s.id, label: s.label })),
    value: "gp",
  });
  stageSeg.onChange((v) => {
    stageId = v;
    host.requestRender();
  });

  const rSlider = host.controls.slider({
    id: "r",
    label: "粒子の大きさ r",
    min: R_MIN,
    max: R_MAX,
    value: R_INIT,
    scale: "log",
    unit: "nm",
  });
  rSlider.onChange((v) => {
    rNm = v;
    host.requestRender();
  });

  const strainToggle = host.controls.toggle({
    id: "strain",
    label: "ひずみ場を表示",
    value: true,
  });
  strainToggle.onChange((v) => {
    showStrain = v;
    host.requestRender();
  });

  host.controls.reset(() => {
    stageSeg.set("gp");
    rSlider.set(R_INIT);
    strainToggle.set(true);
  });

  /* ---- レイアウト ---- */

  function layout(): { field: Pane; bars: Pane; strip: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 34 : 24;
    const top = pad + strip;
    const stripH = 26;
    const barsW = narrow ? 108 : 152;
    const bodyH = h - top - pad - stripH;
    return {
      field: { x: pad, y: top, w: w - pad * 2 - barsW - 10, h: bodyH },
      bars: { x: w - pad - barsW, y: top, w: barsW, h: bodyH },
      strip: { x: pad, y: top + bodyH, w: w - pad * 2, h: stripH },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  /** 粒子の描画半径(対数的に圧縮。r = 1 nm で小さく、20 nm で大きく) */
  function particlePx(p: Pane): number {
    const base = Math.min(p.w, p.h);
    const t = Math.log(rNm / R_MIN) / Math.log(R_MAX / R_MIN);
    return base * (0.11 + 0.2 * t);
  }

  /** 変位場: 小さい Cu が周囲を引き込む(中心向き)。ρ = 距離/粒子半径 */
  function displacement(dist: number, rPx: number, phi: number): number {
    if (dist < 1e-6) return 0;
    const u = dist < rPx ? dist / rPx : (rPx / dist) ** 2;
    return -phi * MISFIT * EXAGGERATION * rPx * u;
  }

  function drawField(p: Pane, narrow: boolean): void {
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    const st = stage();
    const phi = st.phi;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const rPx = particlePx(p);
    const dx = (p.w - 20) / (GRID_NX - 1);
    const dy = (p.h - 20) / (GRID_NY - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    ctx.clip();

    /* ひずみ場の塗り(粒子内部 = 引張、周囲 = 圧縮) */
    if (showStrain && phi > 0) {
      ctx.globalAlpha = clamp(phi, 0, 1);
      ctx.fillStyle = c.tension;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, TAU2);
      ctx.fill();
      // 周囲の圧縮場は同心の帯で表す(グラデーションは使わない — 母体仕様 §2-7)
      for (let k = 1; k <= 3; k++) {
        ctx.globalAlpha = clamp(phi, 0, 1) * (1 - (k - 1) * 0.28);
        ctx.fillStyle = c.compression;
        ctx.beginPath();
        ctx.arc(cx, cy, rPx * (1 + k * 0.45), 0, TAU2);
        ctx.arc(cx, cy, rPx * (1 + (k - 1) * 0.45), 0, TAU2, true);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* 母相の格子(変位つき)。非整合では粒子の内側を描かない */
    const px = (i: number): number => p.x + 10 + i * dx;
    const py = (j: number): number => p.y + 10 + j * dy;
    const warp = (x: number, y: number): [number, number] => {
      const ddx = x - cx;
      const ddy = y - cy;
      const dist = Math.hypot(ddx, ddy);
      const u = displacement(dist, rPx, phi);
      if (dist < 1e-6) return [x, y];
      return [x + (u * ddx) / dist, y + (u * ddy) / dist];
    };

    if (phi === 0) {
      ctx.beginPath();
      ctx.rect(p.x, p.y, p.w, p.h);
      ctx.arc(cx, cy, rPx, 0, TAU2, true);
      ctx.clip();
    }
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j < GRID_NY; j++) {
      for (let i = 0; i < GRID_NX; i++) {
        const [x, y] = warp(px(i), py(j));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    for (let i = 0; i < GRID_NX; i++) {
      for (let j = 0; j < GRID_NY; j++) {
        const [x, y] = warp(px(i), py(j));
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    // 母相の原子
    ctx.beginPath();
    for (let j = 0; j < GRID_NY; j++) {
      for (let i = 0; i < GRID_NX; i++) {
        const [x, y] = warp(px(i), py(j));
        const inside = Math.hypot(x - cx, y - cy) < rPx;
        if (inside) continue;
        ctx.moveTo(x + 2.6, y);
        ctx.arc(x, y, 2.6, 0, TAU2);
      }
    }
    ctx.fillStyle = c.matrix;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = c.matrixEdge;
    ctx.stroke();
    if (phi === 0) ctx.restore();

    /* 粒子 */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, TAU2);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = c.precip;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = phi === 0 ? 2.5 : 1.5;
    ctx.strokeStyle = c.precipEdge;
    if (phi > 0 && phi < 0.6) ctx.setLineDash([6, 4]); // 半整合: 界面が途切れる
    ctx.stroke();
    ctx.setLineDash([]);
    // 非整合では粒子が独自の格子を持つ(母相とつながらない)
    if (phi === 0) {
      ctx.clip();
      ctx.strokeStyle = c.precipEdge;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      const step = Math.max(dx, dy) * 0.8;
      const ang = 0.38;
      ctx.beginPath();
      for (let k = -12; k <= 12; k++) {
        const o = k * step;
        ctx.moveTo(
          cx + Math.cos(ang) * -rPx * 2 - Math.sin(ang) * o,
          cy + Math.sin(ang) * -rPx * 2 + Math.cos(ang) * o,
        );
        ctx.lineTo(
          cx + Math.cos(ang) * rPx * 2 - Math.sin(ang) * o,
          cy + Math.sin(ang) * rPx * 2 + Math.cos(ang) * o,
        );
        ctx.moveTo(
          cx + Math.sin(ang) * -rPx * 2 + Math.cos(ang) * o,
          cy - Math.cos(ang) * -rPx * 2 + Math.sin(ang) * o,
        );
        ctx.lineTo(
          cx + Math.sin(ang) * rPx * 2 + Math.cos(ang) * o,
          cy - Math.cos(ang) * rPx * 2 + Math.sin(ang) * o,
        );
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    /* 半整合: 界面のミスフィット転位(⊥) */
    if (phi > 0 && phi < 0.6) {
      ctx.strokeStyle = c.defect;
      ctx.lineWidth = 2;
      for (let k = 0; k < N_MISFIT; k++) {
        const a = (TAU2 * k) / N_MISFIT + 0.2;
        const x = cx + Math.cos(a) * rPx;
        const y = cy + Math.sin(a) * rPx;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(5, 0);
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -7);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();

    /* ラベル */
    ctx.font = font(narrow ? 10 : 11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = c.text2;
    ctx.fillText(
      phi === 0
        ? "格子が界面で途切れる(非整合)"
        : phi < 0.6
          ? "界面にミスフィット転位が入る(半整合)"
          : "格子が粒子を貫いて連続している(整合)",
      p.x + 6,
      p.y + 6,
    );
    if (showStrain && phi > 0) {
      ctx.textBaseline = "bottom";
      const l1 = "粒子: 引き伸ばされる(引張)";
      const l2 = "母相: 引き込まれる(圧縮)";
      const lw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = c.bg;
      ctx.fillRect(p.x + 3, p.y + p.h - 34, lw + 8, 32);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text2;
      ctx.fillText(l1, p.x + 6, p.y + p.h - 20);
      ctx.fillText(l2, p.x + 6, p.y + p.h - 6);
    }
  }

  /** 右: 段階ごとのエネルギー内訳(界面 + ひずみ) */
  function drawBars(p: Pane, narrow: boolean): void {
    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("エネルギー [aJ]", p.x, p.y);

    const totals = STAGES.map(
      (s) => surfaceEnergyAJ(rNm, s.phi) + strainEnergyAJ(rNm, s.phi),
    );
    const max = Math.max(...totals);
    const rowH = (p.h - 28) / STAGES.length;
    const barMaxW = p.w - 4;
    STAGES.forEach((s, i) => {
      const y = p.y + 22 + i * rowH;
      const surf = surfaceEnergyAJ(rNm, s.phi);
      const str = strainEnergyAJ(rNm, s.phi);
      const wSurf = (surf / max) * barMaxW;
      const wStr = (str / max) * barMaxW;
      const active = s.id === stageId;
      const h = Math.min(rowH * 0.42, 14);
      ctx.globalAlpha = active ? 1 : 0.45;
      ctx.fillStyle = c.precip;
      ctx.fillRect(p.x, y + 12, wSurf, h);
      ctx.globalAlpha = active ? 0.45 : 0.25;
      ctx.fillStyle = c.defect;
      ctx.fillRect(p.x + wSurf, y + 12, wStr, h);
      ctx.globalAlpha = active ? 1 : 0.45;
      ctx.strokeStyle = c.precipEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, y + 12.5, Math.max(wSurf + wStr, 1), h - 1);
      ctx.globalAlpha = 1;
      ctx.font = font(narrow ? 9.5 : 10.5, active ? 600 : 400);
      ctx.fillStyle = active ? c.text : c.text2;
      ctx.textAlign = "left";
      ctx.fillText(s.label, p.x, y);
      ctx.textAlign = "right";
      ctx.fillText(fmtSig(surf + str), p.x + p.w, y);
      ctx.textAlign = "left";
    });
    // 凡例
    ctx.font = font(narrow ? 9 : 10);
    ctx.fillStyle = c.precipEdge;
    ctx.fillText("■ 界面", p.x, p.y + p.h - 12);
    ctx.fillStyle = c.defect;
    ctx.fillText("■ ひずみ", p.x + (narrow ? 46 : 56), p.y + p.h - 12);
  }

  /** 下: 析出シーケンスの帯 */
  function drawStrip(p: Pane, narrow: boolean): void {
    ctx.font = font(narrow ? 10.5 : 12);
    ctx.textBaseline = "middle";
    const y = p.y + p.h / 2;
    let x = p.x;
    STAGES.forEach((s, i) => {
      const active = s.id === stageId;
      const label = `${s.label}(${s.note})`;
      ctx.font = font(narrow ? 10.5 : 12, active ? 600 : 400);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = active ? c.precipEdge : c.text2;
      ctx.textAlign = "left";
      ctx.fillText(label, x, y);
      x += tw + 6;
      if (i < STAGES.length - 1) {
        ctx.fillStyle = c.text2;
        ctx.fillText("→", x, y);
        x += ctx.measureText("→").width + 6;
      }
    });
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    const st = stage();
    drawReadouts(
      ctx,
      [
        [`${st.label}(${st.note})`, c.precipEdge],
        [`整合度 ${Math.round(st.phi * 100)} %`, c.text],
        [`r ${fmtSig(rNm)} nm`, c.text],
        [`γ ${fmtSig(gammaOf(st.phi))} J/m²`, c.text2],
        [
          surfaceEnergyAJ(rNm, st.phi) + strainEnergyAJ(rNm, st.phi) <=
          Math.min(
            ...STAGES.map(
              (s) => surfaceEnergyAJ(rNm, s.phi) + strainEnergyAJ(rNm, s.phi),
            ),
          ) +
            1e-9
            ? "この大きさではこの段階が最も得"
            : "この大きさでは別の段階のほうが得",
          c.text2,
        ],
      ],
      l.narrow ? 8 : 12,
      l.narrow ? 6 : 8,
      w - 8,
      l.narrow,
    );
    drawField(l.field, l.narrow);
    drawBars(l.bars, l.narrow);
    drawStrip(l.strip, l.narrow);
  }

  host.onRender(draw);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
